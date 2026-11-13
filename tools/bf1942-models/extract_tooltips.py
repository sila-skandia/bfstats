#!/usr/bin/env python3
"""Extract the in-game tooltip plate and the pause message for the map viewer.

Writes `<hud>/tooltip-layout.json` beside `hud-layout.json`, plus the plate's
art under `<hud>/tooltip/`:

`groups.toolTip`
    `menu/InGame`'s tooltip top (the one that names `ToolTip/ShowToolTip`),
    flattened by `extract_hud_layout.Flattener` into the same leaves
    `hud-layout.json` uses. Two plates gated on `ToolTip/SmallToolTip`, each a
    heading, a body, up to ten key rows (`ToolTip/Key/ToolTipKey<n>` and
    `ToolTipKeyText<n>`) and a footer, and the two-line state panel
    (`ToolTip/Text/*`) that fades after a toggle.
`groups.pause`
    The `Pause/ShowPauseMessage` plate: `GAME_PAUSE` on a one-line backing.
`timers`
    The two meme nodes that run the plate, read from the same graph: the
    `BfVariableTimeoutActionNode2` that clears `ShowToolTip` when
    `ToolTipTime` passes `MaxToolTipTime`, and the `BfAddSubNextEffectNode`
    that fades `ToolTip/Text/Alpha` to 0 and clears `ShowToolTipText`.
`strings`
    Every `TOOLTIP_*` lexicon string, `GAME_PAUSE`, and the option labels.
`types`
    `ToolTipType` number -> lexicon key (`con.TOOL_TIP_STRINGS`, the client's
    `ToolTipManager::getToolTipString`).
`vehicles`
    PlayerControlObject template (lowercased) -> `toolTipType` number, from
    every `setToolTipType` in the chain's `Objects.rfa` (`con.TOOL_TIP_TYPES`,
    lnxded `operator>>(istream&, ToolTipType&)` 0x0829be20). The key is
    `toolTipType`, the one `bf42/assemble.py` writes on a vehicle's
    `extras.hud`; a tree baked before that word reads it here.

    python3 extract_tooltips.py                       # vanilla -> viewer/maps/_shared/hud
    python3 extract_tooltips.py --mod xpack2 --out <stage>/maps/mods/xpack2/_shared/hud
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod  # noqa: E402
from bf42 import meme  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from extract_hud_layout import VIRTUAL, flatten  # noqa: E402
from extract_hud_pack import hud_dir_for, objects_con_texts  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from extract_spawn_layout import extract_fonts, font_handles, load_chain_lexicon, texture_key  # noqa: E402

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, encode_png  # noqa: E402

TOOLTIP_VAR = "ToolTip/ShowToolTip"
PAUSE_VAR = "Pause/ShowPauseMessage"
#: Lexicon keys the plate prints beside the `TOOLTIP_*` family.
EXTRA_STRINGS = ("GAME_PAUSE", "GENERAL_OPTIONS_TOOLTIP", "GENERAL_OPTIONS_RADIO_TOOLTIP",
                 "CONTROLS_COMMON_TOOLTIP")

_CREATE = re.compile(r"(?im)^\s*ObjectTemplate\.(?:create\s+\S+|active)\s+(\S+)")
_TOOLTIP = re.compile(r"(?i)^\s*ObjectTemplate\.setToolTipType\s+(\S+)")


def _names(obj, depth: int = 0, top: bool = True):
    """Every Data name under one top-level entry (not along its siblings)."""
    if depth > 80:
        return
    if isinstance(obj, meme.Obj):
        if obj.name:
            yield obj.name
        for key, value in obj.fields.items():
            if top and key == "Next node":
                continue
            yield from _names(value, depth + 1, False)
    elif isinstance(obj, list):
        for value in obj:
            yield from _names(value, depth + 1, False)


def tops_naming(root: meme.Obj, var: str) -> list[meme.Obj]:
    return [top for top in root.chain() if var in set(_names(top))]


def _float(obj, default=None):
    return obj.fields.get("Value", default) if isinstance(obj, meme.Obj) else default


def plate_timers(tops: list[meme.Obj]) -> dict:
    """The timeout and the fade, as the graph writes them."""
    out: dict = {}
    seen: set[int] = set()

    def walk(obj, depth=0):
        if depth > 80:
            return
        if isinstance(obj, meme.Obj):
            if id(obj) in seen:
                return
            seen.add(id(obj))
            if obj.cls == "BfVariableTimeoutActionNode2":
                current = obj.fields.get("Current time")
                timeout = obj.fields.get("Timeout time")
                if isinstance(current, meme.Obj) and current.name == "ToolTip/ToolTipTime":
                    out["timeout"] = {"timeVar": current.name, "maxVar": timeout.name,
                                      "defaultMax": _float(timeout), "clears": TOOLTIP_VAR}
            elif obj.cls == "BfAddSubNextEffectNode":
                value = obj.fields.get("Value")
                if isinstance(value, meme.Obj) and value.name == "ToolTip/Text/Alpha":
                    out["textFade"] = {
                        "alphaVar": value.name,
                        "from": _float(value), "to": _float(obj.fields.get("End value")),
                        "startTime": _float(obj.fields.get("Start time")),
                        "endTime": _float(obj.fields.get("End time")),
                        "delay": _float(obj.fields.get("Delay")),
                        "resetVar": getattr(obj.fields.get("Reset"), "name", None),
                        "clears": "ToolTip/Text/ShowToolTipText"}
            for value in obj.fields.values():
                walk(value, depth + 1)
        elif isinstance(obj, list):
            for value in obj:
                walk(value, depth + 1)

    for top in tops:
        # Only this top's own subtree: its siblings are other widgets.
        for key, value in top.fields.items():
            if key != "Next node":
                walk(value)
    return out


def tool_tip_vehicles(texts) -> dict[str, int]:
    """template (lowercased) -> `toolTipType`, a later `setToolTipType` on a
    template replacing an earlier one."""
    out: dict[str, int] = {}
    for text in texts:
        current = None
        for line in text.splitlines():
            if match := _CREATE.match(line):
                current = match.group(1).lower()
            elif current and (match := _TOOLTIP.match(line)):
                out[current] = con_mod.tool_tip_type_id(match.group(1))
    return dict(sorted(out.items()))


def decode_tooltips(ingame: bytes, lexicon: dict[str, str]) -> dict:
    root, _ = meme.load(ingame)
    tip_tops = tops_naming(root, TOOLTIP_VAR)
    pause_tops = [t for t in tops_naming(root, PAUSE_VAR) if t not in tip_tops]
    tip = [el for el in flatten(tip_tops, lexicon)
           if any(c.get("var", "").startswith("ToolTip/") for c in el.get("when", []))]
    pause = [el for el in flatten(pause_tops, lexicon)
             if any(c.get("var") == PAUSE_VAR for c in el.get("when", []))]
    groups = {"toolTip": {"elements": tip}, "pause": {"elements": pause}}
    strings = {k: v for k, v in sorted(lexicon.items())
               if k.startswith("TOOLTIP_") or k in EXTRA_STRINGS}
    return {
        "virtual": list(VIRTUAL),
        "fonts": sorted({el["font"] for g in groups.values() for el in g["elements"]
                         if el["kind"] == "text"}),
        "groups": groups,
        "timers": plate_timers(tip_tops),
        "strings": strings,
        "types": list(con_mod.TOOL_TIP_STRINGS),
    }


def extract_textures(menu, layout: dict, out_dir: Path) -> dict:
    """The pictures the two groups draw, by sprite key, under `tooltip/`."""
    wanted = {el["texture"] for g in layout["groups"].values() for el in g["elements"]
              if el.get("texture")}
    manifest: dict = {}
    for entry in sorted(menu.entries):
        low = entry.lower()
        if not low.endswith((".dds", ".tga")) or texture_key(entry) not in wanted:
            continue
        key = texture_key(entry)
        if key in manifest or not low.endswith(".dds"):
            continue
        width, height, rgba = decode_dds(menu.read(entry))
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{key}.png").write_bytes(encode_png(width, height, rgba, drop_alpha=False))
        manifest[key] = {"file": f"tooltip/{key}.png", "size": [width, height], "source": entry}
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942")
    parser.add_argument("--out", type=Path, default=None,
                        help="the hud directory (default: the mod's own pack dir)")
    parser.add_argument("--force", action="store_true", help="re-encode font atlases")
    args = parser.parse_args(argv)

    game_dir = args.game_dir.expanduser()
    sources = MenuSources(mod_chain(game_dir, args.mod))
    out = args.out or hud_dir_for(sources.mod_id)
    lexicon = load_chain_lexicon(sources.lexicon_paths)
    with sources.open_menu() as menu:
        entry = next(e for e in menu.entries if e.lower() == "menu/ingame")
        layout = decode_tooltips(menu.read(entry), lexicon)
        layout["source"] = f"{entry} (MemeFile 2.0) in Mods/{menu.owner(entry)}/Archives/menu.rfa"
        layout["icons"] = extract_textures(menu, layout, out / "tooltip")
    layout["vehicles"] = tool_tip_vehicles(objects_con_texts(sources.chain))
    with sources.open_font() as fonts:
        layout["fontFiles"] = extract_fonts(fonts, font_handles(layout), out / "fonts", args.force)
    out.mkdir(parents=True, exist_ok=True)
    (out / "tooltip-layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    print(f"{sources.mod_id}: tooltip-layout.json: "
          f"{len(layout['groups']['toolTip']['elements'])} tooltip leaves, "
          f"{len(layout['groups']['pause']['elements'])} pause leaves, "
          f"{len(layout['strings'])} strings, {len(layout['vehicles'])} vehicles, "
          f"{len(layout['icons'])} pictures, {len(layout['fontFiles'])} fonts -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
