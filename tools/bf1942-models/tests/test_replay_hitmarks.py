"""A round replay's crosshair hit marks, and an aircraft's nose cam in its
first person.

The owner's asks (2026-10-04): "do you think it would be possible to show
cross hair hit indicators? ... Not sure if that's something we capture, or can
recreate from the data", and "most players will switch to the second camera
which is the full screen view with just the cross hair (and ammo / health).
Could we add that as a camera when we're cycling through with C".

No recording holds the marks: a dedicated server sends them to the shooter as
one bool on his control object's state (ledger XHIT-6), which the recorder
does not read. replay-hitmarks.js works them out instead: a victim's hit
points dropping with a round passing through him, the killing drop credited
to the killer the kill log names. The marks run down over a second (XHIT-3),
and an empty hull never marks (XHIT-5). A mark goes up when the round
arrives, at its weapon's muzzle velocity, and a flak shell that reaches a
moving hull bursts beside it, which never marks (PROX-3). The second view
is retail's nose cam, which only an aircraft's Camera has (seat-view.js),
and only where the server allowed it (the recording's gameRules).

Run under node through `replay_hitmarks_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_hitmarks_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayHitMarkTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_round_through_a_soldier_whose_hit_points_drop_marks(self) -> None:
        # 5.0 + 30 m at the mark's 700 m/s; the round at 8 s (no drop), the
        # drop at 12 s (no round) and the grenade's blast at 15 s mark nothing.
        self.assertEqual(self.results["marks"]["shooter"][0], 5.043)

    def test_the_killing_drop_is_the_killers_whoever_passed_closer(self) -> None:
        self.assertEqual(self.results["marks"]["other"], [19.943])
        self.assertNotIn(19.943, self.results["marks"]["shooter"])

    def test_a_hull_marks_only_while_someone_sits_in_it(self) -> None:
        shooter = self.results["marks"]["shooter"]
        self.assertFalse(any(25 <= t < 26 for t in shooter))
        self.assertIn(28.086, shooter)
        self.assertEqual(self.results["marks"]["crew"], [])

    def test_a_kill_with_no_hit_points_marks_just_before_the_kill(self) -> None:
        # His last Bar1918 round before the kill at 32.2, the mark a remote
        # drop's 0.06 s before the kill rather than at the shot.
        self.assertIn(32.14, self.results["marks"]["shooter"])
        self.assertEqual(self.results["marks"]["victim"], [])

    def test_the_mark_goes_up_when_the_round_arrives(self) -> None:
        # The bazooka at 36.0, 85 m/s over 60 m.
        self.assertIn(36.706, self.results["marks"]["shooter"])

    def test_a_burst_marks_the_round_whose_arrival_explains_the_drop(self) -> None:
        # Mp40 rounds 40.0-40.7 at 1000 m/s over 31.6 m; the drop at 40.75 is
        # 0.06 s after the 40.7 round's arrival, not the first's.
        self.assertIn(40.732, self.results["marks"]["shooter"])

    def test_a_flak_shell_bursts_beside_a_moving_hull_and_does_not_mark(self) -> None:
        # The Bofors at 45.0 reaches the crossing BF109 at 45.37: without the
        # fuse it would mark, with it the drop is the burst's (PROX-3,
        # XHIT-4). At 47.0 the same gun hits a soldier, whom no fuse sees.
        self.assertIn(45.37, self.results["unfused"])
        self.assertNotIn(45.37, self.results["marks"]["shooter"])
        self.assertIn(47.105, self.results["marks"]["shooter"])
        self.assertEqual(len(self.results["marks"]["shooter"]), 6)

    def test_the_timer_runs_down_over_a_second_and_restarts(self) -> None:
        self.assertEqual(self.results["timer"], [0, 1, 0.5, 0.001, 0, 1, 0.75, 0])
        self.assertEqual(self.results["timerNone"], 0)

    def test_the_speeds_come_from_the_models_trees_damage_json(self) -> None:
        speeds = self.results["speeds"]
        self.assertEqual(speeds["asked"], ["models/mods/xpack1/damage.json?v=1"])
        # 60 m at the stock 700 m/s, then at the bazooka's own 85.
        self.assertEqual(speeds["before"], 36.086)
        self.assertEqual(speeds["after"], 36.706)

    def test_the_hud_feeds_the_layouts_marks(self) -> None:
        hud = self.results["hud"]
        self.assertEqual(hud["atMark"], [True, 1])
        self.assertEqual(hud["half"], [True, 0.5])
        self.assertEqual(hud["gone"], [True, 0])
        # A layout from before the marks' binding keeps the group down.
        self.assertEqual(hud["oldLayout"], [False, 0])
        # Dragged off his aim, the marks go with the cross.
        self.assertEqual(hud["looking"], [True, 0])


class ReplayNoseCamTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_server_rule_is_read(self) -> None:
        self.assertIs(self.results["noseRule"], True)

    def test_the_cockpit_first(self) -> None:
        cockpit = self.results["nose"]["cockpit"]
        self.assertEqual(cockpit, {"view": "cockpit", "nose": True, "hull": True, "offset": 0})

    def test_the_nose_cam_is_the_eye_pushed_past_the_propeller_with_no_cockpit(self) -> None:
        nose = self.results["nose"]["nose"]
        self.assertEqual(nose["went"], "nose")
        self.assertEqual(nose["view"], "nose")
        self.assertEqual(nose["kind"], "seat")
        # The Corsair's OutsideHudOffset 0/-0.4/4.45, along the eye's axes.
        self.assertEqual((nose["offset"], nose["ahead"], nose["below"]), (4.468, 4.45, 0.4))
        self.assertFalse(nose["hull"])

    def test_it_toggles_back_and_resets_leaving_the_first_person(self) -> None:
        nose = self.results["nose"]
        self.assertEqual(nose["back"], "cockpit")
        self.assertEqual(nose["afterFree"], "cockpit")
        self.assertEqual(nose["again"], "cockpit")

    def test_a_tank_and_a_closed_server_have_none(self) -> None:
        self.assertEqual(self.results["nose"]["tank"], {"nose": False, "toggled": None})
        self.assertEqual(self.results["nose"]["closed"], {"nose": False, "toggled": None})


if __name__ == "__main__":
    unittest.main()
