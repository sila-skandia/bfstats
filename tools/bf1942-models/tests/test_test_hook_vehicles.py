"""`window.__vehicles` is defined once, and returns every field.

`test-hooks-world.js` used to define its own `__vehicles` after
`test-hooks-vehicles.js` did. Installed later, it replaced the first, so the
first one's `pos` and `tiers` (and `tier`, `running`, `critical`,
`criticalDamage`) never came back to a caller. The merged hook lives in
`test-hooks-vehicles.js` and answers both shapes: `x/y/z` and `wrecked` for
the repair sweep and blast checks, `pos` for leakcheck.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from page_source import page_files  # noqa: E402

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

FIELDS = (
    "owner", "name", "hp", "max", "critical", "destroyed", "criticalDamage",
    "wrecked", "x", "y", "z", "pos", "tier", "running", "tiers",
)


def hook_body() -> str:
    text = (VIEWER / "test-hooks-vehicles.js").read_text(encoding="utf-8")
    start = text.index("window.__vehicles = ")
    end = text.index("\n  };\n", start)
    return text[start:end]


class VehiclesHookTests(unittest.TestCase):
    def test_one_definition_across_the_page(self) -> None:
        where = []
        for path in page_files():
            text = path.read_text(encoding="utf-8", errors="replace")
            where += [path.name] * len(re.findall(r"window\.__vehicles\s*=", text))
        self.assertEqual(["test-hooks-vehicles.js"], where)

    def test_every_field_of_both_old_hooks_comes_back(self) -> None:
        body = hook_body()
        returned = body[body.index("return {"):]
        for field in FIELDS:
            self.assertRegex(returned, rf"(?<![\w.]){field}(:|,)", field)

    def test_owners_keep_the_damage_visuals_order(self) -> None:
        body = hook_body()
        self.assertIn("[...page.damageVisuals.keys()]", body)
        self.assertIn("page.vehicleDamage.byOwner.keys()", body)


if __name__ == "__main__":
    unittest.main()
