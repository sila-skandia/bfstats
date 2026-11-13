"""Vehicle dust, wakes and placed smoke (gap audit entry 10).

The engine's three starts, each read on lnxded:

- `EffectBundle::init` 0x081e0ed0 starts a bundle with a `startAtCreation`
  Emitter (`EmitterTemplate+0x13c`);
- `Spring::handleUpdate` 0x0824f6b0 starts and stops a Spring's bundles by the
  material under the wheel against `addWorkOnMaterial`
  (`EffectBundleTemplate+0x170`), `Spring::init` 0x0824f590 having stopped
  them all;
- `EffectBundle::handleUpdate` 0x081e1680 runs a bundle with
  `minDistanceUnderwaterSurface >= 0` only inside its depth band, and
  `handleMessage` 0x081e1460 ignores messages to such a bundle.

And the emitter's loop restart (`Emitter::handleUpdate` 0x081e3322..0x081e352e):
the delay and lifetime drawn again, the lifetime held to 0.01 s, the next spawn
one interval in at the emitter's speed.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42 import con as con_mod  # noqa: E402
from bf42 import effects as effects_mod  # noqa: E402

HARNESS = Path(__file__).with_name("ambient_effects_harness.mjs")
VIEWER = ROOT / "viewer"

DIRT = [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15]

CON = """
ObjectTemplate.create EffectBundle e_wdustPanz
ObjectTemplate.addTemplate Em_wDust
ObjectTemplate.addWorkOnMaterial 2
ObjectTemplate.addWorkOnMaterial 3
ObjectTemplate.create Emitter Em_wDust
ObjectTemplate.template Fx_wDust
ObjectTemplate.looping 1
ObjectTemplate.startAtCreation 1
ObjectTemplate.IntensityAtSpeed 20
ObjectTemplate.create SpriteParticle Fx_wDust

ObjectTemplate.create EffectBundle e_WaterFront
ObjectTemplate.addTemplate Em_WaterFront
ObjectTemplate.minDistanceUnderwaterSurface 0
ObjectTemplate.maxDistanceUnderwaterSurface 10
ObjectTemplate.create Emitter Em_WaterFront
ObjectTemplate.template Fx_wDust

ObjectTemplate.create EffectBundle e_ExFumeFact
ObjectTemplate.addTemplate Em_ExFumeFact
ObjectTemplate.create Emitter Em_ExFumeFact
ObjectTemplate.template Fx_wDust
ObjectTemplate.looping 1
ObjectTemplate.startAtCreation 1

ObjectTemplate.create EffectBundle e_MuzzPanz
ObjectTemplate.addTemplate Em_MuzzPanz
ObjectTemplate.create Emitter Em_MuzzPanz
ObjectTemplate.template Fx_wDust

ObjectTemplate.create EffectBundle e_rocketFume
ObjectTemplate.addTemplate Em_ExFumeFact

ObjectTemplate.create Spring ShermanWheelL3DummyMiddle
ObjectTemplate.addTemplate e_wdustPanz
ObjectTemplate.create PlayerControlObject Lcvp
ObjectTemplate.addTemplate e_WaterFront
ObjectTemplate.create SimpleObject factory_m1
ObjectTemplate.addTemplate e_ExFumeFact
ObjectTemplate.addTemplate e_MuzzPanz
ObjectTemplate.create FireArms ShermanGun
ObjectTemplate.addTemplate e_MuzzPanz
ObjectTemplate.create Projectile BazookaProjectile
ObjectTemplate.addTemplate e_rocketFume
"""


class ExporterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = con_mod.ObjectLibrary()
        self.library.add_con("Objects/Test/Effects.con", CON)

    def test_the_bundles_a_host_runs_by_itself_go_into_the_library(self) -> None:
        names = effects_mod.effect_names_for_hosts(self.library)
        # The track's (a material list), the boat's (a depth band) and the
        # chimney's (`startAtCreation`). Not the flash that waits for the gun's
        # message, and not a round's child, which is the projectile reader's.
        self.assertEqual({"e_wdustPanz", "e_WaterFront", "e_ExFumeFact"}, names)

    def test_what_starts_a_bundle(self) -> None:
        starts = {name: effects_mod.starts_itself(self.library, self.library.object(name))
                  for name in ("e_wdustPanz", "e_WaterFront", "e_ExFumeFact", "e_MuzzPanz")}
        self.assertEqual({"e_wdustPanz": True, "e_WaterFront": True,
                          "e_ExFumeFact": True, "e_MuzzPanz": False}, starts)


class AmbientEffectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr[-4000:])
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    # -- the emitter's clock ------------------------------------------------- #
    def test_a_looping_emitter_restarts_one_interval_in(self) -> None:
        clock = self.out["clock"]
        # Only the start puts a spawn at 0. At rest the interval is 100 s, and
        # a 0.1 s loop never reaches it: one particle, the start's.
        self.assertEqual(1, clock["bowAtRest"])
        self.assertEqual(1, clock["dustAtRest"])
        # At `intensityAtSpeed` the interval is the 0.1 s lifetime itself: the
        # loop ends on the tick the spawn falls due.
        self.assertEqual(1, clock["bowAtThreshold"])
        # At twice that, one in every 0.1 s loop.
        self.assertTrue(25 <= clock["bowAt20"] <= 31, clock["bowAt20"])
        # 30 a second at 20 m/s is 7.5 a second at 5: thirty in 4 s.
        self.assertTrue(29 <= clock["dustAt5"] <= 31, clock["dustAt5"])

    def test_the_delay_is_drawn_again_on_each_restart(self) -> None:
        clock = self.out["clock"]
        self.assertTrue(12 <= clock["delayedLoop"] <= 14, clock["delayedLoop"])
        self.assertGreater(clock["plainLoop"], clock["delayedLoop"] + 8)

    def test_move_to_water_surface_stands_the_frame_on_world_up(self) -> None:
        self.assertEqual({"right": [1, 0, 0], "up": [0, 1, 0], "dof": [0, 0, 1]},
                         json.loads(json.dumps(self.out["level"]).replace("-0", "0")))
        # A vertical heading has no horizontal part: left as it came.
        self.assertEqual([0, 0, 1], self.out["levelVertical"]["up"])

    # -- which gate a bundle has ---------------------------------------------- #
    def test_the_gates(self) -> None:
        gates = self.out["gates"]
        self.assertEqual("spring", gates["trackDust"]["kind"])
        self.assertEqual(DIRT, gates["trackDust"]["materials"])
        # No `lodDistance` word: the EmitterTemplate constructor's 300.
        self.assertEqual(300, gates["trackDust"]["lod"])
        self.assertEqual(300, gates["defaultLod"])
        self.assertIsNone(gates["dirtOnSpring"])
        self.assertEqual(("water", 0, 0.01),
                         (gates["touchPlane"]["kind"], gates["touchPlane"]["min"], gates["touchPlane"]["max"]))
        self.assertEqual(("water", 0, 10, 600),
                         (gates["bowWave"]["kind"], gates["bowWave"]["min"], gates["bowWave"]["max"],
                          gates["bowWave"]["lod"]))
        self.assertEqual(("auto", 700, False),
                         (gates["chimney"]["kind"], gates["chimney"]["lod"], gates["chimney"]["needsSpeed"]))
        self.assertIsNone(gates["muzzle"])

    # -- the manager ----------------------------------------------------------- #
    def test_a_tracks_dust_follows_the_surface_under_it(self) -> None:
        tank = self.out["tank"]
        self.assertEqual((2, 0), (tank["adopted"], tank["again"]))
        steps = tank["steps"]
        self.assertEqual([], steps["parked"])
        self.assertEqual(["e_wdustPanz"], steps["onGrass"])
        self.assertEqual(["e_wdustPanzL"], steps["onSand"])
        self.assertEqual([], steps["onConcrete"])
        self.assertEqual([], steps["airborne"])
        self.assertEqual(["e_wdustPanz"], steps["landed"])
        self.assertEqual([], steps["inTheSea"])
        self.assertEqual([], steps["wrecked"])
        self.assertEqual(["e_wdustPanz"], steps["respawned"])
        self.assertEqual([], steps["farAway"])
        self.assertTrue(tank["attached"])
        self.assertTrue(tank["ambient"])

    def test_a_bow_wave_needs_the_water_and_the_way(self) -> None:
        boat = self.out["boat"]
        self.assertEqual(["e_WaterBoatSvall"], boat["moored"])
        self.assertEqual(["e_WaterFront", "e_WaterBoatSvall"], boat["underWay"])
        self.assertEqual([], boat["liftedOut"])
        self.assertEqual(["e_WaterBoatSvall"], boat["sunk"])

    def test_placed_smoke_loops_from_level_start(self) -> None:
        steps = self.out["statics"]["steps"]
        self.assertEqual(["e_ExFumeFact", "e_FireSmallYellow"], steps["levelStart"])
        # A bundle with no looping emitter plays once.
        self.assertEqual(["e_ExFumeFact"], steps["fireOver"])
        self.assertEqual(["e_ExFumeFact"], steps["insideHysteresis"])
        self.assertEqual([], steps["pastLod"])
        self.assertEqual(["e_ExFumeFact"], steps["backInside"])
        self.assertEqual(["e_ExFumeFact"], steps["afterFlush"])
        self.assertEqual([], steps["switchedOff"])
        stats = self.out["statics"]["stats"]
        self.assertEqual((4, 2, 2), (stats["hosts"], stats["auto"], stats["none"]))
        self.assertEqual(0, self.out["statics"]["cleared"])

    def test_every_host_is_looked_at_once_per_interval(self) -> None:
        share = self.out["share"]
        # 120 hosts, 0.1 s, a 60 Hz frame: 20 a frame.
        self.assertEqual(20, share["firstFrame"])
        self.assertEqual(120, share["afterSixFrames"])

    # -- the wiring ------------------------------------------------------------ #
    def test_the_page_runs_it(self) -> None:
        page = (VIEWER / "map.html").read_text()
        self.assertIn("effects.ambient = new AmbientEffects({", page)
        self.assertIn("effects.ambient.update(dt);", page)
        self.assertIn("effects.waterLevel = guns.collider?.waterLevel ?? null;", page)
        load = (VIEWER / "level-load.js").read_text()
        self.assertIn("page.effects?.ambient?.adoptLevel(level.currentRoot);", load)

    def test_an_ambient_run_keeps_room_for_the_fight(self) -> None:
        player = (VIEWER / "effects.js").read_text()
        self.assertIn("export const MAX_AMBIENT_PARTICLES = 800;", player)
        self.assertIn("run.ambient ? MAX_AMBIENT_PARTICLES : MAX_PARTICLES", player)
        # `moveToWaterSurface`: 0.2 m over the water level.
        self.assertIn("const WATER_SURFACE_LIFT = 0.2;", player)


if __name__ == "__main__":
    unittest.main()
