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

# A state's camera shake block as `AnimationState`'s constructor leaves it
# (lnxded 0x08328b90 zeroes both blocks): no fade in (the factor snaps to 1),
# no fade out (it holds there), no floor and no time limit (CS-8). `active`
# is the block's own byte, set by every setter but `setCameraShakeTimeToShake`.
SHAKE_DEFAULTS: dict = {
    "active": False, "timeToShake": 0.0,
    "pitch": [0.0, 0.0], "yaw": [0.0, 0.0], "roll": [0.0, 0.0],
    "upDown": [0.0, 0.0], "leftRight": [0.0, 0.0], "inOut": [0.0, 0.0],
    "fadeIn": 0.0, "fadeOut": 0.0, "minFactor": 0.0,
}
# `setCameraShake<Channel> <slot> <amplitude> <rate>`: degrees for the three
# turns, metres for the three moves, the rate in radians a second (CS-1, CS-4).
_SHAKE_CHANNELS = {
    "setcamerashakepitch": "pitch", "setcamerashakeyaw": "yaw",
    "setcamerashakeroll": "roll", "setcamerashakeupdown": "upDown",
    "setcamerashakeleftright": "leftRight", "setcamerashakeinout": "inOut",
}
_SHAKE_SCALARS = {
    "setcamerashakefadein": "fadeIn", "setcamerashakefadeout": "fadeOut",
    "setcamerashakeminfactor": "minFactor", "setcamerashaketimetoshake": "timeToShake",
}


@dataclass
class ClipRef:
    path: str
    speed: float
    looping: str

    @property
    def is_first_person(self) -> bool:
        return "/1p/" in self.path.replace("\\", "/").lower()

    @property
    def loops(self) -> bool:
        """`addAnimation <path> <speed> <loop>`'s third word, as a bool.

        The scripts write it three ways — a bare `1`, the console constant
        `c_AsmLooping`, and (in mods) `true` — and a one-shot writes `0` or
        `c_AsmPlayOnce`. It decides whether a baked clip's last keyframe wraps
        back to frame 0 (`extract_pose.timeline_tracks`), so a `PlayOnce`
        parachute opening does not snap the canopy shut at the end of its pass.
        """
        return self.looping.strip().lower() in ("1", "c_asmlooping", "true")


@dataclass
class State:
    name: str
    clips: list[ClipRef] = field(default_factory=list)
    # `setOtherState c_AsmWeaponState WeaponReloadThompson` — the state the
    # *weapon's own* skeleton plays alongside this body state (the moving
    # magazine during a reload). Other kinds (`c_AsmFaceState`) are not kept.
    weapon_state: str | None = None
    # `setMorphFactor f` — the rate, per second, at which the blend weight
    # ramps 0 -> 1 when this state is *entered*
    # (`AnimationStateMachineInstance::updateState`, lnxded 0x0832b50f:
    # `w += dt * state+0x2c`; client 0x00613c60 `state+0x34`). 5.0 is the
    # constructor default (lnxded 0x08328bf8); a value above 1000 snaps
    # (lnxded 0x0832b481 against `.rodata` 1000.0). So `Ub_StandAimThompson`'s
    # 0.7 is a 1.4 s fade *into* the aim pose, and the deploy state's 10000
    # is an instant cut to the raise clip.
    morph_factor: float = 5.0
    # `returnToState X` / `addTransitionWhenDone X` — where a one-shot goes
    # once its phase passes 1 (`AnimationState::update`, lnxded 0x08329f00).
    # `_POSE_` is the engine's sentinel for "the machine's base state".
    return_to: str | None = None
    # `addIdle X` — the fidget states registered on this state
    # (`AnimationStatesIdle.con`'s one-shots, replayed from the aim states).
    # When the state's idle timer expires (`updateState` arms `(rand & 3) + 4.0`
    # s on entry, ANIM-6), `AnimationState::checkTransitions` picks uniformly
    # among these — the "shaking his grip hand" one-shots — and each returns
    # here through its own `addTransitionWhenDone`. Declaration order is the
    # vector's order; the engine's `rand() % n` indexes it directly.
    idles: list[str] = field(default_factory=list)
    # `setUserRandomStartTime` — a looping clip starts at a random phase
    # (rand & 0xff) / 255 instead of 0 (lnxded 0x0832b413).
    random_start: bool = False
    # `setFlag c_AsmIsCrouching` / `c_AsmIsLying` / `c_AsmHideWeapon` ... —
    # the state's flag words, in declaration order. `BFSoldier::getPose()`
    # (lnxded 0x0827ddc0) is the LOWER machine's current state's crouch and
    # lie flags and nothing else, so a transition's flags are the pose the
    # soldier is in while it plays: `Lb_LieToStand` still lies.
    flags: list[str] = field(default_factory=list)
    # `setCameraShake* <slot> ...` — the state's camera shake, one block per
    # slot (`SHAKE_DEFAULTS` above), or None while the state declares none. A
    # clone takes the shake its source has at the time of the copy:
    # `copyStateData` (lnxded 0x08327780) copies both 0x44-byte blocks from
    # +0x38 (`rep movsl`, 0x0832796d..0x0832798b; CS-10). The weapons' own
    # shakes are set after the clones (`AnimationStatesCameraShakes.con`
    # names every weapon's state itself), so in the shipped packs only
    # FHSW's lower-body clones carry one, which the view never plays (CS-6).
    camera_shake: list[dict | None] | None = None
    # `addRandomTransition X` — the states a clipless hub hands to, one drawn
    # each time it is entered (the knife's `Ub_FireKnifeAllies` ->
    # `Ub_FireKnifeAllies1..5`). `AnimationState::update` (lnxded
    # 0x08329f00), for a state with no return state, draws `rand() % n` over
    # the list and resolves that name on its first draw; a name no state
    # answers to returns -1 (no change this tick) and is drawn again later.
    # A clone keeps its source's names unrenamed (`_copy_latest`).
    random: list[str] = field(default_factory=list)

    def shake_slot(self, slot: int) -> dict | None:
        """The slot's block, created on first write; None past the setters'
        `slot < 3` clamp (`AnimationState::setCameraShakePitch` 0x08329d30).
        The constructor builds two blocks; no pack writes a third."""
        if not 0 <= slot < 3:
            return None
        if self.camera_shake is None:
            self.camera_shake = [None, None]
        while len(self.camera_shake) <= slot:
            self.camera_shake.append(None)
        if self.camera_shake[slot] is None:
            self.camera_shake[slot] = dict(SHAKE_DEFAULTS)
        return self.camera_shake[slot]

    def camera_shake_extras(self) -> list[dict | None] | None:
        """The shake as the viewer reads it: the slots in order, a slot whose
        block byte was never set as None (the engine stops there, CS-8), and
        nothing after the last live one. None when no slot is live."""
        if not self.camera_shake:
            return None
        slots = [dict(block) if block and block.get("active") else None
                 for block in self.camera_shake]
        while slots and slots[-1] is None:
            slots.pop()
        for block in slots:
            if block is not None:
                block.pop("active", None)
        return slots or None

    def clip_3p(self) -> ClipRef | None:
        for clip in self.clips:
            if not clip.is_first_person:
                return clip
        return None

    def clip_1p(self) -> ClipRef | None:
        for clip in self.clips:
            if clip.is_first_person:
                return clip
        return None


def _substitute(text: str, old: str, new: str, exact: bool = False) -> str:
    """`old` -> `new` throughout `text`. `exact` is the engine's own
    `replaceSubString` (lnxded 0x08327a90: `std::string::find`, so the case
    must match); the parser's older reading ignores case."""
    if exact:
        return text.replace(old, new) if old else text
    return re.sub(re.escape(old), new, text, flags=re.IGNORECASE)


@dataclass
class StateMachine:
    states: dict[str, State] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    # Clones `copyState`/`copyState2` made and the engine deleted again
    # because no substituted clip path is in the archives (ANIM-16), keyed by
    # the lowercase state name that briefly existed. A reader that finds no
    # state can tell "declared and engine-deleted" (the mod's data: palembang's
    # Deploy_47mmType1mobile_HandFireArms clones KnifeAllies, whose clip paths
    # exist only under the knife's name) apart from "never declared".
    dropped: dict[str, str] = field(default_factory=dict)

    def state(self, name: str) -> State | None:
        return self.states.get(name.lower())

    def clip_3p(self, state_prefix: str, weapon: str) -> ClipRef | None:
        """The third-person clip for e.g. ('Ub_StandAim', 'K98')."""
        state = self.state(f"{state_prefix}{weapon}")
        return state.clip_3p() if state else None

    def clip_1p(self, state_prefix: str, weapon: str) -> ClipRef | None:
        """The first-person clip for e.g. ('Ub_StandAim', 'Thompson').

        The donor sharing resolves identically to the 3P side — `copyState`'s
        sixth argument (`donor_1p`) is already honoured by `_copy_latest`, so
        the K98 answers with the No4's `1P` clip the same way it borrows the
        3P one.
        """
        state = self.state(f"{state_prefix}{weapon}")
        return state.clip_1p() if state else None

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
                     donor_3p: str | None = None, donor_1p: str | None = None,
                     has_clip: Callable[[str], bool] | None = None) -> State | None:
        """Clone the most recently created state under a new weapon's name.

        The engine keys the clone on the state currently being defined; the
        `include` carrying the copy commands sits at the end of each state
        block, so "latest created" is that state.

        With `has_clip` (does the install hold this `.baf`) the copy follows
        `AnimationStateMachine::copyState` (lnxded 0x08327c70) to the end
        (ANIM-16): a name some state already answers to is left alone, a clip
        the install does not hold is not added (`AnimationState::addAnimation`
        0x08329630 adds nothing when `AnimationManager::getAnimation`
        0x0832a790 returns null), and a clone left with no clip of a source
        that has one is deleted again.
        """
        exact = has_clip is not None
        if latest is None:
            return None
        if exact:
            if src_weapon == new_weapon or src_weapon not in latest.name:
                return None
        elif src_weapon.lower() not in latest.name.lower():
            # The name must actually contain the source weapon to clone.
            return None
        new_name = _substitute(latest.name, src_weapon, new_weapon, exact)
        if exact and new_name.lower() in self.states:
            return None
        clone = State(new_name, morph_factor=latest.morph_factor,
                      random_start=latest.random_start, flags=list(latest.flags))
        # Both shake blocks as they stand (CS-10): later lines on either
        # state reach only that one.
        if latest.camera_shake is not None:
            clone.camera_shake = [None if block is None else
                                  {k: list(v) if isinstance(v, list) else v
                                   for k, v in block.items()}
                                  for block in latest.camera_shake]
        if latest.return_to:
            clone.return_to = _substitute(latest.return_to, src_weapon, new_weapon, exact)
        # The aim states carry their fidget registrations into the clone the
        # same way the clips follow: `Ub_IdleThompson1` -> `Ub_IdleColt1`.
        clone.idles = [_substitute(name, src_weapon, new_weapon, exact)
                       for name in latest.idles]
        # The random transitions are copied as written: `copyStateData`
        # (lnxded 0x08327780) copies the name vector at state +0xc that
        # `addRandomTransition` fills (ConsoleClass64::executeObjectMethod
        # 0x0833c490), and `copyState`'s seven `replaceSubString` calls
        # rename the name, the transitions (+0xe0), the idles (+0xd4), the
        # two return states (+0x34, +0xc4) and the two other-states, never
        # +0xc. So FHSW's `Ub_FireKnife_M1Bayonet_ID2`, a copy of the knife's
        # hub, still hands to `Ub_FireKnifeAllies1..5`: the lab server's
        # soldier entered `Ub_FireKnifeAllies1` and `2` on that knife's
        # clicks (run 20261017-093245). The older reading renamed them.
        clone.random = (list(latest.random) if exact else
                        [_substitute(name, src_weapon, new_weapon, exact)
                         for name in latest.random])
        if latest.weapon_state:
            # The paired weapon-channel state follows the body state's name:
            # `WeaponReloadThompson` -> `WeaponReloadColt`. Donors do not
            # apply — they rewrite clip *paths*, and the weapon state's own
            # clips resolve through its own clone.
            clone.weapon_state = _substitute(
                latest.weapon_state, src_weapon, new_weapon, exact)
        # Which donor a clip takes is the engine's slot rule, not the clip's
        # path (`AnimationStateMachine::copyState`, lnxded 0x08327c70, ANIM-13):
        # slot 0 takes the 3P donor and slot 1 the 1P donor, except that a
        # state with one clip whose new name does not start `ub_`
        # (strncasecmp against .rodata 0x086e2203) takes the 1P donor. So a
        # gun's own single-clip states (`WeaponFire<W>`, `WeaponReload<W>`)
        # and the lower body's follow the second donor: FHSW's
        # `RandomGerSeizedRifle1` (`copyState ... No4 1.0 Mas36 1.0`) is a
        # Mas36 whose bolt cycles as a Mas36's, under the No4's 3P arms.
        single_non_upper = (len(latest.clips) == 1
                            and not new_name.lower().startswith("ub_"))
        if exact and len(latest.clips) == 1 and "1p" in latest.clips[0].path:
            # `addAnimation` puts a state's only clip in the second slot when
            # its path says `1p` (0x08329630, `.rodata` 0x086e2231), and the
            # second slot's donor is the first-person one.
            single_non_upper = True
        for index, clip in enumerate(latest.clips[:2] if exact else latest.clips):
            if single_non_upper or index >= 1:
                donor = donor_1p
            else:
                donor = donor_3p
            replacement = donor if donor is not None else new_weapon
            path = _substitute(clip.path, src_weapon, replacement, exact)
            if exact and not has_clip(path):
                continue
            clone.clips.append(ClipRef(path, clip.speed, clip.looping))
        if exact and latest.clips and not clone.clips:
            self.dropped.setdefault(
                new_name.lower(),
                f"clone of {latest.name} deleted again: no substituted clip "
                "path is in the archives (ANIM-16)")
            return None
        self.states[new_name.lower()] = clone
        return clone


def _condition(words: list[str], variables: dict[str, str]) -> bool:
    """`if <a> <op> <b>`, each side a script variable or a literal; numbers
    compare as numbers. A condition the reader cannot parse is false."""
    if len(words) != 3:
        return False
    a = variables.get(words[0].lower(), words[0])
    b = variables.get(words[2].lower(), words[2])
    try:
        x, y = float(a), float(b)
    except ValueError:
        x, y = a.lower(), b.lower()
    return {"==": x == y, "!=": x != y, "<": x < y, ">": x > y,
            "<=": x <= y, ">=": x >= y}.get(words[1], False)


def parse(read: Callable[[str], str | None],
          root: str = "animations/AnimationStates.con",
          has_clip: Callable[[str], bool] | None = None) -> StateMachine:
    """Replay the state machine scripts. `read` resolves an archive path to text
    (case-insensitively) or None — the same contract as the damage loader.

    `has_clip` says whether the install holds a `.baf`. Given it, the replay
    keeps the engine's three rules that depend on the files (ANIM-16): a clip
    that is not there is not added, a copy never replaces a state, and a copy
    left with no clip is not a state. Without it every named clip counts as
    present and a later copy replaces an earlier one, which is what the
    parser did before the rules were read."""
    machine = StateMachine()
    latest: State | None = None
    # The console's script variables (`Var v_x`, `echo 1 -> v_x`) and its
    # `if v_x == 1` ... `else` ... `endIf` blocks. FHSW's AnimationStates.con
    # runs each nation's module only under `if v_UseHandWeapon_<NAT> == 1`, and
    # a level's own `animations/AnimationStatesSetUseHandWeapon.con` sets the
    # flags: the lab server's Battle_Of_Foy table holds GER, GER43 and US44's
    # states and no others (32,574 of the 55,249 every module makes). Without
    # a level file the mod's defaults (all 1) stand.
    variables: dict[str, str] = {}
    # One entry per open `if`: whether its lines run, and whether a branch of
    # it has run (for `else` / `elseIf`).
    blocks: list[list[bool]] = []
    # The state the camera-shake setters write: `latest`, except after a
    # `setActiveState` that names no state, where a shake has no owner rather
    # than landing on whichever state came before it.
    shake_target: State | None = None

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
        nonlocal latest, shake_target
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
            if head in ("if", "elseif", "else", "endif"):
                if head == "if":
                    taken = all(b[0] for b in blocks) and _condition(parts[1:], variables)
                    blocks.append([taken, taken])
                    continue
                if not blocks:
                    continue
                if head == "endif":
                    blocks.pop()
                    continue
                outer = all(b[0] for b in blocks[:-1])
                if head == "else":
                    taken = outer and not blocks[-1][1]
                else:
                    taken = outer and not blocks[-1][1] and _condition(parts[1:], variables)
                blocks[-1] = [taken, blocks[-1][1] or taken]
                continue
            if blocks and not all(b[0] for b in blocks):
                continue
            if head == "var":
                for name in parts[1:]:
                    variables.setdefault(name.lower(), "")
                continue
            if head == "echo" and "->" in parts:
                at = parts.index("->")
                if at + 1 < len(parts):
                    variables[parts[at + 1].lower()] = " ".join(parts[1:at])
                continue
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
                shake_target = latest
                # `createState` (lnxded 0x083274e0) on a name already taken
                # logs "State already exists" and its `insert_unique` leaves
                # the name with the first state: the lines that follow write
                # a state nothing can find.
                if has_clip is None or args[0].lower() not in machine.states:
                    machine.states[args[0].lower()] = latest
            elif command == "addanimation" and latest is not None and args:
                try:
                    speed = float(args[1]) if len(args) > 1 else 1.0
                except ValueError:
                    speed = 1.0
                if has_clip is not None and (
                        len(latest.clips) >= 2
                        or not has_clip(args[0].replace("\\", "/"))):
                    continue
                latest.clips.append(ClipRef(
                    args[0].replace("\\", "/"), speed,
                    args[2] if len(args) > 2 else ""))
            elif command == "setotherstate" and latest is not None and len(args) >= 2:
                if args[0].lower() == "c_asmweaponstate":
                    latest.weapon_state = args[1]
            elif command in ("set1panimationspeed", "set3panimationspeed") \
                    and len(args) >= 2:
                # `animations/{1p,3p}AnimationsTweaking.con`, run from
                # `AnimationStates.con` *after* every state has been created
                # and cloned, name the state outright and replace the clip's
                # rate. The engine's dev hot-keys wrote these files
                # (`AnimationStateMachine::writeAnimationSpeedChanges`), which
                # is why `Ub_RunForwardThompson` is declared at 0.7 and plays
                # at 1.40.
                target = machine.states.get(args[0].lower())
                try:
                    speed = float(args[1])
                except ValueError:
                    speed = None
                if target is not None and speed is not None:
                    want_1p = command.startswith("set1p")
                    for i, clip in enumerate(target.clips):
                        if clip.is_first_person == want_1p:
                            target.clips[i] = ClipRef(clip.path, speed, clip.looping)
            elif command == "setmorphfactor" and latest is not None and args:
                try:
                    latest.morph_factor = float(args[0])
                except ValueError:
                    pass
            elif command in ("returntostate", "addtransitionwhendone") \
                    and latest is not None and args:
                latest.return_to = args[0]
            elif command == "addidle" and latest is not None and args:
                # `addIdle Ub_Idle<W>1..3` on an aim state. A commented-out
                # line (`rem *** addIdle Ub_IdleThompson4`) never reaches here
                # because `rem` lines are skipped above.
                latest.idles.append(args[0])
            elif command == "addrandomtransition" and latest is not None and args:
                latest.random.append(args[0])
            elif command == "setuserrandomstarttime" and latest is not None:
                latest.random_start = True
            elif command == "setflag" and latest is not None and args:
                latest.flags.append(args[0])
            elif (command in _SHAKE_CHANNELS or command in _SHAKE_SCALARS) \
                    and shake_target is not None and len(args) >= 2:
                # `AnimationState::setCameraShake*` (lnxded 0x08329d30..
                # 0x08329ed0) on the state `createState`/`setActiveState` last
                # named. A bad number leaves the block as it was.
                try:
                    slot = int(float(args[0]))
                    values = [float(a) for a in args[1:3]]
                except ValueError:
                    continue
                block = shake_target.shake_slot(slot)
                if block is None:
                    continue
                if command in _SHAKE_CHANNELS:
                    if len(values) < 2:
                        continue
                    block[_SHAKE_CHANNELS[command]] = values
                    block["active"] = True
                else:
                    block[_SHAKE_SCALARS[command]] = values[0]
                    if command != "setcamerashaketimetoshake":
                        block["active"] = True
            elif command == "copystate2" and len(args) >= 2:
                machine._copy_latest(latest, args[0], args[1], has_clip=has_clip)
            elif command == "copystate" and len(args) >= 2:
                machine._copy_latest(
                    latest, args[0], args[1],
                    donor_3p=args[2] if len(args) > 2 else None,
                    donor_1p=args[4] if len(args) > 4 else None,
                    has_clip=has_clip)
            elif command == "setactivestate" and args:
                # Re-targets later commands at an existing state (the
                # GrenadeAllies sprint patch-up); only copyState cares about
                # "latest", and vanilla never copies after setActiveState,
                # but keep the pointer honest.
                latest = machine.states.get(args[0].lower(), latest)
                shake_target = machine.states.get(args[0].lower())

    entry = resolve("", root)
    if entry is None:
        machine.missing.append(root)
        return machine
    replay(entry[0], entry[1], None)
    return machine
