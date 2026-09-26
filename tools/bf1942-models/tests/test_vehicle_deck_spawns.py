"""A ship's deck spawns come from its own create block, found by template name.

`Sea/fletcher/Objects.con` creates three hulls: `Fletcher` and `FletcherStatic`
(spawn groups 68/69) and `Fletcher2` (the "Alternative Fletcher", 80/81).
Omaha Beach spawns only `fletcher2`, and no `Sea/fletcher2/` folder exists, so
the report found no file and the Allies had no spawn at the start. And reading
every `addTemplate` in the file hung 80/81 on each `fletcher` hull, with 68/69
twice over (FletcherStatic's copy).

Most ships add their deck points one level down (`Enterprise` ->
`lodEnterprise` -> `EnterpriseComplex`), so the scope is the hull's block plus
the same-file children it adds, not the hull's block alone.
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import extract_map as em  # noqa: E402
from bf42.level import parse_spawn_templates  # noqa: E402

# The retail file's shape, cut down to what the spawn report reads.
FLETCHER = """
ObjectTemplate.create PlayerControlObject Fletcher
ObjectTemplate.addTemplate lodFletcher
ObjectTemplate.addTemplate FletcherDriverSoldierSpawn
ObjectTemplate.setPosition 0/5/32.5
ObjectTemplate.addTemplate FletcherSoldierSpawn
ObjectTemplate.setPosition 3/5/-43.699
ObjectTemplate.addTemplate FletcherSoldierSpawn
ObjectTemplate.setPosition -2.999/5/-43.699
ObjectTemplate.addTemplate FletcherLcvpSpawner
ObjectTemplate.setPosition 7.2/0.3/-43.699
ObjectTemplate.setRotation 6/0/0

ObjectTemplate.create LodObject lodFletcher
ObjectTemplate.addTemplate FletcherComplex

ObjectTemplate.create Bundle FletcherComplex
ObjectTemplate.addTemplate Fletcher_Radar
ObjectTemplate.setPosition 0/20/0

ObjectTemplate.create SpawnPoint FletcherDriverSoldierSpawn
ObjectTemplate.setGroup 68
rem ObjectTemplate.setEnterOnSpawn 1

ObjectTemplate.create SpawnPoint FletcherSoldierSpawn
ObjectTemplate.setGroup 69

ObjectTemplate.create SpawnPoint FletcherDriverSoldierSpawnAlt
ObjectTemplate.setGroup 80

ObjectTemplate.create SpawnPoint FletcherSoldierSpawnAlt
ObjectTemplate.setGroup 81

ObjectTemplate.create Bundle FletcherStaticComplex
ObjectTemplate.addTemplate FletcherDriverSoldierSpawn
ObjectTemplate.setPosition 0/5/32.5
ObjectTemplate.addTemplate FletcherSoldierSpawn
ObjectTemplate.setPosition 3/5/-43.699

rem *** Fletcher ***
ObjectTemplate.create PlayerControlObject Fletcher2
ObjectTemplate.addTemplate lodFletcher
ObjectTemplate.addTemplate FletcherDriverSoldierSpawnAlt
ObjectTemplate.setPosition 0/5/32.5
ObjectTemplate.addTemplate FletcherSoldierSpawnAlt
ObjectTemplate.setPosition 3/5/-43.699
ObjectTemplate.addTemplate FletcherSoldierSpawnAlt
ObjectTemplate.setPosition -2.999/5/-43.699
"""

# Enterprise's shape: the deck points live in a Complex two children down,
# which is itself placed off the hull's origin here to pin the composition.
CARRIER = """
ObjectTemplate.create PlayerControlObject Carrier
ObjectTemplate.addTemplate lodCarrier
ObjectTemplate.setPosition 0/10/0
ObjectTemplate.setRotation 90/0/0

ObjectTemplate.create LodObject lodCarrier
ObjectTemplate.addTemplate CarrierComplex

ObjectTemplate.create Bundle CarrierComplex
ObjectTemplate.addTemplate CarrierDeckSpawn
ObjectTemplate.setPosition 0/2/50

ObjectTemplate.create SpawnPoint CarrierDeckSpawn
ObjectTemplate.setGroup 72
"""

# Essen's ParatrooperSpawner in miniature: group 101, which no
# spawnPointManager file binds. The engine creates the group at team -1 and no
# side can spawn on it (ledger SPAWNGRP-2).
UNBOUND = """
ObjectTemplate.create PlayerControlObject Paradrop
ObjectTemplate.addTemplate ParaSpawn
ObjectTemplate.setPosition 0/160/0

ObjectTemplate.create SpawnPoint ParaSpawn
ObjectTemplate.setGroup 101
ObjectTemplate.setSpawnAsParaTroper 1
"""

SPAWNERS = """
ObjectTemplate.create ObjectSpawner DestroyerSpawner
ObjectTemplate.setObjectTemplate 2 fletcher2
ObjectTemplate.create ObjectSpawner OldDestroyerSpawner
ObjectTemplate.setObjectTemplate 2 fletcher
ObjectTemplate.create ObjectSpawner CarrierSpawner
ObjectTemplate.setObjectTemplate 2 carrier
ObjectTemplate.create ObjectSpawner ParadropSpawner
ObjectTemplate.setObjectTemplate 2 paradrop
"""

GLOBAL_GROUPS = """
spawnPointManager.group 68
spawnPointManager.groupTeam 2
spawnPointManager.group 69
spawnPointManager.groupTeam 2
spawnPointManager.group 72
spawnPointManager.groupTeam 2
spawnPointManager.group 80
spawnPointManager.groupTeam 2
spawnPointManager.group 81
spawnPointManager.groupTeam 2
"""


class FakePool:
    """The slice of `ArchivePool` the report uses: case-blind reads, names."""

    def __init__(self, files: dict[str, str]) -> None:
        self._files = {k.lower(): (k, v.encode("latin-1")) for k, v in files.items()}

    def try_read(self, name: str) -> bytes | None:
        hit = self._files.get(name.lower())
        return hit[1] if hit else None

    def read(self, name: str) -> bytes:
        blob = self.try_read(name)
        if blob is None:
            raise KeyError(name)
        return blob

    def names(self) -> list[str]:
        return [real for real, _ in self._files.values()]


def _pad(spawner: str, position=(1000.0, 20.0, 800.0), yaw=0.0, team=2):
    return SimpleNamespace(template=spawner, team=team, position=position,
                           rotation=(yaw, 0.0, 0.0))


def _report(*pads):
    info = SimpleNamespace(
        gameplay=SimpleNamespace(spawn_groups={}),
        spawn_objects=list(pads),
        spawn_templates=parse_spawn_templates(SPAWNERS))
    objects = FakePool({
        "Objects/Vehicles/Sea/fletcher/Objects.con": FLETCHER,
        "Objects/Vehicles/Sea/Carrier/Objects.con": CARRIER,
        "Objects/Vehicles/Sea/Paradrop/Objects.con": UNBOUND,
    })
    game = FakePool({"Bf1942/Game/GlobalSpawnGroups.con": GLOBAL_GROUPS})
    return em._vehicle_soldier_spawn_report(info, objects, game)


class DeckSpawnScopeTests(unittest.TestCase):
    def test_fletcher2_is_found_inside_the_fletcher_file(self):
        """Omaha's destroyer: no folder of its own, yet a full deck of spawns."""
        out = _report(_pad("DestroyerSpawner"))
        self.assertEqual(
            [(e["vehicle"], e["name"], e["group"], e["team"]) for e in out],
            [("fletcher2", "fletcherdriversoldierspawnalt", 80, 2),
             ("fletcher2", "fletchersoldierspawnalt", 81, 2),
             ("fletcher2", "fletchersoldierspawnalt", 81, 2)])
        # Yaw 0: world = (ox + lx, oy + ly, -oz - lz).
        self.assertEqual(out[0]["position"], [1000.0, 25.0, -832.5])
        self.assertEqual(out[1]["position"], [1003.0, 25.0, -756.301])

    def test_fletcher_carries_only_its_own_groups_once(self):
        """Not Fletcher2's 80/81, and not FletcherStatic's second 68/69."""
        out = _report(_pad("OldDestroyerSpawner"))
        self.assertEqual(sorted((e["group"], tuple(e["position"])) for e in out),
                         [(68, (1000.0, 25.0, -832.5)),
                          (69, (997.001, 25.0, -756.301)),
                          (69, (1003.0, 25.0, -756.301))])

    def test_a_spawn_nested_in_a_child_bundle_composes_its_offsets(self):
        """Hull -> lod (up 10, yawed 90) -> Complex -> deck point 50 m ahead."""
        out = _report(_pad("CarrierSpawner", position=(0.0, 0.0, 0.0)))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["group"], 72)
        # Con yaw 90 turns local +z (0, 0, 50) onto +x (50, 0, 0); y stacks.
        x, y, z = out[0]["position"]
        self.assertAlmostEqual(x, 50.0, places=3)
        self.assertAlmostEqual(y, 12.0, places=3)
        self.assertAlmostEqual(z, 0.0, places=3)

    def test_both_hulls_on_one_level_are_two_pads(self):
        out = _report(_pad("OldDestroyerSpawner"),
                      _pad("DestroyerSpawner", position=(1500.0, 20.0, 900.0)))
        by_vehicle = {}
        for e in out:
            by_vehicle.setdefault(e["vehicle"], set()).add((e["pad"], e["group"]))
        self.assertEqual(by_vehicle, {"fletcher": {(1, 68), (1, 69)},
                                      "fletcher2": {(2, 80), (2, 81)}})

    def test_a_group_no_file_binds_is_no_spawn(self):
        """Not the spawner's team 2: an unbound group lists for neither side."""
        self.assertEqual(_report(_pad("ParadropSpawner")), [])

    def test_the_template_is_matched_case_blind(self):
        objects = FakePool({"Objects/Vehicles/Sea/fletcher/Objects.con": FLETCHER})
        self.assertIsNotNone(em._vehicle_objects_con(objects, "FLETCHER2"))
        self.assertIsNone(em._vehicle_objects_con(objects, "fletcher3"))


def _game_dir() -> Path | None:
    try:
        from extract_models import DEFAULT_GAME_DIR
    except Exception:  # noqa: BLE001
        return None
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    return game if (game / "Mods" / "bf1942").is_dir() else None


@unittest.skipIf(_game_dir() is None, "no BF1942 install")
class RetailOmahaTests(unittest.TestCase):
    def test_omaha_beach_allies_spawn_on_fletcher2(self):
        import scene_layers
        ctx = scene_layers.LevelContext(_game_dir(), "bf1942", "Omaha_Beach",
                                        out=Path("/nonexistent"))
        spawns = ctx.vehicle_soldier_spawns_by_mode["Conquest"]
        self.assertEqual(sorted({(e["vehicle"].lower(), e["group"], e["team"])
                                 for e in spawns}),
                         [("fletcher2", 80, 2), ("fletcher2", 81, 2)])
        self.assertEqual(len(spawns), 3, json.dumps(spawns))


if __name__ == "__main__":
    unittest.main()
