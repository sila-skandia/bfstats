"""The P2 room server under node: one node run, many assertions.

Same pattern as `test_world.py` — the harness is the slow part, so it runs
once and the assertions feed off its JSON blob. The room core is driven
in-process with virtual peers on a manual clock (no ports, no races); the
real socket junction is `room_socket_test.py`'s job.

What this file pins is the P2 contract of
`features/netcode-play-multiplayer/README.md`:

* the join handshake — HELLO's slot/room/level/mode/team/name/slots/
  maxPlayers/flags/vehicles/tickets, create-by-code, tie -> team 1;
* the 30 Hz engine loop — two players on one clock, input isolation, the
  walk law on the wire;
* the receive law THROUGH the room's feed — trim <= 4 drop-oldest, exactly
  one consume per tick, seq dedupe, idle zero, backlog collapse, all of it
  the World's own logic fed verbatim;
* late join's MSG_JOIN_SNAPSHOT — live players, live poses;
* explicit MSG_LEAVE + the silent-10 s drop sweep (J-3);
* MSG_ACTION seat enter/exit — the hull pose on the wire, seatEnter/seatExit
  rows, the exit-point placement;
* fire throttling at ~0.35 s per player;
* the byte budget at 16 players (a few hundred bytes);
* the real wake level headless — heightfield lattice + materials + static
  index + a drivable table and a mount round-trip;
* the glb-tree contract — a template's JSON chunk yields the seat hierarchy
  with no geometry decoded;
* P4's snap-back fix — a deploy row's `spawnIndex` pins the authority to the
  page's own spawn point, the snapshot carries the monotonic input `ack`, and
  the facing on the wire is degrees (`SNAPBACK.md`).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
SERVER = ROOT / "server"
HARNESS = Path(__file__).resolve().parent / "room_harness.mjs"

# The viewer modules the server graph imports (the world set, the collider,
# the drive models, the netcode codec), kept under their own names so the
# unmodified `../viewer/...` imports resolve from `server/`.
_VIEWER_MODULES = [
    "world", "physics", "parachute", "swim", "soldier", "spawn-flags", "spawn-safety",
    "point-body", "fixed-step", "soldier-pose", "soldier-locomotion", "walking-body", "soldier-resolve",
    "mouse-input", "fall-damage",
    "body-world", "body-statics", "vehicle-bodies", "combat-area", "supply", "armor",
    "vehicle-damage", "seats", "seat-dots", "rigid-body", "body-contact",
    "body-ground", "body-friction", "crash-damage", "effects-core", "projectile-damage",
    "collision", "collision-materials", "heightfield", "static-index",
    "drivable-mask", "world-collider", "flight", "vehicle-camera", "vehicle-discovery", "vehicle-base",
    "aircraft", "ground", "ground-specs", "ground-contact", "ground-engine",
    "tracked-vehicle", "game-modes", "netcode",
    # Reached through seats.js: the salvo arithmetic and the HUD weapon-slot
    # order, and an aircraft torpedo's water run.
    "bomb-release", "torpedo-run",
]
MODULES = {f"viewer/{name}.js": VIEWER / f"{name}.js" for name in _VIEWER_MODULES}
MODULES.update({
    # flight.js imports the loader and the loader its utils; both are pure JS.
    "viewer/vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "viewer/vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
    # The server feature's own files, in their own dir, so their relative
    # imports (`./glb-tree.mjs`, `../viewer/world.js`) resolve unmodified.
    "server/glb-tree.mjs": SERVER / "glb-tree.mjs",
    "server/level.mjs": SERVER / "level.mjs",
    "server/rooms.mjs": SERVER / "rooms.mjs",
    "server/authority.mjs": SERVER / "authority.mjs",
    # The real published templates the fake level's table is built from.
    "viewer/models/Willy.glb": VIEWER / "models" / "Willy.glb",
    "viewer/models/Zero.glb": VIEWER / "models" / "Zero.glb",
    # The bare specifier `three` is an import map entry in the page; node
    # needs a package, so the vendored file is published as one.
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
})
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
    env = dict(os.environ)
    env["REAL_VIEWER"] = str(VIEWER)
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
            ["node", str(work / "harness.mjs")], capture_output=True, text=True,
            timeout=900, env=env)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class RoomTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- (a) the join handshake ----------------------------------------------

    def test_hello_carries_the_handshake_fields(self) -> None:
        a = self.results["a"]
        self.assertTrue(a["helloOk"], a.get("hello"))
        self.assertEqual(a["joinSnapOk"], True)
        self.assertIsNotNone(a["lobby"])
        self.assertEqual(a["lobby"]["level"], "test")
        self.assertEqual(a["lobby"]["players"], 1)

    # --- (b) one 30 Hz clock, input isolation ---------------------------------

    def test_two_players_step_on_one_clock(self) -> None:
        b = self.results["b"]
        self.assertGreaterEqual(b["ticksRun"], 28)
        # The walk law survives the room: ~1 s of forward walk, short of the
        # 6 m/s table by the ramp (PHY-6), and the neighbour never moves.
        self.assertGreater(b["p1Travelled"], 3.5)
        self.assertLessEqual(b["p1Travelled"], 6.5)
        self.assertAlmostEqual(b["p2Still"], 0.0, places=6)

    def test_the_wire_shows_the_walker(self) -> None:
        b = self.results["b"]
        self.assertGreaterEqual(b["snapshots"], 14)
        self.assertGreater(b["p1WireTravelled"], 3.0)

    # --- (c) the receive law, through the room's own feed ---------------------

    def test_trim_four_drops_the_oldest(self) -> None:
        after = self.results["c"]["afterOne"]
        self.assertTrue(self.results["c"]["capOk"], after)

    def test_seq_dedupe_and_one_consume_per_tick(self) -> None:
        c = self.results["c"]
        self.assertTrue(c["dedupeOk"], c.get("afterOne"))
        self.assertEqual(c["consumedAfterDedupe"], 5)

    def test_empty_buffer_delivers_the_idle_word(self) -> None:
        self.assertTrue(self.results["c"]["idleOk"])

    def test_backlog_collapse_bounds_the_room_accumulator(self) -> None:
        c = self.results["c"]["collapse"]
        self.assertTrue(c["bounded"], c)
        self.assertGreaterEqual(c["ran"], 1)

    # --- (d) late join ----------------------------------------------------------

    def test_late_join_snapshot_carries_live_state(self) -> None:
        d = self.results["d"]
        self.assertTrue(d["joinOk"])
        self.assertEqual(d["livePlayers"], 3)
        self.assertTrue(d["walkerAlive"])
        self.assertGreater(d["walkerTravelled"], 3.0)
        self.assertEqual(d["bothTeams"], 2)

    # --- (e) leave and drop ------------------------------------------------------

    def test_explicit_leave_frees_the_slot(self) -> None:
        e = self.results["e"]
        self.assertTrue(e["leaveOk"])
        self.assertTrue(e["slotFreed"])
        self.assertTrue(e["reuseOk"], e)

    def test_silent_drop_sweep(self) -> None:
        e = self.results["e"]
        self.assertTrue(e["sweepDropped"])
        self.assertEqual(e["sweepRow"], 1)

    # --- (f) seat enter/exit -------------------------------------------------------

    def test_seat_enter_reaches_the_hull_pose(self) -> None:
        f = self.results["f"]
        self.assertTrue(f["snapOk"], f)
        self.assertTrue(f["held"])
        self.assertTrue(f["enterRow"]["type"] == "seatEnter", f["enterRow"])
        self.assertEqual(f["enterRow"]["vehicle"], 1)
        self.assertEqual(f["enterRow"]["seat"], 0)
        self.assertTrue(f["driverSeen"])

    def test_seat_exit_returns_the_soldier(self) -> None:
        f = self.results["f"]
        self.assertTrue(f["exitRow"]["type"] == "seatExit", f["exitRow"])
        self.assertTrue(f["unmounted"])
        # The default exit point is 2 m to the vehicle's left.
        self.assertLess(f["exitDist"], 5.0)

    # --- (g) fire throttling --------------------------------------------------------

    def test_fire_events_throttle_to_smg_cadence(self) -> None:
        g = self.results["g"]
        self.assertTrue(g["sameSlot"])
        self.assertGreaterEqual(g["events"], 2)
        self.assertLessEqual(g["events"], 5)
        self.assertTrue(g["throttled"], g)

    # --- (h) byte budget -------------------------------------------------------------

    def test_sixteen_player_snapshot_is_a_few_hundred_bytes(self) -> None:
        h = self.results["h"]
        self.assertEqual(h["players"], 16)
        self.assertEqual(h["decodedPlayers"], 16)
        self.assertLessEqual(h["bytes"], 640)
        self.assertTrue(h["ok"], h)

    # --- (i) the real wake level -------------------------------------------------------

    def test_wake_loads_headless_with_a_full_lattice(self) -> None:
        i = self.results["i"]
        self.assertTrue(i["loaded"])
        self.assertEqual(i["dim"], 512)
        self.assertEqual(i["spacing"], 4)
        self.assertEqual(i["latticeFilled"], i["latticeCells"])
        self.assertEqual(i["materials"], 262144)
        self.assertTrue(i["statics"])
        self.assertTrue(i["collider"])

    def test_wake_has_a_drivable_table_and_mount_round_trip(self) -> None:
        i = self.results["i"]
        assert any(k in i["kinds"] for k in ("air", "ground", "tank")), i["kinds"]
        assert "Willy:ground" in i["table"], i["table"]
        self.assertTrue(i["mountOk"])
        self.assertTrue(i["unmountOk"])

    # --- (j) the glb-tree contract -------------------------------------------------------

    def test_template_tree_carries_the_seat_hierarchy(self) -> None:
        j = self.results["j"]
        self.assertEqual(j["willy"]["control"], "Willy")
        self.assertEqual(j["willy"]["kind"], "ground")
        self.assertGreaterEqual(j["willy"]["seats"], 1)
        self.assertGreaterEqual(j["willy"]["springs"], 1)
        # A Willys jeep carries no weapons; the aircraft does.
        self.assertEqual(j["willy"]["fireArms"], 0)
        self.assertGreaterEqual(j["zero"]["fireArms"], 1)
        self.assertEqual(j["willy"]["entries"], 4)
        self.assertEqual(j["zero"]["control"], "Zero")
        self.assertEqual(j["zero"]["kind"], "air")
        self.assertGreaterEqual(j["zero"]["seatables"], 1)

    # --- (k) P3: armor at spawn, the death decree, respawn ------------------------------

    def test_spawn_builds_the_kits_armor(self) -> None:
        k = self.results["k"]
        self.assertTrue(k["hpAtSpawnOk"], k["armorAtSpawn"])

    def test_destroyed_armor_decree_is_a_death(self) -> None:
        k = self.results["k"]
        self.assertTrue(k["killedRow"])
        self.assertTrue(k["deathTicket"], k["deathTicket"])
        self.assertTrue(k["deadLatch"])
        self.assertIs(k["aliveOnWire"], False)
        # The dead send nothing: the forwarded input never reaches the world.
        self.assertIsNone(k["deadPending"])

    def test_spawn_revives_with_fresh_armor(self) -> None:
        k = self.results["k"]
        self.assertTrue(k["reviveOk"], k["reviveOk"])
        self.assertEqual(k["hpAfterRespawn"], 30)

    # --- (l) P3: flag capture and the majority bleed -------------------------------------

    def test_contested_ring_freezes_capture(self) -> None:
        l = self.results["l"]
        self.assertTrue(l["contestFroze"])
        self.assertFalse(l["capturedBefore"])

    def test_uncontested_enemy_captures_after_the_window(self) -> None:
        l = self.results["l"]
        self.assertTrue(l["southFlipped"], l["capturedRow"])
        row = l["capturedRow"]
        self.assertEqual(row["flag"], 1)
        self.assertEqual(row["team"], 1)
        self.assertEqual(row["name"], "South")

    def test_majority_bleed_drains_the_flagless_team(self) -> None:
        l = self.results["l"]
        self.assertTrue(l["bleedTicket"], l["majorityRow"])
        self.assertEqual(l["majorityRow"]["team"], 2)


    # --- (m) P4: one spawn pick, the ack, and the wire's units ---------------

    def test_a_deploy_row_pins_the_authority_to_the_pages_spawn_point(self) -> None:
        m = self.results["m"]
        # The defect: the authority walked the flag's spawn list on every
        # deploy row while the page did not, so the two sims stood the same
        # soldier on different points of the same flag — 45 m and 17.7 deg
        # apart on Aberdeen. A row naming the index lands on that index, keeps
        # it, and agrees with what the page's own `spawnPlayer` produced.
        for row in m["pinned"]:
            self.assertEqual(row["spawnIndex"], row["index"], row)
            self.assertEqual(row["name"], row["pageName"], row)
            self.assertTrue(row["agrees"], row)
            self.assertAlmostEqual(row["yawGapDeg"], 0.0, places=9)

    def test_a_row_without_an_index_keeps_the_authoritys_own_walk(self) -> None:
        m = self.results["m"]
        # A client that sends no index is unchanged: the authority advances.
        self.assertEqual(m["unpinnedIndex"], 1)
        # And an absurd index is clamped out rather than trusted, so that row
        # falls back to the walk too.
        self.assertEqual(m["spawnIndexMax"], 0xffff)
        self.assertEqual(m["absurdIndex"], 1)

    def test_the_snapshot_acknowledges_the_input_it_consumed(self) -> None:
        m = self.results["m"]
        acks = [row["ack"] for row in m["ackTrace"]]
        self.assertEqual(acks, [501, 502, 503, 504])
        # An idle tick never withdraws an acknowledgement: the engine's zeroed
        # word carries no seq, and the client's reconciliation point would go
        # with it.
        self.assertEqual(m["afterIdle"], 504)

    def test_the_wire_carries_the_facing_in_degrees(self) -> None:
        m = self.results["m"]
        self.assertAlmostEqual(m["wireYawDeg"], m["soldierYawDeg"], places=4)
        # And it is degrees, not the World's radians under a degrees field —
        # which is what drew every remote soldier at a 57th of its heading.
        self.assertNotAlmostEqual(m["wireYawDeg"], m["soldierYawRad"], places=3)
        self.assertAlmostEqual(m["wireYawDeg"], -72.0, places=3)


if __name__ == "__main__":
    unittest.main()
