"""The dogfight school's briefing (features/dogfight-school, "The briefing").

A way into the school (`play/boot-loader/school-entry.js`) puts the school's
own briefing over the Range's load (`viewer/dogfight-briefing.js`): where you
are going, what happens next, the move's steps, the keys. These hold which
addresses get it, what it says for each, and that the range waits for it.
"""

# watches: tools/bf1942-models/viewer/dogfight-briefing.js tools/bf1942-models/viewer/play/boot-loader/school-entry.js tools/bf1942-models/viewer/dogfight-steps.js tools/bf1942-models/viewer/dogfight-lessons.js tools/bf1942-models/viewer/map.html tools/bf1942-models/viewer/proving-ground-page.js tools/bf1942-models/viewer/progress.js

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

SCRIPT = f"""
const {{ briefingFor, mapTitle }} = await import({json.dumps((VIEWER / 'dogfight-briefing.js').as_uri())});
const {{ schoolEntry }} = await import({json.dumps((VIEWER / 'play' / 'boot-loader' / 'school-entry.js').as_uri())});
const {{ LESSONS }} = await import({json.dumps((VIEWER / 'dogfight-lessons.js').as_uri())});
const queries = [
  'proving=1&map=coral_sea&botCount=1&school=&spawn=FiringLine',
  'proving=1&map=el_alamein&arena=dogfight&spawn=FiringLine',
  'proving=1&map=el_alamein&dogfight=boom-and-zoom&move=dip',
  'proving=1&map=el_alamein&dogfight=break-turn',
  'proving=1&map=el_alamein&course=loop',
  'proving=1&map=el_alamein',
  'map=el_alamein&school=',
  'proving=1&map=el_alamein&school=&shots=1',
];
const entries = queries.map(q => schoolEntry(new URLSearchParams(q)));
const moves = [];
for (const L of LESSONS) for (const d of L.demos) if (['dip', 'flip', 'ninja'].includes(d.kind))
  moves.push([L.id, d.id, briefingFor({{ kind: 'move', map: 'coral_sea', lesson: L.id, move: d.id }})]);
console.log(JSON.stringify({{
  entries, said: entries.map(e => e && briefingFor(e)), moves, title: mapTitle('battle_of_britain'),
}}));
"""


class BriefingTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", "--input-type=module", "-e", SCRIPT], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"the briefing did not load:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_only_a_way_into_the_school_gets_the_briefing(self) -> None:
        kinds = [e and e["kind"] for e in self.r["entries"]]
        self.assertEqual(["school", "school", "move", "lesson", "course", None, None, None], kinds)

    def test_each_kind_says_where_and_what_to_press(self) -> None:
        school, _, move, lesson, course = self.r["said"][:5]
        self.assertEqual("Into the school", school["go"])
        self.assertEqual("Extension (the Dip)", move["title"])
        self.assertEqual("Practise the extension", move["go"])
        self.assertEqual("The break turn", lesson["title"])
        self.assertEqual("Take off", course["go"])
        for said in self.r["said"][:5]:
            with self.subTest(said["title"]):
                self.assertTrue(said["next"][0].startswith("The Range loads over Coral Sea") or "El Alamein" in said["next"][0])
                self.assertEqual(4, len(said["next"]))
        # The school lists the three ways out by their real names.
        self.assertEqual(["Extension", "Reversal", "Bounce"], [i["name"] for i in school["aside"]["items"]])
        # A course has no enemy pilot in it.
        self.assertNotIn("ace", course["next"][0])

    def test_every_move_briefs_its_steps(self) -> None:
        self.assertEqual(30, len(self.r["moves"]))
        for lesson, move, said in self.r["moves"]:
            with self.subTest(f"{lesson}/{move}"):
                steps = said["aside"]["items"]
                self.assertTrue(2 <= len(steps) <= 5)
                self.assertEqual(list(range(1, len(steps) + 1)), [s["n"] for s in steps])

    def test_the_words_say_they_not_he(self) -> None:
        # The owner's rule for user-facing copy: players and bots are they.
        texts = []
        for said in [s for s in self.r["said"] if s] + [m[2] for m in self.r["moves"]]:
            texts += [said["kicker"], said["title"], said["lede"], *said["next"]]
            texts += [i.get("text", "") for i in (said["aside"] or {}).get("items", [])]
        for text in texts:
            self.assertNotRegex(f" {text} ", r"(?i)\b(he|him|his|himself)\b", text)

    def test_map_ids_read_as_names(self) -> None:
        self.assertEqual("Battle Of Britain", self.r["title"])


class WiringTests(unittest.TestCase):
    """map.html puts it up and the range waits for it."""

    def test_the_page_puts_it_up_and_the_range_waits(self) -> None:
        page = (VIEWER / "map.html").read_text()
        self.assertRegex(page, r"createSchoolBriefing\(\{\s*entry: SCHOOL_ENTRY, overlay,")
        # It stays up after take-off until a lesson, course or the school has the screen.
        self.assertIn("handedOver: () =>", page)
        self.assertIn("schoolHeld: () => Boolean(schoolBriefing?.up)", page)
        # The range's readout never draws over a loading screen.
        self.assertRegex(page, r"covered: \(\) =>[^;]*overlay\.loadingCaptures\(\)")
        range_page = (VIEWER / "proving-ground-page.js").read_text()
        self.assertIn("const held = !!page.schoolHeld?.();", range_page)
        for want in ("wantLesson &&", "wantCourse &&", "wantSchool != null"):
            line = next(l for l in range_page.splitlines() if want in l and l.strip().startswith("if"))
            self.assertIn("held", line, line)

    def test_the_range_goes_back_to_the_range_tab(self) -> None:
        # Leaving the Range (the dogfight arena among it) lands on THE RANGE
        # tab, not the menu's front page (the owner, 2026-11-08).
        page = (VIEWER / "map.html").read_text()
        self.assertIn("if (params.has('proving')) MENU_URL.searchParams.set('tab', 'proving');", page)
        self.assertIn("params.get('tab') === 'proving'", (VIEWER / "play" / "front-end.js").read_text())

    def test_seating_is_dark_and_the_rings_stay_put(self) -> None:
        # Seating goes through the airfield: a lesson and a course are dark
        # from asking for a seat until the plane is in the air. The guide's
        # rings are flown once and kept, never re-flown on a timer from your
        # nose (they rode ahead of it, jumping 17-20 m four times a second).
        live = (VIEWER / "dogfight-live.js").read_text()
        course = (VIEWER / "dogfight-course.js").read_text()
        for src in (live, course):
            self.assertIn("seatCover(hud)", src)
            self.assertIn("cover.clear();", src)
        self.assertNotIn("LINE_EVERY", live)
        self.assertIn("const due = live.guideOn ? linesDue(you) : null;", live)
        self.assertIn("updateLines(you, him, due === 'used')", live)

    def test_the_load_overlay_can_be_watched(self) -> None:
        self.assertRegex((VIEWER / "progress.js").read_text(), r"\n    watch\(fn\) \{")


if __name__ == "__main__":
    unittest.main()
