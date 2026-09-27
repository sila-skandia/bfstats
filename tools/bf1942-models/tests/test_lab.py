"""The parity lab (`lab/lab.py`): what it writes for the server, and what it
reads back out of the server's event log.

The settings must keep the lab on its own ports whatever a scenario says, the
map list must name the scenario's mode, the remote console line (server1's
port and password) must never reach a lab run, and the event-log summary must
pair each kill with its victim's death to get the distance.
"""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("parity_lab", ROOT / "lab" / "lab.py")
lab = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lab)

TEMPLATE = """game.serverName "BF1942 server1"
game.serverDedicated 1
game.serverMaxPlayers 32
game.serverCoopAiSkill 50
game.serverPort 14567
game.gameSpyLANPort 22000
"""

# An event log as the server writes it mid-round: no closing tags.
LOG = """<?xml version="1.0" encoding="iso-8859-1"?>
<bf:log version="1.1" xmlns:bf="http://www.dice.se/xmlns/bf/1.1">
<bf:round timestamp="3.1">
<bf:server>
  <bf:setting name="map">wake</bf:setting>
  <bf:setting name="maxplayers">32</bf:setting>
</bf:server>
<bf:event name="roundInit" timestamp="23.1">
    <bf:param type="int" name="tickets_team1">200</bf:param>
    <bf:param type="int" name="tickets_team2">200</bf:param>
</bf:event>
<bf:event name="spawnEvent" timestamp="23.2">
    <bf:param type="int" name="player_id">255</bf:param>
    <bf:param type="vec3" name="player_location">350.1/98.7/1439.2</bf:param>
    <bf:param type="int" name="team">1</bf:param>
</bf:event>
<bf:event name="pickupKit" timestamp="23.2">
    <bf:param type="int" name="player_id">255</bf:param>
    <bf:param type="vec3" name="player_location">350.1/98.7/1439.2</bf:param>
    <bf:param type="string" name="kit">Jap_Medic</bf:param>
</bf:event>
<bf:event name="enterVehicle" timestamp="23.3">
    <bf:param type="int" name="player_id">255</bf:param>
    <bf:param type="vec3" name="player_location">351.0/97.7/1446.1</bf:param>
    <bf:param type="string" name="vehicle">Daihatsu</bf:param>
    <bf:param type="int" name="pco_id">0</bf:param>
</bf:event>
<bf:event name="spawnEvent" timestamp="23.4">
    <bf:param type="int" name="player_id">254</bf:param>
    <bf:param type="vec3" name="player_location">1367/115.5/745</bf:param>
    <bf:param type="int" name="team">2</bf:param>
</bf:event>
<bf:event name="scoreEvent" timestamp="66.0">
    <bf:param type="int" name="player_id">255</bf:param>
    <bf:param type="vec3" name="player_location">1200/95/530</bf:param>
    <bf:param type="string" name="score_type">Kill</bf:param>
    <bf:param type="int" name="victim_id">254</bf:param>
    <bf:param type="string" name="weapon">(none)</bf:param>
</bf:event>
<bf:event name="scoreEvent" timestamp="66.0">
    <bf:param type="int" name="player_id">254</bf:param>
    <bf:param type="vec3" name="player_location">1200/95/560</bf:param>
    <bf:param type="string" name="score_type">DeathNoMsg</bf:param>
    <bf:param type="string" name="weapon">(none)</bf:param>
</bf:event>
<bf:event name="spawnEvent" timestamp="70.0">
"""


class ServerSettings(unittest.TestCase):
    def test_lab_ports_and_name_replace_server1s(self):
        out = lab.render_server_settings(TEMPLATE, {})
        self.assertIn("game.serverPort 14568", out)
        self.assertIn("game.gameSpyLANPort 22001", out)
        self.assertIn('game.serverName "bfstats-lab"', out)
        self.assertNotIn("14567", out)
        self.assertNotIn("22000", out)

    def test_scenario_overrides_and_appends(self):
        out = lab.render_server_settings(TEMPLATE, {"serverMaxPlayers": 8, "serverNumberOfRounds": 1})
        self.assertIn("game.serverMaxPlayers 8", out)
        self.assertNotIn("game.serverMaxPlayers 32", out)
        self.assertIn("game.serverNumberOfRounds 1", out)
        self.assertIn("game.serverCoopAiSkill 50", out)

    def test_scenario_cannot_move_the_ports(self):
        with self.assertRaises(ValueError):
            lab.render_server_settings(TEMPLATE, {"serverPort": 14567})


class MapListAndAutoexec(unittest.TestCase):
    def test_maplist_names_the_mode(self):
        out = lab.render_maplist([{"map": "Wake", "mode": "gpm_coop"}])
        self.assertEqual(out.splitlines(), ["game.addLevel wake GPM_COOP bf1942",
                                            "game.setCurrentLevel wake GPM_COOP bf1942"])

    def test_unknown_mode_is_refused(self):
        with self.assertRaises(ValueError):
            lab.render_maplist([{"map": "wake", "mode": "GPM_BOTS"}])

    def test_remote_console_never_reaches_a_run(self):
        out = lab.render_autoexec("admin.enableRemoteConsole user secret 4744\nadmin.timeLimit 0\n",
                                  ["aiSettings.setMaxNBots 8"])
        self.assertNotIn("secret", out)
        self.assertEqual(out.splitlines(), ["admin.timeLimit 0", "aiSettings.setMaxNBots 8"])


class EventLog(unittest.TestCase):
    def test_summary_of_an_unterminated_log(self):
        s = lab.summarise_log(LOG)
        self.assertEqual(s["map"], "wake")
        self.assertEqual(s["playersSpawned"], 2)
        self.assertEqual(s["spawnedByTeam"], {"1": 1, "2": 1})
        self.assertEqual(s["rounds"][0]["tickets_team1"], "200")
        self.assertEqual(s["kitsByTeam"], {"1": {"Jap_Medic": 1}})
        self.assertEqual(s["vehiclesByTeam"], {"1": {"Daihatsu": 1}})

    def test_kill_distance_comes_from_the_victims_death(self):
        (kill,) = lab.summarise_log(LOG)["kills"]
        self.assertEqual((kill["killer"], kill["victim"], kill["team"]), ("255", "254", "1"))
        self.assertEqual(kill["distance"], 30.0)
        self.assertFalse(kill["tk"])

    def test_recording_open_time_comes_from_its_name(self):
        self.assertIsNotNone(lab.recording_opened(Path("replay_20260926-224904.ndjson")))
        self.assertIsNone(lab.recording_opened(Path("unknown_events.log")))

    def test_a_recording_names_the_server_it_joined(self):
        # Event 0x1B exactly as the client recorded it on server1, 2026-09-27.
        raw = "42463139343220736572766572310000000000000000000000000000000000000e"
        with tempfile.TemporaryDirectory() as tmp:
            rec = Path(tmp) / "replay_20260927-000653.ndjson"
            rec.write_text('{"k":"h","v":3}\n'
                           f'{{"k":"e","t":0.001,"e":"raw","type":27,"size":45,"raw":"{raw}"}}\n')
            self.assertEqual(lab.recording_server(rec), "BF1942 server1")
            rec.write_text('{"k":"h","v":3}\n')
            self.assertIsNone(lab.recording_server(rec))

    def test_the_join_line_carries_the_port_on_the_address(self):
        line = lab.join_command()
        self.assertIn(f":{lab.LAB_SETTINGS['serverPort']} +isInternet 0", line)
        self.assertNotIn("+port", line)

    def test_a_recording_gets_the_log_of_the_level_it_joined(self):
        logs = ["serverlog/ev_14568-20260926_2300.xml", "serverlog/ev_14568-20260926_2321.xml"]
        self.assertEqual(lab.log_for("client/replay_20260926-230510.ndjson", logs), logs[0])
        self.assertEqual(lab.log_for("client/replay_20260926-232130.ndjson", logs), logs[1])
        self.assertIsNone(lab.log_for("client/replay_20260926-232130.ndjson", []))


if __name__ == "__main__":
    unittest.main()
