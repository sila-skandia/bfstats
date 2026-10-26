"""The sidecar survives malformed and out-of-range inputs
(`sidecar_robustness_harness.mjs`). Each case is a defect the Kotlin port's
authors found in the Node copy (2026-10-26) and fails on the code before
the fix."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_robustness_harness.mjs"


class SidecarRobustnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    # --- netconn.mjs ---------------------------------------------------------

    def test_an_ack_for_a_sequence_never_sent_is_ignored(self) -> None:
        # It used to move lastConfirmed to 20 with nothing sent, and every
        # send after failed "send window full".
        a = self.r["ackAhead"]
        self.assertEqual(a["first"], {"ok": 1})
        self.assertEqual(a["statuses"], [1])
        self.assertEqual(a["lastConfirmed"], 1)
        self.assertEqual(a["second"], {"ok": 2})

    def test_a_short_connect_accept_is_ignored(self) -> None:
        a = self.r["shortAccept"]
        self.assertEqual(a["shortRes"], "ok")
        self.assertEqual(a["stateAfterShort"], "connecting")
        self.assertEqual(a["connected"], [{"id": 6, "serverTime": 1234}])
        self.assertEqual(a["state"], "connected")

    # --- events.mjs ------------------------------------------------------------

    def test_every_written_event_reads_back_with_the_stream_intact(self) -> None:
        for name, res in self.r["events"].items():
            self.assertIn("ok", res, f"{name}: {res}")
            self.assertEqual(res["ok"]["next"], "Suicide", name)
            self.assertEqual(res["ok"]["left"], 0, name)

    def test_an_lstr_is_cut_at_255_bytes(self) -> None:
        self.assertEqual(self.r["events"]["lstr300"]["ok"]["first"]["serverName"], "w" * 255)

    def test_a_vector_is_always_three_floats(self) -> None:
        e = self.r["events"]
        self.assertEqual(e["vec2"]["ok"]["first"]["value"], [7, 8, 0])
        self.assertEqual(e["vec4"]["ok"]["first"]["pos"], [1, 2, 3])
        self.assertEqual(e["vec4"]["ok"]["first"]["rot"], [5, 6, 7])

    def test_a_non_string_is_written_as_its_string(self) -> None:
        e = self.r["events"]
        self.assertEqual(e["strNumber"]["ok"]["first"]["sessionId"], "42")
        self.assertEqual(e["lstrNumber"]["ok"]["first"]["serverName"], "12345")
        self.assertEqual(e["hudNumber"]["ok"]["first"]["text"], "404")
        self.assertEqual(e["chatBool"]["ok"]["first"]["text"], "true")

    # --- input.mjs -------------------------------------------------------------

    def test_button_masks_are_uint32_from_either_shape(self) -> None:
        self.assertEqual(self.r["buttons"], {"actionFor": 2 ** 31, "encodeAction": 2 ** 31})

    def test_the_sender_keeps_time_on_its_injected_clock_alone(self) -> None:
        # The bucket (a burst of two) and the slots run on the injected clock,
        # which stands still at 0 while Date.now leaps a second a read.
        c = self.r["clock"]
        self.assertEqual(c["atOnce"], 2)
        self.assertAlmostEqual(c["nextAt"], 1000 / 30)

    # --- bitstream.mjs, level-tables.mjs, soldier-ghost.mjs, live-snapshot.mjs, pco.mjs

    def test_ranged_bits_past_2_31_return(self) -> None:
        # The engine (0x083da040, uint32): the full 32-bit range wraps to 0
        # bits; above 2^31 it never returns, and the sidecar answers 32. The
        # old loop never returned on any of these (the harness timed out).
        self.assertEqual(self.r["rangedBits"], [7, 31, 32, 32, 0])

    def test_valid_baked_is_a_boolean(self) -> None:
        self.assertIs(self.r["validBaked"], True)

    def test_a_non_number_aim_is_carried_forward(self) -> None:
        t = self.r["tracker"]
        self.assertEqual(t[0], {"ok": [5, 1, 2, 1.5, 2, 0, 0]})
        self.assertEqual(t[1], {"ok": [5, 3, 2, 1.5, 2, 0, 0]})

    def test_a_projectile_pool_needs_a_numeric_count(self) -> None:
        self.assertEqual(self.r["projPools"], [[800, 2]])

    def test_each_networkable_reads_against_its_own_baseline(self) -> None:
        self.assertEqual(self.r["pcoBases"], [[10, 10, 10], [20, 20, 20]])


if __name__ == "__main__":
    unittest.main()
