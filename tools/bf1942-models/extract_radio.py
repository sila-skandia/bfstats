#!/usr/bin/env python3
"""Extract the in-game radio: the F1..F8 menu, its icons and every voice line.

Three things come out of the game, all under a `_shared` directory:

`hud/radio-layout.json`
    `menu/RadioMenu` (a MemeFile 2.0 graph in `menu.rfa`, loaded by the
    `menu/RadioLayer` path node) flattened into leaves in the 800x600 virtual
    screen, the same shape `hud-layout.json` uses: pictures, the F-key labels
    (`TextNode` bound to `Radio/Key/RadioKey<n>`) and the tooltips (`BfTextNode`
    in `BfOutlineStyle`, a lexicon key or a bound control-point name), each
    with the `when` conditions that gate it -- `Radio/ShowRadioIcons`,
    `Radio/RadioCategory` (0 the idle strip, 1..8 an open F-key page),
    `Radio/RadioGameMode`, `Radio/RadioIconType`, `Radio/NumberOfControlPoints`
    and `Radio/ShowRadioToolTip`. Also every `RADIO_*` lexicon string, which
    is what a sent message prints in the chat log.

`hud/radio/<icon>.png`
    `menu/Texture/Radio/*.dds`, the button art (the "F1" on each button is the
    TextNode, not the texture).

`voices/<nation>/<stem>.mp3` and `voices/radio-sounds.json`
    Two sound scripts carry the lines: `menu/MenuRadioSoundHigh.ssc`, the team
    radio (2D, every patch `priority 11`), and
    `Objects/Soldiers/Common/Sounds/High/SoldierVoice.ssc`, the "local" lines a
    soldier shouts (3D: `minDistance 3`, a Distance -> Volume ramp 10..55 m).
    Both load `Sound/@RTD/@Language/<stem>.wav`, `@Language` being the side's
    `ObjectTemplate.setRadioLanguage` (see `extract_capture_voices.py`), so
    each stem is written once per nation folder the capture voices already
    use. `Bf1942/Game/GamePlay.ssc`'s `RadioCrackle` patch, the
    language-free `Sound/@RTD/radiomess.wav`, lands at `voices/radiomess.mp3`.
    The manifest lists both scripts' patches in file order -- the order is
    the patch index the engine plays by -- with each patch's stems, whether
    it picks one at random, and the local patches' distance ramp.

    python3 extract_radio.py --out /tmp/radio            # -> /tmp/radio/{hud,voices}
    python3 extract_radio.py --out ... --no-transcode    # manifests only
    python3 extract_radio.py --layout-only --out <hud>   # the pack files alone
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import meme  # noqa: E402
from bf42.level import parse_ssc  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402
from extract_capture_voices import LANGUAGE_NATIONS, RATES  # noqa: E402
from extract_hud_layout import Flattener, condition, default_value, mul_color, named, resolve_color  # noqa: E402
from extract_map import SOUND_ARCHIVES, TranscodeError, ffmpeg_available, resolve_sound, transcode_to_mp3  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from extract_spawn_layout import align_of, extract_fonts, font_id, load_chain_lexicon, texture_key  # noqa: E402

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, encode_png  # noqa: E402

VIRTUAL = (800, 600)
RADIO_MENU = "menu/radiomenu"
RADIO_TEXTURES = "menu/texture/radio/"
RADIO_SSC = "menu/MenuRadioSoundHigh.ssc"
LOCAL_SSC = "Objects/Soldiers/Common/Sounds/High/SoldierVoice.ssc"
GAMEPLAY_SSC = "Bf1942/Game/GamePlay.ssc"


class RadioFlattener(Flattener):
    """`extract_hud_layout.Flattener` plus the two node kinds the radio menu
    has and the HUD does not: `BfTextNode` (the tooltips -- a lexicon key
    through `BfLocaleStringData` or a bound wide string, in `BfOutlineStyle`)
    and the `BfVariableTimeoutActionNode2` each open page carries, recorded
    rather than drawn. The walk is the base class's own, node for node; only
    those two branches are new, so the colour and the conditions a sibling
    list accumulates reach them the way they reach every other leaf."""

    def __init__(self, lexicon):
        super().__init__(lexicon)
        self.timeouts: list[dict] = []

    def run(self, nodes, ox=0.0, oy=0.0, rect=None, color=None, when=None, posvar=None,
            tag=None, on_enter=None, rotation=None, alpha_vars=()) -> None:
        color = color or [1.0, 1.0, 1.0, 1.0]
        when = list(when or [])
        rect = rect or [0, 0, *VIRTUAL]
        alpha_vars = tuple(alpha_vars)
        for node in nodes:
            cls = node.cls
            self._alpha_vars = alpha_vars
            if cls == "CullNode":
                cond = condition(node["Variable"])
                if cond:
                    when.append(cond)
            elif cls == "EffectNode":
                effect = node["Effect"]
                bound = named(effect["Alpha"]) if isinstance(effect, meme.Obj) \
                    and effect.cls == "BfMultiplyColorEffect2" else None
                if bound:
                    # A live multiplier (`Radio/RadioAlpha`, written from the
                    # game mode by the file's own CullVariableActionNodes), so
                    # it is carried by name rather than baked at its default.
                    alpha_vars += (bound,)
                else:
                    c = resolve_color(effect)
                    if c:
                        color = mul_color(color, c)
            elif cls == "TransformNode":
                x, y, w, h = ox + node["X"], oy + node["Y"], node["Width"], node["Height"]
                self.run(node.children(), x, y, [x, y, w, h], color, when, alpha_vars=alpha_vars)
            elif cls == "SplitNode":
                self.run(node.children(), ox, oy, rect, color, when, alpha_vars=alpha_vars)
            elif cls == "PictureNode":
                self.emit_picture(node, rect, color, when)
            elif cls == "TextNode":
                self.emit_text(node, rect, color, when)
            elif cls == "BfTextNode":
                self.emit_bf_text(node, rect, color, when)
            elif cls == "BfVariableTimeoutActionNode2":
                action = node["Action"]
                calls = [named(a["Function"]) for a in action["Actions"]
                         if isinstance(a, meme.Obj) and a.cls == "CallFunctionAction"] \
                    if isinstance(action, meme.Obj) else []
                self.timeouts.append({
                    "when": [c for c in when if "const" not in c],
                    "currentVar": named(node["Current time"]),
                    "timeoutVar": named(node["Timeout time"]),
                    "seconds": default_value(node["Timeout time"]),
                    "calls": calls,
                })
            else:
                self.run(node.children(), ox, oy, rect, color, when, alpha_vars=alpha_vars)

    def leaf(self, kind, rect, color, when, tag=None, **extra) -> dict:
        el = super().leaf(kind, rect, color, when, tag, **extra)
        if getattr(self, "_alpha_vars", ()):
            el["alphaVars"] = list(self._alpha_vars)
        return el

    def emit_bf_text(self, node, rect, color, when) -> None:
        src, style = node["String"], node["Style"]
        extra: dict = {
            "font": font_id(style["Font handle"]) if isinstance(style, meme.Obj) else "standard6",
            "align": align_of(style),
            "outline": isinstance(style, meme.Obj) and style.cls == "BfOutlineStyle",
        }
        if isinstance(src, meme.Obj) and src.cls == "BfLocaleStringData":
            key = default_value(src["String Id"])
            extra["key"] = key
            extra["text"] = self.lexicon.get(key, key)
        elif isinstance(src, meme.Obj):
            val = default_value(src)
            extra["text"] = "" if val is None else str(val)
            if src.name:
                extra["var"] = src.name
        self.leaf("text", rect, color, when, **extra)


def decode_radio_menu(data: bytes, lexicon: dict[str, str]) -> dict:
    root, reader = meme.load(data)
    flat = RadioFlattener(lexicon)
    flat.run(root.chain())
    variables = {}
    for obj in _all_objects(root):
        if obj.name.startswith("Radio/") and obj.cls.endswith("Data"):
            value = default_value(obj)
            if value is not None and obj.name not in variables:
                variables[obj.name] = value
    # The two CullVariableActionNodes at the end of the file write
    # Radio/RadioAlpha from the game mode: 0.5 when it is 3, else 1.
    actions = []
    for top in root.chain():
        if top.cls == "CullVariableActionNode":
            for act in top["Action"]["Actions"]:
                if isinstance(act, meme.Obj) and act.cls == "SetVariableAction":
                    actions.append({"when": [condition(top["Variable"])],
                                    "set": named(act["Variable"]),
                                    "value": default_value(act["Value"])})
    return {
        "virtual": list(VIRTUAL),
        "elements": flat.elements,
        "timeouts": flat.timeouts,
        "variableActions": actions,
        "defaults": dict(sorted(variables.items())),
        "warnings": reader.warnings,
    }


def _all_objects(obj, seen=None):
    seen = seen if seen is not None else set()
    if isinstance(obj, list):
        for item in obj:
            yield from _all_objects(item, seen)
        return
    if not isinstance(obj, meme.Obj) or id(obj) in seen:
        return
    seen.add(id(obj))
    yield obj
    for value in obj.fields.values():
        yield from _all_objects(value, seen)


def radio_strings(lexicon: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in lexicon.items() if k.startswith("RADIO_")}


def extract_icons(menu, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for entry in sorted(menu.entries):
        low = entry.lower()
        if not low.startswith(RADIO_TEXTURES) or not low.endswith(".dds"):
            continue
        width, height, rgba = decode_dds(menu.read(entry))
        key = texture_key(entry)
        (out_dir / f"{key}.png").write_bytes(encode_png(width, height, rgba, drop_alpha=False))
        manifest[key] = {"file": f"radio/{key}.png", "size": [width, height], "source": entry}
    return manifest


def _stem(file: str) -> str:
    return file.replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0]


def _patches(text: str, source: str) -> list[dict]:
    out = []
    for index, patch in enumerate(parse_ssc(text, level="high", source=source)):
        # `randomPlay 1` picks one sample; without it every sample is a layer
        # and they all play at once (`bf42.level.SoundSample`).
        row: dict = {"index": index, "stems": [_stem(s.file) for s in patch.samples],
                     "random": bool(patch.random_play)}
        if patch.near_distance is not None:
            row["minDistance"] = patch.min_distance
            row["ramp"] = [patch.near_distance, patch.far_distance,
                           patch.ramp_start_val, patch.ramp_delta_val]
        out.append(row)
    return out


def _ssc_text(pool, name: str) -> str:
    raw = pool.try_read(name)
    if raw is None:
        raise SystemExit(f"{name} not found")
    return raw.decode("latin-1")


def extract_voices(game_dir: Path, mod: str, out: Path, transcode: bool) -> dict:
    pool = ArchivePool()
    for step in mod_chain(game_dir, mod):
        archives = find_archives_dir(step)
        if archives is not None:
            pool.add_dir(archives, SOUND_ARCHIVES + ("menu", "objects"))
            game = archives / "bf1942"
            if game.is_dir():
                pool.add_dir(game, ("game",))
    radio = _patches(_ssc_text(pool, RADIO_SSC), RADIO_SSC)
    local = _patches(_ssc_text(pool, LOCAL_SSC), LOCAL_SSC)
    gameplay = _patches(_ssc_text(pool, GAMEPLAY_SSC), GAMEPLAY_SSC)
    crackle = next((p for p in gameplay if p["stems"] == ["radiomess"]), None)
    manifest: dict = {
        "mod": mod,
        "sources": {"radio": RADIO_SSC, "local": LOCAL_SSC, "crackle": GAMEPLAY_SSC},
        "radio": radio, "local": local,
        "crackle": "radiomess" if crackle else None,
        "nations": {}, "missing": [],
    }
    stems = sorted({s for p in radio + local for s in p["stems"]})
    for language, nation in LANGUAGE_NATIONS.items():
        written = []
        for stem in stems:
            resolved = resolve_sound(f"@ROOT/Sound/@RTD/{language}/{stem}.wav", None, pool, rates=RATES)
            if resolved is None:
                continue
            if transcode:
                dest = out / "voices" / nation / f"{stem}.mp3"
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    transcode_to_mp3(resolved[1], dest)
                except TranscodeError as err:
                    manifest["missing"].append({"nation": nation, "stem": stem, "why": str(err)})
                    continue
            written.append(stem)
        if written:
            manifest["nations"][nation] = {"language": language, "stems": len(written)}
            lacking = sorted(set(stems) - set(written))
            if lacking:
                manifest["missing"].append({"nation": nation, "stems": lacking})
    if crackle:
        resolved = resolve_sound("@ROOT/Sound/@RTD/radiomess.wav", None, pool, rates=RATES)
        if resolved and transcode:
            (out / "voices").mkdir(parents=True, exist_ok=True)
            transcode_to_mp3(resolved[1], out / "voices" / "radiomess.mp3")
    if transcode:
        (out / "voices").mkdir(parents=True, exist_ok=True)
        (out / "voices" / "radio-sounds.json").write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


# ------------------------------------------------------------------ chat log

CHAT_STRING_KEYS = ("DEFAULT_KILL_TEXT", "TEAM_KILL", "DEATH", "AXIS_CAPTURED",
                    "ALLIES_CAPTURED", "AXIS_HOLD_ALL_CONTROLPOINTS",
                    "ALLIES_HOLD_ALL_CONTROLPOINTS", "CAPTURED_THE_FLAG",
                    "TEAM_CHAT_AXIS", "TEAM_CHAT_ALLIES", "RADIO_ATTACK", "RADIO_DEFEND")
MENU_CON = "Bf1942/Game/Init/Menu.con"
PROFILE_OPTIONS = Path("Settings/Profiles/Default/GeneralOptions.con")


def _gated_top(root, var: str):
    """The top-level `menu/InGame` entry whose own leading CullNode tests `var`."""
    for top in root.chain():
        for child in top.children()[:1]:
            if child.cls == "CullNode" and named(child["Variable"]) == var:
                return top
    return None


def _con_settings(text: str, prefix: str) -> dict[str, list[str]]:
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].lower().startswith(prefix.lower()):
            # `Game.setAxisRadioColor` -> `AxisRadioColor`
            out[parts[0][len(prefix):]] = parts[1:]
    return out


def decode_chat_layout(ingame: bytes, menu_con: str, options_con: str,
                       lexicon: dict[str, str]) -> dict:
    """The chat log and the centre kill message, as the engine draws them.

    Geometry is `menu/InGame`'s own (the box, its list box's font and row
    height, the divider bar's x). What the code adds -- the three sections
    and where each starts, the flag and text columns, the timer, the colours
    -- is in `features/radio-and-chat-log/README.md` with its addresses; the
    numbers the code takes from script (`Menu.con`'s colours, the default
    profile's section sizes and timeout) are read from those files here."""
    root, _ = meme.load(ingame)
    box = _gated_top(root, "Chat/ShowIngameChat")
    listbox = next(n for n in box.children() if n.cls == "BfNewListBoxNode")
    divider = next(n for n in box.children() if n.cls == "BfTransformNodeSize")
    kill = _gated_top(root, "KillMessage/ShowKillMessage")
    kill_color = next(n for n in kill.children() if n.cls == "EffectNode")["Effect"]
    kill_timeout = next(n for n in kill.children() if n.cls == "TimeoutActionNode")
    colours = {k: [float(v) for v in vals[0].split("/")]
               for k, vals in _con_settings(menu_con, "Game.set").items()
               if k.endswith("Color")}
    chat = _con_settings(options_con, "chat.set")
    num = lambda key, dflt: float(chat[key][0]) if key in chat else dflt
    return {
        "virtual": list(VIRTUAL),
        "box": [box["X"], box["Y"], box["Width"], box["Height"]],
        "font": font_id(listbox["Font"]),
        "rowHeight": listbox["Row height"],
        "dividerX": divider["X"],
        "sections": {"kill": int(num("KillMessageSize", 3)),
                     "info": int(num("GameInfoMessageSize", 2)),
                     "chat": int(num("ChatMessageSize", 4))},
        "timeUntilMessageRemoved": num("TimeUntilMessageRemoved", 5.0),
        "colors": {"axis": colours.get("AxisRadioColor"),
                   "allies": colours.get("AlliedRadioColor"),
                   "normal": colours.get("NormalChatColor"),
                   "buddy": [0.0, 1.0, 0.0]},
        "killMessage": {
            "rect": [kill["X"], kill["Y"], kill["Width"], kill["Height"]],
            "color": [default_value(kill_color[c]) for c in ("Red", "Green", "Blue")],
            "seconds": kill_timeout["Timeout time"],
        },
        "strings": {k: lexicon[k] for k in CHAT_STRING_KEYS if k in lexicon},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942")
    parser.add_argument("--out", type=Path, required=True,
                        help="the `_shared` directory to write `hud/` and `voices/` under")
    parser.add_argument("--no-transcode", action="store_true")
    parser.add_argument("--layout-only", action="store_true",
                        help="write only the interface files, with `--out` as the hud "
                             "pack directory itself (how extract_hud_mods.py runs it)")
    parser.add_argument("--force", action="store_true", help="accepted for extract_hud_mods.py")
    args = parser.parse_args(argv)
    game_dir = args.game_dir.expanduser()
    if not args.no_transcode and not args.layout_only and not ffmpeg_available():
        print("ffmpeg is not on PATH; run with --no-transcode", file=sys.stderr)
        return 2

    sources = MenuSources(mod_chain(game_dir, args.mod))
    lexicon = load_chain_lexicon(sources.lexicon_paths)
    hud = args.out if args.layout_only else args.out / "hud"
    with sources.open_menu() as menu:
        entry = next(e for e in menu.entries if e.lower() == RADIO_MENU)
        layout = decode_radio_menu(menu.read(entry), lexicon)
        layout["source"] = f"{entry} (MemeFile 2.0) in Mods/{menu.owner(entry)}/Archives/menu.rfa"
        layout["icons"] = extract_icons(menu, hud / "radio")
        ingame = menu.read(next(e for e in menu.entries if e.lower() == "menu/ingame"))
    layout["strings"] = radio_strings(lexicon)
    game_pool = ArchivePool()
    for step in mod_chain(game_dir, args.mod):
        archives = find_archives_dir(step)
        if archives is not None and (archives / "bf1942").is_dir():
            game_pool.add_dir(archives / "bf1942", ("game",))
    options = next((step / PROFILE_OPTIONS for step in mod_chain(game_dir, args.mod)
                    if (step / PROFILE_OPTIONS).is_file()), None)
    chat = decode_chat_layout(ingame, _ssc_text(game_pool, MENU_CON),
                              options.read_text("latin-1") if options else "", lexicon)
    # The names the engine localises through the lexicon at runtime: a kill
    # line's vehicle (`Tiger`), a control point's `setControlPointName`
    # (`SMALL_BRIDGE` -> "Stone Bridge") on the F4 page and in the radio and
    # capture lines. Every short single-line string, so a level's points need
    # nothing per level.
    chat["names"] = {k: v for k, v in lexicon.items()
                     if v and len(v) <= 40 and "\n" not in v}
    fonts = sorted({el["font"] for el in layout["elements"] if el["kind"] == "text"})
    with sources.open_font() as font_rfa:
        layout["fontFiles"] = extract_fonts(
            font_rfa, {f: f"Font/{'standard6' if f.startswith('standard6') else f}.dif" for f in fonts},
            hud / "fonts", False)
    hud.mkdir(parents=True, exist_ok=True)
    (hud / "radio-layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    (hud / "chat-layout.json").write_text(json.dumps(chat, indent=1) + "\n")
    print(f"radio-layout.json: {len(layout['elements'])} leaves, {len(layout['icons'])} icons, "
          f"{len(layout['strings'])} strings, {len(layout['warnings'])} warnings")

    if args.layout_only:
        return 0
    voices = extract_voices(game_dir, args.mod, args.out, not args.no_transcode)
    print(f"voices: {len(voices['radio'])} radio + {len(voices['local'])} local patches; "
          + ", ".join(f"{n} {r['stems']}" for n, r in voices["nations"].items()))
    for miss in voices["missing"]:
        print("missing:", miss)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
