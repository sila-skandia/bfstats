"""`viewer/vehicle-players.js` under node: who shares the vehicle.

Retail's crew list (ledger VHUD-16..VHUD-18): `0x006d7560` writes
`"(%d) %s"` -- the seat's 1-based place in the root's seat map and the
occupant's name -- into `VehiclePlayersText<place>`, blanks the rest, and
sets `ShowVehiclePlayers` when more than one seat is held. It runs on taking
a seat, on anyone entering or leaving the hull, and on `c_PIMenuSelect1..6`.
`menu/InGame` takes it down after 3.0 of menu time, counted 1/30 a painted
frame while it is drawn (HFD-6).

The game-data half reads the layout and the client binary where they are
installed, so the constants the module holds are the ones the game ships.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("vehicle_players_harness.mjs")
MODULES = {"vehicle-players.js": VIEWER / "vehicle-players.js"}

sys.path.insert(0, str(ROOT))
from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from bf42 import meme  # noqa: E402

GAME_MENU = DEFAULT_GAME_DIR / "Mods" / "bf1942" / "Archives" / "menu.rfa"
CLIENT_EXE = ROOT / "ghidra-cloud" / ".work" / "BF1942.exe"

TEXTS = [f"Vehicle/VehiclePlayers/VehiclePlayersText{i}" for i in range(1, 8)]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class VehiclePlayersTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_variables_are_the_ones_the_client_registers(self) -> None:
        c = self.results["constants"]
        self.assertEqual("Vehicle/ShowVehiclePlayers", c["show"])
        self.assertEqual(TEXTS, c["texts"])
        self.assertEqual(7, c["slots"])

    def test_a_row_is_the_seat_place_and_the_name_and_empty_seats_stay_blank(self) -> None:
        self.assertEqual(["(1) skandia", "", "(3) Rommel", "", "", "", ""],
                         self.results["rows"]["texts"])
        self.assertEqual(2, self.results["rows"]["held"])
        self.assertEqual(["", "(2) skandia", "", "", "", "", ""],
                         self.results["rowsAlone"]["texts"])
        # An eighth seat is held but has no row of its own.
        self.assertEqual(2, self.results["rowsEight"]["held"])
        self.assertEqual("", self.results["rowsEight"]["texts"][6])

    def test_alone_the_rows_are_written_and_the_list_stays_down(self) -> None:
        self.assertEqual({"shown": False, "text1": "(1) skandia", "text2": ""},
                         self.results["alone"])
        self.assertFalse(self.results["keyAlone"])

    def test_entering_beside_someone_shows_the_list_for_the_layout_s_timeout(self) -> None:
        # 3.0 in float32 steps of 1/30: the 91st painted frame reaches it,
        # and the frame the timeout fires on still draws.
        self.assertEqual(91, self.results["enterFrames"])
        self.assertEqual(["(1) skandia", "(2) Patton", "", "", "", "", ""],
                         self.results["enterTexts"])
        self.assertFalse(self.results["steadyShown"])

    def test_someone_climbing_in_brings_it_back_with_his_row(self) -> None:
        self.assertEqual(91, self.results["joinFrames"])
        self.assertEqual("(3) Rommel", self.results["joinTexts"][2])

    def test_keys_one_to_six_bring_it_back_and_seven_does_not(self) -> None:
        self.assertEqual(91, self.results["keyFrames"])
        self.assertFalse(self.results["key7Shown"])
        self.assertFalse(self.results["keyOnFoot"])

    def test_a_second_trigger_does_not_stretch_it(self) -> None:
        self.assertEqual(91, self.results["retriggerFrames"])

    def test_the_rows_follow_a_thinning_crew_while_it_is_up(self) -> None:
        self.assertTrue(self.results["thinned"]["shown"])
        self.assertEqual(["(1) skandia", "", "", "", "", "", ""],
                         self.results["thinned"]["texts"])

    def test_getting_out_takes_it_down_and_the_counter_keeps_its_time(self) -> None:
        self.assertFalse(self.results["leftShown"])
        self.assertAlmostEqual(1.0, self.results["leftClock"], places=5)
        self.assertEqual(61, self.results["reenterFrames"])

    def test_names_decode_where_the_hud_face_can_draw_them(self) -> None:
        n = self.results["names"]
        self.assertEqual("Привет", n["decoded"])
        self.assertEqual("[GR]Bloke", n["latin"])
        # standard6 has Latin glyphs only, as retail's face: the raw name.
        self.assertEqual("Ïðèâåò", n["latinFace"])
        self.assertEqual(n["decoded"], n["fullFace"])
        self.assertEqual("(1) Ïðèâåò", self.results["drawnName"])

    def test_the_decoder_is_the_ui_s(self) -> None:
        # vehicle-players.js restates ui/src/utils/playerName.ts; the 80%
        # rule and the cp1252 table must not drift.
        ui = (ROOT.parents[1] / "ui" / "src" / "utils" / "playerName.ts")
        if not ui.exists():
            self.skipTest("the UI is not in this tree")
        src = (VIEWER / "vehicle-players.js").read_text()
        self.assertIn("nonLatin / total >= 0.8", ui.read_text())
        self.assertIn("nonLatin / total >= 0.8", src)
        ui_high = set(int(h, 16) for h in re.findall(r":\s*0x([89][0-9A-Fa-f])", ui.read_text()))
        js_high = set(int(h, 16) for h in re.findall(r":\s*0x([89][0-9a-fA-F])", src))
        self.assertEqual(ui_high, js_high)

    def test_the_page_feeds_it_from_every_seat_path(self) -> None:
        hud = (VIEWER / "vehicle-hud.js").read_text()
        self.assertIn("players.observe(page.occupancy.root, crewBySeat())", hud)
        self.assertIn("vehicleHud.players.leave()", hud)
        local = (VIEWER / "local-player.js").read_text()
        body = local[local.index("function switchSeat(position)"):]
        # The key raises the list before a real server takes the switch.
        self.assertLess(body.index("vehiclePlayersKey"), body.index("requestSeatSwitch"))
        page = (VIEWER / "map.html").read_text()
        self.assertIn("vehicleHud.feedVehiclePlayers();", page)
        replay = (VIEWER / "replay-hud.js").read_text()
        self.assertIn("this.players.observe(s.crewHull", replay)


@unittest.skipUnless(GAME_MENU.exists(), "needs the BF1942 install")
class VehiclePlayersGameDataTests(unittest.TestCase):
    """The list's own data in vanilla `menu/InGame`."""

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import RfaArchive
        with RfaArchive(GAME_MENU) as arch:
            entry = next(e for e in arch.entries if e.lower() == "menu/ingame")
            data = arch.read(entry)
        cls.root, _ = meme.load(data)
        seen, stack, objs = set(), [cls.root], []
        while stack:
            obj = stack.pop()
            if isinstance(obj, list):
                stack.extend(obj)
            elif isinstance(obj, meme.Obj) and id(obj) not in seen:
                seen.add(id(obj))
                objs.append(obj)
                stack.extend(obj.fields.values())
        cls.objs = objs

    def named(self, value) -> str | None:
        return value.name if isinstance(value, meme.Obj) else None

    def test_the_list_is_gated_on_both_flags_with_no_fade(self) -> None:
        [cull] = [o for o in self.objs if o.cls == "CullNode"
                  and self.named(o.get("Variable")) == "Vehicle/ShowVehiclePlayers"]
        self.assertEqual((0.0, 0.0), (cull["In time"], cull["Out time"]))
        inner = cull["Next node"]
        self.assertEqual("CullNode", inner.cls)
        self.assertEqual("Vehicle/ShowVehicleIcon", self.named(inner["Variable"]))

    def test_a_timeout_of_three_drops_the_flag_and_resets_its_counter(self) -> None:
        [node] = [o for o in self.objs if o.cls == "BfVariableTimeoutActionNode2"
                  and self.named(o.get("Current time")) == "Vehicle/VehiclePlayers/VehiclePlayersTimeOut"]
        self.assertAlmostEqual(3.0, node["Timeout time"]["Value"], places=6)
        actions = node["Action"]["Actions"]
        writes = {self.named(a["Variable"]): a["Value"]["Value"]
                  for a in actions if isinstance(a, meme.Obj)}
        self.assertEqual({"Vehicle/ShowVehiclePlayers": False,
                          "Vehicle/VehiclePlayers/VehiclePlayersTimeOut": 0.0}, writes)
        src = (VIEWER / "vehicle-players.js").read_text()
        match = re.search(r"VEHICLE_PLAYERS_TIMEOUT = Math\.fround\(([0-9.]+)\)", src)
        self.assertIsNotNone(match)
        self.assertAlmostEqual(node["Timeout time"]["Value"], float(match.group(1)), places=6)

    def test_six_rows_in_the_vehicle_player_style(self) -> None:
        rows = [o for o in self.objs if o.cls == "TextNode"
                and (self.named(o.get("String")) or "").startswith("Vehicle/VehiclePlayers/")]
        self.assertEqual(TEXTS[:6], sorted(self.named(o["String"]) for o in rows))
        self.assertEqual({"Style/InGameVehiclePlayerStyle"}, {self.named(o["Style"]) for o in rows})


@unittest.skipUnless(CLIENT_EXE.exists(), "needs the client binary")
class VehiclePlayersBinaryTests(unittest.TestCase):
    def test_the_row_format_is_the_client_s(self) -> None:
        data = CLIENT_EXE.read_bytes()
        self.assertIn(b"(%d) %s\x00", data)
        self.assertIn(b"VehiclePlayersText%d\x00", data)
        src = (VIEWER / "vehicle-players.js").read_text()
        self.assertIn("`(${i + 1}) ${", src)


if __name__ == "__main__":
    unittest.main()
