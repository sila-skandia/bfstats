"""Python port of PlaneControl::towardsDirection (0x08629fa0), engine frame."""
import math


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def norm(v):
    l = math.sqrt(dot(v, v))
    return [x / l for x in v] if l > 0 else v


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def shape(v):
    return -math.log10(1 - v * 9) if v < 0 else math.log10(v * 9 + 1)


def towards(dir_, R, U, F, w, p18, p1c, p20, p38, p3c, p40, maxClimb, maxRoll):
    D = norm(dir_)
    Rh = norm(cross([0, 1, 0], F))
    Fh = cross(Rh, [0, 1, 0])
    Ul = cross(F, Rh)
    behind = dot(D, F) < 0 or dot(D, Fh) < 0
    wRh, wUl, wF = dot(w, Rh), dot(w, Ul), dot(w, F)
    bank = dot(Ul, R)
    upright = dot(Ul, U)
    s = clamp(p18 / p1c, 0, 1)
    q = clamp(p3c / 43.0, 0, 1)
    k = ((math.exp((1 - q) * 2.3025851) - 1) / 9.0) * -0.833 + 0.333
    kc = clamp(k, -1, maxClimb)
    if Ul[1] > 0:
        if F[1] > 0:
            L = (1 - Ul[1]) * kc if kc < 0 else kc * Ul[1]
        else:
            L = kc / Ul[1]
    else:
        L = 1.0
    thr = max(p38, s)
    up = min(dot(Ul, D), L) * (1 - s) + s
    side = 0.0
    if not p20:
        side = dot(D, Rh)
        if behind:
            side = 1.0 if side > 0 else (-1.0 if side < 0 else 0.0)
    if p40 and up < 0 and dot(F, D) > 0.9 and side < 0.1:
        t = math.log10(1 - up * 18.0)
        if t <= 0.3:
            t = 0.3
        up = -clamp(t, 0, 1)
    if kc < F[1]:
        up = min(up, -math.log10((F[1] - kc) * 9.0 + 1))
    P = clamp(clamp(wRh, -1, 1) + up, -1, 1)
    Y = clamp(side - clamp(wUl, -1, 1) * 0.1, -1, 1)
    yaw = dot(R, Rh) * Y + dot(R, Ul) * P
    pitch = -(dot(U, Rh) * Y + dot(U, Ul) * P)
    if upright >= 0:
        b = bank
    else:
        b = 2 * (1 if bank > 0 else (-1 if bank < 0 else 0)) - bank
    Yr = Y * ((1 - P) / 0.134 if P >= 0.866 else 1)
    Yr = clamp(Yr, -maxRoll, maxRoll)
    roll = 0.5 * clamp(wF, -1, 1) + b + Yr
    return {0x50: thr, 0x54: shape(clamp(yaw, -1, 1)), 0x10c: shape(clamp(roll, -1, 1)),
            0x110: shape(clamp(pitch, -1, 1))}
