"""ledger_index.py turns the engine ledger into the records Ghidra is annotated from.

The parser reads a hand-written Markdown table, so the cases here are the ones
the real ledger has: pipes inside code spans, struck-through claims, constants
that look like addresses, and the seven-digit spelling of a server address.
"""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE = REPO_ROOT / "features" / "bf1942-engine-reference"

spec = importlib.util.spec_from_file_location("ledger_index", REFERENCE / "ledger_index.py")
ledger_index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger_index)

LEDGER = """# Verification ledger

| Status | Meaning |
|---|---|
| `confirmed` | the engine does this |

## Spawns (2026-10-11; one thing stays open)

Prose above the table cites `0x08163dd0` once, beside SPAWN-25.

| # | Finding | Status | Evidence |
|---|---|---|---|
| SPAWN-25 | (new, 2026-10-11) A point is on only while a seat is in reach. The reach is the asker's | **confirmed**, built 2026-10-11 | `BFSpawnPoint::getActive(bool, int)` 0x08163dd0 ends in `push $0x40a00000` at 0x08163fd6, reads `ds:0x86b01ac` and class id 0xEB97C2FA at `+0x416`; client `0x005b42d0`, its tail 0x005b42f8, loose code 0x00500010 |
| SPAWN-3 | ~~A pad hides its vehicle~~ | **refuted** (2026-10-07) | `a \\| b` and `x | y` are one cell each; `ControlPoint::init` (lnxded `0x08283a90`) |
| SPAWN-10 | No address here | open | never read |

## Flags

| ID | Claim | Where | Status | Evidence |
|---|---|---|---|---|
| AI-2 | The flag word `0x400000` is not an address | [x.py](../x.py) | **verified** | a search over 0x08160000..0x08170000 found 0x08163dd0 |
"""


def tables():
    lnxded = ledger_index.FunctionTable(
        [(0x08163DD0, 0x081640CE, "dice::bf::BFSpawnPoint::getActive(bool, int)"),
         (0x08283A90, 0x08283AFF, "dice::ref2::world::ControlPoint::init()")],
        [(0x086B01AC, 0x086B01AF, "someFloat")])
    client = ledger_index.FunctionTable([(0x005B42D0, 0x005B4400, "")])
    return {"lnxded": lnxded, "client": client}


class LedgerIndexTest(unittest.TestCase):
    def setUp(self):
        self.doc = ledger_index.parse(LEDGER, tables())
        self.rows = {r["id"]: r for r in self.doc["rows"]}

    def test_rows_and_their_order(self):
        self.assertEqual([r["id"] for r in self.doc["rows"]],
                         ["AI-2", "SPAWN-3", "SPAWN-10", "SPAWN-25"])
        self.assertEqual(self.rows["SPAWN-25"]["section"], "Spawns")
        self.assertEqual(self.doc["problems"], [])

    def test_status_and_refutation(self):
        r = self.rows["SPAWN-25"]
        self.assertEqual((r["status"], r["refuted"]), ("confirmed", False))
        self.assertEqual(r["status_text"], "confirmed, built 2026-10-11")
        self.assertEqual(r["statement"], "A point is on only while a seat is in reach.")
        r = self.rows["SPAWN-3"]
        self.assertEqual((r["status"], r["struck"], r["refuted"]), ("refuted", True, True))
        self.assertEqual(r["statement"], "A pad hides its vehicle")
        self.assertEqual(self.rows["SPAWN-10"]["status"], "open")
        self.assertEqual(self.rows["SPAWN-10"]["cites"], [])

    def test_pipes_inside_a_cell_do_not_split_it(self):
        cells = ledger_index.split_cells("| A-1 | `x | y` and `a \\| b` | open | z |")
        self.assertEqual(len(cells), 4)
        self.assertEqual(self.rows["SPAWN-3"]["status"], "refuted")

    def test_addresses_are_classified(self):
        cites = {c["address"]: c for c in self.rows["SPAWN-25"]["cites"]}
        self.assertEqual(sorted(cites), [
            "0x00500010", "0x005b42d0", "0x005b42f8",
            "0x08163dd0", "0x08163fd6", "0x086b01ac"])
        entry = cites["0x08163dd0"]
        self.assertEqual((entry["binary"], entry["kind"]), ("lnxded", "entry"))
        self.assertEqual(entry["row_name"], "BFSpawnPoint::getActive(bool, int)")
        inside = cites["0x08163fd6"]
        self.assertEqual((inside["kind"], inside["function"]), ("inside", "0x08163dd0"))
        self.assertIn("push $0x40a00000 at 0x08163fd6", inside["context"])
        self.assertNotIn("row_name", inside)
        self.assertEqual((cites["0x086b01ac"]["kind"], cites["0x086b01ac"]["symbol"]),
                         ("data", "someFloat"))
        self.assertEqual((cites["0x005b42d0"]["binary"], cites["0x005b42d0"]["kind"]),
                         ("client", "entry"))
        self.assertEqual(cites["0x005b42f8"]["kind"], "inside")
        self.assertEqual(cites["0x00500010"]["kind"], "code")
        self.assertEqual(self.doc["functions"]["0x08163dd0"],
                         "dice::bf::BFSpawnPoint::getActive(bool, int)")

    def test_constants_and_range_bounds_are_not_addresses(self):
        # 0x400000 is a flag, 0x08160000..0x08170000 bounds a search.
        self.assertEqual([c["address"] for c in self.rows["AI-2"]["cites"]], ["0x08163dd0"])

    def test_context_stays_in_its_cell(self):
        c = self.rows["SPAWN-3"]["cites"][0]
        self.assertEqual(c["row_name"], "ControlPoint::init")
        self.assertNotIn("refuted", c["context"])

    def test_prose_is_kept_apart(self):
        self.assertEqual([(c["address"], c["rows"]) for c in self.doc["prose"]],
                         [("0x08163dd0", ["SPAWN-25"])])

    def test_render_is_deterministic_json(self):
        text = ledger_index.render(self.doc)
        self.assertEqual(text, ledger_index.render(ledger_index.parse(LEDGER, tables())))
        back = json.loads(text)
        self.assertEqual(len(back["rows"]), 4)
        self.assertEqual(back["images"]["lnxded"], ["0x08048000", "0x087e1007"])

    def test_new_symbols_take_the_binary_name(self):
        existing = [{"address": "0x08283a90", "name": "ControlPoint::init", "kind": "function",
                     "subsystem": "spawn", "confidence": "verified", "source": "t", "note": ""}]
        new = ledger_index.new_symbols(self.doc, existing, "test")
        self.assertEqual([(s["address"], s["name"], s["subsystem"], s["confidence"]) for s in new],
                         [("0x08163dd0", "dice::bf::BFSpawnPoint::getActive(bool, int)",
                           "spawn", "verified")])


class CheckedInFilesTest(unittest.TestCase):
    def test_symbols_are_sorted_and_unique(self):
        symbols = json.loads((REFERENCE / "symbols.json").read_text())["symbols"]
        addresses = [int(s["address"], 16) for s in symbols]
        self.assertEqual(addresses, sorted(set(addresses)),
                         "symbols.json must stay sorted by address with one entry each; "
                         "merge by address in Python (xref.py add, ledger_index.py)")

    def test_index_is_in_step_with_the_ledger(self):
        if ledger_index.find_lnxded() is None:
            self.skipTest("bf1942_lnxded.static is not on this machine")
        self.assertEqual(
            (REFERENCE / "ledger-index.json").read_text(encoding="utf-8"),
            ledger_index.render(ledger_index.build()),
            "ledger.md changed: run features/bf1942-engine-reference/ledger_index.py "
            "(or annotate.py, which also writes the rows into Ghidra)")


if __name__ == "__main__":
    unittest.main()
