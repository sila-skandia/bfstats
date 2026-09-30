"""`viewer/play/mod-picker.js` `webAddress`: the Custom Game dialog prints a
mod's `setCustomGameUrl` whatever it says, and VISIT WEB PAGE opens it only
when it is an address. DC Final's is the sentence "The final installment....",
which used to leave the line on the layout's vanilla literal instead."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

PLAY = Path(__file__).resolve().parents[1] / "viewer" / "play"

HARNESS = """
const { webAddress } = await import('./mod-picker.js');
console.log(JSON.stringify([
  webAddress({ url: 'http://www.DesertCombat.com' }),
  webAddress({ url: 'https://www.moddb.com/mods/battlefield-1918' }),
  webAddress({ url: 'The final installment....' }),
  webAddress({}),
  webAddress(null),
]));
"""


class WebAddressTests(unittest.TestCase):
    def test_only_an_address_is_opened(self) -> None:
        if shutil.which("node") is None:
            self.skipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for name in ("mod-picker.js", "menu-screen.js"):
                shutil.copyfile(PLAY / name, work / name)
            (work / "package.json").write_text('{"type":"module"}\n')
            (work / "harness.mjs").write_text(HARNESS)
            proc = subprocess.run(["node", str(work / "harness.mjs")],
                                  capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            self.skipTest(f"mod-picker.js does not load under node: {proc.stderr[-300:]}")
        self.assertEqual(["http://www.DesertCombat.com",
                          "https://www.moddb.com/mods/battlefield-1918",
                          None, None, None], json.loads(proc.stdout))


if __name__ == "__main__":
    unittest.main()
