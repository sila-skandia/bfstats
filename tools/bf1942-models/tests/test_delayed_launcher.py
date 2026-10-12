"""A `fireDelay` launcher: the wait, then the recoil state, and the report on the round.

FH's and FHSW's delayed rifle grenades fire into `1pShortDelay_<W>.baf`, which
hands to `Ub_DelayedFire<W>`; the rig bakes that second state in the `bolt`
family and the viewer plays it when the wait ends. The report is the round's
(`FireArms::Fire` returns on the click with the shot pending).
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class DelayedLauncherTests(unittest.TestCase):
    def test_extractor_follows_a_fire_state_into_delayed_fire(self):
        text = (ROOT / "extract_viewmodel.py").read_text()
        found = re.search(r're\.search\(r"([^"]+)", target, re\.I\)', text)
        self.assertIsNotNone(found)
        follows = re.compile(found.group(1), re.I)
        for state in ("Ub_DelayedFireNagantGrenade", "Ub_DelayedLieFireK98Grenade",
                      "Ub_StandBoltOperateMosinNagant"):
            self.assertTrue(follows.search(state), state)
        for state in ("_POSE_", "Ub_StandReloadK98", "Ub_StandResetRaiseWeaponMillsGrenade"):
            self.assertFalse(follows.search(state), state)

    def test_viewer_plays_it_and_sounds_on_the_round(self):
        arms = (ROOT / "viewer" / "arms-rig.js").read_text()
        self.assertIn("/boltoperate|delayed(?:lie)?fire/i.test(fireMeta?.returnTo", arms)
        fire = (ROOT / "viewer" / "hand-fire.js").read_text()
        self.assertIn("else if (reportsOnRound(hw)) playReport(hw);", fire)
        self.assertIn("beginHandFire(hw, { report: !reportsOnRound(hw) });", fire)
        # A hand grenade (`hideDuringFireTime`) keeps its report on the click.
        self.assertIn("thrown?.fireDelay > 0 && !(thrown.hideDuringFireTime > 0)", fire)


if __name__ == "__main__":
    unittest.main()
