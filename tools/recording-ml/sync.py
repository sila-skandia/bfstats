#!/usr/bin/env python3
"""Fetch the public round recordings into the local research store.

    python3 tools/recording-ml/sync.py [--data ~/.cache/bfstats-recml] [--api https://bfstats.io]

Reads the replay feed (`GET /stats/recordings`, features/replay-feed), keeps
`<data>/raw/<slug>.ndjson.gz` for every recording it lists and writes
`<data>/raw/manifest.json` (and `feed.json`, the same rows as the fight
extractors read them): one row a recording with its content hash (SHA-256
of the unpacked file), its round (the feed's card), and whether it is the
round's lead recording. The lead is the server's recording when the round has
one, else the card's own (the longest).

Incremental: a file already here whose size matches the server's
`Content-Length` is kept and not fetched again. A recording the feed no longer
lists is removed, with its tables, so a deletion on the site is honoured here.

Reading the public feed only. Nothing is uploaded. The manifest holds no
player or uploader name. Standard library only.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from common import data_dir

PAGE_SIZE = 48  # the feed's most; a larger value falls back to 24
AGENT = "bfstats-recording-ml/1 (local research; features/recording-ml)"


def fetch(url: str, method: str = "GET"):
    request = urllib.request.Request(url, method=method, headers={"User-Agent": AGENT, "Accept-Encoding": "gzip"})
    return urllib.request.urlopen(request, timeout=120)


def feed_cards(api: str) -> tuple[list[dict], dict]:
    cards: list[dict] = []
    envelope: dict = {}
    page = 1
    while True:
        with fetch(f"{api}/stats/recordings?pageSize={PAGE_SIZE}&sort=recent&page={page}") as response:
            body = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
        envelope = json.loads(body)
        cards.extend(envelope.get("items") or [])
        if page >= int(envelope.get("totalPages") or 1):
            return cards, envelope
        page += 1


def recordings_of(cards: list[dict]) -> list[dict]:
    """One row a recording: the card's own, then the other members of its round."""
    rows: dict[str, dict] = {}
    for card in cards:
        members = [{"slug": card["slug"], "source": card.get("source"), "duration": card.get("durationSeconds")}]
        for member in card.get("round") or []:
            if member["slug"] != card["slug"]:
                members.append({"slug": member["slug"], "source": member.get("source"), "duration": member.get("durationSeconds")})
        lead = next((m["slug"] for m in members if m["source"] == "server"), card["slug"])
        for member in members:
            rows.setdefault(member["slug"], {
                "slug": member["slug"],
                "round": card["slug"],
                "lead": member["slug"] == lead,
                "source": member["source"],
                "mod": card.get("mod"),
                "level": card.get("level"),
                "mode": card.get("gameMode"),
                "server": card.get("serverName"),
                "recorded_local": card.get("recordedLocal"),
                "duration": member["duration"],
                "stats_round_id": card.get("statsRoundId"),
            })
    return list(rows.values())


def unpacked_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with gzip.open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data")
    parser.add_argument("--api", default="https://bfstats.io")
    args = parser.parse_args()
    data = data_dir(args.data)
    raw = data / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    manifest_file = raw / "manifest.json"
    before = {r["slug"]: r for r in json.loads(manifest_file.read_text())["recordings"]} if manifest_file.exists() else {}

    cards, envelope = feed_cards(args.api)
    rows = recordings_of(cards)
    kept = fetched = 0
    for row in rows:
        path = raw / f"{row['slug']}.ndjson.gz"
        url = f"{args.api}/stats/recordings/{row['slug']}.ndjson"
        with fetch(url, "HEAD") as head:
            stored = head.headers.get("Content-Encoding") == "gzip"
            length = int(head.headers.get("Content-Length") or -1)
        if path.exists() and stored and path.stat().st_size == length:
            kept += 1
        else:
            with fetch(url) as response:
                body = response.read()
                if response.headers.get("Content-Encoding") != "gzip":
                    body = gzip.compress(body, 6)
            part = path.with_suffix(".part")
            part.write_bytes(body)
            part.replace(path)
            fetched += 1
            before.pop(row["slug"], None)
        row["bytes"] = path.stat().st_size
        old = before.get(row["slug"])
        row["content_hash"] = old["content_hash"] if old and old.get("bytes") == row["bytes"] else unpacked_hash(path)

    listed = {row["slug"] for row in rows}
    removed = []
    for path in raw.glob("*.ndjson.gz"):
        slug = path.name.removesuffix(".ndjson.gz")
        if slug not in listed:
            path.unlink()
            shutil.rmtree(data / "tables" / slug, ignore_errors=True)
            removed.append(slug)

    # The feed in the shape the fight extractors read (`--feed`): no names.
    (raw / "feed.json").write_text(json.dumps([
        {"slug": r["slug"], "mod": r["mod"], "level": r["level"], "recordedLocal": r["recorded_local"],
         "serverName": r["server"], "source": r["source"]} for r in rows]))
    manifest_file.write_text(json.dumps({
        "synced_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "api": args.api,
        "cards": envelope.get("totalCount"),
        "recordings": rows,
    }, indent=1))
    print(json.dumps({"recordings": len(rows), "rounds": len({r['round'] for r in rows}), "kept": kept, "fetched": fetched,
                      "removed": removed, "bytes": sum(r["bytes"] for r in rows)}), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
