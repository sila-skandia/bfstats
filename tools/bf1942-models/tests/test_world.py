"""`viewer/world.js` under node: the headless simulation core stepped.

Same pattern as `test_flight.py` — one node run, many assertions — because
starting the runtime is the slow part. `world.js` imports `seats.js`, which
imports three.js, so `run_harness` stands the vendored `three.module.js` up
as a one-file package under `node_modules`, exactly as `test_flight.py` does.

What this file pins is the P1 contract of
`features/netcode-play-multiplayer/README.md`: a World that owns N soldiers
plus the collider/combat-area/supply/ticket state, steps at the engine's
fixed 30 Hz from one buffered input per player per tick, and is byte-for-byte
deterministic for a scripted input stream. The numbers live in the harness's
scenarios; the assertions below are about the *laws*:

* the walk law — one second of forward walk travels roughly
  `directionalSpeed(stand, forward)` x time, short of the table value by the
  ramp's own contribution (PHY-6), and standing-still isolation holds;
* the 60 fps local-player mapping — the page feeds setInput every display
  frame; the world's 30 Hz tick consumes one input per tick, and the motion
  is identical to stepping the same world at its own tick (the "same World
  code" invariant in miniature);
* backlog collapse — a giant dt (a backgrounded tab) runs at most
  MAX_CATCH_UP_TICKS world ticks, the same catch-up cap the soldier physics
  uses, and drops the rest;
* determinism — the same scripted stream twice yields identical final state;
* per-player look isolation — each player's mouse axis reaches only that
  player's view.
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
HARNESS = Path(__file__).resolve().parent / "world_harness.mjs"

# world.js's own imports: physics/soldier/mouse-input/fall-damage, the body
# stack (body-world -> vehicle-bodies -> rigid-body/body-contact), combat
# area, supply, armor, vehicle damage — plus seats.js, which imports three.
# The world itself is copied as `world.mjs` for the harness, exactly as the
# flight harness imports `flight.mjs`; every dependency keeps its own name so
# the unmodified imports resolve.
_MODULE_NAMES = [
    "physics", "parachute", "swim", "soldier", "spawn-safety", "mouse-input",
    "point-body", "fixed-step", "soldier-pose", "soldier-locomotion", "walking-body",
    "fall-damage",
    "body-world", "body-statics", "vehicle-bodies", "combat-area", "supply", "armor",
    "vehicle-damage", "seats", "seat-dots", "rigid-body", "body-contact",
    "body-ground", "body-friction", "crash-damage", "effects-core",
    # Reached through seats.js: the salvo arithmetic and the HUD
    # weapon-slot order, and an aircraft torpedo's water run.
    "bomb-release", "torpedo-run",
]
MODULES = {f"{name}.js": VIEWER / f"{name}.js" for name in _MODULE_NAMES}
MODULES["world.mjs"] = VIEWER / "world.js"
MODULES.update({
    # The bare specifier `three` is an import map entry in the page; node
    # needs a package, so the same vendored file is published as one.
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
})
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})

# The engine's own table, re-declared only so the assertion reads plainly.
# physics.js `DIRECTIONAL_SPEED` at BFSoldierTemplate::directionalSpeed[6]:
# (forward, not-forward) pairs per pose; standing forward is 6 m/s.
STAND_FORWARD_SPEED = 6.0


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
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
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class WorldTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the tick law -------------------------------------------------------

    def test_the_world_steps_at_the_engine_30_hz(self) -> None:
        self.assertEqual(self.results["tickRate"], 30)
        self.assertAlmostEqual(self.results["tickDt"], 1 / 30)

    def test_two_players_step_together_on_one_clock(self) -> None:
        s1 = self.results["scenario1"]
        self.assertEqual(s1["ticksRun"], 30)
        # The world consumed 30 ticks of one player's forward walk: the walk
        # law. Short of 6 m/s x 1 s by the ramp's contribution (PHY-6 starts
        # from rest and climbs over ~0.35 s).
        self.assertGreater(s1["p1Travelled"], 4.0)
        self.assertLessEqual(s1["p1Travelled"], STAND_FORWARD_SPEED)
        self.assertAlmostEqual(s1["p1Travelled"], STAND_FORWARD_SPEED, delta=1.5)

    def test_per_player_input_isolation(self) -> None:
        s1 = self.results["scenario1"]
        self.assertAlmostEqual(s1["p2Still"], 0.0, places=6)
        # P2 never fed the walk input, so P2's facing never moved.
        self.assertAlmostEqual(s1["p2Final"]["yaw"], 0.0, places=6)
        self.assertAlmostEqual(s1["p2LookApplied"]["yaw"], 0.0, places=9)
        self.assertAlmostEqual(s1["p2LookApplied"]["pitch"], 0.0, places=9)

    def test_the_60_fps_local_mapping_matches_the_fixed_tick(self) -> None:
        # The page feeds one input per display frame; the world consumes one
        # per 30 Hz tick. Stepping the world at 60 fps feeds and stepping it
        # at its own tick must move the body identically (the deterministic
        # FixedStep), which is the "same World code" acceptance bar.
        s1 = self.results["scenario1"]
        s2 = self.results["scenario2"]
        self.assertEqual(s2["frames"], 60)
        self.assertTrue(s2["matchesFixedTick"], s2["aTravelled"])

    def test_all_three_feed_cadences_move_identically(self) -> None:
        # Fix 2: a true 30 fps display (one tick per frame, fed the same way)
        # travels the same distance as the 60 fps feed (scenario 1) and as
        # the pinned walk law (5.413 m for 1 s of forward walk -- 6 m/s minus
        # the ramp's contribution). The FixedStep + FIFO design is what makes
        # the three agree.
        s1 = self.results["scenario1"]
        s6 = self.results["scenario6"]
        self.assertEqual(s6["frames"], 30)
        self.assertTrue(s6["matches60fps"], s6["fTravelled"])
        self.assertTrue(s6["matchesPinned"], s6["fTravelled"])
        self.assertAlmostEqual(s6["fTravelled"], s1["p1Travelled"], places=9)

    def test_backlog_beyond_the_cap_collapses(self) -> None:
        s3 = self.results["scenario3"]
        self.assertEqual(s3["owedTicks"], 90)
        self.assertEqual(s3["ranTicks"], s3["maxTicks"])
        self.assertTrue(s3["collapsed"])

    def test_scripted_stream_is_deterministic(self) -> None:
        s4 = self.results["scenario4"]
        self.assertTrue(s4["same"], s4["scriptA"])

    def test_look_is_per_player(self) -> None:
        s5 = self.results["scenario5"]
        self.assertTrue(s5["c1Turned"])
        self.assertTrue(s5["c2Turned"])
        self.assertTrue(s5["c2Opposite"])

    # --- the engine-FIFO input law (Fix 1) -----------------------------------

    def test_fifo_cap_four_drops_the_oldest(self) -> None:
        # D-2 (`clearPlayerActions` 0x0815bb90): five sequenced packets land
        # in a four-slot buffer, the oldest (seq 1) is dropped, and the first
        # tick consumes seq 2.
        s7 = self.results["scenario7"]
        self.assertEqual(s7["cap"]["lengthAfterFive"], 4)
        self.assertEqual(s7["cap"]["oldestAfterCap"], 2)
        self.assertEqual(s7["cap"]["lastSeen"], 5)

    def test_exactly_one_input_is_consumed_per_tick(self) -> None:
        # D-4: two ticks pop exactly two of the four buffered entries.
        s7 = self.results["scenario7"]
        self.assertEqual(s7["onePerTick"]["consumed1"], 2)
        self.assertEqual(s7["onePerTick"]["consumed2"], 3)
        self.assertEqual(s7["onePerTick"]["remaining"], 2)

    def test_empty_buffer_delivers_the_engine_idle_word(self) -> None:
        # D-4 (`simulatePlayerUpdate` 0x0815bd00): a tick with nothing
        # buffered yields the zeroed word, never a replay of the last input.
        s7 = self.results["scenario7"]
        self.assertEqual(s7["idle"]["consumed4"], 5)
        self.assertTrue(s7["idle"]["idleOnEmpty"])

    def test_sequence_dedupe_on_receive(self) -> None:
        # D-3 (`processRcvdPlayerActions` 0x08148470): a duplicate seq is
        # ignored; the next one is accepted.
        s7 = self.results["scenario7"]
        self.assertEqual(s7["dedupe"]["length"], 2)
        self.assertEqual(s7["dedupe"]["seqs"], [40, 41])


    # --- HP-5's water contact ------------------------------------------

    def test_a_hull_high_over_open_water_is_not_in_the_water(self) -> None:
        """The regression: `#inWaterOwners` used to decide water contact from
        `WorldCollider.surfaceHeight`, which is a function of x and z alone
        and so answers "the sea" for a plane at any altitude over it. Every
        aircraft flying over water then took `hpLostWhileDamageFromWater`
        (10 HP/s for every vanilla plane) once a second until it exploded,
        with nothing shooting at it. `touchesWater` is `checkVsTerrain`'s own
        rule — collision-response.md §7, the lowest tested vertex below the
        water level — so altitude decides it."""
        water = self.results["water"]
        self.assertFalse(water["highAbove"])
        self.assertFalse(water["justClear"])

    def test_water_contact_begins_at_the_lowest_tested_vertex(self) -> None:
        # §7: the vertex, not the origin, is the thing that has to be under
        # the plane — and the compare is `<=`, so resting exactly on it is
        # contact.
        water = self.results["water"]
        self.assertTrue(water["bellyTouching"])
        self.assertTrue(water["bellyUnder"])

    def test_an_origin_below_the_water_plane_needs_no_vertex(self) -> None:
        water = self.results["water"]
        self.assertTrue(water["originUnder"])

    def test_a_level_with_no_water_drowns_nothing(self) -> None:
        water = self.results["water"]
        self.assertFalse(water["noWaterLevel"])


if __name__ == "__main__":
    unittest.main()
