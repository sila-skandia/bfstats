"""Another soldier's round is drawn on the line the server fires it along.

Lab sessions on Wake co-op (2026-10-25, `lab/fire_line_probe.mjs`): a sidecar
soldier fired taps, taps while turning, bursts, and (the `moving` case) taps
walking and strafing while turning, standing, crouched and prone, with the
BAR (keeps its kick), the No4Sniper (no recoil), the Thompson and the Garand
(both go back), while the server's recorder logged each round's fireBarrel
frame and a second sidecar recorded the soldier's ghost. Each fixture holds
that sidecar's recording and review log and the server's `f` rows; the test
rebuilds the ghost rows with today's `sidecar/rebuild.mjs` and pairs them
with the server's (`lab/fire_line_check.py`). The laws (wire.md section 44,
"The line a remote's round is drawn on"):

* one drawn round for each round the server fired: the state bits' 8-10 are
  the recoil counter's low bits, so a weapon that goes back no longer draws
  three (148 rows for 58 Thompson rounds before), and a sniper rifle with no
  recoil is read off its fire state (none drawn before);
* the round leaves from his eye for his pose up his body's axis (0.65, 0.12,
  -0.7): the point within 5 cm, 1 mm standing still (crouched rounds were 0.53 m high, prone
  1.32 m);
* along his view on the tick before the round's, before its kick: within
  0.3 mrad at the median and 2 mrad at the 90th percentile (2 to 8 mrad high
  at the median before, 30 to 60 mrad off on a turning tap).
"""

from __future__ import annotations

import gzip
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(ROOT / "lab"))
import fire_line_check  # noqa: E402

# case -> (the drawn rounds' span of the recording, or None, and the stances it covers)
CASES = {
    "bar_sniper": (None, {"stand", "crouch", "prone"}),
    "thompson_garand": (None, {"stand", "crouch", "prone"}),
    # The recording also holds a BAR run the server's round restart cut short,
    # whose server rows are in another file: the Thompson run only.
    "moving": ((140.0, 1e9), {"stand", "crouch", "prone"}),
}


def _rebuild(case: str, tmp: Path):
    streams = {"rec": [], "review": [], "server": []}
    with gzip.open(FIXTURES / f"sidecar_fire_line_{case}.ndjson.gz", "rt") as f:
        for line in f:
            stream, row = json.loads(line)
            streams[stream].append(row)
    for name in ("rec", "review"):
        (tmp / f"{name}.ndjson").write_text("".join(json.dumps(r) + "\n" for r in streams[name]))
    out = tmp / "out.ndjson"
    proc = subprocess.run(["node", str(ROOT / "sidecar" / "rebuild.mjs"), str(tmp / "rec.ndjson"),
                           str(tmp / "review.ndjson"), str(out)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"rebuild failed:\n{proc.stderr}")
    return out, streams["server"]


class SidecarFireLineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cls.r = {}
        with tempfile.TemporaryDirectory() as d:
            for case, (window, _) in CASES.items():
                tmp = Path(d) / case
                tmp.mkdir()
                out, server = _rebuild(case, tmp)
                fires, _ = fire_line_check.load_watch(str(out))
                if window:
                    fires = [f for f in fires if window[0] <= f["t"] <= window[1]]
                cls.r[case] = {
                    "pairs": fire_line_check.compare(str(out), server, window),
                    "drawn": len(fires),
                    "server": len(server),
                }

    def test_one_drawn_round_for_each_round_the_server_fired(self) -> None:
        for case, r in self.r.items():
            with self.subTest(case=case):
                self.assertEqual(r["server"], r["drawn"])
                self.assertEqual(r["server"], len(r["pairs"]))

    def test_the_round_leaves_from_his_eye_for_his_pose(self) -> None:
        for case, r in self.r.items():
            with self.subTest(case=case):
                self.assertEqual(CASES[case][1], {p["stance"] for p in r["pairs"]})
                self.assertLess(max(p["m"] for p in r["pairs"]), 0.05)

    def test_the_round_flies_along_his_view_before_its_kick(self) -> None:
        for case, r in self.r.items():
            for stance in sorted(CASES[case][1]):
                with self.subTest(case=case, stance=stance):
                    mrad = sorted(p["mrad"] for p in r["pairs"] if p["stance"] == stance)
                    self.assertLess(mrad[len(mrad) // 2], 0.3)
                    self.assertLess(mrad[int(0.9 * len(mrad))], 2.0)
                    vert = sorted(p["vmrad"] for p in r["pairs"] if p["stance"] == stance)
                    self.assertLess(abs(vert[len(vert) // 2]), 0.3)


if __name__ == "__main__":
    unittest.main()
