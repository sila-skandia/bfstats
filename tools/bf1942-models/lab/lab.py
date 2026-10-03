#!/usr/bin/env python3
"""Parity lab: a private BF1942 dedicated server for scripted real-game runs.

The lab is a copy of the LAN server install (server1) that this user owns and
runs directly, on its own ports. A scenario picks the map, the game mode and
the server settings; `start` renders them and starts a fresh server; `stop`
stops it and gathers everything the run produced (the server's event log, the
client recordings made while it ran) into one run directory, staged for the
map viewer. server1, its systemd unit and its files are never touched, so none
of this needs sudo.

    python3 lab/lab.py setup                              # build the lab install from server1
    python3 lab/lab.py start lab/scenarios/wake-coop.json
    python3 lab/lab.py status
    python3 lab/lab.py stop                               # stop, collect, stage for the viewer
    python3 lab/lab.py summary <run dir | ev_*.xml> [--json]

features/parity-lab/README.md is the design and what the runs have shown.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER_REPLAYS = HERE.parent / "viewer" / "replays"

SERVER_SRC = Path(os.environ.get("BF42_SERVER_SRC", "/home/bf1942_user/instances/server1"))
LAB = Path(os.environ.get("BF42_LAB", Path.home() / "bf1942-lab"))
GAME_DIR = Path(os.environ.get("BF42_GAME_DIR", Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"))
MONITOR = Path(os.environ.get("BF42_MONITOR", Path.home() / ".wine/bf1942-monitor/collector/bf1942-monitor.sh"))

INSTALL = LAB / "server"
RUNS = LAB / "runs"
STATE = LAB / "current.json"
TEMPLATE = INSTALL / "settings-template"
SETTINGS = INSTALL / "mods" / "bf1942" / "settings"
LOGS = INSTALL / "mods" / "bf1942" / "logs"

# The lab's identity and ports, clear of server1's 14567 / 22000 / 23000 /
# 14723 / 4744. Scenario settings are applied after these, except the ports.
LAB_SETTINGS = {
    "serverName": "bfstats-lab",
    "serverPort": 14568,
    "gameSpyLANPort": 22001,
    "gameSpyPort": 23001,
    "ASEPort": 14724,
    "serverInternet": 0,
    "serverEventLogging": 1,
    "serverEventLogCompression": 0,
}
PORT_KEYS = {"serverport", "gamespylanport", "gamespyport", "aseport", "serverip"}

# Settings files that are not the game server's, or that hold credentials:
# bfsmd's own config, map list and user list, and the admin password file.
SKIP_SETTINGS = {"adminsettings.con", "servermanager.con", "servermaplist.con", "useraccess.con"}

SERVER_ARGS = ["./bf1942_lnxded", "+config", "ServerSettings.con", "+statusMonitor", "0", "+dedicated", "1"]
MODES = {"GPM_COOP", "GPM_CQ", "GPM_CTF", "GPM_TDM", "GPM_OBJECTIVEMODE"}
# The viewer's name for the layer each server mode runs (game-modes.js).
VIEWER_MODE = {"GPM_COOP": "CoOp", "GPM_CQ": "Conquest", "GPM_CTF": "Ctf", "GPM_TDM": "Tdm"}


# --- the install ---------------------------------------------------------------

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def setup(force: bool = False) -> None:
    """Build the lab install: the server binary and its small files copied,
    the mod archives linked (read-only, 127 MB), and a snapshot of server1's
    settings as the template every run is rendered from."""
    if INSTALL.exists():
        if not force:
            print(f"{INSTALL} exists; `setup --force` rebuilds it")
            return
        if running_state():
            sys.exit("a lab server is running; stop it first")
        shutil.rmtree(INSTALL)
    binary = SERVER_SRC / "bf1942_lnxded.static"
    if not binary.is_file():
        sys.exit(f"no server install at {SERVER_SRC} (set BF42_SERVER_SRC)")
    INSTALL.mkdir(parents=True)
    shutil.copy2(binary, INSTALL / "bf1942_lnxded")
    shutil.copytree(SERVER_SRC / "lib", INSTALL / "lib")
    for mod in sorted(p for p in (SERVER_SRC / "mods").iterdir() if p.is_dir()):
        dest = INSTALL / "mods" / mod.name
        dest.mkdir(parents=True)
        (dest / "archives").symlink_to(mod / "archives")
        for name in ("init.con", "contentcrc32.con", "lexiconall.dat"):
            if (mod / name).is_file():
                shutil.copy2(mod / name, dest / name)
    TEMPLATE.mkdir(parents=True)
    src_settings = SERVER_SRC / "mods" / "bf1942" / "settings"
    for f in sorted(src_settings.iterdir()):
        if f.is_dir():
            shutil.copytree(f, TEMPLATE / f.name)
        elif f.name.lower() == "serverautoexec.con":
            (TEMPLATE / f.name).write_text(render_autoexec(f.read_text(), []))
        elif f.suffix == ".con" and f.name.lower() not in SKIP_SETTINGS:
            shutil.copy2(f, TEMPLATE / f.name)
    LOGS.mkdir(parents=True, exist_ok=True)
    (INSTALL / "SOURCE.json").write_text(json.dumps({
        "from": str(SERVER_SRC),
        "binary": "bf1942_lnxded.static",
        "sha256": sha256(binary),
        "built": dt.datetime.now().isoformat(timespec="seconds"),
    }, indent=2) + "\n")
    print(f"lab install at {INSTALL} (settings template from {src_settings})")


# --- rendering a scenario --------------------------------------------------------

def con_value(value) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, str):
        return '"' + value.replace('"', "") + '"'
    return str(value)


def render_server_settings(template: str, scenario_settings: dict) -> str:
    """The template's `game.<key> <value>` lines with the lab's settings, then
    the scenario's, put over them; keys the template lacks are appended. The
    scenario cannot move the lab off its ports."""
    wanted: dict[str, tuple[str, object]] = {}
    for key, value in LAB_SETTINGS.items():
        wanted[key.lower()] = (key, value)
    for key, value in scenario_settings.items():
        if key.lower() in PORT_KEYS:
            raise ValueError(f"scenario may not set {key}: the lab owns its ports")
        wanted[key.lower()] = (key, value)
    out, seen = [], set()
    for line in template.splitlines():
        m = re.match(r"\s*game\.(\w+)\s", line + " ")
        if m and m.group(1).lower() in wanted:
            key, value = wanted[m.group(1).lower()]
            out.append(f"game.{m.group(1)} {con_value(value)}")
            seen.add(m.group(1).lower())
        else:
            out.append(line)
    for low, (key, value) in wanted.items():
        if low not in seen:
            out.append(f"game.{key} {con_value(value)}")
    return "\n".join(out) + "\n"


def render_maplist(levels: list[dict]) -> str:
    lines = []
    for lv in levels:
        mode = lv.get("mode", "GPM_COOP").upper()
        if mode not in MODES:
            raise ValueError(f"unknown game mode {mode}")
        lines.append(f"game.addLevel {lv['map'].lower()} {mode} {lv.get('mod', 'bf1942').lower()}")
    first = levels[0]
    lines.append(f"game.setCurrentLevel {first['map'].lower()} {first.get('mode', 'GPM_COOP').upper()} "
                 f"{first.get('mod', 'bf1942').lower()}")
    return "\n".join(lines) + "\n"


def render_autoexec(template: str, extra: list[str]) -> str:
    # No remote console: server1 holds 4744, and the line carries a password.
    kept = [ln for ln in template.splitlines() if "enableremoteconsole" not in ln.lower()]
    return "\n".join(kept + list(extra)) + "\n"


def load_scenario(path: Path) -> dict:
    sc = json.loads(path.read_text())
    if not sc.get("name") or not sc.get("levels"):
        raise ValueError(f"{path}: a scenario needs a name and at least one level")
    return sc


def write_settings(sc: dict) -> None:
    if SETTINGS.exists():
        shutil.rmtree(SETTINGS)
    shutil.copytree(TEMPLATE, SETTINGS)
    (SETTINGS / "serversettings.con").write_text(
        render_server_settings((TEMPLATE / "serversettings.con").read_text(), sc.get("serverSettings", {})))
    (SETTINGS / "maplist.con").write_text(render_maplist(sc["levels"]))
    auto = TEMPLATE / "serverautoexec.con"
    (SETTINGS / "serverautoexec.con").write_text(
        render_autoexec(auto.read_text() if auto.exists() else "", sc.get("autoexec", [])))


# --- running ---------------------------------------------------------------------

def is_running(st: dict) -> bool:
    """Whether the state's pid is still the lab server (and not a reused pid)."""
    try:
        cmdline = Path(f"/proc/{st['pid']}/cmdline").read_bytes()
        cwd = os.readlink(f"/proc/{st['pid']}/cwd")
    except OSError:
        return False
    return b"bf1942_lnxded" in cmdline and Path(cwd) == INSTALL


def running_state() -> dict | None:
    if not STATE.exists():
        return None
    st = json.loads(STATE.read_text())
    return st if is_running(st) else None


def join_address() -> str:
    """The address the client joins: server1's LAN IP when bfsmd names one."""
    mgr = SERVER_SRC / "mods" / "bf1942" / "settings" / "servermanager.con"
    try:
        m = re.search(r"^game\.serverIP\s+(\S+)", mgr.read_text(), re.M)
        if m and m.group(1) != "0.0.0.0":
            return m.group(1)
    except OSError:
        pass
    return "127.0.0.1"


def join_command() -> str:
    # The port rides on the address: BF1942.exe ignores `+port` and joins
    # 14567, which is server1. `+joinServer <ip>:<port> +isInternet 0` is the
    # line the game itself writes when it restarts to join a LAN server.
    return f"{MONITOR} +joinServer {join_address()}:{LAB_SETTINGS['serverPort']} +isInternet 0"


def new_logs(since: float) -> list[Path]:
    return sorted(p for p in LOGS.glob(f"ev_{LAB_SETTINGS['serverPort']}-*.xml") if p.stat().st_mtime >= since - 1)


def start(scenario_path: Path, wait: float) -> None:
    if not INSTALL.exists():
        setup()
    if (st := running_state()):
        sys.exit(f"lab server already running (pid {st['pid']}, run {st['run']}); `lab.py stop` first")
    if STATE.exists():
        print("the last run's server exited on its own; collecting it first")
        finish(json.loads(STATE.read_text()))
    sc = load_scenario(scenario_path)
    write_settings(sc)
    started = time.time()
    run_id = dt.datetime.fromtimestamp(started).strftime("%Y%m%d-%H%M%S") + "-" + sc["name"]
    run = RUNS / run_id
    run.mkdir(parents=True)
    shutil.copy2(scenario_path, run / "scenario.json")
    shutil.copytree(SETTINGS, run / "settings")
    env = dict(os.environ, LD_LIBRARY_PATH=f"{INSTALL / 'lib'}:/usr/lib32")
    if sc.get("preload"):
        env["LD_PRELOAD"] = str(Path(sc["preload"]).expanduser().resolve())
    with (run / "server.out").open("wb") as out:
        proc = subprocess.Popen(SERVER_ARGS, cwd=INSTALL, env=env, stdin=subprocess.DEVNULL,
                                stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
    STATE.write_text(json.dumps({"pid": proc.pid, "run": run_id, "scenario": sc["name"],
                                 "started": started, "levels": sc["levels"]}, indent=2) + "\n")
    lv = sc["levels"][0]
    print(f"lab server pid {proc.pid}: {lv['map']} {lv.get('mode', 'GPM_COOP')}, "
          f"port {LAB_SETTINGS['serverPort']}, run {run_id}")
    print(f"join: {join_command()}")
    if wait > 0:
        wait_for_round(proc, started, wait)


def wait_for_round(proc: subprocess.Popen, started: float, timeout: float) -> None:
    """Block until the first round has run ten seconds, so `start` reports a
    server that is actually playing. Bots are topped up tick by tick and a
    full server takes a few seconds; the log's timestamps count from about
    the process start."""
    deadline = started + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            sys.exit(f"the server exited with {proc.returncode}; see the run's server.out")
        logs = new_logs(started)
        if logs:
            text = logs[-1].read_text(encoding="latin1")
            m = re.search(r'name="roundInit" timestamp="([\d.]+)"', text)
            if m and time.time() - started > float(m.group(1)) + 10:
                s = summarise_log(text)
                print(f"round running: {s['playersSpawned']} players spawned in its first 10 s "
                      f"({', '.join(f'team {t}: {n}' for t, n in sorted(s['spawnedByTeam'].items()))})")
                return
        time.sleep(1)
    print(f"no round after {timeout:.0f} s; `lab.py status` to keep watching")


def stop() -> None:
    if not STATE.exists():
        sys.exit("no lab server running")
    st = json.loads(STATE.read_text())
    if is_running(st):
        # The server exits cleanly on SIGINT, in well under a second.
        pid = st["pid"]
        os.killpg(pid, signal.SIGINT)
        for _ in range(100):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        else:
            os.killpg(pid, signal.SIGKILL)
    else:
        print("the server had already exited")
    finish(st)


def finish(st: dict) -> None:
    """Collect a run whose server is gone, write its run.json, and say where
    everything went."""
    stopped = time.time()
    run = RUNS / st["run"]
    collected = collect(run, st["started"], stopped)
    STATE.unlink()
    meta = {
        "run": st["run"],
        "scenario": st["scenario"],
        "levels": st["levels"],
        "started": dt.datetime.fromtimestamp(st["started"]).isoformat(timespec="seconds"),
        "stopped": dt.datetime.fromtimestamp(stopped).isoformat(timespec="seconds"),
        "seconds": round(stopped - st["started"], 1),
        "server": json.loads((INSTALL / "SOURCE.json").read_text()),
        "artifacts": collected,
    }
    (run / "run.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"stopped after {meta['seconds']:.0f} s; run in {run}")
    for kind in ("serverlog", "client", "server"):
        for f in collected.get(kind, []):
            note = " (still open: quit the game before `stop` for a closed file)" \
                if kind == "client" and not recording_closed(run / f) else ""
            print(f"  {kind}: {f}{note}")
    for f in collected["elsewhere"]:
        print(f"  not collected: {f}, not the lab")
    if not collected["client"] and not collected.get("server"):
        print("  no client recording joined the lab during the run (recordReplays on in bf42plus.ini?)")
    for url in viewer_urls(st, collected):
        print(f"viewer: {url}")


def collect(run: Path, started: float, stopped: float) -> dict[str, list[str]]:
    """Move the run's event logs out of the install and copy the client
    recordings made while it ran; stage both under viewer/replays/<run>/."""
    out: dict[str, list[str]] = {"serverlog": [], "client": [], "server": [], "elsewhere": []}
    (run / "serverlog").mkdir(exist_ok=True)
    for log in new_logs(started):
        shutil.move(str(log), run / "serverlog" / log.name)
        out["serverlog"].append(f"serverlog/{log.name}")
    # bf42plus names a recording after the moment it opened, which is the
    # client's join: one file per join, so the run's are the ones opened
    # while the server ran, less any that joined another server meanwhile.
    recordings = GAME_DIR / "replays"
    if recordings.is_dir():
        (run / "client").mkdir(exist_ok=True)
        for rec in sorted(recordings.glob("replay_*.ndjson")):
            opened = recording_opened(rec)
            if opened is None or not started - 5 <= opened <= stopped:
                continue
            server = recording_server(rec)
            if server is not None and server != LAB_SETTINGS["serverName"]:
                out["elsewhere"].append(f"{rec.name} joined '{server}'")
                continue
            shutil.copy2(rec, run / "client" / rec.name)
            out["client"].append(f"client/{rec.name}")
    # The server-side recorder (a scenario's `preload`) writes into the
    # install's replays/, one file per level, named for the moment it opened.
    server_recs = INSTALL / "replays"
    if server_recs.is_dir():
        for rec in sorted(server_recs.glob("replay_*.ndjson")):
            opened = server_recording_opened(rec)
            if opened is None or not started - 5 <= opened <= stopped:
                continue
            (run / "server").mkdir(exist_ok=True)
            shutil.copy2(rec, run / "server" / rec.name)
            out["server"].append(f"server/{rec.name}")
    stage = VIEWER_REPLAYS / run.name
    if out["serverlog"] or out["client"] or out["server"]:
        stage.mkdir(parents=True, exist_ok=True)
        for rel in out["serverlog"] + out["client"] + out["server"]:
            shutil.copy2(run / rel, stage / Path(rel).name)
    return out


def recording_opened(rec: Path) -> float | None:
    m = re.fullmatch(r"replay_(\d{8}-\d{6})\.ndjson", rec.name)
    return dt.datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").timestamp() if m else None


def server_recording_opened(rec: Path) -> float | None:
    """The server recorder names a file replay_<unix seconds>[-<n>].ndjson."""
    m = re.fullmatch(r"replay_(\d{9,11})(?:-\d+)?\.ndjson", rec.name)
    return float(m.group(1)) if m else None


def recording_server(rec: Path) -> str | None:
    """The name of the server a recording joined, from the join-time event
    0x1B (`char[32]` name, then its length; round-replay-capture §11.3)."""
    with rec.open(encoding="utf-8", errors="replace") as f:
        for _, line in zip(range(50), f):
            if '"type":27' in line:
                try:
                    raw = bytes.fromhex(json.loads(line)["raw"])
                except (ValueError, KeyError):
                    return None
                return raw[:32].split(b"\0")[0].decode("latin1")
    return None


def recording_closed(rec: Path) -> bool:
    """Whether the recorder finished the file. It closes on the next join or
    when the game exits, not on a disconnect, so a file copied while the game
    still runs has no `end` record yet."""
    with rec.open("rb") as f:
        f.seek(max(0, rec.stat().st_size - 256))
        return b'"k":"end"' in f.read()


def log_opened(log: Path) -> float | None:
    """The server opens a new event log each time a level loads, named for
    that minute: ev_<port>-<yyyymmdd>_<hhmm>.xml."""
    m = re.fullmatch(r"ev_\d+-(\d{8}_\d{4})\.xml", log.name)
    return dt.datetime.strptime(m.group(1), "%Y%m%d_%H%M").timestamp() if m else None


def log_for(recording: str, logs: list[str]) -> str | None:
    """The event log covering a recording: the last level load before the
    client joined (a minute's slack for the log name's resolution)."""
    opened = recording_opened(Path(recording)) or server_recording_opened(Path(recording))
    dated = [(log_opened(Path(lg)), lg) for lg in logs]
    before = [lg for t, lg in sorted((t, lg) for t, lg in dated if t is not None) if opened is None or t <= opened + 60]
    return before[-1] if before else (logs[-1] if logs else None)


def viewer_urls(st: dict, collected: dict[str, list[str]]) -> list[str]:
    base = os.environ.get("BF42_VIEWER_URL", "http://localhost:5273")
    lv = st["levels"][0]
    mode = VIEWER_MODE.get(lv.get("mode", "GPM_COOP").upper(), "")
    urls = []
    for rec in collected["client"] + collected.get("server", []):
        log = log_for(rec, collected["serverlog"])
        overlay = f"&serverlog=replays/{st['run']}/{Path(log).name}" if log else ""
        urls.append(f"{base}/map.html?replay=replays/{st['run']}/{Path(rec).name}{overlay}&mode={mode}")
    return urls


def status() -> None:
    st = running_state()
    if not st:
        print("the last run's server exited on its own; `lab.py stop` collects it"
              if STATE.exists() else "no lab server running")
        return
    up = time.time() - st["started"]
    lv = st["levels"][0]
    print(f"pid {st['pid']}, up {up / 60:.1f} min, run {st['run']}: {lv['map']} {lv.get('mode', 'GPM_COOP')}")
    print(f"join: {join_command()}")
    logs = new_logs(st["started"])
    if logs:
        print_summary(summarise_log(logs[-1].read_text(encoding="latin1")))


# --- the server event log ----------------------------------------------------------

EVENT = re.compile(r'<bf:event name="(\w+)" timestamp="([\d.]+)">(.*?)</bf:event>', re.S)
PARAM = re.compile(r'<bf:param type="\w+" name="(\w+)">(.*?)</bf:param>', re.S)
SETTING = re.compile(r'<bf:setting name="([^"]+)">(.*?)</bf:setting>')


def parse_log(text: str) -> tuple[dict, list[tuple[str, float, dict]]]:
    """Settings and events of an event log. Regular expressions, not an XML
    parser: the file is unterminated while its round runs."""
    settings = dict(SETTING.findall(text))
    events = [(name, float(ts), dict(PARAM.findall(body))) for name, ts, body in EVENT.findall(text)]
    return settings, events


def vec(s: str) -> tuple[float, ...]:
    return tuple(float(v) for v in s.split("/"))


def summarise_log(text: str) -> dict:
    """What one event log says about a round, in the terms the comparison
    uses: who spawned on which side, with which kit, into which vehicle, and
    who killed whom from how far."""
    settings, events = parse_log(text)
    team: dict[str, str] = {}
    for name, _, p in events:
        if name == "spawnEvent":
            team[p["player_id"]] = p["team"]
    count = collections.Counter(name for name, _, _ in events)
    kits: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    vehicles: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for name, _, p in events:
        side = team.get(p.get("player_id"), "?")
        if name == "pickupKit":
            kits[side][p["kit"]] += 1
        elif name == "enterVehicle":
            vehicles[side][p["vehicle"]] += 1
    # A kill is a scoreEvent Kill with the victim's own death at the same
    # timestamp; its player_location is where the victim was.
    deaths = {(ts, p["player_id"]): p for name, ts, p in events
              if name == "scoreEvent" and p.get("score_type") in ("Death", "DeathNoMsg")}
    kills = []
    for name, ts, p in events:
        if name == "scoreEvent" and p.get("score_type") in ("Kill", "TK"):
            victim = deaths.get((ts, p.get("victim_id")))
            dist = None
            if victim and "player_location" in p and "player_location" in victim:
                dist = round(math.dist(vec(p["player_location"]), vec(victim["player_location"])), 1)
            kills.append({"t": ts, "killer": p["player_id"], "victim": p.get("victim_id"),
                          "team": team.get(p["player_id"]), "tk": p["score_type"] == "TK",
                          "weapon": p.get("weapon"), "distance": dist})
    rounds = [{"t": ts, **p} for name, ts, p in events if name == "roundInit"]
    ends = [{"t": ts, **p} for name, ts, p in events if name in ("endRound", "roundEnd")]
    return {
        "map": settings.get("map"),
        "maxPlayers": settings.get("maxplayers"),
        "events": dict(count.most_common()),
        "span": [events[0][1], events[-1][1]] if events else None,
        "rounds": rounds,
        "roundEnds": ends,
        "playersSpawned": len(team),
        "spawnedByTeam": dict(collections.Counter(team.values())),
        "kitsByTeam": {t: dict(c.most_common()) for t, c in sorted(kits.items())},
        "vehiclesByTeam": {t: dict(c.most_common()) for t, c in sorted(vehicles.items())},
        "kills": kills,
    }


def print_summary(s: dict) -> None:
    span = f"{s['span'][0]:.0f}-{s['span'][1]:.0f} s" if s["span"] else "no events"
    print(f"{s['map']}: {span}, {s['playersSpawned']} players spawned {s['spawnedByTeam']}")
    for r in s["rounds"]:
        print(f"  round at {r['t']:.1f} s: tickets {r.get('tickets_team1')} / {r.get('tickets_team2')}")
    for t, kits in s["kitsByTeam"].items():
        print(f"  team {t} kits: {kits}")
    for t, veh in s["vehiclesByTeam"].items():
        print(f"  team {t} entered: {veh}")
    dists = sorted(k["distance"] for k in s["kills"] if k["distance"] is not None)
    if s["kills"]:
        median = dists[len(dists) // 2] if dists else None
        print(f"  kills: {len(s['kills'])}, median distance {median} m, "
              f"by team {dict(collections.Counter(k['team'] for k in s['kills']))}")


def summary(target: Path, as_json: bool) -> None:
    logs = sorted((target / "serverlog").glob("*.xml")) if target.is_dir() else [target]
    if not logs:
        sys.exit(f"no event log in {target}")
    for log in logs:
        s = summarise_log(log.read_text(encoding="latin1"))
        if as_json:
            print(json.dumps(s, indent=2))
        else:
            print(f"== {log.name}")
            print_summary(s)


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("setup", help="build the lab install from server1")
    p.add_argument("--force", action="store_true", help="rebuild an existing install")
    p = sub.add_parser("start", help="render a scenario and start the lab server")
    p.add_argument("scenario", type=Path)
    p.add_argument("--wait", type=float, default=180, help="seconds to wait for the round (0: return at once)")
    sub.add_parser("status", help="is it running, and what has the round logged")
    sub.add_parser("stop", help="stop the server and collect the run")
    p = sub.add_parser("summary", help="summarise a run's event log")
    p.add_argument("target", type=Path)
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "setup":
        setup(a.force)
    elif a.cmd == "start":
        start(a.scenario, a.wait)
    elif a.cmd == "status":
        status()
    elif a.cmd == "stop":
        stop()
    elif a.cmd == "summary":
        summary(a.target, a.json)


if __name__ == "__main__":
    main(sys.argv[1:])
