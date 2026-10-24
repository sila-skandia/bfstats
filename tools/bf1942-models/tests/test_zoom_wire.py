"""A zoomed soldier's look reaches a real server as the page turned it (ledger ZOOM-4).

`BFSoldier::handlePlayerInput` (lnxded 0x08273c70) scales its own copy of the
decoded look axes by the held weapon's `zoomFov` while zoomed (0x08275bf2).
The record carries the device's axis; the server scales what it receives. The
lab pinned it (`lab/zoom_look_probe.mjs`, `tests/fixtures/zoom_look_no4.ndjson`):
with Tobruk's British No4 (zoomFov 0.4) the same words moved the server's aim
and twist registers 1.000x at the hip and 0.400x zoomed.

The page sent `footLookPair`, the axis it had already scaled for its own
soldier, so the server scaled it again: a zoomed No4 turned the server 0.16x
of the hand while the page drew 0.4x, and a fine zoomed hand (under 0.02 of
axis a tick) packed to a centred channel and never reached the server at all.
The owner's long-range misses on BF1942-AUSTRALIA (2026-10-24, wire.md section
44) were sight corrections the server never made. `zoom_wire_harness.mjs`
runs the page's own look stage (viewer/local-look.js) and wire codec
(viewer/netcode.js) against the server's law.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "zoom_wire_harness.mjs"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "zoom_look_no4.ndjson"
sys.path.insert(0, str(ROOT / "lab"))
import zoom_look_check as zlc  # noqa: E402


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LabLawTests(unittest.TestCase):
    def test_server_scales_received_look_by_zoom_fov(self):
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            rows = zlc.main(str(FIXTURE))
        self.assertGreaterEqual(len(rows), 8)
        for r in rows:
            want = 0.4 if r["label"].startswith("zoomed") else 1.0
            self.assertAlmostEqual(r["ratio"], want, delta=0.005, msg=r)
            # The ghosted state bits say so: 0x20 is the server's zoom.
            self.assertEqual(r["zoomBit"], [r["label"].startswith("zoomed")], r)


class PageWireTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_server_turns_exactly_as_the_page_every_tick(self):
        for s in self.out["stretches"]:
            self.assertLess(s["worstTick"], 1e-9, s)
            self.assertAlmostEqual(s["wire"]["x"], s["page"]["x"], places=6, msg=s)
            self.assertAlmostEqual(s["wire"]["y"], s["page"]["y"], places=6, msg=s)

    def test_the_scaled_pair_was_scaled_twice(self):
        # What the page sent before: zoomed, the server turned at most 0.43x
        # of the page, and the fine stretches all but vanished.
        for s in self.out["stretches"]:
            page = abs(s["page"]["x"]) + abs(s["page"]["y"])
            legacy = abs(s["legacy"]["x"]) + abs(s["legacy"]["y"])
            if not s["zoomed"]:
                self.assertAlmostEqual(legacy, page, delta=0.02, msg=s)
            elif "fine" in s["label"]:
                self.assertLess(legacy, 0.1 * page, s)
            else:
                self.assertLess(legacy, 0.45 * page, s)

    def test_quantised_axes_round_trip_the_wire(self):
        self.assertEqual(self.out["codec"], {"gridBad": 0, "rawBad": 0})

    def test_the_ack_carries_the_servers_zoom(self):
        # sidecar/soldier-ghost.mjs carrySelfAim: the state bits' 0x20,
        # carried forward through states that leave the bits out.
        self.assertEqual(self.out["carryZoom"], [None, 1, 1, 0])


class WiringTests(unittest.TestCase):
    def test_the_sidecar_is_sent_the_unscaled_pair(self):
        viewer = ROOT / "viewer"
        player = (viewer / "local-player.js").read_text()
        self.assertIn("wire = page.footWirePair();", player)
        page = (viewer / "map.html").read_text()
        self.assertIn("room.sendTickInputs(step.ticks, input, look, dt, wire);", page)
        # `simulate` sends; it must take the pair as a parameter, or `wire`
        # resolves to the page's id="wire" checkbox through window.
        self.assertIn("const step = simulate(dt, input, look, wire);", page)
        self.assertIn("function simulate(dt, input, look, wire) {", page)
        room = (viewer / "net-room.js").read_text()
        self.assertIn("if (sidecarUrl && Number.isFinite(wire?.x) && Number.isFinite(wire?.y)) look = wire;", room)

    def test_the_right_button_reaches_the_server(self):
        # The press rides the word as AltFire (one word for an altFireOnce
        # weapon), and a press spent on a tickless frame is carried.
        viewer = ROOT / "viewer"
        page_input = (viewer / "page-input.js").read_text()
        press = page_input.index("function footAltPress() {")
        self.assertIn("pageInput.altPress = true;", page_input[press:press + 200])
        self.assertIn("pageInput.wireAltFire = () => {", page_input)
        player = (viewer / "local-player.js").read_text()
        self.assertIn("altFire: !!page.wireAltFire?.() || heldTrigger('c_PIAltFire'),", player)
        room = (viewer / "net-room.js").read_text()
        self.assertRegex(room, r"const ONE_SHOT_BITS = \['jump', 'altFire'[^\]]*\];")
        self.assertIn("keepZoomWithServer(performance.now());", room)


if __name__ == "__main__":
    unittest.main()
