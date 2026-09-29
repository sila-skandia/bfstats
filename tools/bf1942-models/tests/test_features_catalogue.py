"""features/README.md names every feature folder, and only folders that exist.

A session finds which of the ~180 folders holds an answer through this
catalogue, and the bf1942-knowledge skill sends readers to it. A folder missing
from it is work nobody finds again. A name with no folder behind it is a dead
link.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
FEATURES = REPO_ROOT / "features"
CATALOGUE = FEATURES / "README.md"

# A catalogue entry is a link or path whose target starts with a folder name:
# `[viewer-parachute](viewer-parachute/README.md)` or `viewer-parachute/`.
ENTRY = re.compile(r"\]\(([a-z0-9][a-z0-9.-]*)/|`([a-z0-9][a-z0-9.-]*)/`")


def catalogued() -> set[str]:
    text = CATALOGUE.read_text(encoding="utf-8")
    return {a or b for a, b in ENTRY.findall(text)}


def folders() -> set[str]:
    return {p.name for p in FEATURES.iterdir() if p.is_dir() and p.name != "archived"}


class FeaturesCatalogueTest(unittest.TestCase):
    def test_every_folder_is_catalogued(self):
        missing = sorted(folders() - catalogued())
        self.assertFalse(
            missing,
            "features/README.md does not list: "
            + ", ".join(missing)
            + ". Add a row under the matching BF1942 topic, or the folder's "
            "name to the stats-site list at the end.",
        )

    def test_every_entry_exists(self):
        stale = sorted(catalogued() - folders())
        self.assertFalse(
            stale,
            "features/README.md names folders that do not exist: "
            + ", ".join(stale)
            + ". Fix the name or drop the row.",
        )


if __name__ == "__main__":
    unittest.main()
