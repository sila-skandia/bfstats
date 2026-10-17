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

    def assertDelayed(self, run: dict, click: float, ticks: int) -> None:
        # The clip on the trigger, the round `ticks` world ticks after the
        # tick that takes the press (the first after the click), and the
        # report with it. `ticks` is `fire-timer.js` `delayTicks`: the delay
        # timer's whole ticks less the press's own, as the lab server
        # recorded (0.4 s: 12 ticks after the press; 0.8 s: 23).
        self.assertEqual(run["clips"][0], click)
        self.assertGreaterEqual(run["rounds"][0] - click, ticks * TICK - 1e-3)
        self.assertLessEqual(run["rounds"][0] - click, ticks * TICK + TICK + 1e-3)
        self.assertEqual(run["reports"], run["rounds"])

    def test_a_rifle_grenade_reports_with_its_round(self) -> None:
        self.assertDelayed(self.r["rifleGrenade"], 0.1, 23)

    def test_a_hand_grenade_reports_with_its_round_not_the_click(self) -> None:
        self.assertDelayed(self.r["handGrenade"], 0.1, 29)
        two = self.r["handGrenadeTwo"]
        self.assertEqual(two["clips"], [0.1, 3.0])
        self.assertEqual(two["reports"], two["rounds"])

    def test_a_molotov_click_winds_up(self) -> None:
        run = self.r["molotovClick"]
        self.assertEqual(len(run["rounds"]), 1)
        self.assertDelayed(run, 0.1, 23)
        self.assertEqual(run["end"]["rounds"], 2)

    def test_a_held_molotov_throws_a_wind_up_and_a_cycle_apart(self) -> None:
        run = self.r["molotovHeld"]
        self.assertEqual(len(run["rounds"]), 3)
        self.assertEqual(run["reports"], run["rounds"])
        self.assertEqual(len(run["clips"]), 3)
        for clip, round_ in zip(run["clips"], run["rounds"]):
            self.assertGreaterEqual(round_ - clip, 23 * TICK - 1e-3)
            self.assertLessEqual(round_ - clip, 24 * TICK + 1e-3)
        # The next wind-up starts once the round's cycle (`1 / roundOfFire`,
        # 30 ticks) is out, which a round the delay let go starts a tick late
        # (`fire-timer.js` `delayedFireCycle`): 31 ticks. The last one, begun
        # with the trigger down, throws after it is let go, as a pending shot
        # does.
        for round_, clip in zip(run["rounds"], run["clips"][1:]):
            self.assertAlmostEqual(clip - round_, 31 * TICK, delta=FRAME + 1e-3)
        self.assertGreater(run["rounds"][-1], 4.0)

    def test_a_thrown_weapon_hides_for_its_time_and_comes_back(self) -> None:
        two = self.r["handGrenadeTwo"]
        first = two["rounds"][0]
        self.assertEqual(two["hidden"][0], {"t": first, "visible": False})
        self.assertAlmostEqual(two["hidden"][1]["t"] - first, 0.4, delta=FRAME + 1e-3)
        self.assertTrue(two["hidden"][1]["visible"])
        # The last one thrown hides for its time too, and comes back: nothing
        # hides a weapon for running dry. At that moment, and only for the
        # throw that emptied the loaded magazine, `handleUpdate` switches
        # weapon (ledger FA-14, `kit-select.js`), whatever
        # `changeWeaponWhenNoAmmo` says.
        self.assertEqual(two["hidden"][2], {"t": two["rounds"][1], "visible": False})
        self.assertAlmostEqual(two["hidden"][3]["t"] - two["rounds"][1], 0.4, delta=FRAME + 1e-3)
        self.assertTrue(two["end"]["visible"])
        self.assertEqual(len(two["switches"]), 1)
        self.assertEqual(two["switches"][0], two["hidden"][3]["t"])

    def test_a_rifle_grenades_rifle_stays_in_the_hands_when_spent(self) -> None:
        run = self.r["rifleGrenade"]
        self.assertEqual(run["hidden"], [])
        self.assertEqual((run["end"]["rounds"], run["end"]["mags"]), (0, 0))
        self.assertTrue(run["end"]["visible"])
        # No `hideDuringFireTime` and no `changeWeaponWhenNoAmmo`: no switch.
        self.assertEqual(run["switches"], [])

    def test_change_weapon_when_no_ammo_switches_once_the_cycle_is_out(self) -> None:
        # `handlePlayerInput` (0x08275c52): the held item's total is 0 and it
        # says the word. The engine's count reaches 0 at `fireFinished`, when
        # the round's cycle (`1 / roundOfFire`, 1 s) is out.
        run = self.r["rifleGrenadeSwitch"]
        self.assertEqual(len(run["rounds"]), 1)
        self.assertTrue(run["switches"])
        self.assertAlmostEqual(run["switches"][0] - run["rounds"][0], 1.0, delta=FRAME + TICK)


if __name__ == "__main__":
    unittest.main()
