"""A room's ships: the page's floating and drive law on the room server
(`server/room-ships.mjs`).

Retail's server simulates every vehicle and a ship is no exception: there is
no ship-specific propulsion in the engine (`PhysicsEngine::updatePhysics`
0x0824cbb0 runs a `c_ETShip` screw as it runs a propeller, PHY-3), her
`FloatingBundle`s hold her (`PhysicsFloatingBundle::updatePhysics` 0x0824d640,
SHIP-1), and the client's copy is corrected to the server's (NET-10). Until
2026-11-13 the room drove none: `mountIntoSeat` granted a drive to air, ground
and tank roots, so a helmsman's page sailed its own copy alone, the ships'
landing craft and deck aircraft stayed baked into their ships, and Wake's Axis
bots swam from their carriers. This pins what the room does now, on the tree's
own Wake:

* the load: every floating hull at its float nodes' draft
  (`body-float.js` `equilibriumRootY`), the ships' craft split off as vehicles
  of their own after the level's rows, each room's deck points its own;
* the helm: one `Ship` a hull, sailed by the helmsman's input word, the pose
  on the wire hers, and that pose the bare law's on the same input;
* the hull box her drag and float damping read (COL-14), which the server's
  empty drawn meshes had turned into the world box of a yawed hull;
* what she carries: her deck points (SPAWN-4), the aircraft her spawner holds
  (`ObjectSpawner::handleFrameUpdate` 0x083138c0), a soldier on her deck
  (COL-30, COL-31);
* the helm let go: she runs on with her controls at zero, as an empty
  PlayerControlObject does, and is the same drive when taken again;
* a sleeping root's parts are not tested (TANK-20), and the static candidates
  are cut to the hull's own box with no change to the answer;
* a landing craft sailed off, an AA battery fired under way through
  `room-guns.mjs`, and a bot at a helm.

The harness is the slow part: it runs once.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "room_ships_harness.mjs"


class RoomShipsTests(unittest.TestCase):
    result: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        needed = ("models/Shokaku.glb", "maps/wake/scene.glb", "maps/_shared/damage.json")
        for name in needed:
            if not (ROOT / "viewer" / name).exists():
                raise unittest.SkipTest(f"viewer/{name} is not in the tree")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=900, cwd=ROOT)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout[-2000:]}\n{proc.stderr[-4000:]}")
        cls.result = json.loads(proc.stdout)

    def part(self, name: str) -> dict:
        return self.result[name]

    # --- the load ---------------------------------------------------------------

    def test_every_floating_hull_lies_at_its_draft(self) -> None:
        load = self.part("load")
        self.assertEqual(load["water"], 95)
        self.assertEqual(sorted(d["template"] for d in load["drafts"] if not d["copy"]),
                         ["Daihatsu"] * 4 + ["Hatsuzuki", "Shokaku"])
        # Two more of each Daihatsu: its spawner's other slots (SPAWN-24).
        self.assertEqual(sum(1 for d in load["drafts"] if d["copy"]), 8)
        for hull in load["drafts"]:
            self.assertAlmostEqual(hull["y"], hull["rest"], places=3, msg=hull["template"])
        # The Hatsuzuki's pad is 0.19 m over her draft and the Daihatsus hang
        # on their davits: the level's poses are not the float law's.
        by = {d["template"]: d["y"] for d in load["drafts"]}
        self.assertAlmostEqual(by["Hatsuzuki"], 89.363, places=2)
        self.assertAlmostEqual(by["Shokaku"], 95.318, places=2)
        self.assertAlmostEqual(by["Daihatsu"], 95.985, places=2)

    def test_a_ships_craft_are_vehicles_of_their_own_after_the_levels_rows(self) -> None:
        load = self.part("load")
        baked = [c for c in load["craft"] if c["slot"] == 0]
        self.assertEqual([c["template"] for c in baked],
                         ["Daihatsu", "Daihatsu", "Zero", "AichiVal", "Daihatsu", "Daihatsu"])
        self.assertEqual([c["kind"] for c in baked], ["ship", "ship", "air", "air", "ship", "ship"])
        self.assertTrue(all(c["pad"] is None and c["node"] and c["live"] for c in baked))
        # Each Daihatsu spawner's `maxNrOfObjectSpawned 3`: two copies, after
        # the baked rows, out of the world until the spawner stands them, and
        # named on the wire by the baked craft's node and their slot.
        copies = [c for c in load["craft"] if c["slot"]]
        self.assertEqual(len(copies), 8)
        self.assertTrue(all(c["template"] == "Daihatsu" and not c["live"] for c in copies))
        self.assertEqual(load["craft"][:6], baked)
        wire = load["wire"]
        self.assertEqual([w[1:] for w in wire[:6]], [[0, True]] * 6)
        self.assertEqual(sorted(w[1] for w in wire[6:]), [1, 1, 1, 1, 2, 2, 2, 2])
        self.assertTrue(all(w[2] is False and w[0] in {x[0] for x in wire[:6]} for w in wire[6:]))
        self.assertTrue(load["craftLast"])
        self.assertTrue(load["ids"])
        self.assertEqual(load["ships"], ["daihatsu"] * 4 + ["shokaku"])
        self.assertEqual(load["heldOnShip"], ["AichiVal", "Zero"])

    def test_each_room_has_its_own_deck_points(self) -> None:
        load = self.part("load")
        self.assertTrue(load["pointsOwn"])
        self.assertTrue(load["pointsEqual"])
        self.assertTrue(load["reportUntouched"])

    # --- the helm ---------------------------------------------------------------

    def test_the_helmsman_sails_the_rooms_ship(self) -> None:
        helm = self.part("helm")
        self.assertTrue(helm["isShip"])
        self.assertTrue(helm["shipDrive"])
        self.assertTrue(helm["kept"])
        self.assertTrue(helm["driver"])
        speeds = [row["speed"] for row in helm["track"]]
        self.assertEqual(speeds, sorted(speeds))
        # A carrier's own pace: 1.3 m/s two seconds in, 8.5 at twelve.
        self.assertAlmostEqual(speeds[0], 1.35, delta=0.15)
        self.assertAlmostEqual(speeds[-1], 8.5, delta=0.5)
        self.assertGreater(helm["sailed"], 55)
        self.assertLess(helm["sailed"], 70)
        # She floats at her draft under way.
        self.assertLess(helm["heave"], 0.02)
        self.assertTrue(helm["awakeUnderWay"])

    def test_the_wire_carries_her_pose(self) -> None:
        row = self.part("helm")["row"]
        self.assertIsNotNone(row)
        self.assertTrue(row["occupied"])
        # The last snapshot, a tick or two old at 8.5 m/s.
        self.assertLess(row["off"], 0.6)
        self.assertGreater(row["q"], 0.9999)
        # Her heading, not the identity the world answers for a hull it holds
        # no body for.
        self.assertGreater(row["turned"], 0.3)

    def test_the_rooms_pose_is_the_bare_laws(self) -> None:
        law = self.part("law")
        self.assertLess(law["off"], 0.1)
        self.assertLess(law["turn"], 1e-5)

    def test_her_box_is_the_hulls_own(self) -> None:
        box = self.part("box")
        # 42 x 46 x 269 m (her mesh, masts and island included); the world
        # box of her collision meshes at her 49 degrees was near square.
        self.assertAlmostEqual(box["size"][0], 42.1, delta=0.5)
        self.assertAlmostEqual(box["size"][1], 46.5, delta=0.5)
        self.assertAlmostEqual(box["size"][2], 268.7, delta=0.5)
        self.assertEqual(box["mass"], 25000000)
        self.assertEqual(box["floats"], 8)
        self.assertTrue(box["underside"])
        self.assertLess(box["sampleKeel"], -9)

    # --- what she carries -------------------------------------------------------

    def test_her_deck_points_go_with_her(self) -> None:
        helm = self.part("helm")
        self.assertEqual(len(helm["pointsMoved"]), 6)
        for moved in helm["pointsMoved"]:
            self.assertGreater(moved, 55)
        for off in helm["pointsOnDeck"]:
            self.assertLess(off, 0.01)
        # Another room's carrier has not moved, nor its points.
        self.assertEqual(helm["elsewherePoints"], [0] * 6)

    def test_the_aircraft_her_spawner_holds_rides_her(self) -> None:
        helm = self.part("helm")
        self.assertGreater(helm["zeroMoved"], 55)
        self.assertLess(helm["zeroOnDeck"], 0.01)
        self.assertFalse(helm["zeroBody"])
        self.assertLess(helm["zeroRow"], 0.6)

    def test_a_soldier_on_her_deck_is_carried(self) -> None:
        helm = self.part("helm")
        self.assertTrue(helm["riderAlive"])
        # 61 m of sea under her and the soldier within a few metres of where
        # they stood on the deck, at the deck's height.
        self.assertLess(helm["riderSlid"], 4)
        self.assertLess(abs(helm["riderHeight"]), 0.1)

    # --- the helm let go ----------------------------------------------------------

    def test_a_ship_runs_on_when_her_helm_is_let_go(self) -> None:
        leave = self.part("leave")
        self.assertFalse(leave["seated"])
        self.assertIsNone(leave["driver"])
        self.assertEqual(leave["coasting"], 1)
        self.assertTrue(leave["stillDriven"])
        self.assertGreater(leave["ranOn"], 20)
        self.assertTrue(leave["helmsmanAlive"])
        later = leave["later"]
        self.assertTrue(later["slower"])
        self.assertEqual(later["row"], 0)
        self.assertTrue(later["helmsmanAlive"])

    def test_taken_again_she_is_the_same_drive_at_her_speed(self) -> None:
        retaken = self.part("leave")["retaken"]
        self.assertTrue(retaken["same"])
        self.assertTrue(retaken["driver"])
        self.assertEqual(retaken["coasting"], 0)
        self.assertGreater(retaken["kept"], 0.98)

    def test_a_hull_let_go_lying_still_is_at_rest_at_once(self) -> None:
        rest = self.part("rest")
        self.assertTrue(rest["adopted"])
        self.assertFalse(rest["running"])
        self.assertFalse(rest["body"])
        self.assertEqual(rest["row"], 0)
        self.assertGreater(rest["rowTurned"], 0.3)
        self.assertTrue(rest["kept"])

    # --- the cost ---------------------------------------------------------------

    def test_a_crewed_ship_lying_still_sleeps(self) -> None:
        sleep = self.part("sleep")
        self.assertTrue(sleep["awakeAtFirst"])
        self.assertTrue(sleep["asleepIdle"])

    def test_narrowing_the_candidates_changes_no_answer(self) -> None:
        narrow = self.part("narrow")
        self.assertEqual(narrow["same"], 0)
        self.assertEqual(narrow["turn"], 0)
        self.assertGreater(narrow["of"], 0)
        self.assertLess(narrow["kept"], narrow["of"] / 2)

    def test_the_narrowed_box_holds_the_wheel_springs_too(self) -> None:
        # A body's wheel springs are probed against the same candidates after
        # its hull (`collideSpringsWithStatics`), and a wheel hangs under the
        # hull's own box: the caller names them, and without them named
        # nothing is narrowed.
        statics = (ROOT / "viewer" / "body-statics.js").read_text()
        world = (ROOT / "viewer" / "body-world.js").read_text()
        self.assertIn("collideWithStatics(entry.parts, this.statics, TICK, handlers, entry.springs ?? null)", world)
        self.assertIn("if (springs !== undefined && statics.narrow", statics)
        self.assertIn("for (const part of springs ?? []) take(part);", statics)

    # --- going down ---------------------------------------------------------------

    def test_a_ship_shot_into_critical_goes_down(self) -> None:
        sink = self.part("sink")
        self.assertEqual(sink["before"], {"hp": 600, "critical": 100, "flagged": False})
        self.assertTrue(sink["flagged"])
        self.assertFalse(sink["destroyed"])
        self.assertTrue(sink["going"])
        ys = [row["y"] for row in sink["track"]]
        self.assertEqual(ys, sorted(ys, reverse=True))
        # The Shokaku's floats write no `sinkingSpeedMod`: the template's 1.0
        # (0x0824094c), 0.6 to 1.2 m/s a float. 2.9 m down at 5 s, 16.4 at 20.
        self.assertAlmostEqual(ys[0], -2.95, delta=0.3)
        self.assertAlmostEqual(ys[-1], -16.4, delta=1.0)
        # By one end, more each second.
        trims = [abs(row["bow"]) for row in sink["track"]]
        self.assertEqual(trims, sorted(trims))
        self.assertGreater(trims[-1], 0.03)
        # The wire, her deck points and the soldier on her deck go with her.
        self.assertLess(sink["row"], 0.1)
        self.assertLess(sink["point"], -10)
        self.assertLess(sink["soldier"], -10)

    def test_she_goes_down_under_her_helmsman_and_after_they_leave(self) -> None:
        sunk = self.part("sunk")
        self.assertTrue(sunk["manned"]["armed"])
        self.assertFalse(sunk["manned"]["asleep"])
        self.assertLess(sunk["manned"]["y"], -6)
        self.assertLess(sunk["left"]["y"], sunk["manned"]["y"] - 6)
        self.assertTrue(sunk["left"]["running"])
        self.assertTrue(sunk["left"]["going"])

    def test_one_destroyed_in_a_single_blow_stays_afloat(self) -> None:
        # `Armor::status` sends 0x15 alone on a death from above the
        # threshold (HP-13): no float is armed.
        blow = self.part("blow")
        self.assertTrue(blow["destroyed"])
        self.assertFalse(blow["flagged"])
        self.assertFalse(blow["going"])
        self.assertLess(abs(blow["y"]), 0.05)

    def test_an_unwritten_sinking_speed_mod_is_the_templates_one(self) -> None:
        source = (ROOT / "viewer" / "body-float.js").read_text()
        self.assertIn("export const SINKING_SPEED_MOD_DEFAULT = 1;", source)
        self.assertIn("physics.sinkingSpeedMod ?? SINKING_SPEED_MOD_DEFAULT", source)

    def test_the_page_arms_a_crewed_ship_and_leaves_a_rooms_to_the_room(self) -> None:
        hulls = (ROOT / "viewer" / "hull-bodies.js").read_text()
        step = hulls[hulls.index("function stepFloatHosts("):hulls.index("function presentHeldCraft(")]
        self.assertIn("drive.armSinking?.(host.sinkOffsets ?? null)", step)
        self.assertIn("if (page.world?.remoteDamage) continue;", step)
        ship = (ROOT / "viewer" / "ship.js").read_text()
        self.assertIn("float.sinkOffset = (float.sinkOffset || 0) + float.sinkRate", ship)

    # --- her spawners -------------------------------------------------------------

    def test_a_ships_spawner_stands_the_next_landing_craft_where_she_is(self) -> None:
        sp = self.part("spawner")
        # `HatsuzukiDaihatsuSpawner` as the Shokaku's own uses it: three
        # slots, 20 s, and the abandon clock's 30 s / 20 m / 10 a second.
        self.assertEqual(sp["slots"], 3)
        self.assertEqual(sp["delay"], [20, 20])
        self.assertEqual(sp["abandon"], [30, 20, 10])
        self.assertEqual(sp["atLoad"], ["live", "out", "out"])
        # The delay runs only while the last one is off the spawner's 5 m.
        self.assertEqual(sp["untouched"], ["live", "out", "out"])
        second = sp["second"]
        # The carrier sailed off first, so the craft was already off the
        # spawner's 5 m for part of the 20 s when its coxswain took it.
        self.assertIsNotNone(second["after"])
        self.assertGreater(second["after"], 5)
        self.assertLess(second["after"], 26)
        # Beside her where she is now (she sailed on from her pad), afloat.
        self.assertAlmostEqual(second["fromShip"], second["offsetAtLoad"], delta=2.0)
        self.assertGreater(second["fromLoad"], 40)
        self.assertAlmostEqual(second["afloat"], 0.99, delta=0.1)
        self.assertEqual(len(second["rows"]), 1)
        self.assertEqual(second["state"], ["live", "live", "out"])

    def test_three_at_most_and_one_left_far_off_is_lost(self) -> None:
        sp = self.part("spawner")
        self.assertTrue(sp["third"]["seated"])
        self.assertEqual(sp["third"]["state"], ["live", "live", "live"])
        self.assertEqual(len(sp["third"]["rows"]), 2)
        self.assertTrue(sp["abandoned"]["far"])
        # A minute on: never more than three alive at once, and the first,
        # empty and far from its spawner, has been lost (SPAWN-13), which
        # frees its slot for the next.
        self.assertTrue(sp["later"]["lost"])
        self.assertLessEqual(sp["later"]["most"], 3)

    def test_the_page_runs_the_same_spawner(self) -> None:
        craft = (ROOT / "viewer" / "spawned-craft.js").read_text()
        statics = (ROOT / "viewer" / "level-statics.js").read_text()
        hulls = (ROOT / "viewer" / "hull-bodies.js").read_text()
        room = (ROOT / "viewer" / "net-room.js").read_text()
        self.assertIn("export function craftSpawnerOf(node)", craft)
        self.assertIn("const hold = spawnHoldOf(baked) ?? craftSpawnerOf(baked);", statics)
        self.assertIn("setNodeWorld(node, _holdMatrix.multiplyMatrices(hostMatrix(spawner.host), spawner.local))", hulls)
        self.assertIn("if (node && v.slot > 0) node = heldSlotsOf(node)?.[v.slot] ?? null;", room)

    # --- the room cap ---------------------------------------------------------------

    def test_a_level_is_costed_by_its_own_maps(self) -> None:
        cap = self.part("cap")
        levels = cap["levels"]
        # One cell a square metre, 9 bytes a cell.
        self.assertEqual([levels[n]["mapMb"] for n in ("stalingrad", "berlin", "wake", "midway")], [9, 36, 36, 144])
        self.assertEqual(levels["midway"]["cost"], {"worldSize": 4096, "hullMaps": 4, "waterMaps": 2})
        self.assertEqual(levels["berlin"]["cost"], {"worldSize": 2048, "hullMaps": 2, "waterMaps": 0})
        # A report with no AI maps: 2 km, the one map a hull is given by default.
        self.assertEqual(levels["bare"]["cost"], {"worldSize": 2048, "hullMaps": 1, "waterMaps": 0})
        # One bot room in every hull: 82 + 110 + 40 + 10, the level's maps, and
        # the scratch of one map being built (4 bytes a cell).
        self.assertEqual(levels["stalingrad"]["all"], 273)
        self.assertEqual(levels["berlin"]["all"], 366)
        self.assertEqual(levels["wake"]["all"], 438)
        self.assertEqual(levels["midway"]["all"], 1026)
        # The peaks measured on the server's own entry point (2026-11-13) are
        # under each: 251, 271, 386 and, with four of its five maps built, 717.
        for name, peak in (("stalingrad", 251), ("berlin", 271), ("wake", 386)):
            self.assertGreaterEqual(levels[name]["all"], peak)

    def test_a_room_runs_the_richest_tier_that_fits(self) -> None:
        cap = self.part("cap")
        self.assertEqual(cap["tiers"], {"none": 0, "foot": 1, "ships": 2, "hulls": 3})
        self.assertLessEqual(cap["memory"]["budget"], 832 * 0.9)
        levels = cap["levels"]
        for name in ("stalingrad", "berlin", "wake"):
            self.assertEqual(levels[name]["tier"], 3, name)
        # Midway's five maps are 720 MB, and its ships tier (the infantry map
        # and the two water maps) measured 733 MB at its peak: 738 here. The
        # 832Mi limit's budget of 748 is the smallest that gives Midway's bots
        # their ships (at 768Mi they were held on foot, and on Midway they
        # swim). The price: while that room runs, the server takes no other.
        self.assertEqual(levels["midway"]["tier"], 2)
        self.assertEqual(levels["midway"]["estimate"], 738)
        midway = cap["midway"]
        self.assertEqual(midway["first"], {"tier": 2})
        self.assertTrue(midway["botsOn"])
        self.assertEqual(midway["kinds"], ["ship"])
        self.assertEqual(midway["estimate"], 738)
        self.assertEqual(midway["second"], "server_full")
        self.assertEqual(midway["other"], "server_full")
        self.assertEqual(cap["raised"], {"tier": 2, "estimate": 738})
        self.assertGreaterEqual(cap["raised"]["estimate"], 733)

    def test_a_levels_rooms_share_its_hull_maps(self) -> None:
        wake = self.part("cap")["wake"]
        self.assertEqual(wake["a"], {"tier": 3})
        self.assertEqual(wake["b"], {"tier": 3})
        # The second room is a room and its bots, not a second set of maps.
        self.assertEqual(wake["two"], 438 + 50)
        self.assertTrue(wake["shared"])
        # A third level beside them: its bots on foot, and then no more.
        self.assertEqual(wake["berlin"], {"tier": 1})
        self.assertEqual(wake["three"], 488 + 110 + 50 + 36)
        self.assertEqual(wake["stalingrad"], "server_full")
        # A room's move to Midway is costed without the room it leaves, and
        # refused where it does not fit: the room stays as it is.
        self.assertEqual(wake["move"], {"tier": None, "changed": False})

    # --- the craft, the guns, the bots ------------------------------------------

    def test_a_landing_craft_is_sailed_off(self) -> None:
        craft = self.part("craft")
        self.assertEqual(craft["kind"], "ship")
        self.assertTrue(craft["isShip"])
        self.assertEqual(craft["seats"], 6)
        self.assertGreater(craft["sailed"], 80)
        self.assertEqual(craft["row"], 0)
        self.assertAlmostEqual(craft["afloat"], 0.99, delta=0.1)
        # The pitch word reaches a ship's drive: a Daihatsu's ramp and a
        # submarine's dive planes both bind `c_PIPitch`.
        self.assertEqual(craft["pitch"], 1)

    def test_a_ships_gun_is_flown_by_the_room_from_where_she_is(self) -> None:
        gun = self.part("gun")
        self.assertGreater(gun["seatIndex"], 0)
        self.assertGreater(gun["sailed"], 20)
        self.assertGreater(gun["rows"], 0)
        self.assertTrue(gun["slot"])
        self.assertTrue(gun["nearShip"])
        self.assertTrue(gun["farFromPad"])

    def test_a_bot_takes_a_helm_and_sails(self) -> None:
        bots = self.part("bots")
        self.assertEqual(bots["bots"], 8)
        self.assertTrue(bots["units"])
        self.assertGreater(bots["helms"], 0)
        self.assertTrue(bots["botHelm"])
        self.assertGreater(bots["farthest"], 50)

    def test_bot_ships_off_keeps_the_bots_off_the_helms(self) -> None:
        dry = self.part("dry")
        self.assertEqual(dry["bots"], 8)
        self.assertEqual(dry["offered"], 0)
        self.assertEqual(dry["helms"], 0)

    # --- the page's half ----------------------------------------------------------

    def test_the_page_draws_the_rooms_ship(self) -> None:
        room = (ROOT / "viewer" / "net-room.js").read_text()
        hulls = (ROOT / "viewer" / "hull-bodies.js").read_text()
        page = (ROOT / "viewer" / "map.html").read_text()
        # Every frame, every ship but the one this page sails goes where the
        # room has her, and her deck points with her.
        self.assertIn("    carryRiddenHull();\n    carryShips();", room)
        carry = room[room.index("function carryShips()"):room.index("function hideParkedHull")]
        self.assertIn("page.occupancy?.root === ship.node && page.occupancy.drive", carry)
        self.assertIn("page.carryShip(ship.owner, pose, pose.q)", carry)
        self.assertIn("page.rebaseDeckSpawns?.()", carry)
        # The helmsman's own ship is corrected against the room's like a land
        # hull (it was left alone while the room sailed none).
        correct = room[room.index("function correctDrivenHull()"):room.index("/** Remote soldiers holding a trigger")]
        self.assertNotIn("ownerIsShip", correct)
        # `carryShip` moves the node and the collider, never a hull this page drives.
        body = hulls[hulls.index("function carryShip("):hulls.index("/** Whether the hull under `owner` is a ship")]
        self.assertIn("if (!scene?.sea", body)
        self.assertIn("hullBodies.bodyWorld?.get(owner)?.driven) return false", body)
        self.assertIn("publishMovedHull(owner, scene, scene.node", body)
        for name in ("carryShip", "rebaseDeckSpawns"):
            self.assertRegex(page, r"from\(\(\) => hullBodies, `[^`]*\b%s\b" % name)

    def test_the_hull_col0_helpers_are_shared_with_the_page(self) -> None:
        spec = (ROOT / "viewer" / "ship-spec.js").read_text()
        hulls = (ROOT / "viewer" / "hull-bodies.js").read_text()
        ships = (ROOT / "server" / "room-ships.mjs").read_text()
        for name in ("hullCollisionKeel", "hullCollisionLayers"):
            self.assertIn(f"export function {name}(", spec)
            self.assertNotIn(f"function {name}(", hulls)
            self.assertIn(name, ships)


if __name__ == "__main__":
    unittest.main()
