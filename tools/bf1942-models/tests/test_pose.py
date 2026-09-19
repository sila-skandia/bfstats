from __future__ import annotations

import math
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf, pose, ske, skin  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def pack_ske(bones: list[tuple[str, int, tuple, tuple]]) -> bytes:
    out = bytearray()
    out += struct.pack("<II", 1, len(bones))
    for name, parent, rotation, translation in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
        out += struct.pack("<h", parent)
        for row in range(3):
            out += struct.pack("<3f", *rotation[row])
            out += struct.pack("<f", translation[row])
    return bytes(out)


def pack_skn(vertices: list[tuple], bones: list[str]) -> bytes:
    out = bytearray()
    out += struct.pack("<II", 1, len(vertices))
    for rest, influences in vertices:
        out += struct.pack("<3f", *rest)
        out.append(len(influences))
        for bone, weight, offset in influences:
            out += struct.pack("<H", bone)
            out += struct.pack("<f", weight)
            out += struct.pack("<3f", *offset)
    out += struct.pack("<H", len(bones))
    for name in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
    return bytes(out)


def exclusive_cluster(bone: int, origin: tuple[float, float, float]) -> list[tuple]:
    """Four exclusively-weighted vertices spanning 3D so the bind recovers
    exactly: rest = origin + offset with an identity bind rotation."""
    verts = []
    for offset in ((0.0, 0.0, 0.0), (0.05, 0.0, 0.0),
                   (0.0, 0.05, 0.0), (0.0, 0.0, 0.05)):
        rest = tuple(o + d for o, d in zip(origin, offset))
        verts.append((rest, [(bone, 1.0, offset)]))
    return verts


class AlignClipRootsTests(unittest.TestCase):
    """Only a skeleton root's local transform is expressed in clip world,
    so only it picks up the clip world's 180-degree yaw."""

    def _skeleton(self) -> ske.Skeleton:
        return ske.parse(pack_ske([
            ("Bip01", -1, IDENTITY, (0.0, 0.0, 0.9)),
            ("Bip01 Spine", 0, IDENTITY, (0.1, 0.0, 0.0)),
        ]), "s.ske")

    def test_root_local_is_left_multiplied_by_the_yaw(self) -> None:
        locals_map = {"bip01": (IDENTITY, (1.0, 2.0, 3.0)),
                      "bip01 spine": (IDENTITY, (0.5, 0.0, 0.0))}

        aligned = pose.align_clip_roots(self._skeleton(), locals_map)

        self.assertEqual((-1.0, 2.0, -3.0), aligned["bip01"][1])
        self.assertEqual((0.5, 0.0, 0.0), aligned["bip01 spine"][1])

    def test_a_root_at_ske_rest_is_left_alone(self) -> None:
        # No clip track for the root: its rest local is already mesh space.
        locals_map = {"bip01 spine": (IDENTITY, (0.5, 0.0, 0.0))}

        aligned = pose.align_clip_roots(self._skeleton(), locals_map)

        self.assertNotIn("bip01", aligned)


class RemapCollisionTests(unittest.TestCase):
    """`Bone07..09` name both face bones in the skins and a forearm helper
    chain in `UsSoldier.ske`. A name match must also reproduce its `.ske`
    chain distance before it may drive vertices."""

    def _skeleton(self) -> ske.Skeleton:
        return ske.parse(pack_ske([
            ("Bip01 Spine3", -1, IDENTITY, (0.0, 0.0, 1.38)),
            ("Bip01 Head", 0, IDENTITY, (0.0, 0.0, 0.17)),
            ("Bip01 L Forearm", 0, IDENTITY, (0.0, 0.55, -0.10)),
            ("Bone07", 2, IDENTITY, (0.0, 0.05, 0.0)),
            ("Bone08", 3, IDENTITY, (0.0, 0.10, 0.0)),
        ]), "UsSoldier.ske")

    def _face_skin(self) -> skin.Skin:
        # Head, Spine3 and the "Bone07/08" face bones all cluster around the
        # skull, 1.5 m up - nowhere near the skeleton's forearm chain.
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.55))       # Bip01 Head
                 + exclusive_cluster(1, (0.0, 0.0, 1.38))     # Bip01 Spine3
                 + exclusive_cluster(2, (0.0, 0.10, 1.62))    # Bone07: face
                 + exclusive_cluster(3, (0.0, 0.12, 1.66)))   # Bone08: face
        return skin.parse(pack_skn(
            verts, ["Bip01 Head", "Bip01 Spine3", "Bone07", "Bone08"]), "face")

    def test_a_true_bone_keeps_driving_itself(self) -> None:
        skn = self._face_skin()
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        self.assertEqual("Bip01 Head", anchor)
        # Head to Spine3: 0.17 in the skeleton, 0.17 in the skin - kept.
        self.assertEqual("Bip01 Head", mapped[0])
        self.assertEqual("Bip01 Spine3", mapped[1])

    def test_a_colliding_name_anchors_instead(self) -> None:
        skn = self._face_skin()
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        # Skin Bone07 sits 0.24 from Spine3; skeleton Bone07 sits 0.68 away
        # through the forearm. Not the same bone.
        self.assertEqual(anchor, mapped[2])

    def test_the_failure_spreads_down_the_misnamed_chain(self) -> None:
        skn = self._face_skin()
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        # Bone08's nearest tested ancestor is Bone07, which failed.
        self.assertEqual(anchor, mapped[3])

    def test_an_unrecoverable_bind_anchors(self) -> None:
        # Two exclusive vertices cannot pin a bind; both skinning paths need
        # the bind to use the bone, so it must ride the anchor.
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.55))
                 + [((0.0, 0.12, 1.66), [(1, 1.0, (0.0, 0.0, 0.0))]),
                    ((0.0, 0.13, 1.66), [(1, 1.0, (0.01, 0.0, 0.0))])])
        skn = skin.parse(pack_skn(verts, ["Bip01 Head", "Bone08"]), "sparse")
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        self.assertEqual("Bip01 Head", anchor)
        self.assertEqual(anchor, mapped[1])

    def test_a_mirrored_skin_still_matches_by_bone_length(self) -> None:
        """The right-hand skins are X-mirrored against the skeleton as files.
        Distances are mirror-invariant, so the check must not flag them."""
        skeleton = ske.parse(pack_ske([
            ("Bip01 R Forearm", -1, IDENTITY, (0.30, 0.21, 1.21)),
            ("Bip01 R Hand", 0, IDENTITY, (0.0, 0.26, 0.06)),
        ]), "UsSoldier.ske")
        verts = (exclusive_cluster(0, (-0.30, 0.21, 1.21))
                 + exclusive_cluster(1, (-0.30, 0.47, 1.27)))
        skn = skin.parse(pack_skn(
            verts, ["Bip01 R Forearm", "Bip01 R Hand"]), "hand")
        binds = pose.refine_binds(skn)

        mapped, _ = pose.remap_influences(skn, skeleton, binds)

        self.assertEqual(["Bip01 R Forearm", "Bip01 R Hand"], mapped)


def mat_mul(a, b):
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
        for i in range(3))


class WeaponAttachmentTests(unittest.TestCase):
    """attach = rest(root)^-1 * rest(main). `clip_posed` re-expresses it for
    a hand posed from a `.baf` clip: clips pose bones in the *raw* `.ske`
    frame convention (`ske.parse` Z-mirror-conjugates, clip data never did),
    and the weapon's mesh-world geometry crosses into clip world through the
    same 180-degree yaw the clip root tracks get (`baf.ROOT_ALIGN`)."""

    def _weapon(self) -> ske.Skeleton:
        yaw90 = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        return ske.parse(pack_ske([
            ("Bip01 R Hand", -1, yaw90, (0.305, 0.0, 0.0)),
            ("Thompson", 0, IDENTITY, (0.05, 0.02, 0.0)),
        ]), "w.ske")

    def test_rest_attach_cancels_the_root(self) -> None:
        rotation, translation = pose.weapon_attachment(self._weapon(), 1)
        # Root's own rest must be gone: attach is main relative to root.
        self.assertEqual(IDENTITY, rotation)
        for got, want in zip(translation, (0.05, 0.02, 0.0)):
            self.assertAlmostEqual(want, got)

    def test_clip_posed_is_the_raw_relative_through_the_clip_world_yaw(self) -> None:
        # The raw records below never commute with either half-turn, so a
        # wrongly-sided correction cannot pass. pack_ske stores raw values;
        # ske.parse mirrors them, and clip_posed must mirror back out:
        # attach = raw_rel_rotation * CLIP_WORLD_YAW, raw_rel_translation.
        root_raw = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        c, s = math.cos(math.radians(30.0)), math.sin(math.radians(30.0))
        main_raw = ((c, 0.0, s), (0.0, 1.0, 0.0), (-s, 0.0, c))
        weapon = ske.parse(pack_ske([
            ("Bip01 R Hand", -1, root_raw, (0.305, 0.0, 0.0)),
            ("BaseNo4", 0, main_raw, (0.113, 0.026, 0.045)),
        ]), "w.ske")

        rotation, translation = pose.weapon_attachment(
            weapon, 1, clip_posed=True)

        # A direct child of the root IS the raw relative.
        want = mat_mul(main_raw, pose.CLIP_WORLD_YAW)
        for i in range(3):
            for j in range(3):
                self.assertAlmostEqual(want[i][j], rotation[i][j], places=5)
        for got, exp in zip(translation, (0.113, 0.026, 0.045)):
            self.assertAlmostEqual(exp, got, places=5)

    def test_clip_posed_matches_the_johnsonlmg_clips_own_base_track(self) -> None:
        """The one weapon whose 3P StandAim clip tracks the weapon's own base
        bone is the ground truth for the weld: the clip's base local IS the
        graft the game uses. These are the actual JohnsonLMG.ske records and
        the decoded frame-0 base local of 3pStandAimUpperJohnsonLmg.baf."""
        root_raw = ((0.954794, 0.187281, 0.230856),
                    (0.095048, -0.928155, 0.359854),
                    (0.281664, -0.321644, -0.903997))
        base_raw = ((0.091642, 0.167493, -0.981605),
                    (0.995516, 0.007796, 0.094271),
                    (0.023442, -0.985842, -0.166028))
        weapon = ske.parse(pack_ske([
            ("Bip01 R Hand", -1, root_raw, (0.305002, 0.0, 0.0)),
            ("base", 0, base_raw, (0.376729, -0.001282, -0.037891)),
        ]), "JohnsonLMG.ske")
        clip_base_local = (
            ((0.091645, 0.167451, -0.981611),
             (0.995516, 0.007793, 0.094273),
             (0.023436, -0.98585, -0.165986)),
            (0.376709, -0.001251, -0.037872))

        rotation, translation = pose.weapon_attachment(
            weapon, 1, clip_posed=True)

        # attach = clip base local, carried through the clip-world yaw the
        # welded mesh-world weapon geometry needs. Tolerance is the .baf's
        # 1.15 fixed-point quantisation.
        want = mat_mul(clip_base_local[0], pose.CLIP_WORLD_YAW)
        for i in range(3):
            for j in range(3):
                self.assertAlmostEqual(want[i][j], rotation[i][j], places=3)
        for got, exp in zip(translation, clip_base_local[1]):
            self.assertAlmostEqual(exp, got, places=3)

    def test_clip_posed_is_not_a_post_multiplied_half_turn(self) -> None:
        """Regression: the retired CLIP_GRIP_ROLL (Rz180 post-multiplied on
        the parsed attach) was calibrated on the Thompson alone and welded
        every weapon with a differently-rotated main bone up to 180 degrees
        wrong — the 45-degrees-down No4Sniper, the flipped JohnsonLMG, the
        misaligned Binoculars. For a main bone rotated against the root the
        two must disagree."""
        rz180 = ((-1.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, 1.0))
        c, s = math.cos(math.radians(30.0)), math.sin(math.radians(30.0))
        main_raw = ((c, 0.0, s), (0.0, 1.0, 0.0), (-s, 0.0, c))
        weapon = ske.parse(pack_ske([
            ("Bip01 R Hand", -1, IDENTITY, (0.305, 0.0, 0.0)),
            ("base", 0, main_raw, (0.1, 0.0, 0.02)),
        ]), "w.ske")

        plain = pose.weapon_attachment(weapon, 1)
        clip = pose.weapon_attachment(weapon, 1, clip_posed=True)

        old = mat_mul(plain[0], rz180)
        agreement = max(
            abs(old[i][j] - clip[0][i][j])
            for i in range(3) for j in range(3))
        self.assertGreater(agreement, 0.5)


class RestReconstructionTests(unittest.TestCase):
    def test_posing_at_the_skins_own_binds_reproduces_the_mesh(self) -> None:
        """With no animation applied - joints at the skin's recovered binds -
        linear-blend skinning must return every rest position exactly. This
        is the identity that pins the whole pipeline; posing at the `.ske`
        rest instead re-poses the part into the skeleton's stance, and the
        displacement that produces is the stance delta, not an error."""
        skeleton = ske.parse(pack_ske([
            ("Bip01 Spine3", -1, IDENTITY, (0.0, 0.0, 1.38)),
            ("Bip01 Head", 0, IDENTITY, (0.0, 0.0, 0.17)),
        ]), "s.ske")
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.38))
                 + exclusive_cluster(1, (0.0, 0.0, 1.60))
                 + [((0.0, 0.0, 1.50),
                     [(0, 0.5, (0.0, 0.0, 0.12)), (1, 0.5, (0.0, 0.0, -0.10))])])
        skn = skin.parse(pack_skn(verts, ["Bip01 Spine3", "Bip01 Head"]), "part")
        binds = pose.refine_binds(skn)
        bone_map, _ = pose.remap_influences(skn, skeleton, binds)
        posed = {ske.canonical(name): bind for name, bind in binds.items()}

        baked = pose.skinned_positions(skn, posed, bone_map, binds)

        for vertex, got in zip(skn.vertices, baked):
            self.assertIsNotNone(got)
            self.assertLess(math.dist(got, vertex.rest), 1e-6)

    def test_anchored_vertices_ride_the_anchor_rigidly(self) -> None:
        skeleton = ske.parse(pack_ske([
            ("Bip01 Head", -1, IDENTITY, (0.0, 0.0, 1.55)),
        ]), "s.ske")
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.55))
                 + exclusive_cluster(1, (0.0, 0.10, 1.62)))  # face bone
        skn = skin.parse(pack_skn(verts, ["Bip01 Head", "bon-eye-left"]), "face")
        binds = pose.refine_binds(skn)
        bone_map, anchor = pose.remap_influences(skn, skeleton, binds)
        self.assertEqual([anchor, anchor], [bone_map[0], bone_map[1]])
        # Move the head 0.2 up: every vertex, eye included, moves with it.
        rotation, translation = binds["Bip01 Head"]
        posed = {"bip01 head": (rotation,
                                (translation[0], translation[1],
                                 translation[2] + 0.2))}

        baked = pose.skinned_positions(skn, posed, bone_map, binds)

        for vertex, got in zip(skn.vertices, baked):
            want = (vertex.rest[0], vertex.rest[1], vertex.rest[2] + 0.2)
            self.assertLess(math.dist(got, want), 1e-6)


# -- seat pose discovery ----------------------------------------------------- #

from extract_pose import (discover_seat_poses, resolve_seat_states,  # noqa: E402
                          seat_pose_name)
from bf42.con import ObjectTemplate  # noqa: E402


class SeatPoseDiscoveryTests(unittest.TestCase):
    def _template(self, name, upper=None, lower=None, kind="SeatObject",
                  flags=()):
        t = ObjectTemplate(name, kind, "objects/test.con")
        t.seat_animation_upper_body = upper
        t.seat_animation_lower_body = lower
        t.seat_flags = list(flags)
        return t

    def test_pairs_each_upper_state_with_its_matching_lower(self) -> None:
        from bf42.con import ObjectLibrary
        lib = ObjectLibrary()
        lib.objects["WillyPassengerSeat"] = self._template(
            "WillyPassengerSeat", "Ub_PassengerInWilly", "Lb_PassengerInWilly")
        lib.objects["HanomagPassenger"] = self._template(
            "HanomagPassenger", "Ub_PassengerInHanomag", "Lb_PassengerInHanomag")
        poses = discover_seat_poses(lib)
        self.assertEqual([("Ub_PassengerInWilly", "Lb_PassengerInWilly"),
                          ("Ub_PassengerInHanomag", "Lb_PassengerInHanomag")], poses)

    def test_a_seat_that_declares_no_animation_takes_the_engine_default(self) -> None:
        # `WillySeat` and every other driver's seat in vanilla. Before this,
        # such a seat yielded nothing and the driver was never drawn.
        from bf42.con import ObjectLibrary
        lib = ObjectLibrary()
        lib.objects["WillySeat"] = self._template(
            "WillySeat", flags=["c_SeatShowFullBodySoldier", "c_SeatIsOutside"])
        self.assertEqual([("Ub_SitInVehicle", "Lb_SitInVehicle")],
                         discover_seat_poses(lib))

    def test_a_standing_seat_takes_the_standing_lower_default(self) -> None:
        # setUseSeat 0x8271a33: the only flag that changes a default.
        seat = self._template(
            "StationaryBrowningSeat",
            flags=["c_SeatShowStandingSoldier", "c_SeatIsOutside"])
        self.assertEqual(("Ub_SitInVehicle", "Lb_StandInVehicle"),
                         resolve_seat_states(seat))

    def test_half_body_does_not_change_which_states_are_played(self) -> None:
        # `c_SeatShowHalfBodySoldier` hides the legs (disableBoneTree on
        # "Bip01 Pelvis", 0x8271b63); it does not pick a different clip.
        seat = self._template(
            "ShermanBrowningSeat",
            flags=["c_SeatShowHalfBodySoldier", "c_SeatIsOutside"])
        self.assertEqual(("Ub_SitInVehicle", "Lb_SitInVehicle"),
                         resolve_seat_states(seat))

    def test_a_declared_upper_still_takes_the_sit_lower_default(self) -> None:
        seat = self._template("Odd", "Ub_PassengerInWilly", None)
        self.assertEqual(("Ub_PassengerInWilly", "Lb_SitInVehicle"),
                         resolve_seat_states(seat))

    def test_a_mismatched_pair_is_kept_and_gets_its_own_name(self) -> None:
        # Black Medal pairs Ub_PassengerInWilly with Lb_PassengerInHanomag.
        # That is what the game plays, so it is what is exported — under a name
        # that cannot collide with the Willy's own matching pair.
        from bf42.con import ObjectLibrary
        lib = ObjectLibrary()
        lib.objects["BlackMedalPassenger"] = self._template(
            "BlackMedalPassenger", "Ub_PassengerInWilly",
            "Lb_PassengerInHanomag")
        lib.objects["WillyPassenger"] = self._template(
            "WillyPassenger", "Ub_PassengerInWilly", "Lb_PassengerInWilly")
        self.assertEqual([("Ub_PassengerInWilly", "Lb_PassengerInHanomag"),
                          ("Ub_PassengerInWilly", "Lb_PassengerInWilly")],
                         discover_seat_poses(lib))
        self.assertEqual("PassengerInWilly-PassengerInHanomag",
                         seat_pose_name("Ub_PassengerInWilly",
                                        "Lb_PassengerInHanomag"))

    def test_matching_and_Lb_Stand_pairs_keep_their_existing_asset_names(self) -> None:
        self.assertEqual("PassengerInWilly",
                         seat_pose_name("Ub_PassengerInWilly", "Lb_PassengerInWilly"))
        self.assertEqual("PassengerInWilly",
                         seat_pose_name("Ub_PassengerInWilly", "Lb_Stand"))
        self.assertEqual("SitInVehicle",
                         seat_pose_name("Ub_SitInVehicle", "Lb_SitInVehicle"))
        self.assertEqual("SitInVehicle-StandInVehicle",
                         seat_pose_name("Ub_SitInVehicle", "Lb_StandInVehicle"))

    def test_only_SeatObjects_are_considered(self) -> None:
        from bf42.con import ObjectLibrary
        lib = ObjectLibrary()
        lib.objects["PlainCamera"] = self._template("PlainCamera", kind="Camera")
        lib.objects["Entry"] = self._template("Entry", kind="EntryPoint")
        self.assertEqual([], discover_seat_poses(lib))


class SeatStateNotInTheMachineTests(unittest.TestCase):
    """Road to Rome's `M3GMCPassengerSeat` names a state no mod declares.

    `Ub_PassengerInM3GMC`/`Lb_PassengerInM3GMC` appear in exactly one file in
    the whole install -- `objects/Vehicles/Land/M3GMC/Objects.con` in XPack1's
    `objects.rfa` -- and in no `AnimationStates` file anywhere. The mod path is
    being read: vanilla's `animations/AnimationStates.con` ends with `run
    AnimationStatesMod`, XPack1 ships `Animations/AnimationStatesMod.con`, and
    parsing XPack1 yields 1,636 states against vanilla's 1,458 with no missing
    runs. The states simply do not exist, which is a bug in the mod.

    The engine leaves the animation slot alone in that case
    (`setAnimationState` `0x0826cee0` -> `findState` `0x08328610` returns -1 ->
    return at `0x0826cf12`), so the occupant is still drawn. Falling back to
    the engine's default seat pose is the drawable version of that.
    """

    def _machine(self, *names):
        from bf42 import animstates
        m = animstates.StateMachine()
        for n in names:
            m.states[n.lower()] = animstates.State(n)
        return m

    def _seat(self, name, upper, lower, flags=()):
        t = ObjectTemplate(name, "SeatObject", "objects/test.con")
        t.seat_animation_upper_body = upper
        t.seat_animation_lower_body = lower
        t.seat_flags = list(flags)
        return t

    def test_a_state_the_machine_lacks_falls_back_to_the_default(self) -> None:
        machine = self._machine("Ub_SitInVehicle", "Lb_SitInVehicle",
                                "Lb_StandInVehicle")
        seat = self._seat("M3GMCPassengerSeat", "Ub_PassengerInM3GMC",
                          "Lb_PassengerInM3GMC",
                          flags=["c_SeatShowFullBodySoldier"])
        self.assertEqual(("Ub_SitInVehicle", "Lb_SitInVehicle"),
                         resolve_seat_states(seat, machine))

    def test_the_standing_flag_still_picks_the_standing_default(self) -> None:
        machine = self._machine("Ub_SitInVehicle", "Lb_SitInVehicle",
                                "Lb_StandInVehicle")
        seat = self._seat("Bench", "Ub_Nope", "Lb_Nope",
                          flags=["c_SeatShowStandingSoldier"])
        self.assertEqual(("Ub_SitInVehicle", "Lb_StandInVehicle"),
                         resolve_seat_states(seat, machine))

    def test_only_the_half_that_is_missing_falls_back(self) -> None:
        machine = self._machine("Ub_SitInVehicle", "Lb_SitInVehicle",
                                "Lb_StandInVehicle", "Lb_PassengerInWilly")
        seat = self._seat("Half", "Ub_Nope", "Lb_PassengerInWilly")
        self.assertEqual(("Ub_SitInVehicle", "Lb_PassengerInWilly"),
                         resolve_seat_states(seat, machine))

    def test_without_a_machine_the_declared_names_are_trusted(self) -> None:
        seat = self._seat("Any", "Ub_PassengerInM3GMC", "Lb_PassengerInM3GMC")
        self.assertEqual(("Ub_PassengerInM3GMC", "Lb_PassengerInM3GMC"),
                         resolve_seat_states(seat))

    def test_the_substitution_is_reported_rather_than_swallowed(self) -> None:
        from bf42.con import ObjectLibrary
        from extract_pose import seat_substitutions
        machine = self._machine("Ub_SitInVehicle", "Lb_SitInVehicle",
                                "Lb_StandInVehicle")
        lib = ObjectLibrary()
        lib.objects["M3GMCPassengerSeat"] = self._seat(
            "M3GMCPassengerSeat", "Ub_PassengerInM3GMC", "Lb_PassengerInM3GMC")
        self.assertEqual(
            [("M3GMCPassengerSeat", "Ub_PassengerInM3GMC", "Ub_SitInVehicle"),
             ("M3GMCPassengerSeat", "Lb_PassengerInM3GMC", "Lb_SitInVehicle")],
            seat_substitutions(lib, machine))

    def test_a_seat_naming_only_known_states_reports_nothing(self) -> None:
        from bf42.con import ObjectLibrary
        from extract_pose import seat_substitutions
        machine = self._machine("Ub_PassengerInWilly", "Lb_PassengerInWilly")
        lib = ObjectLibrary()
        lib.objects["WillyPassengerSeat"] = self._seat(
            "WillyPassengerSeat", "Ub_PassengerInWilly", "Lb_PassengerInWilly")
        self.assertEqual([], seat_substitutions(lib, machine))


class SeatAnchorTests(unittest.TestCase):
    """A seat pose's origin is the soldier's hips, not the ground under him.

    A `.baf` root track is the one transform in clip world, and a seat clip
    carries the standing origin-at-the-feet convention in it:
    `3PWillySitLower` writes `Bip01` at `0/-0.1104/-0.8335`, against
    `3PStandLower`'s `0.004/-0.0075/-0.9992` for a man on the ground. A
    `SeatObject` is the cushion — `WillySeat` sits 0.6 m up inside the Willys'
    body — so a pose parented there with that offset still in it rides 0.83 m
    out of the vehicle, which put the driver's shoulder 1.25 m from a wheel
    0.60 m of arm away and left both hands hanging in the air.
    """

    def _skeleton(self) -> ske.Skeleton:
        return ske.parse(pack_ske([
            ("Bip01", -1, IDENTITY, (0.0, 0.0, 0.9)),
            ("Bip01 Pelvis", 0, IDENTITY, (0.03, 0.0, 0.0)),
            ("Bip01 Spine", 1, IDENTITY, (0.1, 0.0, 0.0)),
        ]), "s.ske")

    def test_the_root_translation_goes_and_its_rotation_stays(self) -> None:
        from extract_pose import seat_anchored
        turned = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        locals_map = {"bip01": (turned, (0.0, -0.1104, -0.8335)),
                      "bip01 pelvis": (IDENTITY, (0.0312, -0.0045, 0.0))}

        out = seat_anchored(self._skeleton(), locals_map)

        self.assertEqual((0.0, 0.0, 0.0), out["bip01"][1])
        self.assertEqual(turned, out["bip01"][0])
        # Nothing below the root is touched: only the root's local is in
        # clip world, so only the root's offset is the one being dropped.
        self.assertEqual((0.0312, -0.0045, 0.0), out["bip01 pelvis"][1])

    def test_a_root_the_clip_never_wrote_is_left_alone(self) -> None:
        from extract_pose import seat_anchored
        locals_map = {"bip01 pelvis": (IDENTITY, (0.03, 0.0, 0.0))}

        out = seat_anchored(self._skeleton(), locals_map)

        self.assertNotIn("bip01", out)

    def test_the_dropped_offset_is_reported_not_silently_lost(self) -> None:
        from extract_pose import seat_root_offset
        locals_map = {"bip01": (IDENTITY, (0.0, -0.1104, 0.8335))}
        self.assertEqual([0.0, -0.1104, 0.8335],
                         seat_root_offset(self._skeleton(), locals_map))
        self.assertIsNone(seat_root_offset(self._skeleton(), {}))


def _qapply(q, v):
    """A glTF `[x, y, z, w]` quaternion applied to a vector."""
    x, y, z, w = q
    vx, vy, vz = v
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + y * tz - z * ty,
            vy + w * ty + z * tx - x * tz,
            vz + w * tz + x * ty - y * tx)


class SeatPoseOrientationTests(unittest.TestCase):
    """The root rotation that stands a seat pose up and faces it forward.

    It is **derived**, from the two frames it has to reconcile, and measured
    bone directions agree with the derivation to three decimals.

    *What the file holds.* A seat pose's joint hierarchy is written in the
    space `ske.parse` produces, which is the `.ske`'s own space mirrored in Z.
    In that space the soldier's spine runs along **-Z** and, for a sitting
    clip, his thighs run along **+Y**. Measured on every seat pose vanilla
    ships, `head - pelvis` has z between -0.92 and -1.00 and `knee - hip` has
    y between +0.85 and +0.99; `Lb_StandInVehicle` is the one exception and it
    is the informative one — its thigh runs along +Z, down the spine, because
    a standing lower body has no bend to measure.

    *What glTF wants.* Up is +Y. The node this pose is parented to is a
    `SeatObject` in the vehicle's own exported tree, and `gltf.py` mirrors
    Refractor's +Z forward to **-Z**, so an occupant facing the way the
    vehicle faces must face -Z.

    So the root rotation R is fixed by two images: `R(-Z) = +Y` and
    `R(+Y) = -Z`. A rotation matrix with `y -> -z` and `z -> -y` must take
    `x -> -x` for its determinant to stay +1; that matrix is symmetric with
    trace -1, so it is a half turn, about the axis `(0, 1, -1)/sqrt(2)`. Both
    tests below check exactly that, and `quat_from_ypr(180, -90, 0)` is it.

    The pure yaw the export shipped until this branch, `ypr(180, 0, 0)`, leaves
    the spine along Z: the soldier lies on his back with his knees in the air,
    which is what the page drew for every passenger in the game.
    """

    SPINE_IN_FILE = (0.0, 0.0, -1.0)     # head - pelvis, measured
    THIGH_IN_FILE = (0.0, 1.0, 0.0)      # knee - hip, measured

    def _assert_close(self, got, want, places=6):
        for g, w in zip(got, want):
            self.assertAlmostEqual(g, w, places=places)

    def test_the_root_rotation_stands_him_up_and_faces_him_forward(self) -> None:
        q = gltf.quat_from_ypr(180.0, -90.0, 0.0)
        self._assert_close(_qapply(q, self.SPINE_IN_FILE), (0.0, 1.0, 0.0))
        self._assert_close(_qapply(q, self.THIGH_IN_FILE), (0.0, 0.0, -1.0))

    def test_it_is_a_half_turn_about_the_y_minus_z_diagonal(self) -> None:
        q = gltf.quat_from_ypr(180.0, -90.0, 0.0)
        half = math.sqrt(0.5)
        self.assertAlmostEqual(q[3], 0.0, places=6)          # 180 degrees
        self.assertAlmostEqual(abs(q[0]), 0.0, places=6)     # no x component
        # The axis is (0, 1, -1)/sqrt(2) up to the sign of the whole
        # quaternion, which names the same rotation.
        self.assertAlmostEqual(abs(q[1]), half, places=6)
        self.assertAlmostEqual(abs(q[2]), half, places=6)
        self.assertAlmostEqual(q[1], -q[2], places=6)

    def test_the_pure_yaw_leaves_him_on_his_back(self) -> None:
        q = gltf.quat_from_ypr(180.0, 0.0, 0.0)
        spine = _qapply(q, self.SPINE_IN_FILE)
        self.assertAlmostEqual(spine[1], 0.0, places=6)      # not up at all
        self.assertAlmostEqual(abs(spine[2]), 1.0, places=6)  # flat along Z
        knee = _qapply(q, self.THIGH_IN_FILE)
        self.assertAlmostEqual(knee[1], 1.0, places=6)       # knees in the air

    def test_the_export_uses_the_derived_rotation(self) -> None:
        import inspect
        import extract_pose
        source = inspect.getsource(extract_pose.export_seat_pose)
        self.assertIn("quat_from_ypr(180.0, -90.0, 0.0)", source)


if __name__ == "__main__":
    unittest.main()
