"""The ScoreManager's ghost body: tickets (sidecar/ghost/score-manager.mjs)."""
import json
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = """
import fs from 'node:fs';
import { decodeScoreBody, looksLikeScoreBody, TICKETS } from '../sidecar/ghost/score-manager.mjs';
const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_score_manager.json', import.meta.url)));
const cur = {}; const series = [];
for (const r of rows) { const b = decodeScoreBody(r.hex, r.bodyBits); Object.assign(cur, b.ints); series.push([cur[TICKETS[1]], cur[TICKETS[2]]]); }
console.log(JSON.stringify({ first: looksLikeScoreBody(rows[0].hex, rows[0].bodyBits), later: looksLikeScoreBody(rows[1].hex, rows[1].bodyBits), series }));
"""


class ScoreManagerTests(unittest.TestCase):
    def test_tickets_bleed_on_the_lab(self):
        out = subprocess.run(["node", "--input-type=module", "-e", SCRIPT], cwd=HERE,
                             capture_output=True, text=True, check=True)
        r = json.loads(out.stdout)
        self.assertTrue(r["first"])       # the whole-record first send is how it is found
        self.assertFalse(r["later"])
        self.assertEqual(r["series"][0], [12, 48])
        axis = [s[0] for s in r["series"]]
        self.assertEqual(axis, sorted(axis, reverse=True))  # side 1 bleeds
        self.assertTrue(all(s[1] == 48 for s in r["series"]))


if __name__ == "__main__":
    unittest.main()
