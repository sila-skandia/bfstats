"""A room's remote hulls on the page: one hull, its crew in their own seats.

Wake, 2026-11-13: two pages at The_Airfield, one player walks to the pad's
Willy and presses E. On the other page the jeep was drawn with nobody in it,
the driver's body on foot was gone, and after the jeep drove off the pad's own
`Willy_1` still stood by the hut. Three causes, each pinned here:

* **The seat index.** The replica is the template's glb under a wrapper group,
  and `netcode-render.js` surveyed the wrapper: seat 0 was the wrapper (no
  SeatObject, so no body), and every other index named the seat before it.
  The server surveys the glb's own root (`server/glb-tree.mjs`), and the
  snapshot's `seatIndex` is its order. `room_remote_hull_harness.mjs` drives
  the renderer with a driver, a passenger, a tank's hull gunner, a pilot and a
  rear gunner.
* **The pad's copy.** The page hid its own copy by `node.visible`, which the
  pads' visibility pass writes every frame (`level-statics.js`). A hull a
  remote sits in is now off the page's field for as long as its replica is
  drawn, by the one law both sides use (`heldHullIds`), in the page's own room
  as against a real server.
* **The driver's own hull.** In the page's own room nothing corrected the hull
  a player drives against the server's: `correctDrivenHull` ran against a real
  server only. A 12 s steered drive ended 20 m from where the room had the
  jeep. The room client now names the driven hull at the acked word
  (`netcode-client.js` `selfHull`, pinned in `test_netcode_client.py`) and the
  correction runs on it; the server side of that contract (the snapshot's hull
  row and the ack come from one tick) is `test_room.py`'s crew scenario.
"""

from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent / "viewer"
HARNESS = HERE / "room_remote_hull_harness.mjs"


def _closure(*entries: str) -> set[str]:
    seen: set[str] = set()
    queue = list(entries)
    while queue:
        name = queue.pop()
        if name in seen or not (VIEWER / name).exists():
            continue
        seen.add(name)
        here = posixpath.dirname(name)
        for spec in re.findall(r"from '(\.\.?/[^']+\.js)'", (VIEWER / name).read_text()):
            queue.append(posixpath.normpath(posixpath.join(here, spec)))
    return seen


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("netcode-render.js", "seat-survey.js", "carried-wheels.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "node_modules" / "three").mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js",
                        work / "node_modules" / "three" / "three.module.js")
        (work / "node_modules" / "three" / "package.json").write_text(json.dumps({
            "name": "three", "version": "0.0.0", "type": "module",
            "main": "three.module.js", "exports": "./three.module.js"}))
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class RemoteHullTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_survey_starts_at_the_templates_own_root(self) -> None:
        root = self.out["root"]
        self.assertEqual(root["name"], "Willy")
        self.assertEqual(root["kind"], "PlayerControlObject")
        self.assertEqual(root["order"], ["Willy", "WillyPassengerPCO"])
        # The wrapper's own survey is the defect: a seat in front of seat 0.
        self.assertEqual(len(root["wrapperOrder"]), 3)
        self.assertEqual(root["wrapperOrder"][1:], ["Willy", "WillyPassengerPCO"])
        # A glb with no stamped node is surveyed from the wrapper, as before.
        self.assertTrue(root["unstamped"])

    def test_a_remote_driver_is_in_the_drivers_seat(self) -> None:
        seat = self.out["seats"]["willyDriver"]
        self.assertEqual(seat["seats"], ["Willy", "WillyPassengerPCO"])
        self.assertEqual(seat["seat"], "Willy")
        # The driver's seat has its SeatObject, so a body is drawn in it.
        self.assertEqual(seat["seatObjects"], [1, 1])
        self.assertEqual(seat["replicas"], [2])

    def test_a_remote_passenger_is_in_the_passengers_seat(self) -> None:
        self.assertEqual(self.out["seats"]["willyPassenger"]["seat"], "WillyPassengerPCO")

    def test_a_tanks_gunner_is_on_the_gun_and_its_driver_draws_nobody(self) -> None:
        driver = self.out["seats"]["shermanDriver"]
        gunner = self.out["seats"]["shermanGunner"]
        self.assertEqual(driver["seats"], ["Sherman", "shermanBrowning_PCO1"])
        self.assertEqual(driver["seat"], "Sherman")
        # An enclosed driver: no SeatObject, no body (`seat-ik.js` `seatBody`).
        self.assertEqual(driver["seatObjects"], [0, 1])
        self.assertEqual(gunner["seat"], "shermanBrowning_PCO1")

    def test_a_pilot_and_a_rear_gunner_are_each_in_their_own_seat(self) -> None:
        self.assertEqual(self.out["seats"]["sbdPilot"]["seat"], "SBD")
        self.assertEqual(self.out["seats"]["sbdGunner"]["seat"], "SBD_PCO1")
        self.assertEqual(self.out["seats"]["sbdGunner"]["replicas"], [14])

    def test_an_index_past_the_last_seat_names_none(self) -> None:
        self.assertIsNone(self.out["seats"]["pastTheLast"]["seat"])

    def test_a_crew_shares_one_replica(self) -> None:
        crew = self.out["crew"]
        self.assertEqual(crew["seats"], {"3": "Willy", "4": "WillyPassengerPCO",
                                         "5": "shermanBrowning_PCO1", "6": None})
        self.assertEqual(crew["replicas"], [2, 15])
        # The hulls stood down on the page are exactly the hulls drawn as replicas.
        self.assertEqual(crew["held"], crew["replicas"])

    def test_the_pages_own_hull_is_never_a_replica(self) -> None:
        own = self.out["own"]
        self.assertEqual(own["replicas"], [15])
        self.assertEqual(own["held"], [15])

    def test_a_replica_offers_its_own_doors(self) -> None:
        # What a second player takes a seat of: the template's own root, one
        # door a seat, found by its room id; asked for when its glb lands.
        doors = self.out["doors"]
        self.assertEqual(doors["root"], "Willy")
        self.assertEqual(doors["id"], 2)
        self.assertEqual(doors["seats"], [1, 1])
        self.assertIsNone(doors["none"])
        self.assertIn(2, doors["ready"])

    def test_a_friend_is_drawn_in_the_pages_own_hull(self) -> None:
        # Aboard a hull with another player: no replica of it, and the other
        # player in the seat of the page's copy that his row names.
        shared = self.out["shared"]
        self.assertEqual(shared["replicas"], [15])
        self.assertEqual(shared["driver"], "Willy")
        self.assertEqual(shared["passenger"], "WillyPassengerPCO")

    def test_a_carried_hull_rolls_its_wheels_by_the_ground_it_covers(self) -> None:
        # The drive's own law (`tracked-vehicle.js`: angle += along / radius
        # * dt), off the motion the hull was drawn through: 2 m on 0.4 m
        # wheels is 5 rad. A Spring with no mesh is no wheel; a hull standing
        # still turns nothing; a hull put somewhere else did not roll there.
        wheels = self.out["wheels"]
        self.assertEqual(wheels["count"], 4)
        for radius in wheels["radius"]:
            self.assertAlmostEqual(radius, 0.4, places=5)
        self.assertAlmostEqual(wheels["forward"], 20.0, places=3)
        for angle in wheels["rolled"] + wheels["still"] + wheels["afterJump"]:
            self.assertAlmostEqual(angle, 5.0, places=3)
        # 5 rad about the wheel's own axis, read back off its node.
        for angle in wheels["turned"]:
            self.assertAlmostEqual(angle, 2 * 3.141592653589793 - 5.0, places=3)
        self.assertEqual(wheels["jump"], 0)

    def test_a_friends_ship_is_the_pages_own_copy(self) -> None:
        ship = self.out["ship"]
        self.assertEqual(ship["replicas"], [15])
        self.assertEqual(ship["gunner"], "SBD_PCO1")

    def test_the_copy_stands_down_once_and_comes_back_once(self) -> None:
        left = self.out["left"]
        self.assertEqual(left["replicas"], [])
        self.assertEqual(left["held"], [])
        self.assertEqual(left["occupy"], [[2, True], [2, False]])

    def test_the_held_law_reads_the_rows_alone(self) -> None:
        # Hull 9 once for its two crew; a man on foot's stale id, a row with
        # hull 0 and the page's own hull 11 are not held.
        self.assertEqual(self.out["heldLaw"], [9])


class RoomClientWiringTests(unittest.TestCase):
    """`net-room.js` runs only in a page. What it must keep saying, read off
    its source: the held hulls stand down in the page's own room too, and the
    driven hull is corrected there."""

    source: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (VIEWER / "net-room.js").read_text()

    def test_held_hulls_stand_down_in_the_pages_own_room(self) -> None:
        self.assertIn("const crewed = relayUrl ? null : remoteCrewedHulls();", self.source)
        self.assertRegex(self.source, r"return heldHullIds\(client\.remoteSlots\(\)\.map\(")
        # The stand-down is the pads' own live set, never a bare `visible`.
        held = self.source[self.source.index("if (remoteHeld.has(id)) {"):][:200]
        self.assertIn("setRemoteLive?.(hull.node, false)", held)

    def test_the_driven_hull_is_corrected_in_the_pages_own_room(self) -> None:
        self.assertIn("else if (!relayUrl && page.occupancy) correctDrivenHull();", self.source)
        # A seated player's snapshot is not a fresh seat.
        self.assertIn("else if (!page.occupancy) room.netHullRoot = null;", self.source)
        self.assertNotRegex(self.source, r"\n\s*else room\.netHullRoot = null;")

    def test_a_second_player_boards_through_the_replicas_doors(self) -> None:
        entry = (VIEWER / "vehicle-entry.js").read_text()
        # The doors of held hulls, a held seat kept off the offer, and the
        # copy claimed on the press.
        self.assertIn("for (const { id, root } of page.heldHullRoots?.() ?? []) {", entry)
        self.assertIn("if (page.roomSeatHeld?.(entry.vehicle, entry.seatId)) return false;", entry)
        self.assertIn("entry = page.claimHeldHull?.(entry) ?? null;", entry)
        # A ship is kept, never stood down or carried.
        self.assertIn("if (remote && crewed && isShip(id)) { shipsHeld.add(id); remote = false; }", self.source)
        self.assertIn("pageDrawsHull: id => shipsHeld.has(id),", self.source)
        for name in ("room.heldHullRoots = ", "room.roomSeatHeld = ", "room.claimHeldHull = ",
                     "carryRiddenHull();", "onReplicaReady: "):
            self.assertIn(name, self.source)
        # A switch onto a seat another player holds is refused on the page too.
        self.assertIn("if (page.roomSeatHeld?.(seat.root, seatId)) return;",
                      (VIEWER / "local-player.js").read_text())
        page = (VIEWER / "map.html").read_text()
        for name in ("claimHeldHull", "heldHullRoots", "roomSeatHeld", "carryParkedHull", "ownerIsShip"):
            self.assertRegex(page, r"from\(\(\) => (room|hullBodies), `[^`]*\b" + name + r"\b")

    def test_a_hull_the_room_holds_off_the_field_is_flagged_absent(self) -> None:
        statics = (VIEWER / "level-statics.js").read_text()
        body = statics[statics.index("function setRemoteLive(node, live) {"):][:700]
        self.assertIn("markAbsent(record);", body)


if __name__ == "__main__":
    unittest.main()
