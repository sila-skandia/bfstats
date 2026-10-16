"""`audit_play.py` (`audit_mod.py --audit kits vehicles`): each check names the
play-breaking defect it was written for, with its cause and owning script, on
a small tree with exactly that defect planted. No game install is needed: the
chain is an ObjectLibrary built from `.con` text, the level archive a stub.

The defects: FHSWEurope 203_hill-1904's Russians with no kit look and a
GrenadeRus with no first-person rig (2026-10-15); the T-34 whose turret and
cannon were dropped with a `CreateInvisible` parent (2026-10-14); al_marj-1942's
Flak 18/36 round selector with no held key axis (2026-10-15).
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import audit_mod as A  # noqa: E402
import audit_play as P  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402

CHAIN_CON = """
ObjectTemplate.create Kit 1Rus_AssaultNaganta
ObjectTemplate.create SimpleObject Rus_RJcap_m2
ObjectTemplate.geometry Rus_RJcap_m2
GeometryTemplate.create StandardMesh Rus_RJcap_m2
ObjectTemplate.create FireArms NagantCarbine
ObjectTemplate.projectileTemplate NagantBullet
"""

# what only the level's own archive declares (203 Hill's grenade)
LEVEL_CON = """
ObjectTemplate.create FireArms GrenadeRus
ObjectTemplate.projectileTemplate GrenadeRusProjectile
GeometryTemplate.create StandardMesh Russian_hippack
"""


class StubArchive:
    entries = ["bf1942/levels/203_hill-1904/objects/kits.con"]

    def read(self, name):
        return LEVEL_CON.encode("latin-1")


class StubGame:
    ok = True

    def __init__(self, con=CHAIN_CON):
        self._lib = ObjectLibrary()
        self._lib.add_con("objects/test/objects.con", con)

    def library(self):
        return self._lib

    def level_archive(self, level):
        return StubArchive() if level.lower() == "203_hill-1904" else None


def write(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data))


def write_glb(p: Path, doc: dict) -> None:
    blob = json.dumps(doc).encode()
    blob += b" " * (-len(blob) % 4)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(blob))
                  + struct.pack("<II", len(blob), 0x4E4F534A) + blob)


class KitTree(unittest.TestCase):
    """A tree whose 203 Hill Russians lack their pack and their grenade rig."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.tree = A.Tree("fhsweurope", root / "models", root / "maps", root / "textures",
                           ["203_hill-1904"])
        write(self.tree.maps / "maps.json",
              [{"name": "203_hill-1904", "report": "203_hill-1904/scene.json",
                "loading": {"background": "x.webp"}}])
        write(self.tree.maps / "_shared" / "loadouts.json", {"levels": {"203_hill-1904": {
            "2": {"soldier": "RussianSoldier", "slots": {"0": "1Rus_AssaultNaganta"}}}}})
        write(self.tree.models / "kits.json", {"kits": [{
            "template": "1Rus_AssaultNaganta", "soldiers": ["RussianSoldier"],
            "worn": [
                {"template": "Rus_RJcap_m2", "geometry": "Rus_RJcap_m2", "slot": "head",
                 "glb": "Rus_RJcap_m2.kit.glb"},
                # declared by the level's own archive, never built: no kit look
                {"template": "Russian_hippack", "geometry": "Russian_hippack", "slot": "hip",
                 "glb": None},
                # declared nowhere: retail draws nothing there either
                {"template": "Ghost_cap", "geometry": "Ghost_cap", "slot": "head", "glb": None}],
            "items": [{"template": "NagantCarbine"}, {"template": "GrenadeRus"},
                      {"template": "Welrod"}, {"template": "scoldID7"}]}]})
        write(self.tree.models / "viewmodels" / "index.json", ["RussianSoldier__NagantCarbine"])

    def tearDown(self):
        self.tmp.cleanup()

    def causes(self):
        rows = P.run_kits(self.tree, StubGame(), {}, A.Finding)
        return {(r.cause, r.detail.split(":")[0]): r for r in rows}

    def test_a_level_declared_part_never_built_is_a_no_kit_look_blocker(self):
        f = self.causes()[("kit-worn-part-not-built", "Russian_hippack (hip)")]
        self.assertEqual("blocker", f.severity)
        self.assertEqual("203_hill-1904", f.level)
        self.assertIn("extract_kits.py", f.owning_script)
        self.assertTrue(f.is_failure())

    def test_a_part_whose_geometry_nothing_declares_is_accepted(self):
        f = self.causes()[("kit-worn-geometry-undeclared", "Ghost_cap (head)")]
        self.assertFalse(f.is_failure())

    def test_a_level_weapon_with_no_rig_is_named_by_where_it_is_declared(self):
        c = self.causes()
        f = c[("kit-level-weapon-no-rig", "RussianSoldier + GrenadeRus")]
        self.assertEqual("blocker", f.severity)
        self.assertIn("extract_viewmodel.py", f.owning_script)
        self.assertIn("the level declares it", f.detail)
        # declared nowhere: mod data, accepted
        self.assertFalse(c[("kit-weapon-template-undefined", "RussianSoldier + Welrod")].is_failure())
        # a rigged weapon and a slot filler say nothing
        self.assertFalse(any("NagantCarbine" in k[1] or "scold" in k[1] for k in c))

    def test_the_level_copy_of_a_kit_is_the_one_checked(self):
        kits = json.loads((self.tree.models / "kits.json").read_text())
        kits["kits"][0]["levelVariants"] = [{"levels": ["203_hill-1904"], "worn": [],
                                             "items": [{"template": "NagantCarbine"}]}]
        write(self.tree.models / "kits.json", kits)
        self.assertEqual({}, self.causes())

    def test_a_dealt_kit_kits_json_lacks_is_a_no_kit_look_blocker(self):
        # Road to Rome's inherited levels when kits.json held the pack's kits
        # alone (swrtr-asset-audit #3, promoted from the rules gate)
        write(self.tree.maps / "_shared" / "loadouts.json", {"levels": {"203_hill-1904": {
            "2": {"soldier": "RussianSoldier", "slots": {"0": "1Rus_AssaultNaganta",
                                                         "1": "1Rus_ScoutMosin"}}}}})
        c = self.causes()
        f = c[("level-kit-not-in-kits-json", "team 2 slot 1")]
        self.assertEqual(("1Rus_ScoutMosin", "blocker"), (f.subject, f.severity))
        self.assertIn("no kit look", A.PLAY_BREAKING[f.cause])
        self.assertFalse(any(k[0] == "level-kit-not-in-kits-json" and "slot 0" in k[1] for k in c))

    def test_a_level_the_tree_does_not_export_is_not_read(self):
        write(self.tree.maps / "maps.json", [{"name": "203_hill-1904",
                                              "report": "203_hill-1904/scene.json"}])
        self.assertEqual({}, self.causes())


VEHICLE_CON = """
ObjectTemplate.create PlayerControlObject T-34
ObjectTemplate.addTemplate T-34Complex
ObjectTemplate.create Bundle T-34Complex
ObjectTemplate.addTemplate T-34Hull
ObjectTemplate.addTemplate T-34Turret
ObjectTemplate.create SimpleObject T-34Hull
ObjectTemplate.geometry T-34Hull_m1
GeometryTemplate.create StandardMesh T-34Hull_m1
ObjectTemplate.create RotationalBundle T-34Turret
ObjectTemplate.setInputToYaw c_PIMouseLookX
ObjectTemplate.addTemplate T-34Cannon
ObjectTemplate.addTemplate T-34Selector
ObjectTemplate.create FireArms T-34Cannon
ObjectTemplate.projectileTemplate T-34Shell
ObjectTemplate.create RotationalBundle T-34Selector
ObjectTemplate.setMinRotation 0/0/-180
ObjectTemplate.setMaxRotation 0/0/0
ObjectTemplate.setMaxSpeed 0/0/900
ObjectTemplate.setInputToRoll c_PIThrottle
ObjectTemplate.geometry T-34Selector_m1
GeometryTemplate.create StandardMesh T-34Selector_m1
"""


def vehicle_glb(with_turret: bool, selector_axis: bool) -> dict:
    nodes = [{"name": "T-34", "children": [1]},
             {"name": "T-34Complex", "children": [2] + ([3] if with_turret else [])},
             {"name": "T-34Hull", "mesh": 0}]
    if with_turret:
        sel = {"name": "T-34Selector", "mesh": 1, "extras": {"templateKind": "RotationalBundle"}}
        if selector_axis:
            sel["extras"]["rig"] = {"axes": {"roll": {"input": "c_PIThrottle"}}}
        nodes += [{"name": "T-34Turret", "children": [4, 5]},
                  {"name": "T-34Cannon", "extras": {"fireArms": {}}}, sel]
    return {"asset": {"version": "2.0"}, "nodes": nodes}


class VehicleTree(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.models = Path(self.tmp.name)
        self.lib = ObjectLibrary()
        self.lib.add_con("objects/vehicles/land/t-34/objects.con", VEHICLE_CON)
        self.entries = [{"name": "T-34", "category": "land", "glb": "T-34.glb"}]

    def tearDown(self):
        self.tmp.cleanup()

    def run_with(self, doc, placed=frozenset({"t-34"})):
        write_glb(self.models / "T-34.glb", doc)
        return P.vehicle_findings(self.lib, self.entries, self.models, set(placed), A.Finding)

    def test_a_dropped_turret_with_its_cannon_is_a_blocker(self):
        rows = self.run_with(vehicle_glb(with_turret=False, selector_axis=True))
        self.assertEqual(["vehicle-part-missing"], [r.cause for r in rows])
        self.assertIn("T-34Turret", rows[0].detail)
        self.assertEqual("blocker", rows[0].severity)
        self.assertIn("assemble.py", rows[0].owning_script)

    def test_a_selector_without_its_held_key_axis_cannot_toggle(self):
        rows = self.run_with(vehicle_glb(with_turret=True, selector_axis=False))
        self.assertEqual(["vehicle-held-key-axis-missing"], [r.cause for r in rows])
        self.assertIn("c_PIThrottle", rows[0].detail)

    def test_the_whole_tree_is_clean_and_an_unplaced_vehicle_is_minor(self):
        self.assertEqual([], self.run_with(vehicle_glb(True, True)))
        rows = self.run_with(vehicle_glb(False, True), placed=frozenset())
        self.assertEqual(["minor"], [r.severity for r in rows])

    def test_a_dropped_hidden_spring_is_a_blocker(self):
        # the KettenKrad class: invisible Springs dropped, the hull lies on its back
        self.lib = ObjectLibrary()
        self.lib.add_con("objects/vehicles/land/t-34/objects.con", VEHICLE_CON.replace(
            "ObjectTemplate.addTemplate T-34Turret\n",
            "ObjectTemplate.addTemplate T-34Turret\nObjectTemplate.addTemplate T-34Spring1\n", 1)
            + "\nObjectTemplate.create Spring T-34Spring1\n")
        rows = self.run_with(vehicle_glb(True, True))
        self.assertEqual(["vehicle-part-missing"], [r.cause for r in rows])
        self.assertIn("T-34Spring1 (Spring", rows[0].detail)

    def test_a_part_kept_in_the_cockpit_glb_is_present(self):
        write_glb(self.models / "T-34.cockpit.glb", vehicle_glb(True, True))
        self.assertEqual([], self.run_with(vehicle_glb(False, True)))

    def test_a_reset_lever_and_a_duplicate_suffix_say_nothing(self):
        lib = ObjectLibrary()
        lib.add_con("x.con", VEHICLE_CON.replace(
            "ObjectTemplate.setInputToRoll c_PIThrottle",
            "ObjectTemplate.setInputToRoll c_PIThrottle\nObjectTemplate.setAutomaticReset 1"))
        self.lib = lib
        self.assertEqual([], self.run_with(vehicle_glb(True, False)))
        doc = vehicle_glb(True, True)
        doc["nodes"][3]["name"] = "T-34Turret_1"
        self.lib = ObjectLibrary()
        self.lib.add_con("x.con", VEHICLE_CON)
        self.assertEqual([], self.run_with(doc))


class RadioLanguage(unittest.TestCase):
    """FHSWEurope's Hungarians spoke American radio: no languages.json entry."""

    def test_a_dealt_soldier_with_no_language_or_no_voices_is_named(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            tree = A.Tree("fhsweurope", root / "models", root / "maps", root / "t", [])
            voices = tree.maps / "_shared" / "voices"
            (voices / "ger").mkdir(parents=True)
            write(voices / "languages.json", {"soldiers": {"germansoldier": "ger",
                                                           "romaniansoldier": "rom"}})
            lo = {"levels": {"hungary_forest": {
                "1": {"soldier": "GermanSoldier"}, "2": {"soldier": "HungarianSoldier"}},
                "bucharest": {"2": {"soldier": "RomanianSoldier"}}}}
            rows = {r.cause: r for r in A.radio_language_findings(tree, lo)}
            self.assertEqual({"soldier-radio-language-unmapped", "soldier-radio-nation-no-voices"},
                             set(rows))
            self.assertEqual("HungarianSoldier", rows["soldier-radio-language-unmapped"].subject)
            self.assertIn("chain_languages", rows["soldier-radio-language-unmapped"].owning_script)

    def test_a_soldier_whose_language_the_install_lacks_is_minor(self):
        # EoD's PathetLaosSoldier declares Italian; EoD -> bf1942 ships none.
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            tree = A.Tree("eod", root / "models", root / "maps", root / "t", [])
            voices = tree.maps / "_shared" / "voices"
            (voices / "us").mkdir(parents=True)
            write(voices / "languages.json", {"soldiers": {"ussoldier": "us"},
                                              "unvoiced": {"pathetlaossoldier": "Italian"}})
            lo = {"levels": {"h_mong": {"1": {"soldier": "PathetLaosSoldier"},
                                        "2": {"soldier": "USSoldier"}}}}
            rows = A.radio_language_findings(tree, lo)
            self.assertEqual(["soldier-radio-language-not-shipped"], [r.cause for r in rows])
            self.assertEqual("minor", rows[0].severity)

    def test_a_tree_behind_what_the_extractors_would_write_is_stale(self):
        # bf1918's tree: six vanilla nations where its own scripts speak ten more.
        import extract_capture_voices as cap
        import extract_ctf_voices as ctf
        import extract_radio as radio
        import extract_soldier_voices as sol
        now = {"nations": {"us": {"language": "UsEnglish", "stems": 68},
                           "austrian": {"language": "Austrian", "stems": 66}},
               "missing": [{"nation": "austrian", "stems": ["AbandonShip", "Roger"]}]}
        same = {"nations": {"us": {"language": "UsEnglish", "samples": ["Dying1"]}}, "missing": []}
        saved = (cap.extract, sol.extract, ctf.extract, radio.extract_voices,
                 cap.voice_pool, radio.soldier_languages)
        try:
            cap.extract = sol.extract = ctf.extract = lambda *a: same
            radio.extract_voices = lambda *a: now
            cap.voice_pool = lambda *a: None
            radio.soldier_languages = lambda pool, written: {"kuksoldier": "austrian",
                                                             "ussoldier": "us"}
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                tree = A.Tree("bf1918", root / "models", root / "maps", root / "t", [])
                voices = tree.maps / "_shared" / "voices"
                write(voices / "voices.json", same)
                write(voices / "radio-sounds.json",
                      {"nations": {"us": {"language": "UsEnglish", "stems": 68}}, "missing": []})
                write(voices / "languages.json", {"soldiers": {"ussoldier": "us"}})
                rows = A.voices_stale_findings(tree, "bf1918")
        finally:
            (cap.extract, sol.extract, ctf.extract, radio.extract_voices,
             cap.voice_pool, radio.soldier_languages) = saved
        stale = {r.subject: r for r in rows}
        self.assertEqual({"radio-sounds.json", "languages.json"}, set(stale))
        self.assertIn("new austrian", stale["radio-sounds.json"].detail)
        self.assertIn("kuksoldier None->austrian", stale["languages.json"].detail)
        self.assertIn("--mod bf1918 --only-steps voices ctf_voices", stale["languages.json"].owning_script)


class Words(unittest.TestCase):
    """A word the mod writes on a weapon that the reader has no branch for is
    behaviour the viewer cannot have (allowReloadOnEmptyClipOnly, FA-6)."""

    def test_a_new_weapon_word_is_major_and_a_known_one_is_listed(self):
        import census_weapon_words as cw
        census = cw.WordCensus(("firearms", "projectile"))
        census.add_con("objects/w.con", """
ObjectTemplate.create FireArms Faustpatrone42
ObjectTemplate.delayToUse 1
ObjectTemplate.setNetworkableInfo x
ObjectTemplate.someBrandNewWord 3
ObjectTemplate.create Projectile FaustProjectile
ObjectTemplate.anotherNewWord 1
""")
        verdicts = {"delaytouse": "open: unread", "setnetworkableinfo": "plumbing"}
        kind_of = {"somebrandnewword": "firearms", "anothernewword": "projectile"}
        rows = {r.subject: r for r in P.word_findings(census, verdicts, "plumbing", kind_of,
                                                      A.Finding)}
        self.assertEqual("major", rows["somebrandnewword"].severity)
        self.assertTrue(rows["somebrandnewword"].is_failure())
        self.assertEqual("minor", rows["anothernewword"].severity)
        self.assertEqual("word-declared-not-read-known", rows["delaytouse"].cause)
        self.assertFalse(rows["delaytouse"].is_failure())
        self.assertFalse(rows["setnetworkableinfo"].is_failure())

    def test_the_verdicts_are_the_tests_own(self):
        verdicts, plumbing = P.word_verdicts()
        self.assertTrue(plumbing)
        self.assertIn("networkableinfo", verdicts)


class Ranking(unittest.TestCase):
    def test_play_breaking_causes_are_blockers_and_rank_first(self):
        breaking = A.Finding("models", "kit-worn-glb-missing", "k", "")
        cosmetic = A.Finding("textures", "uv-constant", "x", "")
        plain = A.Finding("placement", "spawn-buried", "y", "")
        self.assertEqual("blocker", breaking.severity)
        self.assertLess(breaking.rank(), plain.rank())
        self.assertLess(plain.rank(), cosmetic.rank())  # accepted ranks last


if __name__ == "__main__":
    unittest.main()
