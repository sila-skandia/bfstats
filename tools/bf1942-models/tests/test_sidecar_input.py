"""The sidecar's input layer: the retail record's shape and the one-for-one
word stream.

The engine acts on every tick a channel is down, so a non-repetitive trigger
must be a one-tick press; the page's look axes are per-tick deltas, so every
page word must reach the server exactly once. Both faults were live
(2026-10-16): a prone level toggled the server's soldier up and down, and a
latest-value slot sampled on its own timer duplicated and dropped look words.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_input_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SidecarInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_prone_state_is_one_press_per_change(self):
        lie = [x["lie"] for x in self.r["edges"]]
        # down at word 0, held true through word 4, false at word 5
        self.assertEqual(lie, [True, False, False, False, False, True, False, False])

    def test_non_repetitive_keys_press_once(self):
        self.assertEqual([x["jump"] for x in self.r["edges"]], [False, True, False, False, False, False, False, False])
        self.assertEqual([x["reload"] for x in self.r["edges"]], [False, False, False, True, False, False, False, True])

    def test_push_and_hold_keys_stay_down(self):
        self.assertEqual([x["fire"] for x in self.r["edges"]], [True, True, True, False, False, False, False, False])

    def test_every_word_once_in_order(self):
        words = [x for x in self.r["sent"] if x["tag"] is not None]
        self.assertEqual([x["tag"] for x in words], [101, 102, 103, 104, 105, 106, 107])
        serials = [x["serial"] for x in self.r["sent"]]
        self.assertEqual(serials, sorted(serials))
        self.assertEqual(len(set(serials)), len(serials))
        self.assertTrue(all(x["lookX"] == self.r["look"] for x in words))

    def test_idle_repeat_turns_nothing_and_presses_nothing(self):
        idle = [x for x in self.r["sent"] if x["tag"] is None]
        self.assertTrue(idle)
        for x in idle:
            self.assertEqual(x["lookX"], self.r["centre"])
            self.assertEqual(x["buttons"] & (1 << 20), 0)

    def test_a_burst_of_words_leaves_one_a_tick(self):
        # The server keeps four buffered actions a frame, dropping the oldest
        # (D-2), and runs one a tick (D-3): five words made in one slow frame
        # and sent at once lost about half of them (live, DC El Alamein at
        # 2.7 fps, 2026-10-17). The first leaves at once, the rest one a slot,
        # and a late timer's catch-up slots release one each.
        self.assertEqual(self.r["atOnce"], 1)
        self.assertEqual(self.r["perSlot"], [1, 1, 1, 1, 0, 0])
        self.assertEqual(self.r["catchUp"], [1, 1])

    def test_page_slots_are_never_filled(self):
        # A tick the page has not reached sends nothing: a filler is a tick
        # the server runs and the page never did, and its ack lands a tick off.
        self.assertEqual(self.r["freshTicksSent"], 0)

    def test_each_word_rides_with_the_two_before_it(self):
        # Word k's datagram starts at the serial of word k-2 (the redundancy
        # the server's serial check makes free), so each word goes out once,
        # immediately, and a lost datagram costs nothing.
        words = [x for x in self.r["sent"] if x["tag"] is not None]
        firsts = self.r["datagramFirstSerials"][:len(words)]
        serials = [w["serial"] for w in words]
        self.assertEqual(firsts, [serials[max(0, i - 2)] for i in range(len(words))])


if __name__ == "__main__":
    unittest.main()
