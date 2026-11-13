"""`poses/stances.json`: a soldier's skeleton in each stance, exported so the
room server and the headless runner meet the body the page draws without a
glb (`bf42/stance.py`, `extract_stances.py`, `server/soldier-capsules.mjs`).

The bots aim at that skeleton's bones (ledger AI-123, AI-185) and every round
is tested on the capsules hung on it (DIE-10), so the bot judges that run the
runner score the fight a player meets.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

from bf42 import stance

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "stance_bodies_harness.mjs"


def glb(doc: dict, blob: bytes = b"") -> bytes:
    text = json.dumps(doc).encode()
    text += b" " * (-len(text) % 4)
    blob += b"\0" * (-len(blob) % 4)
    body = struct.pack("<II", len(text), 0x4E4F534A) + text
    if blob:
        body += struct.pack("<II", len(blob), 0x004E4942) + blob
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body


def rig_nodes() -> list[dict]:
    """A holder, the rig's root, and four bones: `Bip01` 1 m up, a spine and a
    head over it, a hip pack behind; and a helmet that is no bone."""
    return [
        {"name": "holder", "children": [1]},
        {"name": "rig", "extras": {"rigRoot": True}, "children": [2]},
        {"name": "Bip01", "translation": [0, 1, 0], "extras": {"joint": True}, "children": [3, 5]},
        {"name": "Bip01 Spine", "translation": [0, 0.3, 0], "extras": {"joint": True}, "children": [4]},
        {"name": "Bip01 Head", "translation": [0, 0.3, 0], "extras": {"joint": True}, "children": [6]},
        {"name": "HipPack", "translation": [0, 0, -0.2], "extras": {"joint": True}},
        {"name": "helmet", "translation": [0, 0.1, 0]},
    ]


class StanceBodyTests(unittest.TestCase):
    def test_a_recipe_poses_the_rig_in_each_stance(self) -> None:
        recipe = {
            "rig": "rigs/A.rig.glb", "root": {"q": [0, 0, 0, 1]},
            "joints": {"bip01 spine": [0, 0, 0, 1, 0, 0.4, 0]},
            "clips": {
                "stand": {"still": {}},
                "crouch": {"still": {"bip01": [0, 0, 0, 1, 0, 0.5, 0]}},
                # Lying: the root turned a quarter about X, 0.2 m up.
                "lie": {"still": {"Bip01": [0.7071068, 0, 0, 0.7071068, 0, 0.2, 0]}},
            },
        }
        body = stance.body_from_recipe({"nodes": rig_nodes()}, recipe)
        self.assertEqual(body["names"], ["Bip01", "Bip01 Spine", "Bip01 Head", "HipPack"])
        self.assertEqual(body["stand"]["bones"], [[0, 1, 0], [0, 1.4, 0], [0, 1.7, 0], [0, 1, -0.2]])
        # A bone's parent is the node it hangs from: the root's is the rig.
        self.assertEqual(body["stand"]["parents"], [[0, 0, 0], [0, 1, 0], [0, 1.4, 0], [0, 1, 0]])
        self.assertEqual(body["crouch"]["bones"][2], [0, 1.2, 0])
        head = body["prone"]["bones"][2]
        for got, want in zip(head, [0, 0.2, 0.7]):
            self.assertAlmostEqual(got, want, places=4)

    def test_a_single_file_pose_takes_each_stance_from_its_clip(self) -> None:
        blob = struct.pack("<3f", 0, 0.5, 0) + struct.pack("<f", 0)
        doc = {
            "nodes": rig_nodes(),
            "buffers": [{"byteLength": len(blob)}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 12},
                            {"buffer": 0, "byteOffset": 12, "byteLength": 4}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"},
                          {"bufferView": 1, "componentType": 5126, "count": 1, "type": "SCALAR"}],
            "animations": [
                {"name": "stand", "channels": [], "samplers": []},
                {"name": "crouch", "samplers": [{"input": 1, "output": 0}],
                 "channels": [{"sampler": 0, "target": {"node": 2, "path": "translation"}}]},
                {"name": "lie", "channels": [], "samplers": []},
            ],
        }
        body = stance.body_from_glb(doc, blob)
        self.assertEqual(body["stand"]["bones"][2], [0, 1.6, 0])
        self.assertEqual(body["crouch"]["bones"][2], [0, 1.1, 0])

    def test_a_kit_weapon_is_posed_before_a_seat(self) -> None:
        index = {"recipe": [], "glb": ["A__PassengerInWilly", "B__PassengerInWilly", "A__K98", "A__Colt", "B__Colt"]}
        kits = {"kits": [{"primary": "K98", "items": [{"template": "K98"}, {"template": "colt"}]}]}
        order = stance.candidates(index, kits)
        self.assertEqual([stem for _, stem in order["A"]], ["A__K98", "A__Colt", "A__PassengerInWilly"])
        self.assertEqual([stem for _, stem in order["B"]], ["B__Colt", "B__PassengerInWilly"])
        # A recipe before a single file, whatever it holds.
        mixed = stance.candidates({"recipe": ["A__Knife"], "glb": ["A__K98"]}, kits)
        self.assertEqual(mixed["A"][0], ("recipe", "A__Knife"))

    def test_the_tree_is_written_and_read_back_by_the_server_and_the_runner(self) -> None:
        if shutil.which("node") is None:
            self.skipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            poses = Path(tmp) / "models" / "poses"
            (poses / "rigs").mkdir(parents=True)
            (poses / "rigs" / "A.rig.glb").write_bytes(glb({"nodes": rig_nodes()}))
            recipe = {"rig": "rigs/A.rig.glb", "joints": {},
                      "clips": {"stand": {"still": {}}, "crouch": {"still": {}}, "lie": {"still": {}}}}
            (poses / "ASoldier__K98.pose.json").write_text(json.dumps(recipe))
            # A seat's pose alone: no stance clips, no body of his own.
            (poses / "BSoldier__PassengerInWilly.pose.glb").write_bytes(glb({"nodes": rig_nodes(), "animations": []}))
            doc = stance.write(poses)
            self.assertEqual(doc["format"], "bf1942-stance-bodies/1")
            self.assertEqual(list(doc["soldiers"]), ["ASoldier"])
            self.assertEqual(doc["default"], 0)
            self.assertTrue((poses / "stances.json").exists())
            proc = subprocess.run(["node", str(HARNESS), str(poses.parent), "asoldier", "BSoldier"],
                                  capture_output=True, text=True, timeout=120, cwd=ROOT)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.loads(proc.stdout)
        a = out["asoldier"]                      # found whatever his name's case
        self.assertTrue(a["posed"])
        self.assertEqual(len(a["bones"]), 4)
        self.assertEqual(a["bones"][2], [0, 1.6, 0])
        # The head's capsule: the bone-to-parent segment, moved two lengths up.
        head = a["capsules"][0]
        self.assertEqual(head["material"], 40)
        self.assertEqual([round(v, 4) for v in head["a"]], [0, 1.9, 0])
        self.assertEqual([round(v, 4) for v in head["b"]], [0, 2.2, 0])
        # Where he stands in the world.
        self.assertEqual([round(v, 4) for v in a["world"]], [10, 1.9, 20])
        # The seat-only soldier takes the tree's shared body.
        self.assertTrue(out["BSoldier"]["posed"])
        self.assertEqual(out["BSoldier"]["bones"], a["bones"])


if __name__ == "__main__":
    unittest.main()
