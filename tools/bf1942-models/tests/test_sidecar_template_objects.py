"""Template classes, hull specs, hulls and soldiers computed from the install.

The UDP sidecar names and classes each CreateObject's template id from the
level load it replays (bf42/template_table.py), and takes every layout a ghost
body depends on from the same load's template graph (`object_graph` ->
sidecar/ghost/derive-children.mjs `deriveLevel`): a hull's child
networkables and their widths, its hit point maximum (HP-17) and mobility
(PHY-17), its turning parts and their pivots, a soldier's hit points and aim
limits. Nothing comes from a lab capture or an export of ours any more
(wire.md section 26, ledger LOAD-19).

- ClassRuleTests / GraphTests: the console and class manager rules, no
  install needed.
- CorpusTests: every object a real round named
  (fixtures/sidecar_object_corpus.json: 40 tables, vanilla, Desert Combat,
  FHSW, FHSWEurope and Secret Weapons, lab server and bf42plus client
  recordings) through the live path, a BodyDecoder fed ServerInfo, SetLevel
  and CreateObject: each gets its recorded name, a class, a hull spec with
  readable children, the hit point maximum the server recorded, and turning
  parts the recording names; and the Wake class map (sidecar/classes.json)
  and the vanilla soldier constants agree with the computed ones.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42 import template_table as tt  # noqa: E402

HERE = Path(__file__).resolve().parent
GAME_DIR = Path(os.environ.get("BF1942_DIR") or Path.home() / ".wine/drive_c/EA Games/Battlefield 1942")


class Files:
    def __init__(self, files: dict[str, str]) -> None:
        self.files = {k.lower(): v for k, v in files.items()}

    def read(self, path: str) -> str | None:
        import posixpath
        return self.files.get(posixpath.normpath(path).lower())


def load(text: str, graph: bool = True) -> tt.Console:
    console = tt.Console(Files({"a.con": text}), graph=graph)
    console.run("a.con", [])
    return console


class ClassRuleTests(unittest.TestCase):
    def test_a_create_word_is_the_first_registered_class_it_starts(self):
        # getClassIDFromTemplateClassName 0x081d63e0: strncasecmp over the
        # word's length, in class-id order.
        self.assertEqual(tt.template_class("SpriteParticle"), "SpriteParticle")
        self.assertEqual(tt.template_class("TimerObjective"), "TimerObjectiveTemplate")
        self.assertEqual(tt.template_class("DestroyTargetObjective"), "DestroyTargetObjectiveTemplate")
        self.assertEqual(tt.template_class("simple"), "SimpleObject")
        self.assertEqual(tt.template_class("bundle"), "Bundle")
        self.assertEqual(tt.template_class("Kit"), "Kit")             # 0x9496 before KitPart 0x94a3
        self.assertEqual(tt.template_class("Flag"), "Flag")           # 0x949a before FlagBase 0x94a2
        self.assertEqual(tt.template_class("FireArms"), "FireArms")   # before FireArmsBundle
        self.assertEqual(tt.template_class("PlayerControlObject"), "PlayerControlObject")
        for typo in ("simepleobject", "ho-ru_hull_addcol", "entrypointwz1897entry", ""):
            self.assertIsNone(tt.template_class(typo))

    def test_an_unknown_class_creates_nothing_and_takes_no_id(self):
        c = load("ObjectTemplate.create SimepleObject A\nObjectTemplate.create Bundle B\n")
        self.assertEqual(c.names, ["ObjectManagerCamera", "B"])
        self.assertEqual(c.classes, ["Camera", "Bundle"])


class GraphTests(unittest.TestCase):
    def test_the_graph_holds_what_the_load_configures(self):
        c = load("""
NetworkableInfo.createNewInfo HullInfo
NetworkableInfo.createNewInfo SpringInfo
NetworkableInfo.setIsUnique 1
NetworkableInfo.createNewInfo GunInfo
NetworkableInfo.setForceNetworkableId 1
ObjectTemplate.create PlayerControlObject Tank
ObjectTemplate.setNetworkableInfo HullInfo
ObjectTemplate.hasArmor 1
ObjectTemplate.setHitPoints 300
ObjectTemplate.maxHitPoints 300
ObjectTemplate.addTemplate TankTurret
ObjectTemplate.setPosition 0/1.5/0.25
ObjectTemplate.setRotation 180/0/0
ObjectTemplate.create RotationalBundle TankTurret
ObjectTemplate.setInputToYaw c_PIMouseLookX
ObjectTemplate.create PlayerControlObject Tank
ObjectTemplate.hasArmor 0
ObjectTemplate.active Tank
ObjectTemplate.hasMobilePhysics 1
""")
        tank = c.templates["tank"]
        self.assertEqual(tank["cls"], "PlayerControlObject")
        self.assertEqual(tank["info"], "HullInfo")
        # `setHitPoints` is `hitPoints` (CON-15); the redeclaration's
        # `hasArmor 0` configures nothing (LOAD-1); `active` reopens.
        self.assertEqual(tank["props"]["hitpoints"], [["300"]])
        self.assertEqual(tank["props"]["hasarmor"], [["1"]])
        self.assertEqual(tank["props"]["hasmobilephysics"], [["1"]])
        self.assertEqual(tank["children"], [["TankTurret", [0.0, 1.5, 0.25], [180.0, 0.0, 0.0]]])
        self.assertEqual(c.unique_infos, {"springinfo"})
        self.assertEqual(c.forced_infos, {"guninfo"})
        g = tt.object_graph(c)
        self.assertEqual(sorted(t[0] for t in g["templates"]), ["Tank", "TankTurret"])

    def test_derive_level_applies_the_engine_rules(self):
        graph = {
            "templates": [
                ["Tank", "PlayerControlObject", "HullInfo",
                 {"hasarmor": [["1"]], "hitpoints": [["100"]], "maxhitpoints": [["200"]]},
                 [["Turret", [0, 1, 0], [-180, 0, 0]], ["Lod", None, None]]],
                ["Lod", "LodObject", None, {}, [["Engine", None, None], ["Gun2", None, None], ["Shell", None, None]]],
                ["Engine", "Engine", "EngInfo", {"setnumberofgears": [["4"]]}, []],
                ["Turret", "RotationalBundle", "RbInfo", {"setinputtoyaw": [["c_PIMouseLookX"]]},
                 [["Barrel", [0, 0.5, 1], None]]],
                ["Barrel", "RotationalBundle", "RbInfo", {"setinputtopitch": [["c_PIMouseLookY"]]},
                 [["Gun", None, None]]],
                ["Gun", "FireArms", "GunInfo", {"magsize": [["30"]], "numofmag": [["1"]], "roundoffire": [["0.5"]]}, []],
                ["Gun2", "HandFireArms", "HandInfo", {}, []],
                ["Shell", "Projectile", "ShellInfo", {}, []],
                ["Gunner", "BFSoldier", "SoldierInfo",
                 {"hitpoints": [["4.2"]], "setturnleftrightangle": [["20.0", "-14.0"]]}, []],
            ],
            "infos": ["hullinfo", "enginfo", "rbinfo", "guninfo", "handinfo", "shellinfo", "soldierinfo"],
            "unique": [], "forced": ["handinfo"],
        }
        script = ("import('" + (ROOT / "sidecar/ghost/derive-children.mjs").as_uri() + "').then(m => "
                  "console.log(JSON.stringify(m.deriveLevel(JSON.parse(process.argv[1])))))")
        out = json.loads(subprocess.run(["node", "-e", script, json.dumps(graph)], capture_output=True,
                                        text=True, check=True).stdout)
        spec = out["specs"]["Tank"]
        # The forced-id hand weapon and the parented projectile are left out.
        self.assertEqual(spec["children"], ["R", "R", "F", "E"])
        self.assertEqual(spec["gearBits"], 3)
        self.assertEqual(spec["mags"], [[6, 2]])            # as the Sherman's magSize 30
        self.assertEqual(spec["joints"], {"0": [["Turret", "yaw", 180], ["Barrel", "pitch"]]})
        # HP-17: max(min(200, 128), 100); a clear hasMobilePhysics is static.
        self.assertEqual(out["hulls"]["Tank"]["maxHp"], 128)
        self.assertEqual(spec["hpBits"], 8)
        self.assertIs(out["hulls"]["Tank"]["mobile"], False)
        self.assertEqual(out["hulls"]["Tank"]["parts"], {"Turret": [0, 1, 0], "Barrel": [0, 1.5, 1]})
        # Words are stored ceil'd, an unset one is 10.
        self.assertEqual(out["soldiers"]["Gunner"], {"maxHp": 10, "aimTwist": 20, "aimPitch": None})


class CorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (GAME_DIR / "Mods").is_dir():
            raise unittest.SkipTest("the BF1942 install is not on this machine")
        # The shared cache (~/.cache/bfstats-sidecar unless SIDECAR_CACHE
        # says otherwise): keyed on the archives read and the code that
        # computes it, so a warm one is as good as a fresh one.
        proc = subprocess.run(["node", str(HERE / "sidecar_template_objects_harness.mjs")],
                              capture_output=True, text=True, check=True)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_every_recorded_object_gets_its_name_class_spec_and_hit_points(self):
        mods = set()
        for key, t in self.r["tables"].items():
            with self.subTest(table=key):
                self.assertTrue(t["computed"])
                self.assertEqual(t["misses"], [])
                self.assertEqual(t["named"], t["objects"])
                self.assertEqual(t["classed"], t["objects"])
                self.assertEqual(t["maxhpAgree"], t["maxhp"])
                self.assertEqual(t["jointsRecorded"], t["joints"])
                self.assertEqual(t["jointsPivot"], t["joints"])
                if t["objects"]:
                    mods.add(key.split("|")[0])
        self.assertTrue({"bf1942", "desertcombat", "fhsw", "fhsweurope", "xpack2"} <= mods, mods)
        total = lambda k: sum(t[k] for t in self.r["tables"].values())  # noqa: E731
        self.assertGreater(total("objects"), 1700)
        self.assertGreater(total("specs"), 750)
        self.assertGreater(total("maxhp"), 850)
        self.assertGreater(total("joints"), 1000)

    def test_mod_vehicles_get_specs(self):
        for key in ("desertcombat|el_alamein|coop", "fhsw|operation_springawakening|conquest",
                    "fhsweurope|bombing_the_reich-1945|coop"):
            with self.subTest(table=key):
                t = self.r["tables"][key]
                self.assertGreater(t["specs"], 20)
                self.assertGreater(t["seats"], 20)

    def test_the_wake_class_map_is_what_the_computed_table_says(self):
        w = self.r["wake"]
        self.assertEqual(w["misses"], [])
        self.assertEqual(len(w["byTidAgree"]), w["byTid"])
        self.assertEqual(w["byTid"], 24)
        self.assertEqual(w["byNetIdAgree"], w["byNetId"])

    def test_the_vanilla_soldier_constants_are_the_computed_ones(self):
        for name, s in self.r["soldiers"].items():
            with self.subTest(soldier=name):
                self.assertEqual(s, self.r["soldierConstants"])


if __name__ == "__main__":
    unittest.main()
