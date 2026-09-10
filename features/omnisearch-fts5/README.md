# Omnisearch — FTS5 trigram index

A dedicated, disposable search index for players, servers and maps. Replaces the
`LIKE '%query%'` scans behind `/stats/Players/search` and `/stats/servers/search`.

Status: **design + measured prototype**. Not implemented.

---

## Why

Two problems, one of which is a correctness bug rather than a performance one.

### 1. 1,064 players cannot be found at all

Names are stored as raw mojibake and decoded only for display (see the rendering
rules in `CLAUDE.md`). A player rendered as `ДУШНИЛА` is stored — and therefore
matched — as `ÄÓØÍÈËÀ`. The user types what the page showed them, and
`Name LIKE '%ДУШНИЛА%'` matches nothing.

Measured against the production snapshot (`bfstats-sqlite-20260907-100305.db`):

| | count | share |
|---|---|---|
| players (non-bot) | 47,357 | |
| stored name ≠ displayed name | **1,064** | **2.2%** |
| servers with mojibake names | 0 | 0% |

Recall over a 400-player mojibake sample, searching by the **displayed** name:

| engine | found |
|---|---|
| `LIKE '%q%'` (today) | **0 / 400 (0%)** |
| FTS5 trigram | **399 / 400 (100%)** |

This is not tunable. No index or query rewrite fixes it, because the predicate is
being applied to a different string than the one the user was shown. It needs a
second, derived representation to match against — which is what an index is for.

### 2. Every keystroke is a full table scan

[`PlayerStatsService.SearchPlayersAsync`](../../api/Players/PlayerStatsService.cs:950)
uses `EF.Functions.Like(p.Name, $"%{trimmed}%")`. The leading wildcard is
unindexable, so each call scans all 47k rows — twice, because `CountAsync()` runs
the same predicate again for the pagination total.
[`MmOmnisearchModal`](../../ui/src/components/v4/MmOmnisearchModal.vue:241) fires
two of these per debounced keystroke.

Maps are not searchable at all, and the omnisearch hardcodes `game=bf1942`.

---

## Measured prototype

Built from the production snapshot. Scripts in the scratchpad; numbers reproduced
below.

| metric | value |
|---|---|
| documents (47,357 players + 688 servers + 1,946 maps) | 49,991 |
| **index size on disk** | **5.8 MB** |
| **full rebuild from source** | **0.5 s** |

Query latency, median of 15 runs, warm page cache, local NVMe:

| query | `LIKE` | FTS5 | speedup |
|---|---|---|---|
| `ska` | 6.82 ms | 0.03 ms | 256× |
| `skandia` | 6.77 ms | 0.03 ms | 195× |
| `dog` | 6.52 ms | 0.04 ms | 166× |
| `wake` | 6.24 ms | 0.02 ms | 263× |
| `berlin` | 6.47 ms | 0.04 ms | 157× |
| `sniper` | 7.08 ms | 0.06 ms | 121× |

> The `LIKE` column is measured on a local NVMe with a warm cache. Production runs
> the same scan against the network-attached volume, so treat these as a floor,
> not a prediction.

---

## Design

### Storage

A standalone `search.db`, **not** a table inside `playertracker.db`. It is
100% derived state and should never be backed up, migrated, or restored.

`hostPath: /opt/bfstats-search`, following the precedent already set by Seq at
[`/opt/seq`](../../deploy/app/seq-deployment.yaml:55).

Note that `storageClassName: local-path` does **not** mean the local disk — the
provisioner's default directory was repointed to `/mnt/bfstats-data` during the
volume migration ([BACKUP_RUNBOOK.md:48](../../deploy/volume-migration/BACKUP_RUNBOOK.md:48)).
A PVC would land the index back on the network volume. `hostPath` is deliberate.

### Rebuild strategy: full swap, no incremental sync

At 0.5 s for a complete rebuild there is no reason to maintain the index
incrementally. A hosted service rebuilds into `search.db.tmp` on a timer and
`rename(2)`s it over the live file. Readers open a fresh connection per rebuild
generation.

This eliminates the entire class of bugs that incremental indexing invites —
drift, missed invalidations, partial failures. Worst case the index is one
interval stale, and a stale search result is not a correctness problem.

Suggested interval: 5 minutes. Cost is ~0.5 s of one core plus a scan of
`Players`/`Servers`/`Rounds` — none of which touch `PlayerObservations`.

### Schema

```sql
CREATE TABLE docs (
    id        INTEGER PRIMARY KEY,
    kind      TEXT NOT NULL,   -- 'player' | 'server' | 'map'
    ident     TEXT NOT NULL,   -- RAW name / guid — the identifier to route on
    display   TEXT NOT NULL,   -- decoded, for rendering
    rank_hint INTEGER NOT NULL,
    extra     TEXT             -- GameId for servers
);

CREATE VIRTUAL TABLE docs_fts USING fts5(
    terms, content='', tokenize='trigram'
);

CREATE INDEX ix_kind_rank ON docs(kind, rank_hint DESC);
CREATE INDEX ix_display   ON docs(display COLLATE NOCASE);   -- short-query fallback
```

`terms` holds every searchable spelling of one entity, separated by a character
that cannot appear in a name:

1. the raw stored name (the PK)
2. `PlayerNameDecoder.Decode(name)` — what the user sees and types
3. the decoded name with clan tags stripped (`[TAG]`, `=TAG=`, `-TAG-`, `{TAG}`, `<TAG>`, `|TAG|`)
4. the raw name with clan tags stripped

`ident` is always the **raw** name. The CLAUDE.md rule holds: decode for display,
never for routing, keys, or comparison against stored values. Search results route
on `ident` and render `display`.

Worth adding later: known aliases from `features/player-alias-detection` as
additional `terms` entries, which would make alias search work for free.

### Ranking

`ORDER BY` a blend, not the current two-level sort:

- exact match on `display` or `ident` first
- then prefix match
- then `rank_hint` desc — `TotalPlayTimeMinutes` for players; for servers,
  `(IsOnline ? 1e6 : 0) + CurrentNumPlayers * 1000`, so a live busy server
  outranks a dead one; round count for maps

### One API call, not two

A single `GET /stats/search?q=` returns all three kinds ranked together, replacing
the two parallel fetches in `MmOmnisearchModal`. Maps become searchable; the
`game=bf1942` hardcode goes away and becomes an optional filter.

---

## Known limitation: queries shorter than 3 characters

FTS5's trigram tokenizer cannot match fewer than 3 characters. It does not error —
it silently returns nothing:

| query | FTS5 hits |
|---|---|
| `r` | 0 |
| `ru` | 0 |
| `rus` | 206 |
| `xX` | 0 |
| `xXx` | 42 |

**This must be handled explicitly or 1–2 character searches will look broken.**
Route queries under 3 characters to a prefix lookup against `ix_display`
(`WHERE display LIKE 'q%'`, which *is* indexable), and only use `docs_fts MATCH`
at 3+. The UI already debounces, so the branch is cheap.

---

## Dependencies

None. `SQLitePCLRaw.bundle_e_sqlite3` 2.1.13 (already in
[`api.csproj`](../../api/api.csproj:41)) ships FTS5 with the trigram tokenizer
compiled in. Verified:

```bash
sqlite3 :memory: "create virtual table t using fts5(x, tokenize='trigram'); insert into t values('=DOG=Skandia'); select * from t where x match 'kand';"
```

No new container, no new memory limit, no new failure mode — which matters,
because the node has **765Mi** of headroom against the ~1.5Gi floor CLAUDE.md asks
to preserve (memory limits across `deploy/app/` already sum to 6976Mi of 7741Mi).

**Gotcha:** [`SqliteConnectionInterceptor`](../../api/PlayerTracking/SqliteConnectionInterceptor.cs)
applies to *every* connection in the process. `search.db` needs its own connection
factory, or it inherits pragmas sized for a 24GB database.

### Rejected: Meilisearch / Typesense

Meilisearch would add real typo tolerance (`skandai` → `Skandia`) and is
mmap-backed, so it is the right *shape* for this node. But it is ~100–200Mi that
the memory budget does not have, to serve a 5.8 MB corpus. Revisit only if fuzzy
matching becomes a real user complaint.

Typesense is ruled out regardless — it holds its index in RAM by design, which is
the worst possible shape for a node with 765Mi spare.

---

## Tasks

- [ ] `SearchIndexBuilder` — reads `Players`/`Servers`/`Rounds`, writes `search.db.tmp`, atomic rename
- [ ] Hosted service on a 5-minute timer; build once at startup before readiness
- [ ] Dedicated connection factory for `search.db` (bypass `SqliteConnectionInterceptor`)
- [ ] `GET /stats/search?q=&kind=&game=` — unified, ranked, with the <3-char prefix fallback
- [ ] Port `PlayerNameDecoder` variants + clan-tag stripping into the builder
- [ ] Point `MmOmnisearchModal` at the single endpoint; add map results
- [ ] `hostPath: /opt/bfstats-search` volume in `deploy/app/deployment.yaml`
- [ ] Keep `LIKE` search as a fallback path if `search.db` is missing or stale beyond N minutes
- [ ] E2E: assert a mojibake player is findable by its decoded name
