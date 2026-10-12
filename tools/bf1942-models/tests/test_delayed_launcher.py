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

    def test_recoil_pose_is_held_for_the_state(self):
        # The owner's retail capture: the rifle is up for the state's length
        # and at the aim after it; the weapon's own state then runs on.
        arms = (ROOT / "viewer" / "arms-rig.js").read_text()
        self.assertIn("const held = /delayed(?:lie)?fire/i.test(follow?.state || '');", arms)
        self.assertIn("timeScale: held ? 0 : 1", arms)
        self.assertIn("boltAction.isRunning() || hw.heldClip?.name === boltName", arms)
        self.assertIn("action.time = Math.min(hw.heldClip.span, action.getClip().duration);", arms)


class PendingSpriteTests(unittest.TestCase):
    """A sprite the pack lists and has not loaded draws nothing, not the
    leaf's literal: FHSW's grenade sight zoomed onto the sniper blackout."""

    def test_hud_waits_for_a_listed_sprite(self):
        hud = (ROOT / "viewer" / "hud.js").read_text()
        self.assertIn("if (pending?.(key)) onItsWay = true;", hud)
        self.assertIn("if (onItsWay) return null;", hud)
        feed = (ROOT / "viewer" / "hud-feed.js").read_text()
        self.assertIn("new Hud({ canvas: hudCanvas, sprite, pending,", feed)
        self.assertIn("if (wanted.has(name)) hudFeed.gameHud?.requestRepaint();", feed)


if __name__ == "__main__":
    unittest.main()
