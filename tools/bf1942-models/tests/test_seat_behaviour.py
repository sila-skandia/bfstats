"""Seated bots (features/bot-map-generation/seat-behaviour.md).

Two departures from the engine, each pinned here:

* The fire correction (ledger AI-105) judged a round by the last point the
  bot's 30 Hz tick saw it at. A round at 800 to 1000 m/s is seen once inside
  60 m and gone the next tick, so one that flew past a soldier into the wall
  behind read as "short" by most of the range and lifted the aim 0.1 m a
  metre of it, until the barrel no longer met the trigger's precision and
  the gun held. The round's last step is now its impact (`landRound`).
* Every seat ran the vanilla `Tank` rows of `AIbehaviours.con`, and the Fire
  rule was read off vanilla's row numbers. The engine registers each seat's
  own row, by its mod's own list: vanilla's `Fixed` row has no Avoid or
  TakeCover; BF1918's 9 is `Gunner` (`BBFireInfantery`), not `BoatFixed`
  (`bot-rows.js`).

The harness runs on the module set `test_bot_ai.py` stages. The transcribed
rows are checked against the shipped `AIbehaviours.con` where the game is
installed.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "seat_behaviour_harness.mjs"
GAME = Path.home() / ".wine" / "drive_c" / "EA Games" / "Battlefield 1942" / "Mods"
# The mod folder and game archive each transcribed table came from.
SHIPPED = {
    "bf1942": "bf1942/Archives/bf1942/Game.rfa",
    "fh": "FH/Archives/bf1942/game.rfa",
    "fhsw": "FHSW/Archives/bf1942/game.rfa",
    "bf1918": "bf1918/Archives/bf1942/game.rfa",
    "eod": "EoD/Archives/bf1942/game.rfa",
    "gcmod": "GCMOD/Archives/bf1942/game.rfa",
}
ABBR = {"BBAvoid": "Avoid", "BBMoveTo": "MoveTo", "BBMoveToFixed": "MoveToFixed", "BBIdle": "Idle",
        "BBFireInfantery": "FireInfantery", "BBFireLargeBore": "FireLargeBore", "BBFire3d": "Fire3d",
        "BBFireUnarmed": "FireUnarmed", "BBFireDriver": "FireDriver", "BBFireGuided": "FireGuided",
        "BBScout": "Scout", "BBTakeCover": "TakeCover", "BBTakeCoverInfantry": "TakeCoverInfantry",
        "BBChange": "Change", "BBChangeTeleport": "ChangeTeleport", "BBChangeLandingCraft": "ChangeLandingCraft",
        "BBMedicAssist": "MedicAssist", "BBRoam": "Roam"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def shipped_rows(text: str) -> list:
    """`[name, {behaviour: generator}]` per row, as bot-rows.js writes them."""
    text = "\n".join(l for l in text.splitlines() if not l.strip().lower().startswith("rem"))
    rows = {int(n): name for n, name in re.findall(r"^\s*aiSettings\.setVehicle\s+(\d+)\s+(\w+)", text, re.M | re.I)}
    beh: dict[str, dict[str, str]] = {}
    for v, b, gen in re.findall(r"^\s*aiSettings\.setVehicleBehaviour\s+(\w+)\s+(\w+)\s+(\w+)", text, re.M | re.I):
        beh.setdefault(v.lower(), {})[b] = ABBR.get(gen, gen)
    return [[rows[n], beh.get(rows[n].lower(), {})] for n in range(max(rows) + 1)]


class SeatBehaviourTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # -- the round's last step -------------------------------------------

    def test_a_round_that_strikes_past_the_target_has_passed_it(self) -> None:
        past = self.results["landing"]["past"]
        self.assertTrue(past["passed"])
        self.assertEqual(past["post"], [0, 0.5, 53])

    def test_a_round_that_strikes_short_is_short_at_its_impact(self) -> None:
        short = self.results["landing"]["short"]
        self.assertFalse(short["passed"])
        self.assertEqual(short["pre"], [0, 0.2, 20])

    def test_the_wall_behind_the_target_no_longer_lifts_the_aim(self) -> None:
        landed = self.results["correction"]["landed"]
        sampled = self.results["correction"]["sampled"]
        self.assertTrue(landed["passed"])
        # Read at its last sampled point (33 m of 50) the round lifts the aim
        # 0.1 x 17 m; read at its impact 3 m past the target it moves the aim
        # by the miss alone.
        self.assertAlmostEqual(sampled["sum"][1], 1.7, places=2)
        self.assertLess(max(abs(v) for v in landed["sum"]), 0.5)

    # -- the seat's row --------------------------------------------------

    def test_a_mod_row_is_read_by_its_own_name_and_number(self) -> None:
        rows = self.results["rows"]
        self.assertEqual(rows["bf1918Gunner"]["name"], "Gunner")
        self.assertEqual(rows["bf1918ByNumber"]["name"], "Gunner")
        self.assertEqual(rows["vanilla9"]["name"], "BoatFixed")
        self.assertEqual(rows["dc4"]["name"], "Fixed")
        self.assertEqual(rows["fh20"]["name"], "BoatFixedNonArty")
        self.assertIsNone(rows["unknown"])
        self.assertIsNone(rows["none"])

    def test_the_fire_rule_is_the_rows_generator(self) -> None:
        fire = self.results["fire"]
        self.assertEqual(fire["bf1918Gunner"], "infantry")      # BBFireInfantery, where vanilla's 9 is large-bore
        self.assertEqual(fire["vanilla9"], "largeBore")
        self.assertEqual(fire["vanilla4"], "infantry")
        self.assertEqual(fire["fh20"], "infantry")
        self.assertEqual(fire["bf1918Artillery"], "artilleryDriver")
        self.assertEqual(fire["numberOnly9"], "largeBore")
        self.assertEqual(fire["numberOnly4"], "infantry")

    def test_a_seat_registers_its_rows_behaviours(self) -> None:
        b = self.results["behaviours"]
        self.assertEqual(b["foot"], self.results["REGISTERED"])
        self.assertEqual(b["vanillaFixed"], ["MoveTo", "Idle", "Fire", "Scout", "Change"])
        self.assertEqual(b["vanillaTank"], ["Avoid", "MoveTo", "Idle", "Fire", "Scout", "TakeCover", "Change"])
        self.assertEqual(b["vanillaPassenger"], ["MoveTo", "Idle", "Fire", "Scout", "Change"])
        self.assertEqual(b["vanillaCar"], ["Avoid", "MoveTo", "Idle", "Fire", "Scout", "Change"])
        self.assertEqual(b["fhTank"], ["Avoid", "MoveTo", "Idle", "Fire", "Scout", "Change"])
        self.assertEqual(b["bf1918HeavyTank"], ["Avoid", "MoveTo", "Idle", "Fire", "Change"])

    def test_an_aircraft_and_a_seat_with_no_row_keep_the_tank_rows(self) -> None:
        b = self.results["behaviours"]
        tank = ["Avoid", "MoveTo", "Idle", "Fire", "Scout", "TakeCover", "Change"]
        self.assertEqual(b["plane"], tank)
        self.assertEqual(b["noRow"], tank)

    def test_the_rows_are_the_shipped_files(self) -> None:
        try:
            from bf42.rfa import RfaArchive
        except ImportError as exc:  # pragma: no cover
            raise unittest.SkipTest(f"bf42.rfa: {exc}")
        checked = 0
        for mod, rel in SHIPPED.items():
            archive = GAME / rel
            if not archive.exists():
                continue
            rfa = RfaArchive(archive)
            name = next((n for n in rfa.entries if n.lower().endswith("game/aibehaviours.con")), None)
            self.assertIsNotNone(name, f"{rel} has no AIbehaviours.con")
            want = shipped_rows(rfa.read(name).decode("latin-1"))
            getattr(getattr(rfa, "_fh", None), "close", lambda: None)()
            self.assertEqual(self.results["table"][mod], want, mod)
            checked += 1
        if not checked:
            raise unittest.SkipTest("no BF1942 install with the mods")


if __name__ == "__main__":
    unittest.main()
