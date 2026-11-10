#!/usr/bin/env python3
"""Is there enough yet? The corpus against the resume triggers.

    <venv>/bin/python tools/recording-ml/status.py [--data ~/.cache/bfstats-recml]

Counts what the parked work in features/recording-ml waits for, over the lead
recording of each round, and says which triggers are met. Writes
`<data>/out/status.md` and `status.json`. The thresholds and what each one
unlocks are in that page's "Parked" section; change them there and here
together.
"""

from __future__ import annotations

import argparse
import json

from common import connect, data_dir, rows

# (key, what is counted, threshold, what meeting it unlocks)
TRIGGERS = [
    ("server_rounds", "server recordings of a round with 16 or more human players, 10 minutes or longer", 1,
     "check the hit and first-shot inference against the server's own rows; both sides seen; re-run everything on it"),
    ("air_decided", "air encounters decided by a kill between the two", 500,
     "the approach model with more than three features and by plane type"),
    ("air_decided_20s", "of those, with both planes recorded 20 s before the first shot", 150,
     "settle the early-energy finding (an interval of about 8 points either way)"),
    ("air_pair_decided", "decided air encounters of the most common plane pair", 100, "plane-pair tables"),
    ("air_pilots_12", "pilots with 12 or more decided air encounters", 20, "an engagement rating as a covariate"),
    ("air_fight_hours", "hours inside detected air fights", 100, "a sequence model of flying; not before"),
    ("tank_decided", "tank fights decided by a kill between the two", 800, "tank findings split by weight-class match-up; start the line-of-sight work"),
    ("map_rounds", "decided conquest rounds on the most-recorded map", 20, "per-map tactics and tank positions (50 for a per-map win model)"),
    ("rounds_decided", "decided conquest rounds", 200, "a pooled win-probability model with map effects"),
]


def counts(db) -> dict:
    one = lambda sql: rows(db, sql)[0]["n"] or 0  # noqa: E731
    lead_air = "air_encounters e JOIN recordings r USING (slug) WHERE r.lead AND NOT e.ai0 AND NOT e.ai1"
    return {
        "recordings": one("SELECT count(*) n FROM recordings"),
        "rounds": one("SELECT count(DISTINCT round) n FROM recordings"),
        "hours": round(one("SELECT sum(duration) / 3600 n FROM recordings WHERE lead"), 1),
        "server_rounds": one("SELECT count(*) n FROM recordings WHERE lead AND source = 'server' AND humans >= 16 AND duration >= 600"),
        "air_encounters": one(f"SELECT count(*) n FROM {lead_air}"),
        "air_decided": one(f"SELECT count(*) n FROM {lead_air} AND e.kill_side IS NOT NULL"),
        "air_decided_20s": one(f"""
            SELECT count(*) n FROM (SELECT e.encounter FROM {lead_air} AND e.kill_side IS NOT NULL AND e.first_shot_side IS NOT NULL) d
            WHERE (SELECT count(DISTINCT t.side) FROM air_ticks t WHERE t.encounter = d.encounter AND abs(t.tr + 20) <= 0.15
                   AND t.live AND t.piloted AND t.speed >= 30) = 2"""),
        "air_pair_decided": one(f"""
            SELECT max(n) n FROM (SELECT count(*) n FROM {lead_air} AND e.kill_side IS NOT NULL
            GROUP BY least(e.plane0, e.plane1), greatest(e.plane0, e.plane1))"""),
        "air_pilots_12": one(f"""
            SELECT count(*) n FROM (SELECT p FROM (SELECT unnest([e.player0, e.player1]) p FROM {lead_air} AND e.kill_side IS NOT NULL)
            GROUP BY p HAVING count(*) >= 12)"""),
        "air_fight_hours": round(one("SELECT sum(f.t1 - f.t0) / 3600 n FROM air_fights f JOIN recordings r USING (slug) WHERE r.lead"), 2),
        "tank_decided": one("SELECT count(*) n FROM tank_fights f JOIN recordings r USING (slug) WHERE r.lead AND f.winner_side IS NOT NULL"),
        "map_rounds": one("""
            SELECT max(n) n FROM (SELECT count(*) n FROM recordings WHERE lead AND mode = 'conquest' AND winner IS NOT NULL GROUP BY mod, level)"""),
        "rounds_decided": one("SELECT count(*) n FROM recordings WHERE lead AND mode = 'conquest' AND winner IS NOT NULL"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data")
    args = parser.parse_args()
    data = data_dir(args.data)
    now = counts(connect(data))
    met = [key for key, _, need, _ in TRIGGERS if now[key] >= need]
    text = ["# Recording corpus against the resume triggers", "",
            f"{now['recordings']} recordings of {now['rounds']} rounds, {now['hours']} hours; {now['air_encounters']} air encounters.", "",
            "| Trigger | Now | Needed | Met | Unlocks |", "|---|---|---|---|---|"]
    for key, what, need, unlocks in TRIGGERS:
        text.append(f"| {what} | {now[key]} | {need} | {'yes' if key in met else 'no'} | {unlocks} |")
    text += ["", f"Triggers met: {', '.join(met) if met else 'none'}."]
    out = data / "out"
    out.mkdir(parents=True, exist_ok=True)
    (out / "status.json").write_text(json.dumps({"now": now, "met": met}, indent=1))
    (out / "status.md").write_text("\n".join(text))
    print("\n".join(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
