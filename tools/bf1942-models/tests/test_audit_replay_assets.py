"""`audit_replay_assets.mjs`'s pure half: the classifier that names each
404'd asset's owning extractor, and the recording-argument parser.

One node run (`replay_assets_harness.mjs`), no network and no browser: the
audit module's main() is gated on being invoked as a script, so importing it
for its exports is side-effect free.

Why this exists. The 2026-10-19 report: the three newest recordings on the
public replay feed threw hundreds of asset 404s. Each 404 has to land on the
right desk -- a model never exported (extract_models), a kit pose
(extract_pose --kit-poses), a first-person rig (extract_viewmodel), a sound,
the shared texture store (optimise_mesh) -- and has to be split into
"extracted but not yet published" (present locally) versus a real pipeline
gap (absent locally too). The classifier is that routing, and a wrong row
sends hours of re-extraction at the wrong script.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_assets_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ClassifierTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def kind_of(self, path: str) -> str:
        return self.results["classified"][path]["kind"]

    def owner_of(self, path: str) -> str:
        return self.results["classified"][path]["owner"]

    def test_model_variants_land_on_their_exporters(self) -> None:
        c = self.results["classified"]
        self.assertEqual(self.kind_of("models/mods/fhsweurope/Tiger.glb"), "model")
        self.assertEqual(self.kind_of("models/mods/fhsweurope/Tiger.cockpit.glb"), "cockpit")
        self.assertEqual(self.kind_of("models/mods/fhsweurope/Tiger.wreck.glb"), "wreck")
        # `Name.<Level>.glb` is the level-paint variant, not a model typo.
        self.assertEqual(self.kind_of("models/mods/fhsweurope/Tiger.Rush_To_Baghdad.glb"), "level-variant")
        self.assertIn("extract_level_variants", self.owner_of("models/mods/fhsweurope/Tiger.Rush_To_Baghdad.glb"))
        self.assertEqual(c["models/mods/fhsweurope/Tiger.glb"]["template"], "Tiger")
        self.assertEqual(c["models/mods/fhsweurope/Tiger.glb"]["modTree"], "fhsweurope")
        self.assertEqual(c["models/Sherman.glb"]["modTree"], "vanilla")

    def test_poses_rigs_and_sounds_have_their_own_desks(self) -> None:
        self.assertIn("extract_pose", self.owner_of("models/mods/fhsweurope/poses/GermanSoldier__MP40.pose.glb"))
        self.assertEqual(
            self.results["classified"]["models/mods/fhsweurope/poses/GermanSoldier__MP40.pose.glb"]["template"],
            "GermanSoldier__MP40")
        self.assertIn("extract_viewmodel", self.owner_of("models/mods/fhsweurope/viewmodels/mp40/rig.glb"))
        self.assertEqual(self.kind_of("models/mods/fhsweurope/sounds/tiger-engine.mp3"), "sound")

    def test_level_and_shared_tree_split(self) -> None:
        self.assertEqual(self.kind_of("maps/mods/fhsweurope/rush_to_baghdad/scene.glb"), "level")
        self.assertIn("rush_to_baghdad", self.owner_of("maps/mods/fhsweurope/rush_to_baghdad/terrain/0_0.webp"))
        self.assertEqual(self.kind_of("maps/wake/scene.glb"), "level")
        self.assertIn("extract_effects", self.owner_of("maps/mods/fhsweurope/_shared/effects.glb"))
        self.assertIn("extract_loadouts", self.owner_of("maps/mods/fhsweurope/_shared/loadouts.json"))
        self.assertEqual(self.kind_of("maps/mods/fhsweurope/_shared/voices/axis/attack.mp3"), "voice")
        self.assertIn("extract_hud_mods", self.owner_of("maps/mods/fhsweurope/_shared/hud/kits.json"))

    def test_stores_api_and_page_are_not_extraction_gaps(self) -> None:
        self.assertIn("optimise_mesh", self.owner_of("textures/ab/abcdef0123.webp"))
        self.assertIn("optimise_mesh", self.owner_of("glbs/ab/abcdef0123.glb"))
        self.assertEqual(self.kind_of("stats/recordings/8uv24yb8hp/views"), "api")
        self.assertEqual(self.kind_of("favicon.ico"), "page")
        self.assertEqual(self.kind_of("replay-hulls.js"), "page")


class RoutingTests(unittest.TestCase):
    """The live-vs-local split and the manifest-aware probes.

    A destroyed hull probes `<T>.wreck.glb` and a flown one `<T>.cockpit.glb`
    whether or not the exporter wrote one; the manifest (`cockpit`, a
    `variants` row of configuration `wreck`) is the exporter's word, so those
    404s are info probes, not gaps. 196 of the 2026-10-19 run's 345 rows were
    wreck probes of emplacements that never had a wreck.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def route(self, name: str) -> dict:
        return self.results["routed"][name]

    def test_absent_everywhere_is_a_major_extraction_gap(self) -> None:
        r = self.route("gap")
        self.assertEqual((r["severity"], r["cause_key"]), ("major", "asset.extraction-gap"))
        self.assertEqual(r["local"], "absent")
        # The tree-fallback collapse: both probed trees in the one row.
        self.assertIn("models/RemoteStuka.glb", r["evidence"])

    def test_present_locally_is_minor_unpublished(self) -> None:
        r = self.route("unpublished")
        self.assertEqual((r["severity"], r["cause_key"]), ("minor", "asset.unpublished"))
        self.assertEqual(r["local"], "present")

    def test_a_wreck_the_manifest_never_listed_is_a_probe(self) -> None:
        self.assertEqual(self.route("wreckByDesign")["cause_key"], "asset.optional-probe")
        self.assertEqual(self.route("wreckByDesign")["severity"], "info")
        self.assertEqual(self.route("cockpitByDesign")["cause_key"], "asset.optional-probe")

    def test_a_wreck_the_manifest_lists_is_still_a_gap(self) -> None:
        self.assertEqual(self.route("wreckExported")["cause_key"], "asset.extraction-gap")

    def test_a_wreck_of_an_unlisted_template_follows_its_base_gap(self) -> None:
        r = self.route("wreckOfUnlisted")
        self.assertEqual((r["severity"], r["cause_key"]), ("minor", "asset.follows-base-gap"))

    def test_api_rows_are_info_and_page_rows_are_dropped(self) -> None:
        self.assertEqual(self.route("api")["cause_key"], "api.error")
        self.assertIsNone(self.route("page"))


class RecordingArgTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = ClassifierTests.results if hasattr(ClassifierTests, "results") else run_harness()

    def test_every_argument_shape_resolves_the_slug(self) -> None:
        p = self.results["parsed"]
        self.assertEqual(p["slug"]["slug"], "8uv24yb8hp")
        self.assertEqual(p["ndjson"]["slug"], "8uv24yb8hp")
        self.assertEqual(p["pageUrl"], {"slug": "8uv24yb8hp", "mod": "fhsweurope", "level": "rush_to_baghdad"})
        self.assertEqual(p["plainUrl"], {"slug": "4xhtpkm8bv", "mod": "bf1942", "level": "berlin"})
        self.assertIsNone(p["junk"]["slug"])


if __name__ == "__main__":
    unittest.main()
