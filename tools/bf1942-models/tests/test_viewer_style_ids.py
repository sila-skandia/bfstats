# watches: tools/bf1942-models/viewer
"""Every `<style>` a viewer module injects carries an id of its own.

The modules add their CSS once, guarded by `getElementById(<id>)`. Two modules
sharing an id means whichever loads second never adds its CSS: the replay
spotlight's strip drew as bare text at the top left on the live site, because
the comments panel (replay-social.js, loaded only against the real API) had
already taken `rs-style` (features/replay-load-batching, 2026-11-15).
"""
from __future__ import annotations

import re
import unittest
from collections import defaultdict
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
STYLE_ID = re.compile(r"""style\.id\s*=\s*['"]([^'"]+)['"]""")


class StyleIdsTest(unittest.TestCase):
    def test_each_injected_style_id_belongs_to_one_module(self) -> None:
        owners: dict[str, set[str]] = defaultdict(set)
        for path in VIEWER.rglob("*.js"):
            if "vendor" in path.parts or "node_modules" in path.parts:
                continue
            for style_id in STYLE_ID.findall(path.read_text(encoding="utf-8", errors="replace")):
                owners[style_id].add(str(path.relative_to(VIEWER)))
        shared = {k: sorted(v) for k, v in owners.items() if len(v) > 1}
        self.assertFalse(shared, f"style ids injected by more than one module: {shared}")
        self.assertIn("rs-spot-style", owners)


if __name__ == "__main__":
    unittest.main()
