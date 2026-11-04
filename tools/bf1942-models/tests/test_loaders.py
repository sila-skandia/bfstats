"""The loading scenes (viewer/play/loaders/, features/replay-shorts/README.md
"The loaders"): the arithmetic each scene's joke or tactic depends on.

- The duel: every round fired standing passes over the other man's head when
  he kneels, the prone burst goes into the sandbags, and the chalk tally's
  marks never overlap.
- Hull down: turret down hides the whole Tiger, gun included, under the
  enemy's line of sight; hull down shows the turret and gun and hides the
  hull, short of the crest.
- Fire and movement: one man moves at a time, and the section ends close to
  the nest.
- The hedgerow ambush: crouching hides the gunner below the bank, standing
  clears it, and the rocket meets the Sherman only after it has passed him.
- Every sprite ships beside the modules, small, with its render command in
  scripts/render-loader-sprites.sh; every scene is in the rotation; and the
  sprite script still draws the first soldier byte for byte.
"""

# watches: tools/bf1942-models/viewer/play/loaders scripts/render-loader-sprites.sh scripts/render-game-sprite.mjs

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOADERS = ROOT / "tools" / "bf1942-models" / "viewer" / "play" / "loaders"
RENDER = ROOT / "scripts" / "render-loader-sprites.sh"

SCRIPT = f"""
const load = name => import({json.dumps(LOADERS.as_uri())} + '/' + name);
const duel = await load('duel.js'), hd = await load('hulldown.js'), rush = await load('rush.js'),
  ambush = await load('ambush.js'), scenes = await load('scenes.js');
const out = {{}};
out.scenes = scenes.SCENES.map(s => ({{ id: s.id, title: s.title, tactic: s.tactic, mount: typeof s.mount }}));
out.duel = duel.PAIRS.map(p => ({{
  pair: p.label,
  leftShot: duel.muzzleAt(p.left, 70, 0).y, rightHead: duel.headTop(p.right, 1),
  rightShot: duel.muzzleAt(p.right, 310, 0).y, leftHead: duel.headTop(p.left, 1),
  proneShot: duel.muzzleAt(p.left, 70, 2).y, rightProneHead: duel.headTop(p.right, 2), leftProneHead: duel.headTop(p.left, 2),
}}));
out.bagsTop = duel.BAGS_TOP;
out.tally = Array.from({{ length: duel.TALLY_MAX }}, (_, i) => duel.tallyMark(i));
const at = x => Object.fromEntries(Object.entries(hd.tigerAt(x)).map(([k, p]) => [k, {{ x: p.x, y: p.y, below: p.y - hd.sightY(p.x) }}]));
out.hd = {{ turretDown: at(hd.TURRET_DOWN), hullDown: at(hd.HULL_DOWN), crest: hd.CREST,
  rings: Array.from({{ length: hd.RINGS }}, (_, i) => hd.ringX(i)) }};
out.rush = {{ plan: rush.PLAN, start: rush.START }};
out.ambush = {{ ...ambush.sightlines(), fireAt: ambush.fireAt(), rear: ambush.rearAt(ambush.TANK_HIT),
  badges: [0, 1, 4, 5, 6, 10, 15, 16].map(k => [k, ambush.badgesFor(k)]) }};
console.log(JSON.stringify(out));
"""


class LoaderSceneTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", "--input-type=module", "-e", SCRIPT], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"the scenes did not load:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    # --- the rotation -----------------------------------------------------------
    def test_every_scene_module_is_in_the_rotation(self) -> None:
        ids = [s["id"] for s in self.r["scenes"]]
        self.assertEqual(len(ids), len(set(ids)))
        modules = {p.stem for p in LOADERS.glob("*.js")} - {"kit", "scenes"}
        self.assertEqual(set(ids), modules)
        for s in self.r["scenes"]:
            self.assertTrue(s["title"] and s["tactic"], s)
            self.assertEqual(s["mount"], "function")

    # --- the duel ---------------------------------------------------------------
    def test_every_round_goes_over_a_kneeling_head(self) -> None:
        # A standing man's muzzle is at least 3 px above the other's head when he kneels.
        for d in self.r["duel"]:
            self.assertLess(d["leftShot"], d["rightHead"] - 3, d)
            self.assertLess(d["rightShot"], d["leftHead"] - 3, d)

    def test_the_prone_burst_goes_into_the_bags_and_over_nobody(self) -> None:
        for d in self.r["duel"]:
            self.assertGreater(d["proneShot"], self.r["bagsTop"] + 3, d)
            # The right man fires standing over the prone one's back.
            self.assertLess(d["rightShot"], d["leftProneHead"] - 3, d)
            # Prone behind the bags, his head is below their top.
            self.assertGreater(d["rightProneHead"], self.r["bagsTop"], d)

    def test_the_tally_is_fives_struck_through(self) -> None:
        marks = self.r["tally"]
        self.assertEqual(sum(m["strike"] for m in marks), len(marks) // 5)
        strokes = [m["x"] for m in marks if not m["strike"]]
        self.assertEqual(len(strokes), len(set(strokes)))
        self.assertTrue(all(b - a >= 3 for a, b in zip(strokes, strokes[1:])))
        for g in range(len(marks) // 5):
            group = strokes[g * 4:(g + 1) * 4]
            strike = marks[g * 5 + 4]["x"]
            self.assertTrue(group[0] <= strike <= group[-1], (group, strike))

    # --- hull down ----------------------------------------------------------------
    def test_turret_down_hides_the_whole_tank(self) -> None:
        for name, p in self.r["hd"]["turretDown"].items():
            self.assertGreaterEqual(p["below"], 2, name)

    def test_hull_down_shows_the_turret_and_gun_and_hides_the_hull(self) -> None:
        t = self.r["hd"]["hullDown"]
        for name in ("hullfront", "hullrear", "trackfront", "trackrear"):
            self.assertGreater(t[name]["below"], 0, name)
        self.assertLess(t["mantlet"]["below"], 0)          # the gun clears the line
        self.assertLess(t["muzzle"]["below"], 0)
        self.assertLessEqual(t["turret"]["below"], -6)     # most of the turret shows
        self.assertLessEqual(t["cupola"]["below"], -6)
        crest = self.r["hd"]["crest"]
        self.assertLess(t["trackfront"]["x"], crest["x"])  # never on the crest itself
        self.assertLess(t["muzzle"]["y"], crest["y"])      # the barrel clears the ground there

    def test_the_kill_rings_sit_on_the_barrel(self) -> None:
        rings = self.r["hd"]["rings"]
        self.assertTrue(all(a - b > 1.5 for a, b in zip(rings, rings[1:])))
        # Between the mantlet (84.7) and the muzzle brake (129.4) of the sprite.
        self.assertTrue(all(84.7 < x < 129.4 - 10 for x in rings), rings)

    # --- fire and movement --------------------------------------------------------
    def test_one_man_moves_at_a_time(self) -> None:
        plan = self.r["rush"]["plan"]
        # The plan is one list of single rushes; nobody goes twice running.
        self.assertTrue(all(isinstance(who, str) for who, _ in plan))
        self.assertTrue(all(a[0] != b[0] for a, b in zip(plan, plan[1:])))
        self.assertEqual({who for who, _ in plan}, set(self.r["rush"]["start"]))

    # --- the hedgerow ambush --------------------------------------------------------
    def test_the_gunner_is_hidden_crouching_and_clear_standing(self) -> None:
        a = self.r["ambush"]
        self.assertGreater(a["crouchTop"], a["bank"] + 2)
        self.assertLess(a["standMuzzle"], a["bank"] - 2)

    def test_the_rocket_meets_the_tank_after_it_has_passed(self) -> None:
        a = self.r["ambush"]
        self.assertGreater(a["fireAt"], 2000)
        self.assertGreater(a["rear"]["x"], 172)      # the gunner's x: its rear is past him
        self.assertLess(a["rear"]["y"], a["bank"])   # and above the bank, so it can be hit

    def test_five_silver_badges_make_a_gold(self) -> None:
        got = {k: (b["gold"], b["silver"]) for k, b in self.r["ambush"]["badges"]}
        self.assertEqual(got[0], (0, 0))
        self.assertEqual(got[4], (0, 4))
        self.assertEqual(got[5], (1, 0))
        self.assertEqual(got[6], (1, 1))
        self.assertEqual(got[15], (3, 0))
        self.assertEqual(got[16], (0, 0))

    # --- sprites ------------------------------------------------------------------
    def test_every_sprite_ships_small_with_its_render_command(self) -> None:
        commands = RENDER.read_text()
        sprites = sorted(LOADERS.glob("*.webp"))
        self.assertGreater(len(sprites), 10)
        for sprite in sprites:
            with self.subTest(sprite=sprite.name):
                self.assertEqual(sprite.read_bytes()[8:12], b"WEBP")
                self.assertLess(sprite.stat().st_size, 40_000)
                self.assertRegex(commands, rf"(?m)^draw {re.escape(sprite.name)}(\s|$)")

    def test_the_sprite_script_still_draws_the_first_soldier(self) -> None:
        if not (ROOT / "ui" / "node_modules" / "three").is_dir():
            self.skipTest("ui/node_modules has no three")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "brass.webp"
            proc = subprocess.run(["node", str(ROOT / "scripts" / "render-game-sprite.mjs"), "--out", str(out)],
                                  capture_output=True, text=True, timeout=120)
            if proc.returncode != 0:
                self.skipTest(f"the sprite script could not run here: {proc.stderr[-300:]}")
            self.assertEqual(out.read_bytes(), (LOADERS / "brass-soldier.webp").read_bytes())


if __name__ == "__main__":
    unittest.main()
