"""A room's guns: the seat guns and the bots' launchers flown on the room
server (`server/room-guns.mjs`).

Retail's server flies every projectile and decides every hit (`FireArms::Fire`
0x0828a090 runs its barrel loop on the server and the client's copy skips it
for a networked round, NET-15; the damage is `GameServer::giveDamage` and
`handleExplosion`, DMG-3, HP-9, HP-10). Until 2026-11-13 a room flew no round:
a seat's trigger did nothing on the server and the shooter's page reported its
own landings. This pins what the room does now:

* a level whose collider casts gets the World's `guns`, and HELLO says so
  (`rounds.seats`); the unit harness's flat mock gets none, as before;
* a human on a gun seat holds the trigger: the server's FireArms fires, the
  round meets a soldier on its way (the stand-in body, the referee's own
  numbers), the death is the authority's with the gunner's slot, the
  crosshair's marks go to the gunner alone (XHIT-4) and the `shot` row, which
  another page lights the gun and draws the round from, to everyone else;
* leaving the seat with the trigger held stops the gun;
* a drivetrain's guns are its driver's: a passenger's seat holds none;
* a round's direct hit on a hull is priced on the server, credited to its
  firer, and marks only a hull with a crew (XHIT-5);
* a bot's launcher round is flown with its blast (`launchBotRound`), where it
  was a resolved ray that met soldiers only;
* the page's own seat round, in such a room, reports and marks nothing
  (`viewer/vehicle-hits.js`); a hand weapon's round is still reported.

The harness is the slow part: it runs once.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "room_guns_harness.mjs"


class RoomGunsTests(unittest.TestCase):
    result: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        needed = ("models/Willy.glb", "maps/wake/scene.glb", "maps/_shared/damage.json")
        for name in needed:
            if not (ROOT / "viewer" / name).exists():
                raise unittest.SkipTest(f"viewer/{name} is not in the tree")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=900, cwd=ROOT)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout[-2000:]}\n{proc.stderr[-4000:]}")
        cls.result = json.loads(proc.stdout)

    def part(self, name: str) -> dict:
        return self.result[name]

    def test_the_stand_in_body_is_the_referees(self) -> None:
        pins = self.part("pins")
        self.assertEqual(pins["radius"], [0.6, 0.6])
        self.assertEqual(pins["height"], [1.0, 1.0])
        self.assertEqual(pins["material"], [41, 41])

    def test_a_shot_row_at_most_six_times_a_second_a_gun(self) -> None:
        self.assertEqual(self.part("pins")["shotRowTicks"], 5)

    def test_the_magazine_rows_pace(self) -> None:
        pins = self.part("pins")
        # Three a second while rounds leave, and every two seconds regardless.
        self.assertEqual((pins["gunRowTicks"], pins["gunHeartbeatTicks"]), (10, 60))
        self.assertEqual(pins["syncLead"], 0.5)

    def test_a_seated_bot_with_a_target_thinks_every_tick(self) -> None:
        self.assertEqual(self.part("pins")["seatAimThinkTicks"], 1)

    def test_hello_says_the_room_flies_its_seat_guns(self) -> None:
        hello = self.part("hello")
        self.assertEqual(hello["casting"], {"seats": True})
        self.assertTrue(hello["worldGuns"])

    def test_a_level_whose_collider_casts_nothing_has_no_guns(self) -> None:
        hello = self.part("hello")
        self.assertIsNone(hello["flat"])
        self.assertFalse(hello["flatGuns"])
        self.assertIsNone(hello["flatRoomGuns"])

    def test_a_held_trigger_fires_the_servers_gun(self) -> None:
        seat = self.part("seat")
        self.assertGreaterEqual(seat["seatIndex"], 1)
        self.assertGreaterEqual(seat["seatShots"], 1)
        # A gun seat with no drive: nothing of a drivetrain's.
        self.assertEqual(seat["drivenGroups"], 0)

    def test_the_servers_round_kills_and_the_kill_is_the_gunners(self) -> None:
        seat = self.part("seat")
        self.assertEqual(seat["hpLost"], seat["hp0"])
        self.assertEqual(seat["killed"], seat["wantKilled"])

    def test_the_marks_go_to_the_gunner_alone(self) -> None:
        seat = self.part("seat")
        self.assertGreaterEqual(seat["gunnerMarks"], 1)
        self.assertEqual(seat["targetMarks"], 0)

    def test_the_shot_row_goes_to_everyone_but_the_firer(self) -> None:
        seat = self.part("seat")
        self.assertGreaterEqual(seat["shotRowsToOthers"], 1)
        self.assertLessEqual(seat["shotRowsToOthers"], seat["shotRowsCap"])
        self.assertEqual(seat["shotRowsToFirer"], 0)
        row = seat["shotRow"]
        self.assertEqual({"slot": row["slot"], "vehicle": row["vehicle"]}, seat["wantShot"])
        self.assertIs(row["seat"], True)
        self.assertEqual(row["gun"], "string")
        self.assertEqual((row["pos"], row["dir"]), (3, 3))
        self.assertAlmostEqual(row["unit"], 1.0, places=2)

    def test_leaving_the_seat_stops_the_gun(self) -> None:
        leave = self.part("leave")
        self.assertTrue(leave["firingBefore"])
        self.assertFalse(leave["firingAfter"])
        self.assertEqual(leave["shotsAfter"], 0)
        self.assertTrue(leave["onFoot"])

    def test_a_passenger_holds_none_of_the_drivetrains_guns(self) -> None:
        mount = self.part("mount")
        self.assertEqual(mount["passengerGroups"], 0)
        self.assertFalse(mount["passengerDrive"])

    def test_a_round_on_a_hull_is_priced_and_credited(self) -> None:
        hull = self.part("hull")
        self.assertEqual(hull["lostEmpty"], 7)
        self.assertEqual(hull["lostCrewed"], 7)
        self.assertEqual(hull["hp"], hull["before"] - 14)
        self.assertEqual(hull["lastHit"], hull["wantLastHit"])

    def test_only_a_crewed_hull_marks_the_crosshair(self) -> None:
        hull = self.part("hull")
        self.assertTrue(hull["seated"])
        self.assertEqual(hull["marksEmpty"], 0)
        self.assertEqual(hull["marksCrewed"], 1)

    def test_a_wrecked_hulls_crew_dies_for_the_firer(self) -> None:
        crew = self.part("crew")
        self.assertTrue(crew["hullDead"])
        self.assertEqual(crew["killed"], crew["want"])

    def test_a_bots_launcher_round_is_flown_with_its_blast(self) -> None:
        rocket = self.part("rocket")
        self.assertTrue(rocket["launched"])
        self.assertEqual(rocket["inFlight"], 1)
        self.assertTrue(rocket["landed"])
        self.assertEqual(rocket["botRounds"], 1)
        # The blast, a metre and a half off: hurt, pushed, and the bot's.
        self.assertGreater(rocket["hpLost"], 0)
        self.assertEqual(rocket["blastRows"], 1)
        self.assertEqual(rocket["lastHit"], rocket["wantLastHit"])

    def test_a_weapon_with_no_flown_round_stays_the_referees_ray(self) -> None:
        self.assertFalse(self.part("rocket")["unknown"])

    # --- the stance capsules (server/soldier-capsules.mjs) ---------------------

    def test_each_stance_has_its_capsules_off_the_rig_and_the_recipe(self) -> None:
        caps = self.part("capsules")
        self.assertEqual(caps["stances"], ["stand", "crouch", "prone"])
        self.assertEqual(caps["headY"], {"stand": 1.7, "crouch": 1.2, "prone": 0.2})
        # Lying, the body runs forward of the feet: +Z in its own frame.
        self.assertEqual(caps["lieHeadForward"], 0.7)
        self.assertEqual(caps["stanceOf"], ["stand", "crouch", "prone"])

    def test_a_tree_without_the_pose_files_has_no_capsules(self) -> None:
        self.assertIsNone(self.part("capsules")["noFiles"])

    def test_a_humans_round_meets_the_head_as_the_head(self) -> None:
        caps = self.part("capsules")
        want = caps["wantTarget"]
        self.assertEqual(caps["asHuman"]["head"], {"target": want, "material": 40, "bone": "Bip01_Head"})
        self.assertEqual(caps["asHuman"]["chest"], {"target": want, "material": 41, "bone": "Bip01_Spine2"})

    def test_a_humans_round_passes_where_the_engine_has_no_capsule(self) -> None:
        self.assertIsNone(self.part("capsules")["asHuman"]["gap"])

    def test_a_bots_round_meets_the_same_body(self) -> None:
        caps = self.part("capsules")
        want = caps["wantTarget"]
        self.assertEqual(caps["asBot"]["head"], {"target": want, "material": 40, "bone": "Bip01_Head"})
        self.assertIsNone(caps["asBot"]["gap"])

    def test_a_server_can_keep_its_bots_on_the_stand_in(self) -> None:
        caps = self.part("capsules")
        kept = caps["asBotStandIn"]
        # Over the sphere's top it misses; in the capsules' gap it lands, as the torso.
        self.assertIsNone(kept["head"])
        self.assertEqual(kept["gap"], {"target": kept["wantTarget"], "material": 41, "bone": None})
        # Its aim keeps the stand-in's points with it, and a human's round the capsules.
        self.assertIsNone(kept["bones"])
        self.assertEqual(caps["humanOnStandInServer"]["material"], 40)

    def test_a_bot_senses_and_aims_at_a_soldiers_bones(self) -> None:
        caps = self.part("capsules")
        # The toy skeleton's four joints, the head's at 1.7 m, in the body's frame.
        self.assertEqual(caps["standingBones"], 4)
        self.assertEqual(caps["headBone"], [0, 1.7, 0])
        # `trunc(u * (count - 1))`: every bone but the array's last.
        self.assertEqual(caps["sensePicks"], ["0,1.7,0", "0.2,1.2,0.1"])

    def test_without_a_skeleton_the_sense_points_are_unchanged(self) -> None:
        self.assertIn(self.part("capsules")["plainPickHeight"], (0.3, 0.8, 1.0, 1.2, 1.55))

    def test_the_capsules_turn_with_the_soldiers_yaw(self) -> None:
        # Lying and facing +X (yaw a quarter turn): the head is 0.7 m that way.
        self.assertEqual(self.part("capsules")["lyingHeadOffset"], [0.7, 0])

    # --- the magazine, to the gunner's page (gun rows, viewer/gun-sync.js) -------

    def test_taking_a_seat_sends_its_magazines(self) -> None:
        sync = self.part("sync")
        self.assertEqual(sync["onEnter"], 1)
        self.assertEqual({"slot": sync["enterRow"]["slot"], "vehicle": sync["enterRow"]["vehicle"]}, sync["wantEnter"])
        self.assertGreaterEqual(sync["enterRow"]["guns"], 1)
        self.assertEqual(sync["enterAmmo"], sync["ammo0"])

    def test_a_firing_gun_sends_its_count_a_few_times_a_second(self) -> None:
        sync = self.part("sync")
        self.assertGreater(sync["spent"], 0)
        self.assertGreaterEqual(sync["rowsWhileFiring"], 3)
        self.assertLessEqual(sync["rowsWhileFiring"], sync["rowsCap"])
        self.assertTrue(sync["falling"])
        self.assertLessEqual(abs(sync["lastRowAmmo"] - sync["serverAmmoNearLast"]), 20)

    def test_the_magazine_goes_to_the_gunner_alone(self) -> None:
        self.assertEqual(self.part("sync")["toOthers"], 0)

    def test_an_idle_seat_is_sent_its_magazine_every_two_seconds(self) -> None:
        self.assertGreaterEqual(self.part("sync")["heartbeat"], 1)

    def test_a_held_triggers_lead_is_left_alone(self) -> None:
        law = self.part("syncLaw")
        self.assertEqual(law["same"]["changed"], [])
        self.assertEqual(law["lead"]["changed"], [])
        self.assertEqual(law["lead"]["ammo"], 27)

    def test_an_idle_gun_takes_the_servers_count(self) -> None:
        law = self.part("syncLaw")
        self.assertEqual(law["idle"]["ammo"], 30)
        self.assertEqual((law["emptied"]["ammo"], law["emptied"]["mags"]), (4, 1))

    def test_the_servers_reload_is_the_pages(self) -> None:
        law = self.part("syncLaw")
        self.assertEqual((law["reloading"]["ammo"], law["reloading"]["mags"], law["reloading"]["reload"]), (0, 2, 2.4))

    def test_a_reload_begun_a_moment_early_is_left_to_run(self) -> None:
        law = self.part("syncLaw")
        self.assertEqual(law["ahead"]["changed"], [])
        self.assertEqual(law["ahead"]["reload"], 3)

    def test_a_reload_the_server_never_made_is_undone(self) -> None:
        law = self.part("syncLaw")
        self.assertEqual((law["wrong"]["ammo"], law["wrong"]["reload"]), (22, 0))

    def test_an_unlimited_gun_is_never_corrected(self) -> None:
        self.assertEqual(self.part("syncLaw")["unlimited"], [])

    def test_a_gun_is_named_by_its_place_among_the_hulls_fire_arms(self) -> None:
        self.assertEqual(self.part("syncLaw")["order"], ["a", "b"])

    def test_the_pages_own_seat_round_reports_nothing(self) -> None:
        page = self.part("page")
        self.assertEqual(page["seatWithServerRounds"], {"reported": 0, "marked": 0})

    def test_the_pages_hand_weapon_round_is_still_reported(self) -> None:
        page = self.part("page")
        self.assertEqual(page["handWithServerRounds"], {"reported": 1, "marked": 1})
        self.assertEqual(page["handBuiltWithServerRounds"], 1)

    def test_a_room_that_flies_no_seat_guns_keeps_the_report(self) -> None:
        self.assertEqual(self.part("page")["seatWithoutServerRounds"], {"reported": 1, "marked": 1})


if __name__ == "__main__":
    unittest.main()
