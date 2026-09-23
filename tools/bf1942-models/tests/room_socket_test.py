"""The real junction: `server.mjs` on a real TCP port, native WebSocket
clients, real frames — the proof the hand-rolled RFC 6455 half of
`server/server.mjs` actually speaks WebSocket.

Same overlay as `test_room.py` (the module graph, the vendored three.js, the
Willy/Zero templates) plus `server/server.mjs`; the driver spawns the server
with the `test` descriptor level (the overlay has no maps tree, so `test`
is the only level and the default), joins two real sockets into one room,
walks one of them for a second at the engine's 30 Hz, and the assertions
run on the JSON it prints:

* the server came up and the lobby answered;
* both HELLO rows carry the handshake fields (slot/room/level/mode/team/
  name/slots/maxPlayers/flags/vehicles/tickets) and both got their
  MSG_JOIN_SNAPSHOT;
* MSG_PING elicited MSG_PONG over the real socket;
* B's 20 Hz snapshot stream shows A's slot moving (the walk law on the
  wire, over TCP);
* the lobby lists the room with two players.

Run twice in a row — two fresh ports — because a listener or socket left
behind by the first pass is exactly the class of leak this test exists to
catch.

The room protocol itself is asserted far more deeply in `test_room.py`;
this file is the transport seam and nothing more.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

import importlib.util

spec = importlib.util.spec_from_file_location(
    "troom", Path(__file__).resolve().parent / "test_room.py")
troom = importlib.util.module_from_spec(spec)
spec.loader.exec_module(troom)

ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT / "server"

MODULES = dict(troom.MODULES)
MODULES.update({
    "server/server.mjs": SERVER_DIR / "server.mjs",
    # server.mjs's pieces.
    "server/websocket.mjs": SERVER_DIR / "websocket.mjs",
    "server/level-table.mjs": SERVER_DIR / "level-table.mjs",
})
DRIVER = Path(__file__).resolve().parent / "room_socket_driver.mjs"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_driver(work: Path, port: int) -> dict:
    proc = subprocess.run(
        ["node", str(work / "driver.mjs"), "--port", str(port)],
        capture_output=True, text=True, timeout=120, cwd=work)
    if proc.returncode != 0:
        raise AssertionError(f"driver failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


def overlay() -> tempfile.TemporaryDirectory:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    tmp = tempfile.TemporaryDirectory()
    work = Path(tmp.name)
    for name, source in MODULES.items():
        target = work / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (work / "node_modules" / "three" / "package.json").write_text(troom.THREE_PACKAGE)
    (work / "package.json").write_text('{"type":"module"}\n')
    shutil.copyfile(DRIVER, work / "driver.mjs")
    return tmp


class SocketJunctionTests(unittest.TestCase):
    """Run once with a dedicated port, then again for leakage."""

    def run_junction(self) -> dict:
        tmp = overlay()
        try:
            return run_driver(Path(tmp.name), free_port())
        finally:
            tmp.cleanup()

    def test_two_clients_one_room_over_real_sockets(self) -> None:
        r = self.run_junction()
        self.assertTrue(r["up"], r)
        self.assertEqual(r["joinSnapA"], True)
        self.assertEqual(r["joinSnapB"], True)

        a, b = r["helloA"], r["helloB"]
        self.assertIsNotNone(a)
        self.assertIsNotNone(b)
        self.assertEqual(a["room"], "ABC")
        self.assertEqual(b["room"], "ABC")
        self.assertEqual(a["level"], "test")
        self.assertEqual(b["level"], "test")
        self.assertIn(a["team"], (1, 2))
        self.assertNotEqual(a["slot"], b["slot"])
        # HELLO's `slots` is the roster of players ALREADY in the room, so the
        # first joiner's is empty; the 16 is `maxPlayers` (rooms.mjs's
        # `helloRow`). This assertion read `slots` as the cap and had been red
        # since the roster arrived.
        self.assertEqual(a["slots"], [])
        self.assertEqual(a["maxPlayers"], 16)
        self.assertEqual(len(b["slots"]), 1)

        # The snapshot stream moved the walker over the wire (the walk law,
        # one second at the engine's own 30 Hz over real loopback frames).
        self.assertGreater(r["snapshots"], 10)
        self.assertGreater(r["moved"], 2.0)
        self.assertTrue(r["aliveB"])

    def test_ping_pong_and_lobby_row(self) -> None:
        r = self.run_junction()
        self.assertIsNotNone(r["pongMs"])
        self.assertLess(r["pongMs"], 2000)
        self.assertIsNotNone(r["lobby"])
        self.assertEqual(r["lobby"]["players"], 2)
        self.assertEqual(r["lobby"]["level"], "test")


if __name__ == "__main__":
    unittest.main()