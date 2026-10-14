"""`viewer/collision-meshes.js` `isDrivableCollisionMesh`: which placed objects
a wheel may ride on top of, by name."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "viewer" / "collision-meshes.js"

NAMES = {
    # The railed plank bridge by doomed_budapest's Soviet base, and vanilla's
    # (8 levels): "bridge" spelled short. A GAZ fell to the ditch under it.
    "Woodbrdg_M1": True,
    "Ironbrdg1_m1": True,
    "longPlanks_m1": True,
    "Berlinbridge_m1": True,
    "landrep1_m1": True,
    "sandbag_m1": False,
    "FH_haystack3_m1": False,
}


class DrivableNameTests(unittest.TestCase):
    def test_deck_names(self) -> None:
        script = (
            f"import {{ isDrivableCollisionMesh }} from {json.dumps(MODULE.as_uri())};"
            f"const names = {json.dumps(list(NAMES))};"
            "process.stdout.write(JSON.stringify(Object.fromEntries(names.map("
            "n => [n, isDrivableCollisionMesh({ name: n, parent: null })]))));"
        )
        out = subprocess.run(["node", "--input-type=module", "-e", script],
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual(NAMES, json.loads(out))


if __name__ == "__main__":
    unittest.main()
