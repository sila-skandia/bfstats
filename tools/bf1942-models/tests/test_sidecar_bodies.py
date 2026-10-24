"""Dead soldiers' bodies on a live server: the page keeps exactly the bodies
the server still has.

BF1942-AUSTRALIA, Midway co-op, 63 bots, 2026-10-24: the owner saw heaps of
bodies on the field that did not exist on the server. The server keeps a dead
man's soldier object for `timeToLiveAfterDeath` (10 s, DIE-9) and then sends
DestroyObject for it; a live soldier who leaves this client's ghost scope gets
a scope-out (ghost action 3, k:"d") and is not dead. The page played a death
for every scope-out and left the body for its own 10 s: 24 at once when the
local player spawned at t 49.46 and his scope moved. And a respawn (about 5 s
after a death, before the body's 10) took the body away early.

The session's own rows (`fixtures/sidecar_midway_bodies.ndjson.gz`, the first
125 s of sidecar-2026-10-24-11-53-03.ndjson cut to the player and soldier
rows) are replayed through `net-sidecar.js` and `netcode-render.js` by
`sidecar_bodies_harness.mjs`, which counts the bodies the renderer draws, by
netId, every 100 ms against the set the raw rows give.
"""

from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent / "viewer"
HARNESS = HERE / "sidecar_bodies_harness.mjs"
FIXTURE = HERE / "fixtures" / "sidecar_midway_bodies.ndjson.gz"


def _closure(*entries: str) -> set[str]:
    seen: set[str] = set()
    queue = list(entries)
    while queue:
        name = queue.pop()
        if name in seen or not (VIEWER / name).exists():
            continue
        seen.add(name)
        here = posixpath.dirname(name)
        for spec in re.findall(r"from '(\.\.?/[^']+\.js)'", (VIEWER / name).read_text()):
            queue.append(posixpath.normpath(posixpath.join(here, spec)))
    return seen


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("net-sidecar.js", "netcode-render.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "node_modules" / "three").mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js",
                        work / "node_modules" / "three" / "three.module.js")
        (work / "node_modules" / "three" / "package.json").write_text(json.dumps({
            "name": "three", "version": "0.0.0", "type": "module",
            "main": "three.module.js", "exports": "./three.module.js"}))
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(FIXTURE)],
                              capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class SidecarBodiesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_session_has_the_scope_outs_that_piled_up(self) -> None:
        """The fixture carries the defect: live soldiers leaving scope, the
        biggest burst when the local player spawned at t 49.46."""
        self.assertGreaterEqual(self.out["scopeLeaves"], 30)
        self.assertGreaterEqual(self.out["burstSecond"], 20)
        self.assertAlmostEqual(self.out["burst"]["t"], 49.5, delta=0.3)

    def test_the_page_draws_exactly_the_servers_bodies(self) -> None:
        """Every frame, the bodies drawn are the dead soldier objects the
        server still has in scope, by netId: none for a scope-out."""
        self.assertGreater(self.out["deaths"], 20)
        self.assertEqual(self.out["mismatches"], 0, self.out["firstMismatch"])

    def test_a_body_lies_until_its_destroy_object(self) -> None:
        """Drawn from the death row (or its first pose after it) to the
        server's DestroyObject, 10 s later (timeToLiveAfterDeath), not to the
        page's own clock or a respawn. Bodies the server scoped out and back
        in between are covered frame by frame by the exact-set test."""
        spans = [s for s in self.out["spans"] if s["gone"] == s["destroyed"]]
        self.assertGreater(len(spans), 10)
        for s in spans:
            self.assertLess(s["from"] - s["posed"], 0.15, s)
            self.assertGreaterEqual(s["from"], s["died"], s)
            self.assertLess(s["destroyed"] - s["to"], 0.15, s)
            self.assertLessEqual(s["to"], s["destroyed"], s)
            # The death rows at the end of the join's world dump (t 23.9,
            # with simStart) are not the deaths' own times: those bodies went
            # about 8 s later. A death in play lies 10.
            if s["died"] > 24:
                life = s["destroyed"] - s["died"]
                self.assertTrue(life < 0.05 or 9.9 < life < 10.2, s)

    def test_a_respawn_leaves_the_old_body(self) -> None:
        """Pid 239 died at 110.447 and was back at 114.851; his body 9922
        lay until its DestroyObject at 120.505."""
        self.assertIn(9922, self.out["leftBodies"])
        span = next(s for s in self.out["spans"] if s["nid"] == 9922)
        self.assertGreater(span["to"], 120.3)


if __name__ == "__main__":
    unittest.main()
