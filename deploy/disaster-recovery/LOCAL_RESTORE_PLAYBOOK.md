# Restoring a Production Backup Locally

How to load the production SQLite database and Neo4j graph into a local dev
environment. This is the format the `bfstats-backup-both` runbook in
home-server-mgr produces on every production backup.

For recovering a *corrupt* production database in-cluster, see
`SQLITE_RECOVERY_PLAYBOOK.md` instead.

---

## The Two Artifacts

| File | Format | Size (approx) |
|------|--------|---------------|
| `bfstats-sqlite-latest.db` | Plain SQLite file, `journal_mode=wal` | ~25 GB |
| `bfstats-neo4j-latest.tar` | Raw tar of the Neo4j container's `/data` directory | ~3.6 GB |

Both are gitignored (`bfstats-sqlite-*.db`, `bfstats-neo4j-*.tar`).

**The Neo4j tar is not a `neo4j-admin dump`.** It is a filesystem-level copy of
`/data`, containing `databases/`, `transactions/`, `dbms/` and `server_id`.
`neo4j-admin load` will reject it. Restore it by extracting into the data volume
with the container stopped.

---

## Step 1: Check for Migration Drift

The restored database carries its own `__EFMigrationsHistory`. Compare it to the
repo before swapping, so you find out now rather than at startup.

```bash
sqlite3 -readonly bfstats-sqlite-latest.db "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 5;"
ls api/Migrations/*.cs | grep -vE 'Designer|Snapshot' | sed 's|.*/||' | sort -r | head -5
```

If the repo has migrations the backup does not, run `dotnet ef database update`
after the swap. If the backup is *ahead* of the repo, you are on a stale branch.

---

## Step 2: Swap the SQLite Database

Local dev reads `DB_PATH`, falling back to `playertracker.db` in the current
working directory (`api/Program.cs`). `dotnet run` from `api/` therefore uses
`api/playertracker.db` — that is the one to replace.

```bash
mv api/playertracker.db api/playertracker.db.old
mv bfstats-sqlite-latest.db api/playertracker.db
```

Keep both on the same filesystem so these are instant metadata renames rather
than a 25 GB copy. Note that `mv` consumes the download; use `cp` if you want to
keep a pristine copy, and budget the disk for it.

Check for stray `playertracker.db-wal` / `-shm` files first. A leftover WAL from
the *previous* database applied to a *new* one is a corruption hazard — delete
them if present.

Verify:

```bash
sqlite3 api/playertracker.db "PRAGMA journal_mode;"
sqlite3 api/playertracker.db "
SELECT 'Players', COUNT(*) FROM Players
UNION ALL SELECT 'Servers', COUNT(*) FROM Servers
UNION ALL SELECT 'PlayerSessions', COUNT(*) FROM PlayerSessions
UNION ALL SELECT 'Rounds', COUNT(*) FROM Rounds;"
sqlite3 api/playertracker.db "SELECT MAX(StartTime) FROM PlayerSessions;"
```

---

## Step 3: Match the Neo4j Version First

**Neo4j reads store formats forward only.** The tar carries a store and
transaction log written by whatever version production runs, and an older local
Neo4j cannot open it. Booting a 5.26 store on 5.15 fails with:

```
Caused by: java.lang.IllegalArgumentException: Unknown serialization format version: 0
	at org.neo4j.storageengine.api.StoreIdSerialization.deserialize(...)
```

Before restoring, confirm the image in `docker-compose.dev.yml` matches the one
in `deploy/app/deployment.yaml`. Both should be `neo4j:5-community`. Check what
that tag currently resolves to:

```bash
docker run --rm --entrypoint sh neo4j:5-community -c 'ls /var/lib/neo4j/lib/neo4j-kernel-*.jar'
```

If a restore ever fails on store format again, this is the first thing to check.

---

## Step 4: Extract into the Neo4j Volume

The volume is `bfstats_neo4j-data` — Compose derives the prefix from the
directory name, so a differently-named worktree gets a differently-named volume.
Confirm with `docker volume ls | grep neo4j-data`.

```bash
# Nothing may be running against the volume
docker compose -f docker-compose.dev.yml stop neo4j

# Optional: snapshot the current graph so the restore is reversible
docker run --rm -v bfstats_neo4j-data:/from:ro -v bfstats_neo4j-data-pre-restore:/to \
  alpine sh -c 'cp -a /from/. /to/'

# Wipe and extract; -p preserves the 7474:7474 ownership Neo4j requires
docker run --rm \
  -v bfstats_neo4j-data:/data \
  -v "$PWD":/backup:ro \
  alpine sh -c 'set -e; find /data -mindepth 1 -delete; tar -xpf /backup/bfstats-neo4j-latest.tar -C /data'

docker compose -f docker-compose.dev.yml up -d neo4j
```

Extract as root (the `alpine` default) so `-p` can actually apply the uid/gid.
Running as your own user silently leaves the store owned by you, and Neo4j fails
to write.

---

## Step 5: Verify the Graph

```bash
docker exec bf1942-neo4j cypher-shell -u neo4j -p bf1942stats --format plain \
  "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC;"

docker exec bf1942-neo4j cypher-shell -u neo4j -p bf1942stats --format plain \
  "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC;"

# Every index should report ONLINE
docker exec bf1942-neo4j cypher-shell -u neo4j -p bf1942stats --format plain \
  "SHOW INDEXES YIELD name, state RETURN name, state;"
```

Expect `Player`, `Server`, `Community` and `MigrationTracker` nodes, joined by
`PLAYED_WITH` and `PLAYS_ON`.

---

## Step 6: Check the Sync Backlog

The two artifacts are snapshotted minutes apart, so the SQLite side is slightly
ahead of the graph. The watermark is a column, not a table — `SyncedToNeo4jAt`
on `Rounds` and `PlayerSessions` (migration `AddNeo4jSyncWatermarks`).

```bash
sqlite3 -readonly api/playertracker.db "
SELECT 'Rounds pending',   COUNT(*) FROM Rounds         WHERE SyncedToNeo4jAt IS NULL
UNION ALL SELECT 'Sessions pending', COUNT(*) FROM PlayerSessions WHERE SyncedToNeo4jAt IS NULL;"
```

A few thousand pending rows is the normal gap between the two snapshots; the
sync service absorbs it on its next pass. Hundreds of thousands means the
artifacts are from different days and the graph is genuinely behind.

---

## Gotchas

**Credentials come from the tar, not the environment.** `NEO4J_AUTH` is only
applied when `/data` is empty at first start. A restored `/data` brings
production's `dbms/auth.ini` and its `system` database, so the graph keeps
production's password. Today `deploy/app/deployment.yaml` and
`docker-compose.dev.yml` both use `neo4j/bf1942stats`, so this is invisible — if
they ever diverge, local auth will fail until you set the password to match the
restored store.

**Plugins are not in the tar.** Production sets `NEO4J_PLUGINS=["apoc"]`; the dev
compose does not. Restored data does not carry plugins, so any query using APOC
procedures will fail locally until the dev service declares them too.

**There are decoy databases.** Because the path falls back to the working
directory, running the API from the repo root creates a near-empty
`playertracker.db` there (and `ui/playertracker.db` likewise). These are small
enough to look harmless in `ls` and will silently serve a few hundred players
instead of tens of thousands. Set `DB_PATH` explicitly if you launch from
anywhere but `api/`.

**Do not point E2E at the restored database.** E2E uses its own slim copy under
`.e2e/run/` seeded by `E2eDatabaseSeed`; see `scripts/e2e-env.sh`. The fixture
workflow is separate — `mise run e2e-fixture` and `mise run e2e-graph`.

---

## Cleanup

After confirming the restore works:

```bash
rm api/playertracker.db.old
rm bfstats-neo4j-latest.tar          # already consumed by the extract
docker volume rm bfstats_neo4j-data-pre-restore
```

The SQLite download no longer exists as a separate file once you `mv` it into
place. Re-restoring means re-downloading it.
