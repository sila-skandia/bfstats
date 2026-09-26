"""`viewer/mouse-input.js` — the mouse-look input stage — under node.

Ledger GUN-2b, and the half of LOOP-1 that reaches the player's hand. The one
sentence these tests exist to defend:

    PlayerInput[c_PIMouseLookX] = 0.001 x (counts per second) x (5 x s + 0.1)

computed once per pumped frame and read by every simulation tick of that frame,
then clamped to +-16 and quantised on the way into the simulation. Every
constant below has an address in `viewer/mouse-input.js`'s own header; these
tests are what stops a later edit from quietly changing one.

The case that matters most is `MouseLookFrameRateTests`: the same hand movement
has to turn a turret the same amount at 30, 60 and 144 frames a second and
through a deliberately vile slicing of uneven frames, because that is the
property the whole rate-and-hold design buys and the reason the retired
pixels-per-frame model had to go.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "mouse_input_harness.mjs"

MODULES = {
    "mouse-input.js": VIEWER / "mouse-input.js",
    # `seats.js` so the Sherman numbers run through the real `TurretAxis`
    # servo rather than a re-implementation of it here, and its own
    # `seat-dots.js` import.
    "seats.js": VIEWER / "seats.js",
    "seat-survey.js": VIEWER / "seat-survey.js",
    "camera-pivot.js": VIEWER / "camera-pivot.js",
    "turret-rig.js": VIEWER / "turret-rig.js",
    "vehicle-occupancy.js": VIEWER / "vehicle-occupancy.js",
    "entry-points.js": VIEWER / "entry-points.js",
    "spawned-craft.js": VIEWER / "spawned-craft.js",
    "fire-state.js": VIEWER / "fire-state.js",
    # `bomb-release.js` (the salvo arithmetic, the release speed and the
    # drag law) and `torpedo-run.js` (an aircraft torpedo's water run),
    # both reached through gunfire.js / seats.js.
    "bomb-release.js": VIEWER / "bomb-release.js",
    "torpedo-run.js": VIEWER / "torpedo-run.js",
    "seat-dots.js": VIEWER / "seat-dots.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


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
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class _Harness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class MouseInputConstantTests(_Harness):
    """The numbers, each read out of the client at the address in the module."""

    def test_the_rate_factor_and_the_sensitivity_affine(self) -> None:
        # `ds:0x008d5bc4` = 6f 12 83 3a = 0.001f, the factor the DX8 mouse
        # device's `update(float dt)` (0x0066ffe0) multiplies the count by
        # before dividing by dt. `ds:0x008d646c` = 5.0f and `ds:0x008c53cc` =
        # 0.1f, the two halves of `applyMouseSensitivity` (0x006c55f0).
        c = self.results["constants"]
        self.assertEqual(0.001, c["rateFactor"])
        self.assertEqual(5.0, c["sensitivityGain"])
        self.assertEqual(0.1, c["sensitivityOffset"])

    def test_the_wire_format_is_twelve_bits_over_plus_minus_sixteen(self) -> None:
        # `PlayerAction::set` (lnxded 0x081128a0) pushes 0x41800000 = 16.0f and
        # 0xc = 12 into `floatToFixed` (0x08113480), so the axis has 4095 steps
        # across +-16.
        c = self.results["constants"]
        self.assertEqual(16.0, c["axisRange"])
        self.assertEqual(12, c["axisBits"])
        self.assertEqual(4095, c["axisSteps"])
        # ...and `PlayerAction::get` (0x0815c5a0) snaps the decode to
        # hundredths with `ds:0x086b01ac` = 100.0f.
        self.assertEqual(100.0, c["decodeGranularity"])

    def test_the_simulation_step_is_the_engines_own(self) -> None:
        # LOOP-1: `g_simulationFps` = 30.0 (lnxded 0x08716b5c), never written,
        # and a backlog past nine collapses to one tick
        # (`GameClient::update` 0x0048fca8 `cmp ebx,0x9`).
        c = self.results["constants"]
        self.assertAlmostEqual(1 / 30, c["tickDt"], places=12)
        self.assertEqual(9, c["maxBacklog"])

    def test_the_four_shipped_sensitivities(self) -> None:
        # Read out of `Mods/bf1942/Settings/Default/Controls/`: Common.con:42,
        # Infantry.con:28 and Land.con:22 all ship 0.25; Air.con:27 ships 0.75.
        defaults = self.results["constants"]["defaults"]
        self.assertEqual(0.25, defaults["common"])
        self.assertEqual(0.25, defaults["infantry"])
        self.assertEqual(0.25, defaults["landSea"])
        self.assertEqual(0.75, defaults["air"])

    def test_the_scale_each_of_them_buys(self) -> None:
        # `5 * s + 0.1`. 1.35 on foot, on land and at sea; **3.85 in the air**,
        # which is the number the first reader of GUN-2b missed entirely.
        scale = self.results["scale"]["shipped"]
        self.assertEqual(1.35, scale["common"])
        self.assertEqual(1.35, scale["infantry"])
        self.assertEqual(1.35, scale["landSea"])
        self.assertEqual(3.85, scale["air"])

    def test_the_menu_slider_spans_a_tenth_to_five_and_a_tenth(self) -> None:
        self.assertEqual(0.1, self.results["scale"]["atZero"])
        self.assertEqual(5.1, self.results["scale"]["atOne"])

    def test_the_profile_comes_from_the_seats_vehicle_category(self) -> None:
        # The client reads it off the entered PCO (`vtable[+0x78]`,
        # 0x006d78a5): VCLand (0) and VCSea (1) select the LandSea control map,
        # VCAir (2) the Air one, and anything else leaves the soldier's own
        # map active. Every vanilla stationary weapon and gunner seat declares
        # VCLand — an aircraft's rear gun included — so only a pilot is on Air.
        p = self.results["scale"]["profileFor"]
        self.assertEqual("infantry", p["onFoot"])
        self.assertEqual("landSea", p["land"])
        self.assertEqual("landSea", p["sea"])
        self.assertEqual("air", p["air"])
        self.assertEqual("landSea", p["vcLand"])
        self.assertEqual("landSea", p["vcSea"])
        self.assertEqual("air", p["vcAir"])
        self.assertEqual("infantry", p["uncategorised"])


class MouseWireFormatTests(_Harness):
    """`floatToFixed` / `PlayerAction::get`, the two halves of the round trip."""

    def test_a_packed_zero_decodes_back_to_exactly_zero(self) -> None:
        # The half-LSB trap. `floatToFixed(0, 12, 16)` truncates 2047.5 to
        # 2047, which decodes raw to -0.0039072 — and `PlayerAction::get`'s
        # `frndint(v*100)/100` is what turns it back into 0. Without that snap
        # every idle turret in the game would creep at 0.137 deg/s, which is
        # eight degrees a minute and would be the first thing anyone noticed.
        wire = self.results["wire"]
        self.assertEqual(2047, wire["zeroPacks"])
        self.assertAlmostEqual(-0.0039072, wire["zeroRawDecode"], places=7)
        self.assertEqual(0, wire["zeroRoundTrip"])

    def test_the_axis_saturates_at_plus_minus_sixteen(self) -> None:
        wire = self.results["wire"]
        self.assertEqual(4095, wire["packsAtRange"])
        self.assertEqual(0, wire["packsBelowRange"])
        self.assertEqual(16.0, wire["saturatesHigh"])
        self.assertEqual(-16.0, wire["saturatesLow"])

    def test_everything_the_simulation_reads_is_a_multiple_of_a_hundredth(self) -> None:
        wire = self.results["wire"]
        self.assertTrue(wire["allAreHundredths"])
        # The encoding's own step is 32/4095 = 0.0078, coarser than the
        # decode's hundredth, and `floatToFixed` truncates rather than rounds —
        # so an input under one step above zero packs to the same 2047 and
        # comes back as nothing at all. At the shipped scale that is a hand
        # under about six counts a second, i.e. a resting wrist.
        self.assertAlmostEqual(0.00781441, wire["encodingStep"], places=7)
        self.assertEqual(0, wire["granularitySamples"][0])   # 0.003
        self.assertEqual(0, wire["granularitySamples"][1])   # 0.006
        self.assertEqual(0.02, wire["granularitySamples"][2])
        self.assertEqual(1.0, wire["granularitySamples"][3])

    def test_the_round_trip_is_never_worse_than_one_encoding_step(self) -> None:
        # One truncated step (0.0078) plus the decode's own half-hundredth.
        for error in self.results["wire"]["roundTrips"]:
            self.assertLessEqual(error, 0.013)

    def test_frndint_rounds_ties_to_even(self) -> None:
        # x87's default control word, which `floatToFixed` restores
        # (0x08113507 `fldcw`) after forcing truncation for its own `fistp`.
        self.assertEqual([0, 2, 2, -0, -2, 2, 3], self.results["wire"]["rndint"])


class MouseRateTests(_Harness):
    """The formula itself, and where it saturates."""

    def test_a_thousand_counts_a_second_is_one_point_three_five(self) -> None:
        rate = self.results["rate"]
        self.assertAlmostEqual(1.35, rate["thousandCountsLandSea"], places=6)
        self.assertAlmostEqual(rate["thousandCountsExpected"],
                               rate["thousandCountsLandSea"], places=6)

    def test_the_air_profile_is_three_times_the_rest(self) -> None:
        # 3.85 against 1.35 — an aircraft's own pilot seat, and nothing else.
        rate = self.results["rate"]
        self.assertAlmostEqual(3.85, rate["thousandCountsAir"], places=6)

    def test_it_saturates_at_about_eleven_thousand_eight_hundred_counts(self) -> None:
        # 16 / (0.001 * 1.35) = 11,851.85 counts a second at the shipped 0.25.
        rate = self.results["rate"]
        self.assertAlmostEqual(11851.85, rate["saturationCounts"], places=2)
        self.assertLess(rate["justBelowSaturation"], 16.0)
        self.assertEqual(16.0, rate["justAboveSaturation"])
        self.assertEqual(16.0, rate["farAboveSaturation"])
        self.assertEqual(-16.0, rate["farBelowSaturation"])

    def test_the_invert_flags_flip_each_axis(self) -> None:
        # -1.36 rather than -1.35 because `floatToFixed` truncates the packed
        # integer toward zero on a value that has already been shifted into
        # [0, 4095] — so the encoding is a half-step more negative on the
        # negative side. That asymmetry is the engine's, not a rounding slip
        # here, and it is under a hundredth of an input unit.
        rate = self.results["rate"]
        self.assertAlmostEqual(-1.36, rate["inverted"]["x"], places=6)
        self.assertAlmostEqual(-0.68, rate["inverted"]["y"], places=6)

    def test_counts_per_pixel_is_the_one_tunable_and_is_linear(self) -> None:
        # The single unproven unit: whether one browser `movementX` pixel is
        # one DirectInput count. Default 1.0, `?turret=` multiplies it.
        rate = self.results["rate"]
        self.assertAlmostEqual(2.7, rate["doubledCountsPerPixel"], places=6)


class MouseTurretTests(_Harness):
    """What the number then buys on a real `RotationalBundle` axis."""

    def test_a_sherman_tower_is_commanded_at_47_25_for_a_thousand_counts(self) -> None:
        # `ShermanTower setMaxSpeed 35`, and `maxSpeed` is a gain: deg/s per
        # unit of input. 35 * 1.35 = 47.25 deg/s.
        s = self.results["sherman"]
        self.assertAlmostEqual(47.25, s["expectedDegPerSec"], places=4)
        self.assertAlmostEqual(47.25, s["commandedDegPerSec"], places=4)
        self.assertAlmostEqual(47.25, s["measuredDegPerSec"], delta=0.5)

    def test_an_mg42_is_twice_that(self) -> None:
        # `StationaryMG42Point setMaxSpeed 70`.
        self.assertAlmostEqual(94.5, self.results["sherman"]["mg42Expected"], places=4)


class MouseLookFrameRateTests(_Harness):
    """The property the rate-and-hold design exists for."""

    def test_the_same_hand_turns_the_same_amount_at_any_frame_rate(self) -> None:
        # Degrees per delivered count, which is the invariant: a run of whole
        # frames need not end on a tick boundary, so the last sliver of hand
        # movement is still in the accumulator waiting for the next pump.
        # 0.001 * 1.35 * 35 = 0.04725 degrees a count on a Sherman tower.
        f = self.results["frameRate"]
        self.assertAlmostEqual(0.04725, f["expectedDegPerCount"], places=8)
        # The 1% is the wire's, not the loop's: `floatToFixed` TRUNCATES, so
        # every pump loses up to half a 12-bit step (0.0039 of an input unit)
        # and a frame rate whose tick boundaries do not fall on frame
        # boundaries varies the counts per pump and so the size of that bias.
        # At 2000 counts a second it comes to 0.15%. The engine has exactly the
        # same bias; what matters is that the LOOP contributes none.
        tolerance = f["expectedDegPerCount"] * 0.01
        for key in ("at30", "at60", "at144"):
            self.assertAlmostEqual(f["expectedDegPerCount"], f[key]["degPerCount"],
                                   delta=tolerance,
                                   msg=f"{key} drifted from the law")
        # ...and against each other, which is the comparison a player makes.
        self.assertAlmostEqual(f["at30"]["degPerCount"], f["at60"]["degPerCount"],
                               places=8)
        self.assertAlmostEqual(f["at30"]["degPerCount"], f["at144"]["degPerCount"],
                               delta=tolerance)
        # Under two seconds of hand at 30 and 60 fps the whole 4000 counts land,
        # so the raw totals match to the degree as well.
        self.assertAlmostEqual(f["expectedDegrees"], f["at30"]["degrees"], delta=0.05)
        self.assertAlmostEqual(f["expectedDegrees"], f["at60"]["degrees"], delta=0.05)

    def test_uneven_frames_lose_nothing_either(self) -> None:
        # A 200 ms stall (six ticks at once), runs of frames far too short to
        # make a tick, and everything between.
        f = self.results["frameRate"]
        self.assertGreater(f["unevenFrameCount"], 40)
        self.assertAlmostEqual(f["expectedDegPerCount"], f["uneven"]["degPerCount"],
                               delta=f["expectedDegPerCount"] * 0.01)

    def test_every_slicing_runs_the_same_sixty_ticks(self) -> None:
        # Two seconds is sixty ticks however the frames fell — give or take the
        # one a rate whose period is not exactly representable leaves pending —
        # and only the number of PUMPS differs, which is exactly what the rate
        # encoding makes harmless.
        f = self.results["frameRate"]
        for key in ("at30", "at60", "at144", "uneven"):
            self.assertIn(f[key]["ticks"], (59, 60), msg=key)
        self.assertEqual(60, f["at30"]["pumps"])
        self.assertEqual(60, f["at60"]["pumps"])
        # At 144 fps most frames run no tick at all and so never pump.
        self.assertGreater(f["at144"]["zeroTickFrames"], 200)
        self.assertLessEqual(f["at144"]["pumps"], 60)

    def test_what_is_left_pending_is_under_one_frame_of_hand(self) -> None:
        # Never dropped, only deferred: it is the next pump's first counts.
        f = self.results["frameRate"]
        for key in ("at30", "at60", "at144", "uneven"):
            self.assertLess(f[key]["pendingPixels"], 4000 / 30, msg=key)
            self.assertGreaterEqual(f[key]["pendingPixels"], 0, msg=key)


class MouseZeroTickTests(_Harness):
    """A frame that owes no tick does not pump, and keeps its counts."""

    def test_short_frames_hold_their_counts_and_the_last_value(self) -> None:
        # `InputManager::update` returns before the pump when the accumulator
        # has not crossed a tick (0x0049cf46), so DirectInput keeps counting.
        before = self.results["zeroTick"]["beforePump"]
        self.assertEqual([0, 0, 0, 0], before["ticks"])
        self.assertEqual(0, before["pumps"])
        self.assertEqual(0, before["heldX"])
        self.assertAlmostEqual(80, before["pendingPixels"], places=6)

    def test_the_next_pumped_frame_collects_all_of_them(self) -> None:
        after = self.results["zeroTick"]["afterPump"]
        self.assertEqual(1, after["ticks"])
        self.assertAlmostEqual(after["expected"], after["heldX"], places=6)
        self.assertEqual(0, after["pendingPixels"])

    def test_a_non_positive_pump_leaves_the_registers_alone(self) -> None:
        # The device's own gate: `fld dt; fcomp 0.0f; test ah,0x41; jne`
        # (0x00670028-0x00670037) skips the whole axis block, which is why
        # ticks 2..N of a frame — pumped with 0.0f — read the same value rather
        # than zero.
        gate = self.results["zeroTick"]["gate"]
        self.assertTrue(gate["unchanged"])
        self.assertAlmostEqual(999, gate["stillPending"], places=6)


class SoldierLookLawTests(_Harness):
    """`BFSoldier::handlePlayerInput`, lnxded 0x08273c70."""

    def test_the_yaw_is_three_times_the_pitch(self) -> None:
        # `0x0827457d fmul ds:0x86c08c8` = 00 00 40 40 = 3.0 on the yaw path,
        # and nothing at all on the pitch path (0x08274537 subtracts the value
        # as it stands). The angle is degrees both times:
        # `yaw<float>` -> `rotateAboutLine` -> `setRotateAboutLine`
        # 0x080621b0 -> **`rotateZDeg<float>` 0x080625f0**, and the pitch is
        # clamped against `setPointUpDownAngle 38.0 38.0`.
        s = self.results["soldier"]
        self.assertEqual(3.0, self.results["constants"]["soldierYawGain"])
        self.assertEqual(1.0, self.results["constants"]["soldierPitchGain"])
        self.assertTrue(s["yawIsThreeTimesPitch"])

    def test_the_shipped_hand_turns_a_soldier_at_a_known_rate(self) -> None:
        # `input * dt * g_simulationFps` degrees a tick, and `dt * 30` is 1 at
        # the fixed tick — so `0.001 * 1.35 * 3 * 30` = 0.1215 degrees of yaw
        # per count and a third of that in pitch.
        s = self.results["soldier"]
        self.assertAlmostEqual(0.1215, s["yawDegPerCount"], places=6)
        self.assertAlmostEqual(0.0405, s["pitchDegPerCount"], places=6)

    def test_it_lands_within_four_percent_of_the_constant_it_replaces(self) -> None:
        # `map.html`'s `LOOK_SENS = 0.0022` rad/px was fitted by feel and never
        # had a citation. It comes to 0.12605 degrees a pixel against the read
        # law's 0.1215 degrees a count — 3.7% apart, which is the only evidence
        # anyone has that a browser pixel is about one mouse count. Guarding it
        # at 5% so a future change to either number has to be deliberate.
        s = self.results["soldier"]
        drift = abs(s["legacyLookSensDegPerPixel"] - s["yawDegPerCount"])
        self.assertLess(drift / s["yawDegPerCount"], 0.05)

    def test_the_view_turns_the_same_amount_at_any_frame_rate(self) -> None:
        # Per delivered count, for the same reason the turret run measures
        # that: a whole number of frames need not end on a tick boundary.
        s = self.results["soldier"]
        for key in ("at30", "at60", "at144"):
            self.assertAlmostEqual(s["yawDegPerCount"], s[key]["yawPerCount"],
                                   delta=s["yawDegPerCount"] * 0.01, msg=key)
            self.assertAlmostEqual(s["pitchDegPerCount"], s[key]["pitchPerCount"],
                                   delta=s["pitchDegPerCount"] * 0.01, msg=key)
        # At 30 and 60 the whole 1000 counts land inside the second, so the
        # raw totals match too.
        for key in ("at30", "at60"):
            self.assertAlmostEqual(s["expectedYaw"], s[key]["yaw"], delta=0.05, msg=key)
            self.assertAlmostEqual(s["expectedPitch"], s[key]["pitch"], delta=0.05,
                                   msg=key)


class MouseConsoleWordTests(_Harness):
    """What `game.set*MouseSensitivity` does to the stage."""

    def test_reading_back_gives_the_shipped_defaults(self) -> None:
        readBack = self.results["console"]["shippedReadBack"]
        self.assertEqual({"common": 0.25, "infantry": 0.25,
                          "landSea": 0.25, "air": 0.75}, readBack)

    def test_setting_one_moves_only_that_profiles_scale(self) -> None:
        c = self.results["console"]
        self.assertEqual(0.4, c["afterSet"]["air"])
        self.assertAlmostEqual(2.1, c["airScaleAfterSet"], places=10)
        self.assertEqual(1.0, c["afterSet"]["infantry"])
        self.assertAlmostEqual(5.1, c["infantryScaleAtMax"], places=10)

    def test_the_word_does_not_clamp_because_the_engine_does_not(self) -> None:
        # `ControlSettings::setSensitivity` (client 0x006eb1a0) is
        # `mov eax,[esp+4]; mov [ecx+0xc],eax`, plus a one-time seed of the
        # saved slot at +0x10 while it still holds the -1.0f sentinel. There
        # is no clamp anywhere on that path, so the console word must not
        # invent one: 0..1 is the MENU SLIDER's range. 5 buys `5*5+0.1`, and
        # a value below -0.02 really does invert the axis.
        c = self.results["console"]
        self.assertEqual(5, c["aboveMenuRange"])
        self.assertAlmostEqual(25.1, c["aboveMenuScale"], places=10)
        self.assertEqual(-3, c["belowMenuRange"])
        self.assertAlmostEqual(-14.9, c["belowMenuScale"], places=10)

    def test_an_unknown_profile_or_a_bad_number_changes_nothing(self) -> None:
        c = self.results["console"]
        self.assertTrue(c["rejected"])
        self.assertEqual(0.4, c["ignoredKeepsValue"])


class MousePadTests(_Harness):
    """The touch pad, which is the viewer's own mapping and says so."""

    def test_full_deflection_is_a_hand_at_the_pad_rate(self) -> None:
        pad = self.results["pad"]
        self.assertAlmostEqual(pad["sameAsSevenTwenty"], pad["fullDeflection"],
                               places=10)
        self.assertAlmostEqual(0.97, pad["fullDeflection"], places=6)

    def test_a_half_deflection_is_half_of_it(self) -> None:
        pad = self.results["pad"]
        self.assertAlmostEqual(-0.49, pad["halfDeflectionInverted"], places=6)


if __name__ == "__main__":
    unittest.main()
