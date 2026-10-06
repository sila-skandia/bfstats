"""A vehicle or stationary gun's rounds leave in the engine's deviation cone.

`FireArms::fireBarrel` (lnxded 0x0828aba0) applies one law to every FireArms
(ledger DEV-9): each round is pushed off its line by `u x total / 100` on the
launch frame's up and right rows, `u` uniform in (-1, +1] per axis. A seat
gun's total is `minDev + fire` plus a bot's AI term, with no stance, speed,
turn or misc channel (DEV-11), stored once a tick and read by the round and
the cross alike (DEV-12); a bot's draws are one fixed point (AI-145). Until
`features/vehicle-gun-deviation` the viewer launched every vehicle round
straight down its line.

Run under node through `vehicle_deviation_harness.mjs`, on the FireArms
blocks of the shipped glbs where the trees are linked (the Sherman's, Desert
Combat's M2A3 and M163) and on the `.con` numbers otherwise.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "viewer" / "models"
HARNESS = Path(__file__).resolve().parent / "vehicle_deviation_harness.mjs"

BULLET = {"kind": "bullet", "template": "Browning_Projectile", "gravity": 0, "timeToLive": 1.5}

# The `.con` numbers, for a run without the asset trees: vanilla's
# Objects/Vehicles/Land/Sherman (and the shared Browning / Coaxial_Browning
# weapons), Desert Combat's vehicles/land/M2A3 and M163 Weapons.con.
INLINE = {
    "Browning": {"velocity": 1000, "roundOfFire": 10, "magSize": -1,
                 "deviation": {"min": 0.5, "fire": [0.7, 0.3, 0.048]}, "projectile": BULLET},
    "Coaxial_browning": {"velocity": 1000, "roundOfFire": 12, "magSize": -1,
                         "deviation": {"min": 0.75, "fire": [1.9, 0.26, 0.05]}, "projectile": BULLET},
    "ShermanGunBarrel": {"velocity": 100, "roundOfFire": 0.35, "magSize": -1,
                         "projectile": {"kind": "shell", "template": "ShermanProjectile", "gravity": 1}},
    "M2A3_GunBarrel": {"velocity": 500, "roundOfFire": 5.7, "magSize": -1,
                       "projectile": {"kind": "bullet", "template": "25mmChaingunProjectileM2A3", "gravity": 0.2}},
    "M163_GunBarrel": {"velocity": 1000, "roundOfFire": 20, "magSize": -1,
                       "deviation": {"min": 0.5, "fire": [0.5, 0, 0.05]}, "projectile": BULLET},
}
GLBS = {
    "Browning": MODELS / "Sherman.Kasserine_Pass.glb",
    "Coaxial_browning": MODELS / "Sherman.Kasserine_Pass.glb",
    "ShermanGunBarrel": MODELS / "Sherman.Kasserine_Pass.glb",
    "M2A3_GunBarrel": MODELS / "mods" / "desertcombat" / "M2A3.glb",
    "M163_GunBarrel": MODELS / "mods" / "desertcombat" / "M163.glb",
}


def glb_fire_arms(path: Path, name: str) -> dict | None:
    """The named FireArms node's `fireArms` block out of a glb's JSON chunk."""
    if not path.exists():
        return None
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    for node in doc.get("nodes", []):
        block = (node.get("extras") or {}).get("fireArms")
        if block and node.get("name") == name:
            return block
    return None


def cases() -> tuple[list[dict], dict]:
    out, source = [], {}
    for name, inline in INLINE.items():
        block = glb_fire_arms(GLBS[name], name)
        source[name] = "glb" if block else "con"
        stats = dict(block) if block else inline
        if name in ("ShermanGunBarrel", "M2A3_GunBarrel"):
            # Slow guns: fewer single rounds are enough to show they stay on the line.
            out.append({"name": name, "stats": stats, "floorRounds": 200, "burstSeconds": 6})
        else:
            out.append({"name": name, "stats": stats, "floorRounds": 2000, "burstSeconds": 3})
    return out, source


def run_harness() -> tuple[dict, list[dict], dict]:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    spec, source = cases()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "spec.json"
        path.write_text(json.dumps({"cases": spec}))
        proc = subprocess.run(["node", str(HARNESS), str(path)], capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout), spec, source


def law_totals(stats: dict, ticks: list[int], ai: float = 0.0) -> list[float]:
    """The total each round of a held burst leaves in, from the round ticks
    alone: per tick the bloom decays by c and the total is stored; a round
    reads the stored total, then raises the bloom by b up to a (DEV-11/12).
    A bot (`ai`, his AI term) decays it once more each tick of his burst,
    after his first round (DEV-13)."""
    dev = stats.get("deviation") or {}
    floor = dev.get("min", 0)
    a, b, c = (dev.get("fire") or [0, 0, 0])[:3]
    fire = 0.0
    out = []
    by_tick: dict[int, int] = {}
    for t in ticks:
        by_tick[t] = by_tick.get(t, 0) + 1
    started = False
    for tick in range(max(ticks) + 1 if ticks else 0):
        fire = max(fire - c, 0.0)
        if ai and started:
            fire = max(fire - c, 0.0)
        stored = floor + fire
        for _ in range(by_tick.get(tick, 0)):
            out.append(round(stored + ai, 4))
            fire = min(fire + b, a)
            started = True
    return out


class VehicleDeviationTests(unittest.TestCase):
    results: dict
    spec: list[dict]

    @classmethod
    def setUpClass(cls) -> None:
        cls.results, cls.spec, cls.source = run_harness()

    def stats(self, name: str) -> dict:
        return next(c["stats"] for c in self.spec if c["name"] == name)

    def test_the_sherman_browning_scatters_in_the_square_of_its_floor(self) -> None:
        """Single rounds at a cold barrel: `setMinDev 0.5`, a square of +-0.5
        hundredths of a radian (+-0.29 degrees) per axis, uniform."""
        case = self.results["cases"]["Browning"]
        floor = case["floor"]
        self.assertEqual(case["floorTotal"], self.stats("Browning")["deviation"]["min"])
        self.assertEqual(floor["outside"], 0, "no round outside the square")
        self.assertGreater(floor["maxU"], 0.99, "the square is filled to its edge")
        self.assertAlmostEqual(floor["meanAbs"], 0.5, delta=0.03, msg="uniform per axis: mean |u| is a half")
        self.assertAlmostEqual(floor["corners"], 0.25, delta=0.03, msg="independent axes: a quarter in the corners")
        self.assertLess(floor["ks"], 0.035, "the per-axis draws are uniform")

    def test_a_held_burst_walks_by_the_stored_total(self) -> None:
        """Every round of a 3 s burst leaves in exactly the total the law gives
        for its tick, the first at the floor, and none outside its square."""
        for name in ("Browning", "Coaxial_browning"):
            with self.subTest(name):
                held = self.results["cases"][name]["burst"]
                stats = self.stats(name)
                self.assertGreater(held["n"], 20)
                self.assertEqual(held["totals"], law_totals(stats, held["ticks"]))
                self.assertEqual(held["totals"][0], stats["deviation"]["min"], "the first round flies at the floor")
                self.assertEqual(held["outside"], 0)
                dev = stats["deviation"]
                self.assertLessEqual(held["maxTotal"], round(dev["min"] + dev["fire"][0], 4))
                self.assertGreater(held["maxTotal"], dev["min"] + 0.5 * dev["fire"][0], "the bloom climbs")

    def test_a_gun_with_no_words_stays_on_its_line(self) -> None:
        """A tank's main gun and Desert Combat's M2A3 25 mm ship no deviation
        words: total 0, under the 0.01 below which nothing is drawn (DEV-9)."""
        for name in ("ShermanGunBarrel", "M2A3_GunBarrel"):
            with self.subTest(name):
                case = self.results["cases"][name]
                self.assertNotIn("deviation", self.stats(name))
                self.assertEqual(case["floor"]["maxOffset"], 0)
                self.assertEqual(case["burst"]["maxOffset"], 0)
                self.assertGreater(case["burst"]["n"], 0)

    def test_a_bloom_of_nothing_holds_the_floor(self) -> None:
        """Desert Combat's M163 Vulcan: `setFireDev 0.5 0 0.05` adds nothing a
        round, so every round of a burst leaves at its 0.5 floor."""
        held = self.results["cases"]["M163_GunBarrel"]["burst"]
        self.assertGreater(held["n"], 40)
        self.assertEqual(set(held["totals"]), {0.5})
        self.assertEqual(held["outside"], 0)

    def test_a_bot_lands_every_round_on_one_point(self) -> None:
        """AI-145: a seated bot's input index is 618, and a gun with no barrels
        draws at the index less one, so a seat MG's rounds all take 617's
        point, (0.9517, 0.2325) of the total; the AI term rides on the
        FireArms' own total; barrel i of a two-barrel pull draws at 618 + i."""
        bot = self.results["bot"]
        self.assertGreater(bot["n"], 10)
        self.assertEqual(bot["first"], {"total": 0.8125, "uUp": 0.9517, "uRight": 0.2325})
        self.assertLess(bot["spreadUp"], 1e-3)
        self.assertLess(bot["spreadRight"], 1e-3)
        self.assertEqual(bot["pull"], bot["points"])

    def test_a_bots_bloom_decays_twice_a_tick(self) -> None:
        """DEV-13: his trigger statement runs `setBotSkill`, and so one more
        update, every tick of his burst. The Browning's bloom then nets
        0.3 - 6 x 0.048 a round at 10 a second instead of 0.3 - 3 x 0.048."""
        bot = self.results["bot"]
        stats = self.stats("Browning")
        self.assertEqual(bot["totals"], law_totals(stats, bot["ticks"], ai=0.3125))
        self.assertNotEqual(bot["totals"], [round(t + 0.3125, 4) for t in law_totals(stats, bot["ticks"])])

    def test_a_camera_gun_draws_on_the_cameras_own_axes(self) -> None:
        """A coax fires from the seat camera (`cameraLaunch`): the square is on
        that frame's up and right, which roll with the hull."""
        cam = self.results["camera"]
        self.assertEqual(cam["total"], self.stats("Coaxial_browning")["deviation"]["min"])
        self.assertEqual(cam["own"], [0.9517, 0.2325])
        self.assertGreater(abs(cam["level"][1] - cam["own"][1]), 0.1, "a world-up frame would turn the point")

    def test_the_cross_opens_by_the_total_its_rounds_leave_in(self) -> None:
        cross = self.results["cross"]
        self.assertGreater(len(cross["pairs"]), 10)
        self.assertTrue(cross["agree"], cross["pairs"])

    def test_a_round_with_no_firer_or_no_hook_flies_its_line(self) -> None:
        """A replayed round (no seat holder) and the model browser (no hook)."""
        self.assertEqual(self.results["replay"], {"up": 0, "right": 0})
        self.assertEqual(self.results["noHook"], {"up": 0, "right": 0})


if __name__ == "__main__":
    unittest.main()
