"""Faces and lip-sync (retail-inverse-gap-audit 2026-11-12, entry 64).

Retail's rules, each pinned here on the module the page loads
(`viewer/soldier-face.js`) and on the exporter (`extract_pose.py --faces`):

* **The head.** `BFSoldier::getLevelOfDetail` (lnxded `0x0826e080`) is
  `clamp(distance x fieldOfView / 500, 0, 1)` (`BFSoldierTemplate +0x19c`,
  `0x43fa0000` at `0x0827a2a2`); `updateVisibleSets` (`0x082707c0`) draws
  the animated head (`setLodValue 0.01`) at or under its value: 5 m at the
  default lens.
* **The machine.** `setDefaultAnimationStates` enters `FaceLook`; its idle
  timer is `(rand & 3) + 4` s and draws `rand() % 9` of its `addIdle` list
  (ANIM-6). `handleFrameUpdate` (`0x08271140`) plays the body states'
  `setOtherState c_AsmFaceState` each frame unless a line is queued.
* **A shout.** `speakLine` queues the lip-sync string; a symbol plays for
  0.1 s (`0x3dcccccd` at `0x08271763`), then 0.5 s (`0x3f000000` at
  `0x0827177b`) and `FaceLook`. The strings are the exe's five tables
  (client `0x006edfc0`..`0x006ee4d0`), read here straight from the jump
  tables when the client is installed; `getLipSync` is handed the side's
  soldier template name, which is none of its five, so UsEnglish's answers.
"""

from __future__ import annotations

import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
HARNESS = Path(__file__).with_name("soldier_face_harness.mjs")
CLIENT = Path.home() / ".cache/vimpact-game/BF1942.exe"

import extract_pose  # noqa: E402
from bf42 import pose as pose_mod  # noqa: E402
from bf42 import ske as ske_mod  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

_GAME = None


def game():
    """The vanilla pools and state machine, or a skip without the install."""
    global _GAME
    if _GAME is None:
        game_dir = Path(DEFAULT_GAME_DIR).expanduser()
        if not (game_dir / "Mods" / "bf1942" / "Archives" / "animations.rfa").exists():
            raise unittest.SkipTest("the vanilla archives are not installed")
        chain = extract_pose.mod_chain(game_dir, "bf1942")
        meshes, textures, objects, _ = extract_pose.build_pools(chain, [])
        _GAME = {"meshes": meshes, "textures": textures, "objects": objects,
                 "library": extract_pose.build_library(objects),
                 "machine": extract_pose.state_machine(meshes)}
    return _GAME


def run_harness(manifest: dict) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(manifest, handle)
    try:
        proc = subprocess.run(
            ["node", str(HARNESS), str(ROOT / "viewer"), handle.name],
            capture_output=True, text=True, timeout=120)
    finally:
        Path(handle.name).unlink(missing_ok=True)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def client_lip_sync() -> list[dict[int, str]]:
    """The five tables out of BF1942.exe: each function is `lea eax,[esi-29];
    cmp eax,25; ja; jmp [table + eax*4]`, each case a `push <string>`."""
    data = CLIENT.read_bytes()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    count = struct.unpack_from("<H", data, pe + 6)[0]
    opt = struct.unpack_from("<H", data, pe + 20)[0]
    base = struct.unpack_from("<I", data, pe + 24 + 28)[0]
    sections = [struct.unpack_from("<IIII", data, pe + 24 + opt + 40 * i + 8)
                for i in range(count)]

    def offset(va: int) -> int:
        for size, rva, raw_size, raw in sections:
            if base + rva <= va < base + rva + max(size, raw_size):
                return raw + va - base - rva
        raise AssertionError(hex(va))

    lo, hi = offset(0x6EDF80), offset(0x6EE620)
    tables = []
    for match in re.finditer(rb"\x8d\x46\xe3\x83\xf8\x19\x0f\x87....\xff\x24\x85(....)",
                             data[lo:hi], re.S):
        table = struct.unpack("<I", match.group(1))[0]
        rows: dict[int, str] = {}
        for k in range(26):
            at = offset(struct.unpack_from("<I", data, offset(table) + 4 * k)[0])
            if data[at] != 0x68:
                continue
            start = offset(struct.unpack_from("<I", data, at + 1)[0])
            rows[29 + k] = data[start:data.index(b"\0", start)].decode()
        tables.append(rows)
    return tables


class SoldierFaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = extract_pose.face_manifest(game()["machine"])
        cls.out = run_harness(cls.manifest)

    # -- the data --------------------------------------------------------- #

    def test_the_scripts_face_states(self) -> None:
        states = self.manifest["states"]
        self.assertEqual(self.manifest["base"], "FaceLook")
        self.assertEqual(states["FaceLook"]["idles"], [
            "FaceLook2", "FaceBlink", "FaceLook3", "FaceBlink", "FaceLook2",
            "FaceLook3", "FaceLook2", "FaceTalk", "FaceAngry1"])
        self.assertTrue(states["FaceLook"]["loop"])
        self.assertEqual(states["FaceBlink"]["then"], "FaceLook")
        # The dead faces return nowhere.
        self.assertNotIn("then", states["FaceDead1"])
        self.assertNotIn("then", states["FaceDead2"])
        self.assertEqual(self.manifest["symbols"], {
            ";": "Face_blink", "_": "Face_normal", "i": "Face_normal_i",
            "e": "Face_normal_e", "o": "Face_normal_o", "m": "Face_normal_m",
            "-": "Face_angry", "I": "Face_angry_i", "E": "Face_angry_e",
            "O": "Face_angry_o", "M": "Face_angry_m"})
        for name in self.manifest["symbols"].values():
            self.assertEqual(states[name]["speed"], 0.03, name)
            self.assertEqual(states[name]["morph"], 10.0, name)

    def test_the_body_states_that_name_a_face(self) -> None:
        body = self.manifest["bodyStates"]
        self.assertEqual(body["lb_diecheststand"], "FaceDead1")
        self.assertEqual(body["lb_diehead"], "FaceDead2")
        self.assertEqual(body["ub_hitcheststand"], "FaceHit")
        self.assertEqual(body["ub_explosionforward"], "FaceScream")
        self.assertEqual(body["ub_liefirethompson"], "FaceAim2")
        self.assertEqual(body["ub_standjumpthompson"], "FaceFire1")
        # Standing, a gun's fire names no face; the knife's does.
        self.assertNotIn("ub_firethompson", body)
        self.assertEqual(body["ub_fireknifeallies1"], "FaceFire1")
        self.assertEqual(body["ub_fireknifeaxis"], "FaceFire1")
        self.assertEqual(body["ub_firemedpack"], "FaceHeal")
        self.assertEqual(body["ub_standraiseweaponcolt"], "FaceLook2")
        self.assertNotIn("ub_firek98", body)

    def test_the_head_is_bound_in_the_base_clips_first_frame(self) -> None:
        """Chained down from the skin's own `Bip01 Head` bind, frame 0 of
        `FaceLook` lands every face bone on the bind the skin gives."""
        g = game()
        skeleton = extract_pose.read_skeleton(g["meshes"], "animations/UsFace.ske")
        skn = extract_pose.read_skin(g["meshes"], "animations/US1Face.skn")
        locals_map = extract_pose.face_bind_locals(g["machine"], g["meshes"], skeleton, 3)
        binds = pose_mod.refine_binds(skn)
        missing = [n for n in skn.bones if n not in binds]
        self.assertEqual(sorted(missing), ["Bone08", "Bone12", "Bone34", "Bone36"])

        def world(index: int):
            bone = skeleton.bones[index]
            if bone.name == "Bip01 Head":
                return binds["Bip01 Head"]
            return pose_mod.rt_mul(world(bone.parent), locals_map.get(
                ske_mod.canonical(bone.name), (bone.rotation, bone.translation)))

        checked = 0
        for name in skn.bones:
            index = skeleton.index(name)
            if name not in binds or index is None or index < 3:
                continue
            got = world(index)
            for axis in range(3):
                self.assertAlmostEqual(got[1][axis], binds[name][1][axis], delta=2e-4, msg=name)
            checked += 1
        self.assertEqual(checked, 18)
        extended = extract_pose.face_binds(skeleton, locals_map)(skn, binds)
        self.assertEqual([n for n in skn.bones if n not in extended], [])

    def test_the_export(self) -> None:
        g = game()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            faces = extract_pose.write_face_assets(
                g["machine"], ["USSoldier"], g["meshes"], g["textures"],
                g["objects"], g["library"], out, 256)
            row = faces["soldiers"]["USSoldier"]
            self.assertEqual(row["part"], "USSoldierComplexHead1")
            self.assertEqual(row["lodValue"], 0.01)
            self.assertEqual(row["heads"], [
                "faces/USSoldier.face.glb", "faces/USSoldier.face2.glb",
                "faces/USSoldier.face3.glb"])
            for rel in row["heads"]:
                self.assertTrue((out / rel).exists(), rel)
            blob = (out / row["head"]).read_bytes()
            doc = json.loads(blob[20:20 + struct.unpack_from("<I", blob, 12)[0]])
            names = [n["name"] for n in doc["nodes"]]
            self.assertEqual(names[:4], ["Bip01 Spine3", "Bip01 Neck", "Bip01 Head", "Face_face"])
            # No face bone keeps a name a body bone has (`Bone07`..`Bone09`).
            self.assertEqual([n for n in names if n.startswith("Bone")], [])
            self.assertEqual(len(doc["skins"][0]["joints"]), 24)
            clips = (out / row["clips"]).read_bytes()
            cdoc = json.loads(clips[20:20 + struct.unpack_from("<I", clips, 12)[0]])
            self.assertEqual({a["name"] for a in cdoc["animations"]},
                             set(self.manifest["states"]))
            self.assertEqual(cdoc["extras"]["errors"], {})

    # -- the page's module ------------------------------------------------ #

    def test_constants(self) -> None:
        self.assertEqual(self.out["constants"], {
            "lodDistance": 500, "lodValue": 0.01, "base": "FaceLook",
            "viseme": 0.1, "rest": 0.5, "idleBase": 4})

    def test_the_head_is_drawn_inside_five_metres(self) -> None:
        gate = self.out["gate"]
        self.assertTrue(gate["at4"])
        self.assertTrue(gate["at5"])
        self.assertFalse(gate["at5_01"])
        self.assertTrue(gate["zoomed9"])
        self.assertFalse(gate["zoomed11"])
        self.assertEqual(gate["lod250"], 0.5)
        self.assertEqual(gate["lodFar"], 1)
        self.assertAlmostEqual(gate["fov1rad"], 1.0, places=9)

    def test_lip_sync_tables_are_the_exes(self) -> None:
        tables = self.out["lipSync"]
        self.assertEqual(tables["UsEnglish"]["39"], "IE-OEIOOOOO;-")
        self.assertEqual(tables["German"]["40"], "Eim_;i_om_iioie_")
        for name in tables:
            self.assertEqual(sorted(int(k) for k in tables[name]),
                             [29, 30, 31, 32, *range(36, 50), 51, 52, 53, 54], name)
        if not CLIENT.exists():
            self.skipTest("BF1942.exe is not installed")
        exe = client_lip_sync()
        self.assertEqual(len(exe), 5)
        order = ["UsEnglish", "English", "Russian", "German", "Japanese"]
        for name, rows in zip(order, exe):
            self.assertEqual({int(k): v for k, v in tables[name].items()}, rows, name)

    def test_get_lip_sync_is_handed_the_team_skin(self) -> None:
        got = self.out["lipSyncFor"]
        self.assertEqual(got["germanSoldier29"], "i_eoimie")   # UsEnglish's
        self.assertEqual(got["german29"], "ieoi;mio-e")
        self.assertEqual(got["usSoldier40"], "MIMI")
        self.assertEqual(got["none33"], "")
        self.assertEqual(got["proto"], "i_eoimie")

    def test_the_body_names_the_face(self) -> None:
        self.assertEqual(self.out["body"], {
            "fireThompson": None, "fireKnife": "FaceFire1",
            "fireKnifeAxis": "FaceFire1", "fireK98": None,
            "lieFireK98": "FaceAim2",
            "fireMedPack": "FaceHeal", "fireExpPack": "FaceFun1", "fireNoWeapon": None,
            "die": "FaceDead1", "dieHead": "FaceDead2", "hit": "FaceHit",
            "blast": "FaceScream", "landed": "FaceScream", "jump": "FaceFire1",
            "draw": "FaceLook2", "stand": None})

    def test_the_head_a_soldier_wears(self) -> None:
        """Retail rolls one of three off a process-wide round-robin counter
        (`addBundleChilds`, lnxded 0x081a8300; KIT-2): an even spread, not
        the same on two clients. The page keeps the spread and keys the pick
        on the soldier, so a replay and every screen draw the same head."""
        heads = self.out["heads"]
        self.assertEqual(sum(heads["tally"]), 300)
        for count in heads["tally"]:
            self.assertGreater(count, 70)
        self.assertEqual(heads["again"][0], heads["again"][1])
        self.assertEqual(heads["one"], 1)
        self.assertEqual(heads["anonymous"], 1)
        self.assertEqual(len(set(heads["slots"])), 3)

    def test_every_rolled_head_is_exported(self) -> None:
        g = game()
        heads, lod = extract_pose.face_head_part(g["library"], "USSoldier")
        self.assertEqual([h.name for h in heads], [
            "USSoldierComplexHead1", "USSoldierComplexHead2", "USSoldierComplexHead3"])
        self.assertEqual(lod, 0.01)

    def test_the_idle_timer_and_its_draw(self) -> None:
        log = self.out["idle"]["log"]
        self.assertEqual(log[0], [0, "FaceLook"])
        # Armed to 4 s on the first update, the blink drawn when it runs out.
        self.assertEqual(log[1][1], "FaceBlink")
        self.assertAlmostEqual(log[1][0], 4.0, delta=0.05)
        # The blink is `USFaceBlink01.baf` at 2.0: half a second, then back.
        self.assertEqual(self.out["idle"]["blinkSeconds"], 0.5)
        self.assertEqual(log[2][1], "FaceLook")
        self.assertAlmostEqual(log[2][0] - log[1][0], 0.5, delta=0.05)
        # The next timer was 7 s and its draw the ninth idle.
        self.assertEqual(log[3][1], "FaceAngry1")
        self.assertAlmostEqual(log[3][0] - log[2][0], 7.0, delta=0.05)

    def test_a_shout(self) -> None:
        log = self.out["shout"]["log"]
        self.assertEqual([name for _t, name in log], [
            "Face_normal_i", "Face_normal", "Face_normal_e", "Face_blink", "FaceLook"])
        times = [t for t, _name in log]
        for a, b in zip(times, times[1:4]):
            self.assertAlmostEqual(b - a, 0.1, delta=0.015)
        self.assertAlmostEqual(times[4] - times[3], 0.5, delta=0.015)
        rules = self.out["shoutRules"]
        self.assertEqual(rules["afterUnknown"], "FaceLook")
        self.assertEqual(rules["afterO"], "Face_normal_o")
        # A queued line keeps the body's state off the face; then it lands.
        self.assertEqual(rules["gated"], "Face_normal_o")
        self.assertTrue(rules["sawM"])
        self.assertEqual(rules["afterLine"], "FaceHit")

    def test_the_bodys_state_is_played_every_frame(self) -> None:
        rules = self.out["bodyRules"]
        # 2.5 s under `FaceHit` (1 s, -> FaceLook): entered, returned, entered.
        self.assertEqual(rules["hitEnters"], 3)
        self.assertEqual(rules["looks"], 2)
        self.assertEqual(rules["dead"], "FaceDead1")
        self.assertEqual(rules["deadPhase"], 1)
        self.assertEqual(rules["deadW"], 1)

    def test_the_overlay_morphs_from_where_the_bone_stands(self) -> None:
        frames = self.out["overlay"]["frames"]
        self.assertEqual(frames[0]["state"], "Face_normal_o")
        # Weight 0 on the frame the state is entered, then 10 a second.
        self.assertEqual(frames[0]["angle"], 0)
        angles = [f["angle"] for f in frames]
        self.assertEqual(angles, sorted(angles))
        self.assertAlmostEqual(angles[-1], 90, delta=0.5)
        self.assertAlmostEqual(frames[-1]["y"], 0.02, delta=2e-4)


if __name__ == "__main__":
    unittest.main()
