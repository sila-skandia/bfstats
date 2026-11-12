"""An engine that omits `setDifferential`, `setTorque` or
`setNoPropellerEffectAtSpeed` keeps `EngineTemplate`'s constructor defaults:
differential 10.0, torque 60.0, noPropellerEffectAtSpeed 100.0 (lnxded
`EngineTemplate::EngineTemplate` `0x0823f230` writes `+0x364`/`+0x368`/
`+0x520`; the client's `0x005715d0` the same at `+0x414`/`+0x418`/`+0x5d0`).
Every vanilla and expansion-pack engine authors all three; BF1918's zeppelins
omit the fade speed, which the page used to read as 70.
Driven headless by `engine_defaults_harness.mjs`.
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
from test_ship import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).with_name("engine_defaults_harness.mjs")
#: `3.5 * setDifferential / gearRatioCurve[100]`, the curve's 0.94.
RATIO = 3.5 * 10 / 0.94


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class EngineDefaultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_an_aircraft_engine_keeps_the_constructor_defaults(self):
        self.assertEqual(self.out["plane"],
                         {"differential": 10, "torque": 60, "noPropellerEffectAtSpeed": 100})

    def test_a_ship_engine_keeps_the_constructor_defaults(self):
        self.assertEqual(self.out["ship"],
                         {"differential": 10, "torque": 60, "noPropellerEffectAtSpeed": 100})

    def test_a_vectored_engine_keeps_the_constructor_defaults(self):
        v = self.out["vectored"]
        self.assertAlmostEqual(v["ratio"], RATIO, places=5)
        self.assertEqual(v["torque"], 60)
        self.assertEqual(v["fadeSpeed"], 100)


if __name__ == "__main__":
    unittest.main()
