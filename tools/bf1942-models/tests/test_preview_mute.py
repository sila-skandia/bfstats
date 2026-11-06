"""`?mute` (viewer/preview-mute.js): the page starts silent, a level launched
from it in the same tab stays silent, and `?mute=0` clears it. The menu loop's
controller starts in its muted state and the game page's master volume reads 0.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

HARNESS = r"""
import { previewMuted } from './preview-mute.js';
const store = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k) };
};
const out = {};
const s = store();
out.plain = previewMuted('', s);
out.asked = previewMuted('?mute', s);
out.carried = previewMuted('?map=wake&team=1', s);
out.cleared = previewMuted('?mute=0', s);
out.afterClear = previewMuted('', s);
out.blocked = previewMuted('?mute', { setItem() { throw new Error('blocked'); },
                                       getItem() { throw new Error('blocked'); } });
out.noStorage = previewMuted('', undefined);
console.log(JSON.stringify(out));
"""


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class PreviewMuteTests(unittest.TestCase):
    def run_harness(self) -> dict:
        proc = subprocess.run(["node", "--input-type=module", "-e", HARNESS],
                              cwd=VIEWER, capture_output=True, text=True, timeout=60)
        self.assertEqual(0, proc.returncode, proc.stderr)
        return json.loads(proc.stdout.strip().splitlines()[-1])

    def test_mute_is_asked_carried_and_cleared(self) -> None:
        out = self.run_harness()
        self.assertFalse(out["plain"])
        self.assertTrue(out["asked"])
        self.assertTrue(out["carried"], "a level launched in the same tab stays muted")
        self.assertFalse(out["cleared"])
        self.assertFalse(out["afterClear"])
        self.assertTrue(out["blocked"], "blocked storage still mutes the page that asked")
        self.assertFalse(out["noStorage"])

    def test_the_music_and_the_game_read_it(self) -> None:
        audio = (VIEWER / "audio.js").read_text(encoding="utf-8")
        self.assertIn("this._muted = previewMuted();", audio)
        # The menu re-applies its remembered toggle after building the loop.
        menu = (VIEWER / "play" / "skirmish.js").read_text(encoding="utf-8")
        self.assertIn("if (previewMuted()) return true;", menu)
        page = (VIEWER / "map.html").read_text(encoding="utf-8")
        self.assertIn("const PREVIEW_MUTED = previewMuted();", page)
        self.assertIn("PREVIEW_MUTED || s.disableSound ? 0", page)


if __name__ == "__main__":
    unittest.main()
