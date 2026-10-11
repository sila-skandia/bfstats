#!/usr/bin/env python3
"""Completeness audit: what a mod's tree is MISSING, not what is wrong in it.

    python3 audit_mod.py --mod <id> --audit completeness [--json out.json]

`audit_mod.py` calls `run()` here. The other audits check that what was
extracted is sound; this one checks that everything the viewer, the play front
end and the mod's own files call for was extracted at all. Three sources decide
what "required" means, none of them a per-mod list:

1. What the viewer asks for. Every `_shared/<file>` and `<file>.json` literal
   in `viewer/*.js`, `viewer/play/*.js` and the pages is scanned
   (`viewer_requests`); a request no registered artifact covers is reported
   as `unregistered-viewer-request` so the registry cannot rot silently.
2. What the built reference mods have. Every other tree that carries the core
   set (models.json, maps.json, kits, loadouts, vehicle sounds) votes: a path
   at least `REFERENCE_SHARE` of them carry, that the target lacks and the
   registry does not know, is `reference-has-it-unregistered`.
3. What the mod's own files define, read from the install: a `movies/*.bik`
   in the chain means a menu movie is owed, a `music/*.bik` means the five
   menu tracks, a level whose GameTypes name a mode means the level carries
   that mode, a level archive with `InGameMap` means a minimap, and so on.

Each artifact in `ARTIFACTS` names the script that owns it, so a pipeline can
re-run exactly that step. `extract_all.py` runs only `extract_models.py`,
`extract_pose.py`, `shoot.mjs` and `verify`: every other row is OUTSIDE it, and
the `outside_extract_all` flag says so (the class `deployables.json` was).

Finding schema (also what `--json` writes, alongside the legacy keys):
    check        "completeness"
    level        level directory name, or null for mod-wide
    item         the missing thing (a path under the tree, a level, a mode)
    severity     blocker | major | minor | info
    cause_key    stable id of the cause
    owning_script  the extractor that produces it (null when none does)
    evidence     why it is required, in a sentence a human can check

Severity: blocker = the tab or the level cannot load; major = the viewer
runs but is silently wrong or 404s (vanilla data where the mod has its own);
minor = degrades something small; info = recorded, not a failure.
A blocker/major fails the audit unless it carries an `accepted` entry with
evidence (`completeness_accepted/<mod>.json`, see `load_accepted`).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"
ACCEPTED_DIR = HERE / "completeness_accepted"

REFERENCE_SHARE = 0.6
# The scripts `extract_all.py` itself runs; every other owner is outside it.
EXTRACT_ALL_RUNS = {"extract_all.py", "extract_models.py", "extract_pose.py",
                    "shoot.mjs"}
# legacy per-tree copies the hud pack superseded (comms.js reads the pack's)
REFERENCE_IGNORE = ("_shared/chat-layout.json", "_shared/radio-layout.json",
                    "_shared/fonts/")
# a tree needs these before it votes as a "fully built" reference
CORE = ("M:models.json", "M:kits.json", "P:maps.json", "P:_shared/loadouts.json",
        "P:_shared/vehicle-sounds.json")
SEVERITIES = ("blocker", "major", "minor", "info")


@dataclass(frozen=True)
class Artifact:
    root: str            # "M" models tree, "P" maps tree
    rel: str             # path under that root
    script: str          # the owning extractor
    severity: str        # when requested and the mod defines the source
    probe: str = ""      # condition on the mod's own files ("" = always)
    why: str = ""        # what requests it


ARTIFACTS: tuple[Artifact, ...] = (
    # --- models tree -------------------------------------------------------
    Artifact("M", "models.json", "extract_all.py", "blocker",
             why="the Models tab and every page's vehicle table"),
    Artifact("M", "kits.json", "extract_kits.py", "major",
             why="kit-catalogue.js, the deploy screen's kit column"),
    Artifact("M", "damage.json", "extract_models.py", "major",
             why="armour-damage.js: without it every hull takes vanilla's table"),
    Artifact("M", "deployables.json", "extract_deployables.py", "major",
             why="deployables.js fetches it per level; absent is a 404 on every "
                 "level (extract_all.py never runs the script)"),
    Artifact("M", "sounds/soldier.json", "extract_soldier_sounds.py", "major",
             why="footsteps and hurt cries (soldier-sounds)"),
    Artifact("M", "sounds/weapons.json", "extract_weapon_sounds.py", "major",
             why="hand-weapon fire sounds: soldiers fire silently without it"),
    Artifact("M", "viewmodels/index.json", "extract_viewmodel.py", "major",
             why="arms-rig.js: weapons float in first person"),
    Artifact("M", "poses/poses-matrix.json", "extract_pose.py", "major",
             why="the Poses tab and every soldier pose"),
    Artifact("M", "poses/seat-poses.json", "extract_pose.py", "minor",
             why="seated soldier poses"),
    # --- maps tree ---------------------------------------------------------
    Artifact("P", "maps.json", "extract_maps_all.py", "blocker",
             why="the Maps tab"),
    Artifact("P", "_shared/loadouts.json", "extract_loadouts.py", "major",
             why="map.html spawns bare-handed without it"),
    Artifact("P", "_shared/damage.json", "extract_effects.py", "major",
             why="damage tables the level pages fetch"),
    Artifact("P", "_shared/effects.glb", "extract_effects.py", "major",
             why="explosions, smoke, muzzle flashes"),
    Artifact("P", "_shared/effects.sounds.json", "extract_effects.py", "major",
             why="effect-audio.js"),
    Artifact("P", "_shared/collision-meshes.json", "extract_collision_meshes.py",
             "major", why="collision-meshes.js"),
    Artifact("P", "_shared/trees.json", "extract_tree_billboards.py", "major",
             why="trees.json + trees/ billboards (404 otherwise)"),
    Artifact("P", "_shared/vehicle-ai.json", "extract_vehicle_ai.py", "major",
             why="bots never board vehicles without it"),
    Artifact("P", "_shared/vehicle-sounds.json", "extract_vehicle_sounds.py",
             "major", why="every engine and gun is silent without it"),
    Artifact("P", "_shared/vehicle-sonar.json", "extract_vehicle_sonar.py",
             "minor", why="sonar pings"),
    Artifact("P", "_shared/vehicle-spotting.json", "extract_vehicle_spotting.py",
             "minor", why="spotting icons"),
    Artifact("P", "_shared/bot-names.json", "extract_bot_names.py", "major",
             why="bot-names.js: stand-in names replace the level's own"),
    Artifact("P", "_shared/voices/languages.json", "extract_radio.py", "major",
             why="voices: radio and capture announcer"),
    Artifact("P", "_shared/voices/radio-sounds.json", "extract_radio.py", "major",
             why="radio.js"),
    Artifact("P", "_shared/voices/voices.json", "extract_capture_voices.py",
             "major", why="capture announcer"),
    Artifact("P", "_shared/voices/soldier-voices.json",
             "extract_soldier_voices.py", "major", why="soldier barks"),
    Artifact("P", "_shared/voices/ctf-sounds.json", "extract_ctf_voices.py",
             "major", probe="ctf",
             why="ctf-page.js fetches it: a level with a Ctf mode is silent"),
    Artifact("P", "_shared/load/menu_loading.png", "extract_loading_assets.py",
             "major", why="loading plate (progress.js DEFAULT_CHROME)"),
    Artifact("P", "_shared/load/loading_bar.png", "extract_loading_assets.py",
             "major", why="loading bar (progress.js)"),
    Artifact("P", "_shared/load/mp_briefing.png", "extract_loading_assets.py",
             "major", why="briefing-screen.js"),
    Artifact("P", "_shared/music/menu.mp3", "extract_menu_music.py", "major",
             probe="music", why="play front end menu loop"),
    Artifact("P", "_shared/music/vehicle4.mp3", "extract_loading_assets.py",
             "major", probe="music", why="load music (maps.json loading.music)"),
    Artifact("P", "_shared/music/win.mp3", "extract_menu_music.py", "minor",
             probe="music", why="round-end music"),
    Artifact("P", "_shared/music/lose.mp3", "extract_menu_music.py", "minor",
             probe="music", why="round-end music"),
    Artifact("P", "_shared/music/debriefing.mp3", "extract_menu_music.py",
             "minor", probe="music", why="debriefing music"),
    Artifact("P", "_shared/movies/background.webm", "extract_menu_movie.py",
             "major", probe="movie",
             why="menu-movie.js: a mod's still is its own art and vanilla's "
                 "footage is not borrowed, so the menu stays a still"),
    Artifact("P", "_shared/hud/pack.json", "extract_hud_mods.py", "major",
             probe="ownhud", why="hud-pack.js: the mod's own interface art"),
    Artifact("P", "_shared/hud/hud.json", "extract_hud_mods.py", "major",
             probe="ownhud", why="hud sprites index"),
    Artifact("P", "_shared/hud/menu/menu-levels.json", "extract_hud_mods.py",
             "major", probe="ownhud",
             why="Instant Battle level list, nations, thumbnails"),
    Artifact("P", "_shared/hud/menu/main-menu-layout.json",
             "extract_hud_mods.py", "minor", probe="ownhud",
             why="main menu chrome"),
)

# per-level files every level of the built references carries
LEVEL_CORE = (
    ("scene.glb", "extract_maps_all.py", "blocker"),
    ("scene.json", "extract_maps_all.py", "blocker"),
    ("scene.glb.gz", "optimise_mesh.py", "major"),
    ("minimap/minimap.png", "extract_map.py", "major"),
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def ci_child(directory: Path, name: str) -> Path | None:
    """`name` inside `directory`, any case, or None."""
    if directory is None or not directory.is_dir():
        return None
    want = name.lower()
    for child in directory.iterdir():
        if child.name.lower() == want:
            return child
    return None


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def tree_files(tree) -> set[str]:
    """Every file of the tree as `M:<rel>` / `P:<rel>`, a level's name
    replaced by `<level>`, excluding the bulky per-model/per-pose families."""
    out: set[str] = set()
    for tag, root in (("M", tree.models), ("P", tree.maps)):
        if not root.is_dir():
            continue
        skip_top = {"mods"} if tree.mod_id == "bf1942" else set()
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            top = rel.split("/")[0]
            if top in skip_top or rel == "mods.json":
                continue
            if tag == "M" and (rel.endswith((".glb", ".gz", ".report.json"))
                               or top in ("thumbs",)
                               or (top == "poses" and "/" in rel
                                   and not rel.endswith("matrix.json")
                                   and not rel.endswith(("index.json", "seat-poses.json")))
                               or (top == "viewmodels" and rel != "viewmodels/index.json")):
                continue
            parts = rel.split("/")
            if tag == "P" and top not in ("_shared",) and len(parts) > 1:
                parts[0] = "<level>"
            out.add(f"{tag}:{'/'.join(parts)}")
    return out


def reference_trees(target_id: str):
    """Trees that carry the core set, other than the target: (id, files)."""
    from audit_mod import Tree
    ids = ["bf1942"] + sorted(
        p.name for p in (VIEWER / "models" / "mods").iterdir() if p.is_dir())
    out = []
    for mid in ids:
        if mid == target_id:
            continue
        try:
            files = tree_files(Tree.locate(mid))
        except SystemExit:
            continue
        if all(c in files for c in CORE):
            out.append((mid, files))
    return out


def viewer_requests() -> dict[str, str]:
    """`_shared/<rel>` and bare `*.json` names the viewer literally asks for,
    each with the first `file:line` that does."""
    found: dict[str, str] = {}
    shared = re.compile(r"_shared/([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?)")
    bare = re.compile(r"""['"`/]([A-Za-z0-9_-]+\.json)['"`?$]""")
    files = (sorted(VIEWER.glob("*.js")) + sorted(VIEWER.glob("*.html"))
             + sorted((VIEWER / "play").glob("*.js")))
    for f in files:
        if f.name.startswith("bot-") and f.name != "bot-names.js":
            continue
        for n, line in enumerate(f.read_text(errors="replace").splitlines(), 1):
            for m in shared.finditer(line):
                found.setdefault("_shared/" + m.group(1), f"{f.name}:{n}")
            for m in bare.finditer(line):
                found.setdefault(m.group(1), f"{f.name}:{n}")
    return found


def load_accepted(mod_id: str) -> list[dict]:
    """`completeness_accepted/<mod>.json`: a list of
    {cause_key, item (optional glob), level (optional), evidence}. An entry
    without evidence is ignored: an acceptance must say why."""
    data = load_json(ACCEPTED_DIR / f"{mod_id}.json")
    return [e for e in (data or []) if e.get("evidence") and e.get("cause_key")]


def init_directives(chain) -> dict[str, str]:
    """`game.setCustomGame*` / `set*MusicFilename` from the nearest init.con."""
    out: dict[str, str] = {}
    for mod_dir in chain:
        init = ci_child(mod_dir, "init.con")
        if init is None:
            continue
        for line in init.read_text(errors="replace").splitlines():
            m = re.match(r"\s*game\.(\w+)\s+(.*)$", line, re.I)
            if m:
                out.setdefault(m.group(1).lower(), m.group(2).strip().strip('"'))
        break
    return out


def own_levels(game) -> list[str]:
    """Lower-cased stems of the mod's OWN level archives (not inherited)."""
    from bf42.rfa import find_archives_dir, find_levels_dir
    mod_dir = game.chain[0]
    ad = find_archives_dir(mod_dir)
    ld = find_levels_dir(ad) if ad else None
    if ld is None:
        return []
    stems = []
    for f in sorted(ld.iterdir()):
        if f.is_file() and f.suffix.lower() == ".rfa":
            stem = f.stem
            if "_" in stem and stem.rsplit("_", 1)[-1].isdigit():
                continue
            stems.append(stem.lower())
    return stems


def level_gametypes(game, lv: str) -> set[str]:
    """Names of the files in the level's `GameTypes/` (what a menu offers)."""
    arc = game.level_archive(lv)
    if arc is None:
        return set()
    out = set()
    for n in arc.entries:
        parts = n.replace("\\", "/").split("/")
        if len(parts) >= 2 and parts[-2].lower() == "gametypes" \
                and parts[-1].lower().endswith(".con"):
            out.add(parts[-1][:-4].lower())
    return out


# ---------------------------------------------------------------------------
# the audit
# ---------------------------------------------------------------------------

def run(tree, game, ctx: dict, Finding) -> list:
    out: list = []
    accepted = load_accepted(tree.mod_id)
    base_id = tree.mod_id

    def add(cause, item, severity, script, evidence, level=""):
        f = Finding("completeness", cause, item, evidence, level)
        f.severity = severity
        f.owning_script = script or ""
        for a in accepted:
            if a["cause_key"] != cause:
                continue
            if a.get("level") and a["level"] != level:
                continue
            pat = a.get("item")
            if pat and not re.fullmatch(pat, item):
                continue
            f.accepted = a["evidence"]
            break
        out.append(f)

    files = tree_files(tree)
    refs = reference_trees(base_id)
    ctx["completeness references"] = ", ".join(i for i, _ in refs) or "none"

    chain = list(game.chain) if getattr(game, "ok", False) else []

    # -- probes: conditions the mod's own files set --------------------------
    def has_chain_dir_file(sub: str, suffix: str) -> str | None:
        for d in chain:
            sd = ci_child(d, sub)
            if sd and sd.is_dir():
                for f in sd.iterdir():
                    if f.name.lower().endswith(suffix):
                        return f"{d.name}/{sub}/{f.name}"
        return None

    baked_modes: set[str] = set()
    for lv in tree.levels:
        sc = load_json(tree.maps / lv / "scene.json") or {}
        baked_modes |= {k.lower() for k in (sc.get("gameTypes") or {})}
        baked_modes |= {k.lower() for k in (sc.get("modes") or {})}

    probes = {
        "": lambda: "always",
        "movie": lambda: (has_chain_dir_file("movies", ".bik") or "")
        if chain else None,
        "music": lambda: (has_chain_dir_file("music", ".bik") or "")
        if chain else None,
        "ctf": lambda: ("a baked level carries a Ctf mode"
                        if "ctf" in baked_modes else ""),
        "ownhud": lambda: "a mod tree carries its own hud pack"
        if base_id != "bf1942" else "",
    }

    # -- 1. registered artifacts ---------------------------------------------
    for art in ARTIFACTS:
        if base_id == "bf1942" and art.probe == "ownhud":
            continue
        key = f"{art.root}:{art.rel}"
        present = key in files
        if art.rel.endswith("effects.glb"):
            present = present or key + ".gz" in files
        if present:
            continue
        evid = probes[art.probe]()
        if evid is None:
            sev, ev = "minor", f"{art.why}; the install is absent so the mod's "\
                               f"source could not be checked"
        elif evid == "":
            continue  # the mod does not define the source: nothing is owed
        else:
            sev = art.severity
            ev = art.why + (f" [source: {evid}]" if art.probe and evid != "always" else "")
        votes = [i for i, f in refs if key in f]
        if votes:
            ev += f"; present in {len(votes)}/{len(refs)} built references"
        add(f"missing-{art.rel}", art.rel, sev, art.script, ev)

    # -- 2. the viewer's requests the registry does not cover ----------------
    covered = {a.rel for a in ARTIFACTS} | {a.rel.rsplit("/", 1)[-1] for a in ARTIFACTS}
    covered |= {"_shared/" + a.rel.split("_shared/", 1)[1] for a in ARTIFACTS
                if "_shared/" in a.rel}
    scene_local = {"scene.json", "maps.json", "models.json", "mods.json",
                   "soldier.json", "weapons.json", "index.json", "pack.json"}
    for req, where in sorted(viewer_requests().items()):
        name = req.rsplit("/", 1)[-1]
        if (req in covered or name in covered or name in scene_local
                or req.startswith(("_shared/hud", "_shared/sounds", "_shared/voices",
                                   "_shared/trees", "_shared/music", "_shared/load",
                                   "_shared/movies", "_shared/vehicle-"))
                or name in _KNOWN_NON_ARTIFACT):
            continue
        # only report a request some built reference actually carries
        refd = [i for i, f in refs if any(p.endswith("/" + name) or p.endswith(":" + name)
                                          for p in f)]
        if refd:
            add("unregistered-viewer-request", req, "info", None,
                f"requested at {where}; carried by {len(refd)} references but "
                f"no registered artifact names it: add it to ARTIFACTS")

    # -- 3. reference matrix the registry does not know ----------------------
    reg_keys = {f"{a.root}:{a.rel}" for a in ARTIFACTS}
    reg_keys |= {k + ".gz" for k in reg_keys}
    if refs:
        counts: dict[str, int] = {}
        for _, f in refs:
            for p in f:
                counts[p] = counts.get(p, 0) + 1
        need = max(2, int(REFERENCE_SHARE * len(refs) + 0.999))
        for p, c in sorted(counts.items()):
            if c < need or p in files or p in reg_keys:
                continue
            # only data manifests vote: sample, texture and glb families are
            # content a mod does or does not own, not artifacts it owes
            if not p.endswith(".json") or "<level>/" in p or p.count("/") > 3 \
                    or "/hud/" in p or ".json." in p \
                    or p[2:].startswith(REFERENCE_IGNORE):
                continue
            add("reference-has-it-unregistered", p[2:], "minor", None,
                f"{c}/{len(refs)} built references carry it and nothing in "
                f"ARTIFACTS names it")

    # -- 3b. sample files the sound tables name -------------------------------
    for tbl in ("sounds/weapons.json", "sounds/soldier.json"):
        text = (tree.models / tbl).read_text(errors="replace") \
            if (tree.models / tbl).is_file() else ""
        names = set(re.findall(r'"([^"/]+\.mp3)"', text))
        absent = sorted(n for n in names if not (tree.models / "sounds" / n).is_file())
        if absent:
            add("sound-table-sample-missing", f"{tbl}: {len(absent)} samples",
                "major", "extract_weapon_sounds.py" if "weapons" in tbl
                else "extract_soldier_sounds.py",
                "named by the table, absent from models/sounds: "
                + ", ".join(absent[:8]))

    # -- 4. per-level files ---------------------------------------------------
    manifest = load_json(tree.maps / "maps.json") or []
    entries = {e.get("name", "").lower(): e for e in manifest}
    for lv in tree.levels:
        for rel, script, sev in LEVEL_CORE:
            if not (tree.maps / lv / rel).is_file():
                add("level-file-missing", f"{lv}/{rel}", sev, script,
                    "every level of every built reference carries it", lv)
        if lv not in entries:
            add("level-not-in-maps-json", lv, "major", "extract_maps_all.py",
                "the Maps tab lists only maps.json entries", lv)
    for name, e in entries.items():
        lv = (e.get("glb") or "").split("/")[0]
        loading = e.get("loading") or {}
        bg = loading.get("background")
        if not loading:
            add("level-no-loading-record", name, "major",
                "extract_loading_assets.py",
                "maps.json entry has no `loading` block: the load screen "
                "falls back to vanilla's western plate", lv or name)
        elif bg and not (tree.maps / bg).is_file():
            add("level-loading-background-missing", f"{name}: {bg}", "major",
                "extract_loading_assets.py",
                "loading.background does not resolve under the maps tree",
                lv or name)
        mus = loading.get("music")
        if mus and not (tree.maps / mus).is_file():
            add("level-loading-music-missing", f"{name}: {mus}", "minor",
                "extract_loading_assets.py",
                "loading.music does not resolve under the maps tree", lv or name)
        for key in ("glb", "report"):
            if e.get(key) and not (tree.maps / e[key]).is_file():
                add("maps-json-entry-file-missing", f"{name}: {e[key]}", "blocker",
                    "extract_maps_all.py", f"maps.json {key} does not resolve",
                    lv or name)
    for d in sorted(p.name for p in tree.maps.iterdir()
                    if p.is_dir() and p.name != "_shared" and p.name != "mods") \
            if tree.maps.is_dir() else []:
        if d not in tree.levels and not (tree.maps / d / "scene.json").is_file():
            if any(tree.maps.joinpath(d).iterdir()):
                add("level-dir-without-scene", d, "major", "extract_maps_all.py",
                    "a level directory with files but no scene.json "
                    "(an interrupted bake)", d)

    # -- 4b. a vehicle a level spawns has a glb in THIS tree -----------------
    # The replay reads each recorded hull from `models/mods/<id>/` and hides
    # the level's baked copy, so a template the mod tree lacks draws nothing
    # (Raid on Agheila's Willy, flak38 and Spitfire, 2026-10-11). Tree-only:
    # vanilla's catalogue says which templates are a drawable model at all.
    if base_id != "bf1942":
        van = load_json(VIEWER / "models" / "models.json")
        mine = load_json(tree.models / "models.json")
        if isinstance(van, list) and isinstance(mine, list):
            van_names = {str(e.get("name", "")).lower(): str(e.get("name", ""))
                         for e in van if isinstance(e, dict)}
            my_names = {str(e.get("name", "")).lower() for e in mine if isinstance(e, dict)}
            where: dict[str, list[str]] = {}
            for lv in tree.levels:
                sc = load_json(tree.maps / lv / "scene.json") or {}
                for o in sc.get("objectSpawns") or []:
                    for t in {*(o.get("templates") or {}).values(), o.get("vehicle")}:
                        tl = str(t or "").lower()
                        if tl in van_names and tl not in my_names:
                            where.setdefault(tl, [])
                            if lv not in where[tl]:
                                where[tl].append(lv)
            for tl, lvls in sorted(where.items()):
                add("level-vehicle-model-not-in-tree", van_names[tl], "major",
                    "extract_all.py",
                    f"spawned on {len(lvls)} baked level(s) ({', '.join(lvls[:4])}"
                    f"{' ...' if len(lvls) > 4 else ''}) and absent from this "
                    f"tree's models.json: a replay draws nothing for it", lvls[0])

    # -- 5. what the install defines ------------------------------------------
    if chain:
        installed = own_levels(game) if base_id != "bf1942" else []
        # a vanilla-name override (Aberdeen in FH) is the mod's own level too
        for stem in installed:
            if stem not in tree.levels:
                add("level-not-extracted", stem, "major", "extract_maps_all.py",
                    "the mod's own level archive ships it and the tree has "
                    "no baked scene for it", stem)
        installed_set = set(installed)
        for lv in tree.levels:
            arc = game.level_archive(lv)
            sc = load_json(tree.maps / lv / "scene.json") or {}
            if arc is not None:
                names = [n.replace("\\", "/").lower() for n in arc.entries]
                if any(n.endswith("textures/ingamemap.dds")
                       or n.endswith("texture/ingamemap.dds") for n in names) \
                        and not (tree.maps / lv / "minimap" / "minimap.png").is_file():
                    add("level-minimap-not-extracted", lv, "major",
                        "extract_map.py", "the archive ships InGameMap.dds", lv)
                offered = level_gametypes(game, lv)
                baked = {k.lower() for k in (sc.get("gameTypes") or {})}
                alias = {"coop": "coop", "singleplayer": "coop"}
                missing = sorted(m for m in offered
                                 if alias.get(m, m) not in baked
                                 and m not in baked)
                for m in missing:
                    add("level-mode-offered-not-baked", f"{lv}: {m}", "major",
                        "extract_map.py",
                        "the level's GameTypes/ lists the mode but scene.json "
                        "gameTypes lacks it", lv)
                if not (sc.get("briefing") or {}).get("objectives") and any(
                        n.endswith("menu/init.con") for n in names):
                    add("level-briefing-empty", lv, "minor", "extract_map.py",
                        "the archive ships Menu/Init.con", lv)

        directives = init_directives(chain)
        # the mods.json row
        mods = (load_json(VIEWER / "models" / "mods.json") or {}).get("mods", [])
        row = next((m for m in mods if m.get("id") == base_id), None)
        if row is None and base_id != "bf1942":
            add("mods-json-row-missing", base_id, "blocker",
                "build_mods_manifest.py", "the mod picker lists mods.json rows")
        elif row:
            counts = row.get("counts") or {}
            mj = load_json(tree.models / "models.json")
            real_models = len(mj) if isinstance(mj, list) else None
            if real_models is not None and counts.get("models") != real_models:
                add("mods-json-count-stale", f"models {counts.get('models')} != "
                    f"{real_models}", "minor", "build_mods_manifest.py",
                    "the picker's count is read from mods.json")
            if counts.get("maps") != len(manifest):
                add("mods-json-count-stale", f"maps {counts.get('maps')} != "
                    f"{len(manifest)}", "minor", "build_mods_manifest.py",
                    "the picker's count is read from mods.json")
            icon = row.get("icon")
            if icon and not (VIEWER / icon).is_file():
                add("mod-icon-missing", icon, "minor", None,
                    "mods.json names an icon file that is not under viewer/")
            want_v = directives.get("setcustomgameversion")
            if want_v and base_id != "bf1942" and row.get("version") != want_v:
                add("mods-json-version-differs", f"{row.get('version')} != {want_v}",
                    "minor", "build_mods_manifest.py",
                    "init.con game.setCustomGameVersion")
            want_u = directives.get("setcustomgameurl")
            if want_u and base_id != "bf1942" and row.get("url") != want_u:
                add("mods-json-url-differs", f"{row.get('url')} != {want_u}",
                    "minor", "build_mods_manifest.py",
                    "init.con game.setCustomGameUrl")
        ico = next((p for p in (chain[0].glob("*.ico"))), None)
        if ico is not None and not (VIEWER / "icons" / "mods" / f"{base_id}.png").is_file():
            add("mod-icon-missing", f"icons/mods/{base_id}.png", "minor", None,
                f"the install ships {ico.name}")

        # hud pack integrity and the level-menu chain
        if base_id != "bf1942":
            hud = tree.maps / "_shared" / "hud"
            pack = load_json(hud / "pack.json") or {}
            for rel in pack.get("files", []):
                if not (hud / rel).is_file():
                    add("hud-pack-file-missing", rel, "major",
                        "extract_hud_mods.py", "pack.json lists it")
            ml = load_json(hud / "menu" / "menu-levels.json") or {}
            listed = {l.get("dir") for l in ml.get("levels", [])}
            for stem in sorted(set(installed) - listed):
                add("menu-levels-missing-level", stem, "major",
                    "extract_hud_mods.py",
                    "the level is in the mod's own levels folder but not in "
                    "the Instant Battle list", stem)
            base_hud = VIEWER / "maps" / "_shared" / "hud"
            inherits = pack.get("inherits")
            parent_huds = [base_hud]
            if inherits and inherits not in ("bf1942", None):
                parent_huds.insert(0, VIEWER / "maps" / "mods" / inherits / "_shared" / "hud")
            for l in ml.get("levels", []):
                t = l.get("thumbnail")
                if not t:
                    add("level-thumbnail-unnamed", l.get("dir", "?"), "major",
                        "extract_hud_mods.py", "menu-levels.json names none",
                        l.get("dir", ""))
                    continue
                rels = [hud / "menu" / t] + [p / "menu" / t for p in parent_huds]
                if not any(r.is_file() for r in rels):
                    add("level-thumbnail-unresolved", l.get("dir", "?"), "major",
                        "extract_hud_mods.py",
                        f"{t} is in neither the mod's pack nor its parents'",
                        l.get("dir", ""))
            # nation flags the level list names must resolve along the chain
            seen_flags: set[str] = set()
            for l in ml.get("levels", []):
                for side in ("axis", "allied"):
                    fl = (l.get(side) or {}).get("flag")
                    if fl and fl not in seen_flags:
                        seen_flags.add(fl)
                        rels = [hud / f"{fl}.png"] + [p / f"{fl}.png" for p in parent_huds]
                        rels += [hud / "menu" / "textures" / f"{fl}.png"]
                        if not any(r.is_file() for r in rels):
                            add("nation-flag-unresolved", fl, "major",
                                "extract_hud_mods.py",
                                f"menu-levels.json names {fl} for "
                                f"{l.get('dir')} and no pack in the chain has it",
                                l.get("dir", ""))
            # menu textures the mod's menu.rfa ships that the pack lacks
            try:
                from bf42.rfa import RfaArchive, find_archives_dir
                ad = find_archives_dir(chain[0])
                mrfa = ci_child(ad, "menu.rfa") if ad else None
                if mrfa is not None:
                    have = {p.stem.lower() for p in hud.rglob("*.png")}
                    for p in parent_huds:
                        have |= {q.stem.lower() for q in p.rglob("*.png")}
                    # the pack files a basename that two directories share
                    # as `<dir>_<name>` (extract_hud_pack.dir_glob_renames)
                    want: dict[str, str] = {}
                    for n in RfaArchive(mrfa).entries:
                        nl = n.replace("\\", "/")
                        low = nl.lower()
                        if low.startswith("menu/texture/") and \
                                low.endswith((".dds", ".tga")) and \
                                not low.startswith("menu/texture/load/"):
                            pth = Path(nl)
                            want[f"{pth.parent.name.lower()}_{pth.stem.lower()}"] = \
                                pth.stem.lower()
                    miss = sorted({stem for q, stem in want.items()
                                   if stem not in have and q not in have})
                    if miss:
                        add("menu-texture-not-in-pack", f"{len(miss)} textures",
                            "minor", "extract_hud_mods.py",
                            "menu.rfa ships them and no pack in the chain "
                            "carries a png of that name (or `<dir>_<name>`): "
                            + ", ".join(miss[:200])
                            + (" ..." if len(miss) > 200 else ""))
            except Exception:
                pass

        # the chain's catalogue against the tree's models.json: what
        # `extract_all.py` would export for this mod and did not. A tree built
        # with `--own` holds only the pack's own templates, and every page
        # that reads a hull, a weapon or a pickup from `models/mods/<id>/`
        # (a replay, the first-person rig, a dropped kit) finds nothing for
        # the 100-odd vanilla ones the mod's levels field.
        if base_id != "bf1942" and (tree.models / "models.json").is_file():
            try:
                from extract_all import select_templates
                from extract_models import DEFAULT_GAME_DIR
                _entries, selected, _skipped = select_templates(
                    DEFAULT_GAME_DIR, game.mod)
            except Exception as exc:  # the install is absent or unreadable
                selected = []
                ctx["chain catalogue"] = f"not read: {exc}"
            mj = load_json(tree.models / "models.json")
            have_models = {str(e.get("name", "")).lower() for e in mj
                           if isinstance(e, dict)} if isinstance(mj, list) else set()
            absent = sorted(n for n in selected if n.lower() not in have_models)
            ctx["chain templates"] = len(selected)
            if absent:
                add("chain-template-not-extracted",
                    f"{len(absent)} of {len(selected)} templates", "major",
                    "extract_all.py",
                    "the mod's chain defines them and models.json lacks them "
                    "(extracted with --own?): " + ", ".join(absent[:200])
                    + (" ..." if len(absent) > 200 else ""))

        # the stats site's own per-mod assets (tournament-images/, gitignored,
        # published separately): dossiers, kit icons and map art
        site = HERE.parents[1] / "tournament-images"
        if site.is_dir() and base_id != "bf1942" and installed:
            dos = site / "dossiers" / base_id
            have_d = {p.stem for p in dos.glob("*.json")} if dos.is_dir() else set()
            lacking = sorted(set(installed) - {h.lower() for h in have_d})
            if lacking:
                add("site-dossier-missing", f"{len(lacking)} of {len(installed)} levels",
                    "major", "scripts/extract_map_dossiers.py",
                    "tournament-images/dossiers/" + base_id + " lacks: "
                    + ", ".join(lacking[:10]))
            kits = site / "hud" / "kits" / base_id
            if not kits.is_dir() or not any(kits.iterdir()):
                add("site-kit-icons-missing", f"hud/kits/{base_id}", "major",
                    "scripts/extract_hud_assets.py",
                    "the stats site's kit badges resolve here before vanilla's")
            art = site / "maps"
            mm = load_json(art / "manifest.json") or {}
            entry = (mm.get("mods") or {}).get(base_id) or {}
            path = entry.get("searchPath") or [base_id, "bf1942"]
            def has_art(stem):
                return any(stem in ((mm.get("mods") or {}).get(m) or {}).get("maps", {})
                           for m in path)
            noart = sorted(s2 for s2 in installed if not has_art(s2))
            if noart:
                add("site-map-art-unresolved", f"{len(noart)} of {len(installed)} levels",
                    "minor", "scripts/extract-bf1942-map-art.py",
                    "no thumbnail/minimap along " + " -> ".join(path) + ": "
                    + ", ".join(noart[:10]))
    return out


# viewer requests that are not per-mod artifacts (page-local, vanilla-only,
# generated at runtime, or a per-level file the level checks above cover)
_KNOWN_NON_ARTIFACT = {
    "symbols.json", "hud-layout.json", "scopes.json", "gaits.json",
    "minimap-icons.json", "minimap-level-icons.json", "soldier-icons.json",
    "spawn-layout.json", "scoreboard-layout.json", "controls-layout.json",
    "custom-game-layout.json", "menu-layout.json", "main-menu-layout.json",
    "menu-levels.json", "score-settings.json", "radio-layout.json",
    "chat-layout.json", "bf1942.json", "standard6.json", "package.json",
    "heightmap.png",
}
