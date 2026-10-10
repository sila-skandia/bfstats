#!/usr/bin/env python3
"""The per-mod extraction recipe as code, with gates that fail closed.

    python3 mod_pipeline.py steps --mod FH                  # the ordered recipe for a mod
    python3 mod_pipeline.py run --mod FH --all-own-levels   # extract, then gate
    python3 mod_pipeline.py run --mod FH --dry-run          # plan + read-only gates
    python3 mod_pipeline.py verify --mod FH                 # idempotent verification only
    python3 mod_pipeline.py gates --mod FHSW                # scorecard from the gates alone
    python3 mod_pipeline.py prose --write-readme            # regenerate the README step table

One source of truth. `STEPS` below is the recipe: each step names its command,
the files it needs, the files it must produce (with a minimum count), and the
steps it has to follow. `~/.cache/mod-bake/mod.sh` and the memory notes are
replaced by this list; the README table is generated from it.

Properties the throwaway script did not have:

* resumable and idempotent: a state file records each step's status; a step
  that is `done`, whose outputs still verify and whose command is unchanged,
  is skipped (`--force-steps` redoes them);
* a step's outputs are checked, not assumed: an extractor that exits 0 and
  wrote nothing is a failed step;
* a subset model re-extract never rewrites `models.json`: it runs into a
  scratch directory and copies only the changed `.glb`/`.gz`/`.report.json`
  (`reextract_models_subset`), and a full `extract_all` run has its thumb keys
  put back afterwards (`ThumbGuard`);
* a free-disk guard kills a step's process group below `--min-free-gb`;
* a step that opens a browser runs under `flock /tmp/claude-1000/chromium.lock`
  against a viewer server on its own port (never 5273, the owner's);
* after extraction the audits run as subprocesses and their JSON is merged
  into a per-level, per-mod scorecard whose tiers fail closed: a gate that did
  not run, or is not installed, can only produce `unverified`.

Nothing here publishes. Publishing is `scripts/publish-mesh-delta.py`, by hand.
"""

from __future__ import annotations

import argparse
import copy
import datetime as _dt
import fnmatch
import glob as _glob
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
VIEWER = HERE / "viewer"
CHROMIUM_LOCK = "/tmp/claude-1000/chromium.lock"
OWNER_PORT = 5273
DEFAULT_PORT = 5312
DEFAULT_MIN_FREE_GB = 15.0
OUT_ROOT = HERE / "out" / "mod-pipeline"
GUARD_POLL_S = 10.0   # how often a running step is checked against the free-disk floor

# ---------------------------------------------------------------------------
# per-mod configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ModConfig:
    """What differs between mods. Everything else is the same recipe."""

    id: str                      # tree id: viewer/{models,maps}/mods/<id>
    install: str                 # folder under the game's Mods/
    kit_flags: tuple[str, ...] = ()   # extra extract_kits.py flags
    level_all: bool = True       # pass --level-all to extract_all (30k reskin glbs on a big mod)
    pose_matrix: bool = False    # DC mods: also the soldier x weapon matrix export
    note: str = ""


MODS: dict[str, ModConfig] = {m.id: m for m in (
    ModConfig("fh", "FH", note="first customer; six levels baked 2026-10-10"),
    ModConfig("fhsw", "FHSW", kit_flags=("--no-pickups",), level_all=False,
              note="--level-all wrote 60,433 files and filled the disk (2026-09-30)"),
    ModConfig("eod", "EoD", level_all=False, note="~1.5 h per full pass; parked"),
    ModConfig("desertcombat", "DesertCombat", pose_matrix=True,
              note="mod language `Iraqi` must be in LANGUAGE_NATIONS"),
    ModConfig("dc_final", "DC_Final", pose_matrix=True),
    ModConfig("bf1918", "bf1918", level_all=False),
    ModConfig("gcmod", "GCMOD"),
    ModConfig("interstate", "interstate"),
    ModConfig("pirates", "Pirates"),
    ModConfig("xpack1", "XPack1"),
    ModConfig("xpack2", "XPack2"),
)}


def resolve_mod(arg: str) -> ModConfig:
    """`--mod` takes a tree id (`fh`) or an install folder (`FH`), any case."""
    key = arg.lower()
    for cfg in MODS.values():
        if key in (cfg.id.lower(), cfg.install.lower()):
            return cfg
    raise SystemExit(f"unknown mod {arg!r}; configured: "
                     + ", ".join(f"{c.id} ({c.install})" for c in MODS.values())
                     + ". Add a ModConfig to mod_pipeline.MODS.")


# ---------------------------------------------------------------------------
# the recipe
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Step:
    """One recipe step.

    `cmds` are argv templates. Tokens: `{M}` install name, `{id}` tree id,
    `{models}`, `{maps}`, `{shared}` tree roots (relative to this folder),
    `{jobs}`, `{port}`, `{scratch}`; a token that is exactly `{levels...}`,
    `{kit_flags...}`, `{level_all...}` or `{soldiers...}` expands to several
    arguments.

    `needs` are paths that must exist before the step may run. `outputs` are
    `(glob, minimum)` pairs a finished step must satisfy; the minimum is an
    int or the name of a context count (`levels`, `models`). `after` names the
    steps that must precede it in the list (checked by the tests, not only
    documented). `fixes` is the defect class that goes unnoticed without it.
    """

    name: str
    title: str
    cmds: tuple[tuple[str, ...], ...] = ()
    needs: tuple[str, ...] = ()
    outputs: tuple[tuple[str, int | str], ...] = ()
    after: tuple[str, ...] = ()
    kind: str = "extract"            # extract | verify
    chromium: bool = False
    disk_guard: bool = False
    touches_models: bool = False     # may rewrite models.json: thumb keys are kept
    when: str = ""                   # config attribute that must be truthy
    action: str = ""                 # python hook instead of (or after) cmds
    fixes: str = ""


T = tuple


def _s(*a, **k) -> Step:
    return Step(*a, **k)


STEPS: tuple[Step, ...] = (
    _s("models", "Vehicle, weapon, soldier and kit-part models",
       cmds=(("python3", "extract_all.py", "--mod", "{M}", "{level_all...}",
              "--configuration-all", "--cockpit", "-j", "{jobs}", "--out", "{models}"),),
       outputs=(("{models}/models.json", 1), ("{models}/*.glb", "models")),
       disk_guard=True, touches_models=True,
       fixes="missing templates; a subset re-run would strip thumbs (see ThumbGuard)"),
    _s("levels", "Level bakes: scene.glb, scene.json, terrain, sky, sounds, vehicle tables",
       cmds=(("python3", "extract_maps_all.py", "--mod", "{M}", "--levels", "{levels...}",
              "-j", "{jobs}", "--out", "{maps}"),),
       needs=("{models}/models.json",),
       outputs=(("{maps}/maps.json", 1), ("{maps}/*/scene.json", "levels"),
                ("{maps}/*/scene.glb", "levels"), ("{maps}/*/scene.glb.gz", "levels"),
                ("{shared}/vehicle-sounds.json", 1)),
       after=("models",), disk_guard=True,
       fixes="inherited vanilla levels baked as the mod's; promote wiping load.webp"),
    _s("flag_cloth", "Pose vehicle and static flag cloths in the baked glbs",
       cmds=(("python3", "patch_flag_cloth.py", "--mod", "{id}"),),
       after=("models", "levels"),
       fixes="flags drawn as upside-down sheets at the origin of a mast"),
    _s("optimise", "Move glb textures into the shared store, write .glb.gz",
       cmds=(("python3", "optimise_mesh.py", "{models}", "{maps}", "-j", "{jobs}"),),
       outputs=(("{maps}/*/scene.glb.gz", "levels"),),
       after=("levels", "flag_cloth"),
       fixes="a re-bake or a failed pair skips the optimise pass; the publisher refuses a stale .gz"),
    _s("kits", "Kits: classes, nations, loadouts, pickups, worn parts",
       cmds=(("python3", "extract_kits.py", "--mod", "{M}", "{kit_flags...}",
              "--maps", "{maps}/maps.json", "--out", "{models}"),),
       needs=("{maps}/maps.json",), outputs=(("{models}/kits.json", 1),),
       after=("levels",), touches_models=True,
       fixes="without --maps the inherited vanilla levels bind vanilla armies onto the kits page"),
    _s("poses_kit", "Soldier poses a player of the mod is ever seen in",
       cmds=(("python3", "extract_pose.py", "--mod", "{M}", "--kit-poses",
              "--out", "{models}/poses", "-j", "{jobs}"),),
       needs=("{models}/kits.json",), outputs=(("{models}/poses/*.pose.glb", 1),),
       after=("kits",), disk_guard=True),
    _s("poses_shared", "Shared gait, parachute, swim, death and explosion clips",
       cmds=(("python3", "extract_pose.py", "--mod", "{M}", "--shared-assets",
              "--out", "{models}/poses"),),
       needs=("{models}/kits.json",), outputs=(("{models}/poses/gaits/*", 1),),
       after=("poses_kit",)),
    _s("poses_matrix", "Soldier x weapon matrix export (replay poses for non-kit weapons)",
       cmds=(("python3", "extract_pose.py", "--mod", "{M}", "--matrix", "--export",
              "--split-only", "--soldiers", "{soldiers...}", "--out", "{models}/poses",
              "-j", "{jobs}"),),
       needs=("{models}/kits.json",), after=("poses_shared",), when="pose_matrix",
       disk_guard=True),
    _s("effects", "Shared effect library (effects.glb) and its sounds",
       cmds=(("python3", "extract_effects.py", "--mod", "{M}", "--out", "{shared}"),),
       outputs=(("{shared}/effects.glb", 1),), after=("levels",)),
    _s("loading", "Loading screens, chrome and music; loading block in maps.json",
       cmds=(("python3", "extract_loading_assets.py", "--output-dir", "{maps_root}",
              "--mod", "{id}"),),
       outputs=(("{shared}/load/*", 1),), after=("levels",), touches_models=False,
       fixes="levels with no loading screen along the mod chain"),
    _s("loadouts", "What each level deals each side, and what each kit puts in hand",
       cmds=(("python3", "extract_loadouts.py", "--mod", "{M}",
              "--out", "{shared}/loadouts.json"),),
       outputs=(("{shared}/loadouts.json", 1),), after=("levels",),
       fixes="soldiers spawn bare-handed and silent"),
    _s("weapon_sounds", "Weapon fire, reload and bolt sounds",
       cmds=(("python3", "extract_weapon_sounds.py", "--mod", "{M}", "--out", "{models}/sounds"),),
       outputs=(("{models}/sounds/*.mp3", 1),), after=("models",)),
    _s("soldier_sounds", "Soldier bail-out sounds and soldier.json",
       cmds=(("python3", "extract_soldier_sounds.py", "--mod", "{M}", "--out", "{models}"),),
       outputs=(("{models}/sounds/soldier.json", 1),), after=("weapon_sounds",)),
    _s("collision", "Collision meshes",
       cmds=(("python3", "extract_collision_meshes.py", "--mod", "{M}", "--out", "{shared}"),),
       outputs=(("{shared}/collision-meshes.json", 1),), after=("models",)),
    _s("vehicle_ai", "Which vehicles and fixed guns a bot may board",
       cmds=(("python3", "extract_vehicle_ai.py", "--mod", "{M}",
              "--out", "{shared}/vehicle-ai.json"),),
       outputs=(("{shared}/vehicle-ai.json", 1),), after=("levels",),
       fixes="bots never board a vehicle on the mod's levels"),
    _s("trees", "Tree billboard cards",
       cmds=(("python3", "extract_tree_billboards.py", "--mod", "{M}", "--out", "{shared}"),),
       outputs=(("{shared}/trees.json", 1),), after=("levels",),
       fixes="trees.json 404"),
    _s("bot_names", "Names a server gives bots per level",
       cmds=(("python3", "extract_bot_names.py", "--mod", "{M}",
              "--out", "{shared}/bot-names.json"),),
       outputs=(("{shared}/bot-names.json", 1),), after=("levels",)),
    _s("menu_music", "The mod's own menu loop",
       cmds=(("python3", "extract_menu_music.py", "--mod", "{id}", "--out", "{maps_root}"),),
       outputs=(("{shared}/music/menu.mp3", 1),), after=("levels",),
       fixes="the play front end plays vanilla's menu loop"),
    _s("menu_movie", "The front-end background movie",
       cmds=(("python3", "extract_menu_movie.py", "--mod", "{id}", "--out", "{maps_root}"),),
       outputs=(("{shared}/movies/*", 1),), after=("levels",)),
    _s("hud", "HUD pack: scoreboard, main menu, controls, scopes, soldier and minimap icons",
       cmds=(("python3", "extract_hud_mods.py", "--mod", "{M}"),),
       outputs=(("{shared}/hud/pack.json", 1),), after=("levels",),
       fixes="a mod with no HUD pack draws vanilla's"),
    _s("voices", "Radio menu, capture announcer and soldier voices",
       cmds=(("python3", "extract_radio.py", "--mod", "{M}", "--out", "{scratch}"),
             ("python3", "extract_capture_voices.py", "--mod", "{M}", "--out", "{scratch}"),
             ("python3", "extract_soldier_voices.py", "--mod", "{M}", "--out", "{scratch}")),
       outputs=(("{shared}/voices/languages.json", 1),), after=("levels",),
       action="copy_voices",
       fixes="silent radio; a language missing from LANGUAGE_NATIONS extracts nothing"),
    _s("ctf_voices", "Capture the Flag announcer, per nation (voices/ctf-sounds.json)",
       cmds=(("python3", "extract_ctf_voices.py", "--mod", "{M}", "--out", "{shared}"),),
       outputs=(("{shared}/voices/ctf-sounds.json", 1),), after=("voices",),
       fixes="a CTF round with no announcer"),
    _s("deployables", "Hand weapons whose round puts an object in the world",
       cmds=(("python3", "extract_deployables.py", "--mod", "{M}", "--out", "{models}"),),
       outputs=(("{models}/deployables.json", 1),), after=("models",),
       fixes="DC's mortar fired nothing; deployables.json missing (FH 2026-10-11)"),
    _s("viewmodels", "First-person arms rigs and index.json",
       cmds=(("python3", "extract_viewmodel.py", "--mod", "{M}",
              "--kits", "{models}/kits.json", "--maps", "{maps}/maps.json",
              "--out", "{models}/viewmodels"),),
       needs=("{models}/kits.json", "{maps}/maps.json"),
       outputs=(("{models}/viewmodels/index.json", 1),
                ("{models}/viewmodels/*.fp.glb", 1)),
       after=("kits", "levels"), disk_guard=True,
       fixes="weapons float in first person with no hands; a failed pair skips the optimise pass"),
    _s("manifest", "Registry models/mods.json, so thumbs render the mod's models",
       cmds=(("python3", "build_mods_manifest.py"),),
       outputs=(("{models_root}/mods.json", 1),),
       after=("models", "levels", "kits", "viewmodels"),
       fixes="thumbs before the manifest render vanilla's 99 models"),
    _s("thumbs", "Browse thumbnails, stamped into models.json",
       cmds=(("node", "shoot.mjs", "--thumbs", "--url", "http://127.0.0.1:{port}/?mod={id}",
              "--out", "{models}/thumbs", "--manifest", "{models}/models.json",
              "-j", "2", "--skip-existing"),),
       outputs=(("{models}/thumbs/*", "models"),), after=("manifest",),
       chromium=True, touches_models=True,
       fixes="a re-run of extract_all strips the thumb keys"),
    _s("manifest_final", "Registry again: counts are stale after any later re-bake",
       cmds=(("python3", "build_mods_manifest.py"),),
       outputs=(("{models_root}/mods.json", 1),), after=("thumbs",)),
)

# Extractors that are deliberately not steps, with the step or script that runs them.
# `tests/test_mod_pipeline.py` fails on any `extract_*.py` that is neither a step
# nor listed here, so a new extractor cannot be forgotten.
NOT_A_STEP: dict[str, str] = {
    "extract_models.py": "run by extract_all.py (step models); subsets go through reextract_models_subset",
    "extract_map.py": "run by extract_maps_all.py (step levels); also writes pathfinding/",
    "extract_search_maps.py": "extract_map.py writes the same folder on a full bake; a repair tool",
    "extract_vehicle_sounds.py": "extract_maps_all.py writes it after its levels (step levels)",
    "extract_vehicle_sonar.py": "extract_maps_all.py writes it after its levels (step levels)",
    "extract_vehicle_spotting.py": "extract_maps_all.py writes it after its levels (step levels)",
    "extract_hud_pack.py": "extract_hud_mods.py (step hud)",
    "extract_spawn_layout.py": "extract_hud_mods.py (step hud)",
    "extract_hud_layout.py": "extract_hud_mods.py (step hud)",
    "extract_menu_layout.py": "extract_hud_mods.py (step hud)",
    "extract_main_menu_layout.py": "extract_hud_mods.py (step hud)",
    "extract_controls_menu_layout.py": "extract_hud_mods.py (step hud)",
    "extract_scoreboard_layout.py": "extract_hud_mods.py (step hud)",
    "extract_console_font.py": "extract_hud_mods.py (step hud)",
    "extract_score_settings.py": "extract_hud_mods.py (step hud)",
    "extract_custom_game_layout.py": "vanilla front-end chrome, not per mod (build_mods_manifest.MOD_INFO carries the mod's text)",
    "extract_profile_controls.py": "vanilla profile/controls defaults, not per mod",
}

# Verification steps: idempotent and read-only on the tree (they may rewrite a
# file to the bytes it already holds). `verify` runs exactly these, then the
# gates. Each is a callable in VERIFY_HOOKS; they are listed here so the README
# table and the ordering tests see them.
VERIFY_STEPS: tuple[Step, ...] = (
    _s("v_outputs", "Every step's declared outputs exist with their minimum counts",
       kind="verify", action="check_all_outputs"),
    _s("v_counts", "mods.json counts equal models.json / maps.json / poses on disk",
       kind="verify", action="check_registry_counts"),
    _s("v_gz", "Every glb has a fresh .glb.gz beside it (the publisher refuses otherwise)",
       kind="verify", action="check_gz_pairs"),
    _s("v_thumbs", "Every models.json entry names a thumb that exists",
       kind="verify", action="check_thumb_keys"),
)


def step_by_name(name: str) -> Step:
    for s in (*STEPS, *VERIFY_STEPS):
        if s.name == name:
            return s
    raise KeyError(name)


# ---------------------------------------------------------------------------
# context: paths, levels, template expansion
# ---------------------------------------------------------------------------


def tree_paths(mod_id: str) -> dict[str, Path]:
    """Roots for a tree id. Vanilla (`bf1942`) lives in `models/` and `maps/`."""
    if mod_id == "bf1942":
        models, maps = VIEWER / "models", VIEWER / "maps"
    else:
        models, maps = VIEWER / "models" / "mods" / mod_id, VIEWER / "maps" / "mods" / mod_id
    return {"models": models, "maps": maps, "shared": maps / "_shared",
            "models_root": VIEWER / "models", "maps_root": VIEWER / "maps"}


@dataclass
class Context:
    cfg: ModConfig
    jobs: int = 4
    port: int = DEFAULT_PORT
    levels: list[str] = field(default_factory=list)       # level directory names (lower case)
    level_names: list[str] = field(default_factory=list)  # level names, as extract_maps_all takes them
    scratch: Path | None = None
    game_dir: Path | None = None
    paths: dict[str, Path] = field(default_factory=dict)
    min_free_gb: float = DEFAULT_MIN_FREE_GB
    level_all_ok: bool = True
    behaviour_args: list[str] = field(default_factory=list)   # e.g. ["--quick"]

    def __post_init__(self):
        if not self.paths:
            self.paths = tree_paths(self.cfg.id)

    # counts a step's minimum may name
    def count(self, key: str) -> int:
        if key == "levels":
            return len(self.levels)
        if key == "models":
            mp = self.paths["models"] / "models.json"
            try:
                return max(1, len(json.loads(mp.read_text())))
            except (OSError, ValueError):
                return 1
        raise KeyError(key)

    def soldiers(self) -> list[str]:
        try:
            kits = json.loads((self.paths["models"] / "kits.json").read_text())["kits"]
        except (OSError, ValueError, KeyError):
            return []
        names = {s for k in kits for s in k.get("soldiers", [])}
        return sorted(names)


def _rel(p: Path) -> str:
    try:
        return str(p.relative_to(HERE))
    except ValueError:
        return str(p)


def expand(template: str, ctx: Context) -> str:
    out = template
    for key in ("models", "maps", "shared", "models_root", "maps_root"):
        out = out.replace("{" + key + "}", _rel(ctx.paths[key]))
    return (out.replace("{M}", ctx.cfg.install).replace("{id}", ctx.cfg.id)
            .replace("{jobs}", str(ctx.jobs)).replace("{port}", str(ctx.port))
            .replace("{scratch}", str(ctx.scratch or "<scratch>")))


def build_argv(step: Step, ctx: Context) -> list[list[str]]:
    """Every command of the step as a concrete argv, one per entry of `cmds`."""
    multi: dict[str, list[str]] = {
        "{levels...}": list(ctx.level_names or ctx.levels),
        "{kit_flags...}": list(ctx.cfg.kit_flags),
        "{level_all...}": ["--level-all"] if (ctx.cfg.level_all and ctx.level_all_ok) else [],
        "{soldiers...}": ctx.soldiers(),
    }
    argvs = []
    for cmd in step.cmds:
        argv: list[str] = []
        for tok in cmd:
            if tok in multi:
                argv.extend(multi[tok])
            else:
                argv.append(expand(tok, ctx))
        argvs.append(argv)
    return argvs


def command_hash(argvs: list[list[str]]) -> str:
    return hashlib.sha1(json.dumps(argvs).encode()).hexdigest()[:12]


def check_outputs(step: Step, ctx: Context) -> list[dict]:
    """Each declared output with what was found and whether it meets its minimum."""
    rows = []
    for pattern, minimum in step.outputs:
        need = ctx.count(minimum) if isinstance(minimum, str) else minimum
        full = HERE / expand(pattern, ctx)
        found = len(_glob.glob(str(full)))
        rows.append({"pattern": expand(pattern, ctx), "found": found,
                     "minimum": need, "ok": found >= need})
    return rows


def check_needs(step: Step, ctx: Context) -> list[str]:
    return [expand(n, ctx) for n in step.needs if not (HERE / expand(n, ctx)).exists()]


# ---------------------------------------------------------------------------
# levels
# ---------------------------------------------------------------------------


def baked_levels(ctx: Context) -> tuple[list[str], list[str]]:
    """(directory names, level names) listed in the tree's maps.json."""
    mp = ctx.paths["maps"] / "maps.json"
    try:
        rows = json.loads(mp.read_text())
    except (OSError, ValueError):
        return [], []
    dirs, names = [], []
    for r in rows:
        d = (r.get("report") or r.get("glb") or "").split("/")[0]
        if d:
            dirs.append(d)
            names.append(r.get("name") or d)
    return dirs, names


def own_levels(ctx: Context) -> list[str]:
    """Level names the mod's own archives hold (`discover_levels` on the mod
    alone, not its parents): the set `--all-own-levels` bakes."""
    sys.path.insert(0, str(HERE))
    from extract_models import DEFAULT_GAME_DIR, discover_levels, mod_chain  # noqa: PLC0415
    chain = mod_chain(ctx.game_dir or DEFAULT_GAME_DIR, ctx.cfg.install)
    return [n for n, _ in discover_levels(chain[:1])]


def estimate_level_all_gb(ctx: Context) -> float:
    """Raw size of a `--level-all` models pass: archive GB x ~6 (FHSW 2026-09-30)."""
    sys.path.insert(0, str(HERE))
    try:
        from extract_models import DEFAULT_GAME_DIR, discover_levels, mod_chain  # noqa: PLC0415
        chain = mod_chain(ctx.game_dir or DEFAULT_GAME_DIR, ctx.cfg.install)
        total = sum(p.stat().st_size for _n, p in discover_levels(chain[:1]))
    except Exception:  # noqa: BLE001 - an estimate must never stop a run
        return 0.0
    return total / 1e9 * 6


def free_gb(path: Path = VIEWER) -> float:
    return shutil.disk_usage(path).free / 1e9


# ---------------------------------------------------------------------------
# thumbs and subset re-extracts: models.json is never rewritten by a subset
# ---------------------------------------------------------------------------

THUMB_KEYS = ("thumb",)


class ThumbGuard:
    """Snapshot the thumb keys of models.json and put back any a step dropped.

    `extract_all` rewrites models.json without them; `shoot.mjs --thumbs`
    stamps them. A step that touches models.json runs inside this guard so the
    keys survive whatever it does, as long as the thumb file is still on disk.
    """

    def __init__(self, models_dir: Path):
        self.dir = models_dir
        self.saved: dict[str, dict] = {}

    def __enter__(self):
        mp = self.dir / "models.json"
        try:
            for e in json.loads(mp.read_text()):
                kept = {k: e[k] for k in THUMB_KEYS if k in e}
                if kept:
                    self.saved[e["name"]] = kept
        except (OSError, ValueError, TypeError):
            pass
        return self

    def __exit__(self, *exc):
        if exc[0] is None:
            self.restore()
        return False

    def restore(self) -> int:
        mp = self.dir / "models.json"
        if not self.saved or not mp.is_file():
            return 0
        entries = json.loads(mp.read_text())
        n = 0
        for e in entries:
            for k, v in self.saved.get(e.get("name"), {}).items():
                if k not in e and (self.dir / v).is_file():
                    e[k] = v
                    n += 1
        if n:
            mp.write_text(json.dumps(entries, indent=2))
        return n


def copy_changed(scratch: Path, tree: Path) -> list[str]:
    """Copy files from a scratch extract into the tree where the bytes differ.

    Only per-template outputs move: `models.json` and anything in a
    subdirectory stay behind. Returns the names written.
    """
    written = []
    for src in sorted(scratch.iterdir()):
        if not src.is_file() or src.name == "models.json":
            continue
        dst = tree / src.name
        if dst.is_file() and dst.read_bytes() == src.read_bytes():
            continue
        tmp = dst.with_name(f".{dst.name}.{os.getpid()}.tmp")
        shutil.copyfile(src, tmp)
        os.replace(tmp, dst)
        written.append(src.name)
    return written


def merge_manifest(tree_models_json: Path, scratch_models_json: Path) -> int:
    """Update the tree's entries from a scratch manifest for the templates it
    holds, keeping thumb keys and every entry the scratch run did not touch."""
    tree = json.loads(tree_models_json.read_text())
    fresh = {e["name"]: e for e in json.loads(scratch_models_json.read_text())}
    n = 0
    for i, e in enumerate(tree):
        new = fresh.pop(e.get("name"), None)
        if new is None:
            continue
        merged = dict(new)
        for k in THUMB_KEYS:
            if k in e:
                merged[k] = e[k]
        if merged != e:
            tree[i] = merged
            n += 1
    for new in fresh.values():  # a template the tree did not have yet
        tree.append(new)
        n += 1
    if n:
        tree_models_json.write_text(json.dumps(tree, indent=2))
    return n


def reextract_models_subset(ctx: Context, templates: list[str], *, dry_run: bool = False) -> dict:
    """Re-extract some templates without ever rewriting the tree's models.json.

    The extractor runs into a scratch directory; only changed per-template
    files are copied across and only those templates' manifest rows merged.
    """
    models = ctx.paths["models"]
    scratch = Path(tempfile.mkdtemp(prefix=f"subset-{ctx.cfg.id}-", dir=str(OUT_ROOT)))
    argv = ["python3", "extract_models.py", "--mod", ctx.cfg.install, "--configuration-all",
            "--cockpit", "-j", str(ctx.jobs), "--out", str(scratch), *templates]
    if dry_run:
        return {"argv": argv, "written": [], "merged": 0, "scratch": str(scratch)}
    subprocess.run(argv, cwd=HERE, check=True)
    guard = ThumbGuard(models)
    with guard:
        written = copy_changed(scratch, models)
        merged = merge_manifest(models / "models.json", scratch / "models.json")
    shutil.rmtree(scratch, ignore_errors=True)
    return {"argv": argv, "written": written, "merged": merged,
            "then": "run optimise_mesh.py over the tree to move textures to the shared store"}


# ---------------------------------------------------------------------------
# state file
# ---------------------------------------------------------------------------


class State:
    def __init__(self, path: Path):
        self.path = path
        try:
            self.data = json.loads(path.read_text())
        except (OSError, ValueError):
            self.data = {"steps": {}}

    def get(self, name: str) -> dict:
        return self.data["steps"].get(name, {})

    def set(self, name: str, **kw):
        self.data["steps"].setdefault(name, {}).update(kw)
        self.save()

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2, sort_keys=True))
        os.replace(tmp, self.path)


def now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# running steps
# ---------------------------------------------------------------------------


class DiskGuardTripped(Exception):
    pass


def run_argv(argv: list[str], *, log: Path, guard: bool, min_free_gb: float,
             chromium: bool, env: dict | None = None) -> int:
    """Run one command in its own process group; kill the group if free disk
    on the tree's volume falls below `min_free_gb`."""
    if chromium:
        os.makedirs(os.path.dirname(CHROMIUM_LOCK), exist_ok=True)
        argv = ["flock", CHROMIUM_LOCK, *argv]
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "ab") as fh:
        fh.write(f"=== {now()} {' '.join(argv)}\n".encode())
        fh.flush()
        proc = subprocess.Popen(argv, cwd=HERE, stdout=fh, stderr=subprocess.STDOUT,
                                start_new_session=True, env={**os.environ, **(env or {})})
        try:
            while True:
                try:
                    rc = proc.wait(timeout=GUARD_POLL_S)
                    break
                except subprocess.TimeoutExpired:
                    if guard and free_gb() < min_free_gb:
                        fh.write(f"=== GUARD: free disk {free_gb():.1f} GB < {min_free_gb} GB, "
                                 "killing the step\n".encode())
                        os.killpg(proc.pid, signal.SIGTERM)
                        time.sleep(5)
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        proc.wait(timeout=10)
                        raise DiskGuardTripped(f"free disk below {min_free_gb} GB")
        except KeyboardInterrupt:
            os.killpg(proc.pid, signal.SIGTERM)
            raise
        fh.write(f"=== rc={rc} {now()}\n".encode())
    return rc


class ViewerServer:
    """`serve_viewer.py` on a port of the pipeline's own, stopped on exit."""

    def __init__(self, port: int):
        if port == OWNER_PORT:
            raise SystemExit("port 5273 is the owner's: pick another with --port")
        self.port = port
        self.proc: subprocess.Popen | None = None

    def __enter__(self):
        self.proc = subprocess.Popen(
            ["python3", "serve_viewer.py", str(self.port)], cwd=HERE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        import socket
        for _ in range(50):
            with socket.socket() as s:
                s.settimeout(0.2)
                if s.connect_ex(("127.0.0.1", self.port)) == 0:
                    return self
            time.sleep(0.1)
        self.__exit__()
        raise RuntimeError(f"viewer server did not come up on {self.port}")

    def __exit__(self, *exc):
        if self.proc and self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(timeout=10)
        return False

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


# step hooks ---------------------------------------------------------------


def copy_voices(ctx: Context) -> None:
    """Copy ONLY `<scratch>/voices/` into `_shared/voices/`: `hud/` belongs to
    the HUD pack step."""
    src = ctx.scratch / "voices"
    dst = HERE / expand("{shared}/voices", ctx)
    if not src.is_dir():
        raise RuntimeError(f"extract_radio wrote no voices/ under {src}")
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst, dirs_exist_ok=True)


def check_all_outputs(ctx: Context) -> list[dict]:
    rows = []
    for s in STEPS:
        if s.when and not getattr(ctx.cfg, s.when, False):
            continue
        for r in check_outputs(s, ctx):
            rows.append({"step": s.name, **r})
    return rows


def check_registry_counts(ctx: Context) -> list[dict]:
    """mods.json's counts for this mod against what `build_mods_manifest.scan`
    would write now (the same code the manifest step runs, read-only)."""
    sys.path.insert(0, str(HERE))
    import build_mods_manifest  # noqa: PLC0415
    try:
        reg = json.loads((ctx.paths["models_root"] / "mods.json").read_text())["mods"]
        entry = next(m for m in reg if m["id"] == ctx.cfg.id)
    except (OSError, ValueError, StopIteration, KeyError):
        return [{"what": "registry entry", "ok": False, "detail": "no entry in mods.json"}]
    fresh = next((e for e in build_mods_manifest.scan(VIEWER) if e["id"] == ctx.cfg.id), None)
    if fresh is None:
        return [{"what": "tree", "ok": False, "detail": "scan found no tree"}]
    return [{"what": f"counts.{k}", "registry": entry.get("counts", {}).get(k), "disk": v,
             "ok": entry.get("counts", {}).get(k) == v} for k, v in fresh["counts"].items()]


def check_gz_pairs(ctx: Context) -> list[dict]:
    missing = []
    for root in (ctx.paths["models"], ctx.paths["maps"]):
        for p in root.rglob("*.glb"):
            gz = p.with_name(p.name + ".gz")
            if not gz.is_file():
                missing.append(str(p.relative_to(VIEWER)))
    return [{"what": "glb without .glb.gz", "count": len(missing), "examples": missing[:5],
             "ok": not missing}]


def check_thumb_keys(ctx: Context) -> list[dict]:
    mp = ctx.paths["models"] / "models.json"
    try:
        entries = json.loads(mp.read_text())
    except (OSError, ValueError):
        return [{"what": "models.json", "ok": False, "detail": "unreadable"}]
    no_key = [e["name"] for e in entries if not e.get("thumb")]
    no_file = [e["name"] for e in entries
               if e.get("thumb") and not (ctx.paths["models"] / e["thumb"]).is_file()]
    return [{"what": "entries without a thumb key", "count": len(no_key),
             "examples": no_key[:5], "ok": not no_key},
            {"what": "thumb keys naming no file", "count": len(no_file),
             "examples": no_file[:5], "ok": not no_file}]


VERIFY_HOOKS: dict[str, Callable[[Context], list[dict]]] = {
    "check_all_outputs": check_all_outputs,
    "check_registry_counts": check_registry_counts,
    "check_gz_pairs": check_gz_pairs,
    "check_thumb_keys": check_thumb_keys,
}


def select_steps(only: list[str] | None, from_step: str | None, cfg: ModConfig) -> list[Step]:
    steps = [s for s in STEPS if not s.when or getattr(cfg, s.when, False)]
    names = [s.name for s in steps]
    if from_step:
        if from_step not in names:
            raise SystemExit(f"--from-step {from_step!r}: no such step; have {', '.join(names)}")
        steps = steps[names.index(from_step):]
    if only:
        bad = [n for n in only if n not in names]
        if bad:
            raise SystemExit(f"--only-steps: unknown {bad}; have {', '.join(names)}")
        steps = [s for s in steps if s.name in only]
    return steps


def run_steps(steps: list[Step], ctx: Context, state: State, *, dry_run: bool,
              force: bool, log_dir: Path) -> list[dict]:
    """Run (or plan) the steps in order. Returns one result row per step."""
    results = []
    server: ViewerServer | None = None
    try:
        for s in steps:
            argvs = build_argv(s, ctx)
            h = command_hash(argvs)
            missing = check_needs(s, ctx)
            outs = check_outputs(s, ctx)
            prior = state.get(s.name)
            up_to_date = (prior.get("status") == "done" and prior.get("hash") == h
                          and all(o["ok"] for o in outs))
            row = {"step": s.name, "title": s.title, "argv": [" ".join(a) for a in argvs],
                   "needs_missing": missing, "outputs": outs, "hash": h}
            if dry_run:
                row["status"] = ("up-to-date" if up_to_date else
                                 "blocked-needs" if missing else "would-run")
                results.append(row)
                continue
            if up_to_date and not force:
                row["status"] = "skipped-done"
                results.append(row)
                continue
            if missing:
                row["status"] = "failed-needs"
                state.set(s.name, status="failed", reason=f"missing {missing}", at=now())
                results.append(row)
                break
            if s.disk_guard and free_gb() < ctx.min_free_gb:
                row["status"] = "failed-disk"
                state.set(s.name, status="failed", reason="free disk below guard", at=now())
                results.append(row)
                break
            state.set(s.name, status="running", hash=h, started=now())
            log = log_dir / f"{s.name}.log"
            ctx.scratch = Path(tempfile.mkdtemp(prefix=f"{s.name}-", dir=str(OUT_ROOT)))
            rc = 0
            try:
                guard_ctx = ThumbGuard(ctx.paths["models"]) if s.touches_models else None
                if guard_ctx:
                    guard_ctx.__enter__()
                if s.chromium and server is None:
                    server = ViewerServer(ctx.port).__enter__()
                for argv in argvs:
                    rc = run_argv(argv, log=log, guard=s.disk_guard,
                                  min_free_gb=ctx.min_free_gb, chromium=s.chromium)
                    if rc:
                        break
                if rc == 0 and s.action:
                    globals()[s.action](ctx)
                if guard_ctx:
                    guard_ctx.restore()
            except DiskGuardTripped as exc:
                rc = 99
                row["error"] = str(exc)
            except Exception as exc:  # noqa: BLE001
                rc = rc or 1
                row["error"] = f"{type(exc).__name__}: {exc}"
            finally:
                shutil.rmtree(ctx.scratch, ignore_errors=True)
            outs = check_outputs(s, ctx)
            row["outputs"] = outs
            row["rc"] = rc
            ok = rc == 0 and all(o["ok"] for o in outs)
            row["status"] = "done" if ok else ("failed-outputs" if rc == 0 else "failed")
            state.set(s.name, status="done" if ok else "failed", rc=rc, hash=h, finished=now(),
                      log=_rel(log))
            results.append(row)
            if not ok:
                break
    finally:
        if server:
            server.__exit__()
    return results


def run_verify_steps(ctx: Context, state: State | None, *, record: bool) -> list[dict]:
    rows = []
    for s in VERIFY_STEPS:
        checks = VERIFY_HOOKS[s.action](ctx)
        ok = all(c.get("ok") for c in checks)
        rows.append({"step": s.name, "title": s.title, "status": "pass" if ok else "fail",
                     "checks": checks})
        if record and state:
            state.set(s.name, status="done" if ok else "failed", finished=now())
    return rows


# ---------------------------------------------------------------------------
# gates: audits as subprocesses, merged into findings
# ---------------------------------------------------------------------------

SEVERITIES = ("blocker", "major", "minor", "info", "accepted")
OPEN_BAD = {"blocker", "major"}

# static-audit causes that are a visible defect on their own
BLOCKER_FRAGMENTS = ("opaque-white", "magenta", "1x1", "unreadable", "glb-missing",
                      "texture-not-found", "untextured", "nan-visible", "no-models-json",
                      "variant-glb-missing", "at-origin")
MINOR_CAUSES = {"thumb-not-listed", "glb-on-disk-not-in-manifest", "thumb-without-entry",
                "uv-constant", "voices-nation-missing"}


@dataclass
class Finding:
    gate: str
    check: str
    level: str
    item: str
    severity: str
    cause_key: str
    evidence: str = ""
    retail_faithful: bool | None = None
    owning_script: str = ""
    accepted: bool = False          # accepted with evidence
    accepted_reason: str = ""

    def as_dict(self) -> dict:
        return {k: getattr(self, k) for k in (
            "gate", "check", "level", "item", "severity", "cause_key", "evidence",
            "retail_faithful", "owning_script", "accepted", "accepted_reason")}

    @property
    def open_bad(self) -> bool:
        return self.severity in OPEN_BAD and not self.accepted


OWNING_SCRIPT = {
    "textures": "extract_all.py / bf42/assemble.py / bf42/rs.py",
    "placement": "extract_maps_all.py / extract_map.py / bf42/level.py",
    "sound": "extract_map.py (sounds layer) / extract_vehicle_sounds.py",
    "models": "extract_all.py / extract_kits.py / extract_viewmodel.py",
    "data": "extract_loadouts.py / extract_map.py / extract_kits.py",
}


def static_accepted() -> dict[str, str]:
    """`audit_mod.ACCEPTED`, read by import so the two never disagree."""
    sys.path.insert(0, str(HERE))
    try:
        import audit_mod  # noqa: PLC0415
        return dict(audit_mod.ACCEPTED)
    except Exception:  # noqa: BLE001
        return {}


def normalise_static(rows: list[dict], accepted: dict[str, str]) -> list[Finding]:
    """Rows of `audit_mod.py --json`: the legacy keys (`audit`, `cause`,
    `subject`, `detail`) and, since the common schema, `severity`,
    `owning_script`, `evidence` and a boolean `accepted`. Either shape reads."""
    out = []
    for r in rows:
        cause = r.get("cause_key") or r.get("cause", "")
        acc = bool(r.get("accepted")) or cause in accepted
        sev = str(r.get("severity") or "").lower()
        if acc:
            sev = "accepted"
        elif sev in ("", "major", "info") and any(f in cause for f in BLOCKER_FRAGMENTS):
            sev = "blocker"
        elif sev in ("", "major") and cause in MINOR_CAUSES:
            sev = "minor"
        elif sev not in SEVERITIES:
            sev = "major"
        check = r.get("check") or r.get("audit", "")
        reason = accepted.get(cause) or (r.get("evidence") if acc else "") or ""
        out.append(Finding(
            gate="static", check=check, level=r.get("level", "") or "",
            item=str(r.get("item") or r.get("subject", "")), severity=sev, cause_key=cause,
            evidence=str(r.get("detail") or r.get("evidence") or "")[:300],
            retail_faithful=True if acc else None,
            owning_script=str(r.get("owning_script") or OWNING_SCRIPT.get(check, "audit_mod.py")),
            accepted=acc, accepted_reason=str(reason)[:300]))
    return out


def _norm_sev(value) -> str:
    v = str(value or "major").lower()
    return v if v in SEVERITIES else {"critical": "blocker", "error": "major",
                                      "warning": "minor", "warn": "minor"}.get(v, "major")


def normalise_external(rows: list[dict], gate: str) -> list[Finding]:
    """Behaviour and completeness schemas: {check, level, template_or_kit|item,
    severity, cause_key, evidence, [retail_faithful], [owning_script]}.

    `retail_faithful: true` with non-empty evidence is an accepted exception;
    without evidence it stays open: a claim is not evidence."""
    out = []
    for r in rows:
        evidence = str(r.get("evidence") or "")
        rf = r.get("retail_faithful")
        sev = _norm_sev(r.get("severity"))
        accepted = (bool(rf) or r.get("accepted") is True) and bool(evidence.strip())
        out.append(Finding(
            gate=gate, check=str(r.get("check", "")), level=str(r.get("level") or ""),
            item=str(r.get("template_or_kit") or r.get("item") or ""), severity=sev,
            cause_key=str(r.get("cause_key") or r.get("check") or "unknown"),
            evidence=evidence[:300], retail_faithful=rf if rf is None else bool(rf),
            owning_script=str(r.get("owning_script") or ""),
            accepted=accepted,
            accepted_reason=evidence[:300] if accepted else ""))
    return out


@dataclass
class GateResult:
    name: str
    status: str                      # ran | not-installed | failed-to-run | skipped
    detail: str = ""
    findings: list[Finding] = field(default_factory=list)
    command: str = ""
    seconds: float = 0.0
    levels_covered: list[str] | None = None   # None: the gate covers every level it was given
    extra: dict = field(default_factory=dict)


def _run_capture(argv: list[str], timeout: int = 7200, chromium: bool = False):
    if chromium:
        os.makedirs(os.path.dirname(CHROMIUM_LOCK), exist_ok=True)
        argv = ["flock", CHROMIUM_LOCK, *argv]
    t = time.time()
    p = subprocess.run(argv, cwd=HERE, capture_output=True, text=True, timeout=timeout)
    return p, time.time() - t


def _load_rows(path: Path):
    """A gate's JSON: a list of findings, or {"findings": [...], "levels": [...]}."""
    data = json.loads(path.read_text())
    if isinstance(data, list):
        return data, None
    if isinstance(data, dict):
        rows = data.get("findings")
        lv = data.get("levels")
        if isinstance(lv, list):
            lv = [(x.get("level") if isinstance(x, dict) else x) for x in lv]
            data = {**data, "levels": [str(x) for x in lv if x]}
        if rows is None:
            rows = [r for v in data.values() if isinstance(v, list) for r in v
                    if isinstance(r, dict) and ("cause_key" in r or "cause" in r)]
        return rows, data.get("levels") if isinstance(data.get("levels"), list) else None
    raise ValueError("unexpected JSON shape")


def gate_static(ctx: Context, work: Path) -> GateResult:
    script = HERE / "audit_mod.py"
    if not script.is_file():
        return GateResult("static", "not-installed", "audit_mod.py is absent")
    out = work / "static.json"
    out.unlink(missing_ok=True)
    argv = ["python3", "audit_mod.py", "--mod", ctx.cfg.id, "--audit", "textures", "placement",
            "sound", "models", "data", "--json", str(out)]
    try:
        p, secs = _run_capture(argv)
    except subprocess.TimeoutExpired:
        return GateResult("static", "failed-to-run", "timed out", command=" ".join(argv))
    if not out.is_file():
        return GateResult("static", "failed-to-run",
                          f"rc={p.returncode}, no JSON: {p.stderr[-200:]}", command=" ".join(argv))
    rows, _ = _load_rows(out)
    (work / "static.txt").write_text(p.stdout)
    return GateResult("static", "ran", f"rc={p.returncode}", normalise_static(rows, static_accepted()),
                      " ".join(argv), secs)


def gate_completeness(ctx: Context, work: Path) -> GateResult:
    script = HERE / "audit_mod.py"
    if not script.is_file():
        return GateResult("completeness", "not-installed", "audit_mod.py is absent")
    help_text = subprocess.run(["python3", "audit_mod.py", "--help"], cwd=HERE,
                               capture_output=True, text=True).stdout
    if "completeness" not in help_text:
        return GateResult("completeness", "not-installed",
                          "audit_mod.py has no `--audit completeness` section yet")
    out = work / "completeness.json"
    out.unlink(missing_ok=True)
    argv = ["python3", "audit_mod.py", "--mod", ctx.cfg.id, "--audit", "completeness",
            "--json", str(out)]
    try:
        p, secs = _run_capture(argv)
    except subprocess.TimeoutExpired:
        return GateResult("completeness", "failed-to-run", "timed out", command=" ".join(argv))
    if not out.is_file():
        return GateResult("completeness", "failed-to-run", f"rc={p.returncode}, no JSON",
                          command=" ".join(argv))
    rows, lv = _load_rows(out)
    return GateResult("completeness", "ran", f"rc={p.returncode}",
                      normalise_external(rows, "completeness"), " ".join(argv), secs, lv)


def gate_behaviour(ctx: Context, work: Path, server_url: str) -> GateResult:
    script = HERE / "audit_behaviour.mjs"
    if not script.is_file():
        return GateResult("behaviour", "not-installed", "audit_behaviour.mjs is absent")
    out = work / "behaviour.json"
    out.unlink(missing_ok=True)
    argv = ["node", "audit_behaviour.mjs", "--mod", ctx.cfg.id, "--levels", "all",
            "--url", server_url, "--json", str(out), *ctx.behaviour_args]
    try:
        p, secs = _run_capture(argv, chromium=True)
    except subprocess.TimeoutExpired:
        return GateResult("behaviour", "failed-to-run", "timed out", command=" ".join(argv))
    if not out.is_file():
        return GateResult("behaviour", "failed-to-run",
                          f"rc={p.returncode}, no JSON: {(p.stderr or p.stdout)[-200:]}",
                          command=" ".join(argv))
    rows, lv = _load_rows(out)
    status = "partial" if ctx.behaviour_args else "ran"   # a --quick sample never earns a tier
    detail = f"rc={p.returncode}" + (" (--quick: a sample, not a sweep)" if ctx.behaviour_args else "")
    if p.returncode == 2:
        status, detail = "failed-to-run", "audit_behaviour.mjs could not stage the run (rc=2)"
    if lv is not None:
        by_name = {n.lower(): d for n, d in zip(ctx.level_names, ctx.levels)}
        by_name.update({d.lower(): d for d in ctx.levels})
        lv = [by_name.get(str(x).lower(), str(x)) for x in lv]
    return GateResult("behaviour", status, detail,
                      normalise_external(rows, "behaviour"), " ".join(argv), secs, lv)


RENDER_HEADER = re.compile(r"rendered (\d+) frames \((\d+) models(?:, (\d+) levels)?\); flagged (\d+)")


def parse_render_output(text: str) -> tuple[dict | None, list[Finding]]:
    """`audit_render.mjs` prints a header and one line per flagged frame."""
    m = RENDER_HEADER.search(text)
    if not m:
        return None, []
    head = {"frames": int(m[1]), "models": int(m[2]),
            "levels": int(m[3] or 0), "flagged": int(m[4])}
    findings = []
    for line in text.splitlines():
        mm = re.match(r"\s{2}(\S.*?): (.+)$", line)
        if not mm or line.startswith("rendered"):
            continue
        name, detail = mm.groups()
        lvm = re.match(r"level:(.+?):cp\d+$", name) or re.match(r"level:(.+)$", name)
        level = lvm.group(1) if lvm else ""
        is_error = not re.search(r"(colours|px),", detail)
        findings.append(Finding(
            gate="render", check="render-frame" if lvm else "render-model", level=level,
            item=name, severity="blocker", cause_key=("render-error" if is_error
                                                      else "render-white-magenta-black"),
            evidence=detail[:300], owning_script="audit_render.mjs / extract_all.py / "
            "extract_maps_all.py"))
    return head, findings


def gate_render(ctx: Context, work: Path, server_url: str) -> GateResult:
    script = HERE / "audit_render.mjs"
    if not script.is_file():
        return GateResult("render", "not-installed", "audit_render.mjs is absent")
    argv = ["node", "audit_render.mjs", "--mod", ctx.cfg.id, "--url", server_url, "--levels",
            "--out", str(work / "render")]
    try:
        p, secs = _run_capture(argv, chromium=True)
    except subprocess.TimeoutExpired:
        return GateResult("render", "failed-to-run", "timed out", command=" ".join(argv))
    (work / "render.txt").write_text(p.stdout + p.stderr)
    head, findings = parse_render_output(p.stdout)
    if head is None:
        return GateResult("render", "failed-to-run",
                          f"rc={p.returncode}, no summary line: {(p.stderr or p.stdout)[-200:]}",
                          command=" ".join(argv))
    # fail closed on coverage: a baked level that produced no frames is not rendered
    expected = len(ctx.levels)
    detail = f"{head['frames']} frames ({head['models']} models, {head['levels']} levels)"
    status = "ran"
    if head["levels"] < expected:
        status = "failed-to-run"
        detail += f"; only {head['levels']} of {expected} baked levels were rendered"
    return GateResult("render", status, detail, findings, " ".join(argv), secs, extra=head)


# --- rule-level checks ------------------------------------------------------

RULE_FIELDS = {  # scene.json key -> bf42.level template attribute
    "team": "team", "radius": "radius", "areaValue": "area_value",
    "spawnGroupId": "spawn_group_id", "secondSpawnGroupId": "second_spawn_group_id",
    "objectSpawnerId": "object_spawner_id", "unableToChangeTeam": "unable_to_change_team",
    "timeToGetControl": "time_to_get_control", "timeToLoseControl": "time_to_lose_control",
    "disableIfEnemyInsideRadius": "disable_if_enemy_inside_radius",
    "disableWhenLosingControl": "disable_when_losing_control",
    "loseControlWhenEnemyClose": "lose_control_when_enemy_close",
    "loseControlWhenNotClose": "lose_control_when_not_close",
    "minNrToTakeControl": "min_nr_to_take_control",
    "onlyTakeableByTeam": "only_takeable_by_team",
}


def _same(a, b) -> bool:
    if a is None or b is None:
        return (a in (None, 0, False)) and (b in (None, 0, False))
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    try:
        return abs(float(a) - float(b)) < 1e-4
    except (TypeError, ValueError):
        return a == b


def compare_control_points(scene_cps: list[dict], raw: dict[str, dict]) -> list[tuple[str, str, str]]:
    """(item, cause, evidence) for each disagreement between a scene.json
    control point list and the raw templates (`raw`: name -> {scene key: value})."""
    out = []
    seen = set()
    for cp in scene_cps:
        name = cp["name"]
        seen.add(name)
        want = raw.get(name)
        if want is None:
            out.append((name, "cp-not-in-script", "the scene lists a control point the "
                        "mode script does not create"))
            continue
        for key in RULE_FIELDS:
            if not _same(cp.get(key), want.get(key)):
                out.append((name, "capture-rule-field-differs",
                            f"{key}: scene {cp.get(key)!r} != raw {want.get(key)!r}"))
    for name in raw:
        if name not in seen:
            out.append((name, "cp-not-in-scene", "the mode script creates a control point "
                        "the scene does not list"))
    return out


def gate_rules(ctx: Context, work: Path) -> GateResult:
    """Rule-level checks: capture-rule fields and tickets against the ROOT
    scripts, game types that start, loading screen and name resolution."""
    sys.path.insert(0, str(HERE))
    findings: list[Finding] = []
    t0 = time.time()
    try:
        from bf42 import level as lv  # noqa: PLC0415
        from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: PLC0415
        game = ctx.game_dir or DEFAULT_GAME_DIR
        if not (game / "Mods").is_dir():
            return GateResult("rules", "not-installed", f"no game install at {game}")
        chain = mod_chain(game, ctx.cfg.install)
    except Exception as exc:  # noqa: BLE001
        return GateResult("rules", "not-installed", f"{type(exc).__name__}: {exc}")

    def add(level, item, sev, cause, ev, owner="extract_map.py / scene_layers.py"):
        findings.append(Finding("rules", "rule-level", level, item, sev, cause, ev,
                                owning_script=owner))

    maps_dir = ctx.paths["maps"]
    try:
        maps_rows = {Path((r.get("report") or "x/").split("/")[0]).name: r
                     for r in json.loads((maps_dir / "maps.json").read_text())}
    except (OSError, ValueError):
        maps_rows = {}
    try:
        models_names = {e["name"].lower().replace("/", "_")
                        for e in json.loads((ctx.paths["models"] / "models.json").read_text())}
    except (OSError, ValueError):
        models_names = set()
    kits_names = set()
    try:
        kits_names = {k["template"].lower() for k in json.loads(
            (ctx.paths["models"] / "kits.json").read_text())["kits"]}
    except (OSError, ValueError, KeyError):
        pass
    try:
        loadouts = json.loads((ctx.paths["shared"] / "loadouts.json").read_text())
    except (OSError, ValueError):
        loadouts = {}

    covered = []
    for d in ctx.levels:
        scene_path = maps_dir / d / "scene.json"
        try:
            scene = json.loads(scene_path.read_text())
        except (OSError, ValueError) as exc:
            add(d, d, "blocker", "scene-unreadable", str(exc)[:120])
            continue
        level_name = scene.get("level", d)
        try:
            paths = lv.find_level_archives(game, ctx.cfg.install, level_name, chain=chain)
            files = lv.load_level_files(paths, level_name)
            gts = lv.load_game_types(files)
        except Exception as exc:  # noqa: BLE001
            add(d, level_name, "major", "level-archive-unreadable",
                f"{type(exc).__name__}: {exc}"[:200], "bf42/level.py")
            continue
        covered.append(d)
        scene_gts = scene.get("gameTypes") or {}
        # game types that actually start: GameTypes/<name>.con exists and a root script runs
        for name in scene_gts:
            if not files.find(f"GameTypes/{name}.con"):
                add(d, name, "blocker", "gametype-not-offered",
                    f"scene bakes {name} but the level has no GameTypes/{name}.con: the "
                    "server never starts it")
            elif name not in gts:
                add(d, name, "major", "gametype-script-unreadable", "no script read for it")
        offered = {rel.rsplit("/", 1)[-1][:-4].lower() for rel in files.under("GameTypes")
                   if rel.lower().endswith(".con")}
        for name in sorted(offered - {n.lower() for n in scene_gts}):
            add(d, name, "info", "gametype-offered-not-baked",
                "the level offers it; the viewer scene does not carry it")
        # capture-rule fields and tickets, from the ROOT script's own layer files
        for mode_key, mode in (scene.get("modes") or {}).items():
            if not mode.get("gameTypes"):
                add(d, mode_key, "info", "mode-layer-not-started",
                    "the layer is baked but no GameTypes/ file runs it (FHR-5): the "
                    "menu never starts it")
                continue
            gt_name = mode["gameTypes"][0]
            gt = gts.get(gt_name)
            if gt is None:
                add(d, mode_key, "major", "mode-has-no-script",
                    f"scene mode {mode_key} names game type {gt_name}, which no script defines")
                continue
            try:
                gp = lv.load_gameplay_objects(files, gt.mode, sources=gt.files or None)
                raw = {}
                for inst in gp.created_control_points():
                    t = gp.template_for(inst)
                    raw[inst.template] = {k: getattr(t, a, None) for k, a in RULE_FIELDS.items()}
            except Exception as exc:  # noqa: BLE001
                add(d, mode_key, "major", "mode-layer-unreadable",
                    f"{type(exc).__name__}: {exc}"[:200], "bf42/level.py")
                continue
            for item, cause, ev in compare_control_points(mode.get("controlPoints", []), raw):
                add(d, f"{mode_key}:{item}", "blocker" if cause == "capture-rule-field-differs"
                    else "major", cause, ev, "scene_layers.py (controlPoints) / patch_scene.py")
            tk = gt.tickets
            st = (mode.get("tickets") or (scene_gts.get(gt_name) or {}).get("tickets") or {})
            if tk is not None and st:
                want = (tk.team1, tk.team2, tk.loss_per_min_team1, tk.loss_per_min_team2)
                lpm = st.get("lossPerMin") or {}
                got = (st.get("team1"), st.get("team2"), lpm.get("team1"), lpm.get("team2"))
                if tuple(want) != tuple(got):
                    add(d, f"{mode_key}:tickets", "blocker", "tickets-differ-from-root-script",
                        f"scene {got} != root script {tuple(want)} (TKT-3)",
                        "scene_layers.py (game)")
        # loading screen resolves along the mod chain
        row = maps_rows.get(d, {})
        loading = row.get("loading") or {}
        bg = loading.get("background")
        if not bg or not (maps_dir / bg).is_file():
            add(d, "loading.background", "major", "loading-screen-unresolved",
                f"maps.json loading.background {bg!r} is not a file in the tree",
                "extract_loading_assets.py")
        music = loading.get("music")
        if music and not (maps_dir / music).is_file():
            add(d, "loading.music", "minor", "loading-music-unresolved",
                f"{music!r} is not a file in the tree", "extract_loading_assets.py")
        # every spawner/vehicle name resolves: the model catalogue, a kit pickup,
        # or a template the level declares itself (a node of its scene.glb)
        unresolved = sorted({(o.get("vehicle") or "") for o in scene.get("objectSpawns", [])
                             if o.get("vehicle")
                             and o["vehicle"].lower().replace("/", "_") not in models_names
                             and o["vehicle"].lower() not in kits_names})
        if unresolved:
            doc = _glb_doc(maps_dir / d / "scene.glb")
            local = set()
            for node in (doc or {}).get("nodes", []):
                ex = node.get("extras") or {}
                for v in (node.get("name"), ex.get("control"), ex.get("sourceTemplate")):
                    if v:
                        local.add(str(v).lower())
            unresolved = [v for v in unresolved if v.lower() not in local]
        for v in unresolved:
            add(d, v, "major", "spawner-vehicle-unresolved",
                "objectSpawns names a vehicle that is in no models.json entry, no kit "
                "pickup and no node of the level's scene.glb", "extract_all.py / extract_map.py")
        # every kit the level deals resolves in kits.json
        dealt = {kit for side in (loadouts.get("levels") or {}).get(d, {}).values()
                 for kit in (side.get("slots") or {}).values()}
        if loadouts and kits_names:
            for kit in sorted(dealt):
                if kit.lower() not in kits_names:
                    add(d, kit, "major", "loadout-kit-not-in-kits-json",
                        "the level deals a kit kits.json lacks (--maps missing from "
                        "extract_kits.py?)", "extract_kits.py")
    if not ctx.levels:
        return GateResult("rules", "failed-to-run", "no levels to check")
    return GateResult("rules", "ran", f"{len(covered)} of {len(ctx.levels)} levels read from the "
                      "archives", findings, "in-process (bf42.level)", time.time() - t0,
                      levels_covered=covered)


# --- regression corpus ------------------------------------------------------


@dataclass(frozen=True)
class CorpusEntry:
    """A defect class fixed in the FH work, pinned permanently.

    `guards` are what stops it returning: audit cause keys (static audit),
    unit tests (paths under tests/) and/or a live `probe` over the extracted
    tree. `commit` is the fix. A probe returns (status, evidence) with status
    pass | fail | n/a (the asset is not in this tree)."""

    key: str
    title: str
    commit: str
    audit_causes: tuple[str, ...] = ()
    tests: tuple[str, ...] = ()
    probe: str = ""           # name in PROBES


def _read_json(p: Path):
    return json.loads(p.read_text())


def _glb_doc(p: Path) -> dict | None:
    sys.path.insert(0, str(HERE))
    try:
        from check_recipe import read_glb  # noqa: PLC0415
        return read_glb(p)
    except Exception:  # noqa: BLE001
        return None


def _find(dirpath: Path, name: str) -> Path | None:
    low = name.lower()
    for p in dirpath.glob("*"):
        if p.name.lower() == low:
            return p
    return None


def probe_sound_families(ctx: Context):
    """GMC/Opelblitz/Zis5/Bedford carry their hull as `setRandomGeometries`
    children; the sound walk must still find their engine."""
    return _vehicle_sound_probe(ctx, ("GMC", "Opelblitz", "Zis5", "Bedford"))


def probe_engine_candidates(ctx: Context):
    """B25 and Ju52 name engine scripts by candidate; each must resolve."""
    return _vehicle_sound_probe(ctx, ("B25", "Ju52"))


def _vehicle_sound_probe(ctx: Context, names: tuple[str, ...]):
    try:
        table = _read_json(ctx.paths["shared"] / "vehicle-sounds.json")["vehicles"]
    except (OSError, ValueError, KeyError):
        return "n/a", "no vehicle-sounds.json"
    by = {e["template"].lower(): e for e in table}
    present = [n for n in names if _find(ctx.paths["models"], f"{n}.glb")]
    if not present:
        return "n/a", f"none of {names} in this tree"
    bad = [n for n in present if not by.get(n.lower(), {}).get("layers")]
    return ("fail", f"no engine layers for {bad}") if bad else \
        ("pass", f"{len(present)} templates have engine layers: {present}")


def _placed_in_levels(ctx: Context, template: str) -> list[str]:
    out = []
    for d in ctx.levels:
        try:
            sc = _read_json(ctx.paths["maps"] / d / "scene.json")
        except (OSError, ValueError):
            continue
        if any((o.get("vehicle") or "").lower() == template.lower()
               for o in sc.get("objectSpawns", [])):
            out.append(d)
    return out


def probe_static_stamp(ctx: Context):
    """A stationary gun the level places carries `hasMobilePhysics: false`."""
    checked, bad = [], []
    for tmpl in ("Nebelwerfer", "Type88"):
        for d in _placed_in_levels(ctx, tmpl):
            doc = _glb_doc(ctx.paths["maps"] / d / "scene.glb")
            if doc is None:
                return "fail", f"{d}/scene.glb unreadable"
            ok = False
            for n in doc["nodes"]:
                ex = n.get("extras") or {}
                src = str(ex.get("sourceTemplate") or n.get("name") or "").lower()
                phys = ex.get("physics") or {}
                if src.startswith(tmpl.lower()) and phys.get("hasMobilePhysics") is False:
                    ok = True
                    break
            (checked if ok else bad).append(f"{tmpl}@{d}")
    if not checked and not bad:
        return "n/a", "Nebelwerfer and Type88 are placed in no baked level"
    return ("fail", f"not stamped static: {bad}") if bad else ("pass", f"stamped: {checked}")


def probe_alpha_floor(ctx: Context):
    """The N1K1 reflector sight's cut-out material exports as MASK."""
    p = _find(ctx.paths["models"], "N1K1.cockpit.glb")
    if p is None:
        return "n/a", "no N1K1.cockpit.glb in this tree"
    doc = _glb_doc(p)
    if doc is None:
        return "fail", "unreadable"
    mats = {m.get("name"): m for m in doc.get("materials", [])}
    m = mats.get("1p_n1k1_m1_Material2")
    if m is None:
        return "fail", "1p_n1k1_m1_Material2 is not in the cockpit glb"
    return ("pass", "MASK") if m.get("alphaMode") == "MASK" else \
        ("fail", f"alphaMode {m.get('alphaMode')!r}: the reticle draws as a block")


def probe_spelled_extension(ctx: Context):
    """SU-76's gun mount names `SU_76MSummer.tga`; the file ships as .dds."""
    reps = [p for p in ctx.paths["models"].glob("*.report.json") if p.name.lower().startswith("su76")
            or p.name.lower().startswith("su-76")]
    if not reps:
        return "n/a", "no SU76 in this tree"
    bad = []
    for p in reps:
        try:
            miss = _read_json(p).get("texturesMissing") or []
        except (OSError, ValueError):
            continue
        bad += [m for m in miss if "su_76" in str(m).lower() or "su76" in str(m).lower()]
    return ("fail", f"still missing: {bad[:3]}") if bad else ("pass", f"{len(reps)} reports clean")


def probe_bolt_clips(ctx: Context):
    """Bolt rifles' first-person rigs carry a `bolt` clip (No.4, K98)."""
    vm = ctx.paths["models"] / "viewmodels"
    names = [p for p in vm.glob("*.fp.glb")
             if re.search(r"__(No4|K98|Kar98)$", p.name.replace(".fp.glb", ""), re.I)]
    if not names:
        return "n/a", "no No4/K98 viewmodel in this tree"
    bad = []
    for p in names:
        doc = _glb_doc(p)
        if doc is None or "bolt" not in {a.get("name") for a in doc.get("animations", [])}:
            bad.append(p.name)
    return ("fail", f"no bolt clip: {bad}") if bad else ("pass", f"{len(names)} rigs have `bolt`")


def probe_spawn_groups(ctx: Context):
    """Omaha's landing craft bind their own spawn groups in object scripts."""
    d = next((x for x in ctx.levels if x.lower().startswith("omaha_charlie")), None)
    if d is None:
        return "n/a", "Omaha_Charlie is not baked in this tree"
    sc = _read_json(ctx.paths["maps"] / d / "scene.json")
    n = len(sc.get("vehicleSoldierSpawns", []))
    return ("pass", f"{n} carried spawns") if n else \
        ("fail", "vehicleSoldierSpawns is empty: no Allied spawn at the start (FHR-2)")


def probe_unable_points(ctx: Context):
    """Prokhorovka's third SS point is unableToChangeTeam with finite timers."""
    d = next((x for x in ctx.levels if x.lower().startswith("prokhorovka")), None)
    if d is None:
        return "n/a", "Prokhorovka is not baked in this tree"
    sc = _read_json(ctx.paths["maps"] / d / "scene.json")
    cp = next((c for c in sc.get("controlPoints", []) if c["name"].startswith("3rd_ss")), None)
    if cp is None:
        return "fail", "3rd_ss point is missing"
    ok = cp.get("unableToChangeTeam") is True and cp.get("timeToGetControl", 9999) < 9999
    return ("pass", "unable with finite timers") if ok else \
        ("fail", f"unable={cp.get('unableToChangeTeam')} get={cp.get('timeToGetControl')}")


def probe_deployables(ctx: Context):
    p = ctx.paths["models"] / "deployables.json"
    if not p.is_file():
        return "fail", "deployables.json is missing from the models tree"
    try:
        d = _read_json(p)
    except ValueError:
        return "fail", "deployables.json is not JSON"
    return ("pass", f"{len(d.get('weapons', []))} weapons, {len(d.get('objects', []))} objects") \
        if isinstance(d, dict) else ("fail", "unexpected shape")


PROBES: dict[str, Callable[[Context], tuple[str, str]]] = {
    "sound_families": probe_sound_families,
    "engine_candidates": probe_engine_candidates,
    "static_stamp": probe_static_stamp,
    "alpha_floor": probe_alpha_floor,
    "spelled_extension": probe_spelled_extension,
    "bolt_clips": probe_bolt_clips,
    "spawn_groups": probe_spawn_groups,
    "unable_points": probe_unable_points,
    "deployables": probe_deployables,
}

REGRESSION_CORPUS: tuple[CorpusEntry, ...] = (
    CorpusEntry("random-geometries-sound", "Sound walks follow setRandomGeometries families "
                "(GMC, Opelblitz, Zis5, Bedford)", "b01483de",
                audit_causes=("engine-without-script",), tests=("tests/test_mod_pipeline.py",),
                probe="sound_families"),
    CorpusEntry("engine-script-candidates", "Engine script candidates resolve (B25, Ju52)",
                "01ecafce", audit_causes=("engine-script-ok-but-no-layers",),
                tests=("tests/test_engine_script_candidates.py",), probe="engine_candidates"),
    CorpusEntry("stationary-guns-static", "Stationary guns are stamped static "
                "(Nebelwerfer, Type88)", "fbded906",
                tests=("tests/test_assemble.py",), probe="static_stamp"),
    CorpusEntry("engine-alpha-floor", "Opaque materials alpha-test at alpha > 0 "
                "(N1K1 reticle, sprockets)", "3f83aa8f",
                tests=("tests/test_assemble.py",), probe="alpha_floor"),
    CorpusEntry("spelled-extension-texture", "A texture ref that spells the wrong extension "
                "resolves by stem (SU-76)", "27fcc8bc",
                audit_causes=("untextured-texture-absent-from-install", "texture-not-found"),
                tests=("tests/test_rfa.py",), probe="spelled_extension"),
    CorpusEntry("missing-quote-texture-line", "Texture lines with a missing quote parse",
                "01ecafce", audit_causes=("rs-texture-line-unparsed",),
                tests=("tests/test_audit_mod.py",)),
    CorpusEntry("nan-uvs", "No NaN UV on a drawn triangle", "01ecafce",
                audit_causes=("uv-nan-visible", "uv-nan-degenerate"),
                tests=("tests/test_audit_mod.py",)),
    CorpusEntry("bolt-operate-state-family", "Bolt rifles cycle the bolt after a shot (No.4)",
                "10031284", audit_causes=("bolt-rifle-no-bolt-clip",),
                tests=("tests/test_viewmodel.py",), probe="bolt_clips"),
    CorpusEntry("viewmodel-weapon-weld", "Grip track anchored to the weld (SVT40, G43, Sten)",
                "93f37cb3", tests=("tests/test_viewmodel.py",)),
    CorpusEntry("rle-bottom-left-tga", "Bottom-left RLE TGAs on mesh materials read in file "
                "order (tank sight)", "8dc4c985", tests=("tests/test_mesh_tga.py",)),
    CorpusEntry("v-is-coop-arms", "v_is_coop decided as a Conquest host does (kit loadouts, "
                "object scripts)", "293504bc", tests=("tests/test_coop_conditionals.py",)),
    CorpusEntry("object-script-spawn-groups", "Object scripts' spawn groups sit under the "
                "mode layer's (Omaha landing craft)", "293504bc",
                tests=("tests/test_level.py",), probe="spawn_groups"),
    CorpusEntry("unable-to-change-team", "An unableToChangeTeam point runs the law with its "
                "team frozen (Prokhorovka)", "293504bc",
                tests=("tests/test_control_point_law.py",), probe="unable_points"),
    CorpusEntry("deployables-json", "deployables.json is part of the recipe", "f33c26f8",
                tests=("tests/test_deployables.py",), probe="deployables"),
)


def gate_corpus(ctx: Context, work: Path) -> GateResult:
    findings = []
    rows = []
    for e in REGRESSION_CORPUS:
        status, ev = "n/a", "no live probe: guarded by audit cause / unit test"
        if e.probe:
            try:
                status, ev = PROBES[e.probe](ctx)
            except Exception as exc:  # noqa: BLE001
                status, ev = "fail", f"probe raised {type(exc).__name__}: {exc}"
        missing_tests = [t for t in e.tests if not (HERE / t).is_file()]
        rows.append({"key": e.key, "status": status, "evidence": ev,
                     "missing_tests": missing_tests})
        if status == "fail":
            findings.append(Finding("corpus", "regression", "", e.key, "blocker",
                                    f"regression:{e.key}", f"{e.title}: {ev}",
                                    owning_script=f"fix {e.commit}"))
        for t in missing_tests:
            findings.append(Finding("corpus", "guard-missing", "", e.key, "major",
                                    f"guard-missing:{e.key}", f"{t} does not exist",
                                    owning_script="tests/"))
    return GateResult("corpus", "ran", f"{sum(r['status']=='pass' for r in rows)} pass, "
                      f"{sum(r['status']=='n/a' for r in rows)} n/a, "
                      f"{sum(r['status']=='fail' for r in rows)} fail", findings,
                      "in-process (PROBES)", extra={"rows": rows})


# ---------------------------------------------------------------------------
# scorecard
# ---------------------------------------------------------------------------

REQUIRED_GATES = ("static", "render", "behaviour", "completeness", "rules")
# Findings about the mod as a whole that say nothing about a baked level: a level
# nobody extracted yet does not make Gold Beach worse. They set the mod tier only.
MOD_SCOPE_ONLY = {"level-not-extracted"}
TIERS = ("ready", "ready-with-notes", "blocked", "unverified")

GATE_ORDER = ("static", "render", "behaviour", "completeness", "rules", "corpus")


def level_tier(level: str, findings: list[Finding], gates: dict[str, GateResult],
               modwide_open: list[Finding]) -> tuple[str, list[str]]:
    """Fail closed. `unverified` beats everything: a level the gates did not
    cover cannot be called anything else."""
    reasons = []
    for g in REQUIRED_GATES:
        gr = gates.get(g)
        if gr is None or gr.status != "ran":
            reasons.append(f"gate {g}: {gr.status if gr else 'not run'}"
                           + (f" ({gr.detail})" if gr and gr.detail else ""))
        elif gr.levels_covered is not None and level.lower() not in {
                x.lower() for x in gr.levels_covered}:
            reasons.append(f"gate {g}: did not cover this level")
    if reasons:
        return "unverified", reasons
    bad = [f for f in findings if f.open_bad]
    if bad:
        return "blocked", [f"{f.cause_key} ({f.gate}): {f.item} - {f.evidence[:80]}"
                           for f in bad[:6]]
    notes = [f for f in findings if f.severity == "minor" and not f.accepted]
    if modwide_open:
        return "ready-with-notes", [f"mod-wide open: {c}" for c in
                                    sorted({f.cause_key for f in modwide_open})[:6]]
    if notes:
        return "ready-with-notes", [f"{f.cause_key}: {f.item}" for f in notes[:6]]
    return "ready", []


def _template_names(scene: dict) -> set[str]:
    names = set()
    for o in scene.get("objectSpawns", []):
        for k in ("vehicle", "spawner"):
            if o.get(k):
                names.add(str(o[k]).lower())
    for o in scene.get("vehicleSoldierSpawns", []):
        if o.get("vehicle"):
            names.add(str(o["vehicle"]).lower())
    return names


def build_scorecard(ctx: Context, gates: dict[str, GateResult], human: dict[str, list[str]],
                    verify_rows: list[dict] | None = None) -> dict:
    all_findings = [f for g in gates.values() for f in g.findings]
    # attribute mod-wide (level == "") findings to levels that use the item
    scenes = {}
    for d in ctx.levels:
        try:
            scenes[d] = _template_names(_read_json(ctx.paths["maps"] / d / "scene.json"))
        except (OSError, ValueError):
            scenes[d] = set()
    by_level: dict[str, list[Finding]] = {d: [] for d in ctx.levels}
    modwide: list[Finding] = []
    lower_levels = {d.lower(): d for d in ctx.levels}
    for f in all_findings:
        key = lower_levels.get(f.level.lower())
        if key is None:  # a level name (`Gold_Beach-1944`) rather than the dir name
            key = next((d for d in ctx.levels if d.lower() == f.level.lower().replace(" ", "_")), None)
        if key is not None:
            by_level[key].append(f)
            continue
        item = re.sub(r"\.(cockpit|wreck|kit|fp|pose)?\.?(glb|report\.json)$", "",
                      f.item, flags=re.I).lower()
        used_by = [d for d, names in scenes.items() if item and item in names]
        if used_by and f.open_bad:
            for d in used_by:
                by_level[d].append(f)
        else:
            modwide.append(f)
    modwide_open = [f for f in modwide if f.open_bad and f.cause_key not in MOD_SCOPE_ONLY]
    levels_out = {}
    for d in ctx.levels:
        tier, reasons = level_tier(d, by_level[d], gates, modwide_open)
        levels_out[d] = {
            "tier": tier, "reasons": reasons,
            "counts": {s: sum(1 for f in by_level[d] if f.severity == s and not f.accepted)
                       for s in ("blocker", "major", "minor", "info")}
            | {"accepted": sum(1 for f in by_level[d] if f.accepted)},
            "findings": [f.as_dict() for f in by_level[d] if not f.accepted],
            "human_checks": human.get(d, []),
        }
    gate_rows = {g: {"status": r.status, "detail": r.detail, "findings": len(r.findings),
                     "command": r.command, "seconds": round(r.seconds, 1), **r.extra}
                 for g, r in gates.items()}
    for g in REQUIRED_GATES:
        gate_rows.setdefault(g, {"status": "not run", "detail": "", "findings": 0})
    tiers = [v["tier"] for v in levels_out.values()]
    mod_open = [f for f in all_findings if f.open_bad]
    if any(gate_rows[g]["status"] != "ran" for g in REQUIRED_GATES):
        mod_tier = "unverified"
    elif mod_open:
        mod_tier = "blocked"
    elif any(t != "ready" for t in tiers) or modwide_open:
        mod_tier = "ready-with-notes"
    else:
        mod_tier = "ready"
    accepted = [f.as_dict() for f in all_findings if f.accepted]
    return {
        "mod": ctx.cfg.id, "install": ctx.cfg.install, "generated": now(),
        "tier": mod_tier,
        "tier_counts": {t: tiers.count(t) for t in TIERS},
        "gates": gate_rows,
        "levels": levels_out,
        "modwide_open": [f.as_dict() for f in modwide_open],
        "mod_scope": [f.as_dict() for f in all_findings
                      if f.open_bad and f.cause_key in MOD_SCOPE_ONLY],
        "blockers": [f.as_dict() for f in mod_open if f.severity == "blocker"],
        "accepted": accepted,
        "corpus": gates["corpus"].extra.get("rows", []) if "corpus" in gates else [],
        "verify": verify_rows or [],
    }


def scorecard_markdown(sc: dict) -> str:
    L = [f"# Scorecard: {sc['install']} (`{sc['mod']}`)", "",
         f"Generated {sc['generated']}. Mod tier: **{sc['tier']}**. "
         "Tiers fail closed: a gate that did not run, or is not installed, makes a level "
         "`unverified`, never `ready`.", "",
         "Levels: " + ", ".join(f"{n} {t}" for t, n in sc["tier_counts"].items()), "",
         "## Gates", "", "| Gate | Status | Findings | Detail |", "|---|---|---|---|"]
    for g in (*GATE_ORDER, *[k for k in sc["gates"] if k not in GATE_ORDER]):
        r = sc["gates"].get(g)
        if r:
            L.append(f"| {g} | {r['status']} | {r.get('findings', 0)} | "
                     f"{str(r.get('detail', ''))[:110]} |")
    L += ["", "## Levels", "", "| Level | Tier | Blocker | Major | Minor | Accepted | Why |",
          "|---|---|---|---|---|---|---|"]
    for d, v in sc["levels"].items():
        c = v["counts"]
        L.append(f"| {d} | {v['tier']} | {c['blocker']} | {c['major']} | {c['minor']} | "
                 f"{c['accepted']} | {'; '.join(v['reasons'])[:160]} |")
    if sc["blockers"]:
        L += ["", "## Blockers", "", "| cause_key | gate | level | item | owning script | evidence |",
              "|---|---|---|---|---|---|"]
        for f in sc["blockers"]:
            L.append(f"| {f['cause_key']} | {f['gate']} | {f['level'] or '-'} | {f['item']} | "
                     f"{f['owning_script'] or '-'} | {f['evidence'][:100]} |")
    majors = [f for v in sc["levels"].values() for f in v["findings"] if f["severity"] == "major"]
    majors += [f for f in sc["modwide_open"] if f["severity"] == "major"]
    if majors:
        L += ["", "## Major", "", "| cause_key | gate | level | item | owning script | evidence |",
              "|---|---|---|---|---|---|"]
        seen = set()
        for f in majors:
            k = (f["cause_key"], f["level"], f["item"])
            if k in seen:
                continue
            seen.add(k)
            L.append(f"| {f['cause_key']} | {f['gate']} | {f['level'] or '-'} | {f['item']} | "
                     f"{f['owning_script'] or '-'} | {f['evidence'][:100]} |")
    # accepted, grouped by cause, with the evidence and the retail-faithful flag
    L += ["", "## Accepted exceptions (review these)", "",
          "| cause_key | gate | count | retail-faithful | evidence |", "|---|---|---|---|---|"]
    groups: dict[tuple, list] = {}
    for f in sc["accepted"]:
        groups.setdefault((f["cause_key"], f["gate"]), []).append(f)
    for (cause, gate), fs in sorted(groups.items()):
        L.append(f"| {cause} | {gate} | {len(fs)} | {fs[0]['retail_faithful']} | "
                 f"{(fs[0]['accepted_reason'] or fs[0]['evidence'])[:150]} |")
    if not groups:
        L.append("| (none) | | | | |")
    if sc["corpus"]:
        L += ["", "## Regression corpus", "", "| Defect class | Status | Evidence |", "|---|---|---|"]
        for r in sc["corpus"]:
            L.append(f"| {r['key']} | {r['status']} | {r['evidence'][:120]} |")
    if sc.get("verify"):
        L += ["", "## Verification steps", "", "| Step | Status |", "|---|---|"]
        for r in sc["verify"]:
            L.append(f"| {r['step']} | {r['status']} |")
    humans = [(d, v["human_checks"]) for d, v in sc["levels"].items() if v["human_checks"]]
    if humans:
        L += ["", "## Residual human checks", ""]
        for d, hs in humans:
            L.append(f"* {d}: " + "; ".join(hs))
    return "\n".join(L) + "\n"


# Residual checks only a person with the real game can judge, per level. These
# are not findings; they are the standing list the README tells the owner to
# walk after the tier reads `ready`.
HUMAN_CHECKS_ALL = ("first spawn feels right", "vehicle handling and recoil feel",
                    "ambience mix against the real game")
HUMAN_CHECKS: dict[str, list[str]] = {
    "gold_beach-1944": ["push map: British beach spawn is the only one at the start, "
                        "group 2 opens only when `front` falls",
                        "landing craft carry the British (LCT groups 67 and 74)"],
    "omaha_charlie-sector-1944": ["Allied round opens on westallied/eastallied landing craft: "
                                  "they draw, move and a soldier can spawn on them",
                                  "neutral beach flag needs two soldiers"],
    "road_to_ramelle": ["mg_nest one-way flag; CoOp-only barn spawn group"],
    "tarawa-1943": ["Allies spawn only on ships (two destroyers, an LCT); pier ratchet"],
    "iwo_jima": ["landing beach 2 s capture; Marines spawn on LCT/LCI(R)"],
    "prokhorovka-1943": ["3rd_ss unable point: spawns switch off while a Russian stands on it"],
}


# ---------------------------------------------------------------------------
# README prose generated from the step list
# ---------------------------------------------------------------------------

PROSE_BEGIN = "<!-- steps:begin (generated by `mod_pipeline.py prose --write-readme`) -->"
PROSE_END = "<!-- steps:end -->"


def steps_markdown() -> str:
    L = ["| # | Step | Command | Needs | Must produce | After | Why it is a step |",
         "|---|---|---|---|---|---|---|"]
    for i, s in enumerate(STEPS, 1):
        cmd = " ; ".join(" ".join(c) for c in s.cmds) or f"(hook {s.action})"
        outs = ", ".join(f"`{p}` >= {m}" for p, m in s.outputs) or "-"
        flag = f" (only when `{s.when}`)" if s.when else ""
        extras = []
        if s.chromium:
            extras.append("headless Chromium under flock")
        if s.disk_guard:
            extras.append("disk guard")
        if s.touches_models:
            extras.append("thumb keys kept")
        why = (s.fixes + ("; " if s.fixes and extras else "") + ", ".join(extras)) or s.title
        L.append(f"| {i} | `{s.name}`{flag}: {s.title} | `{cmd}` | "
                 f"{', '.join(f'`{n}`' for n in s.needs) or '-'} | {outs} | "
                 f"{', '.join(s.after) or '-'} | {why} |")
    L += ["", "Verification steps (`verify`, idempotent):", ""]
    for s in VERIFY_STEPS:
        L.append(f"* `{s.name}`: {s.title}")
    return "\n".join(L) + "\n"


def write_readme_steps(readme: Path) -> bool:
    text = readme.read_text()
    block = f"{PROSE_BEGIN}\n\n{steps_markdown()}\n{PROSE_END}"
    if PROSE_BEGIN in text and PROSE_END in text:
        new = re.sub(re.escape(PROSE_BEGIN) + r".*?" + re.escape(PROSE_END), lambda _m: block,
                     text, flags=re.S)
    else:
        raise SystemExit(f"{readme} has no step markers")
    if new != text:
        readme.write_text(new)
        return True
    return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def make_context(args) -> Context:
    cfg = resolve_mod(args.mod)
    ctx = Context(cfg=cfg, jobs=args.jobs, port=args.port, min_free_gb=args.min_free_gb)
    if args.port == OWNER_PORT:
        raise SystemExit("port 5273 is the owner's: pick another with --port")
    if getattr(args, "behaviour_quick", False):
        ctx.behaviour_args = ["--quick"]
    if getattr(args, "game_dir", None):
        ctx.game_dir = Path(args.game_dir)
    if args.levels:
        ctx.level_names = list(args.levels)
    elif getattr(args, "all_own_levels", False):
        ctx.level_names = own_levels(ctx)
    else:
        ctx.levels, ctx.level_names = baked_levels(ctx)
    if not ctx.levels:
        ctx.levels = [n.lower() for n in ctx.level_names]
    return ctx


def run_gates(ctx: Context, work: Path, wanted: Iterable[str], *, need_server: bool) -> dict[str, GateResult]:
    gates: dict[str, GateResult] = {}
    wanted = list(wanted)
    work.mkdir(parents=True, exist_ok=True)
    if "static" in wanted:
        gates["static"] = gate_static(ctx, work)
    if "completeness" in wanted:
        gates["completeness"] = gate_completeness(ctx, work)
    if "rules" in wanted:
        gates["rules"] = gate_rules(ctx, work)
    if "corpus" in wanted:
        gates["corpus"] = gate_corpus(ctx, work)
    browser = [g for g in ("render", "behaviour") if g in wanted]
    if browser:
        with ViewerServer(ctx.port) as srv:
            if "render" in browser:
                gates["render"] = gate_render(ctx, work, srv.url)
            if "behaviour" in browser:
                gates["behaviour"] = gate_behaviour(ctx, work, srv.url)
    return gates


def emit_scorecard(sc: dict, md_dir: Path | None, json_dir: Path) -> None:
    """JSON stays beside the run's state (untracked); the markdown, which is
    small, goes where the caller asks (the feature folder's scorecards/)."""
    md = scorecard_markdown(sc)
    json_dir.mkdir(parents=True, exist_ok=True)
    (json_dir / f"{sc['mod']}.scorecard.json").write_text(json.dumps(sc, indent=2))
    if md_dir:
        md_dir.mkdir(parents=True, exist_ok=True)
        (md_dir / f"{sc['mod']}.md").write_text(md)
    print(md)


def cmd_steps(args) -> int:
    cfg = resolve_mod(args.mod) if args.mod else MODS["fh"]
    ctx = Context(cfg=cfg, jobs=args.jobs, port=args.port, levels=["<level>", "..."])
    for i, s in enumerate(select_steps(None, None, cfg), 1):
        print(f"{i:2d}. {s.name:15s} {s.title}")
        for argv in build_argv(s, ctx):
            print("      " + " ".join(argv))
        for p, m in s.outputs:
            print(f"      -> {p} >= {m}")
    return 0


def cmd_prose(args) -> int:
    if args.write_readme:
        readme = REPO_ROOT / "features" / "mod-extraction-pipeline" / "README.md"
        changed = write_readme_steps(readme)
        print(f"{readme}: {'updated' if changed else 'already current'}")
    else:
        print(steps_markdown())
    return 0


def _work_dir(ctx: Context) -> Path:
    return OUT_ROOT / ctx.cfg.id


def cmd_run(args) -> int:
    ctx = make_context(args)
    if not ctx.levels and not args.only_steps:
        raise SystemExit("no baked levels found: give --levels L1 L2 or --all-own-levels")
    work = _work_dir(ctx)
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    state = State(Path(args.state_file) if args.state_file else work / "state.json")
    # a big mod must not run --level-all into a full disk
    if ctx.cfg.level_all:
        est = estimate_level_all_gb(ctx)
        if est and free_gb() - est < ctx.min_free_gb:
            ctx.level_all_ok = False
            print(f"skipping --level-all: estimated {est:.0f} GB raw, "
                  f"{free_gb():.0f} GB free, guard {ctx.min_free_gb:.0f} GB", file=sys.stderr)
    steps = select_steps(args.only_steps, args.from_step, ctx.cfg)
    results = run_steps(steps, ctx, state, dry_run=args.dry_run, force=args.force_steps,
                        log_dir=work / "logs")
    for r in results:
        print(f"[{r['status']}] {r['step']}")
        if args.dry_run or r["status"].startswith("failed"):
            for a in r["argv"]:
                print("    " + a)
            for m in r["needs_missing"]:
                print(f"    needs missing: {m}")
            for o in r["outputs"]:
                if not o["ok"]:
                    print(f"    output short: {o['pattern']} {o['found']} < {o['minimum']}")
            if r.get("error"):
                print(f"    error: {r['error']}")
    if any(r["status"].startswith("failed") for r in results) and not args.dry_run:
        print("stopped at the first failed step; fix it and re-run (done steps are skipped)")
        return 2
    return _gate_phase(args, ctx, work, state, record=not args.dry_run)


def cmd_verify(args) -> int:
    ctx = make_context(args)
    work = _work_dir(ctx)
    state = State(work / "state.json")
    return _gate_phase(args, ctx, work, state, record=True)


def _gate_phase(args, ctx, work, state, *, record) -> int:
    verify_rows = run_verify_steps(ctx, state, record=record)
    for r in verify_rows:
        print(f"[{r['status']}] {r['step']}")
        for c in r["checks"]:
            if not c.get("ok"):
                print("    " + json.dumps(c)[:200])
    wanted = [g for g in (args.gates or GATE_ORDER) if g in GATE_ORDER]
    gates = run_gates(ctx, work / "gates", wanted, need_server=True)
    human = {d: HUMAN_CHECKS.get(d.lower(), []) + list(HUMAN_CHECKS_ALL) for d in ctx.levels}
    sc = build_scorecard(ctx, gates, human, verify_rows)
    emit_scorecard(sc, Path(args.scorecard_dir) if args.scorecard_dir else None, work)
    return 0 if sc["tier"] in ("ready", "ready-with-notes") else 1


def cmd_gates(args) -> int:
    ctx = make_context(args)
    return _gate_phase(args, ctx, _work_dir(ctx), State(_work_dir(ctx) / "state.json"), record=False)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--mod", required=True, help="tree id (fh) or install folder (FH)")
        p.add_argument("--levels", nargs="*", help="level directory names (default: the baked set)")
        p.add_argument("--all-own-levels", action="store_true",
                       help="every level the mod's own archives hold (what a new mod bakes)")
        p.add_argument("--jobs", "-j", type=int, default=4)
        p.add_argument("--port", type=int, default=DEFAULT_PORT,
                       help=f"viewer server port (never {OWNER_PORT}: the owner plays there)")
        p.add_argument("--min-free-gb", type=float, default=DEFAULT_MIN_FREE_GB)
        p.add_argument("--game-dir")
        p.add_argument("--behaviour-quick", action="store_true",
                       help="pass --quick to audit_behaviour.mjs (a sample, not a sweep)")
        p.add_argument("--scorecard-dir", help="write <mod>.md here (JSON goes to out/mod-pipeline/<id>/)")
        p.add_argument("--gates", nargs="*", choices=GATE_ORDER,
                       help="gates to run (default: all six)")
        p.add_argument("--state-file")

    r = sub.add_parser("run", help="extract (resumable) then gate")
    common(r)
    r.add_argument("--only-steps", nargs="*")
    r.add_argument("--from-step")
    r.add_argument("--dry-run", action="store_true",
                   help="plan only: no extractor runs, no tree file is written; gates still run")
    r.add_argument("--force-steps", action="store_true", help="re-run steps already done")
    r.set_defaults(fn=cmd_run)

    v = sub.add_parser("verify", help="idempotent verification steps, then the gates")
    common(v)
    v.set_defaults(fn=cmd_verify)

    g = sub.add_parser("gates", help="the gates and scorecard only; touches nothing")
    common(g)
    g.set_defaults(fn=cmd_gates)

    s = sub.add_parser("steps", help="print the recipe")
    s.add_argument("--mod")
    s.add_argument("--jobs", type=int, default=4)
    s.add_argument("--port", type=int, default=DEFAULT_PORT)
    s.set_defaults(fn=cmd_steps)

    pr = sub.add_parser("prose", help="print or write the README step table")
    pr.add_argument("--write-readme", action="store_true")
    pr.set_defaults(fn=cmd_prose)
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
