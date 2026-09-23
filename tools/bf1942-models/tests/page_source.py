"""The map page's own source, for the tests that pin its wiring on the text.

`map.html` is the loader, the frame loop and the wiring; the code it wires
lives in the page's modules (features/vehicle-instance-refactor, Part 2). A
test that used to read `map.html` for a function or a call site reads this
instead, so it follows the code wherever the split put it.

A module's functions sit inside its factory, one indent in: `function_body`
finds a top-level page function or a factory-level module function alike.
"""

from __future__ import annotations

import re
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

# map.html first, then every module the page was split into.
PAGE_FILES = [
    "map.html",
    "vehicle-instance.js",
    "bot-referee.js",
    "bot-units.js",
    "bot-visuals.js",
    "test-hooks.js",
    "net-room.js",
    "scoreboard-screen.js",
    "deploy-screen.js",
    "spawning.js",
    "capture.js",
    "map-surfaces.js",
    "hud-feed.js",
    "local-player.js",
    "soldier-view.js",
    "foot-body.js",
    "seat-pose.js",
    "hand-weapon.js",
    "kit-loadout.js",
    "hand-fire-sound.js",
    "arms-rig.js",
    "demolitions.js",
    "hand-fire.js",
    "page-audio.js",
    "hull-bodies.js",
    "vehicle-wrecks.js",
    "vehicle-hits.js",
    "level-load.js",
    "level-sky.js",
    "level-shading.js",
    "level-flare.js",
    "level-statics.js",
    "level-terrain.js",
    "level-warmup.js",
    "page-input.js",
    "page-console.js",
]


def page_files() -> list[Path]:
    return [VIEWER / name for name in PAGE_FILES if (VIEWER / name).exists()]


def page_source() -> str:
    """Every file of the page, concatenated."""
    return "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in page_files())


def file_defining(name: str) -> Path:
    """The page file that declares function `name` (top level or in a factory)."""
    pattern = re.compile(r"^(?:  )?(?:async )?function " + re.escape(name) + r"\(", re.M)
    for path in page_files():
        if pattern.search(path.read_text(encoding="utf-8", errors="replace")):
            return path
    raise LookupError(f"no page function {name}")


def function_body(name: str) -> str:
    """The source of page function `name`, from its `function` line to its
    closing brace at its own indent."""
    pattern = re.compile(r"^(|  )(?:async )?function " + re.escape(name) + r"\(", re.M)
    for path in page_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        m = pattern.search(text)
        if not m:
            continue
        indent = m.group(1)
        end = text.find("\n" + indent + "}\n", m.start())
        if end < 0:
            raise LookupError(f"no end for {name} in {path.name}")
        return text[m.start():end + len(indent) + 2]
    raise LookupError(f"no page function {name}")
