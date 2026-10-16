"""A `fireDelay` weapon: the trigger starts the clip, the round and its report
leave `fireDelay` later, `fireOnce` or not, and the weapon leaves the hand only
when its own mesh does.

The engine (lnxded `FireArms::Fire` 0x0828a090, `handleUpdate` 0x08288890; the
client's `FireArms__Fire` 0x0053d7b0 is the same code): the delay timer is
loaded with `fireDelay` by the constructor and by `HandFireArms::enable`, a
`Fire` call that finds it running flags the shot pending and returns, the
countdown runs only while a shot is pending, and the call at its end reloads
the timer, triggers the Fire slot and fires the barrel. `hideDuringFireTime`
hides the weapon from that call; at its end `handleUpdate` shows it again and,
for the throw that spent the magazine's last round, switches weapon. Nothing
hides a weapon for running dry.

FHX-4: FHSW's Molotov (`Molli`) declares `fireDelay 0.8` and no `fireOnce`, and
threw on the trigger with no wind-up. FHX-5: the rifle grenades' rifle was
hidden once its grenades were gone, and its round started at the fist
(`test_hand_aim.py`). The hand grenades reported on the click.

`delayed_fire_harness.mjs` drives `hand-fire.js` `footFire` over a stub page at
60 fps, each round fired on the world tick after its trigger pulse.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "delayed_fire_harness.mjs"
TICK = 1 / 30
FRAME = 1 / 60


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DelayedFireTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def assertDelayed(self, run: dict, click: float, delay: float) -> None:
        # The clip on the trigger, the round `fireDelay` later (within a frame
        # and the world tick the pulse waits for), and the report with it.
        self.assertEqual(run["clips"][0], click)
        self.assertGreaterEqual(run["rounds"][0] - click, delay)
        self.assertLessEqual(run["rounds"][0] - click, delay + FRAME + TICK + 1e-6)
        self.assertEqual(run["reports"], run["rounds"])

    def test_a_rifle_grenade_reports_with_its_round(self) -> None:
        self.assertDelayed(self.r["rifleGrenade"], 0.1, 0.8)

    def test_a_hand_grenade_reports_with_its_round_not_the_click(self) -> None:
        self.assertDelayed(self.r["handGrenade"], 0.1, 1.0)
        two = self.r["handGrenadeTwo"]
        self.assertEqual(two["clips"], [0.1, 3.0])
        self.assertEqual(two["reports"], two["rounds"])

    def test_a_molotov_click_winds_up(self) -> None:
        run = self.r["molotovClick"]
        self.assertEqual(len(run["rounds"]), 1)
        self.assertDelayed(run, 0.1, 0.8)
        self.assertEqual(run["end"]["rounds"], 2)

    def test_a_held_molotov_throws_a_wind_up_and_a_cycle_apart(self) -> None:
        run = self.r["molotovHeld"]
        self.assertEqual(len(run["rounds"]), 3)
        self.assertEqual(run["reports"], run["rounds"])
        self.assertEqual(len(run["clips"]), 3)
        for clip, round_ in zip(run["clips"], run["rounds"]):
            self.assertAlmostEqual(round_ - clip, 0.8, delta=FRAME + TICK)
        # The next wind-up starts once the round's cycle (`1 / roundOfFire`)
        # is out; the last one, begun with the trigger down, throws after it
        # is let go, as a pending shot does.
        for round_, clip in zip(run["rounds"], run["clips"][1:]):
            self.assertAlmostEqual(clip - round_, 1.0, delta=FRAME + 1e-6)
        self.assertGreater(run["rounds"][-1], 4.0)

    def test_a_thrown_weapon_hides_for_its_time_and_comes_back(self) -> None:
        two = self.r["handGrenadeTwo"]
        first = two["rounds"][0]
        self.assertEqual(two["hidden"][0], {"t": first, "visible": False})
        self.assertAlmostEqual(two["hidden"][1]["t"] - first, 0.4, delta=FRAME + 1e-6)
        self.assertTrue(two["hidden"][1]["visible"])
        # The last one thrown: the fist is empty (the engine switches weapon).
        self.assertEqual(two["hidden"][2], {"t": two["rounds"][1], "visible": False})
        self.assertFalse(two["end"]["visible"])

    def test_a_rifle_grenades_rifle_stays_in_the_hands_when_spent(self) -> None:
        run = self.r["rifleGrenade"]
        self.assertEqual(run["hidden"], [])
        self.assertEqual((run["end"]["rounds"], run["end"]["mags"]), (0, 0))
        self.assertTrue(run["end"]["visible"])


if __name__ == "__main__":
    unittest.main()
