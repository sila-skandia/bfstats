#!/usr/bin/env python3
"""Export a first-person viewmodel: 1P arms + hands + weapon, with real clips.

    python3 extract_viewmodel.py USSoldier Thompson GermanSoldier MP40 \
        --out ./viewer/models/viewmodels

Positional arguments are soldier/weapon pairs, exactly like `extract_pose.py`.
Each pair comes out as `<Soldier>__<Weapon>.fp.glb`: the soldier's three
first-person meshes — the camo forearm sleeves (`1P<Nation>Body`, which despite
the name contains no torso) and the two fully-fingered hands — skinned to the
ordinary soldier skeleton, with the weapon's full template tree welded under
`Bip01 R Hand` exactly as the third-person poses do. The file carries one baked
glTF animation per first-person clip family the state machine declares:

    idle    Ub_StandAim<W>'s 1P clip at its declared rate (0.1x -- the
            breathing sway that plays when the player just stands there)
    walk    Ub_WalkForward<W>  (the same 1pRun clip at the walk rate)
    run     Ub_RunForward<W>
    fire    Ub_Fire<W>, looping while the trigger is held
    reload  Ub_StandReload<W>, plus the weapon channel: the state's declared
            `c_AsmWeaponState` clip driving the weapon's own bound parts
            (the Thompson's magazine leaves the gun and comes back)
    deploy  Ub_StandRaiseWeapon<W> -- the draw-in
    crouch      Ub_Crouch<W>        the stand-aim clip at the crouch rate
    crouchWalk  Ub_CrouchForward<W> the run clip at the crouch-walk rate
    prone       Ub_Lie<W>           `1pLieAim<W>`, the prone sway
    crawl       Ub_LieForward<W>    `1pCrawl<W>`
    proneFire   Ub_LieFire<W>       the prone shot cycle
    proneReload Ub_LieReload<W>     the prone reload, weapon channel included
    crouchDeploy / proneDeploy      Ub_{Crouch,Lie}RaiseWeapon<W>, the draw-in
                                    and the grenade's own raise, per stance
    idle1.. idleN  the aim state's `addIdle` fidgets (ANIM-6: a 4-7 s dwell
            picks one at random; each one-shot returns to the aim state) -- the
            "shaking his grip hand" animations a soldier performs standing
            still, and which differ weapon by weapon

Everything is data: the state machine names the clips and their rates, the
clips pose the bones, the `.ske` weld places the weapon, and the soldier's
`center1pHands` / `set1pFov` and the weapon's `soldierCameraPosition` /
`soldierZoomPosition` ride out in the extras for the viewer to mount the rig
with (see features/bf1942-3d-models/first-person-soldier.md §11 for how).

Clip timing is the engine's, not an authoring rate: a full pass of any clip
lasts `1/|speed|` seconds however many frames it holds (`clip_span`; read out
of `AnimationStateMachineInstance::updateState` and
`BoneAnimation::applyOnSkeleton`, corpus doc §3). The Thompson's fire clip at
10.0 is the 0.1 s of its 600 rpm cycle; the aim sway at 0.1 is a 10 s breath;
the reload at its tweaked 0.21 is a 4.76 s pass against the 4.8 s `reloadTime`
(the `{1p,3p}AnimationsTweaking.con` scripts, which the parser now applies,
are where the declared rates are overridden -- the run clip is declared 0.7
and plays at 1.40). Each family's `duration`, its state's `morphFactor` (the
per-second blend-in rate, `setMorphFactor`) and `returnTo` ride in the extras.

A mod's rigs go in its own tree, with the pairs its kits hand out:

    python3 extract_viewmodel.py --mod DesertCombat \
        --kits viewer/models/mods/desertcombat/kits.json \
        --maps viewer/maps/mods/desertcombat/maps.json \
        --out viewer/models/mods/desertcombat/viewmodels

Every run rewrites `index.json` in `--out`: the stem of every rig there,
which is how the viewer (`arms-rig.js`) knows which pairings a tree has
rather than probing for each one.

A rig is painted once, from the mod's own archives, and a level repaints it:
`textureManager.alternativePath` (ledger LOAD-3) is searched by file name
before the path a shader wrote, so one `Ste_hand2` is bare skin on Omaha and a
grey wool glove on Forgotten Hope's Battle of Foy (`Texture/ENVIROMENT_WINTER`),
and one `Ame1_sleeve_T` is three uniforms. With `--maps` every run also writes
the levels' own paint for the textures the tree's rigs carry, and for those
of everything else the page mounts on a soldier with no level in the file (his
third-person body, the weapon in its hand, his kit's worn parts and pickup
mesh: `soldier_glbs`):
`skins/<level>.skin.glb`, one material a texture, and `skins.json` naming, per
level, each rig image and the file the level reads in its place
(`write_level_skins`; the viewer's `level-skin.js` repaints a rig as it
mounts). `--level-skins-only` rewrites those and leaves the rigs alone.

Standard library plus the system liblzo2, same as the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import math
import json
import os
import posixpath
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates, baf, con as con_mod, gltf, pose as pose_mod
from bf42 import ske as ske_mod
from bf42.assemble import TEXTURE_EXTS, Assembler, Report
from bf42.rfa import ArchivePool
from extract_models import (DEFAULT_GAME_DIR, available_bytes, build_library,
                            build_pools, forked_workers, memory_capped_jobs, mod_chain,
                            resident_bytes)
from extract_pose import (
    PoseError,
    build_skinned_part,
    kit_pair_levels,
    kit_pairs,
    level_declared,
    level_rig_context,
    level_rig_hosts,
    read_clip,
    read_skeleton,
    state_machine,
    weapon_has_upper_states,
)

# The `.baf` nominal frame rate. UNVERIFIED (first-person-soldier.md §7): 25
# fps is the PAL authoring-rate best guess. Recorded in the extras so the
# viewer can rescale a clip against a declared gameplay duration.
# (There is no authoring rate to declare any more: clip_span() below is the
# engine's own 1/|speed|, read out of updateState/applyOnSkeleton.)

# key, upper-body state family (`Ub_<family><Weapon>`). Loop comes from the
# state's 1P clip (`c_AsmPlayOnce` / `c_AsmLooping`), not a hardcoded flag —
# bolt rifles are PlayOnce→StandReload (ANIM-7); Thompson fire is Looping.
#
# The stance families are the engine's own, not a scaling of the standing ones.
# Surveyed over vanilla's 1,458-state machine (see
# `features/viewer-soldier-stance-and-blast/README.md` §2), all 28 weapons that
# declare `Ub_StandAim<W>` also declare all six below, and they resolve to
# three different shapes:
#
#   Ub_Crouch<W>        the *same* `1PStandAim<W>.baf`, at the state's own
#                       faster rate (Thompson 0.33 against standing's 0.1) --
#                       a crouching man breathes over the sights 3.3x as fast
#   Ub_CrouchForward<W> the same `1pRun<W>.baf` as walk/run, own rate
#   Ub_Lie<W>           a dedicated `1pLieAim<W>.baf`
#   Ub_LieForward<W>    a dedicated `1pCrawl<W>.baf`
#   Ub_LieFire<W>       a dedicated `1PLieFire<W>.baf`
#   Ub_LieReload<W>     a dedicated `1PLieReload<W>.baf`
#   Ub_CrouchRaiseWeapon<W> / Ub_LieRaiseWeapon<W>  the per-stance draw-in
#
# There is deliberately no crouch fire or crouch reload family: the machine
# declares none (`Ub_CrouchFire<W>` / `Ub_CrouchReload<W>` do not exist for any
# vanilla weapon), so a crouching man fires and reloads on the standing states.
# The viewer's fallback chain reproduces that rather than inventing a clip.
#
# `Ub_CrouchRaiseWeapon<W>` resolves to the *same* `1PDeploy<W>.baf` at the
# same rate as `Ub_StandRaiseWeapon<W>` on all 28 vanilla weapons, so
# `crouchDeploy` is a duplicate of `deploy` in a vanilla rig and costs bytes
# for nothing there. It is baked anyway because the chain is per mod: a mod
# that declares a real crouched draw-in gets it without a code change.
#
# Not baked, and named here so the gap is visible rather than assumed away: the
# 28 weapons also declare `{Crouch,Lie,}{Backward,StrafeLeft,StrafeRight,Turn*}`
# and the two jumps, all with 1P clips. The viewer plays the forward clip for
# every direction in every stance, standing included, so those are a separate
# gap from this one.
FAMILIES: tuple[tuple[str, str], ...] = (
    ("idle", "StandAim"),
    ("walk", "WalkForward"),
    ("run", "RunForward"),
    ("fire", "Fire"),
    ("reload", "StandReload"),
    ("deploy", "StandRaiseWeapon"),
    ("crouch", "Crouch"),
    ("crouchWalk", "CrouchForward"),
    ("prone", "Lie"),
    ("crawl", "LieForward"),
    ("proneFire", "LieFire"),
    ("proneReload", "LieReload"),
    ("crouchDeploy", "CrouchRaiseWeapon"),
    ("proneDeploy", "LieRaiseWeapon"),
    # The alternate fire's swing, for the weapons that have one as an action
    # (`Ub_AltFire<W>` with its five random variants `1..5`: SW's commando and
    # elite knives, whose right button stabs). A weapon with none has no state
    # of that name and the family is left out without a word, as a rifle's
    # right button is a zoom and no animation.
    ("altfire", "AltFire"),
)

# The bolt cycle families, resolved off the fire state's `returnToState`
# (resolve_families), not by weapon name: key, the fire family that names it.
BOLT_FAMILIES: tuple[tuple[str, str], ...] = (
    ("bolt", "fire"),
    ("proneBolt", "proneFire"),
)
PRIMARY = "idle"

# The idle fidgets (`Ub_Idle<W>1..3`, `Animations/WeaponHandling/1p/<W>/1pIdle*`)
# are not declared per family — each aim state registers its own list through
# `addIdle` (ANIM-6: on entry `updateState` arms a `(rand & 3) + 4.0` s timer,
# expiry picks `rand() % n` among the registered states, each one-shot returns
# through `addTransitionWhenDone`). They resolve from the aim state's
# registration, named `idle1..idleN` in registration order.

# Conjugation between the raw `.baf`/`.ske`-file frame convention and the
# parsed (Z-mirror) one — the same S = diag(1, 1, -1) `pose.weapon_attachment`
# uses. A weapon-channel clip poses the weapon skeleton in the raw convention;
# the exported nodes sit in the parsed one.
_S = (1.0, 1.0, -1.0)


def _conjugate(rt: pose_mod.RT) -> pose_mod.RT:
    rotation, translation = rt
    return (
        tuple(tuple(_S[i] * rotation[i][j] * _S[j] for j in range(3))
              for i in range(3)),
        (translation[0], translation[1], -translation[2]),
    )


# A part's place under the grip wrapper. `weapon_part_locals` and the `.ske`
# rests answer in the parsed convention, the raw transform conjugated by the
# Z mirror, which is where a part sits in the weapon's own model. Under the
# grip wrapper the weapon hangs from a clip-posed hand, and there the validated
# rule is `pose.weapon_attachment(clip_posed=True)`'s: a mesh rigid to a weapon
# bone at raw pose W is drawn at `W . CLIP_WORLD_YAW`. The main bone's wrapper
# already carries `B . Y`, so a part at raw C relative to it has to be
# `Y^-1 . C . Y`, the raw transform conjugated by the yaw. The two differ by
# the X mirror (yaw x Z mirror), which is invisible at rest (every vanilla
# part rests on the weapon's own YZ plane, x = 0, unrotated) and for a
# magazine pulled straight down, and reverses any roll about the barrel.
# FHSW's and FH's bolt rifles are where it shows: their clips key a GUNBODY
# bone that carries the whole rifle and counter-rolls it against the right
# hand as the hand works the bolt (K98BoltOperate.baf: the hand rolls 113
# degrees, GUNBODY 112 back). Conjugated by the Z mirror the two added, and
# the rifle went round like a clock hand, 179 degrees at the peak; by the
# yaw they cancel to 3.4 degrees and the rifle stays in the left hand.
_X = (-1.0, 1.0, 1.0)


def _under_grip(rt: pose_mod.RT) -> pose_mod.RT:
    """A parsed-convention part transform, re-expressed under the grip wrapper."""
    rotation, translation = rt
    return (
        tuple(tuple(_X[i] * rotation[i][j] * _X[j] for j in range(3))
              for i in range(3)),
        (-translation[0], translation[1], translation[2]),
    )


def first_person_parts(library: con_mod.ObjectLibrary, soldier: str,
                       ) -> list[con_mod.ObjectTemplate]:
    """The soldier's skinned first-person parts: sleeves and both hands.

    `con.instance_template_name` erases any child with
    `setIsFirstPersonPart 1` before the assembler ever sees a geometry name —
    that is the gate the feature doc's §4.1 names — so this walks
    `template.children` directly and keeps exactly the parts that gate drops.
    """
    root = library.object(soldier)
    if root is None:
        raise PoseError(f"no such template: {soldier}")
    if root.kind.lower() != "bfsoldier":
        raise PoseError(f"{soldier} is a {root.kind}, not a BFSoldier")
    parts = []
    for ref in root.children:
        if ref.first_person_part != 1:
            continue
        child = library.object(ref.template)
        if child is None or not child.geometry:
            continue
        geom = library.geometry(child.geometry)
        if geom is None or not geom.skin:
            continue
        parts.append(child)
    if not parts:
        raise PoseError(f"{soldier} has no skinned first-person parts")
    return parts


def soldier_view_constants(objects: ArchivePool, soldier: con_mod.ObjectTemplate,
                           ) -> dict:
    """`center1pHands` and `set1pFov`, read from the soldier's own `.con` tree.

    Both live in `CommonSoldierData.inc`, reached by an `include` from the
    soldier's `Objects.con` — and the object library never replays includes
    (it indexes `.con` files only). So replay them here, the engine's way:
    relative to the including file's folder, textually, then hand the joined
    text to the ordinary `.con` parser against a probe template.
    """

    def gather(path: str, depth: int = 0) -> str:
        if depth > 4:
            return ""
        blob = objects.try_read(path)
        if blob is None:
            return ""
        text = blob.decode("latin-1")
        folder = path.rsplit("/", 1)[0] if "/" in path else ""
        out = [text]
        for line in text.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0].lower() == "include":
                target = posixpath.normpath(
                    posixpath.join(folder, parts[1].replace("\\", "/")))
                out.append(gather(target, depth + 1))
        return "\n".join(out)

    text = gather(soldier.source)
    probe_lib = con_mod.ObjectLibrary()
    probe_lib.add_con(soldier.source, "ObjectTemplate.create BFSoldier __probe\n"
                      + "\n".join(line for line in text.splitlines()
                                  if "create" not in line.lower()))
    probe = probe_lib.object("__probe")
    return {
        "center1pHands": (list(probe.center_1p_hands)
                          if probe.center_1p_hands else None),
        "fov1p": probe.fov_1p,
    }


def _camera_shake(state: animstates.State) -> dict:
    """`{"cameraShake": [...]}` when the family's state declares a camera
    shake (`setCameraShake*`, CS-1..CS-12), else nothing: the upper machine's
    fire kicks and the sniper's aim sway, played on the view at factor 1.0
    (CS-6) by `fire-shake.js`."""
    slots = state.camera_shake_extras()
    return {"cameraShake": slots} if slots else {}


def resolve_families(machine: animstates.StateMachine, weapon: str,
                     ) -> tuple[dict[str, dict], dict[str, dict]]:
    """Per family: the 1P clip ref and any declared weapon-channel clip ref."""
    resolved: dict[str, dict] = {}
    report: dict[str, dict] = {}
    variant_families: set[str] = set()
    for key, family in FAMILIES:
        state = machine.state(f"Ub_{family}{weapon}")
        clip_ref = state.clip_1p() if state else None
        if clip_ref is None:
            # Randomized variants: the knife's stand fire is five states
            # (`Ub_FireKnifeAllies1..5`, clips A-E) that the hub state
            # `Ub_FireKnifeAllies` -- which itself declares no 1P clip --
            # jumps to one at a time. Resolve every variant the machine
            # actually holds as its own family (`fire1`, `fire2`, ...) so a
            # viewer can pick among them the way the ASM does.
            variants = []
            for n in range(1, 9):
                vstate = machine.state(f"Ub_{family}{weapon}{n}")
                vref = vstate.clip_1p() if vstate else None
                if vstate is None or vref is None:
                    continue
                variants.append((n, vstate, vref))
            if variants:
                variant_families.add(key)
                for n, vstate, vref in variants:
                    entry: dict = {"ref": vref, "loop": clip_loops(vref),
                                   "weaponRef": None,
                                   "morphFactor": vstate.morph_factor,
                                   "returnTo": vstate.return_to}
                    if vstate.weapon_state:
                        weapon_channel = machine.state(vstate.weapon_state)
                        if weapon_channel and weapon_channel.clips:
                            entry["weaponRef"] = weapon_channel.clips[0]
                            entry["weaponState"] = vstate.weapon_state
                    resolved[f"{key}{n}"] = entry
                    report[f"{key}{n}"] = {
                        "upperClip": vref.path,
                        "speed": vref.speed,
                        "loop": bool(entry["loop"]),
                        "variantOf": key,
                        "morphFactor": vstate.morph_factor,
                        "returnTo": vstate.return_to,
                        **({"weaponClip": entry["weaponRef"].path}
                           if entry["weaponRef"] is not None else {}),
                        **_camera_shake(vstate),
                    }
                report[key] = {"variants": [n for n, _s, _r in variants]}
                continue
            if key in variant_families:
                continue
            if key == "altfire":
                # No `Ub_AltFire<W>` and no variants of it: the weapon has no
                # alternate swing, which is not a failure to report.
                continue
            # The knife's `Ub_FireKnifeAllies` (and any mod sibling like it)
            # declares no 1P clip and no `weapon_state`: the engine's fire
            # state has no 1P slot, so `BFSoldier::updateAnimations` returns
            # and the arms keep the aim pose while the swing runs entirely on
            # the weapon channel. The channel exists under the ASM's canonical
            # name (`WeaponFire<weapon>`) even where the state does not name
            # it, so resolve it and bake a weapon-only family rather than
            # dropping the weapon's only attack animation.
            channel_name = ((state.weapon_state or f"Weapon{family}{weapon}")
                            if state else None)
            weapon_channel = machine.state(channel_name) if channel_name else None
            if not (weapon_channel and weapon_channel.clips):
                if state is not None and state.random:
                    # A hub whose swings were never made: FHSW copies the
                    # knife's five to 31 weapons with no clip folder of their
                    # own, the engine deletes each copy (ANIM-16) and the hub
                    # is left handing to nothing. Retail has no swing here.
                    report[key] = {"error": (
                        f"Ub_{family}{weapon} hands to {len(state.random)} states "
                        f"({state.random[0]}..) whose clips are in no archive, "
                        "so the engine made none of them")}
                    continue
                report[key] = {"error": f"no Ub_{family}{weapon} state with a 1P clip"}
                continue
            resolved[key] = {"ref": None, "loop": False,
                             "weaponRef": weapon_channel.clips[0],
                             "weaponState": channel_name,
                             "morphFactor": state.morph_factor,
                             "returnTo": state.return_to}
            report[key] = {
                "upperClip": None,
                "weaponClip": weapon_channel.clips[0].path,
                "weaponSpeed": weapon_channel.clips[0].speed,
                "loop": False,
                "weaponOnly": True,
                "morphFactor": state.morph_factor,
                "returnTo": state.return_to,
                **_camera_shake(state),
            }
            continue
        # ANIM-7: honour c_AsmPlayOnce vs c_AsmLooping from the ASM clip word.
        loop = clip_loops(clip_ref)
        entry: dict = {"ref": clip_ref, "loop": loop, "weaponRef": None,
                       "morphFactor": state.morph_factor,
                       "returnTo": state.return_to}
        if state.weapon_state:
            weapon_channel = machine.state(state.weapon_state)
            if weapon_channel and weapon_channel.clips:
                entry["weaponRef"] = weapon_channel.clips[0]
                entry["weaponState"] = state.weapon_state
        resolved[key] = entry
        report[key] = {
            "upperClip": clip_ref.path,
            "speed": clip_ref.speed,
            "loop": loop,
            # The rate at which the engine blends *into* this state, per
            # second (`setMorphFactor`; >= 1000 is a cut). A viewer's
            # crossfade to this clip lasts 1/morphFactor.
            "morphFactor": state.morph_factor,
            "returnTo": state.return_to,
            **_camera_shake(state),
        }
        if entry["weaponRef"] is not None:
            report[key]["weaponClip"] = entry["weaponRef"].path
            report[key]["weaponSpeed"] = entry["weaponRef"].speed

    # The bolt cycle. Vanilla's bolt rifles fire into `Ub_StandReload<W>`
    # (`returnToState`), so the cycle *is* the `reload` family and needs
    # nothing here. Forgotten Hope and FHSW fire into a state of their own,
    # `Ub_StandBoltOperate<W>` (prone: `Ub_LieBoltOperate<W>`), whose clip is
    # not the reload's (the No4's runs `1PReloadNo4.baf` at 1.5 where the
    # reload runs it at 0.3) and whose weapon channel is the bolt's. Without
    # its own family the viewer had nothing to play when the fire clip ended:
    # `returnTo` matched no reload, so the rifle fired and the bolt never
    # moved. The state is the one the fire state *names*, not one the weapon's
    # name implies: FH's No4 returns to `Ub_StandBoltOperateMosinNagant`, a
    # copy-paste in the mod's data, and the engine plays what it is told.
    for key, source in BOLT_FAMILIES:
        target = report.get(source, {}).get("returnTo") or ""
        # A delayed launcher's fire state is the same shape. FH's and FHSW's
        # rifle grenades with a `fireDelay` (`module_DelayedShot_*.inc`) fire
        # into a short wait, `1pShortDelay_<W>.baf`, that hands to
        # `Ub_DelayedFire<W>` (prone: `Ub_DelayedLieFire<W>`) when done: the
        # recoil, and the weapon state that takes the grenade off the muzzle.
        # The round leaves as that second state begins (`fireDelay 0.8`
        # against a 0.714 s wait), so without it the arms never recoil and the
        # grenade sits on the rifle until the reload.
        if not re.search(r"boltoperate|delayed(?:lie)?fire", target, re.I):
            continue
        state = machine.state(target)
        clip_ref = state.clip_1p() if state else None
        if clip_ref is None:
            report[key] = {"error": f"no 1P clip for {target}"}
            continue
        entry = {"ref": clip_ref, "loop": clip_loops(clip_ref),
                 "weaponRef": None, "morphFactor": state.morph_factor,
                 "returnTo": state.return_to}
        report[key] = {
            "state": target,
            "upperClip": clip_ref.path,
            "speed": clip_ref.speed,
            "loop": bool(entry["loop"]),
            "morphFactor": state.morph_factor,
            "returnTo": state.return_to,
        }
        if state.weapon_state:
            weapon_channel = machine.state(state.weapon_state)
            if weapon_channel and weapon_channel.clips:
                entry["weaponRef"] = weapon_channel.clips[0]
                entry["weaponState"] = state.weapon_state
                report[key]["weaponClip"] = entry["weaponRef"].path
                report[key]["weaponSpeed"] = entry["weaponRef"].speed
        resolved[key] = entry

    # The aim state's own fidgets, in `addIdle` registration order. A
    # registered name the machine does not hold (a mod that registered one it
    # never declared) cannot play in the engine either — skip it rather than
    # inventing a clip.
    aim_state = machine.state(f"Ub_StandAim{weapon}")
    for index, idle_name in enumerate((aim_state.idles if aim_state else []),
                                      start=1):
        key = f"idle{index}"
        state = machine.state(idle_name)
        clip_ref = state.clip_1p() if state else None
        if clip_ref is None:
            report[key] = {"error": f"no 1P clip for registered fidget {idle_name}"}
            continue
        resolved[key] = {"ref": clip_ref, "loop": clip_loops(clip_ref),
                         "weaponRef": None,
                         "morphFactor": state.morph_factor,
                         "returnTo": state.return_to}
        report[key] = {
            "fidgetState": state.name,
            "upperClip": clip_ref.path,
            "speed": clip_ref.speed,
            "loop": bool(resolved[key]["loop"]),
            "morphFactor": state.morph_factor,
            "returnTo": state.return_to,
        }
    return resolved, report


def bound_part_rests(library, meshes, root: con_mod.ObjectTemplate,
                     root_skeleton, root_main: int | None,
                     ) -> dict[str, pose_mod.RT]:
    """Canonical bone name -> rest of each `bindToSkeletonPart` part under `root`.

    Walks the template tree the way `Assembler._skeleton_scope` does: a
    template that declares `createSkeleton` re-scopes its children (and its
    main bone is re-found by the inherited `useSkeletonPartAsMain` name), so a
    part is measured on the skeleton it was placed with, which is not always
    the one the weapon template declares.
    """
    out: dict[str, pose_mod.RT] = {}
    seen: set[str] = set()

    def walk(template, skeleton, main_index, main_name) -> None:
        if template.skeleton_main:
            main_name = template.skeleton_main
        if template.skeleton and template is not root:
            skeleton = read_skeleton(meshes, template.skeleton)
            main_index = (skeleton.main_index(main_name, template.geometry)
                          if skeleton is not None else None)
        for ref in template.children:
            child = library.object(ref.template)
            if ref.skeleton_part and skeleton is not None and main_index is not None:
                index = skeleton.index(ref.skeleton_part)
                if index is not None:
                    out[ske_mod.canonical(skeleton.bones[index].name)] = \
                        _under_grip(skeleton.relative(index, main_index))
            if child is not None and ref.template not in seen:
                seen.add(ref.template)
                walk(child, skeleton, main_index, main_name)

    walk(root, root_skeleton, root_main, root.skeleton_main)
    return out


def weapon_part_locals(clip: baf.Animation, skeleton: ske_mod.Skeleton,
                       main_index: int, frame: int) -> dict[str, pose_mod.RT]:
    """Canonical bone name -> transform relative to the weapon's main bone.

    A weapon-channel clip (`ThompsonReload.baf`) poses the weapon skeleton's
    bones in the raw file convention; the exported bound parts sit relative
    to the main bone in the parsed convention (`assemble._bind_pose` uses
    `skeleton.relative`). Conjugate each clip local into the parsed
    convention, chain worlds down the weapon skeleton, and re-express against
    the main bone, then under the grip wrapper (`_under_grip`). At frame 0 of
    the Thompson reload this reproduces the static rest to 0.1 mm; that pins
    the chain and not the handedness, which a part resting on x = 0 cannot
    show.
    """
    clip_locals = {name: _conjugate(rt)
                   for name, rt in clip.local_pose(frame).items()}
    worlds: list[pose_mod.RT] = []
    for index, bone in enumerate(skeleton.bones):
        local = clip_locals.get(ske_mod.canonical(bone.name),
                                (bone.rotation, bone.translation))
        if bone.parent < 0 or bone.parent >= index:
            worlds.append(local)
        else:
            worlds.append(pose_mod.rt_mul(worlds[bone.parent], local))
    inv_main = pose_mod.rt_inverse(worlds[main_index])
    return {
        ske_mod.canonical(bone.name):
            _under_grip(pose_mod.rt_mul(inv_main, worlds[index]))
        for index, bone in enumerate(skeleton.bones)
    }


def weapon_main_local(clip: baf.Animation, skeleton: ske_mod.Skeleton,
                      main_index: int, frame: int) -> pose_mod.RT:
    """The grip wrapper's transform at `frame`: the main bone under the hand.

    `weapon_part_locals` re-expresses every bound part against the main bone,
    so whatever the clip does to the main bone *itself* is divided back out —
    and that motion is the throw. `GrenadeAlliesFire.baf` holds the grenade at
    rest for its first 24 frames and then flies the main bone 0.54 m out of the
    palm along the swing; eight vanilla weapons animate their main bone this
    way (both grenades, the Detonator, the Landmine, the MedPack, the
    JohnsonLMG's reload, the M1Garand and the Type5), and none of it reached
    the glb while the wrapper carried the static weld alone.

    This is the same quantity `pose.weapon_attachment(clip_posed=True)`
    computes, one frame at a time: the main bone's pose in the skeleton root's
    space, in the raw file convention, yawed by `CLIP_WORLD_YAW` into mesh
    world. A clip local is already raw, so only bones falling back to their
    `.ske` rest need conjugating out of the parse-time mirror. At frame 0 of
    any of the eight this reproduces the static attach to under 0.1 mm, which
    is the identity that pins it.
    """
    raw_locals = clip.local_pose(frame)
    worlds: list[pose_mod.RT] = []
    for index, bone in enumerate(skeleton.bones):
        key = ske_mod.canonical(bone.name)
        local = (raw_locals[key] if key in raw_locals
                 else _conjugate((bone.rotation, bone.translation)))
        if bone.parent < 0 or bone.parent >= index:
            worlds.append(local)
        else:
            worlds.append(pose_mod.rt_mul(worlds[bone.parent], local))
    rotation, translation = pose_mod.rt_mul(pose_mod.rt_inverse(worlds[0]),
                                           worlds[main_index])
    return (tuple(tuple(sum(rotation[i][k] * pose_mod.CLIP_WORLD_YAW[k][j]
                            for k in range(3)) for j in range(3))
                  for i in range(3)),
            translation)


# How far frame 0 of a weapon clip's main bone may sit from the static weld
# before the clip is read as authored against another rig (radians of the
# rotation trace, metres): the eight vanilla weapons that move the main bone
# all start on the weld to under 0.1 mm.
MAIN_REST_TOLERANCE = 1e-3


def weapon_main_track(clip: baf.Animation, skeleton: ske_mod.Skeleton,
                      main_index: int, frames: list[int],
                      attach: pose_mod.RT) -> list[pose_mod.RT]:
    """The grip wrapper's transform over `frames`, anchored to the weld.

    `weapon_main_local` reads the main bone off the clip's own root chain,
    which is the weld only when the clip was authored against the weapon's
    `.ske` rest. A clip that was not (FH's `SVT40Fire.baf` holds Base at
    identity under a root carrying the inverse weld; `G43Fire.baf`,
    `G43Reload.baf` and `StenMK5Reload.baf` do the same) answers a pose
    100-114 degrees and up to 25 cm off the weld on frame 0, and the wrapper
    then flung the rifle out of the hands for the whole shot and let it ease
    back over the idle's settle. Retail's weapon stays in the hand there: what
    such a clip says about the main bone is its *motion*, so that is what is
    kept. A clip whose frame 0 is the weld is returned untouched (every
    vanilla throw), and any other is `attach . inverse(frame 0) . frame f`,
    which holds the weld for a main bone that does not move and carries the
    movement of one that does.
    """
    locals_ = [weapon_main_local(clip, skeleton, main_index, f) for f in frames]
    first_rot, first_t = weapon_main_local(clip, skeleton, main_index, 0)
    trace = sum(first_rot[i][k] * attach[0][i][k]
                for i in range(3) for k in range(3))
    off_rot = math.acos(max(-1.0, min(1.0, (trace - 1.0) / 2.0)))
    off_t = math.dist(first_t, attach[1])
    if off_rot <= MAIN_REST_TOLERANCE and off_t <= MAIN_REST_TOLERANCE:
        return locals_
    inverse_first = pose_mod.rt_inverse((first_rot, first_t))
    return [pose_mod.rt_mul(attach, pose_mod.rt_mul(inverse_first, local))
            for local in locals_]


def collect_bound_nodes(builder: gltf.GlbBuilder, weapon_node: int,
                        ) -> dict[str, int]:
    """boundBone name -> node index, for every bound part under the weapon.

    Bound parts are placed relative to the weapon's main bone with identity
    wrappers between (LodObject / AnimatedBundle nodes carry no transform on
    any vanilla hand weapon), so a track that writes main-relative transforms
    onto the node lands in the right space. A bound node under a transformed
    parent would not — none exists in vanilla, and one that appeared would
    simply animate slightly off rather than crash.
    """
    found: dict[str, int] = {}
    stack = [weapon_node]
    while stack:
        index = stack.pop()
        node = builder.node(index)
        bone = (node.extras or {}).get("boundBone")
        if bone:
            found[ske_mod.canonical(bone)] = index
        stack.extend(node.children)
    return found


def clip_span(speed: float) -> float:
    """Seconds for one full pass of a clip at a declared state speed.

    The engine has no frames-per-second anywhere. `updateState` advances a
    normalized phase by `dt * speed` (lnxded 0x0832b4fa, client 0x00613c60),
    and `BoneAnimation::applyOnSkeleton` (lnxded 0x0832ed60, client
    0x0066b740) maps `frac(phase) * N` onto the frame list -- so a clip is
    `1/|speed|` seconds long however many frames it holds. The Thompson's
    fire clip at 10.0 is the 0.1 s of its 600 rpm cycle, its aim sway at 0.1
    a 10 s breath, and its reload at the tweaked 0.21 a 4.76 s pass against
    the 4.8 s `reloadTime` -- the rate was fitted to the timer in
    `1pAnimationsTweaking.con`, which is why the old `bakedSpan / reloadTime`
    stretch happened to land.
    """
    return 1.0 / (abs(speed) or 1.0)


def clip_times(frames: int, speed: float, loop: bool) -> tuple[float, ...]:
    """Key times for a baked clip.

    A looping clip has `frames` intervals -- the engine's frame B is
    `(frameA + 1) % frames`, so the wrap from the last frame back to the
    first is interpolated like any other step -- and the bake carries one
    extra key (frame 0 again) at the full span so a glTF `LoopRepeat` crosses
    the wrap the same way. A one-shot has `frames - 1` intervals: phase 0 is
    the first frame, phase 1 the last.
    """
    span = clip_span(speed)
    if frames <= 1:
        return (0.0, span)
    intervals = frames if loop else frames - 1
    count = frames + 1 if loop else frames
    return tuple(span * f / intervals for f in range(count))


def clip_loops(ref: animstates.ClipRef) -> bool:
    """`addAnimation ... <path> <speed> <loop>`: 1 / c_AsmLooping loop."""
    flag = ref.looping.strip().lower()
    return flag in ("1", "c_asmlooping", "true")


def weapon_block(template: con_mod.ObjectTemplate) -> dict | None:
    """`weapon_stats()` plus the weapon's heat (ledger GUN-14, GUN-15).

    `heat` carries the words under their FireArms names, the shape
    `fire-state.js` `FireState` reads off a vehicle gun's extras, and
    `velocityDependentOnHeat`, which makes the same field a grenade's throw
    charge instead of an overheat. Absent on a weapon that declares none.
    """
    stats = template.weapon_stats() or {}
    heat = {key: value for key, value in {
        "heatAddWhenFire": template.heat_add_when_fire,
        "coolDownPerSec": template.cool_down_per_sec,
        "timeDelayOnOverheat": template.time_delay_on_overheat,
        "velocityDependentOnHeat": template.velocity_dependent_on_heat,
    }.items() if value is not None}
    if heat:
        stats["heat"] = heat
    return stats or None


def export_viewmodel(soldier: str, weapon: str, *, machine, meshes, textures,
                     objects, library, max_texture: int, out: Path | None,
                     ) -> dict:
    result: dict = {"soldier": soldier, "weapon": weapon}

    root_template = library.object(soldier)
    parts = first_person_parts(library, soldier)
    if root_template is None or not root_template.skeleton:
        raise PoseError(f"{soldier} declares no skeleton")
    skeleton = read_skeleton(meshes, root_template.skeleton)
    if skeleton is None:
        raise PoseError(f"skeleton unreadable: {root_template.skeleton}")

    if not weapon_has_upper_states(machine, weapon):
        # No `Ub_*<W>` state at all: the engine keeps the arms in the state
        # they were in (`export_graft`), so the rig is the weapon and its weld.
        return export_graft(soldier, weapon, objects=objects, meshes=meshes,
                            textures=textures, library=library,
                            max_texture=max_texture, out=out)

    resolved, clip_report = resolve_families(machine, weapon)
    if PRIMARY not in resolved:
        # Numbered aim states only (`Ub_StandAim<W>1..n`) are not one weapon's
        # idle: FHSW's `Random*` kit items name one state per weapon they can
        # issue. The bundle is never held -- a spawn rolls one of the
        # numbered templates (bf42/kit.py `RandomItem`) -- so `kit_pairs`
        # asks for each variant and the bundle itself is skipped here.
        primary = clip_report.get(PRIMARY, {})
        raise PoseError(primary.get("error") or
                        f"no plain Ub_StandAim{weapon}, only numbered states "
                        f"{primary.get('variants')}")
    result["clips"] = clip_report

    # The static base pose: the idle 1P clip over the skeleton's own rest,
    # which is what the engine shows. In first person the lower-body state
    # machine applies nothing to the skeleton: `BFSoldier::updateAnimations`
    # hands `AnimationStateMachineInstance::updateAnimations` clip slot 1 (the
    # 1P clip), that returns when the state has no such slot (lnxded
    # 0x0832af36), and no `Lb_*` state declares one -- so Bip01, the pelvis
    # and the legs sit at the `.ske` rest that `BFSoldier::setFirstPerson`
    # restores from the template skeleton (lnxded 0x0826d3d9). `Lb_Stand`
    # frame 0 is the third-person answer; under `center1pHands` it held the
    # arms 9 cm higher and 6 cm nearer the eye than the game does, and put
    # the head bone 7 cm above the eye where the rest pose puts it 2 cm
    # below. Corpus: features/bf1942-engine-reference/subsystems/
    # handweapon-view-and-deviation.md, section 3.
    idle = read_clip(meshes, resolved[PRIMARY]["ref"].path)
    if idle is None:
        raise PoseError(f"idle clip unreadable: {resolved[PRIMARY]['ref'].path}")
    base_locals = pose_mod.align_clip_roots(skeleton, idle.local_pose(0))

    # Read every family's clips up front; a family whose file is unreadable
    # records the error and drops out rather than costing the export.
    #
    # Absent and unparseable are reported apart, because they mean opposite
    # things: a state machine that registers a clip the game never shipped is
    # the data's own dead end (`1PReloadGrenadeAllies.baf` and 15 others under
    # `WeaponHandling/1p/` — a grenade has no reload animation because reloading
    # one is raising the next), while a file that is present and will not parse
    # is a gap in this pipeline and has to be chased. Lumping them together as
    # "unreadable" is how a real reader bug — `animations/GrenadeAllies.ske` —
    # sat in these reports looking like missing content.
    clips: dict[str, dict] = {}
    for key, entry in resolved.items():
        upper = None
        if entry["ref"] is not None:
            upper = read_clip(meshes, entry["ref"].path)
            if upper is None:
                state = ("absent from the archives"
                         if meshes.find(entry["ref"].path) is None
                         else "present but unparseable")
                clip_report[key] = {
                    "error": f"clip {state}: {entry['ref'].path}"}
                continue
        weapon_clip = None
        if entry["weaponRef"] is not None:
            weapon_clip = read_clip(meshes, entry["weaponRef"].path)
        clips[key] = {**entry, "upper": upper, "weapon": weapon_clip}

    posed = pose_mod.worlds_by_name(
        skeleton, pose_mod.posed_worlds(skeleton, base_locals))
    if posed.get("bip01 r hand") is None:
        raise PoseError("posed skeleton has no Bip01 R Hand")

    weapon_template = library.object(weapon)
    if weapon_template is None:
        raise PoseError(f"no such weapon template: {weapon}")
    weapon_skeleton = (read_skeleton(meshes, weapon_template.skeleton)
                       if weapon_template.skeleton else None)
    if weapon_skeleton is not None:
        main_index = weapon_skeleton.main_index(
            weapon_template.skeleton_main, weapon)
        attach = pose_mod.weapon_attachment(weapon_skeleton, main_index,
                                            clip_posed=True)
    else:
        main_index = None
        attach = (pose_mod.CLIP_WORLD_YAW, (0.0, 0.0, 0.0))
        result["weaponSkeleton"] = "unreadable, attached at hand root"

    result["view"] = {
        **soldier_view_constants(objects, root_template),
        "soldierCameraPosition": (
            list(weapon_template.soldier_camera_position)
            if weapon_template.soldier_camera_position else None),
        "soldierZoomPosition": (
            list(weapon_template.soldier_zoom_position)
            if weapon_template.soldier_zoom_position else None),
        "soldierZoomFov": weapon_template.soldier_zoom_fov,
        "zoomFov": weapon_template.zoom_fov,
    }
    # Clip timing is the engine's: one pass of a clip lasts 1/|speed| s
    # (clip_span), whatever its frame count. Every family's `duration`
    # below is that number.
    result["clipTiming"] = "1/speed"
    stats = weapon_block(weapon_template)
    if stats:
        result["weaponStats"] = stats

    if out is None:
        return result

    builder = gltf.GlbBuilder()
    assembler = Assembler(meshes, textures, objects, library,
                          max_texture=max_texture, include_collision=False)
    report = Report(root=f"{soldier}+{weapon}", configuration="viewmodel",
                    lod=0, first_person=True)

    # Joint hierarchy at the base pose, exactly as extract_pose builds it.
    joint_nodes: dict[str, int] = {}
    children_of: dict[int, list[int]] = {}
    order: list[tuple[int, int]] = []
    for index, bone in enumerate(skeleton.bones):
        local = base_locals.get(ske_mod.canonical(bone.name),
                                (bone.rotation, bone.translation))
        node = builder.add_node(gltf.Node(
            name=bone.name,
            translation=local[1],
            rotation=gltf.quat_from_matrix(local[0]),
            extras={"joint": True},
        ))
        joint_nodes[ske_mod.canonical(bone.name)] = node
        order.append((index, node))
        if 0 <= bone.parent < index:
            children_of.setdefault(bone.parent, []).append(node)
    for bone_index, node_index in order:
        builder._nodes[node_index].children = children_of.get(bone_index, [])

    part_report: dict = {}
    root_children = [node for (bone_index, node) in order
                     if skeleton.bones[bone_index].parent < 0]
    skinned_roots: list[int] = []
    for template in parts:
        node = build_skinned_part(builder, assembler, meshes, skeleton,
                                  template, joint_nodes, report, part_report)
        if node is not None:
            skinned_roots.append(node)
    if not skinned_roots:
        raise PoseError(f"none of {soldier}'s first-person parts produced mesh")

    weapon_report = Report(root=weapon, configuration="complex", lod=0)
    weapon_node = assembler.build_node(builder, weapon, weapon_report)
    bound_nodes: dict[str, int] = {}
    grip_node: int | None = None
    if weapon_node is not None:
        bound_nodes = collect_bound_nodes(builder, weapon_node)
        grip_node = builder.add_node(gltf.Node(
            name=f"{weapon} grip",
            translation=attach[1],
            rotation=gltf.quat_from_matrix(attach[0]),
            children=[weapon_node],
            extras={"weapon": weapon, "weldBone": "Bip01 R Hand"},
        ))
        builder._nodes[joint_nodes["bip01 r hand"]].children.append(grip_node)

    root = builder.add_node(gltf.Node(
        name=f"{soldier} {weapon} viewmodel",
        rotation=gltf.quat_from_ypr(0.0, -90.0, 0.0),
        children=root_children,
        extras={"soldier": soldier, "weapon": weapon, "viewmodel": True},
    ))

    # Baked animations. Every animation carries every bone any family's 1P
    # clip animates, plus every bound weapon part — a bone this clip leaves
    # alone holds the base pose (or the weapon rest) as a two-key constant —
    # so a viewer crossfading two clips never mixes an animated bone against
    # an unanimated one.
    rest_by_name = {
        ske_mod.canonical(bone.name): (bone.rotation, bone.translation)
        for bone in skeleton.bones}
    animated = sorted({
        name
        for entry in clips.values() if entry["upper"] is not None
        for name in entry["upper"].local_pose(0)
    } & set(joint_nodes))
    weapon_rest: dict[str, pose_mod.RT] = {}
    main_key: str | None = None
    if weapon_skeleton is not None and main_index is not None:
        main_key = ske_mod.canonical(weapon_skeleton.bones[main_index].name)
        for index, bone in enumerate(weapon_skeleton.bones):
            key = ske_mod.canonical(bone.name)
            if key in bound_nodes:
                weapon_rest[key] = _under_grip(
                    weapon_skeleton.relative(index, main_index))
        # A bound part sits on the skeleton the assembler placed it with: the
        # nearest `createSkeleton` at or above it (`Assembler._skeleton_scope`),
        # which for a hand weapon is the AnimatedBundle's. A few mod weapons
        # declare a different one on the weapon template (FH's SVT40: the
        # template names `Type5.ske`, its `SVT40Complex` names `SVT40.ske`), and
        # `weapon_skeleton.relative` then put the SVT's charging handle and
        # magazine 90 degrees off in every family that carries no weapon clip:
        # the handle stood up as a 30 cm tube until a shot's fire clip wrote
        # the authored value and snapped it back.
        for key, rest in bound_part_rests(library, meshes, weapon_template,
                                          weapon_skeleton, main_index).items():
            if key in bound_nodes:
                weapon_rest[key] = rest
        # The node's own transform is the assembler's (the weapon's model
        # convention); every family overwrites it, and a viewer that shows
        # the rig before any clip runs should see the same rest.
        for key, rest in weapon_rest.items():
            node = builder.node(bound_nodes[key])
            node.translation = rest[1]
            node.rotation = gltf.quat_from_matrix(rest[0])
    # Whether the grip wrapper is animated at all. Only eight vanilla weapons
    # move their own main bone (`weapon_main_local`), and a rig that does not
    # needs no wrapper track: the node simply keeps its authored weld. A rig
    # that does needs one in *every* family, including the still ones, or a
    # crossfade out of the throw mixes an animated wrapper against an
    # unanimated one — the same rule the joints follow above.
    grips = (grip_node is not None and main_key is not None
             and any(entry.get("weapon") is not None
                     and main_key in {ske_mod.canonical(track.name)
                                      for track in entry["weapon"].bones}
                     for entry in clips.values()))

    for key, entry in clips.items():
        upper: baf.Animation | None = entry["upper"]
        weapon_clip: baf.Animation | None = entry.get("weapon")
        if upper is not None:
            speed = entry["ref"].speed
            loop = bool(entry["loop"])
            times = clip_times(upper.frames, speed, loop)
            # A loop's key list ends on frame 0 again (see clip_times), so the
            # sampled frame indices wrap once.
            frame_index = list(range(upper.frames)) + ([0] if loop and upper.frames > 1 else [])
            frame_locals = [
                pose_mod.align_clip_roots(skeleton, upper.local_pose(f))
                for f in frame_index]
        elif weapon_clip is None or weapon_skeleton is None or main_index is None:
            # Nothing bakable (the weapon channel failed to read, or the
            # weapon has no readable skeleton to pose its parts against).
            # Record it and leave the family out of the glb rather than
            # baking an animation that moves nothing.
            clip_report[key] = {"error": "no readable clip for a family "
                                         "whose state declares no 1P clip"}
            continue
        else:
            # Weapon-channel-only family (the knife's fire): no joint motion
            # of its own, and its time base is the weapon clip's own span.
            loop = clip_loops(entry["weaponRef"])
            times = clip_times(weapon_clip.frames, entry["weaponRef"].speed, loop)
            frame_locals = None
        tracks = []
        if frame_locals is not None:
            for name in animated:
                if name in frame_locals[0]:
                    values = [locals_f.get(name, base_locals.get(
                        name, rest_by_name[name])) for locals_f in frame_locals]
                    tracks.append((joint_nodes[name], times, values))
                else:
                    value = base_locals.get(name, rest_by_name[name])
                    tracks.append((joint_nodes[name],
                                   (times[0], times[-1]), [value, value]))
        else:
            # Keep every joint as a two-key constant at the base pose, so a
            # viewer crossfading this clip against an arms clip never mixes an
            # animated bone against an unanimated one (see the `animated`
            # comment above).
            for name in animated:
                value = base_locals.get(name, rest_by_name[name])
                tracks.append((joint_nodes[name],
                               (times[0], times[-1]), [value, value]))
        if weapon_clip is not None and weapon_skeleton is not None \
                and main_index is not None:
            weapon_speed = entry["weaponRef"].speed
            weapon_loop = clip_loops(entry["weaponRef"])
            weapon_times = clip_times(weapon_clip.frames, weapon_speed, weapon_loop)
            weapon_index = list(range(weapon_clip.frames)) + (
                [0] if weapon_loop and weapon_clip.frames > 1 else [])
            per_frame = [weapon_part_locals(weapon_clip, weapon_skeleton,
                                            main_index, f)
                         for f in weapon_index]
            clip_bones = {ske_mod.canonical(track.name)
                          for track in weapon_clip.bones}
            for bone_key, node_index in bound_nodes.items():
                if bone_key in clip_bones:
                    tracks.append((node_index, weapon_times,
                                   [frame[bone_key] for frame in per_frame]))
                elif bone_key in weapon_rest:
                    tracks.append((node_index, (times[0], times[-1]),
                                   [weapon_rest[bone_key]] * 2))
            # The grip wrapper. A clip that moves the weapon's own main bone
            # moves the whole weapon in the hand, which `weapon_part_locals`
            # deliberately factors out of the bound parts — so it has to land
            # here or it lands nowhere (`weapon_main_local`).
            if grips:
                if main_key in clip_bones:
                    tracks.append((grip_node, weapon_times,
                                   weapon_main_track(weapon_clip,
                                                     weapon_skeleton,
                                                     main_index, weapon_index,
                                                     attach)))
                else:
                    tracks.append((grip_node, (times[0], times[-1]),
                                   [attach, attach]))
        else:
            for bone_key, node_index in bound_nodes.items():
                if bone_key in weapon_rest:
                    tracks.append((node_index, (times[0], times[-1]),
                                   [weapon_rest[bone_key]] * 2))
            if grips:
                tracks.append((grip_node, (times[0], times[-1]),
                               [attach, attach]))
        builder.add_animation(key, tracks)
        clip_report[key]["frames"] = (upper.frames if upper is not None
                                      else weapon_clip.frames)
        # One full pass in seconds -- the engine's 1/|speed|, not a frame
        # count over an authoring rate (clip_span).
        clip_report[key]["duration"] = round(times[-1], 4)

    result["soldierParts"] = part_report
    result["weaponParts"] = weapon_report.parts
    result["boundParts"] = sorted(bound_nodes)
    # True when a weapon-channel clip moves the whole weapon in the hand, so
    # the `<weapon> grip` node is animated rather than a static weld — the
    # throw, and the seven other vanilla weapons that do the same.
    result["gripAnimated"] = grips
    result["texturesMissing"] = sorted(
        set(report.missing_textures + weapon_report.missing_textures))

    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{soldier}__{weapon}.fp.glb"
    # Skinned mesh nodes sit at the scene root, never under the pitched root —
    # same three.js bind-matrix reasoning as extract_pose (see the comment
    # there); the joints carry the pitch and that is what poses the mesh.
    roots = [root] + skinned_roots
    extras = {key: value for key, value in result.items()
              if key not in ("soldierParts", "weaponParts")}
    target.write_bytes(builder.build(roots, extras=extras))
    result["glb"] = target.name
    (out / f"{soldier}__{weapon}.fp.report.json").write_text(
        json.dumps(result, indent=2))
    return result


def export_graft(soldier: str, weapon: str, *, objects, meshes, textures,
                 library, max_texture: int, out: Path | None) -> dict:
    """A weapon the state machine never names, as a first-person graft: the
    weapon welded under a `<weapon> grip` node and nothing else -- no sleeves,
    no hands, no clips.

    `BFSoldier::enableItem` (lnxded 0x08278460) raises a weapon with
    `setAnimationState(1, "Ub_{Stand,Crouch,Lie}RaiseWeapon" + <template>)`,
    and `setAnimationState` (0x0826cee0) does nothing when `findState` misses,
    so the arms stay in the state they were in: the weapon held before, its
    clip on the 1P skeleton and its transitions answering fire and reload.
    What `enableItem` does change is the rig's offset -- `soldierCameraPosition`
    of the new weapon is copied onto the soldier (+0x248..+0x250) before the
    state is asked for -- and the first-person field of view. So this file
    carries the weld (the weapon's own `.ske`, `useSkeletonPartAsMain`), the
    weapon's armoury block and its view numbers, and `extras.graft`; the
    viewer hangs the grip under the hand of the rig already mounted
    (`viewer/arms-rig.js` `graftRig`). Desert Combat's `Mortar_weap`, whose
    machine declares only the seat's `Ub_/Lb_KneelMortar`, is the case.
    """
    result: dict = {"soldier": soldier, "weapon": weapon, "graft": True, "clips": {}}
    root_template = library.object(soldier)
    if root_template is None or not root_template.skeleton:
        raise PoseError(f"{soldier} declares no skeleton")
    weapon_template = library.object(weapon)
    if weapon_template is None:
        raise PoseError(f"no such weapon template: {weapon}")
    weapon_skeleton = (read_skeleton(meshes, weapon_template.skeleton)
                       if weapon_template.skeleton else None)
    if weapon_skeleton is not None:
        main_index = weapon_skeleton.main_index(
            weapon_template.skeleton_main, weapon)
        attach = pose_mod.weapon_attachment(weapon_skeleton, main_index,
                                            clip_posed=True)
    else:
        attach = (pose_mod.CLIP_WORLD_YAW, (0.0, 0.0, 0.0))
        result["weaponSkeleton"] = "unreadable, attached at hand root"
    result["view"] = {
        **soldier_view_constants(objects, root_template),
        "soldierCameraPosition": (
            list(weapon_template.soldier_camera_position)
            if weapon_template.soldier_camera_position else None),
        "soldierZoomPosition": (
            list(weapon_template.soldier_zoom_position)
            if weapon_template.soldier_zoom_position else None),
        "soldierZoomFov": weapon_template.soldier_zoom_fov,
        "zoomFov": weapon_template.zoom_fov,
    }
    stats = weapon_block(weapon_template)
    if stats:
        result["weaponStats"] = stats
    if out is None:
        return result

    builder = gltf.GlbBuilder()
    assembler = Assembler(meshes, textures, objects, library,
                          max_texture=max_texture, include_collision=False)
    weapon_report = Report(root=weapon, configuration="complex", lod=0)
    weapon_node = assembler.build_node(builder, weapon, weapon_report)
    if weapon_node is None:
        raise PoseError(f"{weapon} produced no mesh")
    grip = builder.add_node(gltf.Node(
        name=f"{weapon} grip",
        translation=attach[1],
        rotation=gltf.quat_from_matrix(attach[0]),
        children=[weapon_node],
        extras={"weapon": weapon, "weldBone": "Bip01 R Hand"},
    ))
    result["weaponParts"] = weapon_report.parts
    result["texturesMissing"] = sorted(set(weapon_report.missing_textures))
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{soldier}__{weapon}.fp.glb"
    extras = {key: value for key, value in result.items() if key != "weaponParts"}
    target.write_bytes(builder.build([grip], extras=extras))
    result["glb"] = target.name
    (out / f"{soldier}__{weapon}.fp.report.json").write_text(
        json.dumps(result, indent=2))
    return result


# --- the level's paint over a rig -----------------------------------------
#
# The rigs are extracted once a mod, with no level loaded, so every texture in
# them is the one the mod's archives answer for the path the shader wrote. The
# game never draws a rig that way: a level is loaded first, and its Init.con
# has usually added alternative texture paths (130 of FHSW's 162 levels change
# at least one texture some arms rig carries). What follows resolves each rig
# image again as each baked level would and writes the difference.

SKIN_DIR = "skins"
SKIN_INDEX = "skins.json"
SKIN_SUFFIX = ".skin.glb"


def glb_image_names(path: Path) -> list[str]:
    """The `name` of every image a glb carries (the archive entry it was read
    from, `Assembler._texture_index`), embedded or moved to the texture store."""
    with open(path, "rb") as handle:
        head = handle.read(20)
        if len(head) < 20 or head[:4] != b"glTF":
            return []
        length = int.from_bytes(head[12:16], "little")
        doc = json.loads(handle.read(length))
    return [image["name"] for image in doc.get("images", []) if image.get("name")]


def inherited_rig_dirs(out: Path) -> list[Path]:
    """The trees whose rigs a page on `out`'s mod can mount: `out`, and for a
    mod's tree (`<models>/mods/<id>/viewmodels`) vanilla's beside it, where the
    viewer finds the pairs the mod inherits (`pose-bases.js` `poseBases`)."""
    dirs = [out]
    if out.parent.parent.name == "mods":
        dirs.append(out.parent.parent.parent / out.name)
    return dirs


def rig_images(dirs: list[Path]) -> list[str]:
    """Every image the arms rigs in `dirs` carry, once each ignoring case."""
    seen: dict[str, str] = {}
    for folder in dirs:
        for path in sorted(folder.glob("*.fp.glb")):
            for name in glb_image_names(path):
                seen.setdefault(name.lower(), name)
    return sorted(seen.values(), key=str.lower)


def _named_glbs(node, found: set[str]) -> None:
    """Every string under a `glb` key of a kits.json tree."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "glb" and isinstance(value, str) and value:
                found.add(value)
            else:
                _named_glbs(value, found)
    elif isinstance(node, list):
        for value in node:
            _named_glbs(value, found)


def soldier_glbs(models: Path) -> list[Path]:
    """The glbs of a models tree that the page mounts on a soldier at run
    time, none of them baked into a level:

    - everything under `poses/`: the bodies (`rigs/<Soldier>.rig.glb`, the
      monolithic `<Soldier>__<Pose>.pose.glb`), the seat poses and the
      parachute canopy (`pose-compose.js`, `foot-body.js`);
    - what kits.json names: each kit's worn parts and the pickup mesh it
      drops (`soldier-dress.js`, `kit-drops-page.js`);
    - the model of every item a kit hands out, which a split pose grafts
      into the hand and the first person draws bare where a pair has no arms
      rig (`pose-bases.js` `weaponUrls`, `arms-rig.js` `fetchRig`);
    - each kit soldier's own model, a replay's and the room's last resort.

    A tree without kits.json answers with its poses alone."""
    found: dict[str, Path] = {}
    poses = models / "poses"
    if poses.is_dir():
        for path in poses.rglob("*.glb"):
            found.setdefault(str(path).lower(), path)
    kits_file = models / "kits.json"
    try:
        kits = json.loads(kits_file.read_text()) if kits_file.is_file() else {}
    except (OSError, ValueError):
        kits = {}
    named: set[str] = set()
    _named_glbs(kits, named)
    from extract_models import model_file_stem
    for kit in (kits.get("kits") or []) if isinstance(kits, dict) else []:
        for item in kit.get("items") or []:
            if item.get("template"):
                named.add(f"{model_file_stem(item['template'])}.glb")
        for soldier in [*(kit.get("soldiers") or []), *(kit.get("pickupSoldiers") or [])]:
            named.add(f"{model_file_stem(soldier)}.glb")
    for name in named:
        path = models / name
        if path.is_file():
            found.setdefault(str(path).lower(), path)
    return sorted(found.values(), key=lambda path: str(path).lower())


def soldier_images(models_dirs: list[Path]) -> list[str]:
    """Every image the soldier glbs of `models_dirs` carry (`soldier_glbs`),
    once each ignoring case."""
    seen: dict[str, str] = {}
    for models in models_dirs:
        for path in soldier_glbs(models):
            for name in glb_image_names(path):
                seen.setdefault(name.lower(), name)
    return sorted(seen.values(), key=str.lower)


def painted_images(out: Path) -> list[str]:
    """Every image a level can repaint on what a page on `out`'s tree mounts
    at run time: the arms rigs in `out` and the soldier glbs of the models
    tree `out` sits in, and vanilla's of both for a mod's tree."""
    rig_dirs = inherited_rig_dirs(out)
    seen: dict[str, str] = {}
    for name in [*rig_images(rig_dirs),
                 *soldier_images([folder.parent for folder in rig_dirs])]:
        seen.setdefault(name.lower(), name)
    return sorted(seen.values(), key=str.lower)


def level_skin(textures: ArchivePool, images: list[str],
               alternative_paths: list[str]) -> dict[str, str]:
    """The textures a level paints over the rigs: rig image -> the archive
    entry the level reads in its place, for each of `images` that the level's
    alternative paths answer with another file. The engine's rule (ledger
    LOAD-3): the file's name under each `textureManager.alternativePath`, in
    the order declared, the first that opens, before the name as written."""
    out: dict[str, str] = {}
    if not alternative_paths:
        return out
    textures.set_alternative_paths(alternative_paths)
    try:
        for name in images:
            stem = name.rsplit(".", 1)[0] if name.lower().endswith(TEXTURE_EXTS) else name
            hit = textures.resolve_ext(stem, TEXTURE_EXTS)
            if hit and hit.lower() != name.lower():
                out[name] = hit
    finally:
        textures.set_alternative_paths([])
    return out


def level_alternative_paths(game_dir: Path, mod: str, level: str,
                            chain: list[Path]) -> list[str]:
    """A level's `textureManager.alternativePath` list, in the order its
    Init.con declares it, read as a Conquest host runs the script."""
    from bf42.level import (LevelInfo, find_level_archives, load_level_files,
                            parse_init_con)
    paths = find_level_archives(game_dir, mod, level, chain=chain)
    if not paths:
        return []
    files = load_level_files(paths, level)
    info = LevelInfo(name=level, terrain=None)
    for script in ("Init.con", "Init/SkyAndSun.con"):
        if files.find(script):
            parse_init_con(files.read(script).decode("latin-1", "replace"), info)
    return list(info.texture_alternative_paths)


def mount_chain_levels(textures: ArchivePool, chain: list[Path]) -> None:
    """Every level archive of the chain at its own path, as a level load finds
    them (`extract_map.mount_level_pools`): an alternative path is as often a
    level archive's folder (FHSW's `bf1942/levels/_TEXTURE_SPECIAL/texture/...`)
    as one of `texture.rfa`'s."""
    import struct
    from extract_map import chain_level_archives
    for level_path in chain_level_archives(chain):
        try:
            textures.mount_level(level_path, TEXTURE_EXTS)
        except (OSError, struct.error, ValueError) as exc:
            print(f"  skipping unreadable level archive {level_path.name}: {exc}",
                  file=sys.stderr)


def build_level_skin(level: str, skin: dict[str, str], assembler: Assembler,
                     ) -> tuple[bytes | None, dict[str, str]]:
    """A level's paint as a glb: one material a texture, each on a triangle of
    its own so a glTF loader keeps it. The material is named for the rig image
    it replaces and its image for the level's file. Returns the bytes (None
    when nothing decoded) and the pairs that made it in."""
    builder = gltf.GlbBuilder()
    # The assembler remembers a texture by its index in the document it last
    # put it in; each skin is a document of its own.
    assembler._texture_cache.clear()
    report = Report(root=level, configuration="skin", lod=0)
    primitives: list[gltf.Primitive] = []
    kept: dict[str, str] = {}
    for name, entry in sorted(skin.items(), key=lambda item: item[0].lower()):
        texture = assembler._texture_index(builder, entry, report)
        if texture is None:
            print(f"  {level}: {entry} did not decode, {name} keeps the rig's own",
                  file=sys.stderr)
            continue
        material = builder.add_material(name=name, texture=texture)
        row = float(len(primitives))
        primitives.append(gltf.Primitive(
            positions=[(0.0, row, 0.0), (1.0, row, 0.0), (0.0, row + 1.0, 0.0)],
            indices=[0, 1, 2],
            normals=[(0.0, 0.0, 1.0)] * 3,
            uvs=[(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)],
            material=material))
        kept[name] = entry
    if not primitives:
        return None, kept
    mesh = builder.add_mesh(f"{level} skin", primitives)
    node = builder.add_node(gltf.Node(name=f"{level} skin", mesh=mesh))
    return builder.build([node], extras={"levelSkin": {"level": level,
                                                       "textures": kept}}), kept


def level_dir_name(entry: dict) -> str:
    """The folder a maps.json row's level is baked into, which is what the
    page knows the level by (`level.currentDir`)."""
    glb = str(entry.get("glb") or "")
    return glb.split("/", 1)[0] if "/" in glb else entry["name"].lower()


def maps_tree_for(out: Path) -> Path:
    """The maps tree beside `out`'s models tree: `viewer/maps` for
    `viewer/models/viewmodels`, `viewer/maps/mods/<id>` for
    `viewer/models/mods/<id>/viewmodels`."""
    models = out.parent
    if models.parent.name == "mods":
        return models.parent.parent.parent / "maps" / "mods" / models.name
    return models.parent / "maps"


def model_catalogues(out: Path) -> list[tuple[Path, dict[str, dict]]]:
    """Each models tree a page on `out`'s mod loads a vehicle from, in the
    order it asks (`pose-bases.js` `poseBases`: the mod's, then vanilla's),
    with its models.json rows by lower-case name."""
    found = []
    for rigs in inherited_rig_dirs(out):
        models = rigs.parent
        try:
            rows = json.loads((models / "models.json").read_text())
        except (OSError, ValueError):
            rows = []
        found.append((models, {str(row.get("name", "")).lower(): row
                               for row in rows if isinstance(row, dict)}))
    return found


def pad_template_glbs(catalogues: list[tuple[Path, dict[str, dict]]], template: str,
                      level: str) -> list[Path]:
    """The glbs the page loads for a pad's `template` from the models tree
    (`vehicle-wrecks.js` `variantUrls`): the drawn model, the level's variant
    where there is one, and its wreck, from the first tree whose catalogue
    names it, else `<stem>.glb` in the first tree holding one."""
    from extract_models import model_file_stem
    key = template.lower()
    for models, rows in catalogues:
        row = rows.get(key)
        if row is None:
            continue
        out = []
        for configuration in ("complex", "wreck"):
            found = [v for v in row.get("variants") or []
                     if v.get("glb") and v.get("configuration") == configuration
                     and not v.get("firstPerson")]
            pick = (next((v for v in found if str(v.get("level") or "").lower()
                          == level.lower()), None)
                    or next((v for v in found if not v.get("level")), None)
                    or (found[0] if found else None))
            glb = pick["glb"] if pick else (row.get("glb") if configuration == "complex" else None)
            if glb and (models / glb).is_file():
                out.append(models / glb)
        return out
    for models, _rows in catalogues:
        path = models / f"{model_file_stem(template)}.glb"
        if path.is_file():
            return [path]
    return []


def pad_images(catalogues: list[tuple[Path, dict[str, dict]]], scene: Path,
               level: str) -> list[str]:
    """Every image of the vehicles a level's pads hand out (`objectSpawns`
    `templates`, each side's, in every game mode), as the models tree holds
    them. The page loads the side its bake did not place from that tree
    (`level-statics.js` `loadPadVariants`), so the level's alternative paths
    (ledger LOAD-3) must repaint them as they repaint the soldiers:
    doomed_budapest's Zrinyi and Nimrod read `GENERAL_HUN_WINTER`."""
    try:
        report = json.loads(scene.read_text())
    except (OSError, ValueError):
        return []
    templates: dict[str, str] = {}
    layers = [report, *((report.get("modes") or {}).values())]
    for layer in layers:
        for spawn in (layer or {}).get("objectSpawns") or []:
            for name in ((spawn or {}).get("templates") or {}).values():
                if isinstance(name, str) and name:
                    templates.setdefault(name.lower(), name)
    seen: dict[str, str] = {}
    for name in sorted(templates.values(), key=str.lower):
        for path in pad_template_glbs(catalogues, name, level):
            for image in glb_image_names(path):
                seen.setdefault(image.lower(), image)
    return sorted(seen.values(), key=str.lower)


def expected_level_skins(out: Path, maps: list[dict], *, game_dir: Path,
                         mod: str, chain: list[Path], textures: ArchivePool,
                         considered: list[str] | None = None) -> dict[str, dict]:
    """What each level of `maps` repaints on what a page on `out`'s tree
    mounts at run time (`painted_images`: the arms rigs and the soldiers'
    bodies, weapons and kits; `pad_images`: the level's pad vehicles as the
    models tree holds them): level folder -> `{"level": name, "textures":
    level_skin}`, for the levels that repaint anything. Read from the install;
    `audit_mod.py` holds skins.json to it. Mounts the chain's level archives
    into `textures`. `considered`, when given, collects the folder name of
    every level whose Init.con read, repainting or not."""
    images = painted_images(out)
    mount_chain_levels(textures, chain)
    catalogues = model_catalogues(out)
    maps_tree = maps_tree_for(out)
    levels: dict[str, dict] = {}
    for entry in maps:
        level = entry["name"]
        pads = pad_images(catalogues, maps_tree / str(entry.get("report") or ""), level)
        level_images = images
        if pads:
            seen = {name.lower() for name in images}
            level_images = [*images, *(name for name in pads if name.lower() not in seen)]
        try:
            skin = level_skin(textures, level_images,
                              level_alternative_paths(game_dir, mod, level, chain))
        except (OSError, KeyError, ValueError) as exc:
            print(f"  {level}: no skin, its Init.con did not read ({exc})",
                  file=sys.stderr)
            continue
        if considered is not None:
            considered.append(level_dir_name(entry))
        if skin:
            levels[level_dir_name(entry)] = {"level": level, "textures": skin}
    return levels


def write_level_skins(out: Path, maps: list[dict], *, game_dir: Path, mod: str,
                      chain: list[Path], textures: ArchivePool,
                      assembler: Assembler) -> dict:
    """`skins/<level>.skin.glb` and `skins.json` in `out`, for every level of
    `maps` whose alternative paths repaint a texture some rig a page on this
    tree can mount carries. A level that repaints nothing has no row, and a
    skin file no row names is removed."""
    considered: list[str] = []
    expected = expected_level_skins(out, maps, game_dir=game_dir, mod=mod,
                                    chain=chain, textures=textures, considered=considered)
    folder = out / SKIN_DIR
    levels: dict[str, dict] = {}
    for key, row in expected.items():
        blob, kept = build_level_skin(row["level"], row["textures"], assembler)
        if blob is None:
            continue
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{key}{SKIN_SUFFIX}").write_bytes(blob)
        levels[key] = {"level": row["level"],
                       "file": f"{SKIN_DIR}/{key}{SKIN_SUFFIX}",
                       "textures": kept}
    if folder.is_dir():
        for path in folder.iterdir():
            # The glb and the `.glb.gz` optimise_mesh.py writes beside it.
            if SKIN_SUFFIX in path.name \
                    and path.name.split(SKIN_SUFFIX, 1)[0] not in levels:
                path.unlink()
    # `considered` is every level of `maps` this run looked at, so a reader can
    # tell a level that repaints nothing (considered, no row) from a level the
    # run never saw (neither): `mod_pipeline.py verify`'s v_levels asks.
    index = {"levels": levels, "considered": sorted(considered)}
    out.mkdir(parents=True, exist_ok=True)
    (out / SKIN_INDEX).write_text(json.dumps(index, indent=1, sort_keys=True) + "\n")
    return index


def write_index(out: Path) -> list[str]:
    """`index.json` in `out`: the stem of every `<Soldier>__<Weapon>.fp.glb`
    there, sorted - what `arms-rig.js` looks a pairing up in."""
    stems = sorted(path.name[:-len(".fp.glb")] for path in out.glob("*.fp.glb"))
    (out / "index.json").write_text(json.dumps(stems, indent=1) + "\n")
    return stems


# Each pair writes its own `<Soldier>__<Weapon>.fp.glb` and report, and reads
# only the archives, the state machine and the library that were built once
# before the fork. A worker is a fork of this process (`forked_workers`), so it
# shares those pages until it writes them.
PER_WORKER_BYTES = 400 << 20
_worker_state: dict = {}


def _export_pair(pair: tuple[str, str], out: Path, context: dict) -> tuple:
    """`(families, glb name, error)` for one soldier/weapon pair."""
    soldier, weapon = pair
    try:
        result = export_viewmodel(soldier, weapon, out=out, **context)
    except PoseError as exc:
        return None, None, str(exc)
    families = [key for key, entry in result["clips"].items() if "error" not in entry]
    return families, result.get("glb"), None


def _init_pair_worker(state: dict) -> None:
    """A forked worker's start: the parent's state by name, and a file handle
    of its own on every archive it inherited (`ArchivePool.reopen`)."""
    _worker_state.clear()
    _worker_state.update(state)
    for pool in state["pools"]:
        pool.reopen()


def _export_pair_task(pair: tuple[str, str]) -> tuple:
    state = _worker_state
    return _export_pair(pair, state["out"], state["context"])


def _export_level_task(level: str) -> list[tuple[tuple[str, str], tuple]]:
    """Every rig `level`'s own load is the host for (`level_rig_hosts`)."""
    state = _worker_state
    meshes, textures, objects = state["pools"]
    pairs = state["hosts"][level]
    try:
        context = level_rig_context(state["chain"], level, meshes, textures,
                                    objects, state["max_texture"])
    except Exception as exc:  # noqa: BLE001 - one unreadable level
        return [(pair, (None, None, f"{level}: level load failed ({exc})"))
                for pair in pairs]
    return [(pair, _export_pair(pair, state["out"], context)) for pair in pairs]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pairs", nargs="*",
                    help="soldier weapon [soldier weapon ...]")
    ap.add_argument("-j", "--jobs", type=int, default=os.cpu_count() or 1,
                    help="rigs exported at a time, each in a forked worker "
                         "(default: every CPU; capped by free memory)")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent
                    / "viewer" / "models" / "viewmodels")
    ap.add_argument("--max-texture", type=int, default=1024)
    ap.add_argument("--kits", type=Path, default=None,
                    help="also export every soldier/item pair this kits.json hands out")
    ap.add_argument("--maps", type=Path, default=None,
                    help="with --kits: only kits a level in this maps.json uses")
    ap.add_argument("--level", action="append", default=[],
                    help="a level whose own load may declare a positional "
                         "pair's weapon (repeatable; --kits finds them itself)")
    ap.add_argument("--level-skins-only", action="store_true",
                    help="with --maps: rewrite skins/ and skins.json for the "
                         "rigs already in --out, and export no rig")
    args = ap.parse_args()

    if args.level_skins_only:
        if not args.maps:
            ap.error("--level-skins-only needs --maps")
        game_dir = args.game_dir.expanduser()
        chain = mod_chain(game_dir, args.mod)
        meshes, textures, objects, _game = build_pools(chain, [])
        skins = write_level_skins(
            args.out, json.loads(args.maps.read_text()), game_dir=game_dir,
            mod=args.mod, chain=chain, textures=textures,
            assembler=Assembler(meshes, textures, objects, con_mod.ObjectLibrary(),
                                max_texture=args.max_texture,
                                include_collision=False))
        print(f"skins.json: {len(skins['levels'])} levels repaint a rig or a soldier",
              file=sys.stderr)
        return 0

    if len(args.pairs) % 2:
        ap.error("give soldier/weapon pairs, e.g. USSoldier Thompson")
    pairs = list(zip(args.pairs[::2], args.pairs[1::2]))
    pair_levels: dict[tuple[str, str], list[str]] = {
        (soldier.lower(), weapon.lower()): sorted(l.lower() for l in args.level)
        for soldier, weapon in pairs}
    if args.kits:
        levels = None
        if args.maps:
            levels = {entry["name"].lower()
                      for entry in json.loads(args.maps.read_text())}
        from_kits = kit_pair_levels(json.loads(args.kits.read_text()), levels)
        pair_levels.update(from_kits)
        pairs += list(from_kits)
    if not pairs:
        ap.error("give soldier/weapon pairs, e.g. USSoldier Thompson, or --kits")

    game_dir = args.game_dir.expanduser()
    chain = mod_chain(game_dir, args.mod)
    meshes, textures, objects, _game = build_pools(chain, [])
    library = build_library(objects)
    machine = state_machine(meshes)
    context = dict(machine=machine, meshes=meshes, textures=textures,
                   objects=objects, library=library,
                   max_texture=args.max_texture)

    # A pair listed twice is one rig: both would write the same files.
    pairs = list(dict.fromkeys(pairs))
    # A weapon only a level declares is built through that level's load.
    declared: dict[str, set[str]] = {}

    def declared_by(level: str) -> set[str]:
        if level not in declared:
            try:
                declared[level] = level_declared(chain, level)
            except Exception as exc:  # noqa: BLE001 - one unreadable level
                print(f"  {level}: level scripts unreadable ({exc})", file=sys.stderr)
                declared[level] = set()
        return declared[level]

    hosts, pairs = level_rig_hosts(pairs, pair_levels, library, declared_by)
    failures = 0
    dangling = 0
    level_failures = 0

    def report(pair: tuple[str, str], answer: tuple, level: str | None = None) -> None:
        nonlocal failures, dangling, level_failures
        soldier, weapon = pair
        families, glb, error = answer
        if error is not None:
            where = f" (through {level})" if level else ""
            print(f"{soldier} + {weapon}: {error}{where}", file=sys.stderr)
            failures += 1
            # A weapon the level that hands it out declares, and no rig: ours.
            level_failures += level is not None
            # A kit naming a template neither the chain nor any level that
            # hands it out declares: the mod's data, counted apart.
            dangling += error.startswith("no such weapon template")
            return
        where = f" (through {level})" if level else ""
        print(f"{soldier} + {weapon}: clips [{', '.join(families)}] "
              f"-> {glb}{where}", file=sys.stderr)

    jobs = memory_capped_jobs(args.jobs, len(pairs), PER_WORKER_BYTES, available_bytes())
    if jobs > 1:
        print(f"{len(pairs)} rigs in {jobs} workers", file=sys.stderr)
        state = {"pools": (meshes, textures, objects), "context": context,
                 "out": args.out}
        with forked_workers(jobs, _init_pair_worker, (state,)) as executor:
            for pair, answer in zip(pairs, executor.map(_export_pair_task, pairs)):
                report(pair, answer)
    else:
        for pair in pairs:
            report(pair, _export_pair(pair, args.out, context))

    # Then the levels' own weapons, one level's load per task: the load is the
    # chain's library built again, so the workers are capped by its size.
    if hosts:
        levels_in_order = sorted(hosts)
        print(f"{sum(map(len, hosts.values()))} rigs of weapons only a level "
              f"declares, through {len(hosts)} levels' loads", file=sys.stderr)
        per_load = max(PER_WORKER_BYTES, resident_bytes())
        jobs = memory_capped_jobs(args.jobs, len(hosts), per_load, available_bytes())
        state = {"pools": (meshes, textures, objects), "chain": chain,
                 "hosts": hosts, "out": args.out, "max_texture": args.max_texture}
        if jobs > 1:
            with forked_workers(jobs, _init_pair_worker, (state,)) as executor:
                answers = list(executor.map(_export_level_task, levels_in_order))
        else:
            _worker_state.clear()
            _worker_state.update(state)
            answers = [_export_level_task(level) for level in levels_in_order]
        for level, answered in zip(levels_in_order, answers):
            for pair, answer in answered:
                report(pair, answer, level)
    if dangling:
        print(f"{dangling} pairs name a weapon template nothing declares "
              f"(the chain, or a level that hands it out)", file=sys.stderr)
    if level_failures:
        print(f"{level_failures} pairs a level declares the weapon of and no rig "
              f"was built for: exit 2", file=sys.stderr)
    if args.out.is_dir():
        print(f"index.json: {len(write_index(args.out))} rigs", file=sys.stderr)
    # The levels' own paint over those rigs, last: mounting the level archives
    # must not move what a rig's own texture resolved to.
    if args.maps and args.out.is_dir():
        skins = write_level_skins(
            args.out, json.loads(args.maps.read_text()), game_dir=game_dir,
            mod=args.mod, chain=chain, textures=textures,
            assembler=Assembler(meshes, textures, objects, library,
                                max_texture=args.max_texture,
                                include_collision=False))
        print(f"skins.json: {len(skins['levels'])} levels repaint a rig or a soldier",
              file=sys.stderr)
    # 2: a weapon a level declares and hands out has no rig, which is this
    # pipeline's gap and stops the recipe (mod_pipeline tolerates 1 only);
    # 1: findings in the mod's data (a clip or a template nothing ships).
    return 2 if level_failures else 1 if failures else 0


if __name__ == "__main__":
    # Every glb this wrote moves its textures into the shared store
    # (optimise_mesh.py, features/mesh-asset-size); `--no-optimise` opts out.
    from optimise_mesh import run_then_optimise
    raise SystemExit(run_then_optimise(main, Path(__file__).resolve().parent / "viewer" / "models" / "viewmodels"))
