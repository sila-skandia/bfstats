#!/usr/bin/env python3
"""The air approach: what the state before the first shot says about who wins.

    <venv>/bin/python tools/recording-ml/approach_model.py [--data ~/.cache/bfstats-recml] [--chart out.png]

Reads `air_encounters`, `air_ticks` and `recordings` (build_tables.py) and
writes `<data>/out/approach.md` and `approach.json` (features/recording-ml,
"Trial run"). One recording a round (the lead), human pilots only.

What it reports:

1. The funnel: of the encounters, how many see an aimed shot, a fight the
   dogfight detector calls one, a kill between the two.
2. First to fire: what the first shooter's shot led to, with the passes where
   nobody died counted.
3. Lead times: `LEADS` seconds before the reference time (the first aimed
   shot), how often the eventual winner (and, on more rows, the eventual
   first shooter) had more energy height, and the smaller angle-off; and how
   often a first shooter with more energy, and with less, went on to kill. A
   state counts only when the recording has both planes live, flown and
   airborne there.
4. Models: a regularised logistic regression on the differences in energy,
   angle-off and speed, scored on rows it never saw, twice: leaving the
   row's round out, and leaving both of the row's pilots out.
5. All of it again without the pilot who is in the most encounters.

Every interval is a 95% cluster bootstrap over rounds (common.share_ci).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

from common import connect, data_dir, fmt, rows, share_ci

LEADS = [1, 2, 4, 6, 10, 15, 20]
MODEL_LEADS = [2, 5, 10, 15, 20]
AIRBORNE = 30.0  # m/s; slower is taxiing, parked or stalled on the ground
FEATURES = ["d_energy", "d_ata", "d_speed"]
SCALE = {"d_energy": 100.0, "d_ata": 90.0, "d_speed": 20.0}

STATES_SQL = """
WITH near AS (
  SELECT t.encounter, t.side, t.energy, t.ata, t.speed, t.y, t.range, t.closure,
         t.live AND t.piloted AND t.speed >= ? AS ok,
         row_number() OVER (PARTITION BY t.encounter, t.side ORDER BY abs(t.tr + ?)) AS pick
  FROM air_ticks t WHERE abs(t.tr + ?) <= 0.15
)
SELECT a.encounter, a.energy - b.energy AS d_energy, b.ata - a.ata AS d_ata, a.speed - b.speed AS d_speed,
       a.y - b.y AS d_height, a.range, a.closure
FROM near a JOIN near b ON a.encounter = b.encounter AND a.side = 0 AND b.side = 1
WHERE a.pick = 1 AND b.pick = 1 AND a.ok AND b.ok
"""


def load(db) -> list[dict]:
    return rows(db, """
        SELECT e.*, r.round, r.level, r.mod FROM air_encounters e JOIN recordings r USING (slug)
        WHERE r.lead AND NOT e.ai0 AND NOT e.ai1 ORDER BY e.encounter""")


def states(db, lead: float) -> dict[str, dict]:
    return {r["encounter"]: r for r in rows(db, STATES_SQL, [AIRBORNE, lead, lead])}


def for_side(state: dict, side: int) -> dict:
    """The differences as `side` has them: positive is that side's advantage."""
    sign = 1 if side == 0 else -1
    return {k: sign * state[k] for k in ("d_energy", "d_ata", "d_speed", "d_height")}


def lead_table(encounters: list[dict], by_lead: dict, label: str) -> list[dict]:
    """Per lead: how often the side `label` names had more energy, and the smaller angle-off."""
    out = []
    for lead in LEADS:
        energy, ata, height, groups = [], [], [], []
        for e in encounters:
            state = by_lead[lead].get(e["encounter"])
            if e[label] is None or state is None:
                continue
            mine = for_side(state, e[label])
            energy.append(mine["d_energy"] > 0)
            ata.append(mine["d_ata"] > 0)
            height.append(mine["d_height"] > 0)
            groups.append(e["round"])
        out.append({"lead": lead, "energy": share_ci(energy, groups), "ata": share_ci(ata, groups), "height": share_ci(height, groups)})
    return out


def conversion(shot: list[dict], by_lead: dict) -> list[dict]:
    """Of the first shooters, how many went on to kill, by who had the energy before the shot."""
    out = []
    for lead in (2, 6, 10):
        cells = {"more": ([], []), "less": ([], [])}
        for e in shot:
            state = by_lead[lead].get(e["encounter"])
            if state is None:
                continue
            mine = for_side(state, e["first_shot_side"])
            hits, groups = cells["more" if mine["d_energy"] > 0 else "less"]
            hits.append(e["kill_side"] == e["first_shot_side"])
            groups.append(e["round"])
        out.append({"lead": lead, "more": share_ci(*cells["more"]), "less": share_ci(*cells["less"])})
    return out


def design(encounters: list[dict], state_of: dict, label: str):
    """Each encounter twice, once from each side, so the model has no side to prefer."""
    X, y, group, pilots, ids = [], [], [], [], []
    for e in encounters:
        state = state_of.get(e["encounter"])
        if e[label] is None or state is None:
            continue
        for side in (0, 1):
            mine = for_side(state, side)
            X.append([mine[f] / SCALE[f] for f in FEATURES])
            y.append(1 if e[label] == side else 0)
            group.append(e["round"])
            pilots.append((e["player0"], e["player1"]))
            ids.append(e["encounter"])
    return np.array(X, dtype=float), np.array(y), group, pilots, ids


def held_out(X, y, train_masks) -> np.ndarray:
    """Each row's probability from a model fitted without that row's group."""
    p = np.full(len(y), np.nan)
    for test, train in train_masks:
        if train.sum() < 20 or len(set(y[train])) < 2:
            continue
        model = LogisticRegression(C=1.0, fit_intercept=False).fit(X[train], y[train])
        p[test] = model.predict_proba(X[test])[:, 1]
    return p


def score(y, p, group) -> dict:
    keep = ~np.isnan(p)
    y, p, group = y[keep], p[keep], [g for g, k in zip(group, keep) if k]
    if len(y) < 20 or len(set(y)) < 2:
        return {"n": int(len(y) // 2)}
    ids = sorted(set(group))
    index = np.array([ids.index(g) for g in group])
    rng = np.random.default_rng(20261110)
    aucs = []
    for _ in range(500):
        pick = rng.integers(0, len(ids), len(ids))
        rows_ = np.concatenate([np.flatnonzero(index == g) for g in pick])
        if len(set(y[rows_])) == 2:
            aucs.append(roc_auc_score(y[rows_], p[rows_]))
    lo, hi = np.percentile(aucs, [2.5, 97.5])
    return {"n": int(len(y) // 2), "accuracy": float(((p > 0.5) == (y == 1)).mean()), "log_loss": float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6))),
            "auc": float(roc_auc_score(y, p)), "auc_lo": float(lo), "auc_hi": float(hi)}


def models(encounters: list[dict], by_lead: dict, label: str) -> list[dict]:
    out = []
    for lead in MODEL_LEADS:
        X, y, group, pilots, _ = design(encounters, by_lead[lead], label)
        if len(y) < 40:
            out.append({"lead": lead, "n": int(len(y) // 2)})
            continue
        group_arr = np.array(group)
        by_round = [(group_arr == g, group_arr != g) for g in sorted(set(group))]
        # Both of the row's pilots out: no fight of either is in the training rows.
        pairs = sorted(set(pilots))
        by_pilots = []
        for pair in pairs:
            test = np.array([p == pair for p in pilots])
            train = np.array([not (set(p) & set(pair)) for p in pilots])
            by_pilots.append((test, train))
        full = LogisticRegression(C=1.0, fit_intercept=False).fit(X, y)
        rule = lambda col: float(((X[:, col] > 0) == (y == 1)).mean())  # noqa: E731
        out.append({"lead": lead, "round_out": score(y, held_out(X, y, by_round), group), "pilots_out": score(y, held_out(X, y, by_pilots), group),
                    "weights": dict(zip(FEATURES, [float(w) for w in full.coef_[0]])),
                    "rule_energy": rule(0), "rule_ata": rule(1)})
    return out


def analyse(encounters: list[dict], by_lead: dict) -> dict:
    groups = [e["round"] for e in encounters]
    shot = [e for e in encounters if e["first_shot_side"] is not None]
    decided = [e for e in encounters if e["kill_side"] is not None]
    shot_groups = [e["round"] for e in shot]
    funnel = {
        "encounters": len(encounters), "rounds": len(set(groups)),
        "pilots": len({p for e in encounters for p in (e["player0"], e["player1"])}),
        "a_shot": share_ci([e["first_shot_side"] is not None for e in encounters], groups),
        "a_fight": share_ci([e["fight"] is not None for e in encounters], groups),
        "a_kill": share_ci([e["kill_side"] is not None for e in encounters], groups),
        "decided_without_a_fight": sum(1 for e in decided if e["fight"] is None),
        "decided_without_a_shot": sum(1 for e in decided if e["first_shot_side"] is None),
        "died_to_another": sum(1 for e in encounters if e["other_death_side"] is not None and e["kill_side"] is None),
    }
    decided_shot = [e for e in decided if e["first_shot_side"] is not None]
    first = {
        "shooter_killed": share_ci([e["kill_side"] == e["first_shot_side"] for e in shot], shot_groups),
        "shooter_was_killed": share_ci([e["kill_side"] is not None and e["kill_side"] != e["first_shot_side"] for e in shot], shot_groups),
        "nobody_died": share_ci([e["kill_side"] is None for e in shot], shot_groups),
        "of_decided": share_ci([e["kill_side"] == e["first_shot_side"] for e in decided_shot], [e["round"] for e in decided_shot]),
        "of_decided_fights": share_ci([e["kill_side"] == e["first_shot_side"] for e in decided_shot if e["fight"]],
                                      [e["round"] for e in decided_shot if e["fight"]]),
    }
    return {
        "funnel": funnel, "first_to_fire": first,
        "winner_by_lead": lead_table(decided_shot, by_lead, "kill_side"),
        "first_shooter_by_lead": lead_table(shot, by_lead, "first_shot_side"),
        "conversion": conversion(shot, by_lead),
        "model_winner": models(decided_shot, by_lead, "kill_side"),
        "model_first_shot": models(shot, by_lead, "first_shot_side"),
    }


def lead_rows(table: list[dict]) -> list[str]:
    out = ["| Seconds before the first aimed shot | More energy height | Smaller angle-off | Higher |", "|---|---|---|---|"]
    for r in table:
        out.append(f"| {r['lead']} | {fmt(r['energy'])} | {fmt(r['ata'])} | {fmt(r['height'])} |")
    return out


def model_rows(table: list[dict]) -> list[str]:
    out = ["| Seconds before | Rows | Round left out: accuracy, log loss, AUC | Both pilots left out: accuracy, log loss, AUC | Rule: more energy | Rule: smaller angle-off |",
           "|---|---|---|---|---|---|"]
    for r in table:
        def cell(s: dict | None) -> str:
            if not s or "auc" not in s:
                return "too few"
            return f"{100 * s['accuracy']:.0f}%, {s['log_loss']:.3f}, {s['auc']:.2f} ({s['auc_lo']:.2f} to {s['auc_hi']:.2f})"
        if "round_out" not in r:
            out.append(f"| {r['lead']} | {r['n']} | too few | too few | | |")
            continue
        out.append(f"| {r['lead']} | {r['round_out'].get('n', 0)} | {cell(r['round_out'])} | {cell(r['pilots_out'])} | {100 * r['rule_energy']:.0f}% | {100 * r['rule_ata']:.0f}% |")
    return out


def report(title: str, result: dict) -> list[str]:
    f, first = result["funnel"], result["first_to_fire"]
    lines = [f"## {title}", "",
             f"{f['encounters']} encounters in {f['rounds']} rounds, {f['pilots']} pilots.", "",
             "| Of the encounters | Count, share (95% interval) |", "|---|---|",
             f"| an aimed shot by either | {fmt(f['a_shot'])} |",
             f"| a fight by the detector's rules | {fmt(f['a_fight'])} |",
             f"| a kill between the two | {fmt(f['a_kill'])} |", "",
             f"Decided with no detector fight: {f['decided_without_a_fight']}; decided with no aimed shot found: {f['decided_without_a_shot']}; "
             f"one of the two killed by someone else, no kill between them: {f['died_to_another']}.", "",
             "| Where someone fired an aimed shot | Count, share (95% interval) |", "|---|---|",
             f"| the first shooter killed the other | {fmt(first['shooter_killed'])} |",
             f"| the first shooter was killed by the other | {fmt(first['shooter_was_killed'])} |",
             f"| neither killed the other | {fmt(first['nobody_died'])} |",
             f"| first shooter won, of those decided | {fmt(first['of_decided'])} |",
             f"| first shooter won, of decided detector fights | {fmt(first['of_decided_fights'])} |", "",
             "### The eventual winner, before the first aimed shot", "", *lead_rows(result["winner_by_lead"]), "",
             "### The eventual first shooter, before that shot", "", *lead_rows(result["first_shooter_by_lead"]), "",
             "### The first shooter's kill, by who had the energy before the shot", "",
             "| Seconds before the first aimed shot | Shooter had more energy: killed | Shooter had less: killed |", "|---|---|---|",
             *[f"| {c['lead']} | {fmt(c['more'])} | {fmt(c['less'])} |" for c in result["conversion"]], "",
             "### Model: who wins a decided encounter", "", *model_rows(result["model_winner"]), "",
             "### Model: who fires the first aimed shot", "", *model_rows(result["model_first_shot"]), ""]
    return lines


def chart(path, result: dict, without: dict) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, 2, figsize=(9.6, 3.8), dpi=110, sharey=True)
    panels = [("The eventual winner (decided encounters)", "winner_by_lead"), ("The eventual first shooter (any aimed shot)", "first_shooter_by_lead")]
    series = [("energy", "more energy height", "#1f6fb4"), ("ata", "smaller angle-off", "#c8551b")]
    for ax, (title, key) in zip(axes, panels):
        for name, label, colour in series:
            pts = [r for r in result[key] if r[name]["n"]]
            x = [-r["lead"] for r in pts]
            ax.fill_between(x, [100 * r[name]["lo"] for r in pts], [100 * r[name]["hi"] for r in pts], color=colour, alpha=0.15, linewidth=0)
            ax.plot(x, [100 * r[name]["share"] for r in pts], color=colour, marker="o", markersize=4, linewidth=1.8, label=label)
            rest = [r for r in without[key] if r[name]["n"]]
            ax.plot([-r["lead"] for r in rest], [100 * r[name]["share"] for r in rest], color=colour, linewidth=1, linestyle=":")
        ax.axhline(50, color="#666666", linewidth=0.8)
        ax.set_title(title, fontsize=10, loc="left")
        ax.set_xlabel("seconds before the first aimed shot")
        ax.set_xticks([-20, -15, -10, -6, -4, -2])
        ax.set_ylim(15, 100)
        ax.grid(axis="y", color="#dddddd", linewidth=0.6)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        ns = [r["energy"]["n"] for r in result[key]]
        ax.text(0.01, 0.03, f"n {min(ns)} to {max(ns)}; band: 95% by round; dotted: without the most-recorded pilot", transform=ax.transAxes, fontsize=7, color="#555555")
    axes[0].set_ylabel("share that had it (%)")
    axes[0].legend(frameon=False, fontsize=8, loc="upper left")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data")
    parser.add_argument("--chart", help="also write the lead-time chart here (PNG)")
    args = parser.parse_args()
    data = data_dir(args.data)
    db = connect(data)
    encounters = load(db)
    by_lead = {lead: states(db, lead) for lead in sorted(set(LEADS + MODEL_LEADS))}
    everyone = analyse(encounters, by_lead)
    seen = Counter(p for e in encounters for p in (e["player0"], e["player1"]))
    top, top_n = seen.most_common(1)[0]
    rest = [e for e in encounters if top not in (e["player0"], e["player1"])]
    without = analyse(rest, by_lead)
    out = data / "out"
    out.mkdir(parents=True, exist_ok=True)
    result = {"leads": LEADS, "airborne": AIRBORNE, "features": FEATURES, "all": everyone, "without_top_pilot": without,
              "top_pilot_encounters": top_n,
              "top_pilot_decided": sum(1 for e in encounters if e["kill_side"] is not None and top in (e["player0"], e["player1"]))}
    (out / "approach.json").write_text(json.dumps(result, indent=1))
    text = ["# The air approach", "", f"The most-recorded pilot is in {top_n} of {len(encounters)} encounters "
            f"and {result['top_pilot_decided']} of the decided ones.", "",
            *report("Everyone", everyone), *report("Without the most-recorded pilot", without)]
    (out / "approach.md").write_text("\n".join(text))
    chart(out / "approach-lead-times.png", everyone, without)
    if args.chart:
        chart(args.chart, everyone, without)
    print("\n".join(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
