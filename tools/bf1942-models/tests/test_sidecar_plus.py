"""BF42++'s protocol additions, through the sidecar.

BF42++ (bf42plus, ~/projects/skandia/bf42plus on this PC) is the community
client most BF1942 servers expect. It adds three game events (HUDText 0x01,
CreateStaticObject 0x1c, UpdateStaticObject 0x1d), a SpecialGame action (2,
"skip StaticObjects.con"), server settings carried in the welcome lines, a
marker in the ConnectAcceptAck, and a faster map-change pinger. A game event
has no length on the wire, so one the sidecar cannot read loses the rest of
its block: these tests build each event's bits from bf42plus's own readers
(src/bf/gameevent.cpp:288-335) and decode them through a Session, each
followed by an ordinary event that must still read right.

features/udp-sidecar/wire.md section 30 is the inventory.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "sidecar_plus_harness.mjs"
_cache = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    _cache = json.loads(proc.stdout)
    return _cache


def crc8(data: bytes) -> int:
    """bf42plus src/util.cpp:195, written again here: init 0xff, poly 0x97."""
    crc = 0xFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x97) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


class EventFramingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_every_event_reads_and_the_ack_after_it_survives(self):
        seen = self.r["block"]["seen"]
        types = [e["type"] for e in seen]
        self.assertEqual(types[1::2], ["Ack"] * 11)
        self.assertEqual(types[0::2], [
            "SpecialGame", "SetLevel", "CreateStaticObject", "CreateStaticObject",
            "UpdateStaticObject", "UpdateStaticObject", "UpdateStaticObject",
            "UpdateStaticObject", "HUDText", "HUDText", "SpecialGame"])
        self.assertTrue(all(e["value"] == 0xDEADBEEF for e in seen if e["type"] == "Ack"))

    def test_create_static_object(self):
        full, bare = [e for e in self.r["block"]["seen"] if e["type"] == "CreateStaticObject"]
        self.assertEqual((full["template"], full["objectId"]), (2790, 7))
        self.assertEqual(full["pos"], [512.25, 77.5, -1024.75])
        self.assertEqual(full["rot"], [90, -5, 2.5])
        self.assertEqual(full["scale"], [1, 2, 0.5])
        self.assertEqual((bare["template"], bare["objectId"], bare["hasTransform"], bare["hasScale"]),
                         (31, 65535, False, False))
        self.assertNotIn("pos", bare)

    def test_update_static_object(self):
        ups = [e for e in self.r["block"]["seen"] if e["type"] == "UpdateStaticObject"]
        self.assertEqual([u["action"] for u in ups], [0, 1, 2, 3])
        self.assertEqual(ups[0]["value"], [1, 2, 3])
        self.assertNotIn("value", ups[3])  # delete carries no vector

    def test_hud_text(self):
        huds = [e for e in self.r["block"]["seen"] if e["type"] == "HUDText"]
        self.assertEqual(huds[0], {"type": "HUDText", "id": 1, "kind": 3, "text": "Server restarting, été"})
        self.assertEqual(huds[1]["text"], "")

    def test_records(self):
        recs = self.r["block"]["records"]
        create = [x for x in recs if x["e"] == "createStatic"]
        self.assertEqual(create[0]["id"], 7)
        self.assertEqual(create[0]["tid"], 2790)
        self.assertEqual([x["action"] for x in recs if x["e"] == "updateStatic"],
                         ["move", "rotate", "scale", "delete"])
        self.assertIn({"e": "hudText", "kind": 3, "text": "Server restarting, été"}, recs)

    def test_writers_match_the_readers(self):
        self.assertTrue(self.r["writers"]["same"])

    def test_an_unregistered_id_still_stops_the_block(self):
        # 0x1f has no maker in either client: the rest of the block is lost.
        # the unknown id is reported as it is read; the Ack before it is delivered
        # after the block, and the Ack after it is lost
        self.assertEqual(self.r["unknown"], ["unknown", "Ack"])


class SkipStaticObjectsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_special_2_before_set_level_switches_them_off_once(self):
        self.assertEqual(self.r["block"]["flags"], ["skip"])

    def test_special_2_after_set_level_does_nothing(self):
        self.assertEqual(self.r["lateSpecial"], {"flags": [], "skip": False})


class ServerSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()
        cls.p = cls.r["parse"]

    def test_welcome_lines_through_a_session(self):
        w = self.r["welcome"]
        self.assertEqual(w["plain"]["flags"], [])
        self.assertEqual(w["nfr"]["flags"], ["settings:UI", "settings:UI,3DM,3DO"])
        self.assertFalse(w["nfr"]["ui"]["allowFasterRestart"])
        self.assertFalse(w["nfr"]["ui"]["openSpawnScreenOnDeath"])
        self.assertEqual(w["nfr"]["mine"], {"allow": True, "distance": 50, "color": 0xFF0000, "text": "*MINE*"})
        self.assertEqual(w["nfr"]["custom"][0]["text"], "MORTAR")
        self.assertEqual(w["nfr"]["framed"], ["WelcomeMsg", "WelcomeMsg", "Ack"])

    def test_several_on_a_line(self):
        self.assertTrue(self.p["several"]["skipBriefingWindow"])
        self.assertFalse(self.p["several"]["showEnemyNametags"])

    def test_unclosed_and_bad_names(self):
        self.assertEqual(self.p["unclosed"], [])
        self.assertEqual(self.p["lower"], [])
        self.assertEqual(self.p["lengths"], ["UI"])
        # the first bad character ends the whole line: hen after it is lost
        self.assertFalse(self.p["badChar"]["allowFasterRestart"])
        self.assertTrue(self.p["badChar"]["showEnemyNametags"])

    def test_the_clients_slips_are_kept(self):
        # settings.cpp:347/353: 3DS and 3DCP write the mine map's distance
        self.assertEqual(self.p["slip"]["mine"], 7)
        self.assertEqual(self.p["slip"]["supply"], {"allow": True, "distance": 65})
        self.assertEqual(self.p["slip"]["cp"], {"allow": True, "distanceRadiusFactor": 4})

    def test_numbers_and_colours(self):
        self.assertEqual(self.p["numbers"], [12, 0, 0, -3])
        self.assertEqual(self.p["colors"], [0xFF00AA, 0xFF8000, 0x1E90FF, 0xFFFFFFFF, True, 0xFFFFFFFF])

    def test_custom_markers(self):
        self.assertEqual([(c["templateName"], c["text"]) for c in self.p["custom"]], [("Mortar", "Mortar")])

    def test_one_line_at_a_time(self):
        self.assertTrue(self.p["nul"]["skipBriefingWindow"])
        self.assertTrue(self.p["nul"]["showEnemyNametags"])  # after the NUL: unread
        self.assertTrue(self.p["split"])


class RestartTimingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_timing(self):
        t = self.r["timing"]
        self.assertEqual(t["plus"], {"firstProbeMs": 1000, "probeMs": 2000})
        # nfr restores the 16 s first delay only; the 2 s interval is patched
        # at start-up whatever the server says (bfhook.cpp:124-135)
        self.assertEqual(t["plusNfr"], {"firstProbeMs": 16000, "probeMs": 2000})
        self.assertEqual(t["retail"], {"firstProbeMs": 16000, "probeMs": 3000})

    def test_a_session_answers_for_its_server(self):
        w = self.r["welcome"]
        self.assertEqual(w["plain"]["timing"], {"firstProbeMs": 1000, "probeMs": 2000})
        self.assertEqual(w["nfr"]["timing"], {"firstProbeMs": 16000, "probeMs": 2000})
        self.assertEqual(w["retail"]["timing"], {"firstProbeMs": 16000, "probeMs": 3000})


class AcceptAckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a = run_harness()["ack"]

    def test_plus_marker(self):
        b = bytes.fromhex(self.a["plusDefault"])
        self.assertEqual(len(b), 8)
        self.assertEqual(b[0], 5)              # the id ConnectAccept gave
        self.assertEqual(b[1], ord("+"))
        self.assertEqual(b[2] >> 4, 4)         # still a ConnectAcceptAck
        self.assertEqual(b[2] & 0xF, 0)        # build 0
        self.assertEqual(tuple(b[3:6]), (2, 0, 0))
        self.assertEqual(b[6], 2)              # PLUS_PROTOCOL_VERSION
        self.assertEqual(b[7], crc8(b[1:7]))

    def test_custom_version_caps_the_build_nibble(self):
        b = bytes.fromhex(self.a["custom"])
        self.assertEqual(b[2], 0x4F)           # min(20, 15)
        self.assertEqual(tuple(b[3:6]), (1, 6, 3))
        self.assertEqual(b[7], crc8(b[1:7]))

    def test_retail(self):
        self.assertEqual(self.a["retail"], "0500400000000000")
        self.assertIsNone(self.a["parsedRetail"])

    def test_parse_and_crc(self):
        self.assertEqual(self.a["parsed"], {"build": 0, "major": 2, "minor": 0, "patch": 0, "protocol": 2})
        self.assertEqual(self.a["crcCheck"], crc8(b"123456789"))


if __name__ == "__main__":
    unittest.main()
