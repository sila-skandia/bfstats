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
        # Parked with nobody aboard: the idle blade, gear down. Under power
        # 300 m up: the disc past the 0.07 swap, the propeller turned, the gear
        # away -- the flight model's own presentation of a recorded pose.
        flown = self.results["flownPropeller"]
        self.assertEqual(flown["parked"], {"blade": True, "disc": False, "gear": 0})
        self.assertFalse(flown["flying"]["blade"])
        self.assertTrue(flown["flying"]["disc"])
        self.assertEqual(flown["flying"]["gear"], 1)
        self.assertGreater(flown["flying"]["throttle"], 0.07)
        self.assertGreater(flown["flying"]["turned"], 0)
        self.assertTrue(flown["flying"]["wrapperTurned"])
        self.assertEqual(flown["placed"], {"x": 0, "y": 300})


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
        self.assertEqual(ux["chapters"], [[2, "round-start", 0], [10, "kill", 3], [20, "teamkill", 3],
                                          [30, "death", 3], [35, "vehicle", 3], [50, "capture", 6],
                                          [60, "capture", 6], [80, "round-end", 3]])
        self.assertEqual(ux["texts"][1], "Axe [Type 99] Bea")
        self.assertEqual(ux["texts"][2], "Bea killed a teammate: rec")
        self.assertEqual(ux["texts"][3], "Axe is no more")
        self.assertEqual(ux["texts"][4], "Sherman destroyed by Axe")
        self.assertEqual(ux["texts"][5], "[Landing Beach] Axis captured the control point")

    def test_next_and_previous_event(self) -> None:
        # A jump lands a chapter's lead before its moment; "previous" skips
        # the one the playhead is just past; the followed player's alone.
        ux = self.results["ux"]
        self.assertEqual(ux["next"], ["round-start", "kill", "teamkill"])
        self.assertEqual(ux["prev"], "kill")
        self.assertEqual(ux["nextOwn"], "teamkill")
        self.assertEqual(ux["feed"], [[10, "kill"], [20, "kill"], [30, "kill"], [45, "chat"],
                                      [50, "capture"], [60, "capture"]])

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
        self.assertEqual(pov["look"], [0, 0, 1])
        self.assertEqual((pov["fov"], pov["near"], pov["hides"]), (57.3, 0.2, 0))
        # Free: W flies along the view at 30 m/s, with the page's own lens.
        self.assertEqual(cam["free"], {"moved": 30, "along": 1, "fov": 60})
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

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["feet"]

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


if __name__ == "__main__":
    unittest.main()
