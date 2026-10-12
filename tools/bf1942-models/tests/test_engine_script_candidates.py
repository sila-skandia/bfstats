"""`extract_map.engine_script_candidates`: a vehicle's engines are asked in
turn, so a first Engine whose script cannot play no longer silences the hull.

FH's Ju 52 binds `Ju52Engine.ssc` on its first engine, a script that
`#include`s `High/EngineHigh.ssc`, a file the mod never shipped; engines 2 and
3 bind `Ju52Engine1.ssc`, which works. The walk used to stop at the first.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import extract_map as em  # noqa: E402


def node(name, kind, children=(), source="objects/v/Objects.con"):
    return SimpleNamespace(name=name, kind=kind, source=source, children=[
        SimpleNamespace(template=c, random_geometries=0) for c in children])


class Pool:
    def __init__(self, files: dict[str, str]):
        self.files = files

    def find(self, name):
        return name if name in self.files else None

    def read(self, name):
        return self.files[name].encode("latin-1")


class EngineCandidateTests(unittest.TestCase):
    def setUp(self):
        nodes = {n.name.lower(): n for n in (
            node("plane", "PlayerControlObject", ["e1", "e2", "e3"]),
            node("e1", "Engine"), node("e2", "Engine"), node("e3", "Engine"))}
        self.library = SimpleNamespace(objects=nodes)
        self.objects = Pool({"objects/v/Objects.con": (
            "ObjectTemplate.create Engine e1\n"
            "ObjectTemplate.loadSoundScript Sounds/Broken.ssc\n"
            "ObjectTemplate.create Engine e2\n"
            "ObjectTemplate.loadSoundScript Sounds/Works.ssc\n"
            "ObjectTemplate.create Engine e3\n"
            "ObjectTemplate.loadSoundScript Sounds/Works.ssc\n")})

    def test_every_bound_engine_is_a_candidate_in_walk_order(self):
        got = list(em.engine_script_candidates(self.library, self.objects, "plane"))
        self.assertEqual(
            [("objects/v/Sounds/Broken.ssc", "e1"),
             ("objects/v/Sounds/Works.ssc", "e2"),
             ("objects/v/Sounds/Works.ssc", "e3")], got)

    def test_find_engine_script_is_still_the_first(self):
        self.assertEqual(
            ("objects/v/Sounds/Broken.ssc", "e1"),
            em.find_engine_script(self.library, self.objects, "plane"))

    def test_a_vehicle_without_an_engine_has_no_candidate(self):
        self.library.objects["bare"] = node("bare", "SimpleObject")
        self.assertEqual(
            [], list(em.engine_script_candidates(self.library, self.objects, "bare")))
        self.assertIsNone(em.find_engine_script(self.library, self.objects, "bare"))


class PackedScriptTests(unittest.TestCase):
    """FHSW packs a folder of vehicles into one `!_PACK_*/Compressed.con`; the
    library files each template under the `Physics.con` / `Weapons.con` it was
    packed from, a file no archive holds. The template's own `loadSoundScript`
    (the library's `sound_script`) answers then: the M8 HMC's words."""

    def setUp(self):
        def packed(name, kind, script, children=(), projectile=None):
            n = node(name, kind, children, source=f"objects/Vehicles/Land/M8HMC/{script[0]}")
            n.sound_script = script[1]
            n.projectile_template = projectile
            return n
        hull = node("M8HMC", "PlayerControlObject", ["M8HMCEngine", "M8HMCGunBarrel"],
                    source="objects/Vehicles/Land/M8HMC/Objects.con")
        nodes = {n.name.lower(): n for n in (
            hull,
            packed("M8HMCEngine", "Engine", ("Physics.con", "../Engines/Sounds/White160AXEngine.ssc")),
            packed("M8HMCGunBarrel", "FireArms", ("Weapons.con", "../M8HMC/Sounds/M8HMCCannon.ssc")))}
        self.library = SimpleNamespace(objects=nodes)
        # The archive holds the pack, not the files the pack was made of.
        self.objects = Pool({"objects/Vehicles/Land/!_PACK_US/Compressed.con": ""})

    def test_an_engine_packed_out_of_its_file_keeps_its_script(self):
        self.assertEqual(
            [("objects/Vehicles/Land/Engines/Sounds/White160AXEngine.ssc", "M8HMCEngine")],
            list(em.engine_script_candidates(self.library, self.objects, "M8HMC")))

    def test_a_gun_packed_out_of_its_file_keeps_its_script(self):
        self.assertEqual(
            [("M8HMCGunBarrel", "objects/Vehicles/Land/M8HMC/Weapons.con",
              "objects/Vehicles/Land/M8HMC/Sounds/M8HMCCannon.ssc", False)],
            em.find_weapon_scripts(self.library, self.objects, "M8HMC"))

    def test_a_file_the_archive_holds_is_still_the_one_that_answers(self):
        # The declaring file binds nothing to the engine: the field is not asked.
        self.objects.files["objects/Vehicles/Land/M8HMC/Physics.con"] = (
            "ObjectTemplate.create Engine M8HMCEngine\n")
        self.assertEqual(
            [], list(em.engine_script_candidates(self.library, self.objects, "M8HMC")))


class LibraryPool(Pool):
    """`Pool`, with what `extract_models.build_library` asks besides."""

    def names(self):
        return list(self.files)

    def try_read(self, name):
        return self.read(name) if name in self.files else None


class PackedBesideItsOldFileTests(unittest.TestCase):
    """The name a pack's markers give a template's file can be a real file's.

    FHSW's `Stationary_Weapons/!_PACK_COMMON/Compressed.con` packs the
    stationary MG42's two FireArms under `rem folder = MG42_unlimited`, and
    `Stationary_Weapons/MG42_unlimited/Objects.con` is still in the archive:
    the older copy, which declares `MG42_unlimited` as one FireArms and nothing
    called `MG42_unlimited1`. Asked of that file the gun bound no script, the
    walk fell back to its round's, and the gun fired with the bullet's fly-by.
    """

    PACK = "objects/Stationary_Weapons/!_PACK_COMMON/Compressed.con"
    OLD = "objects/Stationary_Weapons/MG42_unlimited/Objects.con"

    def setUp(self):
        from extract_models import build_library
        self.objects = LibraryPool({
            self.PACK: (
                "rem folder = MG42_unlimited\n"
                "rem sauce = Objects.con\n"
                "ObjectTemplate.create Bundle MG42_unlimited\n"
                "ObjectTemplate.addTemplate MG42_unlimited1\n"
                "ObjectTemplate.addTemplate MG42_unlimited2\n"
                "ObjectTemplate.create FireArms MG42_unlimited1\n"
                "ObjectTemplate.projectileTemplate Bullet\n"
                "ObjectTemplate.velocity 755\n"
                "ObjectTemplate.loadSoundScript ../MG42_unlimited/Sounds/mg42.ssc\n"
                "ObjectTemplate.create FireArms MG42_unlimited2\n"
                "ObjectTemplate.projectileTemplate Bullet\n"
                "ObjectTemplate.velocity 755\n"
                "ObjectTemplate.create FireArms Rack\n"
                "ObjectTemplate.projectileTemplate Bullet\n"
                "ObjectTemplate.create Engine Motor\n"
                "ObjectTemplate.loadSoundScript ../Engines/Sounds/New.ssc\n"
                "rem folder = Common\n"
                "ObjectTemplate.create Projectile Bullet\n"
                "ObjectTemplate.loadSoundScript Sounds/projectile.ssc\n"),
            self.OLD: (
                "ObjectTemplate.create FireArms MG42_unlimited\n"
                "ObjectTemplate.loadSoundScript Sounds/mg42.ssc\n"
                "ObjectTemplate.create Engine Motor\n"
                "ObjectTemplate.loadSoundScript Sounds/Old.ssc\n"),
            "objects/Stationary_Weapons/MG42_unlimited/Sounds/mg42.ssc": (
                "newPatch\nload @ROOT/Sound/@RTD/silence.wav\n"
                "newPatch\nload @ROOT/Sound/@RTD/mg42_fire.wav\nloop\n"),
            "objects/Stationary_Weapons/Common/Sounds/projectile.ssc": (
                "newPatch\nload @ROOT/Sound/@RTD/bulletair1.wav\n"
                "beginEffect\ncontrolDestination Volume\ncontrolSource Distance\n"
                "envelope Ramp\nparam 10\nparam 10\nparam 1\nparam -1\nendEffect\n"
                "beginEffect\ncontrolDestination Volume\ncontrolSource Time\n"
                "envelope Ramp\nparam 0.075\nparam 0.075\nparam 0\nparam 1\nendEffect\n"
                "trigger Volume\n"
                "load @ROOT/Sound/@RTD/thump.wav\n"),
        })
        self.library = build_library(self.objects)

    def test_the_library_says_which_templates_came_out_of_a_pack(self):
        self.assertTrue(self.library.objects["mg42_unlimited1"].packed)
        self.assertEqual(self.OLD, self.library.objects["mg42_unlimited1"].source)

    def test_the_packed_gun_keeps_its_own_script(self):
        found = {name: (script, from_round) for name, _, script, from_round
                 in em.find_weapon_scripts(self.library, self.objects, "MG42_unlimited")}
        self.assertEqual(
            ("objects/Stationary_Weapons/MG42_unlimited/Sounds/mg42.ssc", False),
            found["MG42_unlimited1"])

    def test_the_pack_and_not_the_old_file_names_a_packed_engines_script(self):
        self.library.objects["hull"] = node("hull", "PlayerControlObject", ["Motor"])
        self.assertEqual(
            [("objects/Stationary_Weapons/Engines/Sounds/New.ssc", "Motor")],
            list(em.engine_script_candidates(self.library, self.objects, "hull")))

    def table(self, template):
        class Sounds:
            def __contains__(self, name):
                return True

            def read(self, name):
                return b""
        return em.extract_vehicle_sounds(
            self.library, self.objects, Sounds(), [template],
            lambda resolved: f"../_shared/sounds/{resolved[0]}")

    def test_a_bullets_fly_by_is_not_the_report_of_a_gun_with_no_script(self):
        # The second FireArms of the pair binds nothing, so its round's script
        # is asked (the bomb rack's rule). The fly-by opens 0.075 s on, when a
        # 755 m/s round is 57 m out and the layer has been shut since 10 m.
        (entry,) = self.table("MG42_unlimited")
        guns = {w["fireArms"]: [layer["file"].rsplit("/", 1)[-1].split(".")[0]
                                for layer in w["layers"]]
                for w in entry["weapons"]}
        self.assertEqual({"MG42_unlimited1": ["mg42_fire"],
                          "MG42_unlimited2": ["thump"]}, guns)

    def test_a_round_let_go_with_no_speed_is_heard_where_it_was_let_go(self):
        self.library.objects["hull"] = node("hull", "Bundle", ["Rack"])
        (entry,) = self.table("hull")
        self.assertEqual(
            ["bulletair1", "thump"],
            [layer["file"].rsplit("/", 1)[-1].split(".")[0]
             for layer in entry["weapons"][0]["layers"]])


if __name__ == "__main__":
    unittest.main()
