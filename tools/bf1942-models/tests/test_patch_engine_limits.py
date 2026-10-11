"""`patch_engine_limits.py` brings finished glbs to what `con.py` `physics()`
now writes on an input-less Engine (ledger PHY-30), without a re-bake."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import glbopt  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
import patch_engine_limits as patch  # noqa: E402

CON = """
ObjectTemplate.create Engine Flettner_LeftRotor
ObjectTemplate.setMinRotation 0/0/150
ObjectTemplate.setMaxRotation 0/0/150
ObjectTemplate.setMaxSpeed 0/0/1000
ObjectTemplate.setAcceleration 0/0/500
ObjectTemplate.setAutomaticReset 1
ObjectTemplate.setEngineType c_ETPlane

ObjectTemplate.create Engine Corsair_Engine
ObjectTemplate.setMinRotation 0/0/-3000
ObjectTemplate.setMaxRotation 0/0/5000
ObjectTemplate.setInputToRoll c_PIThrottle
ObjectTemplate.setEngineType c_ETPlane
"""


def glb(nodes: list[dict]) -> bytes:
    return glbopt.write_glb({"asset": {"version": "2.0"}, "nodes": nodes}, b"")


class PatchEngineLimitsTests(unittest.TestCase):
    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Air/Flettner/Physics.con", CON)
        return library

    def test_an_inputless_engine_gets_the_two_words_a_fresh_extract_writes(self) -> None:
        library = self.library()
        old = {"engineType": "c_ETPlane", "maxRotation": [0.0, 0.0, 150.0],
               "maxSpeed": [0.0, 0.0, 1000.0], "acceleration": [0.0, 0.0, 500.0]}
        data = glb([
            {"name": "Flettner_LeftRotor_1", "extras": {"templateKind": "Engine", "physics": dict(old)}},
            # Bound: its rig carries the words; untouched.
            {"name": "Corsair_Engine", "extras": {
                "templateKind": "Engine", "physics": {"engineType": "c_ETPlane"},
                "rig": {"axes": {"roll": {"input": "c_PIThrottle"}}}}},
        ])

        patched, count = patch.patch_bytes(data, library)

        self.assertEqual(1, count)
        doc, _ = glbopt.read_glb(patched)
        rotor = doc["nodes"][0]["extras"]["physics"]
        self.assertEqual([0.0, 0.0, 150.0], rotor["minRotation"])
        self.assertTrue(rotor["automaticReset"])
        self.assertEqual({**old, "minRotation": [0.0, 0.0, 150.0], "automaticReset": True}, rotor)
        self.assertNotIn("minRotation", doc["nodes"][1]["extras"]["physics"])
        # And a second pass finds nothing to do.
        self.assertEqual((None, 0), patch.patch_bytes(patched, library))

    def test_a_glb_with_no_engine_is_left_alone(self) -> None:
        self.assertEqual((None, 0), patch.patch_bytes(glb([{"name": "Hull"}]), self.library()))


if __name__ == "__main__":
    unittest.main()
