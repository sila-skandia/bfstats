"""The local player's own object: the control-object state the server sends
ahead of a ghost block's records (sidecar/ghost/control-state.mjs)."""
import json
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class ControlStateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(HERE / "sidecar_control_state_harness.mjs")],
                             capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def test_every_state_reads_to_its_last_bit(self):
        self.assertEqual(self.r["exact"], self.r["n"])

    def test_both_full_states_and_deltas_against_a_baseline(self):
        self.assertGreater(self.r["full"], 0)
        self.assertGreater(self.r["delta"], self.r["full"])

    def test_the_track_is_continuous(self):
        # Each state is about 33 ms apart: a delta read against the wrong
        # baseline (or the wrong reference) jumps metres.
        self.assertLess(self.r["maxStep"], 1.0)

    def test_the_soldier_walks_and_turns(self):
        f, l = self.r["first"], self.r["last"]
        self.assertGreater(abs(l[2] - f[2]) + abs(l[0] - f[0]), 5.0)
        yaws = self.r["yaws"]
        self.assertGreater(max(yaws) - min(yaws), 20.0)

    def test_the_serial_echo_increases(self):
        self.assertTrue(self.r["serialsIncrease"])


if __name__ == "__main__":
    unittest.main()
