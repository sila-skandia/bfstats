#!/usr/bin/env python3
"""Withdraw a rollout acceptance the page did not bear out.

    withdraw.py <mod layers folder>/<level> "<why, with the page figures>"

Removes `accepted` from the layer's verdict.json and records `acceptanceWithdrawn`
with the reason and today's date, so the bake's gate closes and the next menu
publish drops the level's tag. The layer itself stays on the volume, unflagged.
"""
import datetime, json, subprocess, sys
from pathlib import Path

root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
folder, why = sys.argv[1], sys.argv[2]
p = root / "tools/bf1942-models/bot-layers" / folder / "verdict.json"
v = json.loads(p.read_text())
was = v.pop("accepted", None)
v["acceptanceWithdrawn"] = {"because": why, "date": datetime.date.today().isoformat(), **({"was": was.get("reason", "")[:80]} if was else {})}
p.write_text(json.dumps(v, indent=1) + "\n")
print(folder, "withdrawn:", why)
