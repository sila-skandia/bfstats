#!/usr/bin/env python3
"""Ground truth out of a server recording: how the real game's vehicles,
aircraft, rounds and spawner pads behaved, per template, in numbers a viewer
port can be checked against.

    python3 lab/dc_truth.py <run dir | replay_<unix>.ndjson ...> [--mod desertcombat]
                            [--json out.json] [--md out.md]

A server recording (`features/server-replay-recorder`) is the authoritative
world after every server tick, 30 a second: every networked root's position
and rotation (`s`), each engine's revs and throttle servo (`g`), each moving
part's rotation against its root (`j`: turrets, a helicopter's engine racks,
a car's front wheels), who sits where (`p`), every round in flight (`pn`,
`pj`, `pd`), every shot (`f`), hit points (`a`), control points (`cp`) and
the server's own destroy events. Bots drive and fly; nobody's input is
recorded, but the throttle servo, the racks and the front wheels are the
input as the vehicle received it, so most laws can be read off with the
input known.

What it measures, per template:

- ground: top speed under held full throttle on the level, reverse speed,
  the time from rest to 5/10/15 m/s, yaw rate against speed (and at full
  lock where the front wheels are recorded, with the slip angle, which is
  the spin-out question), time spent under the water plane;
- air: the speed envelope while airborne, climb and sink, body rates, and
  for helicopters what an angular rate does once every engine rack is back
  at rest (the damping question);
- rounds: launch speed, the speed at 0.5..5 s, the acceleration along the
  path, the gravity across it, how far a path turns, the weapons that fired
  each template;
- pads: what spawned where and for which side, the delay from a vehicle's
  end to its pad's next one, and how long an abandoned vehicle lived.

Frames: BF1942's, left-handed, +Y up, a body's forward is its rotated +Z
(the quaternion is applied as a Hamilton product; a moving hull's velocity
lies along it, cos 0.999+ in every DC run). Positions are written to the
centimetre, so speeds come from samples a quarter second apart.

The recorder's clock is CLOCK_MONOTONIC from the file's opening and stops in
a suspend (see project memory); nothing here converts it to wall time.
"""

from __future__ import annotations

import argparse
import bisect
import collections
import gzip
import json
import math
import re
import sys
from array import array
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER_MAPS = HERE.parent / "viewer" / "maps"

SPEED_WINDOW = 0.25     # s between the two samples a velocity is taken over
HANDS_OFF = 2.0         # deg: every engine rack this close to square is a centred stick
LOD2 = "\x00lod2"       # the key suffix for a template's moments under an AI LOD 1/2 driver
MAX_GAP = 0.6           # a longer step between samples is missing data, not motion
GROUND_BINS = [0, 2, 5, 10, 15, 20, 25, 30, 40, 1e9]
AIR_BINS = [0, 20, 40, 60, 80, 100, 130, 1e9]


# --- reading ------------------------------------------------------------------------

def open_text(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", errors="replace") if path.suffix == ".gz" \
        else path.open(encoding="utf-8", errors="replace")


class Life:
    """One object on one network id, from its `o` to its end. Samples are
    flat `array('d')`: t, x, y, z, qx, qy, qz, qw per sample."""

    __slots__ = ("nid", "tmpl", "gid", "born", "ended", "end_kind", "gone", "track", "engines",
                 "parts", "turns", "hp", "maxhp", "seats")

    def __init__(self, nid: int, tmpl: str, gid: int | None, born: float, maxhp: float = 0.0):
        self.nid, self.tmpl, self.gid, self.born = nid, tmpl, gid, born
        self.ended: float | None = None
        self.end_kind = ""
        # A server file's `d` is the object leaving the registered map, which a
        # soldier boarding a hull also does; it ends a life only if nothing
        # else does, and a later `o` with the same registry key carries it on.
        self.gone: float | None = None
        self.track = array("d")
        self.engines: dict[int, list[tuple[float, float, float, int]]] = collections.defaultdict(list)
        self.parts: dict[int, str] = {}
        self.turns: dict[int, array] = collections.defaultdict(lambda: array("d"))
        self.hp: list[tuple[float, float]] = []
        self.maxhp = maxhp
        self.seats: list[list] = []      # [pid, seat, team, t0, t1]

    def __len__(self) -> int:
        return len(self.track) // 8

    def soldier(self) -> bool:
        return bool(re.search(r"soldier", self.tmpl, re.I))

    def camera(self) -> bool:
        return bool(re.search(r"camera", self.tmpl, re.I))


class Recording:
    """The parts of a server recording the statistics need."""

    def __init__(self) -> None:
        self.header: dict = {}
        self.level = ""
        self.mode = ""
        self.duration = 0.0
        self.lives: list[Life] = []
        self.current: dict[int, Life] = {}
        self.rounds: dict[int, dict] = {}          # key -> {tmpl, t0, t1, track}
        self.fires: list[tuple[float, int, int, str, tuple, tuple]] = []
        self.cps: dict[int, dict] = {}             # cp id -> {name, tmpl, pos, changes}
        self.status: list[tuple[float, int]] = []
        self.tickets: list[tuple[float, int, int]] = []
        self.bots: set[int] = set()
        self.player_team: dict[int, int] = {}
        self.skipped = 0
        self.left_map: set[int] = set()            # id(life) of lives that ever had a `d`
        self.lods: dict[int, list[tuple[float, int]]] = {}   # bot pid -> [(t, AI LOD)] (AI-136)
        self.round_end: float | None = None
        self._seat_now: dict[int, tuple[Life, int, int, float]] = {}

    # The life an id names at a moment: the current one, which `o` replaces.
    def life(self, nid: int) -> Life | None:
        return self.current.get(nid)

    def end(self, nid: int, t: float, kind: str) -> None:
        life = self.current.get(nid)
        if life is not None and life.ended is None:
            life.ended, life.end_kind = t, kind


def read_recording(path: Path, keep_soldiers: float = 1.0) -> Recording:
    """Read a server recording. Soldiers' tracks are kept at most every
    `keep_soldiers` seconds (what the pad and bot statistics need), every
    other object's in full."""
    rec = Recording()
    last_soldier_t: dict[int, float] = {}
    saw_seats = False
    with open_text(path) as f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                rec.skipped += 1
                continue
            k = r.get("k")
            t = r.get("t", 0.0)
            if isinstance(t, (int, float)):
                rec.duration = max(rec.duration, t)
            if k == "s":
                for o in r["o"]:
                    life = rec.current.get(o[0])
                    if life is None or len(o) < 8 or life.ended is not None:
                        continue
                    if life.soldier():
                        if t - last_soldier_t.get(o[0], -1e9) < keep_soldiers:
                            continue
                        last_soldier_t[o[0]] = t
                    elif life.camera():
                        continue
                    life.track.extend((t, *o[1:8]))
            elif k == "j":
                for o in r["o"]:
                    life = rec.current.get(o[0])
                    if life is not None and len(o) >= 6:
                        life.turns[o[1]].extend((t, *o[2:6]))
            elif k == "g":
                for o in r["o"]:
                    life = rec.current.get(o[0])
                    if life is not None and len(o) >= 6:
                        life.engines[o[5]].append((t, float(o[1]), float(o[2]), int(o[3])))
            elif k == "pj":
                for o in r["o"]:
                    rd = rec.rounds.get(o[0])
                    if rd is not None and rd["t1"] is None:
                        rd["track"].extend((t, *o[1:4]))
            elif k == "o":
                old = rec.current.get(r["id"])
                if old is not None and old.ended is None:
                    if old.gid == r.get("gid") and old.tmpl == r.get("tmpl"):
                        old.gone = None     # the same object seen again
                        continue
                    old.ended, old.end_kind = (old.gone, "gone") if old.gone is not None else (t, "replaced")
                life = Life(r["id"], r.get("tmpl", ""), r.get("gid"), t, float(r.get("maxhp") or 0))
                rec.current[r["id"]] = life
                rec.lives.append(life)
            elif k == "p":
                saw_seats = True
                for o in r["p"]:
                    _seat_change(rec, t, o)
            elif k == "a":
                for o in r["a"]:
                    life = rec.current.get(o[0])
                    if life is not None:
                        life.hp.append((t, float(o[1])))
            elif k == "jn":
                for o in r["o"]:
                    life = rec.current.get(o[0])
                    if life is not None:
                        life.parts[o[1]] = o[2]
            elif k == "pn":
                for key, tmpl in r["o"]:
                    rec.rounds[key] = {"tmpl": tmpl, "t0": t, "t1": None, "track": array("d")}
            elif k == "pd":
                for key in r["o"]:
                    if key in rec.rounds and rec.rounds[key]["t1"] is None:
                        rec.rounds[key]["t1"] = t
            elif k == "f":
                rec.fires.append((t, r.get("id", -1), r.get("pid", -1), r.get("w", ""),
                                  tuple(r.get("p") or ()), tuple(r.get("d") or ())))
            elif k == "d":
                life = rec.current.get(r["id"])
                if life is not None and life.ended is None:
                    life.gone = t
                    rec.left_map.add(id(life))
            elif k == "cp":
                cp = rec.cps.setdefault(r["id"], {"name": None, "tmpl": None, "pos": None, "changes": []})
                for key in ("name", "tmpl", "pos"):
                    if r.get(key) is not None:
                        cp[key] = r[key]
                cp["changes"].append((t, r.get("team")))
            elif k == "lod":
                for pid, lod in r["o"]:
                    rec.lods.setdefault(pid, []).append((t, lod))
            elif k == "tk":
                rec.tickets.append((t, *r["v"]))
            elif k == "e":
                _event(rec, t, r)
            elif k == "h":
                rec.header = r
    for st in list(rec._seat_now):
        _close_seat(rec, st, rec.duration)
    rec.has_seats = saw_seats
    for life in rec.lives:
        if not saw_seats:
            life.seats = NO_SEATS
        if life.ended is None:
            life.ended, life.end_kind = (life.gone, "gone") if life.gone is not None else (rec.duration, "file end")
    cut_at_round_end(rec)
    for life in rec.lives:
        on_ticks(life.track, 8)
    for rd in rec.rounds.values():
        on_ticks(rd["track"], 4)
    return rec


TICK = 1 / 30


def on_ticks(tr: array, stride: int) -> None:
    """Put a track's samples on the server's ticks. The recorder samples once
    after every 1/30 s tick but stamps the sample with the clock, which
    jitters with the server's load (a DC Bocage MLRS rocket's samples are
    0.017-0.045 s apart while it moves the same 2.7 m each), so speeds taken
    sample to sample swing by half. Each stamp becomes the nearest whole tick
    from the first, and never the tick of the sample before."""
    n = len(tr) // stride
    if n < 2:
        return
    t0 = tr[0]
    last = 0
    for i in range(1, n):
        k = max(last + 1, round((tr[i * stride] - t0) / TICK))
        tr[i * stride] = t0 + k * TICK
        last = k


def cut_at_round_end(rec: Recording) -> None:
    """Drop what follows the round's end: the first end-of-round status (2)
    after play (1). The teardown that follows destroys every hull in one tick
    and is not play; a life that ends there ends with the round."""
    playing = False
    end = None
    for t, st in rec.status:
        if st == 1:
            playing = True
        elif st == 2 and playing:
            end = t
            break
    rec.round_end = end
    if end is None:
        return
    for life in rec.lives:
        n = len(life.track) // 8
        keep = n
        while keep and life.track[(keep - 1) * 8] > end:
            keep -= 1
        if keep < n:
            del life.track[keep * 8:]
        if life.ended is not None and life.ended >= end - 0.05:
            life.ended, life.end_kind = end, "round end"
        for s in life.seats:
            s[4] = min(s[4], end)
    for rd in rec.rounds.values():
        tr = rd["track"]
        while tr and tr[-4] > end:
            del tr[-4:]


def _event(rec: Recording, t: float, r: dict) -> None:
    e = r.get("e")
    if e == "destroyObject":
        rec.end(r.get("netId"), t, "destroyed")
    elif e == "setLevel":
        # The recorder's own names the level; a client's join echoes its path
        # (`bf1942/levels/el_alamein/`).
        level = str(r.get("level", "")).replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        rec.level, rec.mode = level, r.get("mode", "")
    elif e == "gameStatus":
        rec.status.append((t, r.get("status")))
    elif e == "createPlayer":
        if r.get("ai"):
            rec.bots.add(r["pid"])
        rec.player_team[r["pid"]] = r.get("team")
    elif e == "setTeam":
        rec.player_team[r["pid"]] = r.get("team")


def _seat_change(rec: Recording, t: float, o: list) -> None:
    """`[pid, team, vehicle, root, seat, triggers]`: a player's seat from now."""
    pid, team, _vehicle, root, seat = o[:5]
    rec.player_team[pid] = team
    now = rec._seat_now.get(pid)
    life = rec.current.get(root)
    if now is not None and now[0] is life and now[1] == seat:
        return
    _close_seat(rec, pid, t)
    if life is not None and not life.soldier() and not life.camera():
        rec._seat_now[pid] = (life, seat, team, t)


def _close_seat(rec: Recording, pid: int, t: float) -> None:
    now = rec._seat_now.pop(pid, None)
    if now is not None:
        life, seat, team, t0 = now
        life.seats.append([pid, seat, team, t0, t])


# --- kinematics ---------------------------------------------------------------------

def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qconj(q):
    return (-q[0], -q[1], -q[2], q[3])


def qrot(q, v):
    """`v` turned by `q` (Hamilton, q v q*)."""
    x, y, z, w = q
    vx, vy, vz = v
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))


def rot_angle(q) -> float:
    """The turn a unit quaternion makes, in degrees (0..180)."""
    s = math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2)
    return math.degrees(2 * math.atan2(s, abs(q[3])))


def wrap180(a: float) -> float:
    return (a + 180.0) % 360.0 - 180.0


def latest(rows: list, t: float, key=lambda r: r[0]):
    """The last row at or before `t` of a time-ordered list, or None."""
    lo, hi = 0, len(rows)
    while lo < hi:
        mid = (lo + hi) // 2
        if key(rows[mid]) <= t:
            lo = mid + 1
        else:
            hi = mid
    return rows[lo - 1] if lo else None


class State:
    """A body's motion at one sample, from it and the sample a quarter second
    on: velocity, its part along the nose, heading, pitch and roll, and the
    turn rates in the body's own axes (x pitch, y yaw, z roll), deg/s."""

    __slots__ = ("t", "p", "v", "speed", "fwd", "heading", "pitch", "roll", "rates", "yaw_rate", "q")

    def __init__(self, t, p, q, v, rates, yaw_rate):
        self.t, self.p, self.q, self.v = t, p, q, v
        self.speed = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
        f = qrot(q, (0.0, 0.0, 1.0))
        r = qrot(q, (1.0, 0.0, 0.0))
        self.fwd = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]
        self.heading = math.degrees(math.atan2(f[0], f[2]))
        self.pitch = math.degrees(math.asin(max(-1.0, min(1.0, f[1]))))
        self.roll = math.degrees(math.asin(max(-1.0, min(1.0, r[1]))))
        self.rates, self.yaw_rate = rates, yaw_rate

    def slip(self) -> float | None:
        """Degrees between where the body points and where it goes, level."""
        h = math.hypot(self.v[0], self.v[2])
        if h < 1.0:
            return None
        return abs(wrap180(math.degrees(math.atan2(self.v[0], self.v[2])) - self.heading))


def states(life: Life, window: float = SPEED_WINDOW) -> list[State]:
    """A State per sample that has a partner `window` on with no gap between.
    A long step between two samples where nothing moved is the body at rest
    (the recorder writes only what moved): it gives a State with no speed."""
    tr = life.track
    n = len(tr) // 8
    out: list[State] = []
    j = 0
    for i in range(n - 1):
        b = i * 8
        ti = tr[b]
        if tr[b + 8] - ti > MAX_GAP:
            nb = b + 8
            if math.dist(tr[b + 1:b + 4], tr[nb + 1:nb + 4]) < 0.05:
                out.append(State(ti, tuple(tr[b + 1:b + 4]), tuple(tr[b + 4:b + 8]),
                                 (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0))
            continue
        j = max(j, i + 1)
        while j < n - 1 and tr[j * 8] < ti + window and tr[j * 8 + 8] - tr[j * 8] <= MAX_GAP:
            j += 1
        c = j * 8
        dt = tr[c] - ti
        if dt <= 0 or dt > MAX_GAP or dt < window * 0.6:
            continue
        p0, p1 = tr[b + 1:b + 4], tr[c + 1:c + 4]
        q0, q1 = tuple(tr[b + 4:b + 8]), tuple(tr[c + 4:c + 8])
        v = tuple((p1[k] - p0[k]) / dt for k in range(3))
        d = qmul(qconj(q0), q1)
        if d[3] < 0:
            d = (-d[0], -d[1], -d[2], -d[3])
        s = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
        ang = 2 * math.atan2(s, d[3])
        rates = tuple(math.degrees(ang * d[k] / s) / dt for k in range(3)) if s > 1e-9 else (0.0, 0.0, 0.0)
        f0, f1 = qrot(q0, (0, 0, 1)), qrot(q1, (0, 0, 1))
        yaw = wrap180(math.degrees(math.atan2(f1[0], f1[2]) - math.atan2(f0[0], f0[2]))) / dt
        out.append(State(ti, tuple(p0), q0, v, rates, yaw))
    return out


def throttle_at(life: Life, t: float) -> float | None:
    """The largest throttle servo of the life's engines at `t` (each engine's
    last `g` at or before it)."""
    best = None
    for rows in life.engines.values():
        row = latest(rows, t)
        if row is not None and (best is None or abs(row[2]) > abs(best)):
            best = row[2]
    return best


def driven_at(life: Life, t: float) -> bool:
    """Someone in the driver's seat. A file from before the recorder wrote
    seats (`p`, 2026-10-04) has none: every moment counts as driven there."""
    if life.seats is NO_SEATS:
        return True
    return any(s[1] == 0 and s[3] <= t < s[4] for s in life.seats)


NO_SEATS: list = []         # the seats of every life in a file without `p` records


def pct(values, q: float):
    """The q-quantile (0..1) of `values`, nearest rank; None when empty."""
    vs = sorted(values)
    if not vs:
        return None
    return vs[min(len(vs) - 1, max(0, int(round(q * (len(vs) - 1)))))]


def r1(x, nd: int = 1):
    return None if x is None else round(x, nd)


class Terrain:
    """Terrain height and the water plane, for heights over ground. Read from
    the level's heightmap in the game install when one is given; without it
    `height` is None and only the water plane is known."""

    def __init__(self, water: float | None = None, heightmap=None):
        self.water = water
        self.hm = heightmap

    def height(self, x: float, z: float) -> float | None:
        if self.hm is None:
            return None
        ix, iz = self.hm.world_to_index(x, z)
        return self.hm.height_at(ix, iz)

    def agl(self, p) -> float | None:
        h = self.height(p[0], p[2])
        if h is None:
            return None
        return p[1] - max(h, self.water if self.water is not None else -1e9)


def load_terrain(mod: str, level: str, game_dir: Path | None = None) -> Terrain:
    """The level's water plane (its viewer `scene.json`) and heightmap (the
    game install's archives, through the mod's `addModPath` chain, as the
    exporter reads them). Either may be missing; the statistics that need it
    say so."""
    water = None
    for scene in (VIEWER_MAPS / "mods" / mod / level / "scene.json", VIEWER_MAPS / level / "scene.json"):
        if scene.is_file():
            water = json.loads(scene.read_text()).get("waterLevel")
            break
    hm = None
    try:
        sys.path.insert(0, str(HERE.parent))
        from bf42.level import (borrowed_levels, decode_heightmap, find_level_archives,
                                load_level_files, parse_terrain_con, terrain_file)
        from extract_models import mod_chain
        game = game_dir or Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
        chain = mod_chain(game, mod)
        paths = find_level_archives(game, mod, level, chain=chain)
        files = load_level_files(paths, level)
        info = parse_terrain_con(files.read("Init/Terrain.con").decode("latin-1"))
        under = [p for other in borrowed_levels(info, level)
                 for p in find_level_archives(game, mod, other, chain=chain)]
        if under:
            files = load_level_files(paths, level, under)
        entry = terrain_file(files, info.heightmap_file, "Heightmap.raw")
        hm = decode_heightmap(files.read(entry), info.world_size, info.y_scale)
    except (Exception, SystemExit) as exc:      # a nicety: the rest still runs
        print(f"dc_truth: no heightmap for {mod}/{level} ({exc}); heights over ground left out",
              file=sys.stderr)
    return Terrain(water, hm)


def load_spawners(mod: str, level: str, mode: str = "SinglePlayer", game_dir: Path | None = None) -> list[dict]:
    """The layer's ObjectSpawner placements with their authored windows, from
    the game install (the co-op round plays `SinglePlayer/`). Empty when the
    install or the layer is missing."""
    try:
        sys.path.insert(0, str(HERE.parent))
        from bf42.level import find_level_archives, load_gameplay_objects, load_level_files
        from extract_models import mod_chain
        game = game_dir or Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
        files = load_level_files(find_level_archives(game, mod, level, chain=mod_chain(game, mod)), level)
        layer = load_gameplay_objects(files, mode)
    except (Exception, SystemExit) as exc:      # a nicety
        print(f"dc_truth: no spawners for {mod}/{level} ({exc})", file=sys.stderr)
        return []
    out = []
    for inst in layer.object_spawns:
        tmpl = layer.object_spawn_templates.get(inst.template.lower())
        if tmpl is None:
            continue
        window = tmpl.respawn_window()
        out.append({"spawner": inst.template, "pos": inst.position, "templates": dict(tmpl.vehicles),
                    "min": window[0] if window else None, "max": window[1] if window else None,
                    "ttl": tmpl.time_to_live, "distance": tmpl.distance})
    return out


# --- what a life is ---------------------------------------------------------------

# A helicopter's engine racks (Mi24DEngineRack1..3) and the Harrier's lift-jet
# racks (AV8Front/Middle/RearVTOLRack): the cyclic as the hull took it. The
# Harrier's exhaust racks are left out.
HELI_PART = re.compile(r"enginerack|hoverengine|vtolrack", re.I)
HARRIER = re.compile(r"^av-?8", re.I)
PLANE_PART = re.compile(r"flap|rudder|elevator|aileron|gearrot|wheel_back|airbrake|propeller", re.I)
# A car's steered wheels (HumveeFrontWheelL, DPVFrontWheelR): their turn about
# the hull's up axis is the steering as the hull took it. Recorded only while
# the physics drives the hull (a bot at AI LOD 0, or a human).
STEER_PART = re.compile(r"frontwheel", re.I)


def steer_at(life: Life, t: float) -> float | None:
    """The steered wheels' angle at `t`, degrees (the larger of left and
    right), from their recorded rotation against the hull."""
    best = None
    for part, name in life.parts.items():
        if not STEER_PART.search(name) or part not in life.turns:
            continue
        q = _turn_at(life.turns[part], t)
        if q is None:
            continue
        x = qrot(q, (1.0, 0.0, 0.0))
        ang = math.degrees(math.atan2(-x[2], x[0]))
        if best is None or abs(ang) > abs(best):
            best = ang
    return best


def vehicle_lives(rec: Recording) -> list[Life]:
    """Lives that are hulls: they have an engine, and they are not soldiers,
    cameras, kits or rounds."""
    return [lf for lf in rec.lives if lf.engines and not lf.soldier() and not lf.camera() and len(lf) > 1]


def classify(life: Life, sts: list[State], terrain: Terrain) -> str:
    """'heli', 'harrier', 'air', 'sea' or 'ground', from the life's own parts
    and what it did: airborne means 15 m over the ground (or over its first
    height, without a heightmap) for 3 s."""
    if HARRIER.match(life.tmpl):
        return "harrier"
    if any(HELI_PART.search(n) for n in life.parts.values()):
        return "heli"
    if any(PLANE_PART.search(n) for n in life.parts.values()):
        return "air"
    # Otherwise by what it did: 10 s high up and not plunging. A blast throws
    # a tank 100 m up for 5 s (a T-72 at 261 s of DC El Alamein), and a hull
    # that falls through the ground drops at its terminal speed for as long
    # as the file runs (a vanilla Sherman, 97 m/s for 28 s): neither flies.
    base = sts[0].p[1] if sts else 0.0
    high = 0.0
    for a, b in zip(sts, sts[1:]):
        ag = terrain.agl(a.p)
        up = ag if ag is not None else a.p[1] - base
        if up > 15 and a.v[1] > -40:
            high += min(b.t - a.t, MAX_GAP)
    if high >= 10:
        return "air"
    if terrain.water is not None and sts:
        wet = [s for s in sts if s.speed > 1 and abs(s.p[1] - terrain.water) < 2.5
               and (terrain.height(s.p[0], s.p[2]) or terrain.water) < terrain.water - 1]
        moving = [s for s in sts if s.speed > 1]
        if moving and len(wet) > 0.5 * len(moving):
            return "sea"
    return "ground"


# --- ground -----------------------------------------------------------------------

def held_runs(sts: list[State], ok) -> list[list[State]]:
    """Runs of consecutive states for which `ok(state)` holds, split at gaps."""
    runs, cur = [], []
    for s in sts:
        if ok(s) and (not cur or s.t - cur[-1].t <= MAX_GAP):
            cur.append(s)
        else:
            if len(cur) > 1:
                runs.append(cur)
            cur = [s] if ok(s) else []
    if len(cur) > 1:
        runs.append(cur)
    return runs


def bin_of(x: float, edges: list[float]) -> str:
    for lo, hi in zip(edges, edges[1:]):
        if lo <= x < hi:
            return f"{lo:g}-{hi:g}" if hi < 1e8 else f"{lo:g}+"
    return "?"


def _turn_at(tr: array, t: float):
    n = len(tr) // 5
    lo, hi = 0, n
    while lo < hi:
        mid = (lo + hi) // 2
        if tr[mid * 5] <= t:
            lo = mid + 1
        else:
            hi = mid
    if not lo:
        return None
    b = (lo - 1) * 5
    return tuple(tr[b + 1:b + 5])


class Agg(collections.defaultdict):
    """Lists of observations by name, per template."""

    def __init__(self):
        super().__init__(list)


def driver_lod(rec: Recording, life: Life, t: float) -> int | None:
    """The AI LOD of whoever sits in the driver's seat at `t` (AI-136): 0
    with a human near, 2 far from every one; None for no driver or a file
    that never says (a human driver has no LOD and reads 0)."""
    if life.seats is NO_SEATS:
        return None
    for s in life.seats:
        if s[1] == 0 and s[3] <= t < s[4]:
            rows = rec.lods.get(s[0])
            if not rows:
                return 0 if s[0] not in rec.bots else None
            row = latest(rows, t)
            return row[1] if row else None
    return None


def ground_life(life: Life, sts: list[State], terrain: Terrain, agg: Agg, keep=None) -> None:
    """A driven ground or sea hull's observations, added to its template's.
    `keep(state)` picks the moments counted (the driver's AI LOD, below)."""
    driven = [s for s in sts if driven_at(life, s.t) and (keep is None or keep(s))]
    if not driven:
        return
    agg["driven_s"].append(sum(min(b.t - a.t, MAX_GAP) for a, b in zip(driven, driven[1:])))
    for s in driven:
        a = terrain.agl(s.p)
        on_ground = (a is None or a < 1.5) and abs(s.v[1]) < 5
        if on_ground:
            agg["fwd"].append(s.fwd)
        if on_ground and abs(s.fwd) > 0.5:
            agg["yaw|" + bin_of(abs(s.fwd), GROUND_BINS)].append(abs(s.yaw_rate))
            sl = s.slip()
            if sl is not None and s.speed > 2:
                agg["slip|" + bin_of(s.speed, GROUND_BINS)].append(min(sl, 180 - sl) if s.fwd < 0 else sl)
        if a is not None and a > 1.5:
            agg["air_s"].append(1 / 30)
        up = qrot(s.q, (0.0, 1.0, 0.0))[1]
        agg["up"].append(up)
        if a is not None and a < -20:                    # through the ground
            agg["below_s"].append(1 / 30)
            agg["fall_vy"].append(s.v[1])
        if terrain.water is not None and s.p[1] < terrain.water - 0.3:
            agg["under_s"].append(1 / 30)
            agg["under_depth"].append(terrain.water - s.p[1])
            agg["under_speed"].append(s.speed)
    # A land hull's recorded engine is not its drive (a Humvee's reads 0
    # throttle and 0 revs at 22 m/s), so the input is not known: what the
    # bots got out of it is. On the level and on the ground, and never in
    # a blast's throw (a T-72 left the ground at 1,165 m/s up).
    level = held_runs(driven, lambda s: abs(s.pitch) < 3 and abs(s.v[1]) < 3 and
                      (terrain.agl(s.p) is None or terrain.agl(s.p) < 1.5))
    for run in level:
        agg["level_fwd"].extend(s.fwd for s in run)
        agg["top_held"].append(held_extreme(run, 3.0, lambda s: s.fwd))
        agg["reverse_held"].append(held_extreme(run, 1.5, lambda s: -s.fwd))
    # Where the engine is driven by the physics (LOD 0), its throttle servo is
    # the input: the speeds on the level with it full are the hull's top end
    # (a bot's drive law asks for at most 20 m/s, AI-45, so a car faster than
    # that is held there; a tank is not).
    for s in driven:
        if abs(s.pitch) > 2 or abs(s.v[1]) > 1 or (terrain.agl(s.p) or 0) > 1.5:
            continue
        th = throttle_at(life, s.t)
        if th is not None and th >= 0.95:
            agg["level_full"].append(s.fwd)
        elif th is not None and th <= -0.95:
            agg["level_full_back"].append(-s.fwd)
    # The steered wheels against the turn: yaw rate and slip by speed, kept
    # with the angle so the summary can pick full lock.
    if any(STEER_PART.search(n) for n in life.parts.values()):
        for s in driven:
            if abs(s.v[1]) > 3 or (terrain.agl(s.p) or 0) > 1.5 or s.fwd < 1:
                continue
            st = steer_at(life, s.t)
            if st is not None:
                agg["steer"].append((s.fwd, st, s.yaw_rate, s.slip() or 0.0))
    # From rest: the time to each speed, while the speed keeps climbing.
    i = 0
    while i < len(driven):
        s = driven[i]
        if s.speed < 0.5 and abs(s.pitch) < 4:
            hit, t0, j, top = {}, s.t, i + 1, 0.0
            while j < len(driven) and driven[j].t - driven[j - 1].t <= MAX_GAP and driven[j].t - t0 < 30 \
                    and driven[j].fwd > top - 1.0 and abs(driven[j].pitch) < 6 and abs(driven[j].v[1]) < 3:
                top = max(top, driven[j].fwd)
                for mark in (5, 10, 15, 20, 25, 30):
                    if mark not in hit and driven[j].fwd >= mark:
                        hit[mark] = driven[j].t - t0
                j += 1
            if hit:
                agg["accel_runs"].append(hit)
            i = j
        else:
            i += 1


def held_extreme(run: list[State], hold: float, value) -> float | None:
    """The largest value `value` stayed at or above for `hold` seconds of a
    run: the best of the windows' minima."""
    best = None
    j = 0
    window: collections.deque = collections.deque()      # indices, values increasing
    for i, s in enumerate(run):
        while window and value(run[window[-1]]) >= value(s):
            window.pop()
        window.append(i)
        while run[j].t < s.t - hold:
            j += 1
        while window[0] < j:
            window.popleft()
        if s.t - run[0].t >= hold:
            m = value(run[window[0]])
            best = m if best is None else max(best, m)
    return best


def summarise_ground(agg: Agg) -> dict:
    full = agg["level_full"] if len(agg["level_full"]) >= 30 else []
    full_back = agg["level_full_back"] if len(agg["level_full_back"]) >= 30 else []
    lock = {}
    if agg["steer"]:
        max_steer = max(abs(st) for _, st, _, _ in agg["steer"])
        if max_steer > 5:
            lock["max_steer_deg"] = r1(max_steer)
            by = collections.defaultdict(list)
            for fwd, st, yaw, slip in agg["steer"]:
                if abs(st) >= 0.9 * max_steer:
                    by[bin_of(fwd, GROUND_BINS)].append((abs(yaw), slip))
            lock["full_lock_by_speed"] = {
                b: {"n": len(v), "yaw_p50": r1(pct([y for y, _ in v], 0.5)), "yaw_max": r1(max(y for y, _ in v)),
                    "slip_p50": r1(pct([s for _, s in v], 0.5)), "slip_p95": r1(pct([s for _, s in v], 0.95)),
                    "over45": r1(sum(1 for _, s in v if s > 45) / len(v), 3)}
                for b, v in sorted(by.items(), key=lambda kv: _lo(kv[0]))}
    held = [x for x in agg["top_held"] if x is not None]
    back = [x for x in agg["reverse_held"] if x is not None and x > 0.3]
    out = {
        "driven_s": r1(sum(agg["driven_s"]), 0),
        # held 3 s on the level; the level ground's 99th percentile; the reverse held 1.5 s
        "top_speed": r1(max(held), 2) if held else None,
        "level_p99": r1(pct(agg["level_fwd"], 0.99), 2),
        "max_fwd": r1(max(agg["fwd"]) if agg["fwd"] else None, 2),
        "reverse_speed": r1(max(back), 2) if back else None,
        # the level at full throttle: the 99th percentile forward, the 95th back
        "top_full_throttle": r1(pct(full, 0.99), 2) if full else None,
        "top_full_throttle_n": len(agg["level_full"]),
        "reverse_full_throttle": r1(pct(full_back, 0.95), 2) if full_back else None,
        "accel_runs": len(agg["accel_runs"]),
        **lock,
    }
    for mark in (5, 10, 15, 20, 25, 30):
        times = [h[mark] for h in agg["accel_runs"] if mark in h]
        if times:
            out[f"t_to_{mark}"] = r1(pct(times, 0.5), 2)
            out[f"t_to_{mark}_best"] = r1(min(times), 2)
    out["yaw_rate_by_speed"] = {k.split("|")[1]: {"p50": r1(pct(v, 0.5)), "p95": r1(pct(v, 0.95)),
                                                  "max": r1(max(v)), "n": len(v)}
                                for k, v in sorted(agg.items(), key=_bin_key) if k.startswith("yaw|")}
    out["slip_by_speed"] = {k.split("|")[1]: {"p50": r1(pct(v, 0.5)), "p95": r1(pct(v, 0.95)),
                                              "over45": r1(sum(1 for x in v if x > 45) / len(v), 3), "n": len(v)}
                            for k, v in sorted(agg.items(), key=_bin_key) if k.startswith("slip|")}
    out["airborne_s"] = r1(sum(agg["air_s"]), 1)
    out["upside_down_s"] = r1(sum(1 for u in agg["up"] if u < 0) / 30, 1)
    if agg["below_s"]:
        out["below_ground_s"] = r1(sum(agg["below_s"]), 1)
        out["fall_speed_p50"] = r1(-pct(agg["fall_vy"], 0.5), 1)
    if agg["under_s"]:
        out["under_water_s"] = r1(sum(agg["under_s"]), 1)
        out["under_water_max_depth"] = r1(max(agg["under_depth"]), 2)
        out["under_water_p95_speed"] = r1(pct(agg["under_speed"], 0.95), 2)
    return out


def _bin_key(item):
    k = item[0]
    if "|" not in k:
        return (k, 0)
    lo = k.split("|")[1].split("-")[0].rstrip("+")
    try:
        return (k.split("|")[0], float(lo))
    except ValueError:
        return (k, 0)


# --- air --------------------------------------------------------------------------

def rack_rest(life: Life) -> dict[int, tuple]:
    """Each engine rack's rotation at rest. A rack sits square on its hull
    with the stick centred: its recorded rotation against the root is the
    identity (a Mi-24's racks read (+-0.0017, 0, 0, 1) at rest), and `j` is
    written only on change, so a count of records would weigh the motion."""
    return {part: (0.0, 0.0, 0.0, 1.0) for part, name in life.parts.items()
            if HELI_PART.search(name) and "dummy" not in name.lower() and part in life.turns}


def rack_deflection(life: Life, rest: dict, t: float) -> float | None:
    worst = None
    for part, q0 in rest.items():
        q = _turn_at(life.turns[part], t)
        if q is None:
            continue
        d = rot_angle(qmul(q, qconj(q0)))
        worst = d if worst is None else max(worst, d)
    return worst


def air_life(life: Life, sts: list[State], terrain: Terrain, agg: Agg, kind: str) -> None:
    """A flown aircraft's observations, added to its template's."""
    base = sts[0].p[1] if sts else 0.0
    flown = [s for s in sts if driven_at(life, s.t)]
    if not flown:
        return
    air = []
    was_low = True
    for s in flown:
        a = terrain.agl(s.p)
        up = a if a is not None else s.p[1] - base
        if up > 5:
            air.append(s)
            if was_low and up < 15:
                agg["liftoff_speed"].append(s.speed)
            was_low = False
        elif up < 1.5:
            was_low = True
        agg["agl"].append(up)
    if not air:
        return
    agg["air_s"].append(sum(min(b.t - a.t, MAX_GAP) for a, b in zip(air, air[1:])))
    # Level flight (climb or sink under 2 m/s, nose within 5 deg) for the
    # top speed, and the roll and pitch rates held for half a second.
    for run in held_runs(air, lambda s: True):
        agg["roll_held"].append(held_extreme(run, 0.5, lambda s: abs(s.rates[2])))
        agg["pitch_held"].append(held_extreme(run, 0.5, lambda s: abs(s.rates[0])))
        agg["level_held"].append(held_extreme(run, 3.0, lambda s: s.speed if abs(s.v[1]) < 2 and abs(s.pitch) < 5 else 0.0))
    for s in air:
        if abs(s.v[1]) < 2 and abs(s.pitch) < 5:
            agg["level_speed"].append(s.speed)
        agg["speed"].append(s.speed)
        agg["vy"].append(s.v[1])
        agg["pitch_rate"].append(abs(s.rates[0]))
        agg["yaw_rate"].append(abs(s.rates[1]))
        agg["roll_rate"].append(abs(s.rates[2]))
        agg["bank"].append(abs(s.roll))
        agg["speed|" + bin_of(s.speed, AIR_BINS)].append(1)
    if kind not in ("heli", "harrier"):
        return
    # A hover: off the ground, under 5 m/s across it and 3 m/s up or down.
    for s in air:
        if math.hypot(s.v[0], s.v[2]) < 5 and abs(s.v[1]) < 3:
            agg["hover_pitch"].append(s.pitch)
            agg["hover_bank"].append(s.roll)
            agg["hover_pitch_rate"].append(s.rates[0])
            agg["hover_rate"].append(math.sqrt(sum(r * r for r in s.rates)))
    # Hands off: every rack within HANDS_OFF degrees of square for a second
    # or more. What the turn rate does then is the damping question: it
    # decays if something damps it, holds if nothing does, grows under a
    # moment the racks are not making.
    rest = rack_rest(life)
    if not rest:
        return
    def centred(s):
        d = rack_deflection(life, rest, s.t)
        return d is not None and d < HANDS_OFF
    calm = held_runs(air, centred)
    for run in calm:
        if run[-1].t - run[0].t < 1.0:
            continue
        # Each axis's angular acceleration against its rate, a quarter second
        # apart: damping is a negative slope, a moment the racks are not
        # making is an offset.
        j = 0
        for i, s in enumerate(run):
            j = max(j, i + 1)
            while j < len(run) and run[j].t - s.t < SPEED_WINDOW:
                j += 1
            if j >= len(run):
                break
            dt = run[j].t - s.t
            for axis in range(3):
                agg[f"ho_pair|{axis}"].append((s.rates[axis], (run[j].rates[axis] - s.rates[axis]) / dt))
        w = [math.sqrt(sum(r * r for r in s.rates)) for s in run]
        marks = {}
        for s, ws in zip(run, w):
            for dt in (0.5, 1.0, 2.0, 4.0):
                if dt not in marks and s.t - run[0].t >= dt:
                    marks[dt] = ws
        agg["handsoff"].append({"t": r1(run[0].t, 2), "w0": r1(w[0]), "len": r1(run[-1].t - run[0].t, 2),
                                **{f"w{dt:g}": r1(x) for dt, x in marks.items()}, "wmax": r1(max(w)),
                                "axes0": [r1(x) for x in run[0].rates], "axes_end": [r1(x) for x in run[-1].rates],
                                "pitch": [r1(run[0].pitch), r1(run[-1].pitch)], "bank": [r1(run[0].roll), r1(run[-1].roll)],
                                "speed": [r1(run[0].speed), r1(run[-1].speed)], "vy": [r1(run[0].v[1]), r1(run[-1].v[1])],
                                "throttle": r1(throttle_at(life, run[0].t), 2)})


def summarise_air(agg: Agg) -> dict:
    out = {"air_s": r1(sum(agg["air_s"]), 0)}
    if agg["speed"]:
        out.update({
            "speed_p05": r1(pct(agg["speed"], 0.05)), "speed_p50": r1(pct(agg["speed"], 0.5)),
            "speed_p95": r1(pct(agg["speed"], 0.95)), "speed_max": r1(max(agg["speed"])),
            "climb_p95": r1(pct(agg["vy"], 0.95)), "climb_max": r1(max(agg["vy"])),
            "sink_p05": r1(pct(agg["vy"], 0.05)), "sink_min": r1(min(agg["vy"])),
            "pitch_rate_p95": r1(pct(agg["pitch_rate"], 0.95)), "roll_rate_p95": r1(pct(agg["roll_rate"], 0.95)),
            "yaw_rate_p95": r1(pct(agg["yaw_rate"], 0.95)), "bank_p95": r1(pct(agg["bank"], 0.95)),
            "agl_max": r1(max(agg["agl"]) if agg["agl"] else None, 0),
            "level_speed_p95": r1(pct(agg["level_speed"], 0.95)),
            "level_held_3s": r1(max([x for x in agg["level_held"] if x is not None] or [0.0])),
            "roll_rate_held_0.5s": r1(max([x for x in agg["roll_held"] if x is not None] or [0.0])),
            "pitch_rate_held_0.5s": r1(max([x for x in agg["pitch_held"] if x is not None] or [0.0])),
        })
    if agg["liftoff_speed"]:
        out["liftoff_speed_p50"] = r1(pct(agg["liftoff_speed"], 0.5))
    if agg["hover_pitch"]:
        out["hover_s"] = r1(len(agg["hover_pitch"]) / 30, 1)
        out["hover_pitch_p05_p50_p95"] = [r1(pct(agg["hover_pitch"], q)) for q in (0.05, 0.5, 0.95)]
        out["hover_bank_p05_p50_p95"] = [r1(pct(agg["hover_bank"], q)) for q in (0.05, 0.5, 0.95)]
        out["hover_pitch_rate_p05_p50_p95"] = [r1(pct(agg["hover_pitch_rate"], q)) for q in (0.05, 0.5, 0.95)]
        out["hover_rate_p95"] = r1(pct(agg["hover_rate"], 0.95))
    ho = agg["handsoff"]
    if ho:
        # From a real turn (5 deg/s or more): the rate a second on over the rate then.
        ratios = [h["w1"] / h["w0"] for h in ho if "w1" in h and h["w0"] >= 5]
        out["handsoff_runs"] = len(ho)
        out["handsoff_s"] = r1(sum(h["len"] for h in ho), 1)
        out["handsoff_decay_runs"] = len(ratios)
        out["handsoff_w1_over_w0_p50"] = r1(pct(ratios, 0.5), 3) if ratios else None
        out["handsoff_samples"] = sorted(ho, key=lambda h: -h["len"])[:8]
        out["handsoff_fit"] = {}
        for axis, name in enumerate(("pitch", "yaw", "roll")):
            pairs = agg[f"ho_pair|{axis}"]
            fit = line_fit(pairs)
            if fit:
                out["handsoff_fit"][name] = {"slope_per_s": r1(fit[0], 3), "offset_deg_s2": r1(fit[1], 2),
                                             "r": r1(fit[2], 3), "n": len(pairs),
                                             "rate_p95": r1(pct([abs(w) for w, _ in pairs], 0.95))}
    return out


def line_fit(pairs):
    """Least-squares y = a x + b over (x, y) pairs: (a, b, r), None if flat."""
    n = len(pairs)
    if n < 10:
        return None
    mx = sum(x for x, _ in pairs) / n
    my = sum(y for _, y in pairs) / n
    sxx = sum((x - mx) ** 2 for x, _ in pairs)
    syy = sum((y - my) ** 2 for _, y in pairs)
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    if sxx <= 1e-9:
        return None
    a = sxy / sxx
    return a, my - a * mx, (sxy / math.sqrt(sxx * syy)) if syy > 1e-12 else 0.0


# --- rounds -----------------------------------------------------------------------

def _solve3(m, b):
    """`m x = b` for a 3x3 system (Cramer); None when singular."""
    def det(a):
        return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    d = det(m)
    if abs(d) < 1e-12:
        return None
    out = []
    for c in range(3):
        mc = [row[:] for row in m]
        for r in range(3):
            mc[r][c] = b[r]
        out.append(det(mc) / d)
    return out


def quad_fit(ts, xs):
    """Least-squares x(t) = c0 + c1 t + c2 t^2; returns (c0, c1, c2)."""
    s = [sum(t ** k for t in ts) for k in range(5)]
    m = [[s[0], s[1], s[2]], [s[1], s[2], s[3]], [s[2], s[3], s[4]]]
    b = [sum(x * t ** k for t, x in zip(ts, xs)) for k in range(3)]
    return _solve3(m, b)


def round_flight(rd: dict) -> dict | None:
    """One round's flight: launch speed, speeds along the way, the
    acceleration along its first path and the gravity across it, the turn of
    its heading, and its range."""
    tr = rd["track"]
    n = len(tr) // 4
    if n < 3:
        return None
    T = [tr[i * 4] for i in range(n)]
    P = [tuple(tr[i * 4 + 1:i * 4 + 4]) for i in range(n)]
    t0 = T[0]
    # A bounce or a hit ends the free flight: the first step whose velocity
    # jumps by more than a fifth (and 5 m/s) from the step before.
    cut = n
    prev = None
    for i in range(1, n):
        dt = T[i] - T[i - 1]
        if dt <= 0:
            continue
        v = tuple((P[i][k] - P[i - 1][k]) / dt for k in range(3))
        if prev is not None and math.dist(v, prev) > max(5.0, 0.2 * math.sqrt(sum(c * c for c in prev))):
            cut = i
            break
        prev = v
    if cut < 3:
        return None
    n = cut
    T, P = T[:n], P[:n]

    def vel(i, j):
        dt = T[j] - T[i]
        return tuple((P[j][k] - P[i][k]) / dt for k in range(3)) if dt > 0 else None

    v0 = vel(0, min(2, n - 1))
    if v0 is None:
        return None
    sp = lambda v: math.sqrt(sum(c * c for c in v))
    life = (rd["t1"] if rd["t1"] is not None else tr[-4]) - t0
    out = {"t": t0, "n": n, "dur": T[-1] - t0, "life": life, "v0": sp(v0),
           "range": math.hypot(P[-1][0] - P[0][0], P[-1][2] - P[0][2]),
           "rise": max(p[1] for p in P) - P[0][1], "p0": P[0], "end": P[-1]}
    speeds = {}
    for tau in (0.5, 1, 2, 3, 5, 8):
        i = bisect.bisect_left(T, t0 + tau)
        if i + 2 < n and T[i] - (t0 + tau) < 0.1:
            speeds[tau] = sp(vel(i, i + 2))
    out["speeds"] = speeds
    # The fit over the first three seconds (a rocket's motor, a shell's arc).
    idx = [i for i in range(n) if T[i] - t0 <= 3.0]
    if len(idx) >= 6 and T[idx[-1]] - t0 >= 0.3:
        ts = [T[i] - t0 for i in idx]
        fits = [quad_fit(ts, [P[i][k] for i in idx]) for k in range(3)]
        if all(fits):
            a = [2 * f[2] for f in fits]
            v = [f[1] for f in fits]
            vs = sp(v)
            if vs > 1:
                u = [c / vs for c in v]
                a_tan = sum(a[k] * u[k] for k in range(3))
                perp = [a[k] - a_tan * u[k] for k in range(3)]
                out["a_tan"] = a_tan
                out["elev"] = math.degrees(math.asin(max(-1, min(1, u[1]))))
                if 1 - u[1] ** 2 > 0.05:
                    out["g_eff"] = -perp[1] / (1 - u[1] ** 2)
                out["a_side"] = math.hypot(perp[0], perp[2]) if abs(u[1]) < 0.9 else None
    # How far the heading turns, first quarter second to the last.
    if n >= 8:
        va, vb = vel(0, 3), vel(n - 4, n - 1)
        if va and vb and math.hypot(va[0], va[2]) > 1 and math.hypot(vb[0], vb[2]) > 1:
            out["turn"] = abs(wrap180(math.degrees(math.atan2(vb[0], vb[2]) - math.atan2(va[0], va[2]))))
    return out


def _summarise_flights(by_tmpl: dict[str, list]) -> dict:
    """Per projectile template: what fired it, how fast it left, how it flew.
    The shot that made a round is the nearest `f` at most a tick and a half
    before its first place, within 20 m of it (`_flights`)."""
    out = {}
    for tmpl, fls in sorted(by_tmpl.items()):
        row = {"flights": len(fls), "weapons": dict(collections.Counter(f["weapon"] for f in fls).most_common(4)),
               "v0_p50": r1(pct([f["v0"] for f in fls], 0.5)), "v0_max": r1(max(f["v0"] for f in fls)),
               "dur_p50": r1(pct([f["dur"] for f in fls], 0.5), 2), "dur_max": r1(max(f["dur"] for f in fls), 2),
               "life_p50": r1(pct([f["life"] for f in fls], 0.5), 2),
               "range_max": r1(max(f["range"] for f in fls), 0), "rise_max": r1(max(f["rise"] for f in fls), 1)}
        for tau in (0.5, 1, 2, 3, 5, 8):
            vs = [f["speeds"][tau] for f in fls if tau in f["speeds"]]
            if len(vs) >= 2 or (vs and len(fls) == 1):
                row[f"speed_{tau:g}s"] = r1(pct(vs, 0.5))
        for key in ("a_tan", "g_eff", "a_side", "elev", "turn"):
            vs = [f[key] for f in fls if f.get(key) is not None]
            if vs:
                row[f"{key}_p50"] = r1(pct(vs, 0.5), 2)
                if key in ("turn", "a_side"):
                    row[f"{key}_p95"] = r1(pct(vs, 0.95), 2)
        out[tmpl] = row
    return out


# --- pads, crews, bots ----------------------------------------------------------

def hp_at_end(life: Life) -> float | None:
    return life.hp[-1][1] if life.hp else None


def cp_team_at(cp: dict, t: float):
    team = None
    for ct, tm in cp["changes"]:
        if ct <= t + 1e-6:
            team = tm
    return team


def death_time(life: Life) -> float | None:
    """When its hit points first reached 0: the hull's destruction. The
    object lives on as the wreck until the server destroys it."""
    return next((t for t, hp in life.hp if hp <= 0), None)


def abandon_drain(life: Life) -> dict | None:
    """The abandoned-vehicle clock, as it shows: nobody aboard, then hit
    points falling at a steady rate from the first drop to 0 with no seat
    taken. Returns the idle time from the last exit (or the spawn) to the
    first drop, and the rate."""
    dead = death_time(life)
    if dead is None:
        return None
    last_out = max((s[4] for s in life.seats if s[4] <= dead + 0.1), default=None)
    if any(s[3] <= dead <= s[4] for s in life.seats):
        return None                                      # someone was aboard when it died
    since = last_out if last_out is not None else life.born
    idx = [i for i, (t, _) in enumerate(life.hp) if since < t <= dead]
    # The drain: from the first fall, every record lower than the one before.
    start = None
    for i in idx:
        prev = life.hp[i - 1][1] if i else life.maxhp
        if life.hp[i][1] < prev:
            if start is None:
                start = i
        else:
            start = None                                 # held or repaired: look again
    if start is None or idx[-1] - start < 2:
        return None
    t0, h0 = life.hp[start]
    t1, h1 = life.hp[idx[-1]]
    if t1 - t0 <= 0:
        return None
    return {"idle": t0 - since, "rate": (h0 - h1) / (t1 - t0), "used": last_out is not None,
            "t_drop": t0, "hp0": h0}


def pad_stats(rec: Recording, vehicles: list[Life], spawners: list[dict] | None = None) -> dict:
    """Spawner pads, read back from where hulls first stood: what spawned on
    each for which side; the wait from a hull's destruction (hit points 0)
    and from its wreck's removal to its pad's next hull; how long a wreck
    stands; and the abandoned-vehicle clock."""
    soldiers = [lf for lf in rec.lives if lf.soldier() and len(lf)]
    pads: list[dict] = []
    for life in sorted(vehicles, key=lambda lf: lf.born):
        p = tuple(life.track[1:4])
        for pad in pads:
            if math.dist(pad["pos"], p) < 3.0:
                pad["lives"].append(life)
                break
        else:
            pads.append({"pos": p, "lives": [life]})
    cps = [cp for cp in rec.cps.values() if cp.get("pos")]
    from_death = collections.defaultdict(list)
    from_end = collections.defaultdict(list)
    abandoned = collections.defaultdict(list)
    wrecks = collections.defaultdict(list)
    for lf in vehicles:
        dead = death_time(lf)
        if lf.end_kind == "destroyed" and dead is not None:
            wrecks[lf.tmpl].append(lf.ended - dead)
    sides = []
    respawns = []
    for pad in pads:
        near = min(cps, key=lambda cp: math.hypot(cp["pos"][0] - pad["pos"][0], cp["pos"][2] - pad["pos"][2]),
                   default=None)
        authored = min(spawners or [], default=None,
                       key=lambda s: math.hypot(s["pos"][0] - pad["pos"][0], s["pos"][2] - pad["pos"][2]))
        if authored is not None and math.hypot(authored["pos"][0] - pad["pos"][0],
                                               authored["pos"][2] - pad["pos"][2]) > 6:
            authored = None
        lives = pad["lives"]
        seen = collections.defaultdict(set)
        for a, b in zip(lives, lives[1:]):
            if a.end_kind == "destroyed" and b.born >= a.ended - 0.05:
                from_end[b.tmpl].append(b.born - a.ended)
                dead = death_time(a)
                if dead is not None:
                    from_death[b.tmpl].append(b.born - dead)
                    row = {"tmpl": b.tmpl, "after": a.tmpl, "dead": r1(dead, 1), "delay": r1(b.born - dead, 2),
                           "wreck": r1(a.ended - dead, 1), "prev_born": r1(a.born, 1)}
                    if authored and authored["min"] is not None:
                        lo, hi = authored["min"], authored["max"]
                        row.update(spawner=authored["spawner"], window=[lo, hi],
                                   fill=r1((hi - (b.born - dead)) / (hi - lo), 3) if hi > lo else None)
                    respawns.append(row)
        for lf in lives:
            if near is not None and lf.born > 0:
                seen[cp_team_at(near, lf.born)].add(lf.tmpl)
            drain = abandon_drain(lf)
            if drain is not None:
                p = _pos_at(lf, drain["t_drop"])
                abandoned[lf.tmpl].append({
                    "t": r1(drain["t_drop"], 1), "idle": r1(drain["idle"], 1), "rate": r1(drain["rate"], 2),
                    "used": drain["used"], "from_pad": r1(math.dist(p, pad["pos"]), 0) if p else None,
                    "nearest_soldier": r1(_nearest(soldiers, p, drain["t_drop"]), 0) if p else None,
                })
        if near is not None and len(seen) > 1:
            sides.append({"cp": near["name"], "pad": [r1(c, 0) for c in pad["pos"]],
                          "by_team": {str(k): sorted(v) for k, v in seen.items()}})

    def spread(v):
        return {"n": len(v), "min": r1(min(v)), "p50": r1(pct(v, 0.5)), "max": r1(max(v))}
    return {
        "pads": len(pads),
        "respawn_from_death": {t: spread(v) for t, v in sorted(from_death.items())},
        "respawn_from_wreck_end": {t: spread(v) for t, v in sorted(from_end.items())},
        "respawns": sorted(respawns, key=lambda r: r["dead"]),
        "team_switch": sides,
        "abandoned": {t: v for t, v in sorted(abandoned.items())},
        "wreck_life": {t: {"n": len(v), "min": r1(min(v), 2), "max": r1(max(v), 2)} for t, v in sorted(wrecks.items())},
    }


def _pos_at(life: Life, t: float):
    tr = life.track
    n = len(tr) // 8
    lo, hi = 0, n
    while lo < hi:
        mid = (lo + hi) // 2
        if tr[mid * 8] <= t:
            lo = mid + 1
        else:
            hi = mid
    if not n:
        return None
    b = max(0, lo - 1) * 8
    return tuple(tr[b + 1:b + 4])


def _nearest(soldiers: list[Life], p, t: float) -> float | None:
    best = None
    for s in soldiers:
        if s.born <= t <= (s.ended or 1e18):
            q = _pos_at(s, t)
            if q is not None:
                d = math.dist(p, q)
                best = d if best is None else min(best, d)
    return best


def crew_stats(rec: Recording, vehicles: list[Life]) -> dict:
    """Which hulls the bots used: lives, lives entered, seconds in the driver's
    seat and in the others, and how many bots."""
    out = {}
    by = collections.defaultdict(list)
    for lf in vehicles:
        by[lf.tmpl].append(lf)
    for tmpl, lives in sorted(by.items()):
        drive = sum(s[4] - s[3] for lf in lives for s in lf.seats if s[1] == 0)
        ride = sum(s[4] - s[3] for lf in lives for s in lf.seats if s[1] != 0)
        out[tmpl] = {"lives": len(lives), "entered": sum(1 for lf in lives if lf.seats),
                     "driver_s": r1(drive, 0), "other_seats_s": r1(ride, 0),
                     "seats_used": sorted({s[1] for lf in lives for s in lf.seats}),
                     "players": len({s[0] for lf in lives for s in lf.seats})}
    return out


def bot_mobility(rec: Recording) -> dict:
    """How far each soldier life got from where it began: a bot that never
    got 20 m away and never boarded stood still all its life."""
    lives = [lf for lf in rec.lives if lf.soldier() and len(lf) >= 2 and (lf.ended - lf.born) >= 30]
    still = 0
    far = []
    for lf in lives:
        tr = lf.track
        p0 = tr[1:4]
        reach = max(math.dist(p0, tr[i + 1:i + 4]) for i in range(0, len(tr), 8))
        far.append(reach)
        if reach < 20 and id(lf) not in rec.left_map:      # `d`: he boarded something
            still += 1
    return {"soldier_lives_30s": len(lives), "never_20m": still,
            "reach_p50": r1(pct(far, 0.5), 0)}


# --- the whole of it --------------------------------------------------------------

def recordings_in(target: Path) -> list[Path]:
    """A run directory's server recordings, or the files named."""
    if target.is_dir():
        found = sorted((target / "server").glob("replay_*.ndjson*")) or sorted(target.glob("replay_*.ndjson*"))
        return found
    return [target]


def analyse(paths: list[Path], mod: str = "desertcombat", game_dir: Path | None = None,
            terrain: Terrain | None = None) -> dict:
    """Every statistic over every recording given, per template; the runs'
    own facts (level, length, pads, crews) per file."""
    life_aggs: dict[str, list[tuple[str, Agg]]] = collections.defaultdict(list)
    flights: dict[str, list] = collections.defaultdict(list)
    files = []
    for path in paths:
        rec = read_recording(path)
        ter = terrain if terrain is not None else load_terrain(mod, rec.level, game_dir)
        # The authored windows need the install; a caller that brings its own
        # terrain (the tests) brings no install either.
        spawners = load_spawners(mod, rec.level, game_dir=game_dir) if terrain is None else []
        vehicles = vehicle_lives(rec)
        for life in vehicles:
            sts = states(life)
            kind = classify(life, sts, ter)
            if kind in ("ground", "sea"):
                # A bot far from every human drives at AI LOD 2, where its hull
                # is moved by the AI, not the physics (AI-136): straight lines
                # at 0.6 of its AI maxSpeed. Its numbers are kept apart.
                agg, mover = Agg(), Agg()
                ground_life(life, sts, ter, agg, keep=lambda s: driver_lod(rec, life, s.t) == 0)
                ground_life(life, sts, ter, mover, keep=lambda s: (driver_lod(rec, life, s.t) or 0) > 0)
                life_aggs[life.tmpl].append((kind, agg))
                life_aggs[life.tmpl + LOD2].append((kind, mover))
            else:
                agg = Agg()
                air_life(life, sts, ter, agg, kind)
                life_aggs[life.tmpl].append((kind, agg))
        for tmpl, row in _flights(rec).items():
            flights[tmpl].extend(row)
        status = [(r1(t, 1), s) for t, s in rec.status]
        files.append({
            "file": path.name, "level": rec.level, "mode": rec.mode, "seconds": r1(rec.duration, 0),
            "header": rec.header.get("plus"), "skipped": rec.skipped, "bots": len(rec.bots),
            "status": status, "tickets": [rec.tickets[0][1:], rec.tickets[-1][1:]] if rec.tickets else None,
            "heightmap": ter.hm is not None, "water": ter.water,
            "crews": crew_stats(rec, vehicles), "pads": pad_stats(rec, vehicles, spawners),
            "bots_moving": bot_mobility(rec),
        })
    out = {"files": files, "ground": {}, "sea": {}, "ground_lod2": {}, "sea_lod2": {}, "air": {}}
    for tmpl, rows in sorted(life_aggs.items()):
        kinds = collections.Counter(k for k, _ in rows)
        kind = next((k for k in ("heli", "harrier", "air") if kinds[k]), None) or kinds.most_common(1)[0][0]
        merged = Agg()
        for k, agg in rows:
            if k == kind or (kind in ("ground", "sea") and k in ("ground", "sea")):
                for key, vals in agg.items():
                    merged[key].extend(vals)
        if kind in ("ground", "sea"):
            if merged["driven_s"] and sum(merged["driven_s"]) > 0:
                lod2 = tmpl.endswith(LOD2)
                table = ("sea" if kind == "sea" else "ground") + ("_lod2" if lod2 else "")
                out[table][tmpl.removesuffix(LOD2)] = summarise_ground(merged)
        elif merged["air_s"]:
            out["air"][tmpl] = {"kind": kind, **summarise_air(merged)}
    out["rounds"] = _summarise_flights(flights)
    return out


def _flights(rec: Recording) -> dict[str, list]:
    by = collections.defaultdict(list)
    fires = sorted(rec.fires)
    ftimes = [f[0] for f in fires]
    for rd in rec.rounds.values():
        fl = round_flight(rd)
        if fl is None:
            continue
        lo = bisect.bisect_left(ftimes, fl["t"] - 0.06)
        hi = bisect.bisect_right(ftimes, fl["t"] + 0.001)
        best = None
        for f in fires[lo:hi]:
            if len(f[4]) == 3:
                # A fast round is a tick's flight from the muzzle when first seen.
                d = math.dist(f[4], fl["p0"]) - fl["v0"] * max(0.0, fl["t"] - f[0] + 1 / 30)
                if d < 20 and (best is None or d < best[0]):
                    best = (d, f[3])
        fl["weapon"] = best[1] if best else None
        by[rd["tmpl"]].append(fl)
    return by


# --- writing it down ----------------------------------------------------------------

def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:g}"
    if isinstance(v, dict):
        return ", ".join(f"{k} {n}" for k, n in v.items())
    return str(v)


def _table(head: list[str], rows: list[list]) -> list[str]:
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(_cell(c) for c in row) + " |" for row in rows]
    return out


def markdown(res: dict) -> str:
    """The tables `features/desert-combat-parity/lab-ground-truth.md` quotes."""
    md = ["## Runs", ""]
    md += _table(["file", "level", "s", "bots", "tickets start / end", "heightmap"],
                 [[f["file"], f["level"], f["seconds"], f["bots"],
                   " / ".join("-".join(map(str, x)) for x in f["tickets"]) if f["tickets"] else "",
                   "yes" if f["heightmap"] else "no"] for f in res["files"]])
    md += ["", "## What the bots used (driver seconds, other seats, players)", ""]
    crews = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    for f in res["files"]:
        for t, c in f["crews"].items():
            row = crews[t]
            row[0] += c["lives"]; row[1] += c["entered"]; row[2] += c["driver_s"] or 0
            row[3] += c["other_seats_s"] or 0; row[4] += c["players"]
    md += _table(["template", "lives", "entered", "driver s", "other seats s", "players"],
                 [[t, *v] for t, v in sorted(crews.items(), key=lambda kv: -kv[1][2]) if v[1]])
    titles = {"ground": "Ground, driven by a human or a bot at AI LOD 0 (physics)",
              "sea": "Sea, driven by a human or a bot at AI LOD 0 (physics)",
              "ground_lod2": "Ground, driven by a bot at AI LOD 1-2 (the AI moves the hull, AI-136)",
              "sea_lod2": "Sea, driven by a bot at AI LOD 1-2 (the AI moves the hull, AI-136)"}
    for kind in ("ground", "sea", "ground_lod2", "sea_lod2"):
        if not res.get(kind):
            continue
        md += ["", f"## {titles[kind]}: speed (m/s), acceleration (s), yaw rate (deg/s, p95) by forward speed", ""]
        bins = ["5-10", "10-15", "15-20", "20-25", "25-30", "30-40", "40+"]
        md += _table(["template", "driven s", "top held 3 s", "level, full throttle p99", "max fwd", "reverse",
                      "level, full reverse p95", "t to 5", "t to 10", "t to 15",
                      *[f"yaw {b}" for b in bins], "slip>45 at 10+"],
                     [[t, g["driven_s"], g["top_speed"], g.get("top_full_throttle"), g["max_fwd"], g["reverse_speed"],
                       g.get("reverse_full_throttle"), g.get("t_to_5"), g.get("t_to_10"), g.get("t_to_15"),
                       *[g["yaw_rate_by_speed"].get(b, {}).get("p95") for b in bins],
                       _over45(g)] for t, g in res[kind].items()])
        locks = [(t, g) for t, g in res[kind].items() if g.get("full_lock_by_speed")]
        if locks:
            md += ["", "At full lock (the steered wheels within 90% of the most they turned): yaw rate p50 / max"
                   " (deg/s) and slip p50 / p95 (deg) by forward speed (m/s); `n` samples", ""]
            lbins = ["1-2", "2-5", "5-10", "10-15", "15-20", "20-25", "25-30"]
            md += _table(["template", "max steer deg", *lbins],
                         [[t, g["max_steer_deg"],
                           *[(lambda c: f"{c['yaw_p50']}/{c['yaw_max']}, {c['slip_p50']}/{c['slip_p95']} ({c['n']})"
                              if c else "")(g["full_lock_by_speed"].get(b)) for b in lbins]]
                          for t, g in locks])
    if res["air"]:
        md += ["", "## Air: speed (m/s), climb and sink (m/s), body rates (deg/s, p95)", ""]
        md += _table(["template", "kind", "air s", "speed p05", "p50", "p95", "max", "level p95", "level held 3 s",
                      "climb p95", "climb max", "sink p05", "pitch p95", "roll p95", "yaw p95", "roll held 0.5 s",
                      "pitch held 0.5 s", "bank p95", "lift-off"],
                     [[t, a["kind"], a["air_s"], a.get("speed_p05"), a.get("speed_p50"), a.get("speed_p95"),
                       a.get("speed_max"), a.get("level_speed_p95"), a.get("level_held_3s"), a.get("climb_p95"),
                       a.get("climb_max"), a.get("sink_p05"), a.get("pitch_rate_p95"), a.get("roll_rate_p95"),
                       a.get("yaw_rate_p95"), a.get("roll_rate_held_0.5s"), a.get("pitch_rate_held_0.5s"),
                       a.get("bank_p95"), a.get("liftoff_speed_p50")]
                      for t, a in res["air"].items()])
        ho = [(t, a) for t, a in res["air"].items() if a.get("handsoff_runs")]
        if ho:
            md += ["", "Helicopters with every engine rack within "
                   f"{HANDS_OFF:g} deg of square (the stick centred): the turn rate's change against the rate,"
                   " per axis (slope per second; offset deg/s2)", ""]
            md += _table(["template", "runs", "s", "pitch slope", "pitch offset", "pitch rate p95", "roll slope",
                          "roll rate p95", "yaw slope", "yaw rate p95", "w(1 s)/w0 from 5 deg/s+"],
                         [[t, a["handsoff_runs"], a["handsoff_s"],
                           a["handsoff_fit"].get("pitch", {}).get("slope_per_s"),
                           a["handsoff_fit"].get("pitch", {}).get("offset_deg_s2"),
                           a["handsoff_fit"].get("pitch", {}).get("rate_p95"),
                           a["handsoff_fit"].get("roll", {}).get("slope_per_s"),
                           a["handsoff_fit"].get("roll", {}).get("rate_p95"),
                           a["handsoff_fit"].get("yaw", {}).get("slope_per_s"),
                           a["handsoff_fit"].get("yaw", {}).get("rate_p95"),
                           f"{a['handsoff_w1_over_w0_p50']} ({a['handsoff_decay_runs']})"] for t, a in ho])
    if res["rounds"]:
        md += ["", "## Rounds: launch and later speeds (m/s), acceleration along the path and gravity across it (m/s2)", ""]
        md += _table(["template", "flights", "fired by", "v0", "0.5 s", "1 s", "2 s", "3 s", "5 s", "a along",
                      "g across", "turn p95", "range max", "free flight p50", "life p50"],
                     [[t, r["flights"], r["weapons"], r["v0_p50"], r.get("speed_0.5s"), r.get("speed_1s"),
                       r.get("speed_2s"), r.get("speed_3s"), r.get("speed_5s"), r.get("a_tan_p50"),
                       r.get("g_eff_p50"), r.get("turn_p95"), r["range_max"], r["dur_p50"], r["life_p50"]]
                      for t, r in res["rounds"].items()])
    md += ["", "## Pads", ""]
    for f in res["files"]:
        pads = f["pads"]
        md += [f"`{f['file']}` ({f['level']}): {pads['pads']} pads.", ""]
        wl = pads["wreck_life"]
        rows = []
        for t in sorted(set(pads["respawn_from_death"]) | set(pads["respawn_from_wreck_end"]) | set(wl)):
            d, e, w = pads["respawn_from_death"].get(t, {}), pads["respawn_from_wreck_end"].get(t, {}), wl.get(t, {})
            rows.append([t, f"{w.get('min', '')}-{w.get('max', '')} ({w.get('n', 0)})" if w else "",
                         f"{d.get('min')}-{d.get('max')} ({d.get('n')})" if d else "",
                         f"{e.get('min')}-{e.get('max')} ({e.get('n')})" if e else ""])
        if rows:
            md += _table(["template", "wreck stands s (n)", "respawn after destruction s (n)",
                          "respawn after wreck removed s (n)"], rows)
            md += [""]
        rs = [r for r in pads.get("respawns", []) if r.get("window")]
        if rs:
            md += ["Each respawn against its spawner's authored window: `fill` is (max - delay) / (max - min),"
                   " 0 at the maximum, 1 at the minimum.", ""]
            md += _table(["template", "after", "spawner", "window s", "destroyed at s", "delay s", "fill",
                          "previous hull spawned at s"],
                         [[r["tmpl"], r["after"], r["spawner"], f"{r['window'][0]:g}-{r['window'][1]:g}", r["dead"],
                           r["delay"], r.get("fill"), r["prev_born"]] for r in rs])
            md += [""]
        for sw in pads["team_switch"]:
            md += [f"- pad at {sw['pad']} by `{sw['cp']}`: " +
                   "; ".join(f"team {k}: {', '.join(v)}" for k, v in sw["by_team"].items())]
        ab = pads["abandoned"]
        if ab:
            md += ["", "Unmanned hulls whose hit points drained to 0 (the abandoned-vehicle clock):", ""]
            md += _table(["template", "t", "idle s before the drain", "drain hp/s", "used", "from pad m",
                          "nearest soldier m"],
                         [[t, x["t"], x["idle"], x["rate"], x["used"], x["from_pad"], x["nearest_soldier"]]
                          for t, v in ab.items() for x in v])
        md += [""]
    return "\n".join(md) + "\n"


def _over45(g: dict) -> str:
    rows = [v for k, v in g["slip_by_speed"].items() if _lo(k) >= 10]
    n = sum(v["n"] for v in rows)
    if not n:
        return ""
    return f"{sum(v['over45'] * v['n'] for v in rows) / n:.3f}"


def _lo(k: str) -> float:
    try:
        return float(k.split("-")[0].rstrip("+"))
    except ValueError:
        return 0.0


COMPACT_GROUND = ("driven_s", "top_speed", "level_p99", "max_fwd", "reverse_speed", "t_to_5", "t_to_10",
                  "t_to_15", "under_water_s", "under_water_max_depth", "below_ground_s", "fall_speed_p50",
                  "top_full_throttle", "reverse_full_throttle", "max_steer_deg", "full_lock_by_speed")
COMPACT_AIR = ("kind", "air_s", "speed_p05", "speed_p50", "speed_p95", "speed_max", "level_speed_p95",
               "level_held_3s", "climb_p95", "climb_max", "sink_p05", "pitch_rate_p95", "roll_rate_p95",
               "yaw_rate_p95", "roll_rate_held_0.5s", "pitch_rate_held_0.5s", "bank_p95", "liftoff_speed_p50",
               "handsoff_runs", "handsoff_s", "handsoff_fit", "handsoff_decay_runs", "handsoff_w1_over_w0_p50",
               "hover_s", "hover_pitch_p05_p50_p95", "hover_bank_p05_p50_p95", "hover_pitch_rate_p05_p50_p95",
               "hover_rate_p95")


def compact(res: dict) -> dict:
    """The numbers a port is checked against, without the per-sample lists:
    per template, and per run its length, crews and pad laws."""
    def pick(d, keys):
        return {k: d[k] for k in keys if d.get(k) is not None}
    out = {"runs": [], "ground": {}, "sea": {}, "ground_lod2": {}, "sea_lod2": {}, "air": {}, "rounds": {}}
    for f in res["files"]:
        pads = f["pads"]
        out["runs"].append({
            "file": f["file"], "level": f["level"], "seconds": f["seconds"], "bots": f["bots"],
            "tickets": f["tickets"], "bots_moving": f["bots_moving"],
            "crews": {t: [c["entered"], c["driver_s"], c["other_seats_s"]] for t, c in f["crews"].items() if c["entered"]},
            "wreck_life": pads["wreck_life"],
            "respawns": [{k: r[k] for k in ("tmpl", "spawner", "window", "delay", "fill", "prev_born") if k in r}
                         for r in pads.get("respawns", [])],
            "abandon_drains": {t: [[x["idle"], x["rate"]] for x in v] for t, v in pads["abandoned"].items()},
            "team_switch": pads["team_switch"],
        })
    for kind in ("ground", "sea", "ground_lod2", "sea_lod2"):
        keys = COMPACT_GROUND
        for t, g in res[kind].items():
            row = pick(g, keys)
            row["yaw_p95_by_speed"] = {b: v["p95"] for b, v in g["yaw_rate_by_speed"].items()}
            row["slip_over45_by_speed"] = {b: v["over45"] for b, v in g["slip_by_speed"].items()}
            out[kind][t] = row
    for t, a in res["air"].items():
        out["air"][t] = pick(a, COMPACT_AIR)
    for t, r in res["rounds"].items():
        out["rounds"][t] = {k: v for k, v in r.items()}
    return out


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("targets", nargs="+", type=Path, help="run directories or server recordings")
    ap.add_argument("--mod", default="desertcombat", help="the mod whose level archives hold the heightmap")
    ap.add_argument("--game-dir", type=Path, default=None)
    ap.add_argument("--json", type=Path, help="write the statistics as JSON here")
    ap.add_argument("--compact", type=Path, help="write the compact JSON (no per-sample lists) here")
    ap.add_argument("--md", type=Path, help="write the markdown tables here")
    a = ap.parse_args(argv)
    paths = [p for t in a.targets for p in recordings_in(t)]
    if not paths:
        sys.exit("no server recording found")
    res = analyse(paths, a.mod, a.game_dir)
    if a.json:
        a.json.write_text(json.dumps(res, indent=1) + "\n")
    if a.compact:
        a.compact.write_text(json.dumps(compact(res), indent=1, sort_keys=True) + "\n")
    text = markdown(res)
    if a.md:
        a.md.write_text(text)
    if not (a.json or a.md or a.compact):
        print(text)


if __name__ == "__main__":
    main(sys.argv[1:])
