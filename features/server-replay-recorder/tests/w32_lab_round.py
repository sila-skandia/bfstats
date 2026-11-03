#!/usr/bin/env python3
"""Record one timed round on the Windows server under Wine, and check it.

    tests/w32_lab_round.py --dll build/WINMM.dll [--level wake] [--minutes 8] [--name tag]

Uses the Windows lab folder (~/bf1942-lab/w32, $BF42_W32_LAB): BF1942_w32ded.exe
v1.61 with Mods/bf1942 beside it, set up as the lab server's own (co-op, the
lab's bots, ports clear of the Linux lab). For the run:

  - WINMM.dll is replaced by --dll (the previous one is kept as WINMM.dll.prev),
  - ServerSettings.con's game time and ServerAutoExec.con's admin.timeLimit
    (which overrides it, in seconds) become --minutes, and maplist.con the level, all
    put back afterwards,
  - the server runs until the round's tally (`roundStats`) is in the
    recording and the round has ended, or until the time limit plus a margin,
  - the server is stopped, the new recordings, recorder.log, the console
    and the event log go to ~/bf1942-lab/w32-runs/<stamp>-<level>[-<name>]/,
  - check_shots.py checks the recording that holds the tally, with
    recorder.log, as a bots-only round, and viewer_check.mjs reads it as
    the replay viewer does.

The server must still be running when the round ends: a recorder that took
it down fails the run, whatever the recording says.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROC = "BF1942_w32ded.e"   # the process name, truncated as pgrep -x sees it


def running() -> bool:
    return subprocess.run(["pgrep", "-x", PROC], capture_output=True).returncode == 0


def stop() -> None:
    subprocess.run(["pkill", "-x", PROC])
    for _ in range(40):
        if not running():
            return
        time.sleep(0.5)
    subprocess.run(["pkill", "-9", "-x", PROC])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dll", required=True)
    ap.add_argument("--level", default="wake")
    ap.add_argument("--mode", default="GPM_COOP")
    ap.add_argument("--minutes", type=int, default=8)
    ap.add_argument("--name", default="")
    a = ap.parse_args()

    lab = Path(os.environ.get("BF42_W32_LAB", Path.home() / "bf1942-lab/w32"))
    exe = lab / "BF1942_w32ded.exe"
    settings = lab / "Mods/bf1942/Settings"
    if not exe.is_file():
        sys.exit(f"no {exe}")
    if running():
        sys.exit(f"{PROC} is already running; stop it first")
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path.home() / "bf1942-lab/w32-runs" / "-".join(filter(None, [stamp, a.level, a.name]))
    out.mkdir(parents=True)

    server_con = settings / "ServerSettings.con"
    autoexec = settings / "ServerAutoExec.con"
    maplist = settings / "maplist.con"
    saved = {p: p.read_text() for p in (server_con, autoexec, maplist)}
    dll = lab / "WINMM.dll"
    if dll.exists():
        shutil.copy2(dll, lab / "WINMM.dll.prev")
    shutil.copy2(a.dll, dll)
    (settings / "recorder.con").write_text("recordReplays 1\nreplaySampleHz 30\n")

    text = saved[server_con]
    text = re.sub(r"(?m)^game\.serverGameTime .*$", f"game.serverGameTime {a.minutes}", text)
    text = re.sub(r"(?m)^game\.serverNumberOfRounds .*$", "game.serverNumberOfRounds 1", text)
    server_con.write_text(text)
    # ServerAutoExec.con's admin.timeLimit runs after ServerSettings.con and
    # overrides its game time. It counts seconds: the clock events' timeLimit
    # is this value, against a worldTime in seconds (a limit of 6 ended a
    # round 6 s in, 2026-11-04).
    limit = a.minutes * 60
    auto = re.sub(r"(?m)^admin\.timeLimit .*$", f"admin.timeLimit {limit}", saved[autoexec])
    if not re.search(r"(?m)^admin\.timeLimit ", auto):
        auto += f"admin.timeLimit {limit}\n"
    autoexec.write_text(auto)
    maplist.write_text(f"game.addLevel {a.level} {a.mode} bf1942\n"
                       f"game.setCurrentLevel {a.level} {a.mode} bf1942\n")

    replays = lab / "replays"
    replays.mkdir(exist_ok=True)
    before = set(replays.iterdir())
    logs = lab / "Mods/bf1942/Logs"
    logs_before = set(logs.iterdir()) if logs.is_dir() else set()

    deadline = time.time() + a.minutes * 60 + 240
    env = dict(os.environ, WINEDEBUG="-all")
    console = out / "console.log"
    proc = subprocess.Popen(
        ["script", "-qec", "wine BF1942_w32ded.exe +game bf1942 +restart 1 +dedicated 1", str(console)],
        cwd=lab, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    print(f"server started ({a.level}, {a.minutes} min round), run folder {out}", flush=True)

    tally_file = None
    alive_at_end = False
    ended_by = "time limit"
    try:
        time.sleep(20)
        last_note = 0.0
        while time.time() < deadline:
            new = sorted(set(replays.iterdir()) - before, key=lambda p: p.stat().st_mtime)
            for p in new:
                body = p.read_bytes()
                if b'"roundStats"' in body and b'"gameStatus"' in body.split(b'"roundStats"', 1)[1]:
                    tally_file = p
            if tally_file:
                time.sleep(5)          # the rest of the tally and the round's end
                ended_by = "the round's tally"
                break
            if not running():
                ended_by = "the server exiting"
                break
            if time.time() - last_note > 60:
                size = sum(p.stat().st_size for p in new)
                print(f"  {int(time.time() - deadline + a.minutes * 60 + 240)} s, "
                      f"{len(new)} file(s), {size / 1e6:.1f} MB", flush=True)
                last_note = time.time()
            time.sleep(5)
        alive_at_end = running()
    finally:
        stop()
        proc.wait(timeout=30)
        for p, body in saved.items():
            p.write_text(body)

    (out / "replays").mkdir()
    for p in sorted(set(replays.iterdir()) - before):
        shutil.move(str(p), out / "replays" / p.name)
    if tally_file:
        tally_file = out / "replays" / tally_file.name
    if (lab / "recorder.log").exists():
        shutil.copy2(lab / "recorder.log", out / "recorder.log")
    for p in sorted(set(logs.iterdir()) - logs_before) if logs.is_dir() else []:
        shutil.copy2(p, out / p.name)
    shutil.copy2(a.dll, out / "WINMM.dll")

    # A server that ends its map exits (+restart 1: its host starts it
    # again). That is gameStatus 5 and the world unloading, then the exit;
    # an exit without them is the server going down mid-round.
    log = (out / "recorder.log").read_text(errors="replace") if (out / "recorder.log").exists() else ""
    map_ended = "world unloaded" in log and any(
        b'"e":"gameStatus","status":5' in p.read_bytes() for p in (out / "replays").iterdir())
    print(f"stopped after {ended_by}; server "
          + ("was still running" if alive_at_end else
             "had exited at its map's end" if map_ended else "was NOT running"))
    ok = (alive_at_end or map_ended) and tally_file is not None
    if not (alive_at_end or map_ended):
        print("FAIL: the server stopped before the round ended")
    if tally_file is None:
        print("FAIL: no recording holds the round's tally")
        return 1
    r = subprocess.run([sys.executable, str(HERE / "check_shots.py"), str(tally_file),
                        "--log", str(out / "recorder.log"), "--expect-fake",
                        "--json", str(out / "check.json")])
    v = subprocess.run(["node", str(HERE / "viewer_check.mjs"), str(tally_file)]) \
        if shutil.which("node") else None
    if v is None:
        print("viewer check: skipped (no node)")
    return 0 if ok and r.returncode == 0 and (v is None or v.returncode == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
