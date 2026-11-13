"""A room's bots: online co-op (`server/room-bots.mjs`, gap audit entry 13).

Retail's dedicated server tops itself up with bots every tick and takes one
out when a human needs the room; this pins that rule as it was read on
lnxded.static, and what a room does with it:

* the top-up (`GameServer::gameStatusPlaying` 0x08150e8b): while the player
  count is under max players and `getMaxNBots` (vanilla's 64) is not reached,
  a bot is made on the side `getTeamToAddPlayer` names, only while the round
  plays;
* a human is always seated (`createPlayer` 0x081310fb counts humans alone),
  so a full room holds one over its max until a bot of the heavier side dies
  (`killPlayer` 0x0814dd15..0x0814dd64);
* the wire's 16 slots: with all sixteen held a bot goes at once;
* a bot is a player of the room: a roster row with its mark (CON-24's
  " is an AI bot."), a snapshot row, the board's numbers, a death by the
  authority's decree with the killer's slot, a respawn on the wave;
* a human's reported round on a soldier (`impact` naming a slot) is priced by
  the room, and a bot it kills is the human's kill;
* the round ends, restarts, and the bots stand up again;
* the caps (per room, node-wide), the host's two words, and no bots at all on
  a level with no bot data or a server with them off.

The harness is the slow part: it runs once.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "room_bots_harness.mjs"


class RoomBotsTests(unittest.TestCase):
    result: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        for name in ("Willy.glb", "Zero.glb"):
            if not (ROOT / "viewer" / "models" / name).exists():
                raise unittest.SkipTest(f"viewer/models/{name} is not in the tree")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=900, cwd=ROOT)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout[-2000:]}\n{proc.stderr[-4000:]}")
        cls.result = json.loads(proc.stdout)

    def part(self, name: str) -> dict:
        return self.result[name]

    # --- retail's numbers ---------------------------------------------------

    def test_the_defaults_are_retails(self) -> None:
        caps = self.part("caps")
        # `aiSettings.setMaxNBots 64` (vanilla AIDefault.con) and
        # `AISettings::reset`'s botSkill 0.75 (AI-14).
        self.assertEqual(caps["retail"], {"maxNBots": 64, "skill": 0.75})
        self.assertEqual(caps["defaults"], {"numberOfBots": 64, "coopAiSkill": 75})

    def test_the_caps_are_the_measured_ones(self) -> None:
        caps = self.part("caps")
        self.assertEqual(caps["limits"], {"perRoom": 15, "node": 32})
        self.assertEqual(caps["think"], 3)

    # --- where there are none -------------------------------------------------

    def test_a_server_with_bots_off_has_none(self) -> None:
        off = self.part("off")["serverOff"]
        self.assertEqual(off["bots"], 0)
        self.assertEqual(off["joins"], 0)
        self.assertEqual(off["hello"]["botCap"], 0)

    def test_a_level_with_no_bot_data_has_none(self) -> None:
        off = self.part("off")
        self.assertEqual(off["noData"]["bots"], 0)
        self.assertFalse(off["noData"]["hello"]["botData"])
        # Strategic areas or a generated layer; an empty list or nothing is none.
        self.assertEqual(off["hasData"], [True, True, False, False])

    # --- the top-up -----------------------------------------------------------

    def test_nobody_is_topped_up_before_the_round_plays(self) -> None:
        self.assertEqual(self.part("topup")["preGame"], 0)

    def test_the_room_fills_to_its_max_players(self) -> None:
        topup = self.part("topup")
        # Max players 6, one human: five bots.
        self.assertEqual(topup["bots"], 5)
        self.assertEqual(topup["worldBots"], 5)
        self.assertEqual(topup["hello"]["botCap"], 15)
        # The tier the room runs and the one the settings allow ride in HELLO for the host.
        self.assertIn("botTier", topup["hello"])
        self.assertIn("botTierTop", topup["hello"])

    def test_each_bot_joins_the_side_the_engine_would_add_to(self) -> None:
        topup = self.part("topup")
        # The human is on side 1: three on each side once five have joined.
        self.assertEqual(topup["sides"], {"1": 2, "2": 3})
        # ...one at a time, to the lighter side each time.
        self.assertEqual([row["team"] for row in topup["joins"]], [2, 1, 2, 1, 2])

    def test_a_bots_join_row_carries_its_name_and_its_mark(self) -> None:
        topup = self.part("topup")
        self.assertEqual(len(topup["joins"]), 5)
        for row in topup["joins"]:
            self.assertTrue(row["bot"])
            self.assertTrue(row["named"])
        self.assertEqual(topup["spawns"], 5)

    def test_bots_take_slots_from_the_top_and_ride_the_snapshot(self) -> None:
        topup = self.part("topup")
        self.assertEqual(topup["slots"], [16, 15, 14, 13, 12])
        self.assertEqual(topup["snapshotSlots"], [1, 12, 13, 14, 15, 16])
        self.assertEqual(topup["snapshotAlive"], 6)

    def test_a_late_joiner_sees_the_bots(self) -> None:
        late = self.part("late")
        bots = [row for row in late["roster"] if row["bot"]]
        self.assertEqual(sorted(row["slot"] for row in bots), [12, 13, 14, 15, 16])
        for row in late["roster"]:
            self.assertTrue(row["named"])
            self.assertTrue(row["stats"])
        self.assertEqual([row["slot"] for row in late["roster"] if not row["bot"]], [1])
        self.assertEqual(late["joinSnapshotSlots"], [1, 2, 12, 13, 14, 15, 16])

    def test_a_human_auto_team_counts_the_bots(self) -> None:
        # Three on each side with the bots counted: a tie, the room's coin.
        self.assertIn(self.part("late")["team"], (1, 2))

    # --- a human joining a full room ----------------------------------------

    def test_a_full_room_still_seats_a_human_and_holds_one_over(self) -> None:
        over = self.part("over")
        self.assertEqual(over["full"], {"bots": 5, "total": 6})
        self.assertTrue(over["seated"]["ok"])
        # No bot is kicked for him: retail removes none that is alive.
        self.assertEqual(over["seated"]["bots"], 5)
        self.assertEqual(over["seated"]["total"], 7)

    def test_the_next_bot_to_die_on_the_heavier_side_goes(self) -> None:
        over = self.part("over")
        self.assertEqual(over["after"], {"bots": 4, "total": 6, "leave": [{"bot": True, "named": True}]})

    def test_a_human_leaving_is_topped_up_again(self) -> None:
        over = self.part("over")
        self.assertEqual(over["gone"], {"bots": 4, "total": 5})
        self.assertEqual(over["refilled"], {"bots": 5, "total": 6})

    def test_with_all_sixteen_slots_held_a_bot_goes_at_once(self) -> None:
        slots = self.part("slots")
        self.assertEqual(slots["before"], {"bots": 15, "humans": 1})
        self.assertTrue(slots["joined"])
        self.assertEqual(slots["after"], {"bots": 14, "humans": 2})
        self.assertEqual(slots["leaveRows"], 1)
        self.assertEqual(slots["distinct"], 16)

    # --- the fight ------------------------------------------------------------

    def test_a_bots_kill_of_the_human_names_the_bot(self) -> None:
        fight = self.part("fight")
        self.assertIsNotNone(fight["killedByBot"], "no bot killed the human in 300 s")
        self.assertTrue(fight["killedByBot"]["otherIsBot"])
        self.assertEqual(fight["killedByBot"]["otherTeam"], 2)
        # The wave's wait rides the row (SPAWN-35).
        self.assertGreater(fight["killedByBot"]["sw"], 0)
        self.assertGreater(fight["fireRows"], 0)

    def test_the_kill_reaches_the_humans_board(self) -> None:
        fight = self.part("fight")
        self.assertGreaterEqual(fight["killerBoard"]["kills"], 1)
        self.assertGreater(fight["killerBoard"]["score"], 0)
        self.assertGreaterEqual(fight["myBoard"]["deaths"], 1)

    def test_a_bots_kill_is_no_team_kill_on_anyones_books(self) -> None:
        self.assertEqual(self.part("fight")["teamKills"], {"total": 0, "sinceDeath": 0})

    def test_the_humans_reported_round_hurts_and_kills_a_bot(self) -> None:
        fight = self.part("fight")
        self.assertTrue(fight["aliveNow"])
        self.assertTrue(fight["target"])
        self.assertEqual(fight["hpBefore"] - fight["hpHurt"], 5)
        self.assertTrue(fight["credited"])

    def test_a_dead_bot_comes_back_on_the_wave(self) -> None:
        fight = self.part("fight")
        self.assertTrue(fight["respawned"])
        self.assertTrue(fight["targetAlive"])

    # --- a seat ---------------------------------------------------------------

    def test_a_bot_takes_a_seat_by_the_rooms_own_seat_law(self) -> None:
        hull = self.part("hull")
        self.assertTrue(hull["entered"])
        # What the room can drive, and no emplaced gun.
        self.assertTrue(set(hull["kinds"]) <= {"ground", "tank", "air"})
        self.assertEqual(hull["seatEnter"], [{"vehicle": hull["tableId"], "seat": 0}])
        self.assertEqual(hull["driver"], hull["botSlot"])
        self.assertTrue(hull["drives"])
        self.assertEqual(hull["snapshot"], {"seated": True, "vehicleId": hull["tableId"], "seatIndex": 0})

    def test_a_humans_use_on_a_bots_seat_asks_the_bot_for_it(self) -> None:
        request = self.part("hull")["request"]
        self.assertEqual(request, {"refused": 1, "asked": True, "stillBots": True, "humanSeated": False})

    def test_a_bot_leaving_its_seat_sends_the_exit(self) -> None:
        left = self.part("hull")["left"]
        self.assertEqual(left, {"seatExit": 1, "occupancy": False, "driver": None})

    # --- the round ------------------------------------------------------------

    def test_one_human_and_bots_play_a_round_to_its_end(self) -> None:
        rnd = self.part("round")
        self.assertTrue(rnd["ended"], "the round did not end in 600 s")
        self.assertEqual(rnd["reason"], "tickets")
        self.assertIn(rnd["winner"], (1, 2))
        self.assertEqual(rnd["aliveAtEnd"], 0)

    def test_the_bots_stay_through_the_restart_and_stand_up_again(self) -> None:
        rnd = self.part("round")
        self.assertEqual(rnd["restarted"], 1)
        self.assertEqual(rnd["botsAfter"], rnd["botsAtEnd"])
        self.assertGreater(rnd["aliveAfter"], 0)
        self.assertEqual(rnd["status"], "playing")

    # --- the caps and the host's words ---------------------------------------

    def test_the_per_room_and_node_caps_hold(self) -> None:
        caps = self.part("caps")
        self.assertEqual(caps["perRoom"], 3)
        # The node's four: the second room gets the one that is left.
        self.assertEqual(caps["second"], 1)
        self.assertEqual(caps["node"], 4)

    def test_the_hosts_two_words_set_the_count_and_the_skill(self) -> None:
        words = self.part("caps")["words"]
        self.assertEqual(words["bots"], 2)
        self.assertEqual(words["skill"], [0.5, 0.5])
        self.assertEqual(words["settings"], {"numberOfBots": 2, "coopAiSkill": 50})
        self.assertEqual(words["hello"]["botCap"], 2)
        self.assertEqual(self.part("caps")["none"], 0)

    # --- the cap on live rooms ---------------------------------------------

    def test_a_create_past_the_cap_is_refused_and_says_so(self) -> None:
        cap = self.part("cap")
        self.assertTrue(cap["first"])
        self.assertTrue(cap["second"])
        self.assertTrue(cap["fullNow"])
        self.assertEqual(cap["third"], "server_full")
        self.assertTrue(cap["thirdClosed"])
        self.assertEqual(cap["rooms"], ["CAP1", "CAP2"])

    def test_joining_a_room_that_exists_ignores_the_cap(self) -> None:
        self.assertTrue(self.part("cap")["existing"])

    def test_a_room_empty_for_a_minute_is_dropped_and_frees_its_place(self) -> None:
        cap = self.part("cap")
        self.assertEqual(cap["emptyMs"], 60_000)
        self.assertTrue(cap["early"])     # still held just after the last human left
        self.assertTrue(cap["later"])
        self.assertTrue(cap["fourth"])
        self.assertEqual(cap["afterReap"], ["CAP1", "CAP4"])

    def test_the_cap_is_the_measured_memory_under_the_containers_limit(self) -> None:
        cap = self.part("cap")
        # Megabytes of RSS on the server's own entry point: the process, a
        # level's first room over a later one, a room, its bots, their hulls.
        # `botRoom` and `cellBytes` are a costed level's terms
        # (`tests/test_room_ships.py`, the tiers).
        self.assertEqual(cap["memory"], {"process": 82, "level": 110, "room": 40, "bots": 35,
                                         "hulls": 85, "budget": 748, "botRoom": 10, "cellBytes": 9,
                                         "buildBytes": 4})
        # 10 % under the container's 832Mi.
        self.assertLessEqual(cap["memory"]["budget"], 832 * 0.9)
        # On foot: six rooms on one level, three each on its own.
        self.assertEqual(cap["fitsOneLevel"], 6)
        self.assertEqual(cap["fitsOwnLevels"], 3)
        # In hulls: three on one level, two each on its own (the node's 32 bots).
        self.assertEqual(cap["hullFitsOneLevel"], 3)
        self.assertEqual(cap["hullFitsOwnLevels"], 2)
        self.assertTrue(cap["noCap"])

    def test_a_hull_room_reserves_its_measured_size(self) -> None:
        cap = self.part("cap")
        # 82 + 110 + 40 + 35 + 85: Wake's one hull room measured 351.
        self.assertEqual(cap["hull"]["one"], 352)
        self.assertEqual(cap["hull"]["estimate"], 352)
        # A budget with two foot rooms and one room's hulls holds one hull room.
        self.assertTrue(cap["hull"]["first"])
        self.assertEqual(cap["hull"]["second"], "server_full")

    def test_a_room_with_no_bot_data_is_a_plain_rooms_size(self) -> None:
        plain = self.part("cap")["plain"]
        self.assertEqual(plain["estimate"], plain["one"])
        self.assertEqual(plain["one"], 232)

    def test_the_bots_go_with_the_last_human(self) -> None:
        self.assertEqual(self.part("empty"), {"before": 4, "after": 0, "world": 0})


STORE_PROBE = """
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, viewerDir] = process.argv.slice(2);
const at = (...p) => pathToFileURL(path.join(...p)).href;
const { installModuleHooks } = await import(at(root, 'sim', 'env.mjs'));
installModuleHooks(path.join(root, 'viewer'));
const load = await import(at(root, 'server', 'level-load.mjs'));
const { loadVehicleTree } = await import(at(root, 'server', 'glb-tree.mjs'));
const { buildLevelFromDescriptor } = await import(at(root, 'server', 'level.mjs'));
const models = load.modelsDirOf(viewerDir);
const willy = load.resolveTemplatePath(models, 'willy');
const mod = load.resolveTemplatePath(path.join(models, 'mods', 'fh'), 'Zero');
const level = buildLevelFromDescriptor({ viewerDir });
process.stdout.write(JSON.stringify({
  willy: path.relative(viewerDir, willy), seats: !!loadVehicleTree(willy),
  missing: path.relative(viewerDir, load.resolveTemplatePath(models, 'Nothing')),
  mod: path.relative(viewerDir, mod), templates: [...level.templates.keys()].sort(),
}));
"""


class StoredTemplateTests(unittest.TestCase):
    """The live volume keeps each glb once, by content, under `glbs/<sha>.glb`
    and names it in `models.json`: there is no `models/<Template>.glb`. The
    room's vehicle templates are found through that table."""

    def test_a_template_is_found_through_models_json(self) -> None:
        import tempfile

        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        models = ROOT / "viewer" / "models"
        for name in ("Willy.glb", "Zero.glb"):
            if not (models / name).exists():
                raise unittest.SkipTest(f"viewer/models/{name} is not in the tree")
        with tempfile.TemporaryDirectory() as tmp:
            viewer = Path(tmp) / "viewer"
            (viewer / "glbs").mkdir(parents=True)
            (viewer / "models" / "mods" / "fh").mkdir(parents=True)
            shutil.copyfile(models / "Willy.glb", viewer / "glbs" / ("a" * 64 + ".glb"))
            shutil.copyfile(models / "Zero.glb", viewer / "glbs" / ("b" * 64 + ".glb"))
            rows = [
                {"name": "Willy", "glb": "Willy.glb", "sha": "a" * 64, "cockpitSha": "c" * 64,
                 "variants": [{"glb": "Willy.glb", "sha": "a" * 64}]},
                {"name": "Zero", "glb": "Zero.Wake.glb", "sha": "b" * 64},
                {"name": "Gone", "glb": "Gone.glb", "sha": "d" * 64},
            ]
            (viewer / "models" / "models.json").write_text(json.dumps(rows))
            (viewer / "models" / "mods" / "fh" / "models.json").write_text(json.dumps(rows[1:2]))
            probe = Path(tmp) / "probe.mjs"
            probe.write_text(STORE_PROBE)
            proc = subprocess.run(["node", str(probe), str(ROOT), str(viewer)],
                                  capture_output=True, text=True, timeout=120)
            if proc.returncode != 0:
                raise AssertionError(proc.stderr[-3000:])
            got = json.loads(proc.stdout)
        self.assertEqual(got["willy"], "glbs/" + "a" * 64 + ".glb")
        self.assertTrue(got["seats"])
        # A per-level file's row answers for its template; a mod tree's blobs
        # are the same `glbs/` beside `models/`.
        self.assertEqual(got["mod"], "glbs/" + "b" * 64 + ".glb")
        # A name the table lacks keeps the old answer, which does not exist.
        self.assertEqual(got["missing"], "models/Nothing.glb")
        # The harness level's two templates load off the store.
        self.assertEqual(got["templates"], ["willy", "zero"])


TABLE_PROBE = """
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root] = process.argv.slice(2);
const at = (...p) => pathToFileURL(path.join(...p)).href;
const { installModuleHooks } = await import(at(root, 'sim', 'env.mjs'));
installModuleHooks(path.join(root, 'viewer'));
const lines = [];
console.log = (...a) => lines.push(a.join(' '));
const { buildLevelTable } = await import(at(root, 'server', 'level-table.mjs'));
const table = buildLevelTable(path.join(root, 'viewer'));
const before = lines.filter(l => /: loaded/.test(l)).length;
const wake = table.get('wake');
process.stdout.write(JSON.stringify({
  before, has: [table.has('wake'), table.has('test'), table.has('no_such_level')],
  name: wake?.name ?? null, again: table.get('wake') === wake, missing: table.get('no_such_level') ?? null,
  loaded: lines.filter(l => /: loaded/.test(l)).length, test: table.get('test')?.name ?? null,
  listed: table.names().includes('wake') && table.names().includes('test'),
}));
"""


class LevelTableTests(unittest.TestCase):
    """The server's level table loads a level when a room first asks for it:
    the live tree holds 100 level directories at about 28 MB each."""

    def test_a_level_is_loaded_when_first_asked_for(self) -> None:
        import tempfile

        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        if not (ROOT / "viewer" / "maps" / "wake" / "scene.glb").exists():
            raise unittest.SkipTest("viewer/maps/wake is not in the tree")
        with tempfile.TemporaryDirectory() as tmp:
            probe = Path(tmp) / "probe.mjs"
            probe.write_text(TABLE_PROBE)
            proc = subprocess.run(["node", str(probe), str(ROOT)], capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr[-3000:])
        got = json.loads(proc.stdout)
        self.assertEqual(got["before"], 0)
        self.assertEqual(got["has"], [True, True, False])
        self.assertEqual(got["name"], "wake")
        self.assertTrue(got["again"])
        self.assertEqual(got["loaded"], 1)
        self.assertIsNone(got["missing"])
        self.assertEqual(got["test"], "test")
        self.assertTrue(got["listed"])


if __name__ == "__main__":
    unittest.main()
