"""`viewer/pointer-route.js`: a held button never swallows the mouse-look.

Owner report 2026-10-11: with the right (aim) button held, mouse-look
sometimes did not move at all. The page dropped the `movementX/Y` of every
locked `pointermove` whose `e.button !== -1`; a browser/compositor that
reports the held button on every move, or a coalesced move that merged a
press, therefore lost all of an aimed look. The router now decides on the
`buttons` mask against the last one seen.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

SCRIPT = r"""
import { routePointerMove } from './pointer-route.js';
function session(events, startButtons = 0) {
  const state = { buttons: startButtons };
  let fed = 0, sentPx = 0, fedPx = 0; const edges = [];
  for (const e of events) {
    sentPx += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    routePointerMove(state, e, {
      buttonChange: ev => edges.push([ev.button, ev.buttons]),
      lookDelta: (dx, dy) => { fed++; fedPx += Math.abs(dx) + Math.abs(dy); },
    });
  }
  return { moves: events.length, fed, sentPx, fedPx, edges };
}
const mv = (buttons, button = -1, dx = 1, dy = 1) =>
  ({ buttons, button, movementX: dx, movementY: dy });
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const out = {};
// plain moves with right held, spec-conformant (button -1)
out.rightHeldSpec = session(many(200, () => mv(2)), 2);
// the held button reported on every move (Wayland / coalesced): mask unchanged
out.rightHeldReported = session(many(200, () => mv(2, 2)), 2);
// left AND right held, button reported
out.bothHeldReported = session(many(200, () => mv(3, 2)), 3);
// left held (fire), middle held
out.leftHeld = session(many(100, () => mv(1, 0)), 1);
out.middleHeld = session(many(100, () => mv(4, 1)), 4);
// press right while moving: first move carries the edge
out.pressEdge = session([mv(0), mv(2, 2, 90, 90), mv(2), mv(2, 2)], 0);
// a press merged into a move that reports button -1
out.coalescedEdge = session([mv(0), mv(2, -1, 3, 3), mv(2)], 0);
// release edge
out.releaseEdge = session([mv(2), mv(0, 2, 70, 0), mv(0)], 2);
// chord: left held, right joins then leaves
out.chord = session([mv(1, 0), mv(3, 2, 80, 0), mv(3, 2), mv(1, 2, 60, 0), mv(1, 0)], 1);
console.log(JSON.stringify(out));
"""


class PointerRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            shutil.copyfile(VIEWER / "pointer-route.js", work / "pointer-route.js")
            (work / "package.json").write_text('{"type":"module"}\n')
            (work / "run.mjs").write_text(SCRIPT)
            proc = subprocess.run(["node", str(work / "run.mjs")],
                                  capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_every_move_feeds_the_look_while_a_button_is_held(self) -> None:
        for key in ("rightHeldSpec", "rightHeldReported", "bothHeldReported",
                    "leftHeld", "middleHeld"):
            r = self.r[key]
            self.assertEqual(r["moves"], r["fed"], msg=key)
            self.assertEqual(r["sentPx"], r["fedPx"], msg=key)
            self.assertEqual([], r["edges"], msg=key)

    def test_a_press_edge_goes_to_the_button_and_its_delta_is_not_fed(self) -> None:
        r = self.r["pressEdge"]
        self.assertEqual([[2, 2]], r["edges"])
        # the 90 px chorded delta is the synthetic snap the guard was for
        self.assertEqual(3, r["fed"])
        self.assertEqual(6, r["fedPx"])

    def test_an_edge_reported_without_a_button_is_still_seen_and_its_travel_kept(self) -> None:
        r = self.r["coalescedEdge"]
        self.assertEqual([[2, 2]], r["edges"])
        self.assertEqual(3, r["fed"])

    def test_a_release_edge_clears_the_button(self) -> None:
        r = self.r["releaseEdge"]
        self.assertEqual([[2, 0]], r["edges"])

    def test_a_chord_reports_each_edge_once(self) -> None:
        r = self.r["chord"]
        self.assertEqual([[2, 3], [2, 1]], r["edges"])
        # the two edge moves' deltas are dropped, the three plain moves fed
        self.assertEqual(3, r["fed"])


if __name__ == "__main__":
    unittest.main()
