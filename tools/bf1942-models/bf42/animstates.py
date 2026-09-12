"""The soldier animation state machine — which `.baf` a weapon puts on the body.

Nothing on a `HandFireArms` template names an animation. The join is the
template's *name*: `Objects/Soldiers/Common/CommonSoldierData.inc` sets the
soldier's default states to the bare `Lb_Stand` / `Ub_StandAim`, and the
engine appends the held weapon's template name to the upper-body state, so a
soldier holding `Colt` runs `Ub_StandAimColt`. Those per-weapon states are
declared in `animations/AnimationStates*.con`, replayed from
`animations/AnimationStates.con` by `run` lines the same way
`materialManagerSettings.con` runs the damage scripts.

Only Thompson's states are written out. Everything else is cloned:

    AnimationStateMachine.createState Ub_StandAimThompson
    AnimationStateMachine.addAnimation Animations/StandWalkRun/3p/Thompson/3PStandAimUpperThompson.baf 0.8 1
    AnimationStateMachine.addAnimation Animations/StandWalkRun/1p/Thompson/1PStandAimThompson.baf 0.1 1
    include copyToallWeapons.inc Thompson

`include` is textual with `v_arg1` substitution, and the included lists say

    AnimationStateMachine.copyState2 Colt v_arg1
    AnimationStateMachine.copyState  K98 v_arg1 No4 1.0 K98 1.0

`copyState2 <new> <src>` clones the state just created, substituting the
weapon name in the state name and in every animation path — which is why
`StandWalkRun/3P/Colt/` exists on disk. The six-argument `copyState` names
the 3P and 1P donors separately: the K98 has **no 3P clip set of its own**
and borrows the No4's, as the Panzershreck borrows the Bazooka's and the
WalterP38 the Colt's. That sharing is config, not file layout, and it is why
resolving "the K98 stand-aim pose" must go through this state machine rather
than through a path convention.

A state's first `addAnimation` is the third-person clip and the second the
first-person one throughout vanilla, but the discriminator used here is the
path itself (a `/1p/` segment), which also survives states that declare only
one of the two. `run AnimationStatesMod` names a file vanilla does not ship;
the engine skips a `run` it cannot resolve and so does this parser,
recording it under `missing`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

_COMMAND = re.compile(r"^(\w+)\.(\w+)(?:[ \t]+(.*?))?[ \t]*$")


@dataclass
class ClipRef:
    path: str
    speed: float
    looping: str

    @property
    def is_first_person(self) -> bool:
        return "/1p/" in self.path.replace("\\", "/").lower()


@dataclass
class State:
    name: str
    clips: list[ClipRef] = field(default_factory=list)

    def clip_3p(self) -> ClipRef | None:
        for clip in self.clips:
            if not clip.is_first_person:
                return clip
        return None


def _substitute(text: str, old: str, new: str) -> str:
    return re.sub(re.escape(old), new, text, flags=re.IGNORECASE)


@dataclass
class StateMachine:
    states: dict[str, State] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)

    def state(self, name: str) -> State | None:
        return self.states.get(name.lower())

    def clip_3p(self, state_prefix: str, weapon: str) -> ClipRef | None:
        """The third-person clip for e.g. ('Ub_StandAim', 'K98')."""
        state = self.state(f"{state_prefix}{weapon}")
        return state.clip_3p() if state else None

    def weapons(self, state_prefix: str = "Ub_StandAim") -> list[str]:
        """Every weapon suffix with a 3P clip on the given state family."""
        prefix = state_prefix.lower()
        found = []
        for key, state in self.states.items():
            if key.startswith(prefix) and key != prefix and state.clip_3p():
                found.append(state.name[len(state_prefix):])
        return sorted(found, key=str.lower)

    # -- replay ------------------------------------------------------------- #

    def _copy_latest(self, latest: State | None, new_weapon: str, src_weapon: str,
                     donor_3p: str | None = None, donor_1p: str | None = None) -> State | None:
        """Clone the most recently created state under a new weapon's name.

        The engine keys the clone on the state currently being defined; the
        `include` carrying the copy commands sits at the end of each state
        block, so "latest created" is that state.
        """
        if latest is None or not _substitute(latest.name, src_weapon, "") != latest.name:
            # The name must actually contain the source weapon to clone.
            if latest is None or src_weapon.lower() not in latest.name.lower():
                return None
        new_name = _substitute(latest.name, src_weapon, new_weapon)
        clone = State(new_name)
        for clip in latest.clips:
            donor = donor_1p if clip.is_first_person else donor_3p
            replacement = donor if donor is not None else new_weapon
            clone.clips.append(ClipRef(
                _substitute(clip.path, src_weapon, replacement),
                clip.speed, clip.looping))
        self.states[new_name.lower()] = clone
        return clone


def parse(read: Callable[[str], str | None],
          root: str = "animations/AnimationStates.con") -> StateMachine:
    """Replay the state machine scripts. `read` resolves an archive path to text
    (case-insensitively) or None — the same contract as the damage loader."""
    machine = StateMachine()
    latest: State | None = None

    def folder_of(path: str) -> str:
        path = path.replace("\\", "/")
        return path.rsplit("/", 1)[0] if "/" in path else ""

    def resolve(base_folder: str, target: str) -> tuple[str, str] | None:
        target = target.replace("\\", "/").strip()
        candidates = [target]
        if base_folder:
            candidates.insert(0, f"{base_folder}/{target}")
        for candidate in candidates:
            for suffix in ("", ".con", ".inc"):
                text = read(candidate + suffix)
                if text is not None:
                    return candidate + suffix, text
        return None

    def replay(path: str, text: str, arg: str | None, depth: int = 0) -> None:
        nonlocal latest
        if depth > 16:
            return
        base = folder_of(path)
        in_rem = False
        for line in text.splitlines():
            stripped = line.strip()
            low = stripped.lower()
            if in_rem:
                if low.startswith("endrem"):
                    in_rem = False
                continue
            if low.startswith("beginrem"):
                in_rem = True
                continue
            if low.startswith("rem"):
                continue
            if arg is not None:
                stripped = re.sub(r"\bv_arg1\b", arg, stripped, flags=re.IGNORECASE)
            parts = stripped.split()
            if not parts:
                continue
            head = parts[0].lower()
            if head in ("run", "include"):
                if len(parts) < 2:
                    continue
                target = resolve(base, parts[1])
                if target is None:
                    machine.missing.append(parts[1])
                    continue
                replay(target[0], target[1], parts[2] if len(parts) > 2 else None,
                       depth + 1)
                continue
            match = _COMMAND.match(stripped)
            if not match or match.group(1).lower() != "animationstatemachine":
                continue
            command = match.group(2).lower()
            args = (match.group(3) or "").split()
            if command == "createstate" and args:
                latest = State(args[0])
                machine.states[args[0].lower()] = latest
            elif command == "addanimation" and latest is not None and args:
                try:
                    speed = float(args[1]) if len(args) > 1 else 1.0
                except ValueError:
                    speed = 1.0
                latest.clips.append(ClipRef(
                    args[0].replace("\\", "/"), speed,
                    args[2] if len(args) > 2 else ""))
            elif command == "copystate2" and len(args) >= 2:
                machine._copy_latest(latest, args[0], args[1])
            elif command == "copystate" and len(args) >= 2:
                machine._copy_latest(
                    latest, args[0], args[1],
                    donor_3p=args[2] if len(args) > 2 else None,
                    donor_1p=args[4] if len(args) > 4 else None)
            elif command == "setactivestate" and args:
                # Re-targets later commands at an existing state (the
                # GrenadeAllies sprint patch-up); only copyState cares about
                # "latest", and vanilla never copies after setActiveState,
                # but keep the pointer honest.
                latest = machine.states.get(args[0].lower(), latest)

    entry = resolve("", root)
    if entry is None:
        machine.missing.append(root)
        return machine
    replay(entry[0], entry[1], None)
    return machine
