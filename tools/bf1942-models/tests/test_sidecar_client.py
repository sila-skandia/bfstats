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

    def test_a_seat_rides_its_hull(self):
        self.assertEqual(self.results["seatVehicle"], 674)
        self.assertEqual(self.results["seatIndex"], 1)

    def test_ack_and_scope_out(self):
        self.assertEqual(self.results["ackBefore"], 0)
        self.assertEqual(self.results["ackAfter"], 41)
        self.assertFalse(self.results["aliveAfterScopeOut"])

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

    def test_snapshots_count_transform_batches(self):
        self.assertEqual(self.results["snapCount"], 2)
        self.assertEqual(self.results["pureTick"], 2)

    def test_event_rows_reach_the_page(self):
        for want in ("killed", "chat", "seat", "join"):
            self.assertIn(want, self.results["feedTypes"])

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

    def test_join_does_not_unjoin(self):
        self.assertEqual(self.results["stateWasJoined"], "joined")
        self.assertEqual(self.results["stateAfterJoin"], "joined")

    def test_close_leaves_the_server(self):
        self.assertTrue(self.results["leaveSent"])
        self.assertTrue(self.results["socketClosed"])
        self.assertEqual(self.results["closedState"], "closed")


if __name__ == "__main__":
    unittest.main()
