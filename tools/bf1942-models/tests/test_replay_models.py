"""`viewer/replay.js` and its modules under node: the replayed-aircraft
propeller law, the recording's players, kits, seats and deaths, and the
kinematics a replayed hull is presented from.

One node run (`replay_harness.mjs`), many assertions. The harness imports the
viewer's modules in place through `sim/env.mjs`'s hooks, so the files under
test are the files the page loads.

Why the propeller half exists. A 2026-09-20 defect report read "the planes are
not showing the correct propeller: it's showing both the spinning + idle" --
both of a prop plane's meshes drawn at once, in a round replay, which clones
whole `models/<Template>.glb` files that ship both alternatives visible. The
2026-09-27 rework presents a replayed aircraft through the map's own
`Aircraft` (`presentKinematic`), so the swap is now the flight model's own and
the propeller turns; the idle default still holds until the drive's first
frame.

Why the recording half exists. The 2026-09-27 report: "I spawned as assault,
but the recorder shows me with a zook". The parser gave every soldier the last
kit anyone picked up; each soldier now keeps his own player's kit.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "replay_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayPropellerTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_replayed_propeller_shows_the_idle_blade_never_the_disc(self) -> None:
        # The level's own parked law (map.html's load walk): blade visible,
        # blurred disc hidden. A replay has no throttle to swap on, so the
        # clone gets exactly the state a parked spawner shows.
        state = self.results["corsair"]
        self.assertTrue(state["blade"], "the idle blade must stay visible")
        self.assertFalse(state["disc"], "the blurred disc must be hidden")

    def test_the_bf109_cockpit_named_like_a_propeller_stays_whole(self) -> None:
        # Vanilla's one counter-example to the naming convention: the bf109's
        # *cockpit* LodObject under a DistCompareSelector, with both halves in
        # an already-published tree. Its "blurred" half is the pilot's 1P
        # interior; hiding it strips the cockpit out of every replay.
        state = self.results["bf109CockpitBothHalves"]
        self.assertTrue(state["exterior"], "the fuselage must stay visible")
        self.assertTrue(state["interior"], "the 1P interior must stay visible")

    def test_a_fresh_tree_cockpit_stamp_without_its_interior_is_a_noop(self) -> None:
        # The current exporter excludes the 1P interior, so the stamp names a
        # child that is not there. Walk it without throwing; the fuselage
        # stands.
        state = self.results["bf109CockpitFreshTree"]
        self.assertTrue(state["exterior"])
        self.assertTrue(state["interiorMissing"])

    def test_a_wrapper_without_a_stamp_is_untouched(self) -> None:
        # The kind gate, pointed the other way: nothing names this LodObject a
        # propeller, so nothing may hide either half of it.
        state = self.results["unstampedPair"]
        self.assertTrue(state["blade"])
        self.assertTrue(state["disc"])

    def test_every_stamped_wrapper_on_a_multiengine_airframe_is_walked(self) -> None:
        # The B17 ships four propellers; the walk covers each wrapper, not
        # just the first the traverse meets.
        for engine, state in enumerate(self.results["b17AllFour"]):
            self.assertTrue(state["blade"], f"engine {engine}: blade visible")
            self.assertFalse(state["disc"], f"engine {engine}: disc hidden")

    def test_the_model_loader_actually_applies_the_walk(self) -> None:
        # The harness proves the law; this pins the call site, so the loader
        # cannot silently stop calling it. (The loader path itself needs a
        # browser — `model()` fetches a glb — so the source is the contract.)
        source = (VIEWER / "replay-assets.js").read_text()
        self.assertIn("setReplayPropellerIdle(gltf.scene)", source)


    def test_a_replayed_aircraft_runs_the_flown_propeller_law(self) -> None:
        # Parked with nobody aboard and the engine off: the idle blade, still,
        # gear down. Under power 300 m up: the disc past the 0.07 swap, the
        # propeller turned, the gear away -- the flight model's own
        # presentation of a recorded pose.
        flown = self.results["flownPropeller"]
        self.assertEqual(flown["parked"], {"blade": True, "disc": False, "gear": 0, "turned": 0})
        self.assertFalse(flown["flying"]["blade"])
        self.assertTrue(flown["flying"]["disc"])
        self.assertEqual(flown["flying"]["gear"], 1)
        self.assertGreater(flown["flying"]["throttle"], 0.07)
        self.assertGreater(flown["flying"]["turned"], 0)
        self.assertTrue(flown["flying"]["wrapperTurned"])
        self.assertEqual(flown["placed"], {"x": 0, "y": 300})

    def test_a_parked_propeller_is_still_until_its_engine_starts(self) -> None:
        # The 2026-09-27 report: Midway's parked planes turned their propellers
        # over slowly. The recorded engine is off for five seconds, then runs
        # at zero revs: still, then the 2 rev/s idle (720 degrees a second).
        recorded = self.results["parkedPropeller"]["recorded"]
        self.assertEqual(recorded["kind"], "air")
        off = [a for a in recorded["angles"] if a["t"] < 5]
        on = [a for a in recorded["angles"] if a["t"] > 5]
        self.assertEqual([(a["angle"], a["rate"]) for a in off], [(0, 0), (0, 0)])
        self.assertAlmostEqual(on[-1]["rate"], 720, delta=5)
        self.assertGreater(on[-1]["angle"], on[0]["angle"])
        self.assertTrue(recorded["bladeTurned"])
        # No engine records and nobody in the root seat: still throughout.
        unrecorded = self.results["parkedPropeller"]["unrecorded"]
        self.assertEqual({(a["angle"], a["rate"]) for a in unrecorded["angles"]}, {(0, 0)})
        self.assertFalse(unrecorded["bladeTurned"])
        # Out of range with its engine last seen running at half revs: not
        # being updated, so met there after a seek it holds still.
        ghost = self.results["parkedPropeller"]["outOfRange"]
        self.assertEqual({(a["angle"], a["rate"]) for a in ghost["angles"]}, {(0, 0)})
        self.assertFalse(ghost["bladeTurned"])


class ReplayRecordingTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_each_soldier_keeps_his_own_kit(self) -> None:
        # The report: spawned as assault, drawn with a bazooka. The recording
        # player picked up UsMarine_Assault; a bot carried UsMarine_AT from the
        # join. Each keeps his own.
        rec = self.results["recording"]
        self.assertEqual(rec["mine"], {"pid": 0, "kit": "UsMarine_Assault", "weapon": "Bar1918"})
        self.assertEqual(rec["bot"]["kit"], "UsMarine_AT")
        self.assertEqual(rec["bot"]["weapon"], "Bazooka")
        self.assertEqual(rec["fallback"], {"mine": "Bar1918", "bot": "Bazooka"})
        self.assertEqual(rec["fire"], [{"t": 8, "soldier": True, "kit": "UsMarine_Assault"}])

    def test_a_seat_id_resolves_to_its_hull(self) -> None:
        # A hull's nested PlayerControlObjects take the ids after its own: the
        # Sherman at 532 has its hull gun at 533.
        rec = self.results["recording"]
        self.assertEqual(rec["seat"], {"root": "Sherman", "seat": 1})
        self.assertEqual(rec["crewAt7"], [{"pid": 250, "seat": 1}])
        self.assertEqual(rec["crewAt10"], [])

    def test_a_death_is_the_score_streams(self) -> None:
        rec = self.results["recording"]
        self.assertEqual(rec["bot"]["diedAt"], 12)
        self.assertEqual(rec["bot"]["killer"], 0)
        self.assertEqual(rec["controlledAt13"], 700)

    def test_round_end_tallies_decode_from_raw(self) -> None:
        self.assertEqual(self.results["recording"]["stats"], [{"pid": 0, "fired": [[1231, 31]]}])

    def test_a_pools_rounds_are_rounds_whatever_their_name(self) -> None:
        # The Midway report: an Elco80's pool of five `FloatingMine` was read
        # as five hulls, and each asked for a `FloatingMine.glb` no tree has.
        r = self.results["hullRounds"]
        self.assertEqual(
            [{"nid": nid, "pooled": True, "projectile": True} for nid in range(1519, 1524)]
            + [{"nid": 1600, "pooled": False, "projectile": True}],
            r["mines"])

    def test_the_levels_projectile_table_names_the_rest(self) -> None:
        # A depth charge no pool of the recording made is a hull to the
        # parser, and a round once the level's table (replay.js) says so.
        r = self.results["hullRounds"]
        self.assertEqual(r["hullsParsed"], ["Elco80", "DepthCharge"])
        self.assertEqual(r["marked"], 1)
        self.assertEqual(r["hullsMarked"], ["Elco80"])

    def test_a_mine_is_drawn_from_its_launcher_on_the_recordings_hull(self) -> None:
        # The mine lying in the water is the Elco80's `FloatingMineLauncher`
        # round, not the first projectile mesh on the boat (its torpedo), and
        # nothing is fetched for it: only the grenade's own weapon is.
        r = self.results["hullRounds"]
        self.assertEqual(r["torpedo"], "Elco80_Torpedos projectile")
        self.assertEqual(r["placed"], 2)
        self.assertEqual(r["requested"], ["models/GrenadeAllies.glb"])
        self.assertEqual(r["props"], [
            {"tmpl": "GrenadeAlliesProjectile", "nid": 1075, "mesh": "GrenadeAlliesProjectile",
             "endEffect": "e_ExplGranade", "at": [0, 0, 0]},
            {"tmpl": "FloatingMine", "nid": 1600, "mesh": "FloatingMineLauncherDummy",
             "endEffect": "e_ExplMine", "at": [0, 0, 0]},
        ])

    def test_a_round_named_after_no_weapon_fetches_nothing(self) -> None:
        self.assertEqual(self.results["hullRounds"]["weapons"], ["GrenadeAllies", None, None])

    def test_the_replays_rounds_pass_the_levels_hidden_vehicles(self) -> None:
        c = self.results["replayCollision"]
        # Nothing to do before the level's collider exists; then the baked
        # Defgun (no deck) leaves the rounds' way, the carrier (its deck is a
        # parked plane's ground) and the bunker (a static) stay; once per
        # collider, and again for a new one; the replayed hulls' cast is on.
        self.assertEqual((c["before"], c["taken"], c["again"], c["retaken"]), (0, 1, 0, 1))
        self.assertEqual(c["disabled"], [0])
        self.assertTrue(c["castInstalled"])

    def test_the_hit_indicator_decodes_named_and_raw(self) -> None:
        # HitFromPosEvent (0x3C): the sector the damage came from and its
        # strength, 255 x the damage over the victim's maximum hit points.
        self.assertEqual(self.results["v4Hits"], [{"t": 275.203, "dir": 2, "strength": 191}])
        self.assertEqual(self.results["v5"]["hits"], [{"t": 8, "dir": 4, "strength": 15}])
        self.assertEqual(self.results["v5"]["hitRow"], "hit from behind, 6% of full health")

    def test_the_round_starts_only_after_a_pregame(self) -> None:
        r = self.results["round"]
        self.assertEqual(r["roundStarted"], 10)
        # A join mid-round is sent PLAYING straight away: no start, no estimate.
        self.assertIsNone(r["midRoundStarted"])
        self.assertIsNone(r["midRoundEstimate"])

    def test_recorded_points_find_the_levels_by_template_whatever_the_case(self) -> None:
        self.assertEqual(self.results["round"]["matched"][0], [100, "The_beach"])

    def test_the_estimate_runs_the_pages_own_round(self) -> None:
        r = self.results["round"]
        # 100 a side at 32 slots is 200; before the start the counter shows it.
        self.assertEqual(r["at9"], [200, 200])
        # 21 s in: the Allies hold exactly 100, so the Axis bleed one every
        # 60 / (15 x 32/16) = 2 s (ten, at 12..30) and lose their two deaths;
        # the Allies lose their one.
        self.assertEqual(r["at31"], [188, 199])

    def test_recorded_tickets_are_a_step_function(self) -> None:
        # Joined mid-round, the client counts 0 a side until the server's
        # first count: that is no count, and the first real one shows from
        # the start (at 2 s, before it).
        self.assertEqual(self.results["round"]["recorded"], [[140, 190], [140, 190], [139, 190]])

    def test_the_servers_slot_count(self) -> None:
        self.assertEqual(self.results["round"]["slots"], [32, 32, 16])

    def test_a_v4_files_parts_are_not_used(self) -> None:
        # The v4 recorder keyed every part 0 (a child networkable has no id),
        # so its parts cannot be told apart.
        self.assertEqual(self.results["v4Joints"], 0)

    def test_v5_records(self) -> None:
        v5 = self.results["v5"]
        self.assertEqual(v5["seat"], {"root": "Sherman", "seat": 1})
        self.assertEqual(v5["crew"], [{"pid": 251, "seat": 1}])
        self.assertEqual(v5["pooled"], ["GrenadeAlliesProjectile#1075", "GrenadeAlliesProjectile#1076",
                                        "GrenadeAlliesProjectile#1077"])
        self.assertAlmostEqual(v5["clock"], 289.5)
        self.assertEqual(v5["stats"], [{"tid": 1941, "tmpl": "AichiVal", "n": 3}])
        self.assertEqual(v5["shot"], [{"nid": 532, "weapon": "ShermanCannon", "kind": 1}])
        # The engine: the PhysicsEngine's revs, running and not.
        self.assertEqual(v5["engine"][0], {"revs": 0.8, "running": True, "disabled": False})
        self.assertEqual(v5["engine"][1], {"revs": 0.1, "running": False, "disabled": False})
        # A turret's rotation against its hull, by the part's template name,
        # with where it sits on the hull in the viewer's frame (z negated).
        self.assertEqual(v5["joint"], {"name": "ShermanTower", "q": [0, 0.7071, 0, 0.7071],
                                       "pos": [0.1, 1.8, -0.5], "since": 6})
        # A soldier's body through the engine's own state table: crouched
        # and firing, then lying and holding his fourth item.
        crouched, lying = v5["body"]
        self.assertEqual((crouched["stance"], crouched["firing"], crouched["item"]), ("crouch", True, 2))
        self.assertEqual(crouched["pitch"], -12.5)
        self.assertEqual((lying["stance"], lying["firing"], lying["item"]), ("prone", False, 3))


class ReplayKinematicsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["kinematics"]

    def test_motion_is_read_in_the_viewers_frame(self) -> None:
        # 10 m/s along BF1942's +Z is the viewer's -Z; a left turn is +Y.
        self.assertEqual(self.results["velocity"], [0, 0, -10])
        self.assertAlmostEqual(self.results["yawRate"], 0.5, places=3)
        self.assertGreater(self.results["forward"], 0)

    def test_the_stick_follows_the_games_signs(self) -> None:
        # c_PIPitch positive is nose DOWN, c_PIYaw positive is right,
        # c_PIRoll positive is right wing down (controls-rows.js).
        self.assertEqual(self.results["stickNoseUp"], {"pitch": -0.5, "roll": 0, "yaw": 0})
        self.assertEqual(self.results["stickLeft"], {"pitch": 0, "roll": 0, "yaw": -0.5})
        self.assertEqual(self.results["stickRightWingDown"], {"pitch": 0, "roll": 0.5, "yaw": 0})
        self.assertLess(self.results["steerLeft"], 0)

    def test_the_gearbox_shifts_on_the_engines_own_thresholds(self) -> None:
        gears = [row["gear"] for row in self.results["revs"]]
        self.assertEqual(gears, sorted(gears[:4]) + gears[4:])
        self.assertEqual(gears[0], 1)
        self.assertEqual(gears[3], 4)
        self.assertEqual(gears[-1], 1)
        for row in self.results["revs"]:
            self.assertLessEqual(row["revs"], 1.2)

    def test_same_named_parts_take_the_node_where_they_sit(self) -> None:
        self.assertEqual(self.results["matchPlaced"], {"11": 2, "12": 1, "13": 0})
        # A placed part first; an unplaced one takes the next free node.
        self.assertEqual(self.results["matchMixed"], {"31": 1, "32": 0})

    def test_unplaced_parts_take_the_names_nodes_in_model_order(self) -> None:
        # One node each; a part with no node of its name, or none left, is out.
        self.assertEqual(self.results["matchUnplaced"], {"21": 0, "22": 1, "23": 3})

    def test_the_throttle_is_shut_without_a_crew(self) -> None:
        self.assertEqual(self.results["throttleEmpty"], 0)
        self.assertEqual(self.results["throttleParked"], 0)
        self.assertGreater(self.results["throttleFlying"], 0.5)


class ReplayUxTests(unittest.TestCase):
    """The viewing experience (features/round-replay-ux): the round's
    chapters and kill lines, the players' states and tallies, the page's
    message log driven from the recording, and the camera's three modes."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_kill_log_lines(self) -> None:
        ux = self.results["ux"]
        # A kill with its weapon; a team kill (6, then its victim's 4: one
        # death, one line pair); a death nobody caused (4 alone). The kill's
        # victim's own 5 prints nothing.
        self.assertEqual(ux["kills"], [[10, "kill", 1, 2, "Type99"], [20, "teamkill", 2, 0, None],
                                       [30, "death", None, 1, None]])
        # The server's own log names the team kill's weapon a v3 file lacks.
        self.assertEqual(ux["filled"], ["Type99", "Thompson", None])

    def test_a_flag_is_taken_through_neutral(self) -> None:
        # 2 at the opening, 0 as it comes down, 1 as the attackers raise
        # theirs: taken by Axis. The opening -1 to 2 is not a capture.
        ux = self.results["ux"]
        self.assertEqual(ux["captures"], [[50, "Landing_Beach", 1, 0], [60, "Village", 1, 0]])
        self.assertEqual(ux["flagRows"], ["Landing_Beach taken by Axis", "Village taken by Axis"])
        self.assertEqual(ux["pointsAt61"], [["Landing_Beach", 1], ["Village", 1]])

    def test_round_and_players(self) -> None:
        ux = self.results["ux"]
        self.assertEqual(ux["roundStarted"], 2)
        self.assertEqual(ux["leftT"], 70)
        self.assertEqual(ux["recordingPlayer"], 0)
        self.assertEqual(ux["roster"], ["Axe", "Bea", "rec"])
        self.assertEqual(ux["status"], [["foot", None], ["dead", "teamkill"], ["left", None], ["absent", None]])
        # A team kill is no kill; every death is a death.
        self.assertEqual(ux["tally"], {"0": [0, 1], "1": [1, 1], "2": [0, 1]})

    def test_chapters_in_the_games_words(self) -> None:
        ux = self.results["ux"]
        self.assertEqual(ux["chapters"], [[2, "round-start", 0], [3, "spawn", 1], [10, "kill", 3],
                                          [20, "teamkill", 3], [30, "death", 3], [35, "vehicle", 3],
                                          [50, "capture", 6], [60, "capture", 6], [80, "round-end", 3]])
        self.assertEqual(ux["texts"][1], "rec spawned at Landing Beach")
        self.assertEqual(ux["texts"][2], "Axe [Type 99] Bea")
        self.assertEqual(ux["texts"][3], "Bea killed a teammate: rec")
        self.assertEqual(ux["texts"][4], "Axe is no more")
        self.assertEqual(ux["texts"][5], "Sherman destroyed by Axe")
        self.assertEqual(ux["texts"][6], "[Landing Beach] Axis captured the control point")

    def test_next_and_previous_event(self) -> None:
        # A jump lands a chapter's lead before its moment; "previous" skips
        # the one the playhead is just past; the followed player's alone.
        ux = self.results["ux"]
        self.assertEqual(ux["next"], ["round-start", "kill", "teamkill"])
        self.assertEqual(ux["prev"], "kill")
        # His first chapter is his spawn at 3 s.
        self.assertEqual(ux["nextOwn"], "spawn")
        self.assertEqual(ux["feed"], [[10, "kill"], [20, "kill"], [30, "kill"], [45, "chat"],
                                      [50, "capture"], [60, "capture"]])

    def test_when_he_spawns(self) -> None:
        # The 2026-09-27 request: the card counts down to the recording
        # player's spawn and the timeline marks it. A spawn is the moment a
        # player takes control of a new soldier, even one seen only later;
        # a soldier he was already in when the recording found him is none.
        spawns = self.results["spawns"]
        self.assertEqual(spawns["rec"], [8.5, 32])
        self.assertEqual(spawns["far"], [10])
        self.assertEqual((spawns["here"], spawns["late"]), ([], []))
        # The countdown's target: the next spawn after the moment, none after
        # the last.
        self.assertEqual(spawns["next"], [8.5, 32, 32, None])
        # Spawned out of the recording's range: in the round, not waiting.
        self.assertEqual(spawns["farNext"], [10, None, None])
        self.assertEqual(spawns["status"], ["spawning", "dead"])
        # The timeline: the recording player's spawns alone, a second before
        # each, named for the flag they were at; his own marks when followed.
        self.assertEqual(spawns["chapters"], [[8.5, 1, 0, "Airfield"], [32, 1, 0, None]])
        self.assertEqual(spawns["texts"], ["rec spawned at Airfield", "rec spawned"])
        self.assertEqual(spawns["mine"], [True, False])
        self.assertEqual(spawns["marks"], [{"glyph": "spawn", "cls": "spawn mine"},
                                           {"glyph": "spawn", "cls": "spawn"}])
        self.assertEqual(spawns["nextOwn"], "spawn")
        # While he waits the orbit is over where he will appear, framed as it
        # will frame him there, so the spawn itself moves nothing; his body
        # while it lies; then his next spawn's place.
        cam = spawns["camera"]
        self.assertEqual(cam["waiting"], {"kind": "spawn", "nid": 600, "point": [120, 1.2, -90]})
        self.assertEqual(cam["spawned"], {"kind": "soldier", "nid": 600, "point": [120, 1.2, -90]})
        self.assertEqual(cam["body"]["kind"], "body")
        self.assertEqual(cam["gone"], {"kind": "spawn", "nid": 610, "point": [1500, 1.2, -1500]})
        # First person on a spectator camera the game has not placed (the
        # world's origin) is the orbit over his spawn; placed, it is his view.
        self.assertEqual(cam["povUnplaced"], {"hides": None, "fromSpawn": 6})
        self.assertEqual(cam["povPlaced"], [100, 60, -100])

    def test_the_page_message_log_follows_the_recording(self) -> None:
        feed = self.results["uxFeed"]
        # The radio strip goes; the log starts empty.
        self.assertEqual(feed["opened"], [["radio", False], ["clear"]])
        # Played across: the kill line, the centre message for the followed
        # victim (`local`).
        self.assertEqual(feed["forward"], [["clear"], ["kill", "Bea", "Axe", "Type99", True]])
        # The hit wash only in his own first person: sector 2 is octant 3,
        # alpha 64/255.
        self.assertEqual(feed["noWash"], 0)
        self.assertEqual(feed["washed"], [[3, 0.251]])
        # A seek rebuilds the log in order with its timers stepped between
        # lines, and no stale centre message.
        self.assertEqual(feed["rebuilt"], [["clear"], ["kill", "Bea", "Axe", "Type99", False],
                                           ["kill", "rec", "Bea", "Thompson", False], ["kill", "Axe", None, None, False],
                                           ["chat", "Axe: hello", 1], ["capture", "Landing_Beach", 1, False]])
        self.assertEqual(feed["rebuiltTicks"], 52)

    def test_the_camera_modes(self) -> None:
        cam = self.results["uxCamera"]
        # The orbit: 6 m out at zoom 1, behind him; W closes to the nearest,
        # the wheel opens to the farthest; D turns round him.
        self.assertEqual(cam["orbit"], {"distance": 6, "behind": True})
        self.assertAlmostEqual(cam["zoomedIn"], 1.5, delta=0.05)
        self.assertEqual(cam["zoomedOut"], 150)
        self.assertAlmostEqual(cam["orbited"], 0.9, places=3)
        # First person: his standing eye, his heading, the soldier's lens,
        # his own body hidden.
        pov = cam["pov"]
        self.assertEqual(pov["eye"], [10, 1.65, -20])
        self.assertEqual(pov["look"], [0, 0, -1])
        self.assertEqual((pov["fov"], pov["near"], pov["hides"]), (57.3, 0.2, 0))
        # Free: W flies along the view at 30 m/s, with the page's own lens.
        self.assertEqual(cam["free"], {"moved": 30, "along": 1, "fov": 60})
        # A touch screen's thumbstick: pushed all the way it flies ahead at
        # twice the keys' speed, half way a quarter of that (the square of
        # the push), and to the side it strafes. A pinch apart by e flies
        # ahead as six wheel steps would.
        self.assertEqual(cam["stick"], {"full": 60, "along": 1, "half": 15, "side": 60, "sideAlong": 1})
        self.assertEqual(cam["pinchFree"], {"moved": 24, "along": 1})
        # Dead: no eyes to look through, nothing hidden.
        self.assertIsNone(cam["deadPov"])

    def test_the_followed_body_is_drawn_from_every_side_of_the_orbit(self) -> None:
        # The 2026-09-27 report: the followed player vanished at some angles
        # of the orbit and came back as the camera went round him. The bots'
        # renderer culls each body against the camera as it stands when it
        # draws him; the replay drew its bodies before placing its camera, so
        # the cull read the page's free camera, re-aimed down -Z first, and
        # culled him from 9 of 16 angles.
        cull = self.results["replayCull"]
        self.assertTrue(cull["drawn"], "the renderer must have a body for him")
        self.assertEqual(cull["culled"], [], "no angle of the orbit may cull the man at its centre")
        # And the page's free camera leaves a replay's camera alone.
        self.assertEqual(cull["underReplay"], [])
        self.assertEqual(cull["withoutReplay"], ["fly", "look"])

    def test_the_camera_looks_where_a_soldier_looks(self) -> None:
        # The 2026-09-27 report: first person on foot looked out of the back
        # of his head. He runs along +X facing it: first person looks along
        # his run, the orbit starts behind him, and R puts it back there.
        view = self.results["soldierView"]
        self.assertEqual(view["pov"], [1, 0, 0])
        self.assertEqual(view["orbit"], [-1, 0])
        self.assertEqual(view["reset"], [-1, 0])


class ReplaySoldierFeetTests(unittest.TestCase):
    """A replayed soldier stands on the ground.

    The 2026-09-27 report: in `replay_20260927-075756` the recording player
    ran about a metre above the ground. Every soldier did, bots included. A
    soldier's sample is his engine origin, which the soldier template's
    `setCharacterHeight -1.00` puts a metre over his feet: the recording
    player's live samples in that round lie 1.00 m (median) over Wake's
    terrain, and 25 bots' the same, and his shots leave his camera 0.65, 0.12
    and -0.70 m over them standing, crouched and prone (`setPoseCameraPos`).
    The body renderer, the plain fallback and the camera stand a man on his
    feet.
    """

    results: dict
    rings: dict

    @classmethod
    def setUpClass(cls) -> None:
        harness = run_harness()
        cls.results = harness["feet"]
        cls.rings = harness["serverRings"]

    def test_every_soldier_runs_on_the_ground(self) -> None:
        # Sampled a metre up; drawn on the ground at y = 0, the recording
        # player and the bot alike, before his first sample and after.
        self.assertEqual(self.results["bot"], [0, 0, 0, 0, 0])
        self.assertEqual(self.results["mine"], [0, 0, 0, 0, 0])

    def test_the_bodies_are_handed_his_feet(self) -> None:
        # What the page's renderer (bot-visuals.js) stands the body on, and
        # the plain soldier's group.
        for drawn in self.results["drawn"]:
            self.assertEqual(drawn, {"Fred Bailey": 0, "skandia": 0})
        self.assertEqual(self.results["fallback"], [0, 0])

    def test_the_spawn_point_and_a_hull_keep_their_heights(self) -> None:
        # The creation event is the spawn point, already on the ground; a
        # hull's sample is its own origin.
        self.assertEqual(self.results["spawn"], {"bot": 0, "mine": 0})
        self.assertEqual(self.results["jeep"], 1.2)

    def test_the_camera_sees_from_his_eyes(self) -> None:
        # First person at the engine's eye over his feet, standing and
        # crouched; the orbit circles 1.2 m over his feet.
        self.assertEqual(self.results["eye"], {"standing": 1.65, "crouched": 1.12})
        self.assertEqual(self.results["orbit"], 1.2)

    def test_a_server_log_ring_lies_on_the_ground(self) -> None:
        # The server's log places a live player at his origin, a metre over
        # his feet: his ring lies on the ground under him. A spawn is on the
        # ground already, a pilot keeps his height, a hull its own origin.
        self.assertEqual(self.rings["atPlayer"], [True, True, True, False])
        self.assertEqual(self.rings["y"], [0, 0, 150, 1.5])


class ReplayGunAimTests(unittest.TestCase):
    """A manned gun laid where the recording says it pointed.

    The report (2026-09-27, `replay_20260927-075756`, a v4 file): "in the
    defgun I can see the rounds impacting at the correct location, but the
    defgun points to a random spot". The rounds flew their recorded rays and
    nothing turned the gun, so it sat at the rig's rest: 90 degrees off the
    Defgun's rounds there, 33 off the AA gun's. A Defgun hull (its own
    turret and gun base, their limits) is replayed from a v4 file's parts,
    from its rounds alone, and from a v5 file's parts; the harness measures
    the drawn barrel against where the gun was laid, in degrees."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["gunAim"]

    def test_a_v4_files_parts_decode_per_hull(self) -> None:
        # Every part keyed 0, and one left out whenever it equals the entry
        # written before it (the turret back at rest at 1.1, equal to the
        # Defgun ahead of it; the gun base level at 1.3, equal to its
        # turret). The order and the rule put every entry back on its part.
        # Still never put on nodes by key.
        decoded = self.results["decoded"]
        self.assertEqual(decoded["joints"], 0)
        self.assertEqual([run[1] for run in decoded["runs"]], [2, 1, 2, 1, 2, 2])
        expected = self.results["expected"]
        self.assertEqual(decoded["tracks"], [expected["turret"], expected["base"]])

    def test_the_gun_follows_its_decoded_part(self) -> None:
        # The gun base's part carries the gun's own rounds, so it lays the
        # gun at every sample: on each round, between them (raised at 1.0,
        # level at 1.3), held after; at rest before the first part.
        parts = self.results["parts"]
        self.assertEqual(parts["source"], ["parts"])
        for off in [*parts["atRounds"], *parts["between"], parts["held"], parts["beforeParts"]]:
            self.assertLess(off, 0.5)

    def test_its_rounds_alone_lay_the_gun(self) -> None:
        # Without parts: on every round exactly; at rest until the gun must
        # move, then raised at the gun base's own 50 deg/s; held; turned as
        # late as the next round allows, faster than the turret's own 90
        # deg/s where the rounds say so; never past the 30-degree elevation
        # limit (a round laid 50 up); held after the last. Traverse, then
        # elevation, in the rig's degrees (up is negative).
        rounds = self.results["rounds"]
        self.assertEqual(rounds["source"], ["rounds"])
        for off in rounds["atRounds"]:
            self.assertLess(off, 0.5)
        expected = {"rest": [0, 0], "laying": [0, -5], "turning": [40, -10], "held": [60, -5],
                    "overLimit": [-20, -30], "after": [-20, -30]}
        for key, want in expected.items():
            for got, angle in zip(rounds[key], want):
                self.assertAlmostEqual(got, angle, delta=0.1, msg=key)

    def test_a_v5_files_parts_win_over_its_rounds(self) -> None:
        v5 = self.results["v5"]
        self.assertLess(v5["toParts"], 0.5)
        self.assertGreater(v5["toRound"], 45)

    def test_a_v5_part_eases_between_its_samples(self) -> None:
        # A traverse from -40 to 40 degrees between two samples 0.1 s apart:
        # halfway there at 1.05 s, as the hull's own pose eases. Held, it sat
        # at -40, 39 degrees off, and stepped at the next sample.
        for off in self.results["v5"]["swing"]:
            self.assertLess(off, 0.5)

    def test_a_late_turn(self) -> None:
        # 0 to 40 degrees by t=1 at 90 deg/s: still at 0 at t=0, 22 at 0.8;
        # from a round at 0.9 it must go faster, 20 at 0.95; a free axis
        # takes the short way from 170 to -170.
        self.assertEqual(self.results["lateTurn"], [0, 22, 20, -179])


class ReplayKurskRoundTests(unittest.TestCase):
    """The owner's report on a public Kursk round, `replay_20260927-140921`.

    - A medic killed with his Mp18 at 112.9 s was drawn with a bazooka, the AT
      kit he had died in, until a seek put the Mp18 back: his old body, built
      in the old kit, outlived the stretch with nothing of him to draw and was
      kept for the new life.
    - An engineer repairing never turned his wrench: a wrench fires no round,
      so nothing started the torso's fire, although the recording has the
      engine's `Ub_FireRepairPack` state. Found beside it: no reload ever
      played (a magazine change is only a torso state too), and every death
      was the renderer's guess although the recording names the engine's.
    - A Stuka's bomb drop was one bomb falling nose-down from a standstill:
      both barrels of the rack left from one recorded point, and a replayed
      hull's rounds had no platform velocity, which is all a `velocity 0`
      release has.
    - (From the gun-aim work beside it.) One destroyer round flashed every
      mount of that name.
    - Checking the bombs in the page: the page advanced its rounds and its
      effects on its own clock, so a paused replay's bombs fell and burst,
      and at 4x they fell at a quarter of the round's speed.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        harness = run_harness()
        cls.results = {"soldiers": harness["respawnKit"], "rack": harness["bombRack"]}
        cls.clock = harness["replayClock"]
        cls.out_of_range = harness["outOfRange"]

    def test_a_respawn_draws_his_new_kit_without_a_seek(self) -> None:
        kit = self.results["soldiers"]["kit"]
        self.assertEqual(kit["5"], {"body": "Rus_AT", "primary": "Bazooka"})
        self.assertEqual(kit["16"], {"body": "Rus_Medic", "primary": "Mp18"})

    def test_a_wrench_turns_while_the_recording_says_he_repairs(self) -> None:
        # Held from 3.0 to 5.1 s on a one-second one-shot: three fires, each
        # started as the last ran out, and none after the trigger let go.
        soldiers = self.results["soldiers"]
        self.assertEqual(soldiers["engineer"], "RepairPack")
        self.assertEqual(soldiers["fires"], [3, 4, 5])
        # A weapon whose rounds the recording writes fires on its rounds.
        self.assertEqual(soldiers["recordsRounds"], {"Mp18": True, "RepairPack": False})

    def test_a_recorded_reload_plays_once(self) -> None:
        # The torso's reload state from 6.0 to 8.2 s: one magazine change,
        # started as the recording enters it and not again while it holds.
        self.assertEqual(self.results["soldiers"]["reloads"], [6])

    def test_a_death_plays_the_die_state_the_engine_chose(self) -> None:
        # His body's record 0.07 s after the kill is `Lb_DieHead`: the head
        # shot the engine picked, where the renderer would have guessed.
        soldiers = self.results["soldiers"]
        self.assertEqual(soldiers["recordedDeath"], "Lb_DieHead")
        self.assertEqual(soldiers["kills"], [{"pid": 24, "family": "dieHead"}])

    def test_a_rack_drops_a_bomb_from_each_barrel_at_the_planes_speed(self) -> None:
        dropped = self.results["rack"]["dropped"]
        self.assertEqual([d["at"] for d in dropped], [[3.3, 99.8, -240], [-3.3, 99.8, -240]])
        for bomb in dropped:
            self.assertEqual(bomb["v"], [0, 0, -60])
            self.assertEqual(bomb["nose"], [0, 0, -1])

    def test_a_falling_bomb_noses_down_its_path_not_the_ground(self) -> None:
        # A second after release, 60 m/s forward and 14.7 m/s down: about 14
        # degrees nose down, where a bomb dropped from a standstill points
        # straight at the ground.
        for nose in self.results["rack"]["afterOneSecond"]:
            self.assertEqual(nose, [0, -0.24, -0.97])

    def test_one_round_fires_one_mount(self) -> None:
        # Left from the mount 30 m aft; out of its own muzzle, 4 m ahead.
        self.assertEqual(self.results["rack"]["mounts"], [[500, 5, -474]])

    def test_the_card_says_when_the_recording_lost_sight_of_him(self) -> None:
        # The yellow shells are the objects beyond the recording player's
        # view distance, held at their last pose. In range, no note; out of
        # range, the time he went; back again, no note.
        self.assertEqual(self.out_of_range,
                         [["vehicle", None], ["vehicle", 10], ["vehicle", None], ["foot", 8]])

    def test_the_rounds_keep_the_replays_clock(self) -> None:
        # Paused, a bomb in the air holds its height; the replay hands the
        # page's guns and effects its playback rate (4x, then 0 paused) and
        # gives the page its own clock back when it closes.
        self.assertEqual(self.clock, [0, [4, 4], [0, 0], [1, 1]])



class ReplaySwimmerTests(unittest.TestCase):
    """A replayed soldier in the water swims.

    He was drawn walking on the seabed: the replay's stand-in soldier gave the
    body renderer no swim state. A v4 file records the lower state his body
    entered; a v3 file has none, and there the engine's own test on his origin
    decides (swim.js `BFSoldier::updateSwimming`): a swimmer's origin is pinned
    0.4 m under the surface, a wader's is a metre over the seabed.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["swim"]

    def test_a_v3_swimmer_is_told_by_his_depth(self) -> None:
        # Forward along his heading, afloat, wading 1.2 m deep, on the beach.
        self.assertEqual(self.results["v3"], ["Lb_SwimForward", "Lb_Floating", None, None])
        self.assertEqual(self.results["swimming"], [True, True, False, False])

    def test_a_v4_swimmer_plays_his_recorded_state(self) -> None:
        self.assertEqual(self.results["v4"], "Lb_SwimBackward")

    def test_a_man_who_dies_in_the_water_takes_the_swim_death(self) -> None:
        self.assertEqual(self.results["v4Death"], "Lb_DieSwim")
        self.assertIsNone(self.results["dryDeath"])


class ReplayKnockbackAndParachuteTests(unittest.TestCase):
    """A replayed man blown off his feet, and a pilot who bails out.

    A blast throws a soldier into the engine's explosion states, living or
    dead (`knockback.js`: `BFSoldier::handleUpdate` enters the flight,
    `handleCollision` the landing), and a bail-out is the parachute's states;
    the body renderer drew neither. A v5 file records both halves' states and
    the state bits (`0x10`, the chute open, `setIsParachuting` `0x08276f90`).
    The renderer now holds the legs in the recorded whole-body state, entered
    by name as the swim states are, the torso too where the state has one of
    its own; the weapon is stowed where the lower state declares
    `c_AsmHideWeapon`; the canopy is out while the chute is. A dead man's body
    keeps flying, or riding his canopy down, until the recording lands it; the
    corpse is left where it came to rest.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["knockback"]

    def names(self, pid: int, half: str) -> list[str]:
        return [name for name, _t in self.results[half][str(pid)]]

    def entered_at(self, pid: int, half: str, name: str) -> float:
        return next(t for n, t in self.results[half][str(pid)] if n == name)

    def test_a_thrown_man_flies_and_lands_in_his_recorded_states(self) -> None:
        # No run between: the flight is on the record a sample after his body
        # left the ground (6.0), and is taken from there.
        self.assertEqual(self.names(51, "lower"),
                         ["stand.lower", "Lb_ExplosionForward", "Lb_ExplosionLandFront"])
        self.assertEqual(6.0, self.entered_at(51, "lower", "Lb_ExplosionForward"))
        at = self.results["sample"]["51@6.3"]
        self.assertEqual({"lower": "Lb_ExplosionForward", "upper": "Ub_HitChestStand"}, at["blast"])
        self.assertEqual("Lb_ExplosionForward", at["held"]["lower"])
        # Every lower explosion state declares `c_AsmHideWeapon`.
        self.assertFalse(at["weapon"])

    def test_a_torso_the_blast_did_not_set_runs_its_own_machine(self) -> None:
        # His torso held a hit, then his aim, while his legs flew: neither is
        # an explosion state, so the torso stays on its own machine until the
        # landing sets both halves.
        self.assertEqual(self.names(51, "upper"), ["stand.upper", "Ub_ExplosionLandFront"])

    def test_a_man_killed_in_the_air_is_drawn_flying_until_he_lands(self) -> None:
        at = self.results["sample"]["51@7.1"]
        self.assertTrue(at["drawn"])
        self.assertAlmostEqual(11.0, at["x"], places=1)
        kills = {k["pid"]: k for k in self.results["kills"]}
        self.assertEqual("explosionLandFront", kills[51]["family"])
        self.assertEqual(7.3, kills[51]["t"])
        # His cry is the blow's, at his death.
        self.assertIn(7.0, self.results["cries"])
        self.assertEqual({"until": 7.3, "landing": "Lb_ExplosionLandFront"},
                         self.results["flight"]["A"])

    def test_nobody_walks_in_the_air(self) -> None:
        steps = self.results["steps"].get("51", [])
        self.assertEqual([], [t for t in steps if 6.1 <= t <= 7.3])

    def test_a_survivor_lands_gets_up_and_goes_on(self) -> None:
        self.assertEqual(self.names(52, "lower"),
                         ["stand.lower", "Lb_ExplosionBackward", "Lb_ExplosionLandBackSurvive",
                          "Lb_ExplosionLandBackSurviveStandUp", "stand.lower"])
        self.assertEqual(self.names(52, "upper"),
                         ["stand.upper", "Ub_ExplosionBackward", "Ub_ExplosionLandBackSurvive",
                          "Ub_ExplosionLandBackSurviveStandUp", "stand.upper"])
        self.assertEqual(10.0, self.results["lower"]["52"][-1][1])
        self.assertFalse(self.results["sample"]["52@8.5"]["weapon"])
        after = self.results["sample"]["52@10.5"]
        self.assertTrue(after["weapon"])
        self.assertIsNone(after["held"])
        self.assertIsNone(after["blast"])
        self.assertNotIn(52, [k["pid"] for k in self.results["kills"]])
        self.assertIsNone(self.results["flight"]["B"])

    def test_a_pilot_who_bails_out_falls_opens_glides_and_lands(self) -> None:
        self.assertEqual(self.names(53, "lower"),
                         ["Lb_ParachuteFall", "Lb_ParachuteOpen", "Lb_ParachuteIdle",
                          "Lb_ParachuteHitGround", "stand.lower"])
        self.assertEqual(7.0, self.entered_at(53, "lower", "Lb_ParachuteOpen"))
        self.assertEqual(8.7, self.entered_at(53, "lower", "Lb_ParachuteIdle"))
        self.assertEqual(11.5, self.results["lower"]["53"][-1][1])
        # The glide has no torso of its own (`Ub_ParachuteOpen`'s
        # `addTransitionWhenDone Ub_StandAim`): he aims, and fires his rifle.
        upper = self.names(53, "upper")
        self.assertEqual(["Ub_ParachuteHitGround", "Ub_ParachuteOpen", "stand.upper", "Ub_Fire"],
                         upper[:4])
        self.assertEqual(9.0, self.entered_at(53, "upper", "Ub_Fire"))
        self.assertIn("Ub_ParachuteHitGround", upper[4:])
        # `c_AsmHideWeapon` on the fall and the opening, not the glide.
        self.assertFalse(self.results["sample"]["53@5.5"]["weapon"])
        self.assertFalse(self.results["sample"]["53@7.5"]["weapon"])
        self.assertTrue(self.results["sample"]["53@9.1"]["weapon"])
        self.assertTrue(self.results["sample"]["53@11.8"]["weapon"])
        self.assertIsNone(self.results["sample"]["53@11.8"]["chute"])

    def test_the_canopy_is_out_while_the_chute_carries_him(self) -> None:
        sample = self.results["sample"]
        self.assertFalse(sample["53@5.5"]["open"])
        self.assertFalse((sample["53@5.5"]["canopy"] or {}).get("visible", False))
        self.assertEqual({"visible": True, "clip": "open", "over": 1.3}, sample["53@7.5"]["canopy"])
        self.assertEqual("idle", sample["53@9.1"]["canopy"]["clip"])
        self.assertTrue(sample["53@9.1"]["canopy"]["visible"])
        # Bit 0x10 drops as he touches down (`Lb_ParachuteHitGround`).
        self.assertFalse(sample["53@11.2"]["open"])
        self.assertFalse(sample["53@11.2"]["canopy"]["visible"])

    def test_a_chute_first_seen_opening_opens_at_once(self) -> None:
        # replay_20260927-075756's nid 775: first on the record already in
        # `Lb_ParachuteOpen`, no fall before it. Each state is entered by
        # name, so the opening and the canopy do not wait for a fall.
        self.assertEqual(["Lb_ParachuteOpen", "Lb_ParachuteIdle", "stand.lower"],
                         self.names(55, "lower"))
        self.assertEqual(["Ub_ParachuteOpen", "stand.upper"], self.names(55, "upper"))
        self.assertEqual(8.5, self.entered_at(55, "lower", "stand.lower"))
        sample = self.results["sample"]
        # The canopy is out on his body's very first frame, the one his legs
        # enter the opening on.
        first = self.entered_at(55, "lower", "Lb_ParachuteOpen")
        self.assertEqual(5.15, first)
        self.assertEqual({"visible": True, "clip": "open", "over": 1.3}, sample["55@5.15"]["canopy"])
        self.assertEqual({"visible": True, "clip": "open", "over": 1.3}, sample["55@5.2"]["canopy"])
        self.assertEqual("open", sample["55@5.5"]["canopy"]["clip"])
        self.assertEqual({"visible": True, "clip": "idle", "over": 1.3}, sample["55@7.5"]["canopy"])
        self.assertFalse(sample["55@9.1"]["canopy"]["visible"])
        self.assertIsNone(sample["55@9.1"]["chute"])

    def test_a_man_killed_under_his_canopy_rides_it_down(self) -> None:
        at = self.results["sample"]["54@8.5"]
        self.assertTrue(at["drawn"])
        self.assertEqual({"lower": "Lb_ParachuteDie", "upper": "Ub_ParachuteDie"}, at["chute"])
        self.assertTrue(at["canopy"]["visible"])
        # A dead man holds no weapon, as no corpse does, though
        # `Lb_ParachuteDie` declares no `c_AsmHideWeapon`.
        self.assertFalse(at["weapon"])
        self.assertTrue(self.results["sample"]["54@9.5"]["drawn"])
        kills = {k["pid"]: k for k in self.results["kills"]}
        self.assertEqual("parachuteDeadLanded", kills[54]["family"])
        self.assertEqual(10.5, kills[54]["t"])
        self.assertEqual(["Lb_ParachuteIdle", "Lb_ParachuteDie", "Lb_ParachuteDeadHitGround"],
                         self.names(54, "lower"))
        self.assertIn(8.0, self.results["cries"])
        self.assertEqual({"until": 10.5, "landing": "Lb_ParachuteDeadHitGround"},
                         self.results["flight"]["D"])

    def test_a_page_bot_falling_out_of_the_sky_takes_the_same_path(self) -> None:
        bot = self.results["pageBot"]
        self.assertEqual("falling", bot["falling"]["state"])
        self.assertEqual({"lower": "Lb_ParachuteFall", "upper": "Ub_ParachuteFall"},
                         bot["falling"]["held"])
        self.assertFalse(bot["falling"]["weapon"])
        self.assertFalse((bot["falling"]["canopy"] or {}).get("visible", False))
        self.assertEqual("open", bot["opening"]["state"])
        self.assertEqual({"visible": True, "clip": "open"}, bot["opening"]["canopy"])
        self.assertEqual(["Lb_ParachuteFall", "Lb_ParachuteOpen"], bot["lower"])


class ReplayMidwayAuditTests(unittest.TestCase):
    """The public-server Midway round (replay_20260927-203459), audited event
    by event: ids reused by the next player to join, a team switch in the
    tick of a kill, a soldier first seen after his player took him, the
    radio, a depot's refills, the server's 0x80-separated lines, the status
    it repeats at every join, a looped gun's report, and the ships a file
    begun after the join never names."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["midway"]

    def test_a_pid_is_whoever_held_it_then(self) -> None:
        self.assertEqual(["3star", "Niconan", "Omen", "Niconan"], self.results["names"])
        self.assertEqual([1, 2], self.results["teams"])
        self.assertEqual(["left", "left"], self.results["left"])
        roster = {pid: (name, team) for pid, name, team in self.results["roster45"]}
        self.assertEqual(("Niconan", 2), roster[4])
        self.assertEqual(("Niconan", 2), roster[11])
        self.assertEqual(8, self.results["recordingPid"])

    def test_a_kill_keeps_the_sides_it_was_scored_on(self) -> None:
        # The owner's 9:58: "Rut appears to kill Niconan but it shows as a team
        # kill". Omen switched to Rut's side in the tick Rut's bazooka killed
        # him, and pid 11 was another man's by the round's end.
        kill = self.results["kill"]
        self.assertEqual((2, 1), (kill["killerTeam"], kill["victimTeam"]))
        self.assertEqual("Rut [Bazooka] Omen", kill["text"])
        self.assertIn([0, 11, 2, 1], self.results["feedKill"])

    def test_the_score_board_forgets_a_leavers_score(self) -> None:
        tally = self.results["tally"]
        self.assertEqual({"kills": 0, "deaths": 1}, tally["omenAt35"])
        self.assertIsNone(tally["niconanAt45"], "the next holder of pid 11 starts clean")
        self.assertEqual({"kills": 0, "deaths": 1}, tally["withoutSessions"])

    def test_chat_names_the_speaker_of_the_day_and_draws_0x80_as_nothing(self) -> None:
        # The game runs MoonGamers' words together (the owner, 2026-09-28).
        self.assertEqual(["3star: :O", "*Donotsteal.", "Niconan: yo"], self.results["chat"])

    def test_a_side_switched_before_the_file_is_the_rosters(self) -> None:
        # The recorder holds a player's createPlayer from the join, with the
        # side joined on; the roster after it has the side held as the file
        # begins, and the replay uses it from the first second.
        held = self.results["heldSwitch"]
        self.assertEqual([2, 2], held["sides"])
        self.assertTrue(held["local"])
        self.assertFalse(held["joinedRow"], "a held createPlayer is no join")

    def test_a_status_the_server_repeats_is_no_row(self) -> None:
        self.assertEqual([], self.results["status"])

    def test_the_radio_and_the_refills_are_read(self) -> None:
        self.assertEqual([{"t": 15, "pid": 0, "msg": 15, "global": True}], self.results["radio"])
        self.assertEqual("Rut: armor spotted", self.results["radioRow"])
        self.assertEqual(1, self.results["radioFeed"])
        self.assertEqual(3, self.results["refills"])
        self.assertEqual(1, self.results["supplyRows"], "one row a visit to the depot")

    def test_a_soldier_first_seen_after_his_player_took_him_is_his(self) -> None:
        self.assertEqual({"pid": 9, "diedAt": 20}, self.results["lateSoldier"])

    def test_a_looped_gun_sounds_while_its_rounds_leave_and_the_replay_runs(self) -> None:
        # before a round, a round ago, paused, long after, after a seek
        self.assertEqual([False, True, False, False, False], self.results["sounding"])

    def test_a_replayed_ship_drops_the_craft_its_model_carries(self) -> None:
        self.assertEqual(["Corsair"], self.results["craft"])
        self.assertIsNone(self.results["corsairLeft"])
        self.assertEqual("Enterprise", self.results["aaSeatKept"])

    def test_what_the_file_sees_late_or_never_is_traced_back(self) -> None:
        # The Fletcher2 sat on the level's Fletcher pad until seen at 405 s.
        self.assertEqual([[559, "Fletcher2", 0]], self.results["extended"])
        stand_ins = {nid: (tmpl, created, until) for nid, tmpl, created, until in self.results["standIns"]}
        self.assertEqual(("Hatsuzuki", 0, None), stand_ins[541])
        self.assertEqual(("Hatsuzuki2", 0, None), stand_ins[545])
        # Removed at 389 s and made again at its place at 499 s: the Enterprise.
        self.assertEqual(("Enterprise", 0, 389), stand_ins[571])
        self.assertEqual(("Shokaku", 0, None), stand_ins[553])
        # The Fletcher pad is the Fletcher2's, so the unnamed destroyer is the
        # other pad's.
        self.assertEqual(("Fletcher2", 0, None), stand_ins[563])
        # The deck Zero until its engine started.
        self.assertEqual(("Zero", 0, 9.5), stand_ins[613])
        self.assertNotIn(558, stand_ins, "an engine alone names no template")


class ReplayOutOfRangeHullTests(unittest.TestCase):
    """A hull the server has stopped sending is drawn solid while nobody has
    driven it since the recording last saw it, and a ghost once somebody has.

    The owner's question on replay_20260928-133433 (Bocage), whether the
    translucent shells should be whole vehicles: 89% of that file's
    out-of-range vehicle time was vehicles nobody had driven since the
    recording last saw them, whose drawn pose was exact all along (79% on
    Midway, 88% on Kursk, 40% in replay_20260927-190946, whose jeeps were
    mostly being driven). EnterVehicle reaches every client whatever the
    distance, so the rest are known to be guesses.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["heldPoses"]

    def test_a_parked_vehicle_out_of_range_is_drawn_solid(self) -> None:
        self.assertEqual("solid", self.results["outOfRange"]["800"])
        # Driven and parked before the recording lost it: where it was left.
        self.assertEqual("solid", self.results["outOfRange"]["811"])
        # Heard made, never seen, never boarded: its spawn.
        self.assertEqual("solid", self.results["outOfRange"]["830"])

    def test_a_vehicle_taken_out_of_sight_is_a_ghost(self) -> None:
        self.assertEqual("ghost", self.results["outOfRange"]["810"])
        # Boarded while never seen: somewhere else by now.
        self.assertEqual("ghost", self.results["inRange"]["840"])
        self.assertEqual("ghost", self.results["outOfRange"]["840"])
        # A ship whose helm is taken out of range.
        self.assertEqual("ghost", self.results["outOfRange"]["880"])

    def test_a_gunner_or_a_gun_with_no_drivetrain_moves_nothing(self) -> None:
        # The Wake lab round's bots manned the Shokaku's AA seats at anchor.
        self.assertEqual("solid", self.results["outOfRange"]["870"])
        self.assertEqual("solid", self.results["outOfRange"]["850"])
        self.assertFalse(self.results["movable"]["850"])
        self.assertTrue(self.results["movable"]["870"])

    def test_one_rolling_when_lost_is_a_ghost_though_nobody_is_aboard(self) -> None:
        self.assertEqual("ghost", self.results["outOfRange"]["820"])

    def test_one_back_in_range_is_solid_again(self) -> None:
        self.assertEqual("solid", self.results["back"]["810"])

    def test_the_toggle_hides_the_ghosts_and_keeps_what_stands(self) -> None:
        self.assertEqual(
            {"800": "solid", "810": "hidden", "811": "solid", "820": "hidden", "830": "solid", "840": "hidden",
             "850": "solid", "870": "solid", "880": "hidden"},
            self.results["ghostsOff"])

    def test_pose_held_is_the_rule(self) -> None:
        self.assertEqual([True, False, True, False, True, False], self.results["held"])


class ReplayLifeIndexTests(unittest.TestCase):
    """The lives are indexed by id and by player (features/replay-performance):
    a 45-minute round's 8,290 lives, walked for every player, hull and prop of
    every frame, were most of the replay's frame. Every indexed answer must be
    the walk's."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["lifeIndex"]

    def test_every_answer_is_the_walks(self) -> None:
        self.assertEqual([], self.results["mismatches"])
        self.assertGreater(self.results["before"]["asked"], 5000)
        self.assertEqual(0, self.results["before"]["mismatches"])

    def test_a_life_pushed_after_the_first_question_is_found(self) -> None:
        # replay-standins.js pushes its stand-ins once the level is in.
        self.assertEqual({"lifeAt": "Hatsuzuki", "seat": ["Hatsuzuki", 5]}, self.results["standIn"])

    def test_the_round_itself_is_answered(self) -> None:
        # A seat by its recorded root (v4) and by its own id (v3); an id a
        # respawn reuses; the crew, the hit points and the deaths.
        self.assertEqual([["Sherman", 2], ["Sherman", 3]], self.results["seated"])
        self.assertEqual(["Sherman", "M10"], self.results["respawn"])
        self.assertEqual([{"pid": 1, "seat": 2}, {"pid": 2, "seat": 3}], self.results["crewAt9"])
        self.assertEqual(70, self.results["hpAt7"])
        self.assertEqual(["dead", "foot"], self.results["states"])


class ReplaySampleTrackTests(unittest.TestCase):
    """A life's samples are eight numbers each in one Float64Array
    (features/replay-performance): the 45-minute round's 495,154 samples took
    107 MB as objects. Every read must be the array's it replaced."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["sampleTrack"]

    def test_every_read_is_the_arrays(self) -> None:
        self.assertEqual([], self.results["mismatches"])

    def test_a_file_out_of_order_is_put_in_order_stably(self) -> None:
        # Two samples at 1 s: the one written first comes first, as the
        # array's stable sort left them.
        self.assertEqual([[0.5, 5], [1, 2], [1, 4], [2, 3], [3, 1]], self.results["ordered"])
        self.assertTrue(self.results["kind"])
        self.assertTrue(self.results["trimmed"])


if __name__ == "__main__":
    unittest.main()
