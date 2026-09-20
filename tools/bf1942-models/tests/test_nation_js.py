"""`viewer/nation.js` -- a team's nation is a property of the level, not of
the soldier skin painted on the men who hold it.

Driven headless by `nation_harness.mjs`, the same way `hud-pack.js` is
tested in `test_hud_pack_js.py`. The harness feeds the module the exact
`nations` tables and control-point fixtures this file also feeds
`extract_menu_layout.py`'s Python side (`flag_mesh_nation` /
`team_nation_from_level`), so `NationParityTests` below is the test the
round asked for: given the same flag mesh and the same `hud.json` table,
the browser and the extractor must answer with the same nation, every time.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("nation_harness.mjs")
MODULES = {"nation.js": VIEWER / "nation.js"}

sys.path.insert(0, str(ROOT))
import extract_hud_pack as ehp  # noqa: E402
import extract_menu_layout as eml  # noqa: E402
from bf42.level import ControlPointTemplate, GameplayObjects, StaticInstance  # noqa: E402

# The same two tables the harness uses: vanilla's (`flag_mesh_nations` over a
# pack with none of EoD's extra art) and Eve of Destruction's own (read live
# off this machine's extracted pack in `LevelNationFromArchivesTests` below;
# frozen here so this test does not depend on that extraction having run).
VANILLA = {"us": "us", "ge": "ger", "uk": "brit", "jp": "jp", "so": "rus", "can": "can"}
EOD = {"us": "us", "ge": "ger", "uk": "brit", "jp": "jp", "so": "so", "can": "can",
      "fr": "fre", "it": "it"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
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


class NationJsTests(unittest.TestCase):
    """The module's own behaviour, independent of Python."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_flag_mesh_nation_resolves_every_installed_code(self) -> None:
        m = self.results["flagMeshNation"]
        self.assertEqual("us", m["us"])
        self.assertEqual("ger", m["ge"])
        self.assertEqual("brit", m["uk"])
        self.assertEqual("jp", m["jp"])
        self.assertEqual("can", m["can"])
        self.assertEqual("us", m["caseInsensitive"], "the regex is case-insensitive")

    def test_flag_mesh_nation_is_corrected_per_pack(self) -> None:
        m = self.results["flagMeshNation"]
        # Vanilla aliases `so` to `rus` (no `conp_so`); EoD ships its own.
        self.assertEqual("rus", m["so_vanilla"])
        self.assertEqual("so", m["so_eod"])
        # Vanilla has no French art at all; EoD does.
        self.assertIsNone(m["fr_vanilla"])
        self.assertEqual("fre", m["fr_eod"])

    def test_pathet_lao_is_unmapped_even_in_eod(self) -> None:
        # No installed menu.rfa ships a conp_pl.
        self.assertIsNone(self.results["flagMeshNation"]["pl_eod"])

    def test_a_non_flag_string_or_no_mesh_at_all_resolves_to_nothing(self) -> None:
        m = self.results["flagMeshNation"]
        self.assertIsNone(m["noMesh"])
        self.assertIsNone(m["emptyMesh"])
        self.assertIsNone(m["notAFlag"])

    def test_cp_nation_answers_unknown_not_a_guess_for_an_unmapped_mesh(self) -> None:
        # This is the Pathet Lao fix: flagpl_m1 IS a real mesh, just one this
        # pack has no art for, and that must read differently from "no mesh
        # at all" -- 'unknown', never the ger/us guess that used to draw an
        # NVA flag over a Pathet Lao base.
        c = self.results["cpNation"]
        self.assertEqual("us", c["us"])
        self.assertEqual("can", c["can"])
        self.assertEqual("unknown", c["pathetLao"])

    def test_cp_nation_keeps_the_founding_guess_for_a_flagless_point(self) -> None:
        # Kasserine's five capture zones have no AnimatedFlag mesh at all --
        # a different case from Pathet Lao's flagpl_m1, which does have a
        # mesh, just an unmapped one.
        c = self.results["cpNation"]
        self.assertEqual("ger", c["flaglessAxis"])
        self.assertEqual("us", c["flaglessAllied"])
        self.assertIsNone(c["flaglessNeutral"])

    def test_xa_loi_pagoda_resolves_from_its_own_two_main_bases(self) -> None:
        self.assertEqual({"axis": "jp", "allied": "us"}, self.results["xaLoiPagoda"])

    def test_liberation_of_caen_allied_is_canada(self) -> None:
        self.assertEqual({"axis": "ger", "allied": "can"}, self.results["caen"])

    def test_no_where_to_run_s_tie_keeps_the_encounter_order_answer(self) -> None:
        # Two uncapturable axis bases of different nations (flagjp_m1 then
        # flagge_m1 in file order) and three flagless neutral points that
        # must not vote either way.
        self.assertEqual({"axis": "jp", "allied": "us"}, self.results["noWhereToRun"])

    def test_pathet_lao_levels_answer_unknown_not_a_vehicle_or_team_guess(self) -> None:
        h = self.results["hMong"]
        self.assertEqual("unknown", h["axisNoVehicleGuess"])
        # A real (if unresolved) vote still beats a vehicle-based guess --
        # 'unknown' wins the tally outright rather than deferring to it.
        self.assertEqual("unknown", h["axisWithVehicleGuess"])
        self.assertEqual("us", h["allied"])

    def test_no_flag_evidence_keeps_the_founding_pair_not_unknown(self) -> None:
        # Omaha Beach, Iwo Jima, Coral Sea, Midway and Truk open with the
        # Americans holding no flag, Kasserine Pass's zones are flagless, and
        # the vehicle guess names only jp / rus / brit. Answering 'unknown'
        # there took the US and German flags off the ticket counter.
        n = self.results["noControlPoints"]
        self.assertEqual("jp", n["withVehicleGuess"])
        self.assertEqual("ger", n["axisWithoutVehicleGuess"])
        self.assertEqual("us", n["alliedWithoutVehicleGuess"])
        self.assertEqual("ger", n["flaglessZonesOnly"])
        self.assertEqual("unknown", n["noTeam"])


class NationParityTests(unittest.TestCase):
    """The round's own requirement: the flag-mesh table and the rule built
    on it must agree between `viewer/nation.js` and
    `extract_menu_layout.py`, because the same `hud.json` feeds both."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_flag_mesh_nation_agrees_for_every_installed_code(self) -> None:
        cases = [
            ("flagus_m1", VANILLA), ("flagge_m1", VANILLA), ("flaguk_m1", VANILLA),
            ("flagjp_m1", VANILLA), ("flagso_m1", VANILLA), ("flagso_m1", EOD),
            ("flagcan_m1", VANILLA), ("flagfr_m1", VANILLA), ("flagfr_m1", EOD),
            ("flagpl_m1", EOD), ("FLAGUS_M1", VANILLA), (None, VANILLA), ("", VANILLA),
            ("somethingelse_m1", VANILLA),
        ]
        js_keys = ["us", "ge", "uk", "jp", "so_vanilla", "so_eod", "can",
                  "fr_vanilla", "fr_eod", "pl_eod", "caseInsensitive", "noMesh",
                  "emptyMesh", "notAFlag"]
        js = self.results["flagMeshNation"]
        for (mesh, table), key in zip(cases, js_keys):
            with self.subTest(mesh=mesh, table=table):
                self.assertEqual(js[key], ehp.flag_mesh_nation(mesh, table))

    @staticmethod
    def _gameplay(cps: list[tuple[int, str | None, bool]]) -> GameplayObjects:
        """`(team, flagMesh, unableToChangeTeam)` triples -> a `GameplayObjects`
        one flag-per-template each, matching how `_control_point_report` (and
        so `scene.json`) actually shapes one: the template carries the flag
        and the uncapturable bit, the instance only overrides team when the
        level's placement does."""
        templates: dict[str, ControlPointTemplate] = {}
        instances: list[StaticInstance] = []
        for i, (team, mesh, uctt) in enumerate(cps):
            name = f"cp{i}"
            tpl = ControlPointTemplate(name=name, team=team,
                                       unable_to_change_team=uctt)
            if mesh:
                tpl.team_geometry[team] = mesh
            templates[name] = tpl
            instances.append(StaticInstance(name, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
        return GameplayObjects(mode="Conquest", control_points=instances,
                               control_point_templates=templates)

    def test_xa_loi_pagoda_agrees(self) -> None:
        gp = self._gameplay([(1, "flagjp_m1", True), (2, "flagus_m1", True)])
        self.assertEqual(self.results["xaLoiPagoda"]["axis"],
                         eml.team_nation_from_level(gp, 1, EOD))
        self.assertEqual(self.results["xaLoiPagoda"]["allied"],
                         eml.team_nation_from_level(gp, 2, EOD))

    def test_liberation_of_caen_agrees(self) -> None:
        gp = self._gameplay([
            (2, "flagcan_m1", True),
            (1, "flagge_m1", False), (1, "flagge_m1", False),
            (1, "flagge_m1", False), (1, "flagge_m1", False), (1, "flagge_m1", False),
        ])
        self.assertEqual(self.results["caen"]["axis"],
                         eml.team_nation_from_level(gp, 1, VANILLA))
        self.assertEqual(self.results["caen"]["allied"],
                         eml.team_nation_from_level(gp, 2, VANILLA))

    def test_no_where_to_run_agrees(self) -> None:
        gp = self._gameplay([
            (1, "flagjp_m1", True), (2, "flagus_m1", True),
            (0, None, False), (0, None, False), (0, None, False),
            (1, "flagge_m1", True),
        ])
        self.assertEqual(self.results["noWhereToRun"]["axis"],
                         eml.team_nation_from_level(gp, 1, EOD))
        self.assertEqual(self.results["noWhereToRun"]["allied"],
                         eml.team_nation_from_level(gp, 2, EOD))

    def test_pathet_lao_levels_agree(self) -> None:
        gp = self._gameplay([
            (2, "flagus_m1", True),
            (1, "flagpl_m1", False), (1, "flagpl_m1", False), (1, "flagpl_m1", False),
            (1, "flagpl_m1", False), (1, "flagpl_m1", False),
        ])
        # The JS side is fed a vehicle guess too (see nation_harness.mjs);
        # `team_nation_from_level` has no vehicle fallback of its own (that
        # lives only in `viewer/map.html`'s 3D scene), so it is compared
        # against the no-vehicle-guess case, which both sides answer the
        # same way regardless: 'unknown'/None win the vote outright.
        self.assertEqual(self.results["hMong"]["axisNoVehicleGuess"],
                         eml.team_nation_from_level(gp, 1, EOD) or "unknown")
        self.assertEqual(self.results["hMong"]["allied"],
                         eml.team_nation_from_level(gp, 2, EOD))
