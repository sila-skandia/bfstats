"""A soldier's own lines roll over the stems the speaker's language ships.

RADIO-6: a load whose file the language does not ship is dropped before the
roll, so a patch never goes silent for want of a file. BF1918's Romanian, Greek
and Senegalese soldiers ship `Dying1..8` where `SoldierKilled.ssc` names
`Dying1..11`; the page rolled all eleven and three deaths in eleven were silent.
`page-audio.js` filters through `radio.js` `nationStems` over
`_shared/voices/soldier-voices.json`.
"""
# watches: tools/bf1942-models/viewer/page-audio.js tools/bf1942-models/viewer/radio.js
from __future__ import annotations

import json
import re
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SOURCE = (HERE / "viewer" / "page-audio.js").read_text()


class SoldierVoiceRolls(unittest.TestCase):
    def test_both_pickers_roll_over_shipped_stems(self) -> None:
        self.assertIn("import { nationStems } from './radio.js';", SOURCE)
        death = SOURCE[SOURCE.index("async function playSoldierDeathSound"):][:900]
        self.assertRegex(death, r"shippedStems\(")
        hit = SOURCE[:SOURCE.index("async function playSoldierDeathSound")]
        hit = hit[hit.rindex("c_SstHitDamage"):]
        self.assertRegex(hit, r"shippedStems\(")

    def test_the_filter_drops_what_a_language_lacks(self) -> None:
        manifest = {"nations": {"rom": {"samples": []}, "ger": {"samples": []}},
                    "missing": [{"nation": "rom", "stems": ["Dying9", "Dying10", "Dying11"]}]}
        script = (
            "import { nationStems } from './viewer/radio.js';"
            f"const d = {json.dumps(manifest)};"
            "const stems = Array.from({length: 11}, (_, i) => 'Dying' + (i + 1));"
            "console.log(JSON.stringify([nationStems(d, {stems}, 'rom').length,"
            " nationStems(d, {stems}, 'ger').length]));")
        out = subprocess.run(["node", "--input-type=module", "-e", script], cwd=HERE,
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual([8, 11], json.loads(out))


if __name__ == "__main__":
    unittest.main()
