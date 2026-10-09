"""The baked tracer streak is scaled the engine's way (ledger TRC-1..TRC-3):
(10, 10, |v| / tracerScaler) about the mesh's own origin, no translation.

Eve of Destruction's 20 mm tracer is `tracklight_m1`, a mesh centred on its
origin (z -1.55..+1.55 m), over `tracerScaler 60` at 1000 m/s: 51.7 m long,
half ahead of the round and half behind, 0.21 m wide. Read as a uniform mesh
multiplier it drew 186 m long and 1.3 m wide, starting 93 m behind the muzzle.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_gunfire_layers import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "tracer_scale_harness.mjs"


def run_harness(cases: list[dict]) -> dict:
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
        spec = work / "spec.json"
        spec.write_text(json.dumps({"cases": cases}))
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(spec)],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)["cases"]


EOD_20MM = {"name": "eod20mm", "velocity": 1000.0, "scaler": 60.0,
            "meshZ": [-1.55, 1.55], "width": 0.021}
VANILLA = {"name": "tlight", "velocity": 400.0, "scaler": 50.0,
           "meshZ": [-1.0, 0.0], "width": 0.0061}


class TracerScaleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness([
            EOD_20MM, VANILLA,
            {**EOD_20MM, "name": "turntable", "tracerLength": "fixed"},
        ])

    def test_eod_centred_mesh_straddles_the_round(self) -> None:
        r = self.results["eod20mm"]
        self.assertAlmostEqual(10.0, r["scale"][0], places=6)
        self.assertAlmostEqual(10.0, r["scale"][1], places=6)
        self.assertAlmostEqual(1000 / 60, r["scale"][2], places=4)
        # The mesh origin IS the round: no offset along or across the line.
        self.assertAlmostEqual(0.0, r["originAlong"], places=4)
        self.assertAlmostEqual(0.0, r["originAcross"], places=4)
        self.assertEqual(0, r["lead"])
        # 3.1 m x 16.67 = 51.7 m, 25.8 m each way.
        self.assertAlmostEqual(-1.55 * 1000 / 60, r["drawnFrom"], places=2)
        self.assertAlmostEqual(1.55 * 1000 / 60, r["drawnTo"], places=2)
        self.assertAlmostEqual(0.021, r["width"], places=4)

    def test_vanilla_spike_trails_the_round(self) -> None:
        r = self.results["tlight"]
        self.assertAlmostEqual(400 / 50, r["scale"][2], places=4)
        self.assertAlmostEqual(-8.0, r["drawnFrom"], places=2)
        self.assertAlmostEqual(0.0, r["drawnTo"], places=2)
        self.assertEqual(10, r["acrossScale"])

    def test_the_turntable_keeps_its_stand_in(self) -> None:
        r = self.results["turntable"]
        # 'fixed': the uniform 0.04 x scaler stand-in, so the model browser's
        # streak still fits the stage.
        self.assertAlmostEqual(2.4, r["scale"][0], places=4)
        self.assertAlmostEqual(2.4, r["scale"][2], places=4)


if __name__ == "__main__":
    unittest.main()
