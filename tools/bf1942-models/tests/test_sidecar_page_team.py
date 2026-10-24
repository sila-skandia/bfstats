"""The page's side choice survives a connect: `sidecar/page-team.mjs`.

A page that connected while the sidecar was still connecting, or rejoining,
had its `join` row (its `?team=`) refused and never sent again. Retail sends
its side once the server can take it. The sidecar now holds the choice and
sends it at the session's join, still only before the player's first spawn
(a SetTeam kills whoever it moves). features/udp-sidecar/browser.md, "The
join".
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "sidecar" / "page-team.mjs"
SIDECAR = ROOT / "sidecar" / "sidecar.mjs"

SCRIPT = r"""
const { createPageTeam } = await import(process.argv[1]);
const sent = [];
const pt = createPageTeam({ send: (t) => sent.push(t) });
const out = {};
// connecting: held, nothing on the wire
out.heldWhileConnecting = pt.offer(2, { joined: false, team: 0, everSpawned: false });
out.sentBeforeJoin = sent.length;
// a page that names no side clears nothing
out.noSide = pt.offer(0, { joined: false, team: 0, everSpawned: false });
out.heldAfterNoSide = pt.held;
// the join: sent once
out.atJoin = pt.joined({ joined: true, team: 1, everSpawned: false });
out.sentAtJoin = [...sent];
out.heldAfterJoin = pt.held;
// a second join (a rejoin) sends nothing more
out.secondJoin = pt.joined({ joined: true, team: 1, everSpawned: false });
// already on that side at the join
pt.offer(1, { joined: false, team: 0, everSpawned: false });
out.sameAtJoin = pt.joined({ joined: true, team: 1, everSpawned: false });
// held during a rejoin after he has spawned: kept, never sent
pt.offer(2, { joined: false, team: 1, everSpawned: true });
out.keptAtRejoin = pt.joined({ joined: true, team: 1, everSpawned: true });
// joined: sent at once, as before
out.liveOffer = pt.offer(2, { joined: true, team: 1, everSpawned: false });
out.liveAfterSpawn = pt.offer(2, { joined: true, team: 1, everSpawned: true });
out.sentTotal = [...sent];
console.log(JSON.stringify(out));
"""


class PageTeamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", "--input-type=module", "-e", SCRIPT, MODULE.as_uri()],
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_a_choice_made_while_connecting_is_held(self) -> None:
        self.assertEqual(self.r["heldWhileConnecting"], "held")
        self.assertEqual(self.r["sentBeforeJoin"], 0)
        self.assertEqual(self.r["noSide"], "none")
        self.assertEqual(self.r["heldAfterNoSide"], 2)

    def test_it_is_sent_at_the_join_once(self) -> None:
        self.assertEqual(self.r["atJoin"], "sent")
        self.assertEqual(self.r["sentAtJoin"], [2])
        self.assertEqual(self.r["heldAfterJoin"], 0)
        self.assertEqual(self.r["secondJoin"], "none")
        self.assertEqual(self.r["sameAtJoin"], "same")

    def test_never_after_the_first_spawn(self) -> None:
        self.assertEqual(self.r["keptAtRejoin"], "kept")
        self.assertEqual(self.r["liveAfterSpawn"], "kept")

    def test_a_joined_offer_is_sent_at_once(self) -> None:
        self.assertEqual(self.r["liveOffer"], "sent")
        self.assertEqual(self.r["sentTotal"], [2, 2])

    def test_the_sidecar_holds_and_flushes_it(self) -> None:
        src = SIDECAR.read_text()
        self.assertIn("pageTeam.offer(team, teamState())", src)
        self.assertIn("pageTeam.joined(", src)
        self.assertNotIn("page join refused", src)


if __name__ == "__main__":
    unittest.main()
