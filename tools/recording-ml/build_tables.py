#!/usr/bin/env python3
"""The exported tables as Parquet, with the stored splits.

    <venv>/bin/python tools/recording-ml/build_tables.py [--data ~/.cache/bfstats-recml]

Reads `<data>/tables/<slug>/<table>.jsonl` (export_recording_tables.mjs,
flatten_tank_fights.py) and writes `<data>/parquet/<table>.parquet`, one file
a table, every row keyed by its recording's `slug`. The `recordings` table
carries each file's content hash and the versions its rows were made under
(export, encounter rules, dogfight rules, manoeuvre rules, catalogue, commit),
so a row's provenance is one join away.

`splits.parquet` is how any model here is validated: one row a round and one
row a player key, each with `fold5`, a fold from a hash of the id. A hash
never changes as recordings are added, so yesterday's test rows are not
tomorrow's training rows. Leave-one-out by round or by player needs no table:
it is the id itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import duckdb

from common import data_dir

TABLES = ["recordings", "players", "kills", "tickets", "captures", "accuracy",
          "air_fights", "air_encounters", "air_ticks", "tank_fights", "tank_shots"]


def fold5(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:8], 16) % 5


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data")
    args = parser.parse_args()
    data = data_dir(args.data)
    out = data / "parquet"
    out.mkdir(parents=True, exist_ok=True)
    db = duckdb.connect()
    counts = {}
    for table in TABLES:
        files = [str(p) for p in sorted((data / "tables").glob(f"*/{table}.jsonl")) if p.stat().st_size > 0]
        target = out / f"{table}.parquet"
        if not files:
            target.unlink(missing_ok=True)
            counts[table] = 0
            continue
        db.execute(
            f"COPY (SELECT * FROM read_json(?, format = 'newline_delimited', union_by_name = true, sample_size = -1)) "
            f"TO '{target}' (FORMAT parquet, COMPRESSION zstd)", [files]).fetchall()
        counts[table] = db.execute(f"SELECT count(*) FROM '{target}'").fetchall()[0][0]

    db.create_function("fold5", fold5, ["VARCHAR"], "INTEGER")
    rec, players = out / "recordings.parquet", out / "players.parquet"
    db.execute(
        f"COPY (SELECT 'round' AS kind, round AS id, fold5(round) AS fold5 FROM '{rec}' GROUP BY round "
        f"UNION ALL SELECT 'player', player, fold5(player) FROM '{players}' WHERE player IS NOT NULL AND NOT ai GROUP BY player "
        f"ORDER BY 1, 2) TO '{out / 'splits.parquet'}' (FORMAT parquet)").fetchall()
    counts["splits"] = db.execute(f"SELECT count(*) FROM '{out / 'splits.parquet'}'").fetchall()[0][0]
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
