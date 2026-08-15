# Volume migration runbook — move SQLite + Neo4j onto `/mnt/bfstats-data`

Moves both PVCs off the k3s boot disk onto the attached Hetzner volume, so the
app runs entirely off `/mnt/bfstats-data`.

**Why:** Hetzner's nightly backups image the boot disk, but they're ARM images
and no ARM server can currently be provisioned — so they can only be restored by
rebuilding this exact server. The volume survives the server being lost.

**The old PVC directories are the backup.** Nothing is deleted; the copy is
one-way and the originals stay on the boot disk as the rollback. Don't take a
separate backup first — collectors would resume between the two and make it
stale. Do the migration in one window.

The volume has no backups of its own, so set up routine copies (Appendix A)
once this is done.

## Facts this runbook assumes

| | |
|---|---|
| host | `root@77.42.38.148` (key `~/.ssh/hetzner`) |
| kube context | `hetzner` |
| namespace | `bf42-stats` |
| SQLite PVC | `bf42-stats-pvc` → `.../pvc-*_bf42-stats_bf42-stats-pvc/` (~24 G) |
| Neo4j PVC | `neo4j-pvc` → `.../pvc-*_bf42-stats_neo4j-pvc/` (~2.2 G) |
| app runs as | uid/gid `1000` |
| Neo4j runs as | uid/gid `7474` |

**Two machines.** `kubectl` runs from your laptop against the `hetzner` context.
Everything touching files — `cp`, `sqlite3`, `chown`, `du`, and the `$OLD_*` /
`$NEW_*` variables — runs on the server. Keep an SSH session open alongside:

```bash
ssh -i ~/.ssh/hetzner root@77.42.38.148
```

Free space check (need ~27 G):

```bash
df -h /mnt/bfstats-data
```

---

## Step 1 — Provision the new PVCs

The `local-path` provisioner already defaults to `/mnt/bfstats-data`. It's
`WaitForFirstConsumer`, so a PVC alone creates nothing — the primer pods are
what make the directories appear.

```bash
kubectl --context hetzner apply -f deploy/volume-migration/pvc-v2.yaml
kubectl --context hetzner apply -f deploy/volume-migration/pvc-v2-primer-pods.yaml
kubectl --context hetzner wait --for=condition=Ready pod/pvc-primer-stats -n bf42-stats --timeout=120s
kubectl --context hetzner wait --for=condition=Ready pod/pvc-primer-neo4j -n bf42-stats --timeout=120s
```

## Step 2 — Confirm they landed on the volume

```bash
for c in bf42-stats-pvc-v2 neo4j-pvc-v2; do
  kubectl --context hetzner get pv \
    $(kubectl --context hetzner get pvc $c -n bf42-stats -o jsonpath='{.spec.volumeName}') \
    -o jsonpath="$c => {.spec.local.path}{'\n'}"
done
```

**Both paths must start with `/mnt/bfstats-data/`.** If either shows
`/var/lib/rancher/k3s/storage`, the provisioner config was reverted — stop and
re-apply `bfstats-localpath-set-default-path.sh`.

On the server, capture all four paths:

```bash
NEW_STATS=$(ls -d /mnt/bfstats-data/pvc-*_bf42-stats_bf42-stats-pvc-v2)
NEW_NEO4J=$(ls -d /mnt/bfstats-data/pvc-*_bf42-stats_neo4j-pvc-v2)
OLD_STATS=$(ls -d /var/lib/rancher/k3s/storage/pvc-*_bf42-stats_bf42-stats-pvc)
OLD_NEO4J=$(ls -d /var/lib/rancher/k3s/storage/pvc-*_bf42-stats_neo4j-pvc)
echo "$OLD_STATS"; echo "  -> $NEW_STATS"; echo "$OLD_NEO4J"; echo "  -> $NEW_NEO4J"
```

---

## Step 3 — Migrate Neo4j (site stays online)

The PVCs are independent, so Neo4j moves first with the app still serving. Only
graph features degrade. Safe because the app has **no liveness/readiness
probes** and `/health` registers no checks, so an unreachable Neo4j can't cause
a restart loop.

```bash
kubectl --context hetzner scale deployment/neo4j -n bf42-stats --replicas=0
kubectl --context hetzner wait --for=delete pod -l app=neo4j -n bf42-stats --timeout=120s
sleep 3
```

On the server:

```bash
cp -a "$OLD_NEO4J/." "$NEW_NEO4J/"
ls "$NEW_NEO4J"                       # expect databases/ and transactions/
du -sh "$OLD_NEO4J" "$NEW_NEO4J"      # must match

# No chown — cp -a preserved ownership. Verify it matches instead:
diff <(cd "$OLD_NEO4J" && find . -maxdepth 1 -printf '%P %m %u:%g\n' | sort) \
     <(cd "$NEW_NEO4J" && find . -maxdepth 1 -printf '%P %m %u:%g\n' | sort) \
  && echo "OWNERSHIP AND MODES MATCH"
```

Re-point Neo4j's claim and restart it:

```bash
sed -i 's/claimName: neo4j-pvc$/claimName: neo4j-pvc-v2/' deploy/app/deployment.yaml
kubectl --context hetzner apply -f deploy/app/deployment.yaml
kubectl --context hetzner scale deployment/neo4j -n bf42-stats --replicas=1
kubectl --context hetzner rollout status deployment/neo4j -n bf42-stats --timeout=180s
kubectl --context hetzner logs deployment/neo4j -n bf42-stats --tail=50
```

Verify a graph-backed page works before continuing.

---

## Step 4 — Stop the collectors (site stays online)

The site keeps serving throughout the copy. Turning off the background services
stops the playerobservation inserts, which is what makes a clean copy possible
without taking the app down.

```bash
kubectl --context hetzner set env deployment/bf42-stats -n bf42-stats DISABLE_BACKGROUND_PROCESSING=true
kubectl --context hetzner rollout status deployment/bf42-stats -n bf42-stats --timeout=180s
```

Confirm it actually took — this line only prints when the flag is on:

```bash
kubectl --context hetzner logs deployment/bf42-stats -n bf42-stats | grep DISABLE_BACKGROUND_PROCESSING
```

Expect `[startup] DISABLE_BACKGROUND_PROCESSING=true — background data services
will NOT be registered`.

**If that line is absent, stop.** Either the rollout didn't complete or the
running image predates the flag, and the copy would be torn.

Also confirm the two browser deployments aren't holding the volume:

```bash
kubectl --context hetzner get deploy sqlite-browser filebrowser -n bf42-stats
```

Both should be at `0/0`. Scale them down if not.

## Step 5 — Copy SQLite while the app serves reads

Checkpoint so the copy is self-contained. Takes a few seconds — the WAL is
~128 MB and the disk does >1 GB/s.

**Check the return value.** `wal_checkpoint` exits 0 whether or not it worked;
it reports success in its output as `busy | log_frames | checkpointed_frames`. A
leading `1` means a reader blocked it and **nothing was checkpointed** — easy to
miss, and the app is still serving reads here.

```bash
sqlite3 "$OLD_STATS/playertracker.db" \
  "PRAGMA busy_timeout=30000; PRAGMA wal_checkpoint(TRUNCATE);"
```

Expect `0|0|0` — first column `0` (not busy), and zero frames left. Anything
starting with `1` means retry.

```bash
ls -l "$OLD_STATS"/playertracker.db-wal      # expect gone or 0 bytes
```

Both checks must pass before copying. A non-empty WAL means the copy would be
missing committed data.

Copy the **whole directory** — `assets/` holds `ASSETS_STORAGE_PATH` and the app
404s its images without it. The app is still running, so guard against it
checkpointing mid-copy: that rewrites the main DB file underneath you and yields
a structurally invalid copy, not merely a stale one.

```bash
before=$(stat -c '%Y %s' "$OLD_STATS/playertracker.db")
time cp -a "$OLD_STATS/." "$NEW_STATS/"
after=$(stat -c '%Y %s' "$OLD_STATS/playertracker.db")

[ "$before" = "$after" ] && echo CLEAN || echo "SOURCE CHANGED — redo the copy"
```

If it reports a change, re-run — the source is untouched and nothing is lost.
Recheck that the collectors really are off before retrying.

**Expected duration ~80–90 s.** Measured on this host: root disk reads at
1.5 GB/s but the volume writes at 307 MB/s, so the volume is the ceiling and
24 GB ÷ 307 MB/s dominates. There is nothing to tune — larger block sizes, `dd`
or parallel splits can't beat a throughput limit.

## Step 6 — Verify before re-pointing anything

The primary check is `cmp`: it proves the copy is byte-identical to the source,
which is a **stronger** guarantee than `integrity_check` — that only says "this
is a valid database", not "this is *your* database". It's also cheaper: one read
pass (~80–90 s, bounded by the volume's 319 MB/s read) versus `integrity_check`
reading all 24 G back *and* walking every b-tree, which takes several minutes.

```bash
time cmp "$OLD_STATS/playertracker.db" "$NEW_STATS/playertracker.db" && echo IDENTICAL
```

Then the cheap structural and content checks:

```bash
du -sh "$OLD_STATS" "$NEW_STATS"
ls -la "$NEW_STATS"
sqlite3 "$NEW_STATS/playertracker.db" "SELECT COUNT(*) FROM Players;"
sqlite3 "$NEW_STATS/playertracker.db" "SELECT MAX(LastSeen) FROM Players;"
```

**Don't `chown`.** `cp -a` already preserved ownership, and the correct state is
*not* `1000:1000` throughout — the directory, `assets/` and `hello` are
`root:1000` with mode `2777` (setgid, world-writable), and only
`playertracker.db` is `1000:1000`. Forcing `chown -R 1000:1000` would make the
new PVC differ from the known-good original. Compare instead:

```bash
diff <(cd "$OLD_STATS" && find . -maxdepth 1 -printf '%P %m %u:%g\n' | sort) \
     <(cd "$NEW_STATS" && find . -maxdepth 1 -printf '%P %m %u:%g\n' | sort) \
  && echo "OWNERSHIP AND MODES MATCH"
```

**No `quick_check` here, deliberately.** Measured on this database the copy took
**1m18s** while `quick_check` was still running after **5 minutes** — it
validates every page and thrashes SQLite's page cache against a 24 G file, so it
scales far worse than a linear read. It also adds nothing: the copy is taken
with writers stopped and a checkpointed WAL, and `cmp` proves the result is
byte-identical to a database that was already valid.

Reach for `quick_check` or `integrity_check` only if `cmp` reports a difference
and you're diagnosing what went wrong.

`cmp` must report nothing (identical), the ownership `diff` must be clean, sizes
must match, `assets/` must be present, and `MAX(LastSeen)` should be recent.
**If any of those fail, stop** — the old PVC is still live and the app is still
serving off it, so set the flag back to `false` and you're back to normal with
nothing lost.

## Step 7 — Re-point the remaining manifests

Neo4j's claim changed in Step 3. Three references left:

| file | line | from | to |
|---|---|---|---|
| `deploy/app/deployment.yaml` | 217 | `bf42-stats-pvc` | `bf42-stats-pvc-v2` |
| `deploy/app/deployment.yaml` | 490 | `bf42-stats-pvc` | `bf42-stats-pvc-v2` |
| `deploy/app/filebrowser-deployment.yaml` | 55 | `bf42-stats-pvc` | `bf42-stats-pvc-v2` |

```bash
sed -i 's/claimName: bf42-stats-pvc$/claimName: bf42-stats-pvc-v2/' \
  deploy/app/deployment.yaml deploy/app/filebrowser-deployment.yaml
grep -rn 'claimName:' deploy/app/
```

`DB_PATH` and `ASSETS_STORAGE_PATH` don't change — `mountPath` stays `/mnt/data`,
only the claim behind it moves.

## Step 8 — Cut over

This is the only interruption in the whole migration: one pod restart as it
swaps to the new claim. Applying the manifest also clears the
`kubectl set env` override, so collectors come back on automatically — the
manifest value is `"false"`.

```bash
kubectl --context hetzner delete -f deploy/volume-migration/pvc-v2-primer-pods.yaml
kubectl --context hetzner apply -f deploy/app/deployment.yaml
kubectl --context hetzner apply -f deploy/app/filebrowser-deployment.yaml
kubectl --context hetzner rollout status deployment/bf42-stats -n bf42-stats --timeout=300s
```

Confirm it's on the new claim and healthy:

```bash
kubectl --context hetzner describe pod -l app=bf42-stats -n bf42-stats | grep -A2 ClaimName
kubectl --context hetzner logs deployment/bf42-stats -n bf42-stats --tail=50
```

Then exercise the site: a database-backed page, an `assets/`-backed image, and a
graph-backed page. Confirm new records are being collected again.

---

## Rollback

The old PVCs are intact and still bound. To go back, revert the `claimName`
edits and re-apply:

```bash
git checkout deploy/app/deployment.yaml deploy/app/filebrowser-deployment.yaml
kubectl --context hetzner apply -f deploy/app/deployment.yaml
kubectl --context hetzner apply -f deploy/app/filebrowser-deployment.yaml
kubectl --context hetzner rollout status deployment/bf42-stats -n bf42-stats --timeout=300s
```

Any records collected since the cutover are lost on rollback — they were written
to the new PVC. That window is the reason to verify thoroughly at Step 6, before
the cutover, rather than after collection resumes.

Note the same applies in the other direction: writes the API served between
Step 5's copy and Step 8's cutover landed on the *old* PVC and aren't in the
copy. Collectors are off so it's not playerobservations, but an asset upload or
admin action in that window would be. Keep the gap short.

## Cleaning up the old PVCs

Only once you're confident. **Patch the reclaim policy first** — both old PVs are
`Delete` and the provisioner's teardown is `rm -rf "${VOL_DIR}"`, so deleting the
PVC erases 24 G immediately:

```bash
for c in bf42-stats-pvc neo4j-pvc; do
  kubectl --context hetzner patch pv \
    $(kubectl --context hetzner get pvc $c -n bf42-stats -o jsonpath='{.spec.volumeName}') \
    -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
done
```

With `Retain`, deleting the PVC orphans the directory instead of erasing it, and
you can `rm -rf` it yourself once certain. Also remove the PVC definitions from
`deployment.yaml` so a future apply doesn't recreate them.

---

## Appendix A — Routine backups (after migration)

Once live data is on the volume, nothing backs it up. Hetzner doesn't image
volumes and they have no snapshot capability.

**SQLite, no outage.** `sqlite3 .backup` will never finish here — the online
backup API restarts from page one whenever an external connection writes, and
playerobservation inserts never pause long enough. Stop the collectors instead:

```bash
kubectl --context hetzner set env deployment/bf42-stats -n bf42-stats DISABLE_BACKGROUND_PROCESSING=true
kubectl --context hetzner rollout status deployment/bf42-stats -n bf42-stats --timeout=180s
kubectl --context hetzner logs deployment/bf42-stats -n bf42-stats | grep DISABLE_BACKGROUND_PROCESSING
```

Expect `[startup] DISABLE_BACKGROUND_PROCESSING=true — background data services
will NOT be registered`. **If that line is absent, stop** — the rollout didn't
land, or the image predates the flag.

On the server, with a torn-copy guard (the API still serves HTTP and could
trigger a checkpoint mid-copy, which produces a structurally invalid file rather
than a merely stale one):

```bash
DB="$NEW_STATS/playertracker.db"
sqlite3 "$DB" "PRAGMA busy_timeout=30000; PRAGMA wal_checkpoint(TRUNCATE);"
# expect 0|0|0 — a leading 1 means a reader blocked it and nothing was written

before=$(stat -c '%Y %s' "$DB")
cp "$DB" /mnt/bfstats-data/backups/playertracker-$(date +%F).db
after=$(stat -c '%Y %s' "$DB")
[ "$before" = "$after" ] && echo CLEAN || echo "SOURCE CHANGED — discard and redo"

sqlite3 /mnt/bfstats-data/backups/playertracker-$(date +%F).db "PRAGMA integrity_check;"
```

Restore collectors:

```bash
kubectl --context hetzner set env deployment/bf42-stats -n bf42-stats DISABLE_BACKGROUND_PROCESSING=false
kubectl --context hetzner rollout status deployment/bf42-stats -n bf42-stats --timeout=180s
```

**Neo4j, short degradation.** No online backup in Community, so stop it — but
leave the app running:

```bash
kubectl --context hetzner scale deployment/neo4j -n bf42-stats --replicas=0
kubectl --context hetzner wait --for=delete pod -l app=neo4j -n bf42-stats --timeout=120s
tar -C "$NEW_NEO4J" -czf /mnt/bfstats-data/backups/neo4j-$(date +%F).tar.gz .
kubectl --context hetzner scale deployment/neo4j -n bf42-stats --replicas=1
```

`databases/` **and** `transactions/` — dropping the tx logs loses every committed
write not yet flushed to the store.

**Get them off the server.** Backups on the same volume as the live data protect
against very little:

```bash
scp -i ~/.ssh/hetzner root@77.42.38.148:/mnt/bfstats-data/backups/* ~/bfstats-backups/
```

---

## Gotchas

- **Don't run a Jenkins deploy during any of this.** Re-applying the manifests
  mid-migration re-points claims at the wrong moment, and wipes any
  `kubectl set env` override.
- **The old PVCs stay bound until you delete them**, holding ~26 G on the boot
  disk. That's intentional during the rollback window.
- **`sqlite-browser` and `filebrowser` both mount `bf42-stats-pvc`.** Both
  normally sit at `replicas: 0` — confirm before Step 4 if you've used them.
