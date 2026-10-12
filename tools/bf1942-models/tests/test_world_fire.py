"""Runs `test_world_fire.mjs`, the world-gunfire pool's node suite.

Same shape as `test_vehicle_audio.py` and `test_engine_audio.py`: a
self-contained node test over `viewer/world-fire.js` with a stub Web Audio
context, wrapped so `unittest discover` (and therefore `verify.sh`) runs it.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_world_fire.mjs")


class WorldFireNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        if not SCRIPT.exists():
            raise unittest.SkipTest(f"{SCRIPT.name} is not in the tree")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


VIEWER = Path(__file__).resolve().parents[1] / "viewer"
WORLD_CALL = re.compile(r"\bplayWorld(?:Shot|Reload|Eject)\??\.?\(")


def _call_arguments(text: str, start: int) -> list[str]:
    """The top-level arguments of the call whose `(` ends at `start`."""
    depth, args, current = 1, [], []
    for ch in text[start:]:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                break
        if ch == "," and depth == 1:
            args.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    args.append("".join(current).strip())
    return args


class WorldCallersNameAnOwnerTests(unittest.TestCase):
    """Every page call of the world-fire pool hands over the shooter.

    A round with no owner takes whichever pooled patch is free, each with a
    clock of its own (ledger SND-33): the bystander's Garand rang its casings
    once a slot. The player's own stab and the rocket pack were the last two
    callers that named none.
    """

    def test_every_call_site_passes_five_arguments(self) -> None:
        sites = []
        for path in sorted([*VIEWER.glob("*.js"), VIEWER / "map.html"]):
            if path.name in ("page-audio.js", "test-hooks.js"):
                continue                        # the definitions and the hook
            text = path.read_text(encoding="utf-8")
            for match in WORLD_CALL.finditer(text):
                before = text[max(0, match.start() - 12):match.start()]
                if "function " in before or before.rstrip().endswith("*"):
                    continue
                args = _call_arguments(text, match.end())
                if len(args) == 1 and args[0] in ("", "weapon", "weaponName"):
                    continue
                line = text.count("\n", 0, match.start()) + 1
                sites.append((path.name, line, len(args)))
        self.assertGreaterEqual(len(sites), 6, sites)
        self.assertEqual([], [site for site in sites if site[2] < 5],
                         "a world-fire call that names no owner")


if __name__ == "__main__":
    unittest.main()
