"""`viewer/swim.js` under node: a man in the water, and the clock that kills him.

Every assertion here is a reading of `bf1942_lnxded.static` or of
`animations/AnimationStatesSwim.con`, not a behaviour anyone chose. The three
that are easy to get wrong:

* The entry and exit thresholds are **different** -- 0.43 m in, 0.35 m out
  (`0x086d29bc` and `0x086d29b8`) -- and the 8 cm of hysteresis is what stops a
  man standing in the surf flickering between walking and swimming.

* `Lb_EndSwim` still declares `c_AsmIsSwimming`, so leaving the water does not
  drop the flag; the clip playing out and `addTransitionWhenDone Lb_Stand` does.

* The drowning timer resets to a flat **1.0 s** after it fires, not to the 90 s
  delay (`Armor::update` stores `0x3f800000`). So the delay is a grace period
  that happens once and the bleed afterwards is a hit a second.
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
HARNESS = Path(__file__).with_name("swim_harness.mjs")
MODULES = {"swim.js": VIEWER / "swim.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SwimConstantTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_thresholds_and_the_draft_are_the_engines(self) -> None:
        c = self.results["constants"]
        # 0x086d29bc, 0x086d29b8, 0x086c4f70, 0x086c5288.
        self.assertEqual(0.43, c["enter"])
        self.assertEqual(0.35, c["leave"])
        self.assertEqual(0.4, c["draft"])
        self.assertEqual(5, c["gain"])
        # The entry threshold must be above the exit one or there is no
        # hysteresis and a man in the surf flickers.
        self.assertGreater(c["enter"], c["leave"])

    def test_the_animation_state_flag_bits_are_consecutive(self) -> None:
        # `ObjTemplBFModule::init`'s own `addConstantHelper` calls, one bit each:
        # 0x0829914a, 0x0829917a, 0x082991aa, 0x082991da. The 0x20/0x40 pair
        # PHY-8 reads sits on the end of the same run.
        c = self.results["constants"]
        self.assertEqual(0x2, c["hideWeapon"])
        self.assertEqual(0x8, c["isSwimming"])
        self.assertEqual(0x10, c["isClimbing"])

    def test_the_six_families_name_the_engines_own_states(self) -> None:
        self.assertEqual(
            ["swimStart", "swimFloat", "swimForward", "swimBackward",
             "swimEnd", "swimDie"],
            self.results["families"])
        clips = self.results["clips"]
        self.assertEqual({"lower": "Lb_StartSwim", "upper": "Ub_StartSwim"},
                         clips["swimStart"])
        self.assertEqual({"lower": "Lb_Floating", "upper": "Ub_Floating"},
                         clips["swimFloat"])
        self.assertEqual({"lower": "Lb_EndSwim", "upper": "Ub_EndSwim"},
                         clips["swimEnd"])
        # `AnimationStatesDie.con`, selected by `handleDamage` 0x08270c63 when
        # the lower body carries `c_AsmIsSwimming`.
        self.assertEqual({"lower": "Lb_DieSwim", "upper": "Ub_DieSwim"},
                         clips["swimDie"])

    def test_every_family_names_both_halves(self) -> None:
        for family, pair in self.results["clips"].items():
            self.assertIsInstance(pair.get("lower"), str, family)
            self.assertIsInstance(pair.get("upper"), str, family)


class SwimDepthTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_depth_is_the_surface_over_the_feet_clamped_at_zero(self) -> None:
        d = self.results["depth"]
        self.assertEqual(2, d["under"])
        self.assertEqual(0, d["atSurface"])
        self.assertEqual(0, d["above"])
        # A level with no water: `terrainBase->getWaterLevel() == -1.0` in
        # another shape (`0x082821b9`).
        self.assertEqual(0, d["noWater"])
        self.assertEqual(0, d["nan"])

    def test_the_stroke_bands_are_the_transitions_own(self) -> None:
        # `addTransitionOne c_PIThrottle 0.5 1 -> Lb_SwimForward`, and both
        # strokes `returnToState Lb_Floating`, so the band is inclusive of 0.5.
        s = self.results["stroke"]
        self.assertEqual("swimForward", s["hardForward"])
        self.assertEqual("swimFloat", s["band"])
        self.assertEqual("swimForward", s["justOver"])
        self.assertEqual("swimFloat", s["still"])
        self.assertEqual("swimFloat", s["gentleBack"])
        self.assertEqual("swimBackward", s["hardBack"])
        self.assertEqual("swimFloat", s["garbage"])


class SwimStateTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_man_wading_is_not_swimming(self) -> None:
        # 0.40 m of water over the feet is under the 0.43 threshold.
        wading = self.results["wading"]
        self.assertFalse(wading["swimming"])
        self.assertIsNone(wading["family"])
        self.assertIsNone(wading["pin"])

    def test_past_the_threshold_he_starts_swimming(self) -> None:
        entering = self.results["entering"]
        self.assertTrue(entering["swimming"])
        self.assertEqual("swimStart", entering["family"])

    def test_the_hysteresis_holds_him_in_between_the_two_thresholds(self) -> None:
        stays = self.results["staysInAtPointThreeSix"]
        self.assertTrue(stays["swimming"])
        self.assertNotEqual("swimEnd", stays["family"])
        out = self.results["exitsAtPointThreeFour"]
        self.assertEqual("swimEnd", out["family"])

    def test_the_exit_clip_and_not_the_depth_drops_the_flag(self) -> None:
        self.assertTrue(self.results["exitClipHeldTheFlag"])
        self.assertGreater(self.results["exitClipTicks"], 1)
        done = self.results["exitClipEndsTheSwim"]
        self.assertFalse(done["swimming"])
        self.assertIsNone(done["family"])

    def test_the_entry_one_shot_hands_over_to_a_stroke(self) -> None:
        self.assertEqual("swimStart", self.results["entryPlaysStartSwim"]["family"])
        # `addTransitionWhenDone Lb_SwimForward`, and with no throttle held the
        # stroke's own `returnToState Lb_Floating` takes it straight to treading.
        self.assertEqual("swimFloat",
                         self.results["entryHandsOverToSwimForward"]["family"])

    def test_the_throttle_picks_the_stroke(self) -> None:
        s = self.results["strokeFromThrottle"]
        self.assertEqual("swimForward", s["forward"])
        self.assertEqual("swimBackward", s["backward"])
        self.assertEqual("swimFloat", s["floating"])

    def test_a_swimmer_floats_at_the_surface_less_the_draft(self) -> None:
        # `0x082822d4`: the position is written to `surfaceY - 0.4` whatever the
        # feet were doing, so a man who fell in from 20 m under ends up at the
        # same draft as one who waded in.
        pin = self.results["draftPin"]
        self.assertAlmostEqual(2.6, pin["deep"], places=6)
        self.assertAlmostEqual(2.6, pin["shallow"], places=6)
        # `0x082822bc` refuses to write the position when the feet are already
        # above the surface, so the clamp never pulls a man DOWN into the water.
        self.assertIsNone(pin["aboveTheSurface"])

    def test_a_man_on_a_ladder_is_outside_the_whole_function(self) -> None:
        # `0x082821da test eax,0x10`: `c_AsmIsClimbing` returns before the water
        # is even sampled, so a ladder over deep water never starts a swim --
        # and never ends one either, because the return is before the exit test.
        ladder = self.results["ladder"]
        self.assertFalse(ladder["neverEnters"]["swimming"])
        self.assertTrue(ladder["keepsASwimmerIn"]["before"]["swimming"])
        self.assertTrue(ladder["keepsASwimmerIn"]["after"]["swimming"])

    def test_a_level_with_no_water_has_no_swimming(self) -> None:
        self.assertFalse(self.results["noWater"]["swimming"])

    def test_dying_in_the_water_plays_the_swim_death(self) -> None:
        # `BFSoldier::handleDamage` tests `c_AsmIsSwimming` FIRST, before the
        # pose (`0x08270c63`), so a swimming death is never a standing one.
        die = self.results["dieSwim"]
        self.assertEqual({"lower": "Lb_DieSwim", "upper": "Ub_DieSwim"},
                         die["dead"])
        self.assertNotEqual(die["alive"], die["dead"])
        # Dying on dry land is not this file's business.
        self.assertIsNone(self.results["dieDry"]["dead"])


class DrowningTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_law_is_the_soldier_templates_own_numbers(self) -> None:
        # `CommonSoldierData.inc`: DamageFromWater 1, WaterDamageDelay 90,
        # hpLostWhileDamageFromWater 1. The 1.0 s interval is `Armor::update`'s
        # own reset value, not the delay.
        c = self.results["constants"]
        self.assertEqual(90, c["delay"])
        self.assertEqual(1, c["hpLost"])
        self.assertEqual(1.0, c["interval"])

    def test_nothing_happens_for_the_first_ninety_seconds(self) -> None:
        drown = self.results["drowning"]
        self.assertGreater(drown["firstHitAt"], 90.0)
        self.assertLess(drown["firstHitAt"], 90.1)
        for sample in drown["samples"]:
            if sample["t"] <= 90:
                self.assertEqual(30, sample["hp"], sample)

    def test_then_one_hit_point_a_second_off_thirty(self) -> None:
        # 90 s of grace, 30 hits a second apart, so a man who never surfaces is
        # dead 119 s after he started swimming.
        drown = self.results["drowning"]
        self.assertGreater(drown["deadAt"], 118.9)
        self.assertLess(drown["deadAt"], 119.2)
        self.assertEqual(1, drown["perHit"])

    def test_surfacing_for_one_tick_buys_the_whole_delay_again(self) -> None:
        # `Armor::update`'s dry arm is `timer = waterDamageDelay`, a plain
        # assignment of the stored delay, so there is no partial credit.
        reset = self.results["surfacingResetsTheClock"]
        self.assertAlmostEqual(10.0, reset["before"], places=3)
        self.assertEqual(90, reset["after"])
        self.assertEqual(0, reset["hitsInNext85Seconds"])

    def test_a_template_without_damage_from_water_never_drowns(self) -> None:
        self.assertEqual(0, self.results["damageFromWaterOff"]["lost"])


class SwimItemGateTests(unittest.TestCase):
    """The engine does not block the trigger. It leaves him nothing to fire.

    `c_AsmHideWeapon` (0x2) is declared by all five lower swim states, and three
    separate readers test that bit off the LOWER machine's
    `getCurrentStateFlags()` (`0x0832b110`):

    * `BFSoldier::handleMessage` (`0x08277260`) reads it at `0x082772a4` and
      `0x082772ac and eax,0x2` / `0x082772af jne` skips the **whole** dispatch --
      `lea eax,[edi-0x6]` / `cmp eax,0x10` / `jmp DWORD PTR [eax*4+0x86d2748]`,
      a 17-entry jump table over messages 6..22. Fire is 6, AltFire is 7 and
      MenuSelect4 is 13, all three already cited in `map.html`'s demolitions
      block out of this same function.
    * `BFSoldier::selectBestLoadedWeapon` (`0x08273a80`) at `0x08273af4`.
    * `BFSoldier::enableItem(char)` (`0x08278460`) at `0x082784b2`, which is the
      function's own `ret`.

    So "a swimmer cannot fire" is not a rule about the trigger, and modelling it
    as one would leave him reloading and zooming a weapon he does not have.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_every_swim_state_declares_hide_weapon_and_is_swimming(self) -> None:
        flags = self.results["stateFlags"]
        for family in ("swimStart", "swimFloat", "swimForward", "swimBackward",
                       "swimEnd"):
            # 0x2 | 0x8 -- `setFlag c_AsmHideWeapon` then
            # `setFlag c_AsmIsSwimming`, on every one of the five.
            self.assertEqual(0xA, flags[family], family)

    def test_the_gate_is_the_hide_weapon_bit_and_nothing_else(self) -> None:
        gate = self.results["itemsLockedBy"]
        self.assertTrue(gate["hideWeapon"])
        self.assertTrue(gate["both"])
        self.assertFalse(gate["none"])
        # `c_AsmIsSwimming` alone does NOT shut it: the engine's three readers
        # test 0x2, not 0x8. A state could swim with a weapon out; none does.
        self.assertFalse(gate["swimmingOnly"])
        self.assertFalse(gate["climbing"])

    def test_the_gate_follows_the_state_over_a_whole_swim(self) -> None:
        gate = self.results["gateOverOneSwim"]
        # Dry, and wading in 0.2 m of water, he is armed.
        self.assertIsNone(gate["dry"]["family"])
        self.assertFalse(gate["dry"]["locked"])
        self.assertIsNone(gate["wading"]["family"])
        self.assertFalse(gate["wading"]["locked"])
        # The tick he crosses 0.43 m the weapon is gone.
        self.assertEqual("swimStart", gate["entering"]["family"])
        self.assertTrue(gate["entering"]["locked"])
        # `Lb_EndSwim` declares the flag too, so it is still gone through the
        # third of a second the exit clip takes -- the same span over which the
        # drowning clock and the 5.0 gain stay up.
        self.assertEqual("swimEnd", gate["exiting"]["family"])
        self.assertTrue(gate["exiting"]["locked"])
        # And it comes back when the state does, not when the depth does.
        self.assertIsNone(gate["ashore"]["family"])
        self.assertFalse(gate["ashore"]["locked"])
        self.assertEqual(
            ["swimStart", "swimFloat", "swimForward", "swimBackward", "swimEnd"],
            gate["lockedFamilies"])
        self.assertEqual([None], gate["unlockedFamilies"])

    def test_a_corpse_in_the_water_is_not_holding_a_weapon_away(self) -> None:
        # `Lb_DieSwim` is an `AnimationStatesDie.con` state and declares no
        # flags at all, so the gate is not what keeps a dead man from firing.
        self.assertEqual(0, self.results["deathFlags"]["swimDie"])
        self.assertFalse(self.results["deathFlags"]["swimDieLocked"])


class ItemGateWiringTests(unittest.TestCase):
    """Every item verb in `map.html` consults the gate.

    A law in a module that nothing calls is the bug this stream was sent to fix:
    W8-B read `c_AsmHideWeapon` correctly, hid the third-person weapon node with
    it, and left `footFire` firing. `map.html` has no node harness -- it is a
    16,000-line page -- so the wiring is pinned by reading it, which is weak
    evidence about behaviour and exact evidence about presence. The behaviour
    itself is measured headlessly; see `features/viewer-swimming/README.md`.
    """

    MAP = ROOT / "viewer" / "map.html"
    # function name -> why it has to ask
    VERBS = {
        "footFire": "the trigger, the reload clock and the plunger",
        "selectKitWeapon": "MenuSelect<slot>, message 10..17",
        "selectDetonator": "reached only by AltFire or MenuSelect4",
        "altFireDemolitions": "AltFire, message 7",
        "startReload": "a magazine change is an item message too",
        "crosshairAim": "no active item, no setCrossHairType to read",
    }

    @classmethod
    def setUpClass(cls) -> None:
        if not cls.MAP.exists():
            raise unittest.SkipTest("map.html is not in the tree")
        cls.text = cls.MAP.read_text(encoding="utf-8", errors="replace")

    def body_of(self, name: str) -> str:
        """The source of one page function, in `map.html` or in the module the
        page was split into that now holds it (`page_source.py`)."""
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from page_source import function_body
        try:
            return function_body(name)
        except LookupError as err:
            self.fail(str(err))

    def test_the_gate_helper_exists_and_reads_the_soldier(self) -> None:
        gate = self.body_of("itemsLocked")
        self.assertIn("soldier?.itemsLocked", gate)

    def test_every_item_verb_consults_the_gate(self) -> None:
        for name, why in self.VERBS.items():
            with self.subTest(verb=name, why=why):
                self.assertIn("itemsLocked()", self.body_of(name))

    def test_the_first_person_rig_is_not_drawn_without_an_item(self) -> None:
        # There is no 1P swim clip in the game at all: not one of the ten swim
        # states declares a `set1pAnimation` (the five
        # `set1pAnimationSpeed Ub_*Swim*` lines in
        # `animations/1pAnimationsTweaking.con` tune a clip that was never
        # registered). So an unenabled item is simply not drawn.
        fire = self.body_of("footFire")
        self.assertIn("hw.rig.visible = !locked", fire)


if __name__ == "__main__":
    unittest.main()
