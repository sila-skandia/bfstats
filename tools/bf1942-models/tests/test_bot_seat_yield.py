"""What a human's radio, Use key and seat key do to a bot holding a seat.

Read from lnxded 2026-11-12:

* `GameServer::radioMessage` 0x0813a120 hands a player's message to
  `AIRadio::sendMessage` 0x08482650: same-side, living bots other than the
  speaker; a shout within 70 m with gain `70 / d`, team radio with gain 1;
  `s += (1 - s) gain b` (0x084825e0), the decay `dt a` every 0.5 s or more
  (0x08482330). Vanilla `Game/AI/radio.con` subscribes BailOut, GetIn and
  AbandonShip with `10 0.8`.
* `BBChange::getRadioStrength` 0x0855fc10: 1 for a soldier, else
  `(1 + GetIn)(1 - BailOut)` (AbandonShip on a naval unit). The seated
  Change weighs its stay option, and every unit it scores, by it.
* E with no free door in reach (`toggleEntryPoint` 0x0814f1b6..0x0814f21a)
  and a seat key to a held seat (`checkPlayerTriggers` 0x0814fb07..
  0x0814fb63) call `IBotManager::playerRequestPlayerControlObject`; the bot
  stores its seat and the time (0x0852ed40), and `calculateVehicleUrgency`
  weighs that seat at `age / 15` of itself for 15 s (0x08583c50). Nobody is
  moved or swapped by the press.

Driven headless by `bot_seat_yield_harness.mjs` against the viewer's modules.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("bot_seat_yield_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BotSeatYieldTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- AIRadio ---------------------------------------------------------------

    def test_a_shout_reaches_the_side_within_70_m_by_70_over_d(self) -> None:
        s = self.results["shout"]
        self.assertEqual(70, s["range"])
        self.assertAlmostEqual(0.8, s["at70"], places=9)
        # Unclamped: twice the gain from half the distance.
        self.assertAlmostEqual(1.6, s["at35"], places=9)
        for who in ("at71", "enemy", "dead", "speaker"):
            self.assertEqual(0, s[who], who)
        self.assertAlmostEqual(0.8 + 0.2 * 0.8, s["at70Twice"], places=9)

    def test_team_radio_is_a_broadcast_and_unsubscribed_messages_drop(self) -> None:
        self.assertAlmostEqual(0.8, self.results["broadcast"], places=9)
        self.assertEqual(0, self.results["unsubscribed"])

    def test_the_strength_decays_a_tenth_a_second_in_half_second_steps(self) -> None:
        d = self.results["decay"]
        self.assertAlmostEqual(1.6, d["after04"], places=9)
        self.assertAlmostEqual(1.5, d["after10"], places=9)
        self.assertEqual(0, d["after100"])

    def test_the_subscriptions_are_the_mods_radio_con(self) -> None:
        s = self.results["subscriptions"]
        self.assertEqual({"a": 0.1, "b": 0.8}, s["vanilla"])
        self.assertEqual({"a": 0.1, "b": 0.5}, s["gc"])
        self.assertTrue(s["getIn"])
        self.assertTrue(s["abandon"])
        self.assertFalse(s["attacking"])

    def test_get_radio_strength(self) -> None:
        r = self.results["radioStrength"]
        self.assertEqual(1, r["foot"])
        self.assertAlmostEqual(0.2, r["bail"], places=9)
        self.assertAlmostEqual(1.8, r["getIn"], places=9)
        self.assertEqual(1, r["shipIgnoresBail"])
        self.assertAlmostEqual(0.2, r["shipAbandon"], places=9)
        self.assertEqual([0.6, 0.3], r["teleport"])

    def test_the_teleports_radio_moves_no_one_to_another_seat(self) -> None:
        t = self.results["teleportSame"]
        self.assertEqual(t["a"], t["b"])

    # --- the seated Change ---------------------------------------------------------

    def test_a_quiet_bot_keeps_its_seat(self) -> None:
        s = self.results["seated"]
        self.assertEqual(11, s["foot"])
        self.assertEqual(0, s["quiet"]["urgency"])
        self.assertEqual(0, s["getIn"]["urgency"])

    def test_bail_out_puts_a_driver_on_foot(self) -> None:
        s = self.results["seated"]
        for case in ("bailFar", "bailNear"):
            self.assertEqual("foot", s[case]["best"], case)
            self.assertTrue(s[case]["bail"], case)
            self.assertGreater(s[case]["urgency"], 0, case)

    def test_a_gunner_bails_from_a_far_shout_and_not_a_near_one(self) -> None:
        s = self.results["seated"]
        self.assertGreater(s["gunnerBailFar"]["urgency"], s["bailFar"]["urgency"])
        # Its stay x radio divides x; under 0 the declining slope gives 0.
        self.assertEqual(0, s["gunnerBailNear"]["urgency"])

    def test_a_request_devalues_the_seat_for_fifteen_seconds(self) -> None:
        s = self.results["seated"]
        self.assertEqual("foot", s["requestNow"]["best"])
        self.assertGreater(s["requestNow"]["urgency"], 0)
        # Half way the seat is worth 10 of its 20, staying 12.5 over the foot's 11.
        self.assertEqual(0, s["requestHalf"]["urgency"])
        self.assertEqual(0, s["requestLate"]["urgency"])
        self.assertIsNone(s["requestStale"]["request"])
        self.assertEqual(0, s["requestOther"]["urgency"])
        a = self.results["requestAge"]
        self.assertEqual(10, a["same"])
        self.assertIsNone(a["other"])   # Infinity
        self.assertAlmostEqual(10, a["scaled"], places=9)
        self.assertEqual(20, a["unscaled"])

    # --- the referee ----------------------------------------------------------------

    def test_only_a_seated_living_bot_of_the_side_takes_a_request(self) -> None:
        r = self.results["request"]
        self.assertTrue(r["sameSide"])
        self.assertEqual({"id": "S", "at": 42}, r["stored"])
        for case in ("otherSide", "onFoot", "dead", "nobody"):
            self.assertFalse(r[case], case)

    def test_the_referee_hands_a_shout_to_its_side(self) -> None:
        r = self.results["refereeRadio"]
        self.assertAlmostEqual(70 / 5 * 0.8, r["seated"], places=9)
        self.assertEqual(0, r["enemy"])
        self.assertEqual(0, r["dead"])


if __name__ == "__main__":
    unittest.main()
