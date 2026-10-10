"""`extract_map.engine_script_candidates`: a vehicle's engines are asked in
turn, so a first Engine whose script cannot play no longer silences the hull.

FH's Ju 52 binds `Ju52Engine.ssc` on its first engine, a script that
`#include`s `High/EngineHigh.ssc`, a file the mod never shipped; engines 2 and
3 bind `Ju52Engine1.ssc`, which works. The walk used to stop at the first.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import extract_map as em  # noqa: E402


def node(name, kind, children=(), source="objects/v/Objects.con"):
    return SimpleNamespace(name=name, kind=kind, source=source, children=[
        SimpleNamespace(template=c, random_geometries=0) for c in children])


class Pool:
    def __init__(self, files: dict[str, str]):
        self.files = files

    def find(self, name):
        return name if name in self.files else None

    def read(self, name):
        return self.files[name].encode("latin-1")


class EngineCandidateTests(unittest.TestCase):
    def setUp(self):
        nodes = {n.name.lower(): n for n in (
            node("plane", "PlayerControlObject", ["e1", "e2", "e3"]),
            node("e1", "Engine"), node("e2", "Engine"), node("e3", "Engine"))}
        self.library = SimpleNamespace(objects=nodes)
        self.objects = Pool({"objects/v/Objects.con": (
            "ObjectTemplate.create Engine e1\n"
            "ObjectTemplate.loadSoundScript Sounds/Broken.ssc\n"
            "ObjectTemplate.create Engine e2\n"
            "ObjectTemplate.loadSoundScript Sounds/Works.ssc\n"
            "ObjectTemplate.create Engine e3\n"
            "ObjectTemplate.loadSoundScript Sounds/Works.ssc\n")})

    def test_every_bound_engine_is_a_candidate_in_walk_order(self):
        got = list(em.engine_script_candidates(self.library, self.objects, "plane"))
        self.assertEqual(
            [("objects/v/Sounds/Broken.ssc", "e1"),
             ("objects/v/Sounds/Works.ssc", "e2"),
             ("objects/v/Sounds/Works.ssc", "e3")], got)

    def test_find_engine_script_is_still_the_first(self):
        self.assertEqual(
            ("objects/v/Sounds/Broken.ssc", "e1"),
            em.find_engine_script(self.library, self.objects, "plane"))

    def test_a_vehicle_without_an_engine_has_no_candidate(self):
        self.library.objects["bare"] = node("bare", "SimpleObject")
        self.assertEqual(
            [], list(em.engine_script_candidates(self.library, self.objects, "bare")))
        self.assertIsNone(em.find_engine_script(self.library, self.objects, "bare"))


if __name__ == "__main__":
    unittest.main()
