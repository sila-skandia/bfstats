"""`MouseInput.pump` carries what the wire format cannot, so a slow hand is not lost.

Owner report 2026-10-11: mouse-look in the aimed-down-sights view stutters and
sometimes does not move at all, worst when the crosshair is tightest (a slow,
small movement). The look is a rate (`0.001 x counts/s x scale`) snapped to
0.01 on the way into the simulation, and the snapped-away counts used to be
discarded: at sensitivity 0.05 a hand moving 20 px/s applied NOTHING, and at
the shipped 0.25 a few percent was lost. These tests drive the real module and
assert every count is applied, exactly once, whatever the frame slicing.
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
import { MouseInput } from './mouse-input.js';
function run({ fps, pxPerSec, sens, secs = 8, invertY = false }) {
  const m = new MouseInput({ sensitivity: { infantry: sens } });
  m.setInvert('infantry', invertY);
  const TICK = 1 / 30, dtF = 1 / fps;
  let ev = 0, owed = 0, sent = 0, appliedX = 0, appliedY = 0, zeroPumps = 0, pumps = 0;
  for (let f = 0; f < fps * secs; f++) {
    ev += pxPerSec * dtF;
    const n = Math.floor(ev); ev -= n;
    if (n) { m.accumulate(n, n); sent += n; }
    owed += dtF / TICK;
    const nt = Math.floor(owed + 1e-9); owed -= nt;
    if (nt > 0) {
      m.pump(nt * TICK, 'infantry');
      appliedX += m.x * nt; appliedY += m.y * nt;
    }
  }
  const scale = 5 * sens + 0.1;
  const pend = m.pendingPixels;
  // axis units a perfect device would have summed over ticks: counts*0.001*scale*30
  return {
    ratioX: appliedX / (sent * 0.001 * scale * 30),
    ratioY: (invertY ? -appliedY : appliedY) / (sent * 0.001 * scale * 30),
    pendingX: pend.x, sent,
  };
}
const out = {};
for (const sens of [0.25, 0.1, 0.05]) for (const fps of [30, 60, 144])
  for (const pps of [5, 20, 40, 80, 300])
    out[`${sens}/${fps}/${pps}`] = run({ fps, pxPerSec: pps, sens });
out.inverted = run({ fps: 60, pxPerSec: 40, sens: 0.1, invertY: true });
console.log(JSON.stringify(out));
"""


class RemainderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            shutil.copyfile(VIEWER / "mouse-input.js", work / "mouse-input.js")
            (work / "package.json").write_text('{"type":"module"}\n')
            (work / "run.mjs").write_text(SCRIPT)
            proc = subprocess.run(["node", str(work / "run.mjs")],
                                  capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr)
        cls.results = json.loads(proc.stdout)

    def test_every_count_is_applied_at_any_sensitivity_and_frame_rate(self) -> None:
        for key, r in self.results.items():
            if key == "inverted":
                continue
            # Within one quantum of the whole movement (at most a few
            # counts' worth of 8 s of hand), never the 0..0.93 it was.
            self.assertAlmostEqual(1.0, r["ratioX"], delta=0.06, msg=key)

    def test_the_carry_is_bounded(self) -> None:
        for key, r in self.results.items():
            if key == "inverted":
                continue
            # Under 2 px even at the lowest sensitivity (0.01 axis step at
            # scale 0.35 over one tick is ~0.95 px; a multi-tick frame more).
            self.assertLess(abs(r["pendingX"]), 6.0, msg=key)

    def test_the_inverted_axis_is_carried_in_its_own_sense(self) -> None:
        r = self.results["inverted"]
        self.assertAlmostEqual(1.0, r["ratioY"], delta=0.06)


if __name__ == "__main__":
    unittest.main()
