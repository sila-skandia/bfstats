"""A round replay rides out what it is handed (features/round-replay-resilience).

The owner's report (2026-09-29): the replay "just freezes and I can't quit
it", often on choosing first person on a particular player. One pose that is
not all numbers did exactly that in the page: the audio listener threw on it
before the render, every frame, and carried into the orbit's angles and the
free camera's place it outlived every change of mode and of player.

Pinned here: a recording's damaged lines and entries are left out and
counted, not the recording with them; the camera never keeps or draws a pose
that is not all numbers, and first person that cannot be placed hands the
frame to the orbit; each stage of the replay's frame runs whatever the others
throw, a hull that keeps throwing is put away, and the clock always moves on;
an engine voice at no position writes nothing; the page's frame draws and
paints its HUD whatever its world threw; and Escape reaches the page's own
menu whatever the replay's keys threw.

Run under node through `replay_resilience_harness.mjs`; the page's frame is
read out of `map.html` (`page_source.function_body`) and run over stand-ins.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from page_source import function_body

HARNESS = Path(__file__).resolve().parent / "replay_resilience_harness.mjs"


def run_node(path: Path) -> dict:
    proc = subprocess.run(["node", str(path)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"node failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayResilienceTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cls.results = run_node(HARNESS)

    def test_damaged_lines_are_left_out_not_the_recording(self) -> None:
        parse = self.results["parse"]
        self.assertIsNone(parse["error"])
        # A line cut short, one that is not a record, two times no round has,
        # three samples that are not a place and a rotation, and a sample
        # record whose list is not one.
        self.assertEqual(parse["skipped"], 8)
        self.assertEqual(parse["duration"], 10, "a garbled time does not stretch the round")
        self.assertEqual(parse["keys"], [1, 1.1, 1.2], "the good samples, back in time order")
        self.assertTrue(parse["finite"])
        self.assertEqual(parse["hp"], [25])
        self.assertEqual(parse["aim"], {"pitch": 0, "twist": 0}, "an aim that is not a number is level")
        self.assertEqual(parse["round"], [{"pos": [0, 2, 0], "dir": None}])
        self.assertEqual(parse["control"], [50], "the player record's good entry is kept")

    def test_a_pose_that_is_not_all_numbers_is_never_kept(self) -> None:
        camera = self.results["camera"]
        self.assertTrue(camera["orbitFirst"])
        self.assertEqual(camera["povSight"], "foot")
        # The report's path: first person came out as no rotation, and the
        # orbit read its heading off it. Before, it stayed at no position
        # in every mode and on every player.
        self.assertTrue(camera["orbitPoisoned"], "the orbit is handed no heading")
        self.assertTrue(camera["orbitAfter"], "and draws anyway")
        self.assertTrue(camera["freeAfter"], "the free camera taken from no position draws")
        self.assertEqual(camera["otherPov"], {"drawable": True, "sight": "foot", "x": 30})

    def test_first_person_that_cannot_be_placed_hands_the_frame_to_the_orbit(self) -> None:
        camera = self.results["camera"]
        for broken in camera["broken"]:
            # Still first person as chosen, drawn by the orbit this frame, and
            # nothing of his first person left set: no HUD, no hidden body.
            self.assertEqual(broken, {"mode": "pov", "drawable": True, "sight": None, "hidePid": None})
        self.assertEqual(camera["backAgain"], {"sight": "foot", "hidePid": 4, "drawable": True})
        self.assertEqual(camera["input"], {"yaw": True, "zoom": 1}, "a drag or a wheel of no number moves nothing")
        self.assertEqual(camera["cameraWarnings"], 2, "each kind said once")

    def test_each_stage_of_the_frame_runs_whatever_the_others_throw(self) -> None:
        frame = self.results["frame"]
        self.assertEqual(frame["stagesEachFrame"], ["feed", "plan", "props", "round", "ui"])
        self.assertEqual(frame["perFrame"], 5, "every stage, every frame")
        # The clock moves on every frame, though the camera and the HUD throw.
        for step in frame["frames"]:
            self.assertAlmostEqual(step["to"] - step["from"], 1 / 30, places=9)
        self.assertEqual(frame["fired"], [5.02], "a round that throws leaves the next one to fire")
        self.assertIsNone(frame["hudState"], "a HUD that cannot be worked out is none, not a stale one")
        self.assertIsNone(frame["ownBody"], "a camera that threw hides nobody's body")

    def test_a_hull_that_keeps_throwing_is_put_away(self) -> None:
        frame = self.results["frame"]
        self.assertEqual(frame["streak"], 3)
        self.assertEqual(frame["thrower"], {"updates": 3, "hidden": 3, "faulted": True})
        # A hull placed at no position is hidden on the frame it is.
        self.assertEqual(frame["nowhere"], {"updates": 3, "hidden": 3, "visible": False})
        self.assertEqual(frame["fine"], {"updates": 6, "visible": True})
        self.assertEqual(frame["afterSeek"], {"faulted": True, "updates": 4}, "a seek gives it one more go")
        self.assertEqual(frame["report"]["the camera"], 6)

    def test_a_step_a_clock_and_a_seek_of_no_number_are_none(self) -> None:
        frame = self.results["frame"]
        self.assertEqual(frame["afterNaNStep"], 5.133)
        self.assertTrue(frame["afterNaNClock"])
        self.assertTrue(frame["afterNaNSeek"])
        self.assertTrue(frame["guardType"])

    def test_an_engine_voice_at_no_position_writes_nothing(self) -> None:
        # Web Audio throws on a value that is not a number, and the throw
        # stopped the page's frame before its render.
        self.assertEqual(self.results["engineAudio"], {
            "placed": None, "sourceNowhere": None, "listenerNowhere": None, "placedAgain": None,
        })

    def test_escape_is_always_the_pages_way_out(self) -> None:
        keys = self.results["keys"]
        # A key whose action throws is still the replay's: the page never
        # sees it.
        self.assertEqual(keys["space"], {"threw": None, "stopped": True, "prevented": True})
        # Escape goes on to the page's own menu.
        self.assertEqual(keys["escape"], {"threw": None, "stopped": False, "prevented": False})


class PageFrameTests(unittest.TestCase):
    """map.html's `frame`, read out of the page and run over stand-ins."""

    def run_frame(self, throwing: str) -> dict:
        script = f"""
const calls = [];
const controls = {{ pollGamepad() {{}} }};
const localLook = {{ restoreTickPose() {{}} }};
const localPlayer = {{
  frameInput: () => ({{ seated: false, onFoot: false, input: null, look: null }}),
  frameCameras() {{}},
}};
const part = name => () => {{
  calls.push(name);
  if (name === {json.dumps(throwing)}) throw new Error(name + ' threw');
}};
const replayController = {{ active: () => true, update: part('replay') }};
function simulate() {{ return {{}}; }}
const presentWorld = part('world');
const draw = part('draw');
const paintHud = part('hud');
const paintPlayingShell = part('shell');
{function_body("frame")}
let thrown = null;
try {{
  frame(1 / 60);
}} catch (error) {{
  thrown = error.message;
}}
process.stdout.write(JSON.stringify({{ calls, thrown }}));
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "frame.mjs"
            path.write_text(script, encoding="utf-8")
            return run_node(path)

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")

    def test_the_frame_is_drawn_whatever_the_world_threw(self) -> None:
        out = self.run_frame("world")
        # The replay, the render, the HUD (and its Escape menu) and the shell
        # still run; the throw is still the loop's to report.
        self.assertEqual(out["calls"], ["world", "replay", "draw", "hud", "shell"])
        self.assertEqual(out["thrown"], "world threw")

    def test_the_hud_is_painted_whatever_the_render_threw(self) -> None:
        out = self.run_frame("draw")
        self.assertEqual(out["calls"], ["world", "replay", "draw", "hud", "shell"])
        self.assertEqual(out["thrown"], "draw threw")

    def test_a_quiet_frame_throws_nothing(self) -> None:
        out = self.run_frame("")
        self.assertEqual(out["calls"], ["world", "replay", "draw", "hud", "shell"])
        self.assertIsNone(out["thrown"])


if __name__ == "__main__":
    unittest.main()
