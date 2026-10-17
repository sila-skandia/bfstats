"""The soldier's view and his rounds: the page draws what the server fires.

Driven by `soldier_view_law_harness.mjs`. The engine's law (ledger VIEW-14):
`BFSoldier::handleUpdate` (lnxded 0x08271f68) poses the soldier's camera as
`rotateXDeg(-2.5 x aimA) x rotateYDeg(-3 x twist)` off his body, at his
`setPoseCameraPos` eye, and `FireArms::Fire` launches a hand weapon's round
down that camera (XHIT-12). The aim register `aimA` is what the mouse moves
one degree per count and what the server sends; the view is 2.5 times it.

The page used to draw the register as the view. On a real server (Wake co-op,
2026-10-17) it aimed at a chest 1.4 m above it at 7.8 m with a register of
9.9, and the server's rounds left at 24.8 degrees and passed 3.4 m over the
man's feet, over his head; the same aim on the flat (register -4) went into
his legs, which is why the flat run killed him. The laws pinned here:

* a look count turns the view 3 degrees of yaw and 2.5 of pitch, and the
  view's clamp is the register's 38 through the camera, 95;
* the sidecar's hand-weapon round (`k:"f"`) leaves down the camera: the
  uphill burst passes 3.4 m over the target's feet, where the register read
  as the view would have put it at his chest;
* the page's view at the acked tick is the server's camera exactly: the same
  direction as the server's round, to the third decimal;
* the view's yaw at the acked tick comes from the ack's own twist and body,
  not the ghost row a datagram behind it, which once took a look step back off
  the page's view while the server kept it (7 degrees off the target);
* the sidecar carries the aim forward across states that leave it out.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "soldier_view_law_harness.mjs"


class SoldierViewLawTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_a_look_count_turns_the_view_three_and_two_and_a_half(self) -> None:
        look = self.r["look"]
        self.assertEqual({"yaw": 3, "pitch": 2.5}, look["perCount"])
        self.assertEqual(2.5, look["viewPerAim"])
        self.assertEqual(2.5, look["sidecarViewPerAim"])
        self.assertEqual(3, look["sidecarTwist"])

    def test_the_views_clamp_is_the_registers_through_the_camera(self) -> None:
        self.assertEqual(38, self.r["look"]["aimLimit"])
        self.assertEqual(95, self.r["look"]["limit"])

    def test_the_servers_round_went_over_his_head(self) -> None:
        fire = self.r["fire"]
        self.assertEqual([1161.402, 109.831, 748.223], fire["p"])  # origin + 0.65
        self.assertAlmostEqual(24.825, _pitch_deg(fire["d"]), delta=0.1)
        self.assertGreater(fire["pass"]["overFeet"], 3.3)  # a standing man is 1.8 m
        self.assertLess(fire["pass"]["side"], 0.05)  # on him in yaw
        # The register read as the view: his chest, where the page aimed.
        self.assertAlmostEqual(1.19, self.r["registerAsView"]["overFeet"], delta=0.02)

    def test_the_pages_view_is_the_servers_camera(self) -> None:
        page, fire = self.r["page"], self.r["fire"]
        self.assertAlmostEqual(24.825, page["viewPitch"], places=3)
        self.assertAlmostEqual(180 - 3 * 3.13, page["viewYaw"], places=3)
        for a, b in zip(page["dir"], fire["d"]):
            self.assertAlmostEqual(a, b, delta=0.002)
        self.assertAlmostEqual(fire["pass"]["overFeet"], page["pass"]["overFeet"], delta=0.01)

    def test_the_acked_view_takes_the_acks_twist(self) -> None:
        # The ghost row still read -0.81 (a datagram behind); the ack -3.13.
        self.assertAlmostEqual(170.61, self.r["page"]["viewYaw"], places=2)
        # An ack with no twist (an older sidecar) leaves the ghost row's.
        self.assertAlmostEqual(180 - 3 * 0.81, self.r["pageOldAck"]["viewYaw"], places=2)
        self.assertEqual(9.93, self.r["aimRegister"])

    def test_the_sidecar_carries_the_aim_forward(self) -> None:
        carry = self.r["carry"]
        self.assertIsNone(carry[0])
        self.assertEqual({"aim": 9.93, "twist": -0.81, "q": [0, 0, 0, 1]}, carry[1])
        self.assertEqual({"aim": 9.93, "twist": -3.13, "q": [0, 0, 0, 1]}, carry[2])
        self.assertEqual(carry[2], carry[3])


def _pitch_deg(d: list[float]) -> float:
    import math
    return math.degrees(math.asin(d[1] / math.sqrt(sum(x * x for x in d))))


if __name__ == "__main__":
    unittest.main()
