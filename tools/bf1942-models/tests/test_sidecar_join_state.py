"""A page that joins mid-session knows what a page there from the start knows.

The sidecar sends a page that connects a live snapshot of the session
(`sidecar/live-snapshot.mjs`), not its history. Last week's join fixes each
found one piece of state the snapshot lost: who holds each flag, who is in
which hull, the round pools, the object table. This test holds the general
rule instead: replaying a session, a page joined from the snapshot at any
instant holds the same state (`net-sidecar.js`) as a page fed every row from
the start. `sidecar_join_state_harness.mjs` also drives the cases the fixture
sessions do not carry, and a grenade's and a mine's real ghost bodies through
the sidecar's decoder and writer. features/udp-sidecar/browser.md,
"Joining late".
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.test_sidecar_join import VIEWER, _closure

HERE = Path(__file__).resolve().parent
SIDECAR = HERE.parent / "sidecar"
HARNESS = HERE / "sidecar_join_state_harness.mjs"
FIXTURES = [HERE / "fixtures" / "sidecar_midway_bodies.ndjson.gz",
            HERE / "fixtures" / "sidecar_wake_round_restart.ndjson.gz",
            HERE / "fixtures" / "sidecar_midway_join.ndjson.gz",
            # Two of one man's bodies lying at once (net-sidecar.js keys bodies by the body).
            HERE / "fixtures" / "sidecar_midway_bodies_twice.ndjson.gz"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("net-sidecar.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(SIDECAR / "live-snapshot.mjs", work / "live-snapshot.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(SIDECAR), *map(str, FIXTURES)],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class JoinStateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_page_joined_at_any_instant_holds_the_state_of_one_there_from_the_start(self) -> None:
        for name, cuts in self.out["equivalence"].items():
            self.assertEqual(len(cuts), 12, name)
            for cut in cuts:
                with self.subTest(fixture=name, cut=cut["cut"]):
                    self.assertEqual(cut["diffs"], [])

    def test_the_cases_agree_too(self) -> None:
        for case in ("beforeRestart", "afterRestart", "afterDestroy"):
            with self.subTest(case=case):
                self.assertEqual(self.out["cases"][case]["diffs"], [])

    def test_every_engine_of_a_hull_reaches_a_joining_page(self) -> None:
        """Keyed by the hull alone, a B17's four engines reached it as one."""
        self.assertEqual(self.out["cases"]["beforeRestart"]["revs"], [0.77, 0.771, 0.629, 0.629])

    def test_an_object_out_of_scope_keeps_its_class_and_damage(self) -> None:
        got = self.out["cases"]["beforeRestart"]
        self.assertEqual(got["b17Known"], "SimpleObjectNetworkable")
        self.assertFalse(got["b17InScope"])
        self.assertEqual(got["hp"], 160)

    def test_a_body_lies_on_a_joining_page_until_the_server_destroys_it(self) -> None:
        self.assertEqual(self.out["cases"]["beforeRestart"]["body"], 900)
        self.assertIsNone(self.out["cases"]["afterDestroy"]["body"])
        self.assertIsNone(self.out["cases"]["afterDestroy"]["fullBody"])

    def test_a_dead_mans_kit_is_named_after_its_object_is_gone(self) -> None:
        self.assertEqual(self.out["cases"]["beforeRestart"]["kitTmpl"], "UsMarine_Assault")

    def test_the_newest_pool_names_each_round(self) -> None:
        """A pool of three at a nine-pool's first id: 700..702 are grenades,
        703..708 still the packs."""
        self.assertEqual(self.out["cases"]["beforeRestart"]["pool"],
                         ["GrenadeAlliesProjectile", "GrenadeAlliesProjectile",
                          "ExpPackProjectile", "ExpPackProjectile"])

    def test_bf42plus_statics_reach_a_joining_page(self) -> None:
        self.assertEqual(self.out["cases"]["beforeRestart"]["statics"], [{"id": 3, "pos": [2, 2, 2]}])

    def test_a_round_restart_takes_the_old_flags(self) -> None:
        self.assertEqual(self.out["cases"]["beforeRestart"]["cp"], 1)
        self.assertIsNone(self.out["cases"]["afterRestart"]["cp"])

    def test_a_remade_hull_is_whole(self) -> None:
        """A round restart re-makes a hull under its netId (ROUND-10): the
        destroyed one's hit points and revs do not carry over."""
        self.assertIsNone(self.out["cases"]["afterDestroy"]["remadeHp"])
        self.assertIsNone(self.out["cases"]["afterDestroy"]["remadeRevs"])

    def test_the_server_nametag_caps_reach_the_page(self) -> None:
        """SetLevel's settings carry serverNameTagDistance and ...Scope
        (lab: 100 and 300, its serversettings.con), HUD-16."""
        self.assertEqual(self.out["cases"]["beforeRestart"]["nameTags"], {"near": 100, "scope": 300})
        self.assertEqual(self.out["rounds"]["setLevel"]["nameTags"], [100, 300])


class RoundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = JoinStateTests.out if hasattr(JoinStateTests, "out") else run_harness()
        cls.r = cls.out["rounds"]

    def test_a_pools_rounds_are_classed(self) -> None:
        self.assertEqual(self.r["poolClass"], "ProjectileNetworkable")
        self.assertEqual(self.r["createdCls"], ["ProjectileNetworkable", "ProjectileNetworkable"])

    def test_the_laid_mine_and_the_thrown_grenade_have_poses(self) -> None:
        samples = self.r["samples"]
        mine = [s for s in samples if s[1] == 823]
        self.assertEqual(len(mine), 1)
        self.assertAlmostEqual(mine[0][2], 1076.826, places=2)
        self.assertAlmostEqual(mine[0][4], 1267.214, places=2)
        self.assertEqual(len([s for s in samples if s[1] == 744]), 2)

    def test_a_page_joined_after_a_blast_does_not_draw_the_spent_round(self) -> None:
        r = self.out["rounds"]
        self.assertEqual(r["joinedAfterBlast"], r["drawnAfterBlast"])

    def test_a_spent_round_scoped_in_does_not_go_off(self) -> None:
        """A pool slot whose first record has both bools set is reset on the
        scope-in, and detonate does nothing for a round already out
        (ProjectileNetworkable::setNetUpdate 0x082331e8, Projectile::detonate
        0x0831e688). Read as a blast, it put one at the map's origin."""
        r = self.out["rounds"]["spentScopeIn"]
        self.assertEqual(r["body"], {"reset": True, "detonate": True})
        self.assertEqual(r["detonations"], 0)
        self.assertEqual(r["samples"], 0)

    def test_the_grenade_goes_off_once_on_the_servers_word_and_is_drawn_no_more(self) -> None:
        self.assertEqual(self.r["detonations"], 1)
        self.assertEqual(self.r["detonate"]["id"], 744)
        self.assertAlmostEqual(self.r["detonate"]["t"], 29.243)
        self.assertIn(744, self.r["drawnBeforeBlast"])
        self.assertNotIn(744, self.r["drawnAfterBlast"])
        self.assertIn(823, self.r["drawnAfterBlast"])
        blasts = [e for e in self.r["events"] if e["type"] == "detonate"]
        self.assertEqual(len(blasts), 1)
        self.assertEqual(blasts[0]["tmpl"], "GrenadeAlliesProjectile")

    def test_a_round_known_from_its_createobject_is_a_round_not_a_hull(self) -> None:
        self.assertEqual(sorted(self.r["pageRounds"]), [744, 823])
        self.assertEqual(self.r["padSpawns"], 0)


if __name__ == "__main__":
    unittest.main()
