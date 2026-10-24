"""The hull and seat the player holds, at the server's state.

While a client controls an object the server ghosts nothing about it: on
the lab (Wake, 2026-10-25, `lab/seat_probe.mjs`) the M3A1 the probe drove
was scoped out the tick he took its wheel and came back in on his exit, and
its gunner's seat likewise while he sat in it. So the driven hull's hit
points and the controlled guns' ammunition reach the page in the control
state alone (features/udp-sidecar/wire.md section 48, ledger SEAT-36):

- the sidecar writes the driven hull's hit points as the ghost's own k:"a"
  row (`GhostWriter.controlHp`) and each controlled gun's counters on the
  ack (`controlMagazines`, the wire's value plus one taken off);
- the page's copy of the hull he drives takes those hit points
  (`hullHpChange`), and his seat's guns the server's magazines
  (`takeServerMagazines`, `FireArmsNetworkable::setNetUpdate`'s law).

`sidecar_seat_state_harness.mjs` drives the modules under node.
"""

from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent / "viewer"
SIDECAR = HERE.parent / "sidecar"
HARNESS = HERE / "sidecar_seat_state_harness.mjs"


def _closure(*entries: str) -> set[str]:
    seen: set[str] = set()
    queue = list(entries)
    while queue:
        name = queue.pop()
        if name in seen or not (VIEWER / name).exists():
            continue
        seen.add(name)
        here = posixpath.dirname(name)
        for spec in re.findall(r"from '(\.\.?/[^']+\.js)'", (VIEWER / name).read_text()):
            queue.append(posixpath.normpath(posixpath.join(here, spec)))
    return seen


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("net-sidecar.js", "server-seat.js"):
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(SIDECAR)],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class SeatStateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_driven_hulls_hit_points_are_a_ghost_row(self) -> None:
        """Once per change, in the k:"a" shape the ghost's own rows use."""
        got = self.out["controlHp"]
        self.assertEqual(got["said"], [True, False, True, False, True])
        self.assertEqual([r["a"] for r in got["rows"]], [[[555, 100]], [[555, 62.5]], [[555, 70]]])
        self.assertTrue(all(r["k"] == "a" for r in got["rows"]))

    def test_the_counters_lose_the_wires_plus_one(self) -> None:
        """The M3A1 .50 as the lab measured it: 501 and 2 on the wire are 500
        rounds in one magazine; a delta without the count carries it."""
        got = self.out["controlMagazines"]
        self.assertEqual(got["first"], [[None, 500, 1]])
        self.assertEqual(got["next"], [[None, 496, 1]])
        self.assertIsNone(got["none"])

    def test_the_client_hands_both_to_the_page(self) -> None:
        got = self.out["client"]
        self.assertEqual([(e["vehicle"], e["hp"], e["destroyed"]) for e in got["hull"]], [(555, 62.5, False)])
        self.assertEqual(got["selfMags"], {"id": 556, "ack": 40, "guns": [["Browning", 496, 1]]})

    def test_the_driven_copy_follows_the_servers_hit_points(self) -> None:
        got = self.out["hullHpChange"]
        self.assertAlmostEqual(got["damaged"], 37.5)
        self.assertAlmostEqual(got["repaired"], -15)
        self.assertEqual(got["same"], 0)
        # The server's own rows end a seat in a destroyed hull; the page does
        # not kill him in it first, and a zero is held a hair above.
        self.assertEqual(got["serverKilled"], 0)
        self.assertAlmostEqual(got["zeroNotDestroyed"], 30 - 1e-3)
        self.assertEqual(got["copyWrecked"], 0)
        self.assertEqual(got["unknown"], 0)

    def test_a_seat_gun_takes_the_servers_magazines(self) -> None:
        got = self.out["takeServerMagazines"]
        self.assertEqual(got["rounds"], {"taken": True, "ammo": 496, "magsLeft": 0})
        # The server's reload is done: the page's own would spend a second
        # magazine.
        self.assertEqual(got["reloadOver"], {"taken": True, "ammo": 30, "magsLeft": 1, "reload": 0})
        self.assertEqual(got["same"], {"taken": False})
        self.assertEqual(got["empty"], {"taken": True, "ammo": 0, "magsLeft": 0})
        self.assertEqual(got["unlimited"], {"taken": False, "ammo": None})
        self.assertEqual(got["unlimitedSpares"], {"taken": True, "ammo": 18, "magsLeft": None})

    def test_the_guns_are_matched_by_name(self) -> None:
        got = self.out["matchServerGuns"]
        self.assertEqual(got["byName"], [["Coaxial_browning", 380, 1], ["ShermanGunBarrel", 29, 1]])
        self.assertEqual(got["suffixed"], [["Browning", 400, 1]])
        self.assertEqual(got["unnamedByOrder"], [[None, 1, 1], [None, 2, 1]])
        self.assertEqual(got["unknown"], [None])

    def test_only_the_driver_rides_the_page_copy(self) -> None:
        """The driver's seat of a drivable hull is the page's to predict;
        every other seat rides the server's hull, a ghost like any other."""
        self.assertEqual(self.out["seatHost"], {
            "driverOfTank": "copy", "gunnerOfTank": "entity", "gunnerBeforeModel": "wait",
            "stationaryGun": "entity", "stationaryGunBeforeModel": "copy", "unknownSeat": "copy",
            # Its model failed, or the wait ran out: the copy, not nowhere.
            "gunnerEntityFailed": "copy"})

    def test_a_scoped_out_hulls_hit_points_are_written_again(self) -> None:
        """The live snapshot drops an object's k:"a" with its k:"d", so the
        driven hull's unchanged hit points from the control state are
        written once more after the scope-out, for a page that joins later."""
        got = self.out["scopeOutHp"]
        self.assertTrue(got["again"])
        self.assertEqual(got["kinds"], ["o", "a", "d", "a"])
        self.assertEqual(got["hp"], [[[555, 100]], [[555, 100]]])


if __name__ == "__main__":
    unittest.main()
