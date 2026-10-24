"""The server's spawn groups on a sidecar page, wire to deploy screen.

The BFSpawnPointManager is one of the server's own networkables (netId 513 on
every level the sidecar has joined). Per group it sends the side, the human's
`BFSpawnGroup::getActive(false)` and the ring's x and z, a byte of the terrain
each (lnxded `updateStateMask` 0x081683f0, `getNetUpdate` 0x08168690,
`setNetUpdate` 0x081687f0). Retail's client takes that byte as its own
`getActive` (BF1942.exe 0x00484bc0) and its spawn map draws and selects only
groups that pass it (ledger SPAWNGRP-11). The sidecar decodes it
(`sidecar/ghost/spawn-manager.mjs`), writes the table as an `e:'spawnGroups'`
row (`ghost-writer.mjs`) the live snapshot keeps, and the page lines the
unnamed entries up with its level's groups (`viewer/server-spawn-groups.js`).

Driven by `server_spawn_groups_harness.mjs` on the owner's Midway session
(sidecar-2026-10-24-11-53-03): group 72, the Enterprise's helm, is sent off
while 73 and 74 are on, which is why a page that asked for 72 waited for ever.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).with_name("server_spawn_groups_harness.mjs")
MODULE = ROOT / "viewer" / "server-spawn-groups.js"
SIDECAR = ROOT / "sidecar"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / MODULE.name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(SIDECAR)],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr or proc.stdout)
    return json.loads(proc.stdout)


class ServerSpawnGroupsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_first_send_is_found_by_its_shape(self) -> None:
        self.assertEqual(25, self.r["detect"]["first"])
        self.assertEqual(0, self.r["detect"]["delta"])
        self.assertEqual(0, self.r["detect"]["score"])

    def test_the_first_send_decodes_to_its_last_bit(self) -> None:
        first = self.r["first"]
        self.assertEqual(25, first["rows"])
        self.assertEqual(550, first["consumed"])
        by = {row[0]: row[1:] for row in first["sample"]}
        self.assertEqual([2, 0, 125, 168], by[13])  # 72, the helm: off, ring on her deck
        self.assertEqual([2, 1, 131, 168], by[14])  # 73: on

    def test_a_delta_carries_only_what_changed(self) -> None:
        self.assertEqual([[3, 2, 1, 131, 131]], self.r["airfield"])
        self.assertIsNone(self.r["wrongLength"])

    def test_the_writer_sends_the_table_on_change_and_again_after_a_level(self) -> None:
        self.assertEqual({"rows": 3, "ts": [1, 3, 5], "airfieldTeam": 2}, self.r["writer"])

    def test_the_live_snapshot_keeps_the_newest_table_until_the_level_changes(self) -> None:
        self.assertEqual({"kept": 1, "newestTeam": 2, "afterLevel": 0}, self.r["snapshot"])

    def test_the_page_names_each_entry_by_its_group(self) -> None:
        page = self.r["page"]
        self.assertTrue(page["live"])
        self.assertEqual({"3": 2, "4": 3, "64": 5, "68": 9, "72": 13, "73": 14, "74": 15,
                          "75": 16, "83": 24}, page["order"])

    def test_the_helm_group_is_off_for_a_human_and_the_deck_on(self) -> None:
        self.assertEqual({"4": True, "72": False, "73": True, "74": True, "75": True},
                         self.r["page"]["active"])

    def test_a_ring_is_the_servers_quantised_average(self) -> None:
        # The owner's real spawn on 73 stood at (2113, -2686) in the page's
        # frame; the ring is within a byte (16 m) of it.
        self.assertEqual([2104, -2699], self.r["page"]["ring73"])
        self.assertIsNone(self.r["page"]["ring70"])
        self.assertIsNone(self.r["page"]["unknown"])

    def test_a_sunk_ship_takes_her_groups_off(self) -> None:
        self.assertEqual({"active75": False, "ring75": None, "active73": True}, self.r["sunk"])

    def test_nothing_is_read_before_the_table_or_when_it_cannot_be_lined_up(self) -> None:
        self.assertEqual({"live": False, "active72": None}, self.r["before"])
        self.assertIsNone(self.r["tooMany"])
        self.assertEqual({"live": False, "active73": None}, self.r["cleared"])


if __name__ == "__main__":
    unittest.main()
