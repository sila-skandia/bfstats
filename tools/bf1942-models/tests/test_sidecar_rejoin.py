"""The sidecar getting back on after a level change, as the retail client does.

A dedicated server restarts its own process at the end of a level's last
round. Before it does, GameStatus 5 tells every client four random digits (the
reconnect password) and the next level's mod; the restarted server holds one
reconnect slot per previous player for 180 s, and a ConnectRequest carrying
the digits at bytes [80..83] takes one even when the server is otherwise full
(GameServer::gameStatusFirstEndGame 0x08152a60, gameStatusEndGame 0x08152ca0,
NetServer::setReconnectPassword 0x08434890, handleConnectRequest 0x08436810,
checkReconnectPassword 0x08436750 in bf1942_lnxded.static; the client's side
is BF1942.exe 0x004933d0 case 0x24, 0x004957d0, 0x0048ff90, 0x006b4130 and
0x0060f300). sidecar/rejoin.mjs has the whole protocol; wire.md section 29
and ledger RECON-1..RECON-8 the evidence.

The harness builds its bytes from those functions' layouts and runs the rejoin
state machine against a fake session on a fake clock.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "sidecar_rejoin_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ConnectRequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_layout(self):
        c = self.r["connect"]
        self.assertEqual(c["length"], 0x54)
        self.assertEqual(c["type"], 1)
        self.assertEqual((c["major"], c["minor"]), (0x1002, 1610))
        self.assertEqual(c["password"], "lab\u0000")
        self.assertTrue(c["passwordTailZero"])

    def test_reconnect_password_at_80(self):
        c = self.r["connect"]
        self.assertEqual(c["keyed"], "4711".encode().hex())
        # an ordinary join sends four zeros
        self.assertEqual(c["plain"], "00000000")
        # strncpy(.., 4): longer is cut, shorter is NUL-padded
        self.assertEqual(c["long"], "1234".encode().hex())
        # strncpy(+16, pw, 0x20) (BF1942.exe 0x0060f323): the server
        # password is cut at 32 bytes, as retail's
        self.assertEqual(c["longPasswordBytes"], 32)
        self.assertEqual(c["short"], "30370000")
        # a Session made for a rejoin carries it to its connection
        self.assertEqual(c["sessionKey"], "4711".encode().hex())

    def test_server_info_request(self):
        self.assertEqual(self.r["serverInfoRequest"], {"length": 8, "type": 9})


class GameStatusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_status_5_decodes_and_the_stream_stays_framed(self):
        s = self.r["status"]
        self.assertEqual([e["type"] for e in s["seen"]], ["GameStatus", "Ack", "GameStatus", "Ack"])
        self.assertEqual([e.get("status") for e in s["seen"] if e["type"] == "GameStatus"], [2, 5])
        self.assertTrue(all(e["value"] == 0xDEADBEEF for e in s["seen"] if e["type"] == "Ack"))

    def test_status_5_is_the_level_change(self):
        s = self.r["status"]
        self.assertEqual(s["changes"], [{"password": "4711", "mod": "bf1942"}])
        self.assertEqual(s["levelChange"], {"password": "4711", "mod": "bf1942"})

    def test_reading_the_tail(self):
        f = self.r["fromEvent"]
        self.assertEqual(f["full"], {"password": "0815", "mod": "DesertCombat"})
        self.assertIsNone(f["notFive"])
        self.assertEqual(f["empty"], {"password": "", "mod": "bf1942"})


class ClassificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_disconnect_reasons(self):
        c = self.r["classify"]
        self.assertEqual(c["levelChange"], "level-change")
        self.assertEqual(c["kicked"], "kicked")
        self.assertEqual(c["banned"], "banned")
        self.assertEqual(c["timeout"], "drop")
        # the server closing us on purpose, or for a reason we do not know,
        # is not a drop: the sidecar must not come straight back
        self.assertEqual(c["left"], "closed")
        self.assertEqual(c["unknown"], "closed")
        # a drop just after the server's chat said we were kicked is the kick
        self.assertEqual(c["timeoutAfterKickLine"], "kicked")
        self.assertEqual(c["timeoutAfterBanLine"], "banned")
        # but a level change stays one
        self.assertEqual(c["levelChangeAfterKickLine"], "level-change")
        # a drop after GameStatus 5 is the restart, whatever the reason said
        self.assertEqual(c["timeoutAfterStatus5"], "level-change")
        # but a kick is a kick
        self.assertEqual(c["kickedAfterStatus5"], "kicked")

    def test_only_a_level_change_or_a_drop_rejoins(self):
        self.assertEqual(self.r["rejoinable"], {
            "kicked": False, "banned": False, "closed": False, "horizon": False,
            "drop": True, "level-change": True})

    def test_kick_lines_in_the_server_chat(self):
        n = self.r["notice"]
        # the engine's own line (kickPlayers through GameServer::say)
        self.assertEqual(n["engine"], {"banned": False, "text": "Player skandia-sc_1 was kicked from the server."})
        # a server manager's line, 0x80 for each space
        self.assertEqual(n["bfsm"], {"banned": True, "text": "skandia-sc was banned for teamkilling"})
        # someone else, a longer name, a warning, a welcome line
        for k in ("other", "longer", "warning", "welcome"):
            self.assertIsNone(n[k], k)

    def test_what_the_page_is_told(self):
        d = self.r["describe"]
        # retail: a message under KICKED FROM SERVER (BF1942.exe 0x006b4367)
        self.assertEqual(d["kickWithText"], {"kind": "kicked", "reason": 0x15, "name": "Kicked",
                                             "title": "KICKED FROM SERVER", "text": "Kicked for teamkilling",
                                             "notice": "", "final": True})
        self.assertEqual(d["kickBare"]["title"], "KICKED FROM SERVER")
        self.assertEqual(d["kickBare"]["text"], "")
        # A drop the chat called a ban: the sidecar stops, but retail saw only
        # the drop (reason 0x0a, box code 0) and says DISCONNECTED FROM SERVER;
        # the chat line rides along as `notice`, never as the box's text.
        self.assertEqual(d["banFromChat"]["title"], "DISCONNECTED FROM SERVER")
        self.assertEqual(d["banFromChat"]["text"], "")
        self.assertEqual(d["banFromChat"]["notice"], "skandia-sc was banned for teamkilling")
        self.assertTrue(d["banFromChat"]["final"])
        # 0x0d is box code 0: 0x00490f00 shows (1, "") and drops the server's text
        self.assertEqual(d["closedWithText"]["title"], "DISCONNECTED FROM SERVER")
        self.assertEqual(d["closedWithText"]["text"], "")
        self.assertTrue(d["closedWithText"]["final"])
        self.assertEqual(d["drop"]["title"], "DISCONNECTED FROM SERVER")
        self.assertFalse(d["drop"]["final"])

    def test_retail_disconnect_box(self):
        # RECON-11: reason -> box code (0x004957d0's table), code -> lexicon line
        # (0x006b42f0), and the server's text only for a reason with a code.
        b = self.r["box"]
        lines = {"0xa": "DISCONNECTED FROM SERVER", "0xd": "DISCONNECTED FROM SERVER",
                 "0x13": "CD KEY IN USE", "0x14": "INVALID CD KEY", "0x15": "KICKED FROM SERVER",
                 "0x16": "BANNED FROM SERVER", "0x1a": "DISCONNECTED FROM SERVER",
                 "0x1b": "DATA DIFFERS FROM SERVER", "0x42": "DISCONNECTED FROM SERVER"}
        for reason, line in lines.items():
            self.assertEqual(b[reason]["title"], line, reason)
            self.assertEqual(b[reason]["text"], "", reason)
        self.assertEqual(b["0x13"]["key"], "ERROR_CD_KEY_IN_USE")
        self.assertEqual(b["0x1b"]["key"], "ERROR_MESSAGE_DATA_DIFFERS")
        for reason in ("0x13", "0x14", "0x15", "0x16", "0x1a", "0x1b"):
            self.assertEqual(b[reason + "+text"], {"key": "ERROR_KICKED_FROM_SERVER", "title": "KICKED FROM SERVER",
                                                   "text": "Kicked for teamkilling"}, reason)
        for reason in ("0xa", "0xd", "0x42"):
            self.assertEqual(b[reason + "+text"]["title"], "DISCONNECTED FROM SERVER", reason)
            self.assertEqual(b[reason + "+text"]["text"], "", reason)
        # a level change shows no box (0x00495b07 raises the wait instead)
        self.assertIsNone(b["0x19"])
        self.assertIsNone(b["0x19+text"])

    def test_retail_denial_box(self):
        # 0x00490bd0's result, the join's menu variable, menu/LoadMenu's line
        d = self.r["denial"]
        self.assertEqual(d["0x2"]["text"], "FAILED TO CONNECT TO SERVER! SERVER IS FULL!")
        self.assertEqual(d["0x2"]["title"], "WARNING")
        self.assertEqual(d["0x11"]["text"], "This server requires password.")
        self.assertEqual(d["0x11+retry"]["text"], "This server requires password. Please try again!")
        self.assertEqual(d["0x11"]["title"], "PASSWORD")
        self.assertEqual(d["0x1e"], {"key": None, "title": "PASSWORD", "text": ""})
        self.assertEqual(d["0x1e+retry"]["text"], "FAILED TO CONNECT TO SERVER")
        self.assertEqual(d["0x17"]["text"], "WRONG VERSION! DO YOU WANT TO UPDATE?")
        for reason in ("0x16", "0x18", "0x4"):
            self.assertEqual(d[reason], {"key": "CONFIRMATION_FAILED_TO_CONNECT", "title": "ERROR",
                                         "text": "FAILED TO CONNECT TO SERVER"}, reason)
        self.assertEqual(self.r["denialText"], {
            "2": "FAILED TO CONNECT TO SERVER! SERVER IS FULL!", "17": "This server requires password.",
            "22": "FAILED TO CONNECT TO SERVER", "23": "WRONG VERSION! DO YOU WANT TO UPDATE?",
            "24": "FAILED TO CONNECT TO SERVER", "30": ""})
        self.assertEqual(self.r["titles"]["kicked"], "KICKED FROM SERVER")
        self.assertEqual(self.r["titles"]["banned"], "BANNED FROM SERVER")

    def test_constants(self):
        self.assertEqual(self.r["constants"], {"TIMEOUT": 0x0A, "LEFT": 0x0D, "KICKED": 0x15, "BANNED": 0x16, "LEVEL_CHANGE": 0x19})

    def test_which_refusals_are_final(self):
        f = self.r["final"]
        # full server, connect failed, failed, full-with-reserved: wait and retry
        for r in ("0x2", "0x4", "0x9", "0x1e"):
            self.assertFalse(f[r], r)
        # wrong password, banned address, version either way: stop
        for r in ("0x11", "0x16", "0x17", "0x18"):
            self.assertTrue(f[r], r)


class RejoinMachineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = run_harness()["machine"]

    def evs(self, name):
        return [x["ev"] for x in self.m[name]["log"] if x["ev"] != "probe"]

    def test_slow_server_is_probed_on_bf42pp_time_then_rejoined_with_the_key_and_side(self):
        # bf42++'s pinger (bfhook.cpp:114-135): 1 s, then every 2 s
        m = self.m["slow"]
        self.assertEqual(m["state"], "idle")
        self.assertEqual(m["probeTimes"], list(range(1000, 41001, 2000)))
        self.assertEqual(m["sessions"], [{"key": "4711", "team": 2, "closed": False}])
        done = [x for x in m["log"] if x["ev"] == "rejoined"][0]
        self.assertTrue(done["usedKey"])
        self.assertEqual(done["attempts"], 1)

    def test_retail_and_nfr_timing(self):
        # retail: 16 s, then every 3 s (BF1942.exe 0x004b6ffd, 0x004b6f69)
        self.assertEqual(self.m["retail"]["probeTimes"], [16000, 19000, 22000, 25000, 28000, 31000, 34000, 37000, 40000])
        # bf42++ told nfr: the retail 16 s first, its own 2 s after
        self.assertEqual(self.m["nfr"]["probeTimes"], [16000, 18000, 20000])
        self.assertEqual(self.m["nfr"]["sessions"], [{"key": "4711", "team": 2, "closed": False}])

    def test_full_server_is_retried(self):
        m = self.m["full"]
        self.assertEqual(self.evs("full"), ["attempt", "retry", "attempt", "retry", "attempt", "rejoined"])
        self.assertEqual([s["closed"] for s in m["sessions"]], [True, True, False])
        self.assertTrue(all(s["key"] == "4711" for s in m["sessions"]))

    def test_wrong_password_gives_up(self):
        self.assertEqual(self.evs("badpw"), ["attempt", "give-up"])
        g = self.m["badpw"]["log"][-1]
        self.assertEqual((g["why"], g["reason"]), ("denied", 0x11))
        self.assertEqual(self.m["badpw"]["state"], "failed")

    def test_kicked_never_comes_back(self):
        m = self.m["kicked"]
        self.assertFalse(m["started"])
        self.assertEqual(m["probeTimes"], [])
        self.assertEqual(m["sessions"], [])
        self.assertEqual(m["log"][0]["why"], "kicked")

    def test_horizon(self):
        m = self.m["never"]
        self.assertEqual(m["state"], "failed")
        self.assertEqual(m["log"][-1]["why"], "horizon")
        gaps = [b - a for a, b in zip(m["probeTimes"], m["probeTimes"][1:])]
        # probes are evenly spaced, as the client spaces them; only a failed
        # attempt backs off
        self.assertEqual(set(gaps), {2000})
        self.assertGreater(m["probeTimes"][-1], 118000)

    def test_silent_attempt_times_out_and_retries(self):
        m = self.m["silent"]
        self.assertEqual(self.evs("silent"), ["attempt", "retry", "attempt", "rejoined"])
        retry = [x for x in m["log"] if x["ev"] == "retry"][0]
        self.assertEqual(retry["why"], "no ConnectAccept")
        self.assertEqual(retry["t"], 11000)  # probe at 1 s, 10 s connect timeout

    def test_a_server_close_never_comes_back(self):
        m = self.m["closed"]
        self.assertFalse(m["started"])
        self.assertEqual(m["state"], "failed")
        self.assertEqual([x["ev"] for x in m["log"]], ["give-up"])
        self.assertEqual(m["log"][0]["why"], "closed")

    def test_a_server_close_during_the_join_is_final(self):
        self.assertEqual(self.evs("closedMidJoin"), ["attempt", "give-up"])
        self.assertEqual(self.m["closedMidJoin"]["log"][-1]["why"], "closed")

    def test_a_timeout_during_the_join_is_tried_again(self):
        self.assertEqual(self.evs("timeoutMidJoin"), ["attempt", "retry", "attempt", "rejoined"])

    def test_banned_during_the_join_is_final(self):
        self.assertEqual(self.evs("banned"), ["attempt", "give-up"])
        self.assertEqual(self.m["banned"]["log"][-1]["why"], "banned")

    def test_plain_drop_rejoins_without_a_key(self):
        m = self.m["drop"]
        self.assertEqual(m["sessions"], [{"key": "", "team": 2, "closed": False}])
        self.assertFalse([x for x in m["log"] if x["ev"] == "rejoined"][0]["usedKey"])


class ProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = run_harness()["probe"]

    def test_answer(self):
        self.assertEqual(self.p["up"], {"name": "lab server"})
        self.assertEqual(self.p["requests"], ["0000900000000000"])

    def test_no_answer(self):
        self.assertIsNone(self.p["down"])
        self.assertLess(self.p["downMs"], 1500)


if __name__ == "__main__":
    unittest.main()
