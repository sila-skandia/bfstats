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
  the facing on the wire is degrees (`SNAPBACK.md`);
* the bleed on the engine's rule (ledger TKT-4), played on the page's own
  round (`round-state.js`): a whole ticket every `60 / (rate * maxPlayers /
  16)` s while the enemy's summed `areaValue` is over 99, a point with no
  flag counting, and the countdown refilled whole while the gate is shut;
* the round's end in a room (ROUND-2, ROUND-9, ROUND-11, HP-20): the result
  sent, the world cleared with nothing spent, no human spawn until the
  restart, and the restart ten seconds on with the tickets made again and the
  flags back on their level teams;
* a room's layer: the one its creating join named (`?mode=`), else the
  level's default, and the HELLO saying which.
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
    "world", "physics", "parachute", "swim", "soldier", "ladder-climb", "spawn-flags", "spawn-safety",
    "point-body", "fixed-step", "soldier-pose", "soldier-locomotion", "walking-body", "soldier-resolve",
    "mouse-input", "fall-damage",
    "body-world", "body-statics", "body-pose", "vehicle-bodies", "combat-area", "supply", "armor",
    "vehicle-damage", "seats", "seat-dots", "rigid-body", "body-contact", "airborne",
    # seats.js re-exports its split modules.
    "seat-survey", "camera-pivot", "turret-rig", "vehicle-occupancy", "entry-points", "spawned-craft", "fire-state",
    # fire-state.js runs a seat gun's cone (XHIT-15).
    "deviation",
    # world.js's World delegates to its split modules.
    "world-input", "world-players", "world-snapshot", "world-bodies",
    "world-soldier-tick", "world-vehicle-tick", "world-fields", "world-damage",
    # world-soldier-tick.js and world-bodies.js bill barbed wire.
    "obstacle",
    "body-ground", "body-friction", "crash-damage", "effects-core", "projectile-damage",
    "collision-materials", "heightfield", "static-index", "collision-meshes",
    "drivable-mask", "world-collider", "vehicle-camera", "vehicle-discovery", "vehicle-base",
    # vehicle-base.js spells a template name as its model file.
    "model-file",
    # world-soldier-tick.js carries the weapon's recoil.
    "recoil",
    # vehicle-instance.js is what `room-control.mjs` asks whether a hull is
    # enterable; it re-exports seats.js's occupancy.
    "vehicle-instance",
    "aircraft", "vectored-engines", "engine-revs", "ship-spec", "wheeled-vehicle", "suspension", "ground-specs", "ground-contact", "ground-engine",
    "tracked-vehicle", "game-modes", "netcode",
    # The land drives run an amphibian's water half (`amphibious.js`).
    "amphibious", "body-float",
    # Both land drives scroll their belts.
    "track-scroll",
    # Reached through seats.js: the salvo arithmetic and the HUD weapon-slot
    # order, and an aircraft torpedo's water run.
    "bomb-release", "torpedo-run",
    # level-data.mjs gives each room its own tickets, scaled for its slots.
    "round-state",
    # authority.mjs runs a CTF layer's flags.
    "ctf",
    # room-pads.mjs runs the page's pad law (deployables.js) and the table
    # finds a pad's node the page's way (level-statics.js).
    "deployables", "level-statics",
    # room-hits.mjs prices a reported landing by the page's own law.
    "friendly-fire", "knockback", "soldier-exposure", "soldier-death", "skeleton-hit",
]
MODULES = {f"viewer/{name}.js": VIEWER / f"{name}.js" for name in _VIEWER_MODULES}
MODULES.update({
    # flight.js imports the loader and the loader its utils; both are pure JS.
    "viewer/vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "viewer/vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
    "viewer/vendor/utils/SkeletonUtils.js": VIEWER / "vendor" / "utils" / "SkeletonUtils.js",
    # The server feature's own files, in their own dir, so their relative
    # imports (`./glb-tree.mjs`, `../viewer/world.js`) resolve unmodified.
    "server/glb-tree.mjs": SERVER / "glb-tree.mjs",
    "server/level.mjs": SERVER / "level.mjs",
    # level.mjs's pieces (it re-exports each).
    "server/glb-scene.mjs": SERVER / "glb-scene.mjs",
    "server/level-bodies.mjs": SERVER / "level-bodies.mjs",
    "server/level-data.mjs": SERVER / "level-data.mjs",
    "server/level-instance.mjs": SERVER / "level-instance.mjs",
    "server/vehicle-table.mjs": SERVER / "vehicle-table.mjs",
    "server/level-load.mjs": SERVER / "level-load.mjs",
    "server/level-descriptor.mjs": SERVER / "level-descriptor.mjs",
    "server/rooms.mjs": SERVER / "rooms.mjs",
    # rooms.mjs's pieces (it re-exports each).
    "server/room.mjs": SERVER / "room.mjs",
    "server/room-registry.mjs": SERVER / "room-registry.mjs",
    "server/room-control.mjs": SERVER / "room-control.mjs",
    "server/room-stream.mjs": SERVER / "room-stream.mjs",
    "server/room-rules.mjs": SERVER / "room-rules.mjs",
    "server/room-wire.mjs": SERVER / "room-wire.mjs",
    "server/authority.mjs": SERVER / "authority.mjs",
    "server/room-pads.mjs": SERVER / "room-pads.mjs",
    "server/room-hits.mjs": SERVER / "room-hits.mjs",
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
    # Scenario (i) loads the real Wake level out of the untracked maps tree.
    if not (VIEWER / "maps" / "wake" / "scene.json").exists():
        raise unittest.SkipTest("viewer/maps/wake is not in the tree")
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

    def test_a_rooms_land_drive_gets_the_pages_inputs_and_drives(self) -> None:
        # map.html's buildHullDrive hands a land drive the collider and the
        # sea (PHY-16's sea bed), and its wheels a radius off their own mesh.
        # A room's drive had neither: every wheel measured -Infinity off an
        # undecoded mesh, no wheel touched the ground, and the hull sat still
        # on its failsafe at full throttle.
        land = self.results["i"]["land"]
        self.assertIsNotNone(land)
        self.assertTrue(land["collider"])
        self.assertTrue(land["waterLevel"])
        self.assertTrue(land["radiiFinite"])
        self.assertEqual(land["wheels"], land["probeDepths"])
        self.assertTrue(land["waterPart"])
        self.assertTrue(land["grounded"])
        self.assertGreater(land["moved"], 1.0, land)

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

    # --- (l) P3: flag capture and the bleed ----------------------------------------------

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

    def test_holding_both_flags_bleeds_the_other_side_whole_tickets(self) -> None:
        # The test level's points weigh 50 each. One a side bled nobody; team 1
        # holding both holds 100, over the engine's 99, and team 2 bleeds its
        # 30 a minute: one whole ticket, on a row of its own reason.
        l = self.results["l"]
        self.assertEqual(0, l["bleedsBeforeCapture"])
        self.assertEqual({"team": 2, "count": 99, "reason": "bleed"}, l["bleedRow"])
        self.assertEqual({"1": 100, "2": 0}, l["held"])
        self.assertEqual({"1": False, "2": True}, l["bleeding"])

    def test_the_first_bleed_ticket_waits_a_whole_interval(self) -> None:
        # 60 / 30 = 2 s. The capture's own tick is the bleed's first, so the
        # ticket lands 60 ticks in; float error on the countdown may add one.
        seconds = (self.results["l"]["bleedGapTicks"] + 1) / 30
        self.assertAlmostEqual(2.0, seconds, delta=1 / 30 + 1e-9)


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


    # --- (n)-(q) the bleed on the engine's rule (ledger TKT-4) ---------------------------

    def test_a_point_with_no_flag_over_99_bleeds_its_enemy(self) -> None:
        # Battle of Britain: `Allied_Base` owns no spawns, so the world makes
        # no flag of it, but it weighs 150 for the Allies. The Axis bleeds its
        # 4 a minute from the first tick, and its own 50 bleeds nobody.
        n = self.results["n"]
        self.assertEqual(["Axis_East_Airfield"], n["flags"])
        self.assertEqual({"1": 50, "2": 150}, n["firstTick"]["held"])
        self.assertEqual({"1": True, "2": False}, n["firstTick"]["bleeding"])
        self.assertEqual({"1": 96, "2": 100}, n["tickets"])
        self.assertEqual(0, n["allies"])

    def test_the_bleed_is_one_whole_ticket_every_sixty_over_the_rate_seconds(self) -> None:
        # A ticket every 60 / 4 = 15 s, the first a whole interval in: the
        # room's ticks 1..t all bled. Four in 61 s, counting down by one.
        n = self.results["n"]
        self.assertEqual(61, n["clock"])
        self.assertEqual([99, 98, 97, 96], [count for _, count in n["axis"]])
        for i, (tick, _) in enumerate(n["axis"]):
            self.assertAlmostEqual(15.0 * (i + 1), tick / 30, delta=1 / 30 + 1e-9)

    def test_all_five_wake_points_bleed_japan(self) -> None:
        # The US's five points of 20 weigh 100: Japan bleeds its 5 a minute,
        # a ticket at 12 s.
        o = self.results["o"]
        self.assertEqual({"1": 0, "2": 100}, o["allUs"]["held"])
        self.assertEqual({"1": True, "2": False}, o["allUs"]["bleeding"])
        self.assertEqual({"1": 99, "2": 100}, o["at13"]["tickets"])
        [(team, tick, count)] = o["at13"]["bleeds"]
        self.assertEqual((1, 99), (team, count))
        self.assertAlmostEqual(12.0, tick / 30, delta=1 / 30 + 1e-9)

    def test_four_of_five_points_at_20_bleed_nobody(self) -> None:
        # Japan takes one: the US keeps four of the five, the flag majority
        # the superseded rule bled Japan for, and 80 of weight, under 99.
        # A minute passes without a ticket row.
        taken = self.results["o"]["oneTaken"]
        self.assertEqual({"1": 20, "2": 80}, taken["held"])
        self.assertEqual({"1": False, "2": False}, taken["bleeding"])
        self.assertEqual({"1": 99, "2": 100}, taken["tickets"])
        self.assertEqual(0, taken["rows"])
        self.assertEqual(60, taken["seconds"])

    def test_a_shut_gate_refills_the_countdown(self) -> None:
        # Wake at 18 s owes Japan's next ticket in 6 s. The gate shuts for one
        # tick (the US at 80) and the engine writes the whole 12 s back
        # (team 1 0x08152100): the next ticket comes 12 s after the gate
        # reopens, not 6.
        p = self.results["p"]
        self.assertEqual(1, len(p["beforeShut"]))
        self.assertAlmostEqual(6.0, p["owed"], delta=1 / 30 + 1e-9)
        self.assertEqual(12, p["shut"]["countdown"])
        self.assertEqual({"1": False, "2": False}, p["shut"]["bleeding"])
        self.assertEqual(98, p["next"]["count"])
        self.assertAlmostEqual(12.0, p["next"]["gapTicks"] / 30, delta=1 / 30 + 1e-9)
        self.assertEqual(1, p["after"])

    def test_the_rooms_round_is_scaled_once(self) -> None:
        # Kasserine Pass co-op's 100 a side and `game.maxNrOfPlayers 18`: the
        # room scales the start once for its 16 slots (112, not 126), the
        # round starts where the handshake does, and its 15 a minute is a
        # ticket every 4 s.
        q = self.results["q"]
        self.assertEqual({"1": 112, "2": 112}, q["start"]["world"])
        self.assertEqual({"1": 112, "2": 112}, q["start"]["round"])
        self.assertEqual({"team1": 15, "team2": 15}, q["start"]["lossPerMin"])
        tick, count = q["first"]
        self.assertEqual(111, count)
        self.assertAlmostEqual(4.0, tick / 30, delta=1 / 30 + 1e-9)
        self.assertEqual({"1": 111, "2": 112}, q["tickets"])

    # ---- (r) the radio relay ------------------------------------------------

    def test_team_radio_reaches_only_the_speakers_team(self) -> None:
        r = self.results["r"]
        self.assertEqual([1, 1, 2], r["teams"])
        self.assertEqual({"a": 0, "c": 0, "row": {"slot": 1, "msg": 1, "broadcast": True,
                                                  "hasAt": True}}, r["team"])

    def test_a_shout_reaches_anyone_within_70_m(self) -> None:
        r = self.results["r"]
        self.assertEqual({"b": 1, "c": 1}, r["nearShout"])   # the enemy hears it too
        self.assertEqual({"b": 1, "c": 0}, r["farShout"])
        self.assertEqual(0, r["badId"])

    # ---- (t) each room its own tickets --------------------------------------

    def test_each_room_spends_its_own_tickets(self) -> None:
        # Two rooms on one level: a room's tickets are its own copy, scaled
        # for the lobby's 16 slots (the level's numbers), so one room's losses
        # never reach the other room or the level's data (ledger TKT-1).
        t = self.results["t"]
        self.assertTrue(t["separate"])
        self.assertEqual({"a": 100, "b": 100, "level": 100}, t["before"])
        self.assertEqual({"a": 93, "b": 100, "level": 100}, t["after"])

    def test_a_remote_pilots_rudder_and_lever_arrive_analogue(self) -> None:
        # c_PIYaw and c_PIThrottle cross as retail's 12-bit channels (W-1,
        # W-2): -0.37 and 0.6 arrive as -0.37 and 0.6 (the 12-bit step and
        # the 0.01 snap), not as -1 and 1.
        u = self.results["u"]
        self.assertEqual(2, u["buffered"])
        self.assertEqual(-0.37, u["rudder"])
        self.assertEqual(0.6, u["forwardKeys"])
        self.assertEqual(0.5, u["roll"])
        # An older page's 14-byte record still flies: its signs.
        self.assertEqual(-1, u["legacyRudder"])
        self.assertEqual(1, u["legacyForwardKeys"])

    def test_an_older_page_and_a_newer_one_share_a_room(self) -> None:
        # A 14-byte record (a cached page from before the analogue channels)
        # and a 17-byte one in one room: both walk, each sees the other, and
        # each word reaches the world at its own record's resolution.
        v = self.results["v"]
        self.assertEqual([18, 21], v["frameSizes"])
        self.assertEqual([None, None], v["closed"])
        self.assertGreater(v["oldTravelled"], 3)
        self.assertGreater(v["newTravelled"], 3)
        self.assertGreater(v["oldSeenByNew"], 3)
        self.assertGreater(v["newSeenByOld"], 3)
        self.assertEqual({"rudder": -1, "forwardKeys": 1}, v["oldWord"])
        self.assertEqual({"rudder": -0.37, "forwardKeys": 0.6}, v["newWord"])

    def test_a_ctf_rooms_hello_carries_its_flags(self) -> None:
        # A client joining mid-round starts from where the room's law has each
        # flag (`ctf.js` `snapshot`): here the Japanese flag in slot 4's hands.
        w = self.results["w"]
        self.assertIsNone(w["conquest"])
        self.assertEqual([0, 1], [row["flag"] for row in w["ctf"]])
        self.assertEqual({"flag": 0, "home": True, "carrier": None, "carrierTeam": 0,
                          "position": [0, 7.6, 100], "respawnIn": 30}, w["ctf"][0])
        self.assertEqual((False, 4, 2, [1, 0, -100]),
                         (w["ctf"][1]["home"], w["ctf"][1]["carrier"], w["ctf"][1]["carrierTeam"],
                          w["ctf"][1]["position"]))

    # --- (x) the round's end and the restart -------------------------------------

    def test_a_side_out_of_tickets_ends_the_rooms_round(self) -> None:
        # ROUND-2: Conquest ends when a side is under one ticket; the other
        # side wins, and the result goes to everyone with the restart's 10 s.
        x = self.results["x"]
        self.assertIsNotNone(x["end"], x)
        self.assertEqual(2, x["end"]["winner"])
        self.assertEqual("tickets", x["end"]["reason"])
        self.assertEqual(10, x["end"]["restartIn"])
        self.assertEqual(1, x["end"]["roundsWon"]["2"])
        self.assertEqual(0, x["ticketsAtEnd"]["team1"])

    def test_the_end_clears_the_world_without_spending(self) -> None:
        # HP-20's `clearWorld`: the living are killed, and the round having
        # ended, nothing is spent for it (ROUND-7).
        x = self.results["x"]
        self.assertEqual([2], x["cleared"])
        self.assertFalse(x["bAliveAfterEnd"])
        self.assertEqual(100, x["ticketsAtEnd"]["team2"])

    def test_a_human_cannot_spawn_while_the_round_is_over(self) -> None:
        # ROUND-11: `spawnPlayer` takes a human only at status 1.
        x = self.results["x"]
        self.assertTrue(x["refused"])
        self.assertTrue(x["aDeadDuringEnd"])
        self.assertEqual({"status": "endGame", "winner": 2}, x["helloDuringEnd"])

    def test_the_room_restarts_ten_seconds_after_the_end(self) -> None:
        # ROUND-9: `+0x21c` counts 10 s down, then `restartMap`: the tickets
        # made again, the rounds won kept, each flag back on its level team.
        x = self.results["x"]
        self.assertFalse(x["restartedEarly"])
        self.assertIsNotNone(x["restart"])
        self.assertEqual({"team1": 2, "team2": 100}, x["restart"]["tickets"])
        self.assertEqual([1, 2], [f["team"] for f in x["restart"]["flags"]])
        self.assertEqual([1, 2], x["flagsAfter"])
        self.assertEqual({"1": 0, "2": 1}, x["restart"]["roundsWon"])
        self.assertEqual("playing", x["roundAfter"]["status"])
        self.assertEqual({"team1": 2, "team2": 100}, x["ticketsAfter"])
        self.assertTrue(x["respawned"])

    # --- (y) a room's layer ---------------------------------------------------------

    def test_a_room_plays_the_layer_it_was_made_on(self) -> None:
        y = self.results["y"]
        self.assertEqual("Ctf", y["ctf"]["mode"])
        self.assertFalse(y["ctf"]["modeDefault"])
        self.assertEqual(["AxisBase", "AlliedBase"], y["ctf"]["flags"])
        self.assertIsNone(y["ctf"]["tickets"])
        self.assertTrue(y["ctf"]["ctf"])
        self.assertTrue(y["ctf"]["law"])
        self.assertEqual("Ctf", y["ctf"]["list"])

    def test_a_room_made_with_no_mode_plays_the_default_layer(self) -> None:
        y = self.results["y"]
        self.assertEqual("Conquest", y["def"]["mode"])
        self.assertTrue(y["def"]["modeDefault"])
        self.assertEqual(["North", "South"], y["def"]["flags"])
        self.assertEqual(100, y["def"]["tickets"])
        self.assertIsNone(y["def"]["ctf"])

    # --- (z2) a magazine change relayed ---------------------------------------------

    def test_a_magazine_change_reaches_the_others_once(self) -> None:
        z2 = self.results["z2"]
        self.assertEqual([{"slot": z2["slotA"], "weapon": "Thompson"}], z2["heard"])
        self.assertEqual(0, z2["echoed"])
        self.assertEqual(0, z2["badNames"])
        self.assertEqual(0, z2["fromTheDead"])

    # --- (z3), (z4) a reported landing, priced by the room ----------------------------

    def test_a_direct_hit_costs_the_hull_and_tells_everyone(self) -> None:
        z3 = self.results["z3"]
        self.assertTrue(z3["tables"])
        self.assertEqual({"vehicle": z3["willyId"], "hp": z3["hpBefore"] - 10}, z3["hullRow"])

    def test_a_blast_prices_and_throws_a_soldier_on_foot(self) -> None:
        # HP-9/HP-10: material 200 against the soldier's 40 at 3 m of 10; the
        # push is KNOCK-4's `75 * 150 / 10 * exposure`, its rise KNOCK-5's,
        # which leaves him at 8 m/s or more and in the flight (KNOCK-1), on the
        # server and on the wire.
        z3 = self.results["z3"]
        self.assertGreater(z3["lost"], 0)
        self.assertLess(z3["lost"], 25 * 0.7 + 1e-6)
        self.assertEqual(2, z3["blastRow"]["slot"])
        self.assertGreater(z3["blastRow"]["push"][1], 0)
        self.assertGreaterEqual(z3["speedAfter"], 8)
        self.assertIn(z3["flightOnServer"], ("flyForward", "flyBackward"))
        self.assertEqual(z3["flightOnServer"], z3["wireFlight"])

    def test_a_landing_off_the_shape_or_from_the_dead_is_dropped(self) -> None:
        self.assertEqual(0, self.results["z3"]["droppedLoss"])

    def test_a_statics_hit_points_go_out_by_its_scene_node(self) -> None:
        z4 = self.results.get("z4")
        if z4 is None:
            self.skipTest("no real viewer tree")
        self.assertIsNotNone(z4["factory"])
        self.assertEqual({"node": z4["factory"]["node"], "hp": z4["max"] - 250, "destroyed": False},
                         z4["objectRow"])

    # --- (z5) an abandoned hull's clock ----------------------------------------------

    def test_an_abandoned_hull_runs_down_its_clock_then_loses_hit_points(self) -> None:
        # SPAWN-13: on its pad it keeps every point; 100 m off it, empty, the
        # 2 s countdown runs in 0.5 s steps and each later step bills
        # `damageWhenLost` (4) a second, about 8 points in 4 s.
        z5 = self.results["z5"]
        self.assertEqual(z5["max"], z5["atPad"])
        self.assertLess(z5["away"], z5["max"] - 6)
        self.assertGreater(z5["away"], z5["max"] - 12)

    # --- (z) the room's vehicle pads -----------------------------------------------

    def test_the_hello_lists_both_of_a_pads_hulls(self) -> None:
        # The pad's other-side hull is in the table from the start, out of
        # the world, so a seat row and the page can name it (SPAWN-2).
        z = self.results["z"]
        self.assertEqual([{"template": "Willy", "pad": 0, "live": True},
                          {"template": "Zero", "pad": 0, "live": False}], z["hello"])

    def test_a_hulls_death_takes_its_crew(self) -> None:
        z = self.results["z"]
        self.assertTrue(z["seated"])
        self.assertTrue(z["killedInHull"])
        self.assertTrue(z["unseated"])
        self.assertEqual({"hp": 0, "destroyed": True}, z["hullRow"])

    def test_the_pads_delay_runs_from_the_death(self) -> None:
        # SPAWN-18: min + (max - min) * (1 - players / slots), one player of 16,
        # counted down from the death; the wreck on the pad goes as the fresh
        # hull comes (SPAWN-11), at full hit points.
        z = self.results["z"]
        self.assertAlmostEqual(5 + 5 * (1 - 1 / 16) - 1 / 30, z["delay"], places=6)
        self.assertEqual([], z["before"])
        self.assertEqual([["vehicleGone", z["willyId"], None], ["padSpawn", z["willyId"], "Willy"]],
                         z["replaced"])
        self.assertEqual(z["maxHp"], z["freshHp"])

    def test_a_capture_changes_the_pads_template_not_its_hull(self) -> None:
        # SPAWN-19: the hull standing is never touched by the flag; the next
        # one is the new holder's (SPAWN-12).
        z = self.results["z"]
        self.assertTrue(z["stillWilly"])
        self.assertEqual(["Zero"], z["afterCapture"])

    def test_the_round_clears_the_hulls_and_the_restart_stands_them(self) -> None:
        # HP-20's clearWorld takes every hull; restartMap's ObjectSpawner::reset
        # gives the pad back to the level's side, whose hull stands at once.
        z = self.results["z"]
        self.assertTrue(z["roundEnded"])
        self.assertEqual([z["zeroId"]], z["goneAtEnd"])
        self.assertTrue(z["restarted"])
        self.assertEqual("Willy", z["restartSpawns"][-1])
        self.assertEqual(["Willy"], z["liveAfter"])


if __name__ == "__main__":
    unittest.main()
