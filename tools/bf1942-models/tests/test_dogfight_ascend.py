"""The ascendancy pilot's bench (features/dogfight-school/reviews/ascend.md):
`PLANS.ascend` in seat 1, starting with the advantage (150 m over him and
300 m behind at +10 m/s, or 200 m over him and 300 m out on his beam), against
every lesson's ace from the nine nearby starts, 50 s, scored as a Ninja by the
shared measure (`dogfight_dfn_measure.mjs`). Both pilots see only what a
pilot could see from his seat (`EYES`, reviews/eyes.md). The runs are
deterministic, so each row's counts are held exactly: what the review claims
is what it flies.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import NamedTuple

from test_dogfight_school import HARNESS, MODULES, THREE_PACKAGE

HERE = Path(__file__).resolve().parent
BENCH = HERE / "dogfight_ascend.mjs"


class Row(NamedTuple):
    works: int
    attacks: tuple[int, int]
    my_shot: tuple[float, float]
    hits_on_him: tuple[int, int]
    six_lost: float
    held: float
    his_shot: float
    landed: int
    killed: int
    stalemate: int


# (start, ace): works/9; attacks, landing shot (s) and rounds on him, least
# and most of the nine; the longest he sat on my six (s); the least share of
# the fight after my first shot I held the advantage; the most his guns had a
# landing shot (s); in how many of the nine I came up with a landing shot,
# shot him down, and sat more than 20 s inside 600 m of him without a shot
# (the measure's stalemate, IDLE).
# Re-pinned 2026-11-12 on retail g and box area
# (features/retail-parity-cross-check-2026-11-12), with `breakTurn` reversing
# at 6 m across: 16 of the 20 rows moved; abeam/taAce now works 3 of 9
# (partly, was 2), astern/uhAce 0 (was 1), abeam/bzAce 5 (was 4).
EXPECTED = {
    ('astern', 'otBreaker'): Row(0, (1, 1), (0.53, 1.33), (6, 11), 0, 0.31, 0.07, 9, 0, 9),
    ('astern', 'btHunter'): Row(3, (1, 2), (0.67, 1.17), (10, 27), 0, 1, 0, 9, 3, 6),
    ('astern', 'scAce'): Row(2, (1, 1), (0.3, 1.53), (5, 23), 2.77, 0.38, 0, 9, 2, 7),
    ('astern', 'taAce'): Row(3, (0, 2), (0, 1.8), (0, 28), 1.43, 0, 0, 7, 3, 6),
    ('astern', 'uoAce'): Row(0, (0, 1), (0, 0.53), (0, 9), 1.43, 0, 0.17, 4, 0, 9),
    ('astern', 'bzAce'): Row(0, (1, 2), (0.97, 1.8), (13, 18), 0, 0.81, 0, 9, 0, 9),
    ('astern', 'uhAce'): Row(0, (1, 2), (0.97, 1.87), (12, 20), 0.67, 0.92, 0, 9, 0, 9),
    ('astern', 'olHunter'): Row(2, (1, 1), (0.67, 1), (10, 22), 0, 1, 0, 9, 2, 7),
    ('astern', 'breakTurn'): Row(1, (1, 3), (0.3, 1.3), (0, 22), 0, 1, 0, 9, 1, 8),
    ('astern', 'breaker'): Row(0, (1, 1), (0.53, 1.33), (6, 11), 0, 0.31, 0.07, 9, 0, 9),
    ('abeam', 'otBreaker'): Row(5, (1, 1), (1.57, 1.83), (10, 28), 0, 0.39, 0, 9, 5, 4),
    ('abeam', 'btHunter'): Row(0, (0, 1), (0, 0.47), (0, 4), 0, 0, 0.37, 2, 0, 9),
    ('abeam', 'scAce'): Row(0, (1, 3), (0.53, 1.4), (2, 19), 11.4, 0.75, 0, 9, 0, 7),
    ('abeam', 'taAce'): Row(3, (1, 3), (0.7, 2.6), (7, 45), 3.6, 0.6, 0, 9, 2, 5),
    ('abeam', 'uoAce'): Row(3, (0, 1), (0.17, 2.13), (2, 36), 8.17, 0, 0.4, 9, 3, 6),
    ('abeam', 'bzAce'): Row(5, (1, 2), (0.5, 2.27), (2, 35), 0, 0.77, 0, 9, 5, 4),
    ('abeam', 'uhAce'): Row(9, (1, 1), (1.1, 1.93), (32, 44), 0, 1, 0, 9, 9, 0),
    ('abeam', 'olHunter'): Row(0, (0, 1), (0, 0.47), (0, 4), 0, 0, 0.37, 2, 0, 9),
    ('abeam', 'breakTurn'): Row(3, (0, 1), (0, 1.6), (1, 42), 0, 0, 0, 6, 3, 6),
    ('abeam', 'breaker'): Row(1, (1, 1), (1.6, 1.83), (10, 22), 0, 0.31, 0.03, 9, 1, 8),
}


def category(works: int) -> str:
    return "works" if works >= 7 else "partly" if works >= 3 else "no"


def run_bench() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        shutil.copyfile(HERE / "dogfight_dfn_measure.mjs", work / "dogfight_dfn_measure.mjs")
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "bench.mjs").write_text(head + "\n" + BENCH.read_text())
        proc = subprocess.run(["node", str(work / "bench.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"ascend bench failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class AscendBenchTests(unittest.TestCase):
    bench: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.bench = run_bench()
        cls.rows = {(r["start"], r["ace"]): r for r in cls.bench["rows"]}

    def test_every_ace_from_both_starts_is_flown_nine_times(self) -> None:
        self.assertEqual("ascend", self.bench["plan"])
        self.assertEqual(set(EXPECTED), set(self.rows))
        for key, row in self.rows.items():
            self.assertEqual(9, row["of"], key)
            self.assertEqual(9, len(row["scores"]), key)

    def test_each_row_flies_what_the_review_claims(self) -> None:
        for key, want in EXPECTED.items():
            row = self.rows[key]
            got = Row(row["works"], tuple(row["attacks"]), tuple(row["myShot"]), tuple(row["hitsOnHim"]),
                      row["sixLost"], row["held"], row["hisShot"], row["landed"], row["killed"], row["stalemate"])
            self.assertEqual(want, got, key)
            self.assertEqual(category(want.works), row["verdict"], key)

    def test_the_totals(self) -> None:
        # Under the eyes and the measure of 2026-11-07 (attacks are 0.3 s
        # bursts 3 s apart, the idle clock runs from a 50 m lead, no hanging),
        # 39 of 180 work, and every one of the 39 is a kill: a landing shot
        # comes up in 154, it is never shot down itself, and 137 end in the
        # stalemate the measure fails. What holds is the first pass; staying
        # on top of an ace who sees it come back does not.
        # Re-pinned 2026-11-12 on retail g and box area
        # (features/retail-parity-cross-check-2026-11-12): 40 of 180 work and
        # 39 are kills (one of abeam/taAce's three works without one), a
        # landing shot in 156, 137 stalemates.
        rows = self.rows.values()
        self.assertEqual(40, sum(r["works"] for r in rows))
        self.assertEqual(156, sum(r["landed"] for r in rows))
        self.assertEqual(39, sum(r["killed"] for r in rows))
        self.assertEqual(0, sum(r["shotDown"] for r in rows))
        self.assertEqual(137, sum(r["stalemate"] for r in rows))

    def test_how_long_the_first_shot_takes_from_a_perch(self) -> None:
        # How long `ascend` needs to come up with the shot: 3.3 to 8.7 s in
        # (11.9 once, the scissors ace off his beam), against every ace but
        # the hunters off the beam, who turn on me at once (a shot in 2 of 9,
        # 10.3 to 19.2 s in), and the Immelmann and up-and-over aces from
        # astern, who pull away first (a shot in 7 and 4 of the nine; 6 and 3
        # before the 2026-11-12 retail-g re-pin).
        for key, row in self.rows.items():
            if key in {("abeam", "btHunter"), ("abeam", "olHunter")}:
                self.assertEqual(2, row["landed"], key)
                self.assertEqual([10.3, 19.17], row["firstShot"], key)
                continue
            if key in {("astern", "taAce"), ("astern", "uoAce")}:
                # 6 and 3 before the 2026-11-12 retail-g re-pin.
                self.assertEqual(7 if key[1] == "taAce" else 4, row["landed"], key)
                continue
            lo, hi = row["firstShot"]
            self.assertGreaterEqual(lo, 3.3, key)
            self.assertLessEqual(hi, 11.87 if key == ("abeam", "scAce") else 8.67, key)

    def test_a_kill_in_one_pass_is_a_ninja(self) -> None:
        # Off the beam of the height ace the first pass shoots him down in all
        # nine, one attack each, and that is the ascendancy won.
        row = self.rows[("abeam", "uhAce")]
        self.assertEqual(9, row["killedInOnePass"])
        self.assertEqual(9, row["works"])


if __name__ == "__main__":
    unittest.main()
