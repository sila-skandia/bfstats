"""The sidecar's live snapshot carries the server's object table.

A page that joined a sidecar mid-round learnt of a hull only when it came into
its ghost scope, because CreateObject was not in the snapshot: its hull-model
prewarm missed every hull out of scope, and only the 5 s deck wait stood
between a spawn and an unloaded carrier. `sidecar_live_snapshot_harness.mjs`
replays the owner's Midway session (`fixtures/sidecar_midway_join.ndjson.gz`)
through `sidecar/live-snapshot.mjs` to t 40 s, before the Enterprise came into
scope, and joins a fresh page client with the snapshot.
features/udp-sidecar/browser.md, "The join".
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.test_sidecar_join import FIXTURE, VIEWER, _closure

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "sidecar_live_snapshot_harness.mjs"
LIVE = HERE.parent / "sidecar" / "live-snapshot.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("server-entities.js", "net-sidecar.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "node_modules" / "three").mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js",
                        work / "node_modules" / "three" / "three.module.js")
        (work / "node_modules" / "three" / "package.json").write_text(json.dumps({
            "name": "three", "version": "0.0.0", "type": "module",
            "main": "three.module.js", "exports": "./three.module.js"}))
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(LIVE, work / "live-snapshot.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(FIXTURE)],
                              capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class SidecarLiveSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_mid_round_page_prewarms_hulls_out_of_its_scope(self) -> None:
        got = self.out["withTable"]
        self.assertEqual(got["level"], "midway")
        self.assertTrue(got["ready"])
        self.assertTrue(got["enterpriseKnown"])
        self.assertFalse(got["enterpriseInScope"])
        self.assertIn("Enterprise", got["asked"])

    def test_without_the_table_it_did_not(self) -> None:
        """The snapshot as it was: the carrier, out of scope, is unknown."""
        got = self.out["without"]
        self.assertFalse(got["enterpriseKnown"])
        self.assertNotIn("Enterprise", got["asked"])
        self.assertLess(len(got["asked"]), len(self.out["withTable"]["asked"]))

    def test_destroyed_objects_leave_and_a_level_clears_it(self) -> None:
        self.assertIsNotNone(self.out["destroyed"])
        self.assertFalse(self.out["destroyedKept"])
        self.assertTrue(self.out["addedKept"])
        self.assertFalse(self.out["addedAfterDestroy"])
        self.assertEqual(self.out["afterLevel"], 0)

    def test_the_table_stays_small_on_a_64_player_map(self) -> None:
        """Midway with 63 bots, after the dump: a few hundred rows, well
        under 100 KB (the whole snapshot is about 190 KB in play)."""
        self.assertGreater(self.out["created"], 100)
        self.assertLess(self.out["createdBytes"], 100_000)


if __name__ == "__main__":
    unittest.main()
