#!/usr/bin/env python3
"""Draws the hero art of the forum signatures from the live mesh assets.

Each scene in `scenes.json` is one of a mod's soldiers, tanks or aircraft in a
moment of action: a rifleman running and firing, a gunner prone on his LMG, a
Panzerschreck crouched for the shot, a Tiger's gun going off, a Spitfire
banking with its guns lit, a Stuka letting its bombs go. The figure is the
game's own model, posed with the game's own animation clips (the gaits'
`Ub_Fire`, `Ub_LieFire`, `Lb_RunJump`...) and dressed in the kit's worn parts,
drawn by `scripts/render-game-sprite.mjs`; the effects are painted over it by
`fx.py`.

Every hero is a transparent webp of HERO_W x HERO_H, the subject facing left on
the right of the canvas, so the API can lay it over any backdrop and put the
words on the left (features/forum-signatures/README.md).

    python3 scripts/signatures/render_signature_art.py            # every scene
    python3 scripts/signatures/render_signature_art.py fh          # one mod
    python3 scripts/signatures/render_signature_art.py fh/armour   # one scene
    python3 scripts/signatures/render_signature_art.py --sheet /tmp/s.png   # and a contact sheet

Assets come from mesh.bfstats.io through `mesh_mirror.py` (read-only, cached
under ~/.cache/bfstats-signature-assets). Output goes to api/Signatures/Art,
which the API image carries.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

import fx  # noqa: E402
import mesh_mirror as mirror  # noqa: E402

RENDER = ROOT / "scripts" / "render-game-sprite.mjs"
OUT = ROOT / "api" / "Signatures" / "Art"
HERO_W, HERO_H = 640, 400

# Where each kind of subject sits on the hero canvas: the box it is fitted into.
BOXES = {
    "soldier": (300, 24, 620, 392),
    "launcher": (250, 24, 560, 392),
    "prone": (180, 150, 630, 380),
    "vehicle": (150, 70, 630, 388),
    "plane": (110, 30, 630, 330),
    "compact": (300, 40, 630, 330),
}
STANCE_OF_GAIT = {"run": "stand", "walk": "stand", "stand": "stand", "crouch": "crouch", "crouchwalk": "crouch",
                  "lie": "lie", "crawl": "lie", "Lb_RunJump": "stand", "Lb_StandJump": "stand"}


def render(glb: Path, out: Path, size: tuple[int, int], *args: str) -> dict:
    marks = out.with_suffix(".json")
    # Node's parseArgs reads "--yaw -1.2" as a missing value: join a negative value on.
    joined: list[str] = []
    for a in args:
        if joined and joined[-1].startswith("--") and "=" not in joined[-1] and a.startswith("-") and a[1:2].isdigit():
            joined[-1] = f"{joined[-1]}={a}"
        else:
            joined.append(a)
    args = tuple(joined)
    cmd = ["node", str(RENDER), "--glb", str(glb), "--out", str(out), "--size", f"{size[0]}x{size[1]}",
           "--shading", "studio", "--marks-json", str(marks), "--mark", "origin=0,0,0", *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"render failed: {' '.join(cmd)}\n{result.stderr[-2000:]}")
    for line in result.stderr.splitlines():
        if line.strip():
            print(f"    {line.strip()}")
    return json.loads(marks.read_text())


def mod_tree(mod: str) -> str:
    return mirror.tree_of(mod)


def soldier_scene(mod: str, scene: dict, work: Path) -> tuple[Image.Image, dict]:
    kit = mirror.kit_row(mod, scene["kit"]) if scene.get("kit") else {}
    soldier = scene.get("soldier") or (kit.get("soldiers") or [None])[0]
    weapon = scene.get("weapon") or kit.get("primary")
    if not soldier or not weapon:
        raise ValueError(f"{mod}/{scene['id']}: no soldier or weapon")
    tree = mod_tree(mod)
    pose_rel = f"{tree}/poses/{soldier}__{weapon}.pose.glb"
    if not mirror.exists(pose_rel) and tree != "models":
        pose_rel = f"models/poses/{soldier}__{weapon}.pose.glb"
    pose = mirror.glb(pose_rel)
    args = ["--yaw", str(scene.get("yaw", 1.9)), "--pitch", str(scene.get("pitch", 0.05)), "--fit", "0.02", "--no-crop"]
    gait = scene.get("gait")
    if gait:
        lower, upper = gait.split("+")
        poses_dir = pose_rel.rsplit("/", 1)[0]
        # A vanilla-style tree carries a recipe per pose naming the gait files it shares
        # (the Panzerschreck moves on the Bazooka's); render-game-sprite reads it beside the glb.
        recipe = mirror.recipe(pose_rel.replace(".pose.glb", ".pose.json"))
        assets = (recipe or {}).get("gaitAssets") or {"lower": "gaits/lower.gait.glb", "upper": f"gaits/{weapon}.gait.glb"}
        wanted = [f"{poses_dir}/{assets['lower']}", f"{poses_dir}/{assets['upper']}"]
        if all(mirror.exists(w) for w in wanted):
            for w in wanted:
                mirror.glb(w)
            args += ["--gait", gait, "--time", str(scene.get("time", 0))]
        else:
            stance = STANCE_OF_GAIT.get(lower.split(".")[0], "stand")
            print(f"    no gaits for {weapon} in {poses_dir}; posing at the {stance} clip")
            args += ["--clip", stance]
    else:
        args += ["--clip", scene.get("clip", "stand")]
    if scene.get("kit"):
        mirror.kit_parts(mod, scene["kit"])
        kits_path = mirror.kits(mod)
        args += ["--kit", f"{kits_path}#{scene['kit']}", "--kit-fallback", str(mirror.CACHE / "models")]
    args += ["--mark-extreme", "muzzle=@rigid:-1,0", "--mark-extreme", "butt=@rigid:1,0",
             "--mark-extreme", "feet=@all:0,1", "--mark-extreme", "head=@all:0,-1"]
    box = BOXES[scene.get("box", "prone" if (gait or "").startswith("lie") else "soldier")]
    size = (box[2] - box[0], box[3] - box[1])
    sprite_path = work / f"{mod}-{scene['id']}.webp"
    info = render(pose, sprite_path, size, *args)
    return place(sprite_path, info, box)


def place(sprite_path: Path, info: dict, box) -> tuple[Image.Image, dict]:
    """The drawn canvas pasted into its box, trimmed to the box's bottom-right,
    and the marks moved into hero coordinates."""
    sprite = Image.open(sprite_path).convert("RGBA")
    bbox = sprite.getbbox() or (0, 0, sprite.width, sprite.height)
    # Push the drawing into the box's bottom right corner: the words go on the left.
    dx = box[2] - (box[0] + bbox[2])
    dy = box[3] - (box[1] + bbox[3])
    hero = Image.new("RGBA", (HERO_W, HERO_H), (0, 0, 0, 0))
    ox, oy = box[0] + dx, box[1] + dy
    hero.alpha_composite(sprite, (ox, oy))
    marks = {k: (v[0] + ox, v[1] + oy) for k, v in info["marks"].items()}
    marks["_bbox"] = (bbox[0] + ox, bbox[1] + oy, bbox[2] + ox, bbox[3] + oy)
    return hero, {"marks": marks, "camera": info["camera"], "offset": (ox, oy)}


def vehicle_scene(mod: str, scene: dict, work: Path) -> tuple[Image.Image, dict]:
    rel = f"{mod_tree(mod)}/{scene['glb']}"
    glb = mirror.glb(rel)
    box = BOXES[scene.get("box", "vehicle")]
    size = (box[2] - box[0], box[3] - box[1])
    args = ["--clip", "none", "--yaw", str(scene["yaw"]), "--pitch", str(scene.get("pitch", 0.12)),
            "--fit", "0.02", "--no-crop", "--mark-extreme", "ground=@all:0,1"]
    if scene.get("rot"):
        args += ["--rot", ",".join(str(v) for v in scene["rot"])]
    if scene.get("barrel"):
        barrel = scene["barrel"]
        args += ["--mark-extreme", f"tip={barrel}:w:0,0,-1", "--mark-extreme", f"base={barrel}:w:0,0,1"]
    # A gun with no barrel mesh of its own (cast into the turret, or a hull gun):
    # its muzzle and breech as world points, or as --mark-extreme specs.
    for name in ("tip", "base"):
        spec = scene.get(name)
        if isinstance(spec, list):
            args += ["--mark", f"{name}={','.join(str(v) for v in spec)}"]
        elif isinstance(spec, str):
            args += ["--mark-extreme", f"{name}={spec}"]
    discs = scene.get("discs", [])
    for i, disc in enumerate(discs):
        for name, d in [("l", "-1,0"), ("r", "1,0"), ("t", "0,-1"), ("b", "0,1")]:
            args += ["--mark-extreme", f"disc{i}{name}={disc['mesh']}:{d}"]
        args += ["--mark-extreme", f"disc{i}c={disc['mesh']}:centre"]
    args += ["--mark-extreme", "nose=@all:-1,0", "--mark-extreme", "middle=@all:centre"]
    sprite_path = work / f"{mod}-{scene['id']}.webp"
    # Pass one fits the camera with everything drawn (so the discs' extents are known);
    # pass two draws without the static propellers and rotors, on the same camera.
    info = render(glb, work / f"{mod}-{scene['id']}-probe.webp", size, *args)
    skips = [d["mesh"] for d in discs] + scene.get("skip", [])
    if skips:
        cam = info["camera"]
        fixed = []
        for a in args:
            if a in ("--fit", "0.02"):
                continue
            if a.startswith("disc") and fixed and fixed[-1] == "--mark-extreme":
                fixed.pop()
                continue
            fixed.append(a)
        fixed += ["--scale", str(cam["scale"]), "--centre", ",".join(str(c) for c in cam["centre"]),
                  "--skip", ",".join(skips)]
        info2 = render(glb, sprite_path, size, *fixed)
        info2["marks"].update({k: v for k, v in info["marks"].items() if k.startswith("disc")})
        info = info2
    else:
        (work / f"{mod}-{scene['id']}-probe.webp").replace(sprite_path)
    hero, meta = place(sprite_path, info, box)
    if scene.get("bomb"):
        bomb_path = work / f"{mod}-{scene['id']}-bomb.webp"
        cam = info["camera"]
        bomb_args = ["--clip", "none", "--yaw", str(scene["yaw"]), "--pitch", str(scene.get("pitch", 0.12)),
                     "--scale", str(cam["scale"]), "--centre", "0,0,0", "--only", scene["bomb"], "--projectiles"]
        if scene.get("rot"):
            bomb_args += ["--rot", ",".join(str(v) for v in scene["rot"])]
        # A plane whose own bomb mesh is only a box (FHSW's B-25) drops another model's bombs.
        bomb_glb = mirror.glb(scene["bombGlb"]) if scene.get("bombGlb") else glb
        render(bomb_glb, bomb_path, (200, 200), *bomb_args)
        meta["bomb"] = Image.open(bomb_path).convert("RGBA")
    return hero, meta


def paint(scene: dict, hero: Image.Image, meta: dict) -> Image.Image:
    """The scene's effects, under and over the subject."""
    m = meta["marks"]
    effect = scene.get("fx", "none")
    under = Image.new("RGBA", hero.size, (0, 0, 0, 0))
    over = Image.new("RGBA", hero.size, (0, 0, 0, 0))
    height = m["_bbox"][3] - m["_bbox"][1]
    if effect in ("smallarms", "mg", "rocket", "flame", "laser-arms"):
        muzzle, butt = m["muzzle"], m["butt"]
        direction = fx.unit(muzzle[0] - butt[0], muzzle[1] - butt[1])
        if effect == "smallarms":
            fx.tracer(under, muzzle, direction, 300, 3, gap=18)
            fx.smoke(over, muzzle, (direction[0], direction[1] - 0.4), 16, 5, alpha=60)
            fx.muzzle_flash(over, muzzle, direction, max(26, height * 0.11))
            fx.brass(over, (muzzle[0] * 0.35 + butt[0] * 0.65, muzzle[1] * 0.35 + butt[1] * 0.65), direction, 3, 5)
        elif effect == "mg":
            for i, (length, off) in enumerate([(330, 0), (260, 70), (190, 150)]):
                start = (muzzle[0] + direction[0] * off, muzzle[1] + direction[1] * off + (i - 1) * 2)
                fx.tracer(under, start, direction, length * 0.45, 3, gap=20)
            fx.smoke(over, muzzle, (direction[0], direction[1] - 0.3), 20, 6, alpha=70)
            fx.muzzle_flash(over, muzzle, direction, max(28, height * 0.32))
            fx.brass(over, (muzzle[0] * 0.4 + butt[0] * 0.6, muzzle[1] * 0.4 + butt[1] * 0.6), direction, 5, 5)
        elif effect == "rocket":
            fx.backblast(under, butt, (-direction[0], -direction[1]), max(70, height * 0.32))
            fx.rocket_trail(over, muzzle, direction, 150, 22)
            fx.muzzle_flash(over, muzzle, direction, 30, seed=3)
        elif effect == "laser-arms":
            for gap in (24, 140, 260):
                fx.bolt(under if gap > 24 else over, muzzle, direction, gap, 55, scene.get("bolt", "red"))
            fx.muzzle_flash(over, muzzle, direction, max(22, height * 0.09), colours=fx.BOLT[scene.get("bolt", "red")])
        elif effect == "flame":
            fx.flame_jet(over, muzzle, direction, 240, 34)
    elif effect == "jetpack":
        feet = m["feet"]
        fx.jet_exhaust(under, (feet[0] + 10, feet[1] - height * 0.35), fx.unit(0.35, 1), 120, 70)
        if "muzzle" in m:
            muzzle, butt = m["muzzle"], m["butt"]
            direction = fx.unit(muzzle[0] - butt[0], muzzle[1] - butt[1])
            fx.tracer(under, muzzle, direction, 260, 3, gap=18)
            fx.muzzle_flash(over, muzzle, direction, 30)
    elif effect == "cannon":
        tip, base = m["tip"], m["base"]
        direction = fx.unit(tip[0] - base[0], tip[1] - base[1])
        ground = m["ground"][1]
        fx.ground_dust(under, ground - 4, m["_bbox"][0] - 40, m["_bbox"][2] * 0.7 + m["_bbox"][0] * 0.3, 28)
        fx.cannon_blast(over, tip, direction, max(70, height * 0.42))
    elif effect == "laser":
        tip, base = m["tip"], m["base"]
        direction = fx.unit(tip[0] - base[0], tip[1] - base[1])
        for i, (gap, length) in enumerate([(30, 70), (150, 70), (280, 70)]):
            fx.bolt(over if i == 0 else under, tip, direction, gap, length, scene.get("bolt", "red"))
        fx.muzzle_flash(over, tip, direction, 26, seed=21, colours=fx.BOLT[scene.get("bolt", "red")])
    elif effect in ("guns", "bombs", "rotor", "lasers"):
        nose, middle = m["nose"], m["middle"]
        direction = fx.unit(nose[0] - middle[0], nose[1] - middle[1])
        bb = m["_bbox"]
        fx.speed_lines(under, (bb[0] + (bb[2] - bb[0]) * 0.4, bb[1], bb[2] + 30, bb[3]), direction, 14)
        if effect in ("guns", "lasers"):
            px, py = -direction[1], direction[0]
            for side in (-1, 1):
                start = (nose[0] + px * side * 14 - direction[0] * 30, nose[1] + py * side * 14 - direction[1] * 30)
                if effect == "lasers":
                    for gap in (40, 170):
                        fx.bolt(under, start, direction, gap, 60, scene.get("bolt", "red"))
                    fx.muzzle_flash(over, (start[0] + direction[0] * 30, start[1] + direction[1] * 30), direction,
                                    20, seed=side + 5, colours=fx.BOLT[scene.get("bolt", "red")])
                    continue
                fx.tracer(under, start, direction, 280, 3, gap=40)
                fx.muzzle_flash(over, (start[0] + direction[0] * 30, start[1] + direction[1] * 30), direction, 24,
                                seed=side + 5)
        if effect == "bombs" and meta.get("bomb") is not None:
            bomb = meta["bomb"]
            release = (middle[0], middle[1] + (bb[3] - middle[1]) * 0.5)
            for i in range(1, 5):
                at = (release[0] + 38 * i - 6 * i * i, release[1] + 34 * i + 6 * i * i)
                if at[1] > HERO_H + 20:
                    break
                fx.falling(over, bomb, at, -12 * i, alpha=1.0)
    for key in [k for k in m if k.startswith("disc") and k.endswith("c")]:
        i = key[4:-1]
        box = (m[f"disc{i}l"][0], m[f"disc{i}t"][1], m[f"disc{i}r"][0], m[f"disc{i}b"][1])
        kind = scene["discs"][int(i)].get("kind", "prop")
        if kind == "rotor":
            pad = (box[2] - box[0]) * 0.05
            fx.rotor_disc(over, (box[0] - pad, box[1] - 3, box[2] + pad, box[3] + 3))
        else:
            w = max(box[2] - box[0], 8)
            h = max(box[3] - box[1], 8)
            fx.prop_disc(over, (box[0] - w * 0.05, box[1], box[0] + w * 1.05, box[1] + h))
    out = Image.new("RGBA", hero.size, (0, 0, 0, 0))
    out.alpha_composite(under)
    out.alpha_composite(fx.rim_shadow(hero, (0, 4), 8, 110))
    out.alpha_composite(hero)
    out.alpha_composite(over)
    return out


def build(mod: str, scene: dict, work: Path) -> Path:
    kind = scene["kind"]
    hero, meta = soldier_scene(mod, scene, work) if kind == "soldier" else vehicle_scene(mod, scene, work)
    art = paint(scene, hero, meta)
    out = OUT / mod / f"{scene['id']}.webp"
    out.parent.mkdir(parents=True, exist_ok=True)
    art.save(out, "WEBP", quality=86, method=6)
    return out


def sheet(paths: list[Path], target: Path) -> None:
    cols = 3
    w, h = HERO_W // 2, HERO_H // 2
    rows = (len(paths) + cols - 1) // cols
    s = Image.new("RGBA", (w * cols, h * rows), (24, 26, 22, 255))
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGBA").resize((w, h), Image.LANCZOS)
        bg = Image.new("RGBA", (w, h), (52, 56, 48, 255))
        bg.alpha_composite(im)
        s.alpha_composite(bg, ((i % cols) * w, (i // cols) * h))
        ImageDraw.Draw(s).text(((i % cols) * w + 4, (i // cols) * h + 3), f"{p.parent.name}/{p.stem}",
                               fill=(255, 220, 120, 255))
    s.save(target)
    print(f"sheet: {target}")


def write_catalogue(catalogue: dict) -> None:
    """What the API offers: each mod's scenes that have art, in catalogue order."""
    mods = []
    for mod, entry in catalogue["mods"].items():
        scenes = [{"id": s["id"], "label": s["label"], "kind": s["kind"], "backdrop": s.get("backdrop")}
                  for s in entry["scenes"] if (OUT / mod / f"{s['id']}.webp").exists()]
        if scenes:
            mods.append({"id": mod, "name": entry["name"], "short": entry["short"], "gameIds": entry.get("gameIds", [mod]),
                         "accent": entry.get("accent", "#ffc400"), "scenes": scenes})
    (OUT / "catalogue.json").write_text(json.dumps({"format": "bfstats-signature-art/1", "width": HERO_W,
                                                    "height": HERO_H, "mods": mods}, indent=1) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("only", nargs="*", help="mod or mod/scene to draw (default: all)")
    parser.add_argument("--sheet", metavar="PNG", help="also write a contact sheet of what was drawn")
    args = parser.parse_args()
    catalogue = json.loads((HERE / "scenes.json").read_text())
    drawn, failed = [], []
    with tempfile.TemporaryDirectory(prefix="signature-art-") as tmp:
        work = Path(tmp)
        for mod, entry in catalogue["mods"].items():
            for scene in entry["scenes"]:
                key = f"{mod}/{scene['id']}"
                if args.only and not any(key == o or mod == o for o in args.only):
                    continue
                print(key)
                try:
                    drawn.append(build(mod, scene, work))
                except Exception as error:  # one bad scene must not stop the rest
                    print(f"  FAILED: {error}")
                    failed.append(key)
    write_catalogue(catalogue)
    if args.sheet and drawn:
        sheet(drawn, Path(args.sheet))
    print(f"drew {len(drawn)}, failed {len(failed)}: {' '.join(failed)}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
