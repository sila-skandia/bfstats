"""Shared by the recording-ml scripts: where the data is, the tables, intervals."""

from __future__ import annotations

import os
from pathlib import Path


def data_dir(arg: str | None = None) -> Path:
    """`--data`, else `$BFSTATS_RECML_DIR`, else `~/.cache/bfstats-recml`."""
    return Path(arg or os.environ.get("BFSTATS_RECML_DIR") or Path.home() / ".cache" / "bfstats-recml").expanduser()


def connect(data: Path):
    """A DuckDB connection with one view a Parquet table (build_tables.py)."""
    import duckdb

    db = duckdb.connect()
    for path in sorted((data / "parquet").glob("*.parquet")):
        db.execute(f"CREATE VIEW {path.stem} AS SELECT * FROM '{path}'").fetchall()
    return db


def rows(db, sql: str, params: list | None = None) -> list[dict]:
    cursor = db.execute(sql, params or [])
    names = [d[0] for d in cursor.description]
    return [dict(zip(names, r)) for r in cursor.fetchall()]


def share_ci(hits: list[bool], groups: list[str], draws: int = 2000, seed: int = 20261110) -> dict:
    """A share with a 95% interval from resampling whole groups (rounds).

    Fights of one round are not independent: the same few pilots meet again
    and again. Resampling rounds, not fights, keeps the interval honest.
    """
    import numpy as np

    n = len(hits)
    if n == 0:
        return {"k": 0, "n": 0, "share": None, "lo": None, "hi": None}
    hit = np.asarray(hits, dtype=float)
    ids = sorted(set(groups))
    index = {g: i for i, g in enumerate(ids)}
    k_by = np.zeros(len(ids))
    n_by = np.zeros(len(ids))
    for h, g in zip(hit, groups):
        k_by[index[g]] += h
        n_by[index[g]] += 1
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, len(ids), size=(draws, len(ids)))
    totals = n_by[pick].sum(axis=1)
    shares = k_by[pick].sum(axis=1) / np.where(totals > 0, totals, 1)
    lo, hi = np.percentile(shares[totals > 0], [2.5, 97.5])
    return {"k": int(hit.sum()), "n": n, "share": float(hit.mean()), "lo": float(lo), "hi": float(hi), "groups": len(ids)}


def fmt(ci: dict) -> str:
    """`81 of 122, 66% (58 to 74)`."""
    if not ci["n"]:
        return "none"
    return f"{ci['k']} of {ci['n']}, {100 * ci['share']:.0f}% ({100 * ci['lo']:.0f} to {100 * ci['hi']:.0f})"
