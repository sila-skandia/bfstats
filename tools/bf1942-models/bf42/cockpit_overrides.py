"""Deliberate deviations from authored cockpit data: per-template overrides.

Everything else in `bf42/` reads the game's files and writes what they say.
This module is the one place that does not, and it exists so that the places
where we chose to differ are a short table rather than a patch hidden in the
walk. Every entry is a DEVIATION in `features/bf1942-engine-reference/
ledger.md` (the row is named in `Override.ledger`), carries the numbers that
justify it, and is stamped on the node it moves as `extras.cockpitOverride`
so an audit can tell a deviation from an authoring fact.

To revert one, delete its entry from `OVERRIDES` and re-extract the templates
it matched; nothing else reads this table.

Frame: positions here are Refractor's (+Z forward, +Y up), the frame of a
`.con` `setPosition`, not glTF's. `extras.cockpitOverride` says so too.
"""
from __future__ import annotations

import fnmatch
from dataclasses import dataclass


@dataclass(frozen=True)
class StickOverride:
    """Re-seat a control-stick rig relative to the pilot's eye.

    `template` matches the stick's rotation bundle (the outermost
    `RotationalBundle` of the stick, the one at the grip's pivot) by
    case-insensitive `fnmatch`. `ahead` and `below` are how far in front of
    and under the eye (the sibling Camera) the pivot is put, in metres; the
    lateral offset stays as authored. `mods` are install-mod names, any case.
    """
    id: str
    mods: tuple[str, ...]
    template: str
    ahead: float
    below: float
    reason: str
    ledger: str = ""


# Comparable band, measured 2026-10-11 over every FH aircraft whose stick is
# the stick-with-hands mesh (36 templates, 12 distinct rigs; IL2 family
# excluded), pivot to eye in the aircraft frame:
#   ahead 0.27..0.42 (median 0.35)   below 0.35..0.42 (median 0.36)
#   nearest stick-mesh point 0.11..0.23   stick top 0.08..0.12 below the eye
# The IL2 family is authored at ahead 0.67, below 0.25: nearest point 0.42,
# top 0.09 above the eye, and 20% of the stick behind the instrument panel.
OVERRIDES: tuple[StickOverride, ...] = (
    StickOverride(
        id="fh-il2-stick-seat",
        mods=("fh", "fhsw"),
        template="IL2*stickrotation",
        ahead=0.35,
        below=0.36,
        reason=("IL2 control column authored 0.67 m ahead of and 0.25 m below "
                "the eye (every comparable FH aircraft: 0.27-0.42 ahead, "
                "0.35-0.42 below); owner report: painted too far forward"),
        ledger="DEV-COCKPIT-IL2-STICK",
    ),
)


def stick_override(mod: str | None, template_name: str) -> StickOverride | None:
    """The override for this stick-rotation template in this mod, if any."""
    if not mod:
        return None
    mod = mod.casefold()
    name = template_name.casefold()
    for entry in OVERRIDES:
        if mod in {m.casefold() for m in entry.mods} \
                and fnmatch.fnmatchcase(name, entry.template.casefold()):
            return entry
    return None


def reseat(entry: StickOverride, eye: tuple[float, float, float],
           position: tuple[float, float, float]) -> tuple[float, float, float]:
    """The stick pivot's new position in the Camera's parent frame."""
    return (position[0], round(eye[1] - entry.below, 4),
            round(eye[2] + entry.ahead, 4))


def stamp(entry: StickOverride, original, applied) -> dict:
    """The `extras.cockpitOverride` record."""
    return {
        "id": entry.id,
        "reason": entry.reason,
        "ledger": entry.ledger,
        "frame": "refractor",
        "original": [round(float(v), 4) for v in original],
        "applied": [round(float(v), 4) for v in applied],
    }
