#!/usr/bin/env python3
"""Census: every console command the retail 1.61 client registers, read out of
BF1942.exe, and what the viewer does with each.

    python3 surveys/census_console_registry.py            # writes the catalogue
    python3 surveys/census_console_registry.py --check    # fails if it is stale

From tools/bf1942-models. Writes
`features/bf1942-in-the-browser/console-commands.json` (one row per
registration) and `console-commands.md` (the same, grouped by object, with the
viewer's verdict). Needs `objdump` and the game install (`--exe`).

How the registry is read (ledger CON-20). Every console command is a static
`ConsoleObject` built by the CRT's dynamic initialisers, the table of thunk
pointers around `0x009520c8` that `_initterm` walks in order. A thunk does one
of two things:

  * `push access; push "Name"; mov ecx, 0x95fa38; call 0x005acbd0` -- the
    ObjectName setter, which writes `0x009ab634` (the name), `0x009ab638` (the
    name with its first letter lowered) and `0x009ab63c` (the access bits).
    It names the object every following constructor registers under.
  * `mov ecx, <static>; call <ctor>; push <dtor>; call atexit` -- one command.
    The constructor fills the layout bf42plus's `src/bf/console.h` documents:
    `+0x04` type, `+0x08` object name (from `0x009ab634`/`0x009ab638`), `+0x0c`
    the method name, `+0x10` access (from `0x009ab63c`), `+0x14`/`+0x18` the
    minimum and maximum argument counts, `+0x4c` the return type,
    `+0x50 + 4i` each argument's type.

Walking the table in order and replaying both shapes gives 2218 registrations
(2116 distinct names; a few overloads, such as `Game.connectToServer` and
`Admin.changeMap`, register twice). Every thunk whose constructor writes a
`+0x4c` return type was recognised. Types: 0 method (1135), 1 read/write
property (1071), 2 read-only property (12); access: 1 (164), 2 (2041), 4 (13)
-- see CON-21 and CON-22 for what those mean at the prompt.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUT_DIR = REPO / "features" / "bf1942-in-the-browser"
DEFAULT_EXE = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/BF1942.exe"
BASE = 0x400000
SET_OBJECT = 0x005ACBD0
TABLE_SEED = 0x009520C8

# --------------------------------------------------------------- the viewer

# What the viewer registers today (viewer/page-console.js and
# viewer/console-commands.js). tests/test_console.py checks that every word
# the console-commands module registers is in this set and in the client's
# registry, so the catalogue cannot drift from the code silently.
BUILT = {
    # page-console.js
    "Game.disconnect", "Game.setCommonMouseSensitivity", "Game.setInfMouseSensitivity",
    "Game.setLandSeaMouseSensitivity", "Game.setAirMouseSensitivity",
    "Game.setInfMouseInvert", "Game.setLandSeaMouseInvert", "Game.setAirMouseInvert",
    "Game.setMinimapTransparency", "Game.setStaticMinimap", "Game.setRadioToolTip",
    # console-commands.js
    "Console.showFPS", "Console.showStats", "Console.engineSpeed", "Console.echo",
    "Console.echoErrors", "Console.maxHistorySize", "Console.maxCommandHistorySize",
    "Console.getArgumentTypes", "Console.getReturnType", "Console.getActiveMethods",
    "Vars.set", "Vars.get", "Vars.list",
    "Game.useHud", "Game.EnableFreeCamera", "Game.listPlayers", "Game.listMaps",
    "Game.drawDebug", "Game.viewDistance", "Game.setMasterVolume", "Game.setDisableSound",
    "Admin.toggleGamePause",
    "Chat.chatMessageSize", "Chat.gameInfoMessageSize", "Chat.killMessageSize",
    "Chat.setChatHistory", "Chat.chatInfo", "Chat.timeUntilMessageRemoved",
    "Renderer.wireframe", "Renderer.vertexFogEnable", "Renderer.fogStart", "Renderer.fogEnd",
    "Renderer.fogColorVec", "Renderer.drawTerrain", "Renderer.drawSky", "Renderer.drawObjects",
    "Renderer.nearPlane",
    "Hud.fullscreenMap", "Hud.toggleFullscreenMap", "Hud.useThumbnailMap",
    "Hud.toggleUseThumbnailMap",
    "Debug.enableParticles",
}

# Words that would mean something in the viewer or a replay and are not built:
# the follow-up list. Each says what it would hook to.
FITS = {
    "Console.drawFpsGraph": "a frame-time graph under the FPS readout",
    "Console.showNetGraph": "the relay's packet rates (net-relay.js)",
    "Console.run": "fetch a .con file from the mod tree and run it line by line",
    "Console.listVariables": "needs the var/const keywords",
    "Console.listConstants": "needs the var/const keywords",
    "Console.maxLineSize": "the 77-character edit buffer, a constant here",
    "Game.mouseLook": "page-input.js mouse look on/off",
    "Game.crossHairSize": "the crosshair element's size",
    "Game.crossHairRadius": "the crosshair element's radius",
    "Game.setCrossHairColor": "the crosshair's colour",
    "Game.setNameTagDistance": "nametags.js distances (HUD-16)",
    "Game.setMaxNameTagDistance": "nametags.js distances (HUD-16)",
    "Game.getNameTagDistance": "nametags.js distances (HUD-16)",
    "Game.debugShowAllVehicleNameTags": "nametag-layer.js, every hull tagged",
    "Game.suicide": "the deploy screen's SUICIDE button",
    "Game.sayAll": "comms.js chat send on the play page",
    "Game.changePlayerName": "the profile's name (profile-sync.js)",
    "Game.freeCameraBaseSpeed": "the replay free camera's speed",
    "Game.freeCameraSlowSpeed": "the replay free camera's speed",
    "Game.freeCameraFastSpeed": "the replay free camera's speed",
    "Game.getLevelName": "the level's name",
    "Game.showVersion": "the viewer's build",
    "Game.worldBorderFog": "level-sky.js far plane",
    "Game.intensityScale": "the light rig's intensity",
    "Game.setShadows": "no shadows in the viewer yet (video settings work)",
    "Game.setEnvironmentMapping": "envmap.js (video settings work)",
    "Game.setLightmaps": "level-shading.js lightmaps (video settings work)",
    "Game.setDetailTexture": "terrain detail map (video settings work)",
    "Game.setGraphicsQuality": "video settings work",
    "Game.setEffectsQuality": "video settings work",
    "Game.setMenuViewdistance": "video settings work",
    "Game.setGameDisplayMode": "video settings work",
    "Game.setMenuMusicVolume": "sound settings work",
    "Game.setMusicOnOff": "sound settings work",
    "Game.setSoundDetail": "sound settings work",
    "Game.setChannels": "sound settings work",
    "Game.setHardware": "sound settings work",
    "Chat.oldChatListStyle": "the pre-1.4 chat list (not drawn by the viewer)",
    "Chat.oldChatListHistory": "the pre-1.4 chat list",
    "Chat.ignoreRadioText": "comms.js radio lines",
    "Chat.ignoreRadioAudio": "comms.js radio voices",
    "Chat.setIgnoreRadioAudioAndText": "comms.js radio",
    "Chat.getIgnoreRadioAudioAndText": "comms.js radio",
    "Chat.addToIgnoreList": "hide a player's chat lines (replay too)",
    "Chat.removeFromIgnoreList": "hide a player's chat lines",
    "Chat.ignoreList": "hide a player's chat lines",
    "Renderer.fieldOfView": "every view writes camera.fov per frame; needs a scale",
    "Renderer.drawTrees": "tree-foliage.js cards and trunks",
    "Renderer.drawTransparentObjects": "a material pass filter",
    "Renderer.drawOpaqueObjects": "a material pass filter",
    "Renderer.drawTranslucent": "a material pass filter",
    "Renderer.gammaFactor": "renderer output (video settings work)",
    "Renderer.lockFps": "a frame cap on the render loop",
    "Renderer.mipMapBias": "texture LOD bias",
    "Renderer.lodObjectDistanceLodFactor": "the LodObject distance (LOD-*)",
    "Renderer.globalLodPercent": "the LodObject distance",
    "Renderer.setVSyncEnabled": "video settings work",
    "Renderer.getVSyncEnabled": "video settings work",
    "Renderer.multiSampleMode": "video settings work (antialias)",
    "Renderer.useTrilinearFiltering": "texture filtering",
    "Shadow.setShadows": "no shadows in the viewer yet",
    "Shadow.shadowColor": "no shadows in the viewer yet",
    "Shadow.numberOfActiveShadows": "no shadows in the viewer yet",
    "Sound.dopplerFactor": "page-audio.js has no doppler (sound settings work)",
    "Sound.rolloffFactor": "page-audio.js gain law (sound settings work)",
    "Sound.distanceFactor": "page-audio.js gain law (sound settings work)",
    "Sound.showSoundInfo": "the audio rack's state as text",
    "Sound.drawSoundObjects": "markers at every live voice",
    "Sound.maxVoices": "the rack's voice cap",
    "Debug.debriefing": "the round-end debriefing screen",
    "lensFlare.enable": "level.paintLensFlare",
    "treeRenderer.enable": "tree-foliage.js",
    "treeRenderer.spritesEnable": "tree-foliage.js billboards",
    "treeRenderer.swayEnable": "tree-foliage.js sway",
    "treeRenderer.billboardDistanceScale": "tree-foliage.js",
    "Soldier.cameraShakeFactor": "the hit and fire shake (handweapon view, VIEW-*)",
    "Hud.toggleDebugMap": "the map with debug marks",
}

DATA_OBJECTS = {
    "ObjectTemplate", "GeometryTemplate", "LodSelectorTemplate", "Object", "AI", "AIBotManager",
    "AILandingZone", "AIRadio", "AIStrategicArea", "AITemplate", "AITemplatePlugIn", "aiSettings",
    "aiStrategy", "aiCheats", "kitTemplate", "weaponTemplate", "AnimationStateMachine",
    "SpawnPointManager", "objectiveManager", "skidMark", "WPart", "StandardMesh", "MaterialManager",
    "textureList", "ObjectAssembler", "EnvironmentSound", "SoldierSound", "Cloud", "Sky", "Weather",
    "Water", "Terrain", "ScoreManager", "PlayerStats", "Player", "Physics", "ControlMap",
    "InputDevices", "ParticleSystem",
}
ENGINE_OBJECTS = {
    "Editor", "ObjectEditor", "TerrainEditor", "ToolHandler", "ToolBenchmark", "RayTracer", "Memory",
    "Profiler", "ConsoleProfiler", "FileManager", "FileChangeManager", "ResourceManager",
    "TextureManager", "ShaderManager", "BitStream", "NetworkableInfo", "Portal", "ObjectGrid",
    "Utils", "Menu",
}
SERVER_GAME = re.compile(
    r"^(server|connect|join|host|vote|dumpNetwork|clientPunk|clientside|setDefaultIp|setConnection"
    r"|startServer|restartServer|reconnect|getIp|getServerName|gameSpy|ASEPort|saveServerSettings"
    r"|setRemoteConsole|packetDrop|connectionType|interpolationTime|extrapolationTime"
    r"|globalPrediction|commandRate|useAutoPingAdjust|numDeltas|networkStats|showNetworkInfo"
    r"|TK|buddyList|addPlayerToBuddy|removePlayerFromBuddy|set.*Filter|dedicatedServer|maxNrOfPlayers"
    r"|setServerWelcome|getServerWelcome|exitAtRestart|restartBf1942exe|setStatsGathering"
    r"|getStatsGathering|addModServerInfoIcon|setRentAServerUrl|objectiveAttackerTicketsMod"
    r"|autoBalanceTeam|delayBeforeStartingGame|roundDelayBeforeStartingGame|soldierFF|vehicleFF"
    r"|kickBack|timeLimit|scoreLimit|restartMap|runNextLevel|setNextLevel|timeBeforeRestartMap"
    r"|nrOfRounds|setMinNrOfPlayers|ticketRatio|timeToNextWave|spawnWaveTime|debugCallbackDisabled"
    r"|gameModeTest|setTeam$|forcePlayerToTeam|disconnect)")


def verdict(obj: str, meth: str) -> tuple[str, str]:
    name = f"{obj}.{meth}"
    if name in BUILT:
        return "built", ""
    if name in FITS:
        return "fits", FITS[name]
    if obj == "Admin":
        return "server", "a server admin's word"
    if obj == "Game" and SERVER_GAME.match(meth):
        return "server", "the server, the network or the match rules"
    if obj in DATA_OBJECTS:
        return "data", "a level or template script word: the extractor reads its values"
    if obj in ENGINE_OBJECTS:
        return "engine", "editor, tool or engine internals"
    if obj == "Game" and re.match(r"^(set|add|get|create|spawn|kill|write|clear|custom|menu|game|team|is|assult|random|material|show|debug|aiP|aiS|enableCon|spawnAt|autoSpawn|fontRatio|settingsPath|useMenu|delay|isAi)", meth):
        return "data", "the game's own boot and level scripts, or menu state"
    return "engine", "engine internals, no viewer meaning"


# --------------------------------------------------------------- the reader

INS = re.compile(r"^\s+([0-9a-f]+):\t(?:[0-9a-f]{2} )+\s*\t(.*)$")
IMM = re.compile(r"^0x([0-9a-f]+)$")


def imm(s: str):
    m = IMM.match(s)
    return int(m.group(1), 16) if m else None


class Image:
    def __init__(self, exe: Path):
        self.d = exe.read_bytes()
        asm = subprocess.run(["objdump", "-d", "-M", "intel", str(exe)],
                             capture_output=True, text=True, check=True).stdout
        self.ins, self.idx = [], {}
        for line in asm.splitlines():
            m = INS.match(line)
            if m:
                a = int(m.group(1), 16)
                self.idx[a] = len(self.ins)
                self.ins.append((a, m.group(2).strip()))

    def u32(self, va: int) -> int:
        return struct.unpack_from("<I", self.d, va - BASE)[0]

    def cstr(self, va) -> str | None:
        if not isinstance(va, int) or not (0x8C3000 <= va < 0x960000):
            return None
        o = va - BASE
        e = self.d.find(b"\0", o)
        s = self.d[o:e]
        if not s or len(s) > 120:
            return None
        try:
            t = s.decode("ascii")
        except UnicodeDecodeError:
            return None
        return t if all(32 <= ord(c) < 127 for c in t) else None

    def body(self, start: int, limit: int):
        i = self.idx.get(start)
        out = []
        while i is not None and i < len(self.ins) and len(out) < limit:
            out.append(self.ins[i])
            if self.ins[i][1].startswith("ret"):
                break
            i += 1
        return out

    def ctor_fields(self, addr: int):
        regs, fields, calls, this = {}, {}, [], None
        for _, t in self.body(addr, 400):
            op, _, rest = t.partition(" ")
            rest = rest.strip()
            if op == "mov":
                dst, _, src = rest.partition(",")
                if dst in ("esi", "edi", "ebx", "ebp") and src == "ecx" and this is None:
                    this = dst
                    continue
                if re.fullmatch(r"e[a-ds][xip]|e[sd]i", dst):
                    v = imm(src)
                    if v is not None:
                        regs[dst] = v
                    elif "ds:0x" in src:
                        regs[dst] = ("g", int(src.split("ds:0x")[1], 16))
                    else:
                        regs.pop(dst, None)
                    continue
                m = re.fullmatch(r"(?:DWORD|BYTE) PTR \[(e[a-ds][xip]|e[sd]i)(?:\+0x([0-9a-f]+))?\]", dst)
                if m and (this is None or m.group(1) in (this, "ecx")):
                    v = imm(src)
                    fields.setdefault(int(m.group(2) or "0", 16), v if v is not None else regs.get(src, ("r", src)))
            elif op == "xor":
                dst, _, src = rest.partition(",")
                if dst == src:
                    regs[dst] = 0
            elif op == "call":
                calls.append(rest)
                for r in ("eax", "ecx", "edx"):
                    regs.pop(r, None)
        return fields, calls

    def describe(self, f):
        meth = self.cstr(f.get(0xC))
        if meth is None or 0x4C not in f:
            return None
        def typ(v):
            s = self.cstr(v) if isinstance(v, int) and v > 0x8C3000 else None
            return s if s is not None else str(v)
        args = []
        for k in range(10):
            if 0x50 + 4 * k not in f:
                break
            args.append(typ(f[0x50 + 4 * k]))
        num = lambda v: v if isinstance(v, int) else None
        return {"method": meth, "type": num(f.get(0x4)), "minArgs": num(f.get(0x14)),
                "maxArgs": num(f.get(0x18)), "returns": typ(f[0x4C]), "argTypes": args,
                "vtable": f"0x{f[0]:08x}" if isinstance(f.get(0), int) else None}


def read_registry(exe: Path) -> list[dict]:
    img = Image(exe)
    in_text = lambda v: 0x401000 <= v < 0x8C3000 or v == 0
    start = TABLE_SEED
    while in_text(img.u32(start - 4)) and start > 0x952000:
        start -= 4
    end = TABLE_SEED
    while in_text(img.u32(end)):
        end += 4
    rows, current, access = [], None, None
    for p in range(start, end, 4):
        thunk = img.u32(p)
        if not thunk:
            continue
        pushes, ecx = [], None
        for _, t in img.body(thunk, 200):
            op, _, rest = t.partition(" ")
            rest = rest.strip()
            if op == "push":
                pushes.append(imm(rest))
            elif op == "mov" and rest.startswith("ecx,"):
                ecx = imm(rest[4:])
            elif op == "call":
                target = imm(rest)
                if target == SET_OBJECT:
                    current = img.cstr(pushes[-1]) if pushes else None
                    access = pushes[-2] if len(pushes) > 1 else None
                elif target is not None and ecx and 0x952000 <= ecx < 0xB00000:
                    f, calls = img.ctor_fields(target)
                    desc = img.describe(f)
                    if desc is None:
                        for c in calls:
                            ct = imm(c)
                            if ct:
                                base, _ = img.ctor_fields(ct)
                                base.update(f)
                                desc = img.describe(base)
                                if desc:
                                    break
                    if desc:
                        status, why = verdict(current, desc["method"])
                        row = {"object": current, **desc, "access": access,
                               "ctor": f"0x{target:08x}", "static": f"0x{ecx:08x}",
                               "viewer": status}
                        if status == "fits":
                            row["note"] = why
                        rows.append(row)
                pushes = []
    return rows


# --------------------------------------------------------------- the writer

TYPE_WORD = {0: "method", 1: "property", 2: "read-only", 3: "write-only"}


def markdown(rows: list[dict]) -> str:
    by = defaultdict(list)
    for r in rows:
        by[r["object"]].append(r)
    counts = Counter(r["viewer"] for r in rows)
    out = [
        "# The client's console commands",
        "",
        "Every console command the retail 1.61 client (`BF1942.exe`) registers, read out of",
        "its static-initialiser table by `tools/bf1942-models/surveys/census_console_registry.py`",
        "(ledger CON-20). Generated: edit the script, not this file. The analysis is",
        "`console.md` section 12.",
        "",
        f"{len(rows)} registrations, {len({(r['object'] + '.' + r['method']).lower() for r in rows})} distinct names, "
        f"on {len(by)} objects. Viewer: {counts['built']} built, {counts['fits']} would fit "
        f"(follow-ups), {counts['server']} server or network, {counts['data']} level or template "
        f"script data, {counts['engine']} engine or editor internals.",
        "",
        "Columns: type (method, property = read/write, read-only), arguments `min-max (types)`,",
        "return type, access bits (1 and 2 pass at the prompt; 4 only in an archive script, CON-22),",
        "the viewer's verdict. `built` words are in `viewer/page-console.js` and",
        "`viewer/console-commands.js`; `fits` words say what they would hook to.",
        "",
    ]
    order = ["Console", "Game", "Chat", "Hud", "Renderer", "Shadow", "Sound", "Debug", "Vars", "Admin"]
    objects = order + sorted((o for o in by if o not in order), key=str.lower)
    for obj in objects:
        if obj not in by:
            continue
        group = by[obj]
        c = Counter(r["viewer"] for r in group)
        out.append(f"## {obj} ({len(group)})")
        out.append("")
        if obj in DATA_OBJECTS or obj in ENGINE_OBJECTS:
            kind = "data" if obj in DATA_OBJECTS else "engine"
            if c.get(kind, 0) == len(group):
                out.append(f"All {kind}: " + ", ".join(sorted({r['method'] for r in group}, key=str.lower)) + ".")
                out.append("")
                continue
        out.append("| command | type | args | returns | access | viewer |")
        out.append("|---|---|---|---|---|---|")
        for r in sorted(group, key=lambda r: r["method"].lower()):
            args = f"{r['minArgs']}-{r['maxArgs']}" + (f" ({', '.join(r['argTypes'])})" if r["argTypes"] else "")
            v = r["viewer"] + (f": {r['note']}" if r["viewer"] == "fits" else "")
            out.append(f"| `{obj}.{r['method']}` | {TYPE_WORD.get(r['type'], r['type'])} | {args} | "
                       f"{r['returns']} | {r['access']} | {v} |")
        out.append("")
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--exe", type=Path, default=DEFAULT_EXE)
    ap.add_argument("--check", action="store_true", help="fail when the written files are stale")
    a = ap.parse_args()
    if not a.exe.exists():
        print(f"no client at {a.exe}", file=sys.stderr)
        return 2
    rows = read_registry(a.exe)
    # One row a line: greppable, and a diff names the command that moved.
    js = "[\n" + ",\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n]\n"
    md = markdown(rows)
    jpath, mpath = OUT_DIR / "console-commands.json", OUT_DIR / "console-commands.md"
    if a.check:
        stale = [p.name for p, t in ((jpath, js), (mpath, md)) if not p.exists() or p.read_text() != t]
        if stale:
            print("stale: " + ", ".join(stale), file=sys.stderr)
            return 1
        return 0
    jpath.write_text(js)
    mpath.write_text(md)
    c = Counter(r["viewer"] for r in rows)
    print(f"{len(rows)} registrations; " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
