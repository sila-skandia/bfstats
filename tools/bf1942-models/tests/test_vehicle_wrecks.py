"""A pad's respawn (`vehicle-wrecks.js` `respawnVehicle`), driven headless by
`vehicle_wrecks_harness.mjs`.

The respawn undoes the no-wreck fade on the intact hull, and nothing else: a
material that is translucent by design — the muzzle smoke and flash emitters
living in every armed hull's subtree — keeps its blend. Forcing it opaque drew
every later puff from that gun as a black square.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("vehicle_wrecks_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


SMOKE = {"opacity": 0.35, "transparent": True, "depthWrite": False}
OPAQUE = {"opacity": 1, "transparent": False, "depthWrite": True}


class RespawnMaterialTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_hull_behind_a_wreck_keeps_its_smoke_translucent(self) -> None:
        run = self.results["wreck"]
        self.assertTrue(run["shown"])
        self.assertEqual(SMOKE, run["smoke"])
        self.assertEqual(OPAQUE, run["body"])

    def test_the_no_wreck_fade_is_undone_to_what_it_found(self) -> None:
        run = self.results["noWreck"]
        # The fade reached the whole subtree ...
        self.assertEqual(0, run["faded"]["body"]["opacity"])
        self.assertEqual(0, run["faded"]["smoke"]["opacity"])
        # ... and the respawn put each material back as it was, not opaque.
        self.assertEqual(OPAQUE, run["body"])
        self.assertEqual(SMOKE, run["smoke"])


class WreckLookupTests(unittest.TestCase):
    """Where a wreck is fetched from (`wreckUrls`).

    A mod inherits its parents' templates, so the active tree and then
    vanilla's are asked, and the first catalogue that lists the template
    decides, down to "no wreck at all".
    """

    lookups: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.lookups = run_harness()["lookups"]

    def test_the_level_on_screen_gets_its_own_reskin(self) -> None:
        self.assertEqual(["models/mods/dc_final/FlagBox.wreck.DC_Medina_Ridge.glb"],
                         self.lookups["levelReskin"])
        self.assertEqual(["models/mods/dc_final/FlagBox.wreck.glb"],
                         self.lookups["otherLevel"])

    def test_a_listed_template_with_no_wreck_is_not_fetched(self) -> None:
        self.assertEqual([], self.lookups["noWreck"])

    def test_an_inherited_template_falls_back_to_vanilla(self) -> None:
        self.assertEqual(["models/Sherman.wreck.glb"], self.lookups["inherited"])

    def test_an_unlisted_template_is_probed_down_the_chain(self) -> None:
        self.assertEqual(["models/mods/dc_final/Flak18_36.wreck.glb",
                          "models/Flak18_36.wreck.glb"], self.lookups["unlisted"])
        self.assertEqual(["models/Ju88A.wreck.glb"], self.lookups["vanilla"])

    def test_an_unlisted_meshless_node_asks_for_nothing(self) -> None:
        self.assertEqual([], self.lookups["unlistedMeshless"])

    def test_each_catalogue_is_read_once(self) -> None:
        # Two `createVehicleWrecks` on DC Final, one read each.
        self.assertEqual(2, self.lookups["catalogueFetches"])


if __name__ == "__main__":
    unittest.main()
