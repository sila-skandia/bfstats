"""`viewer/net-sidecar.js` under node: the sidecar wire seam.

Same pattern as `test_netcode_client.py` — one node run, many assertions, the
modules copied into a temp dir as `.mjs` so no bundler is needed.

What this pins is the port's contract: the browser game's client surface
(`net-room.js` reads it, `netcode-render.js` draws from it) sourced from the UDP
sidecar's v5 feed instead of a room server. The laws:

* the roster and the local slot come from `createPlayer`, and the local player
  is the sidecar's own, identified by the name its header carries — NOT pid 0,
  because in a real capture the human joins first and the sidecar is pid 1;
* the remote iteration excludes the local slot, as the room client's does;
* a remote's position and facing come from the object it controls (the
  `control` event's netId), and the quaternion becomes degrees for the
  renderer's YXZ pose;
* the stance bits come off the engine's own animation state table (the `anim`
  record) and the `st` rows, so `prone` is true while the state name says lying;
* boarding is `enterVehicle`/`exitVehicle`, and a boarded player's vehicleId is
  the hull;
* the input path is the room protocol's own frame (type 0x02, u32le seq, the
  engine's action bytes), one increasing seq per call and nothing before join;
* `action` sends JSON behind 0x05, `close` sends 0x04, and `join` does not
  un-join a client the sidecar's roster already joined.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "sidecar_client_harness.mjs"

MODULES = {
    "net-sidecar.mjs": VIEWER / "net-sidecar.js",
    "netcode.js": VIEWER / "netcode.js",
    "mouse-input.js": VIEWER / "mouse-input.js",
    "soldier-pose.js": VIEWER / "soldier-pose.js",
}


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
            capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SidecarClientTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls):
        cls.results = run_harness()

    def test_local_slot_is_the_sidecars_own_player(self):
        # pid 1 is the sidecar (the header names it), so its slot is 2.
        self.assertEqual(self.results["slot"], 2)
        self.assertEqual(self.results["helloName"], "sidecar")

    def test_roster_and_own_slot_exclusion(self):
        self.assertEqual(self.results["remoteSlots"], [1, 256])
        self.assertTrue(self.results["selfNotRemote"])
        self.assertIn("skandia", self.results["remoteNames"])
        self.assertEqual(self.results["teamOfMine"], 1)

    def test_hello_carries_the_server_and_level(self):
        self.assertEqual(self.results["helloServer"], "bfstats-lab")
        self.assertEqual(self.results["helloLevel"], "wake")

    def test_hello_carries_the_servers_game_type(self):
        # coop.con is the CoOp game type, the level's SinglePlayer layer; a
        # page on the default Conquest layer had Midway's fleet 1350 m off.
        self.assertEqual(self.results["helloMode"], "CoOp")
        self.assertIs(self.results["helloModeDefault"], False)

    def test_the_local_teams_follows_the_servers_set_team(self):
        # He joins on one side and picks the other in the deploy screen; the
        # server moves him with a SetTeam it echoes back, and hello.team -- read
        # for his own row by the score board, the kill lines and the ticket HUD
        # -- must follow his roster row, not stay frozen at the join (owner's
        # live session, 2026-10-18: a German on El Alamein shown Allied).
        self.assertEqual(self.results["teamFollow"], {"before": 2, "after": 1})

    def test_the_sidecars_server_state_reaches_the_page(self):
        # A sidecar that is not on the server says so, and the page gets it as
        # a `serverState` row (net-room.js shows the SERVER modal on
        # `unreachable` and `denied`); it is never mistaken for a join.
        got = self.results["serverState"]
        self.assertEqual([r["state"] for r in got["rows"]], ["connecting", "unreachable"])
        self.assertEqual(got["rows"][1]["server"], "127.0.0.1:14568")
        self.assertEqual(got["rows"][1]["waitedS"], 10)
        self.assertNotEqual(got["joined"], "joined")

    def test_remote_position_and_facing_from_the_controlled_object(self):
        # The bot boarded hull 544 before these were read: a player in a hull
        # is drawn where the hull is (his soldier is not sent while he rides).
        self.assertAlmostEqual(self.results["pureX"], 1017.4, places=2)
        # Engine heading 180 walks engine -z, which is the page's +z: a body
        # yaw of 0 (the page walks along (sin yaw, 0, cos yaw)).
        self.assertAlmostEqual(self.results["pureYaw"], 0.0, places=3)
        self.assertAlmostEqual(self.results["purePitch"], 0.0, places=6)

    def test_engine_frame_becomes_the_page_frame(self):
        # z is negated and the yaw mirrored, as the replay draws
        # (replay-kinematics.js toViewPosition / toViewQuaternion).
        self.assertAlmostEqual(self.results["pureZ"], -857.2, places=2)
        self.assertAlmostEqual(self.results["frameZ"], -20.0, places=6)
        # Engine heading +30 walks (sin30, cos30) in the engine, (sin30,
        # -cos30) in the page, which the page's body yaw 150 walks.
        self.assertAlmostEqual(self.results["frameYaw"], 150.0, places=4)

    def test_tickets_and_flags_reach_the_page(self):
        self.assertEqual(self.results["ticketRows"], [[1, 12], [2, 48]])
        # The first report sets the flag quietly; a change is a capture.
        self.assertEqual(self.results["captureRows"], [["The_Beach", 2, True], ["The_Beach", 1, False]])

    def test_turret_parts_reach_the_replica(self):
        # A j row's quaternion is BF1942's; the page's is (-x, -y, z, w).
        self.assertEqual(self.results["joints"], [{"name": "ShermanTower", "q": [0, -0.5, 0, 0.866]}])

    def test_a_seat_rides_its_hull(self):
        self.assertEqual(self.results["seatVehicle"], 674)
        self.assertEqual(self.results["seatIndex"], 1)

    def test_ack_and_scope_out(self):
        self.assertEqual(self.results["ackBefore"], 0)
        self.assertEqual(self.results["ackAfter"], 41)
        self.assertFalse(self.results["aliveAfterScopeOut"])

    def test_a_driven_hulls_ack_carries_its_state_in_the_pages_frame(self):
        # sidecar.mjs: the control-object state's root position, rotation and
        # velocity at the acked tick, which the page's hull correction takes
        # whole (netcode-reconcile.js createHullReconciler).
        h = self.results["selfHull"]
        self.assertEqual(h["id"], 550)
        self.assertEqual(h["ack"], 50)
        self.assertEqual([h["x"], h["y"], h["z"]], [10, 20, -30])
        self.assertEqual(h["q"], [-0.1, -0.2, 0.3, 0.927])
        self.assertEqual(h["v"], [1, 2, -3])

    def test_join_names_a_side_and_does_not_spawn(self):
        row = self.results["joinRow"]
        self.assertEqual(row["type"], "join")
        self.assertEqual(row["team"], 2)
        self.assertNotIn("spawnGroup", row)

    def test_stance_from_the_animation_state_table(self):
        # lower 2 is Lb_Lie in the harness's table.
        self.assertTrue(self.results["pureProne"])

    def test_boarding_sets_the_vehicle(self):
        self.assertTrue(self.results["pureInVehicle"])
        self.assertEqual(self.results["pureVehicleId"], 544)

    def test_vehicles_come_from_the_object_records(self):
        self.assertEqual(self.results["vehicleTemplates"], ["M3A1", "USMarineSoldier"])
        # A vehicle pose is what the renderer reads: id, position, a unit
        # quaternion and an occupied flag.
        v = self.results["remoteVehicle544"]
        self.assertEqual(v["id"], 544)
        self.assertEqual(v["occupied"], True)
        self.assertEqual(len(v["q"]), 4)
        self.assertAlmostEqual(v["qNorm"], 1.0, places=6)
        self.assertAlmostEqual(v["x"], 1017.4, places=1)

    def test_a_projectile_pool_names_the_servers_rounds(self):
        # The pool is one event with the template and the run of netIds, so
        # the page can load the round's mesh before the first one is thrown.
        pool = self.results["pool"]
        self.assertEqual(len(pool["row"]), 1)
        self.assertEqual(pool["row"][0]["tmpl"], "GrenadeAlliesProjectile")
        self.assertEqual(pool["row"][0]["count"], 3)
        # Both rounds the server has placed, named by the pool even though
        # the wire's own object record carries no template; the thrown one
        # away from the origin, in the page's frame (z negated).
        rows = {r["id"]: r for r in pool["rows"]}
        self.assertEqual(sorted(rows), [579, 580])
        self.assertEqual(rows[580]["tmpl"], "GrenadeAlliesProjectile")
        self.assertAlmostEqual(rows[580]["z"], -857.1, places=1)
        self.assertAlmostEqual(rows[579]["x"], 0.0, places=6)
        # A round is never offered as a vehicle: it would be bound to a
        # parked level node by its template and drawn as a hull.
        self.assertEqual(pool["vehicles"], [])
        # The pool goes with the kit that carried it.
        self.assertEqual(pool["gone"], [579])

    def test_a_vehicles_round_carries_its_gun_and_muzzle(self):
        rows = self.results["vehicleShot"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["vehicle"], 544)
        self.assertEqual(rows[0]["seat"], True)
        self.assertEqual(rows[0]["gun"], "ShermanGunBarrel")
        self.assertEqual(rows[0]["pos"], [10, 2, 30])
        self.assertEqual(rows[0]["dir"], [0, 0, 1])

    def test_snapshots_count_transform_batches(self):
        self.assertEqual(self.results["snapCount"], 2)
        self.assertEqual(self.results["pureTick"], 2)

    def test_event_rows_reach_the_page(self):
        for want in ("killed", "chat", "seat", "join"):
            self.assertIn(want, self.results["feedTypes"])

    def test_own_player_by_id_not_name(self):
        self.assertEqual(self.results["slotById"], 2)   # pid 1

    def test_a_death_is_the_victims_row(self):
        # pid 255 (slot 256) killed pid 0 (slot 1): the victim dies on the page,
        # not the killer (a kill row read as the victim's left a player shot
        # dead on the server crawling on the page).
        self.assertEqual(self.results["killedRows"], [{"slot": 1, "other": 256, "weapon": 5}])

    def test_every_object_lerps_between_its_samples(self):
        # page frame: z negated
        self.assertEqual([round(v, 6) for v in self.results["lerpMid"]], [0.5, -1.0])
        self.assertEqual(self.results["lerpNewest"], [1, -2])
        # Past the newest: the retail extrapolation, the last pair's velocity
        # times the elapsed time, for up to 1.2 s, then held
        # (SimpleObjectNetworkable::predict 0x08237a90: elapsed/gap times the
        # pair's displacement; extrapolationTime is only the cap). At t=11
        # (0.9 s past, v = (10, -20) m/s): (1, -2) + (10, -20) x 0.9.
        self.assertEqual([round(v, 6) for v in self.results["lerpHolds"]], [10.0, -20.0])

    def test_soldier_stands_on_his_feet(self):
        # The wire's 105.6 is the soldier's origin, a metre over his feet (PHY-10).
        self.assertAlmostEqual(self.results["soldierFeetY"], 104.6, places=6)

    def test_quaternion_law(self):
        self.assertAlmostEqual(self.results["yawOfYaw180"], 180.0, places=3)
        self.assertAlmostEqual(self.results["yawOfIdentity"], 0.0, places=6)
        self.assertAlmostEqual(self.results["pitchOfIdentity"], 0.0, places=6)

    def test_input_needs_a_join_and_then_counts_up(self):
        self.assertEqual(self.results["inputBeforeJoin"], 0)
        self.assertEqual(self.results["inputSeqs"], [1, 2])
        self.assertEqual(self.results["inputFrames"], 2)
        self.assertEqual(self.results["inputType"], 2)
        self.assertTrue(self.results["inputRoundTrip"])
        self.assertEqual(self.results["inputBytes"], self.results["inputBytesExpected"])

    def test_action_frame_is_json_behind_its_type_byte(self):
        self.assertEqual(self.results["actionType"], 5)
        self.assertEqual(self.results["actionRow"]["type"], "radio")
        self.assertEqual(self.results["actionRow"]["msg"], 12)
        self.assertTrue(self.results["actionRow"]["team"])

    def test_chat_rows_and_the_chat_action(self):
        rows = self.results["chatRows"]
        self.assertEqual(rows[0], {"type": "chat", "slot": 2, "text": "team: ok?", "team": True, "server": False})
        self.assertEqual(rows[1], {"type": "chat", "slot": None, "text": "server says", "team": False, "server": True})
        self.assertEqual(self.results["chatAction"], {"type": "chat", "text": "hello all", "team": False})

    def test_a_passenger_seat_object_is_a_seat_of_its_hull(self):
        r = self.results["passengerSeat"]
        self.assertEqual(r, {"vehicleId": 698, "seatIndex": 2, "inVehicle": True})

    def test_hit_from_pos_is_the_huds_octant_and_alpha(self):
        rows = self.results["hitRows"]
        self.assertEqual([r["dir"] for r in rows], [5, 1])
        self.assertAlmostEqual(rows[0]["alpha"], 76 / 255, places=6)
        self.assertAlmostEqual(rows[1]["alpha"], 0.749019622802734, places=6)

    def test_hit_mark_is_a_row_once_live(self):
        self.assertEqual(self.results["hitMarksBeforeLive"], 0)
        self.assertEqual(self.results["hitMarkRows"], [{"type": "hitMark"}, {"type": "hitMark"}])

    def test_join_does_not_unjoin(self):
        self.assertEqual(self.results["stateWasJoined"], "joined")
        self.assertEqual(self.results["stateAfterJoin"], "joined")

    def test_close_leaves_the_server(self):
        self.assertTrue(self.results["leaveSent"])
        self.assertTrue(self.results["socketClosed"])
        self.assertEqual(self.results["closedState"], "closed")

    def test_remote_row_carries_the_kit(self):
        # The kit the player picked up (PickupKitEvent) dresses him on the page.
        self.assertEqual(self.results["kitRow"], "UsMarine_Assault")

    def test_level_load_replayed_at_connect_is_history(self):
        lc = self.results["lifecycle"]
        self.assertEqual(lc["replayRows"], 0)
        self.assertEqual(lc["afterReplayObjects"], 0)

    def test_level_load_once_live_restarts_and_tells_the_page(self):
        lc = self.results["lifecycle"]
        self.assertEqual(lc["objectsAfterLive"], 0)
        self.assertEqual(lc["rosterAfterLive"], 0)
        self.assertEqual([(r["level"], r["same"]) for r in lc["live1"]], [("wake", True)])
        self.assertEqual([(r["level"], r["same"]) for r in lc["live2"]], [("midway", False)])
        # A round ending and going back to pre-game is the same map restarted.
        self.assertEqual([(r["level"], r["same"]) for r in lc["live3"]], [("midway", True)])

    def test_samples_are_timed_by_the_server_tick(self):
        # 20 blocks a second over 30 ticks, arriving evenly: a 6 m/s walker
        # timed by arrival is drawn at half and double speed in turn (the
        # owner's stutter, 2026-10-16); timed by the tick, at one speed.
        tick, arrival = self.results["tickTiming"], self.results["arrivalTiming"]
        self.assertGreater(tick["frames"], 100)
        self.assertGreater(tick["min"], 5.5)
        self.assertLess(tick["max"], 7.0)
        self.assertLess(arrival["min"], 4.0)
        self.assertGreater(arrival["max"], 9.0)

    def test_a_standing_soldiers_view_is_his_body_turned_by_the_twist(self):
        # handleUpdate rotateYDeg(-3 x twist); the page frame flips the sign.
        v = self.results["viewYaw"]
        self.assertEqual(abs(v["stillView"]), 180)
        self.assertEqual(v["twistedYaw"], 180)
        self.assertEqual(v["twistedView"], 138)

    def test_the_servers_round_end_is_one_round_end_row(self):
        # Status 2, then the ScoreManager's winner / victory type / rounds won
        # and the medal a player's counter rose by, a settle window later.
        r = self.results["roundEnd"]
        self.assertEqual(r["before"], 0)
        self.assertEqual(r["rows"], 1)
        self.assertEqual(r["afterRestart"], 1)
        row = r["row"]
        self.assertEqual(row["winner"], 2)
        self.assertEqual(row["victoryType"], 3)
        self.assertEqual(row["roundsWon"], {"1": 0, "2": 3})
        self.assertEqual([(m["slot"], m["medal"], m["score"]) for m in row["medals"]], [(1, "gold", 14)])

    def test_the_client_hands_the_board_the_servers_stats(self):
        r = self.results["clientStats"]
        self.assertEqual((10, 2, 1, 4, 0), tuple(r["bot"][k] for k in ("score", "kills", "deaths", "attacks", "ping")))
        self.assertEqual((0, 0, 0), tuple(r["self"][k] for k in ("score", "kills", "deaths")))
        self.assertIsNone(r["off"])

    def test_an_alternate_fire_state_is_a_stab_once_a_press(self):
        # Into the knife's hub, out to its swing (no row), back into the hub,
        # and a bayonet's lying thrust held over two rows: three stabs, each
        # naming the item the state row says he holds. The fire state between
        # is a shot and no stab.
        rows = self.results["stabRows"]
        self.assertEqual(len(rows), 3)
        self.assertEqual({r["slot"] for r in rows}, {8})
        self.assertEqual({r["item"] for r in rows}, {3})
        self.assertEqual(self.results["stabShots"], 1)


if __name__ == "__main__":
    unittest.main()
