"""`viewer/mouse-look-key.js` — the pilot's mouse-look key — under node.

features/pilot-mouse-look. The sentence these tests defend:

    in an aircraft pilot's seat the mouse turns the view only while
    `c_PIMouseLook` is held (Left Shift in the shipped Air map), the released
    view eases back to straight ahead at 0.75 a 30 Hz tick, and holding the
    key takes the rudder and the stick away from the aircraft

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
    for name in ("mouse-look-key.js", "mouse-input.js", "local-look.js", "vehicle-camera.js",
                 "controls.js", "controls-defaults.js", "console.js", "console-view.js")
}
MODULES["node_modules/three/three.module.js"] = VIEWER / "vendor" / "three.module.js"
for name in ("Common.con", "Infantry.con", "Air.con", "Land.con"):
    MODULES[f"fixtures/controls-profile-skandia/{name}"] = FIXTURES / name
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

    def test_a_knock_of_the_mouse_does_nothing_in_the_cockpit(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
