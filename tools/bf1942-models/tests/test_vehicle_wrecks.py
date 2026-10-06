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


class AbandonedHullTests(unittest.TestCase):
    """A pad's hull left alone (`stepAbandoned`, ledger SPAWN-13), with Desert
    Combat's words: `TimeToLive 45`, `Distance 40`, `damageWhenLost 10`."""

    abandoned: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.abandoned = run_harness()["abandoned"]

    def test_a_hull_far_from_its_pad_times_out_after_its_grace(self) -> None:
        far = self.abandoned["far"]
        # Whole through the 45 s grace (the clock runs in 0.5 s steps) ...
        self.assertEqual([100] * 45, far[:45])
        # ... then `damageWhenLost` a second: 100 HP gone in ten seconds more.
        self.assertLess(far[45], 100)
        self.assertAlmostEqual(10, (far[45] - far[54]) / 9, delta=1.2)
        self.assertEqual(0, far[-1])

    def test_nothing_times_out_near_its_pad_manned_or_watched(self) -> None:
        # Within `Distance`, a man in the seat, a man on foot beside it.
        for case in ("near", "occupied", "soldier"):
            self.assertEqual([100] * 60, self.abandoned[case], case)

    def test_a_scene_without_the_words_keeps_its_hulls(self) -> None:
        self.assertEqual([100] * 60, self.abandoned["oldScene"])



class EndOfRoundTests(unittest.TestCase):
    """`clearWorld` and the restart (ledger ROUND-10)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()["restart"]

    def test_the_end_of_a_round_takes_every_hull_off_the_field(self) -> None:
        for hull in self.r["after"]:
            self.assertTrue(hull["removed"])
            self.assertFalse(hull["alive"])
            self.assertFalse(hull["collision"])
        # The intact and the burning hull are cleared (no wreck); the wreck
        # just goes as a cleared wreck does.
        self.assertEqual([True, True, False], [h["cleared"] for h in self.r["after"]])
        self.assertEqual([0, 1], self.r["retired"])

    def test_only_a_player_control_object_of_the_level_goes(self) -> None:
        # An armoured SimpleObject stays; so does what a spawn effect stood
        # up, which its own module removes.
        self.assertEqual([{"visible": True, "cleared": False}] * 2, self.r["kept"])

    def test_the_restart_brings_each_back_fresh(self) -> None:
        self.assertEqual([True, True], self.r["spawned"])
        for hull in self.r["back"]:
            self.assertEqual((False, False, 100, True),
                             (hull["removed"], hull["cleared"], hull["hp"], hull["collision"]))


if __name__ == "__main__":
    unittest.main()
