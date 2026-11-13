"""Effects painted over a posed sprite for the forum signatures.

Everything here draws on a transparent RGBA layer the size of the hero canvas,
so the result reads on any backdrop the API puts behind it: muzzle flashes,
tracers, smoke, a rocket's backblast, a cannon's blast, a propeller disc,
falling bombs. Colours come from the game's own effects (warm tungsten
flashes, yellow-white tracers) rather than the site palette.
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

FLASH_CORE = (255, 250, 220)
FLASH_HOT = (255, 214, 120)
FLASH_EDGE = (255, 132, 40)
TRACER = (255, 236, 160)
SMOKE = (196, 190, 176)


def unit(dx: float, dy: float) -> tuple[float, float]:
    length = math.hypot(dx, dy) or 1.0
    return dx / length, dy / length


def _layer(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def _glow(layer: Image.Image, radius: float, strength: float = 1.0) -> Image.Image:
    """The layer with a soft halo of itself underneath."""
    halo = layer.filter(ImageFilter.GaussianBlur(radius))
    if strength != 1.0:
        alpha = halo.getchannel("A").point(lambda a: min(255, int(a * strength)))
        halo.putalpha(alpha)
    out = _layer(layer.size)
    out.alpha_composite(halo)
    out.alpha_composite(layer)
    return out


def _star(draw: ImageDraw.ImageDraw, at, direction, length, width, points, colour, rng, forward_bias=1.0):
    """A flash star: spikes around `at`, the ones along `direction` longest."""
    ax, ay = at
    dx, dy = direction
    base = math.atan2(dy, dx)
    poly = []
    n = points * 2
    for i in range(n):
        angle = base + (i / n) * math.tau
        along = math.cos(angle - base)
        if i % 2 == 0:
            reach = length * (0.35 + 0.65 * max(0.0, along) ** 1.6 * forward_bias) * rng.uniform(0.8, 1.15)
            reach = max(reach, length * 0.3)
        else:
            reach = width * rng.uniform(0.6, 1.0)
        poly.append((ax + math.cos(angle) * reach, ay + math.sin(angle) * reach))
    draw.polygon(poly, fill=colour)


# Blaster bolts (Galactic Conquest): a white core in a coloured sheath.
BOLT = {
    "red": ((255, 236, 230), (255, 90, 70), (220, 30, 20)),
    "green": ((236, 255, 230), (110, 255, 120), (30, 200, 40)),
}


def muzzle_flash(canvas: Image.Image, at, direction, size: float, seed: int = 1, colours=None) -> None:
    """A small-arms flash: a forward star, a hot core and a warm halo."""
    core, hot, edge = colours or (FLASH_CORE, FLASH_HOT, FLASH_EDGE)
    rng = random.Random(seed)
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    _star(draw, at, direction, size, size * 0.28, 5, edge + (215,), rng)
    _star(draw, at, direction, size * 0.68, size * 0.2, 5, hot + (240,), rng)
    r = size * 0.16
    draw.ellipse([at[0] - r, at[1] - r, at[0] + r, at[1] + r], fill=core + (255,))
    canvas.alpha_composite(_glow(layer, size * 0.35, 1.1))


def tracer(canvas: Image.Image, start, direction, length: float, width: float, gap: float = 0.0) -> None:
    """A tracer streak leaving `start` along `direction`, bright at its head."""
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    dx, dy = direction
    sx, sy = start[0] + dx * gap, start[1] + dy * gap
    steps = 28
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        alpha = int(255 * (1 - t0) ** 1.4)
        w = max(1, round(width * (1 - 0.6 * t0)))
        draw.line([(sx + dx * length * t0, sy + dy * length * t0), (sx + dx * length * t1, sy + dy * length * t1)],
                  fill=TRACER + (alpha,), width=w)
    canvas.alpha_composite(_glow(layer, width * 2.2, 1.3))


def smoke(canvas: Image.Image, at, direction, spread: float, puffs: int, seed: int = 2, alpha: int = 70,
          colour=SMOKE) -> None:
    """Soft grey puffs drifting from `at` along `direction`."""
    rng = random.Random(seed)
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    dx, dy = direction
    for i in range(puffs):
        t = (i + 1) / puffs
        r = spread * (0.25 + 0.6 * t) * rng.uniform(0.8, 1.2)
        cx = at[0] + dx * spread * 1.6 * t + rng.uniform(-0.3, 0.3) * spread
        cy = at[1] + dy * spread * 1.6 * t - spread * 0.5 * t + rng.uniform(-0.25, 0.25) * spread
        a = int(alpha * (1 - 0.65 * t))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour + (a,))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(spread * 0.22)))


def brass(canvas: Image.Image, at, direction, count: int, scale: float, seed: int = 3) -> None:
    """Spent cases flicked out of the ejection port, up and back."""
    rng = random.Random(seed)
    draw = ImageDraw.Draw(canvas)
    dx, dy = direction
    for i in range(count):
        t = (i + 1) / count
        cx = at[0] - dx * scale * (1.2 + 2.2 * t) + rng.uniform(-1, 1) * scale * 0.4
        cy = at[1] - scale * (2.2 * t - 1.6 * t * t) * 1.4 + rng.uniform(-1, 1) * scale * 0.3
        angle = rng.uniform(0, math.pi)
        hx, hy = math.cos(angle) * scale * 0.42, math.sin(angle) * scale * 0.42
        draw.line([(cx - hx, cy - hy), (cx + hx, cy + hy)], fill=(214, 168, 72, 255), width=max(1, round(scale * 0.28)))


def backblast(canvas: Image.Image, at, direction, size: float, seed: int = 4) -> None:
    """A launcher's backblast: a flame cone out of the rear and a dust cloud."""
    rng = random.Random(seed)
    dx, dy = direction
    px, py = -dy, dx
    smoke(canvas, (at[0] + dx * size * 0.4, at[1] + dy * size * 0.4), direction, size * 0.9, 9, seed, alpha=95,
          colour=(186, 176, 158))
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    for scale, colour in [(1.0, FLASH_EDGE + (190,)), (0.66, FLASH_HOT + (230,)), (0.34, FLASH_CORE + (255,))]:
        reach = size * 1.25 * scale
        half = size * 0.42 * scale
        poly = [(at[0] + px * half * 0.25, at[1] + py * half * 0.25)]
        for k in range(9):
            t = k / 8
            spread = (t - 0.5) * 2
            jag = rng.uniform(0.75, 1.1)
            poly.append((at[0] + dx * reach * jag * (1 - 0.35 * spread * spread) + px * half * spread,
                         at[1] + dy * reach * jag * (1 - 0.35 * spread * spread) + py * half * spread))
        poly.append((at[0] - px * half * 0.25, at[1] - py * half * 0.25))
        draw.polygon(poly, fill=colour)
    canvas.alpha_composite(_glow(layer, size * 0.3, 1.2))


def rocket_trail(canvas: Image.Image, muzzle, direction, length: float, size: float) -> None:
    """The round leaving the tube: a bright motor and a smoke trail back to the muzzle."""
    dx, dy = direction
    head = (muzzle[0] + dx * length, muzzle[1] + dy * length)
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    steps = 24
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        a = int(150 * t1)
        draw.line([(muzzle[0] + dx * length * t0, muzzle[1] + dy * length * t0),
                   (muzzle[0] + dx * length * t1, muzzle[1] + dy * length * t1)],
                  fill=(210, 204, 190, a), width=max(2, round(size * (0.25 + 0.5 * t1))))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(size * 0.18)))
    muzzle_flash(canvas, head, (-dx, -dy), size * 0.9, seed=11)
    r = size * 0.22
    ImageDraw.Draw(canvas).ellipse([head[0] - r, head[1] - r, head[0] + r, head[1] + r], fill=(70, 66, 58, 255))


def cannon_blast(canvas: Image.Image, at, direction, size: float, seed: int = 5) -> None:
    """A tank gun firing: a muzzle-brake flash (forward and two side lobes), smoke."""
    dx, dy = direction
    px, py = -dy, dx
    smoke(canvas, at, direction, size * 0.9, 12, seed, alpha=105)
    smoke(canvas, at, (px * 0.6 + dx * 0.4, py * 0.6 + dy * 0.4), size * 0.5, 6, seed + 1, alpha=80)
    smoke(canvas, at, (-px * 0.6 + dx * 0.4, -py * 0.6 + dy * 0.4), size * 0.5, 6, seed + 2, alpha=80)
    muzzle_flash(canvas, at, direction, size * 1.05, seed)
    muzzle_flash(canvas, at, unit(px + dx * 0.25, py + dy * 0.25), size * 0.45, seed + 3)
    muzzle_flash(canvas, at, unit(-px + dx * 0.25, -py + dy * 0.25), size * 0.45, seed + 4)


def ground_dust(canvas: Image.Image, y: float, x0: float, x1: float, height: float, seed: int = 6) -> None:
    """Dust kicked up along a line on the ground (under a tank that just fired)."""
    rng = random.Random(seed)
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    for _ in range(26):
        cx = rng.uniform(x0, x1)
        r = height * rng.uniform(0.35, 0.9)
        draw.ellipse([cx - r * 1.6, y - r, cx + r * 1.6, y + r * 0.4], fill=(170, 154, 126, rng.randint(30, 70)))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(height * 0.3)))


def prop_disc(canvas: Image.Image, box) -> None:
    """A spinning propeller: a faint disc with two brighter blade arcs."""
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    draw.ellipse(box, fill=(210, 210, 200, 46), outline=(235, 235, 225, 70), width=2)
    draw.arc(box, 200, 250, fill=(240, 240, 235, 110), width=3)
    draw.arc(box, 20, 70, fill=(240, 240, 235, 110), width=3)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.2)))
    ImageDraw.Draw(canvas).ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(40, 38, 34, 255))


def rotor_disc(canvas: Image.Image, box) -> None:
    """A helicopter's main rotor at speed: a wide, thin, faint ellipse."""
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    draw.ellipse(box, fill=(200, 200, 192, 34), outline=(220, 220, 210, 64), width=2)
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.5)))


def speed_lines(canvas: Image.Image, box, direction, count: int, seed: int = 7) -> None:
    """Thin streaks behind a fast aircraft."""
    rng = random.Random(seed)
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    dx, dy = direction
    for _ in range(count):
        sx, sy = rng.uniform(x0, x1), rng.uniform(y0, y1)
        length = rng.uniform(40, 120)
        draw.line([(sx, sy), (sx - dx * length, sy - dy * length)], fill=(235, 235, 225, rng.randint(40, 90)), width=1)
    canvas.alpha_composite(layer)


def falling(canvas: Image.Image, sprite: Image.Image, at, angle_deg: float, alpha: float = 1.0) -> None:
    """Paste one bomb sprite at `at` (its centre), turned and faded, with a motion streak above."""
    # A big aircraft's bombs come out a few pixels long at its scale; keep each one legible.
    longest = max(sprite.size)
    if longest < 34:
        k = 34 / longest
        sprite = sprite.resize((max(1, round(sprite.width * k)), max(1, round(sprite.height * k))), Image.LANCZOS)
    turned = sprite.rotate(angle_deg, resample=Image.BICUBIC, expand=True)
    if alpha < 1.0:
        a = turned.getchannel("A").point(lambda v: int(v * alpha))
        turned.putalpha(a)
    streak = _layer(canvas.size)
    draw = ImageDraw.Draw(streak)
    h = turned.height
    for k in range(6):
        off = (k - 2.5) * max(1.0, turned.width / 8)
        draw.line([(at[0] + off, at[1] - h * 0.4), (at[0] + off * 0.6, at[1] - h * 2.2)],
                  fill=(230, 230, 220, int(40 * alpha)), width=1)
    canvas.alpha_composite(streak.filter(ImageFilter.GaussianBlur(0.8)))
    canvas.alpha_composite(turned, (int(at[0] - turned.width / 2), int(at[1] - turned.height / 2)))


def flame_jet(canvas: Image.Image, at, direction, length: float, size: float, seed: int = 8) -> None:
    """A flamethrower's stream: a widening tongue of fire breaking into puffs."""
    rng = random.Random(seed)
    dx, dy = direction
    px, py = -dy, dx
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    for i in range(40):
        t = i / 39
        cx = at[0] + dx * length * t + px * size * 0.5 * math.sin(t * 7 + rng.random()) * t
        cy = at[1] + dy * length * t + py * size * 0.5 * math.sin(t * 7 + rng.random()) * t + length * 0.12 * t * t
        r = size * (0.15 + 0.85 * t) * rng.uniform(0.8, 1.2)
        colour = FLASH_CORE if t < 0.12 else FLASH_HOT if t < 0.45 else FLASH_EDGE
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour + (int(230 * (1 - 0.55 * t)),))
    canvas.alpha_composite(_glow(layer.filter(ImageFilter.GaussianBlur(size * 0.12)), size * 0.5, 1.2))
    smoke(canvas, (at[0] + dx * length, at[1] + dy * length - size), (dx, dy - 0.6), size * 1.4, 8, seed, alpha=60,
          colour=(70, 64, 58))


def jet_exhaust(canvas: Image.Image, at, direction, length: float, size: float) -> None:
    """A rocket pack's exhaust: a hot core and a long smoke plume."""
    smoke(canvas, (at[0] + direction[0] * length * 0.4, at[1] + direction[1] * length * 0.4), direction, length * 0.5,
          10, 9, alpha=80)
    backblast(canvas, at, direction, size, seed=12)


def rim_shadow(sprite: Image.Image, offset=(0, 0), blur: float = 6.0, alpha: int = 120) -> Image.Image:
    """A soft dark silhouette of the sprite, to lift it off a busy backdrop."""
    a = sprite.getchannel("A").point(lambda v: int(v * alpha / 255))
    shadow = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    shadow.putalpha(a)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    if offset != (0, 0):
        shadow = ImageChops.offset(shadow, *offset)
    return shadow


def bolt(canvas: Image.Image, start, direction, gap: float, length: float, colour: str = "red") -> None:
    """One blaster bolt `gap` ahead of `start`: a short glowing dash."""
    core, hot, edge = BOLT[colour]
    dx, dy = direction
    a = (start[0] + dx * gap, start[1] + dy * gap)
    b = (a[0] + dx * length, a[1] + dy * length)
    layer = _layer(canvas.size)
    draw = ImageDraw.Draw(layer)
    draw.line([a, b], fill=edge + (230,), width=7)
    draw.line([a, b], fill=hot + (255,), width=4)
    draw.line([a, b], fill=core + (255,), width=2)
    canvas.alpha_composite(_glow(layer, 5, 1.4))
