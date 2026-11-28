"""The rocket pack's flame: `e_RocketPack` and its `e_RocketPackDefault` flicker burn together."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "rocket_flame_harness.mjs"


class RocketFlameTests(unittest.TestCase):
    def test_both_bundles_burn_and_go_out_together(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        log = out["log"]
        self.assertEqual(log[:2], [["play", "e_RocketPack", "pack"], ["play", "e_RocketPackDefault", "pack"]])
        self.assertEqual(out["held"], 2, "inside the hold the flame stays up and nothing is played twice")
        self.assertEqual(sorted(e[1] for e in log[2:4]), ["e_RocketPack", "e_RocketPackDefault"])
        self.assertTrue(all(e[0] == "stop" for e in log[2:4]))
        # `b` burns, then `clear` puts both out.
        self.assertEqual([e[0] for e in log[4:]], ["play", "play", "stop", "stop"])

    def test_the_pack_hangs_nozzles_toward_his_feet_in_any_pose_file(self) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        orient = json.loads(proc.stdout)["orient"]
        # [1,0,0,0] * [0,0,-1,0] = a half turn about Y; the other stays the slot's.
        self.assertEqual(orient["kept"], [0, 0, -1, 0])
        self.assertEqual(orient["turned"], [0, 1, 0, 0])
        self.assertEqual(orient["again"], orient["turned"])


if __name__ == "__main__":
    unittest.main()
