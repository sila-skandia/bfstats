"""`viewer/mouse-look-key.js` — the pilot's mouse-look key — under node.

features/pilot-mouse-look. The sentence these tests defend:

    in an aircraft pilot's seat the mouse turns the view only while
    `c_PIMouseLook` is held (Left Shift in the shipped Air map), the released
    view eases back to straight ahead at 0.75 a 30 Hz tick, and holding the
    key takes the rudder and the stick away from the aircraft; with the key
    up the same mouse flies it, `c_PIRoll`/`c_PIPitch` being the device's
    rate on the Air profile (`0.001 x counts/s x 3.85`, its Y inverted by
    `game.setAirMouseInvert 1`) wherever the profile's Air map binds it

which is `BFPlayer::handleInput` (lnxded 0x08052530, client 0x00407ec0) and
`Camera::handlePlayerInput` (lnxded 0x081aa490, client 0x00564af0) for a
Camera whose template sets `toggleMouseLook` -- in shipped data exactly the
aircraft pilots' cameras. Everyone else's mouse is untouched: a gunner's aims
his gun, a driver's and a helmsman's turn the view, as before.

The harness drives the real `controls.js` over the shipped maps and the
owner's own profile, and the real `createLocalLook` and `VehicleCamera` on a
stub page, so the gate and the recentre are checked where the page uses them.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
TESTS = Path(__file__).resolve().parent
HARNESS = TESTS / "mouse_look_key_harness.mjs"
FIXTURES = TESTS / "fixtures" / "controls-profile-skandia"

MODULES = {
    f"viewer/{name}": VIEWER / name
    for name in ("mouse-look-key.js", "mouse-input.js", "local-look.js", "vehicle-camera.js", "camera-pivot.js",
                 "controls.js", "controls-defaults.js", "console.js", "console-view.js",
                 # The seats that are not the pilot's run over the real survey.
                 "seat-survey.js",
                 # local-look.js draws the hulls' belts (`track-scroll.js`,
                 # which reads the engine law out of ground-engine.js).
                 "track-scroll.js", "ground-engine.js", "ground-contact.js")
}
MODULES["node_modules/three/three.module.js"] = VIEWER / "vendor" / "three.module.js"
for name in ("Common.con", "Infantry.con", "Air.con", "Land.con"):
    MODULES[f"fixtures/controls-profile-skandia/{name}"] = FIXTURES / name
# The seat trees of a re-baked export (`cameraView.toggleMouseLook` and
# `.look` on every Camera), cut down from the con-reader package's glbs.
MODULES["fixtures/air-seats.json"] = TESTS / "fixtures" / "air-seats.json"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})

HEAD_SENS_DEG = 0.0022 * 180 / math.pi    # local-look.js HEAD_SENS, degrees a pixel


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class _Harness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class ConstantTests(_Harness):
    """The numbers, each read out of both binaries at the address in the module."""

    def test_the_trigger_and_its_channel(self) -> None:
        # `c_PIMouseLook` is PlayerInputMap id 11: the twelfth name of lnxded's
        # table at 0x086c86a5, the bit `shrd $0xb` / `and 0x800` tests and the
        # float at PlayerInput+0x2c.
        c = self.results["constants"]
        self.assertEqual("c_PIMouseLook", c["trigger"])
        self.assertEqual(11, c["channel"])

    def test_held_is_above_a_half(self) -> None:
        # lnxded `ds:0x86b05e8` = 0x3f000000, client `[0x008c4220]`.
        self.assertEqual(0.5, self.results["constants"]["heldThreshold"])

    def test_a_released_look_keeps_three_quarters_a_tick(self) -> None:
        # lnxded `ds:0x86ba8cc` = 0x3f400000, client `[0x008d1e28]`, spent
        # once per `handlePlayerInput`, i.e. per 30 Hz tick.
        c = self.results["constants"]
        self.assertEqual(0.75, c["perTick"])
        self.assertEqual(30, c["tickHz"])


class RecentreLawTests(_Harness):
    """`Camera::handlePlayerInput`'s released branch, drawn between ticks."""

    def test_one_tick_is_exactly_the_engines_factor(self) -> None:
        r = self.results["recentre"]
        self.assertAlmostEqual(0.75, r["oneTick"], places=12)
        self.assertAlmostEqual(0.75 ** 8, r["eightTicks"], places=12)
        self.assertAlmostEqual(0.75 ** 16, r["sixteenTicks"], places=12)
        self.assertAlmostEqual(0.75 ** 30, r["oneSecond"], places=15)

    def test_how_fast_that_is(self) -> None:
        # Half the angle gone in 80 ms, nine tenths in eight ticks (267 ms),
        # ninety-nine hundredths in sixteen (533 ms): an ease, not a snap and
        # not a view that stays where it was left.
        r = self.results["recentre"]
        self.assertAlmostEqual(0.0803, r["halfLife"], places=4)
        self.assertLess(r["eightTicks"], 0.101)
        self.assertLess(r["sixteenTicks"], 0.0101)

    def test_no_time_no_change(self) -> None:
        r = self.results["recentre"]
        self.assertEqual(1, r["zero"])
        self.assertEqual(1, r["negative"])
        self.assertEqual(1, r["nan"])
        self.assertIsNone(r["nullLook"])

    def test_the_same_second_at_any_frame_rate(self) -> None:
        r = self.results["recentre"]
        want = 0.75 ** 30
        for fps, look in r["perFps"].items():
            with self.subTest(fps=fps):
                self.assertAlmostEqual(want, look["yaw"], delta=want * 1e-9)
                self.assertAlmostEqual(-0.5 * want, look["pitch"], delta=want * 1e-9)
        self.assertGreater(r["vileFrames"], 20)
        self.assertAlmostEqual(want, r["vile"]["yaw"], delta=want * 1e-9)

    def test_every_tick_boundary_draws_the_engines_value(self) -> None:
        for row in self.results["recentre"]["tickBoundaries"]:
            with self.subTest(ticks=row["ticks"]):
                self.assertAlmostEqual(0.75 ** row["ticks"], row["yaw"], places=12)

    def test_it_comes_to_rest_at_exactly_zero(self) -> None:
        r = self.results["recentre"]
        self.assertEqual({"yaw": 0, "pitch": 0}, r["restLook"])
        self.assertLess(r["restAfter"], 2.0)


class SeatTests(_Harness):
    """Which seats need the key: the shipped data's `toggleMouseLook` rule."""

    def test_only_an_aircraft_pilot(self) -> None:
        s = self.results["seats"]
        self.assertTrue(s["pilot"])
        for other in ("gunnerOfAnAircraft", "shipsHelm", "tankDriver", "carDriver",
                      "bareGun", "rootUnknown", "none"):
            with self.subTest(seat=other):
                self.assertFalse(s[other])


class RouterTests(_Harness):
    """`BFPlayer::handleInput`'s held branch: c_PIYaw, c_PIPitch and c_PIRoll
    (channels 0, 1, 2) zeroed; the throttle and the triggers are not."""

    def test_holding_the_key_flies_hands_off(self) -> None:
        held = self.results["route"]["held"]
        self.assertEqual(0, held["rudder"])
        self.assertEqual(0, held["roll"])
        self.assertEqual(0, held["pitch"])
        self.assertEqual(1, held["forward"])
        self.assertEqual(1, held["forwardKeys"])
        self.assertTrue(held["fire"])
        self.assertTrue(held["altFire"])

    def test_released_the_word_is_untouched(self) -> None:
        released = self.results["route"]["released"]
        self.assertEqual({"forward": 1, "forwardKeys": 1, "strafe": 0.5, "rudder": -1,
                          "roll": 0.7, "pitch": -0.4, "fire": True, "altFire": True,
                          "pad": False}, released)

    def test_the_touch_pad_is_the_pages_own_and_is_left_alone(self) -> None:
        pad = self.results["route"]["heldOnThePad"]
        self.assertEqual(0, pad["rudder"])
        self.assertEqual(0.7, pad["roll"])
        self.assertEqual(-0.4, pad["pitch"])
        self.assertIsNone(self.results["route"]["nullWord"])

    def test_released_the_look_axes_are_the_ones_dropped(self) -> None:
        # Channels 4 and 5 zeroed while the key is up (0x08052674 onward);
        # held, the look pair is the look's.
        r = self.results["route"]
        self.assertEqual({"x": 0, "y": 0}, r["lookReleased"])
        self.assertEqual({"x": 2.5, "y": -1.2}, r["lookHeld"])
        self.assertIsNone(r["lookNull"])


class BindingTests(_Harness):
    """The key is the control map's, so a profile moves it."""

    def test_left_shift_is_the_look_on_the_air_map_only(self) -> None:
        # `Settings/Default/Controls/Air.con:21`; no other shipped map binds
        # the trigger. On foot the same key is the walk (Infantry.con:8).
        b = self.results["binding"]["shipped"]
        self.assertTrue(b["air"])
        self.assertFalse(b["land"])
        self.assertFalse(b["infantry"])
        self.assertTrue(b["infantryWalk"])
        self.assertFalse(b["airWalk"])
        self.assertFalse(b["airRightShift"])
        self.assertEqual(["c_GILeftShift", "c_PIMouseLook", "c_PIWalk"], b["triggersOnTheKey"])

    def test_the_hint_names_the_key(self) -> None:
        self.assertEqual("L Shift+mouse look around", self.results["binding"]["shipped"]["hint"])
        self.assertEqual("L Shift+mouse look around", self.results["binding"]["owner"]["hint"])

    def test_in_game_the_pilot_holds_it_and_a_gunner_cannot(self) -> None:
        g = self.results["binding"]["inGame"]
        self.assertEqual("air", g["pilotContext"])
        self.assertTrue(g["pilotHolding"])
        self.assertFalse(g["pilotReleased"])
        # A gunner's seat is VCLand: the LandSea map has no such trigger.
        self.assertEqual("land", g["gunnerContext"])
        self.assertFalse(g["gunnerHolding"])
        # Nothing is held while the page is not captured.
        self.assertFalse(g["uncaptured"])

    def test_the_owners_profile_keeps_left_shift(self) -> None:
        self.assertTrue(self.results["binding"]["owner"]["air"])

    def test_a_profile_can_move_it_to_the_stick(self) -> None:
        j = self.results["binding"]["joystick"]
        self.assertTrue(j["button5"])
        self.assertFalse(j["shiftAfterRebind"])


class PageTests(_Harness):
    """`createLocalLook` + `VehicleCamera`: the gate and the recentre where the
    page runs them."""

    def test_a_knock_of_the_mouse_does_not_turn_the_view(self) -> None:
        # It flies the aircraft instead (StickTests); the head stays put.
        p = self.results["page"]
        self.assertEqual({"needsKey": True, "held": False, "heldWithKey": True}, p["pilotGate"])
        self.assertEqual({"yaw": 0, "pitch": 0}, p["pilotKnock"]["look"])
        self.assertEqual(0, p["pilotKnock"]["offForward"])
        self.assertEqual({"yaw": 0, "pitch": 0}, p["pilotSecondKnock"])

    def test_with_the_key_held_the_head_turns_as_it_always_did(self) -> None:
        p = self.results["page"]
        want = -300 * HEAD_SENS_DEG
        self.assertAlmostEqual(want, p["pilotHolding"]["look"]["yaw"], places=4)
        self.assertAlmostEqual(-want, p["pilotHolding"]["offForward"], places=3)
        # ...and stays turned for as long as it is held.
        self.assertAlmostEqual(want, p["pilotHeldHalfSecond"]["yaw"], places=4)

    def test_released_it_eases_back_to_the_gunsight(self) -> None:
        p = self.results["page"]
        self.assertAlmostEqual(0.75, p["pilotReleasedOneTick"]["ratio"], places=9)
        self.assertAlmostEqual(0.75 ** 8, p["pilotReleasedEightTicks"]["ratio"], places=9)
        self.assertEqual({"yaw": 0, "pitch": 0}, p["pilotReleasedLater"]["look"])
        self.assertEqual(0, p["pilotReleasedLater"]["offForward"])

    def test_outside_the_orbit_obeys_the_same_key(self) -> None:
        # Neither engine function reads the view mode.
        p = self.results["page"]
        self.assertEqual("chase", p["chaseMode"])
        self.assertEqual({"yaw": 0, "pitch": 0}, p["chaseKnock"])
        self.assertAlmostEqual(-400 * HEAD_SENS_DEG, p["chaseHolding"]["yaw"], places=4)
        self.assertAlmostEqual(-400 * HEAD_SENS_DEG * 0.75 ** 30,
                               p["chaseReleasedOneSecond"]["yaw"], places=6)

    def test_a_finger_on_the_view_is_the_key_on_a_touch_screen(self) -> None:
        p = self.results["page"]
        self.assertAlmostEqual(-200 * HEAD_SENS_DEG, p["touchDragging"]["yaw"], places=4)
        self.assertAlmostEqual(0.75, p["touchLifted"]["ratio"], places=9)

    def test_a_gunner_still_aims_with_the_mouse(self) -> None:
        g = self.results["page"]["gunner"]
        self.assertFalse(g["needsKey"])
        self.assertEqual(300, g["pendingX"])
        self.assertEqual(-40, g["pendingY"])
        self.assertEqual({"yaw": 0, "pitch": 0}, g["viewLook"])

    def test_drivers_and_helmsmen_are_untouched(self) -> None:
        p = self.results["page"]
        self.assertFalse(p["tankDriver"]["needsKey"])
        self.assertEqual(300, p["tankDriver"]["pendingX"])
        for seat in ("jeepDriver", "shipHelm"):
            with self.subTest(seat=seat):
                self.assertFalse(p[seat]["needsKey"])
                self.assertAlmostEqual(-300 * HEAD_SENS_DEG, p[seat]["turned"]["yaw"], places=4)
                self.assertEqual(p[seat]["turned"], p[seat]["oneSecondLater"])


def wire(value: float) -> float:
    """`floatToFixed(v, 12, 16)` then `PlayerAction::get`'s decode and 0.01
    snap, as mouse-input.js has them (and `test_mouse_input.py` pins)."""
    x = max(-1.0, min(1.0, value / 16.0))
    n = math.trunc((x + 1) * 0.5 * 4095)
    v = ((2 * n) / 4095 - 1) * 16
    return round(v * 100) / 100


class StickTests(_Harness):
    """Key up, the mouse flies the aircraft: the Air map's
    `c_PIRoll IDFMouse IDAxis_0` and `c_PIPitch IDFMouse IDAxis_1` lines carry
    the look stage's own rate onto the stick (mouse-input.js: one register per
    mouse axis, read by every mapping of it)."""

    # 30 px in one 1/30 s tick is 900 counts a second; the Air profile's
    # 0.75 is a scale of 3.85.
    RATE = 0.001 * 900 * 3.85

    def test_the_counts_reach_the_stage_and_not_the_view(self) -> None:
        s = self.results["stick"]
        self.assertEqual({"yaw": 0, "pitch": 0}, s["knockView"])
        self.assertEqual({"x": 30, "y": 30}, s["knockPending"])
        self.assertEqual("air", s["profile"])
        self.assertAlmostEqual(3.85, s["scale"], places=12)

    def test_mouse_x_is_the_roll_at_the_air_rate(self) -> None:
        s = self.results["stick"]
        self.assertAlmostEqual(wire(self.RATE), s["roll"], places=9)
        self.assertEqual(3.46, s["roll"])
        self.assertEqual(s["expected"]["right30"], s["roll"])
        # Past full deflection: a rate, not a position. The part clips it.
        self.assertGreater(s["roll"], 1)

    def test_mouse_y_is_the_pitch_inverted_by_the_air_box(self) -> None:
        # Pulled toward the player (browser +y, DirectInput +lY) is a negative
        # c_PIPitch -- ArrowDown's sense, the nose coming up -- because the
        # shipped `game.setAirMouseInvert 1` turns the device's Y round.
        s = self.results["stick"]
        self.assertAlmostEqual(wire(-self.RATE), s["pitch"], places=9)
        self.assertEqual(-3.47, s["pitch"])
        # The box off, the same hand is nose down.
        self.assertEqual(3.46, s["pitchUninverted"])

    def test_the_sensitivity_is_the_air_profiles(self) -> None:
        # `game.setAirMouseSensitivity 0.25`: scale 1.35, a third of the rate.
        s = self.results["stick"]
        self.assertAlmostEqual(wire(0.001 * 900 * 1.35), s["rollAtAQuarter"], places=9)
        self.assertEqual(s["expected"]["right30quarter"], s["rollAtAQuarter"])

    def test_a_still_mouse_is_a_centred_stick(self) -> None:
        self.assertEqual(0, self.results["stick"]["rollStill"])

    def test_the_rudder_and_a_bare_axis_take_no_mouse(self) -> None:
        # The shipped Air map binds the mouse to roll and pitch only, and a
        # caller that hands no pair gets the keys alone.
        s = self.results["stick"]
        self.assertEqual(0, s["yaw"])
        self.assertEqual(0, s["rollWithoutTheMouse"])

    def test_the_keys_and_the_mouse_share_one_channel_by_magnitude(self) -> None:
        # `ControlMap::update` 0x083f1d70: primary (the mouse line) and
        # secondary (the arrows, `... IDKey_ArrowDown 1`), the larger kept, the
        # primary on a tie. They never add.
        sl = self.results["stick"]["slots"]
        self.assertEqual(1, sl["keyAlone"])
        self.assertEqual(-3.47, sl["keyAgainstAFastHand"])
        self.assertEqual(1, sl["keyAgainstASlowHand"])
        self.assertEqual(-1, sl["keyAgainstAnEqualHand"])

    def test_left_shift_routes_the_mouse_to_the_look(self) -> None:
        # Held: the counts turn the head and never reach the stage, so the
        # stick reads zero (and the router zeroes it anyway).
        s = self.results["stick"]
        self.assertTrue(s["heldNeedsKey"])
        self.assertEqual({"x": 0, "y": 0}, s["heldPending"])
        self.assertAlmostEqual(-30 * HEAD_SENS_DEG, s["heldLook"]["yaw"], places=4)
        self.assertEqual(0, s["heldStick"])

    def test_the_held_look_is_the_cameras_sign_times_the_box(self) -> None:
        # The box is on the device's Y (MLK-8), and the Camera turns by
        # sign(acceleration) x input (GUN-2). Nearly every shipped pilot camera
        # is negative (MLK-13), which undoes the shipped box: with it on, 30 px
        # toward the player looks down as it always did; off, it looks up.
        s = self.results["stick"]
        self.assertAlmostEqual(-30 * HEAD_SENS_DEG, s["heldLook"]["pitch"], places=4)
        self.assertAlmostEqual(30 * HEAD_SENS_DEG, s["heldPitchUninverted"], places=4)
        # A finger on a touch screen is not the mouse.
        self.assertAlmostEqual(-30 * HEAD_SENS_DEG, s["touchPitch"], places=4)

    def test_the_touch_look_zone_never_flies_the_aircraft(self) -> None:
        # A pilot's seat is not touchFlying (page-input.js `syncTouchFlying`),
        # so with no key the look zone's finger drag reaches neither the
        # stick's stage nor the view, as before the mouse flew.
        t = self.results["stick"]["touchZone"]
        self.assertEqual({"x": 0, "y": 0}, t["pending"])
        self.assertEqual({"yaw": 0, "pitch": 0}, t["look"])
        self.assertEqual(0, t["roll"])

    def test_the_owners_joystick_profile_binds_no_mouse_to_the_stick(self) -> None:
        self.assertEqual({"roll": 0, "pitch": 0}, self.results["stick"]["owner"])

    def test_a_gunners_map_binds_the_mouse_to_the_look_alone(self) -> None:
        g = self.results["stick"]["gunner"]
        self.assertEqual("land", g["context"])
        self.assertEqual(0, g["roll"])
        self.assertEqual(0, g["pitch"])


class OtherSeatTests(_Harness):
    """Ledger MLK-14: a seat flies on its own PCO's category, and looks by its
    own Camera's word. The seat trees are the extracted DC MH-6 and MH-53
    glbs' extras, run through the real `surveyVehicle`."""

    def test_dcs_air_co_pilots_and_passengers_are_on_the_air_profile(self) -> None:
        old = self.results["otherSeats"]["oldTree"]
        for seat in ("pilot", "coPilot", "passenger", "mh53CoPilot"):
            with self.subTest(seat=seat):
                self.assertEqual("air", old[seat]["profile"])
                self.assertEqual("VCAir", old[seat]["category"])
        # The door gunner's own PCO is VCLand: LandSea, as every gunner's.
        self.assertEqual("landSea", old["mh53Gunner"]["profile"])
        self.assertEqual("VCLand", old["mh53Gunner"]["category"])

    def test_their_control_map_is_the_air_one_left_shift_and_all(self) -> None:
        maps = self.results["otherSeats"]["maps"]
        self.assertEqual({"context": "air", "shiftIsLook": True}, maps["coPilot"])
        self.assertEqual({"context": "air", "shiftIsLook": True}, maps["passenger"])
        self.assertEqual({"context": "land", "shiftIsLook": False}, maps["mh53Gunner"])

    def test_a_tree_without_the_word_needs_the_key_where_it_can_prove_it(self) -> None:
        # The pilot by the shipped rule; the MH-53 co-pilot because his Camera
        # IS the pilot's template; the MH-6 bench cannot be told from the
        # co-pilot until the glb carries the word.
        old = self.results["otherSeats"]["oldTree"]
        self.assertTrue(old["pilot"]["needsKey"])
        self.assertTrue(old["mh53CoPilot"]["needsKey"])
        self.assertFalse(old["coPilot"]["needsKey"])
        self.assertFalse(old["passenger"]["needsKey"])
        self.assertFalse(old["mh53Gunner"]["needsKey"])

    def test_with_the_word_each_camera_answers_for_itself(self) -> None:
        word = self.results["otherSeats"]["wordTree"]
        self.assertTrue(word["pilot"]["needsKey"])
        self.assertTrue(word["passenger"]["needsKey"])
        self.assertFalse(word["coPilot"]["needsKey"])
        # DC Final's bench carries no word.
        self.assertFalse(word["finalPassenger"]["needsKey"])

    def test_the_pitch_sign_is_the_cameras_where_the_glb_has_it(self) -> None:
        # `H6CoPilotCamera` carries its own rig even in an old tree (it has a
        # child); DC Final's bench is +100000; unread, Air's majority, -1.
        n = self.results["otherSeats"]
        self.assertEqual(-1, n["oldTree"]["coPilot"]["pitchSign"])
        self.assertEqual(-1, n["oldTree"]["passenger"]["pitchSign"])
        self.assertEqual(1, n["oldTree"]["mh53Gunner"]["pitchSign"])
        self.assertEqual(1, n["wordTree"]["finalPassenger"]["pitchSign"])
        self.assertTrue(n["cached"])

    def test_a_bench_with_the_word_looks_only_with_the_key(self) -> None:
        p = self.results["otherSeats"]["page"]["passengerWithTheWord"]
        self.assertEqual("air", p["profile"])
        self.assertTrue(p["needsKey"])
        # Key up: the view stays and the counts go to the stage, which his
        # own PCO binds to nothing.
        self.assertEqual({"yaw": 0, "pitch": 0}, p["knock"])
        self.assertEqual({"x": 200, "y": 20}, p["knockPending"])
        # Held: the head turns, the vertical in the plain sense on the shipped
        # box (a negative camera); released, 0.75 a tick.
        self.assertAlmostEqual(-200 * HEAD_SENS_DEG, p["held"]["yaw"], places=4)
        self.assertAlmostEqual(-20 * HEAD_SENS_DEG, p["held"]["pitch"], places=4)
        self.assertAlmostEqual(0.75 * p["held"]["yaw"], p["releasedOneTick"]["yaw"], places=4)
        # The box off inverts it.
        self.assertAlmostEqual(20 * HEAD_SENS_DEG, p["heldPitchBoxOff"], places=4)

    def test_a_co_pilot_without_the_word_looks_freely_on_the_air_box(self) -> None:
        p = self.results["otherSeats"]["page"]["coPilot"]
        self.assertEqual("air", p["profile"])
        self.assertFalse(p["needsKey"])
        self.assertAlmostEqual(-200 * HEAD_SENS_DEG, p["knock"]["yaw"], places=4)
        self.assertAlmostEqual(-20 * HEAD_SENS_DEG, p["knock"]["pitch"], places=4)
        self.assertEqual({"x": 0, "y": 0}, p["knockPending"])
        # No word, no recentre.
        self.assertEqual(p["held"], p["releasedOneTick"])
        self.assertAlmostEqual(20 * HEAD_SENS_DEG, p["heldPitchBoxOff"], places=4)

    def test_dc_finals_positive_bench_is_inverted_on_the_shipped_box(self) -> None:
        p = self.results["otherSeats"]["page"]["finalPassenger"]
        self.assertFalse(p["needsKey"])
        self.assertAlmostEqual(20 * HEAD_SENS_DEG, p["knock"]["pitch"], places=4)
        self.assertAlmostEqual(-20 * HEAD_SENS_DEG, p["heldPitchBoxOff"], places=4)


class RebakedExportTests(_Harness):
    """The same rules over the con-reader export (`fixtures/air-seats.json`),
    where every Camera carries its word and its look rig."""

    def rules(self, model: str, seat: str) -> dict:
        return self.results["rebaked"][model][seat]

    def test_the_keyed_seats_are_the_ones_dcs_data_keys(self) -> None:
        keyed = {
            ("DesertCombat/MH-6", "MH-6"), ("DesertCombat/MH-6", "MH6Passenger_PCO3"),
            ("DesertCombat/MH-6", "MH6Passenger_PCO6"), ("DesertCombat/SA-342G", "SA-342G"),
            ("DesertCombat/SA-342G", "SA342Passenger3"), ("DesertCombat/SA-342G", "SA342Passenger4"),
            ("DesertCombat/MH-53", "MH-53"), ("DesertCombat/MH-53", "MH53CoPilot"),
            ("DesertCombat/Mi8", "Mi8"), ("DesertCombat/Mi8", "Mi8_CoPilot"),
            ("DesertCombat/F-14B", "F-14B"), ("DC_Final/MH-6", "MH-6"),
            ("XPack2/C47", "C47"), ("bf1942/Corsair", "Corsair"), ("bf1942/BF109", "BF109"),
            ("bf1942/B17", "B17"),
        }
        for model, seats in self.results["rebaked"].items():
            if model == "page":
                continue
            for seat, rules in seats.items():
                with self.subTest(model=model, seat=seat):
                    want = (model, seat) in keyed or (
                        model == "DesertCombat/MH-6" and seat.startswith("MH6Passenger"))
                    self.assertEqual(want, rules["needsKey"])

    def test_the_co_pilots_whose_word_dc_remmed_look_freely(self) -> None:
        # `rem ObjectTemplate.toggleMouseLook 1` ("Tan mod remmed to give
        # freelook") on H6CoPilotCamera and SA342CoPilotCamera.
        for model, seat in (("DesertCombat/MH-6", "H6CoPilot"), ("DesertCombat/SA-342G", "SA342CoPilot")):
            with self.subTest(seat=seat):
                r = self.rules(model, seat)
                self.assertEqual("air", r["profile"])
                self.assertFalse(r["needsKey"])

    def test_the_seat_categories(self) -> None:
        self.assertEqual("air", self.rules("DesertCombat/MH-6", "MH6Passenger_PCO3")["profile"])
        self.assertEqual("air", self.rules("DesertCombat/F-14B", "F14BRIO")["profile"])
        self.assertEqual("landSea", self.rules("DesertCombat/MH-53", "MH53_Passenger3_PCO")["profile"])
        self.assertEqual("landSea", self.rules("DesertCombat/Mi8", "Mi8_CoPilot")["profile"])
        self.assertEqual("landSea", self.rules("bf1942/B17", "B17_PCO1")["profile"])

    def test_the_signs_are_each_cameras(self) -> None:
        self.assertEqual(-1, self.rules("bf1942/Corsair", "Corsair")["pitchSign"])
        # The BF109 and B17 declare `setAcceleration 5000/5000/0` with
        # `setMaxSpeed 90/-90/0`: the same gain as the Corsair's `-5000` with
        # `90` (GUN-2, maxSpeed signed; lnxded 0x081d7866).
        self.assertEqual(-1, self.rules("bf1942/BF109", "BF109")["pitchSign"])
        self.assertEqual(-1, self.rules("bf1942/B17", "B17")["pitchSign"])
        self.assertEqual(1, self.rules("DC_Final/MH-6", "MH6Passenger_PCO3")["pitchSign"])
        self.assertEqual(1, self.rules("DC_Final/MH-6", "MH-6")["pitchSign"])
        # setAcceleration 5000/0/0 and 0/5000/0: an axis that cannot turn.
        self.assertEqual(0, self.rules("XPack2/C47", "C47")["pitchSign"])
        self.assertEqual(0, self.rules("DesertCombat/F-14B", "F14BRIO")["yawSign"])

    def test_the_neck_is_each_cameras(self) -> None:
        self.assertEqual((40, -5), (self.rules("bf1942/Corsair", "Corsair")["lookUp"],
                                    self.rules("bf1942/Corsair", "Corsair")["lookDown"]))
        self.assertEqual((40, 0), (self.rules("bf1942/B17", "B17")["lookUp"],
                                   self.rules("bf1942/B17", "B17")["lookDown"]))
        self.assertEqual((60, -45), (self.rules("DesertCombat/MH-6", "MH6Passenger_PCO3")["lookUp"],
                                     self.rules("DesertCombat/MH-6", "MH6Passenger_PCO3")["lookDown"]))

    def test_the_page_turns_each_seat_by_its_camera(self) -> None:
        p = self.results["rebaked"]["page"]
        yaw, pitch = -100 * HEAD_SENS_DEG, -20 * HEAD_SENS_DEG
        self.assertAlmostEqual(yaw, p["mh6Bench"]["yaw"], places=4)
        self.assertAlmostEqual(pitch, p["mh6Bench"]["pitch"], places=4)
        self.assertAlmostEqual(yaw, p["c47Pilot"]["yaw"], places=4)
        self.assertEqual(0, p["c47Pilot"]["pitch"])
        self.assertEqual(0, p["f14Rio"]["yaw"])
        # The RIO's camera is positive: inverted on the shipped Air box.
        self.assertAlmostEqual(-pitch, p["f14Rio"]["pitch"], places=4)
        # The BF109's and B17's are negative once the signed maxSpeed is
        # read, as the Corsair's is: the plain sense on the shipped box.
        self.assertAlmostEqual(pitch, p["bf109Pilot"]["pitch"], places=4)
        self.assertAlmostEqual(pitch, p["b17Pilot"]["pitch"], places=4)
        self.assertAlmostEqual(pitch, p["corsairPilot"]["pitch"], places=4)

    def test_the_gain_is_the_acceleration_times_the_signed_max_speed(self) -> None:
        g = self.results["lookGain"]
        self.assertEqual(-1, g["spitfire"])
        self.assertEqual(-1, g["bf109"])
        self.assertEqual(1, g["both"])
        self.assertEqual(1, g["plain"])
        # A zero maxSpeed commands no speed: the axis is still.
        self.assertEqual(0, g["zeroSpeed"])
        # No maxSpeed at all is the template's own positive 1.0 (0x081d9130).
        self.assertEqual(-1, g["noSpeed"])


class NeckTests(_Harness):
    """How far the cockpit look turns. The engine's pitch is the `setRotation`
    pitch, positive nose-down (ledger MLK-17): `CorsairCamera`'s
    `setMinRotation -70/-40/0`, `setMaxRotation 70/5/0` is 40 degrees up and
    5 down. The page's look counts up as positive."""

    def test_the_default_neck_is_the_corsairs_the_right_way_up(self) -> None:
        d = self.results["neck"]["defaults"]
        self.assertAlmostEqual(40, d["up"], places=6)
        self.assertAlmostEqual(-5, d["down"], places=6)
        self.assertAlmostEqual(70, d["left"], places=6)
        self.assertAlmostEqual(-70, d["right"], places=6)

    def test_a_cameras_own_rig_is_mirrored_into_the_look(self) -> None:
        k = self.results["neck"]
        rad = math.pi / 180
        self.assertAlmostEqual(-5 * rad, k["corsairLimits"]["pitchDown"], places=12)
        self.assertAlmostEqual(40 * rad, k["corsairLimits"]["pitchUp"], places=12)
        self.assertAlmostEqual(-70 * rad, k["corsairLimits"]["yawMin"], places=12)
        self.assertAlmostEqual(70 * rad, k["corsairLimits"]["yawMax"], places=12)
        # DC's H6CoPilotCamera, -70/-60 .. 70/45: 60 up, 45 down.
        self.assertAlmostEqual(60, k["coPilot"]["up"], places=6)
        self.assertAlmostEqual(-45, k["coPilot"]["down"], places=6)
        # Outside the cockpit the orbit keeps its own clamps.
        self.assertAlmostEqual(1.2 / rad, k["coPilotChase"]["up"], places=6)

    def test_a_free_yaw_is_unlimited_and_other_inputs_are_not_the_neck(self) -> None:
        k = self.results["neck"]
        self.assertTrue(k["freeYawUnlimited"])
        self.assertIsNone(k["freeYaw"].get("yawMin"))
        self.assertEqual(None, k["notTheLook"])
        self.assertEqual(None, k["none"])

    def test_a_pilot_pushing_the_mouse_away_looks_up_forty_degrees(self) -> None:
        k = self.results["neck"]
        self.assertAlmostEqual(40, k["pilotPushedAway"]["pitch"], places=6)
        self.assertAlmostEqual(-5, k["pilotPulledBack"]["pitch"], places=6)


if __name__ == "__main__":
    unittest.main()
