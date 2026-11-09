"""The tank school's own page (features/battle-schools, "The tank school's own
page", and tank-matchup.md): the numbers its MATCHUP screen shows, from the
pure modules under it.

`tank_school_harness.mjs` runs `viewer/tank-ballistics.js`, `viewer/tank-arena.js`,
`viewer/tank-armour.js` and `viewer/tank-words.js` in node, over a small catalogue
and a box hull of their own, and reads vanilla's tank sheet, pinned as
`tests/fixtures/tank-school-bf1942.json` (written by `surveys/tank_school_sheet.mjs`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "tank_school_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"tank school harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class TankSchoolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    # --- the shell's flight (FA-23, IMP-7, IMP-8) ------------------------------------

    def test_each_shell_family_falls_as_the_engine_flies_it(self) -> None:
        b = self.out["ballistics"]
        # tank-matchup.md section 3: 6.0 and 26.6 m at 100 and 200 m for the
        # full-gravity guns, under half that for the Panzer IV.
        self.assertEqual(b["sherman"]["drop"], [6.0, 26.6, 62.1, 112.2])
        self.assertEqual(b["panzer"]["drop"], [2.5, 12.3, 29.6, 54.1])
        self.assertEqual(b["chiha"]["drop"], [4.3, 20.0, 47.3, 86.1])
        self.assertEqual(b["sherman"]["elevation"], [3.4, 7.7, 12.2, 17.1])
        self.assertEqual(b["panzer"]["elevation"], [1.4, 3.5, 5.7, 7.9])

    def test_the_rules_of_thumb_and_the_reach(self) -> None:
        b = self.out["ballistics"]
        self.assertEqual((b["sherman"]["per100"], b["chiha"]["per100"], b["panzer"]["per100"]), (4, 3, 2))
        # The Panzer IV out-ranges the full-gravity guns twice over; the
        # Tiger's reach is the Sherman's.
        self.assertTrue(450 <= b["sherman"]["reach"] <= 460, b["sherman"]["reach"])
        self.assertTrue(895 <= b["panzer"]["reach"] <= 910, b["panzer"]["reach"])
        self.assertEqual((b["sherman"]["flight200"], b["chiha"]["flight200"]), (2.0, 2.5))

    def test_the_hull_s_speed_rides_on_the_shell(self) -> None:
        m = self.out["moving"]
        # Broadside at a Sherman's top speed: 29 m off at 200 m, 8.4 degrees
        # back whatever the range; two tanks side by side need no lead.
        self.assertEqual(m["driftAt200"], 29.4)
        self.assertEqual(m["leadAtTopSpeed"], -8.4)
        self.assertEqual(m["sideBySide"], 0)
        self.assertEqual(m["crossingTiger"], 7.4)
        # Driving at the target, the shell flies flatter.
        self.assertEqual(m["dropDrivingAt"], 19.9)
        self.assertIsNone(self.out["outOfReach"])
        # A round that declares no gravity is flown straight: aim at the target.
        self.assertEqual(self.out["straight"], {"flat": True, "e200": 0, "drop200": 0, "reach": None})
        self.assertIn("Your round flies straight; theirs drops about 4 deg per 100 m, so past 200 m you have the easier shot.",
                      self.out["words"]["straightVsSherman"]["guns"])

    # --- the arenas -------------------------------------------------------------------

    def test_a_tank_is_a_gun_on_tracks_not_a_jeep_a_half_track_or_a_flak_gun(self) -> None:
        self.assertEqual(self.out["tanks"], ["Sherman", "Tiger", "PanzerIV", "T34", "Chi-ha", "Captured"])

    def test_one_arena_per_pair_of_tank_sets(self) -> None:
        arenas = {a["map"]: a for a in self.out["arenas"]}
        # And last, every tank of the tree, any two of them, heaviest first.
        self.assertEqual(list(arenas), ["Kursk", "El_Alamein", "Iwo_Jima", "*"])
        self.assertEqual(self.out["every"], {"map": "*", "tanks": ["Tiger", "Captured", "Chi-ha", "PanzerIV", "Sherman", "T34"]})
        # El Alamein and Gazala field the same tanks, so they are one arena;
        # a tank both sides drive is neither's.
        self.assertEqual(arenas["El_Alamein"]["battles"], ["El Alamein", "Gazala"])
        self.assertEqual(arenas["El_Alamein"]["name"], "The West and the desert")
        self.assertEqual((arenas["Kursk"]["allied"], arenas["Kursk"]["axis"]), (["T34"], ["Tiger", "PanzerIV"]))

    def test_yours_and_theirs(self) -> None:
        self.assertEqual(self.out["picks"], {"yoursDefault": "Sherman", "yoursChosen": "Tiger",
                                             "theirsDefault": "Tiger", "theirsForAxis": "Sherman"})
        self.assertEqual(self.out["names"], ["Panzer IV", "T-34-85", "Chi-ha", "King Tiger"])

    def test_the_game_s_ai_data_says_what_a_tank_is(self) -> None:
        # Equipment 0 with a weapon rated against armour: not a machine-gun
        # half-track, not an artillery battery; an oddly named mod tank is.
        # A mod's own row is known by its name: an AmphibiousTank is in, an
        # AmphibiousCar is out; a `T54Gun` is the T-54's gun; a bare Pak is out.
        self.assertEqual(self.out["aiTanks"], ["Sherman", "OddTank", "Kingtiger", "M36", "PT76", "T54"])
        # A gun named with its load after it is still the gun; the HE one is a side gun.
        self.assertEqual(self.out["m36Gun"], "M36GunBarrelAP")
        self.assertEqual(self.out["aiGun"], "OddTankBarrelThing")

    def test_the_main_gun_is_a_real_round_past_an_ammunition_switch(self) -> None:
        # FHSW's ammunition switch fires a stand-in under the main gun's name;
        # the armour-piercing sibling is the gun.
        self.assertEqual(self.out["pick"], {"fakeThenAP": "VGunBarrel_AP", "named": "ShermanGunBarrel", "none": None,
                                            "autocannon": "ShilkaGunBarrel"})

    # --- where a tank is hit (DMG-1, DMG-3, DMG-4) ---------------------------------------

    def test_a_face_is_priced_by_the_damage_table(self) -> None:
        self.assertEqual(self.out["prices"], {"front": 40, "side": 50, "rear": 100, "nothing": 0})
        self.assertEqual(self.out["bands"], ["one", "two", "three", "five", "five", "more", "more", "immune"])
        self.assertEqual(self.out["faceTable"], [[50, 100, 1], [51, 50, 2], [52, 40, 3]])

    def test_shots_to_kill_from_each_bearing(self) -> None:
        r = self.out["rose"]
        self.assertEqual({b: (v["mean"], v["shots"]) for b, v in r.items()},
                         {"0": (40, 3), "45": (41.9, 3), "90": (50, 2), "180": (100, 1)})
        # At 45 degrees each plate is met 45 degrees off square: 0.9 of a
        # square hit (DMG-4), the side's 44.8 the dearest.
        self.assertEqual(r["45"]["max"], 44.8)
        # From 60 degrees above, the roof shows.
        self.assertGreater(self.out["roseAbove"]["mean"], r["0"]["mean"])

    def test_the_aimed_reading_counts_only_what_gets_through(self) -> None:
        a = self.out["aimed"]
        # Head-on the proof plate is all there is: nothing gets through.
        self.assertEqual((a["0"]["hurtShots"], a["0"]["share"]), (None, 0))
        # From 45 degrees the side plate gets through (3 hits at its angle)
        # on two thirds of what shows (it is twice the front's length); the
        # blind average, proof front included, reads 4.
        self.assertEqual((a["45"]["hurtShots"], a["45"]["shots"]), (3, 4))
        self.assertTrue(0.6 < a["45"]["share"] < 0.75, a["45"]["share"])
        self.assertEqual((a["90"]["hurtShots"], a["90"]["share"]), (2, 1))

    # --- the words ---------------------------------------------------------------------------

    def test_sherman_against_tiger_says_get_off_their_front(self) -> None:
        w = self.out["words"]["shermanTiger"]
        self.assertEqual(w["headline"], "Get off their front, and use your faster turret to stay on their side.")
        self.assertIn("Their rear is no softer than their side", " ".join(w["aim"]))
        self.assertIn("Do not trade from the front: you need 10 hits on theirs, they need 3 on yours", " ".join(w["exposed"]))
        self.assertIn("Their turret turns at 20 deg/s against your 35", " ".join(w["guns"]))
        self.assertIn("Their hull pitches 20.1 deg after a hard stop", " ".join(w["hulls"]))

    def test_the_tiger_s_side_of_the_same_pairing(self) -> None:
        w = self.out["words"]["tigerSherman"]
        self.assertEqual(w["headline"], "Make them fight you from the front: the straight trade is yours.")
        self.assertIn("A square hit on their rear plate kills them outright.", w["aim"])
        self.assertIn("Coast to a stop, and re-lay before you fire.", " ".join(w["hulls"]))

    def test_the_panzer_iv_out_ranges_a_sherman(self) -> None:
        w = self.out["words"]["shermanPanzer"]
        self.assertIn("Your shell drops about 4 deg per 100 m, theirs 2", " ".join(w["guns"]))
        self.assertIn("You both reload in about 2.9 s.", w["guns"])

    def test_a_gun_that_cannot_hurt_them_is_called_out(self) -> None:
        w = self.out["words"]
        self.assertEqual(w["cannot"]["headline"], "Your gun cannot hurt them, and theirs can hurt you: do not take this fight.")
        self.assertIn("Your gun cannot hurt them", w["cannot"]["aim"][0])
        self.assertEqual(w["cannotEither"]["headline"], "Neither gun can hurt the other: this is not a fight.")
        # 1,714 hits is no answer; a side that takes nothing says so.
        self.assertEqual(w["noAnswer"]["aim"][0], "Shots of yours to kill them: front more than 30, side 4, rear nothing gets through.")
        self.assertIn("Your gun is no answer to their front: get to a side it can hurt.", w["noAnswer"]["aim"])
        self.assertIn("Only 26% of their front takes damage from your gun: aim at the painted plates, not the grey.", w["thinFront"]["aim"])
        self.assertEqual(w["scratchedBoth"]["headline"], "Neither gun is an answer to the other: this is not a fight.")

    # --- the sheet --------------------------------------------------------------------------

    def test_the_sheet_holds_vanilla_s_tanks(self) -> None:
        # The seven, and the Sexton vanilla's own AI files as a tank.
        self.assertEqual(sorted(self.out["sheet"]), ["Chi-ha", "M10", "PanzerIV", "Sexton", "Sherman", "T34", "T34-85", "Tiger"])

    def test_the_tiger_wobbles_and_the_t34_does_not(self) -> None:
        s = self.out["sheet"]
        # tank-matchup.md section 1: a hard stop pitches a Tiger 20 degrees,
        # it is still after about 7 s and rests 1.5 degrees off; a T-34
        # peaks at 1.5 and is still in 2 s.
        self.assertAlmostEqual(s["Tiger"]["hardStop"]["peak"], 20.1, delta=0.5)
        self.assertAlmostEqual(s["Tiger"]["hardStop"]["still"], 7.1, delta=0.5)
        self.assertAlmostEqual(s["Tiger"]["hardStop"]["left"], -1.5, delta=0.2)
        self.assertLess(s["T34"]["hardStop"]["peak"], 2)
        self.assertLess(s["T34"]["hardStop"]["still"], 2.5)
        # The Sherman's gun shoves its hull hardest (FA-19).
        self.assertEqual(max(s, key=lambda k: s[k]["fireingForce"]), "Sherman")
        self.assertAlmostEqual(s["Sherman"]["fireAcross"]["peak"], 13.4, delta=0.5)

    def test_every_trace_is_there_to_play(self) -> None:
        for name, tank in self.out["sheet"].items():
            self.assertEqual(sorted(tank["traces"]), ["coast", "fireAcross", "fireAhead", "hardStop"], name)
            self.assertEqual(tank["traces"]["fireAcross"]["axis"], "roll", name)
            self.assertTrue(all(t["hz"] == 15 and t["n"] >= 100 for t in tank["traces"].values()), name)


if __name__ == "__main__":
    unittest.main()
