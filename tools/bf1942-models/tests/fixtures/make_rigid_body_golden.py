"""Writes `rigid_body_golden.json`: golden ticks for `viewer/rigid-body.js`,
computed by a pure-Python reference model, for `tests/rigid_body_harness.mjs`
+ `tests/test_rigid_body.py` to replay through the real module and compare to
1e-9.

The reference is `Model` in
`features/vehicle-collision-physics/tools/emulator/r2_node_test_lib.py` --
the class the V2 verifier ran as the game server's own machine code under
Unicorn and found to agree with to float32 rounding (worst abs err 6.5e-06,
`V2-verification-of-R2.md` §0). That module cannot be imported here: its
first line is `from r2_emu import *`, and `r2_emu` imports `unicorn`, which
is not installed in this environment (checked directly: `import unicorn`
raises `ModuleNotFoundError`) and which the briefing says not to require.

So `RefModel` below is a **copy** of that class's arithmetic -- `cross`,
`dot`, `add`, `sub`, `mul`, `rot_rows` (renamed `rotate_axes_about`) and the
body of `Model.update` -- restated with separate `pos`/`axes` fields instead
of the emulator harness's 4-row transform (`Model` folds position into
`M[3][:3]` because that is how the real struct is laid out in memory; this
generator has no struct to match, so it uses the plainer shape
`rigid-body.js` itself uses) and extended two ways beyond what `r2_node_test*`
exercises:

  - `is_soldier`, per `collision-response.md` F8's `templateClassId != 0x9493`
    exemption from the automatic wake tests and sleep countdown.
  - the geometry-less fallback branch (F6 else-branch, `box=None`). R2's own
    harness never drives this path and V2 §0 says so explicitly ("the
    fallback guard stays unexercised, dead branch anyway, flag 0x4000000 is
    never set") -- unlike every other branch here, this one is **not**
    machine-code-verified, only read from the decompile's address ordering
    (see `rigid-body.js`'s `step` comment on the same branch, and this
    file's own report to the lead). Both sides of the golden comparison
    (this script and `rigid-body.js`) implement the same reading, so the
    test proves the two are consistent with each other and with that
    reading of the spec -- not that the reading is correct.

Every scenario is built from one small, explicit op vocabulary --
`addAccelerationAt`, `addAcceleration`, `addFrictionAt`, `translate`, `wake`,
`setSleepiness`, `setV`/`setW`/`setAcc`/`setRacc`/`setFr`/`setRfr` (direct
field pokes -- legitimate because `rigid-body.js`'s interface exposes these as
plain public arrays, and the only way to land a body on an *exact* clamp or
wake boundary without fighting float rounding through several ticks of
force application), `step`, `tangentSpeed` and `reset` -- so that
`rigid_body_harness.mjs` can replay the identical op list against the real
module with no scenario-specific logic on either side.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

TICK = 1 / 30
GRAVITY = -14.73
FRAMES_BEFORE_SLEEP = 100
ACCEL_CLAMP_LIMIT_SQ = 1e6
ACCEL_CLAMP_SPEED = 1000
POSITIONAL_FRICTION_ZERO_SQ = 62500
ROTATIONAL_FRICTION_ZERO_SQ = 40000
WAKE_ACCEL_SQ = 2.5
WAKE_LINEAR_SPEED_SQ = 0.25
WAKE_ANGULAR_SPEED_SQ = 0.25
# Not a round 1e-6: the emulated machine code compares against this exact
# constant (R2's `r2_node_test_lib.py` `Model.update`, `v2-emu-extra.py`),
# one ULP off a round number. See `rigid-body.js`'s `ROTATION_THRESHOLD_SQ`.
ROTATION_THRESHOLD_SQ = 1.0000001e-6
FALLBACK_INERTIA = 0.0314


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def add(a, b):
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def mul(a, s):
    return [a[0] * s, a[1] * s, a[2] * s]


def box_inertia(dx, dy, dz):
    """`boxInertia` in `rigid-body.js` -- `getGeometryInertia`, F7."""
    return [(dy * dy + dz * dz) / 3, (dz * dz + dx * dx) / 3, (dx * dx + dy * dy) / 3]


def rotate_axes_about(axes, n, angle):
    """Rodrigues on each row of `axes`, in place semantics via a fresh list --
    `rot_rows` in `r2_node_test_lib.py`, restated over a 3x3 (no translation
    row to skip)."""
    c, s = math.cos(angle), math.sin(angle)
    out = []
    for r in axes:
        d = dot(n, r)
        cr = cross(n, r)
        out.append([
            r[0] * c + cr[0] * s + n[0] * d * (1 - c),
            r[1] * c + cr[1] * s + n[1] * d * (1 - c),
            r[2] * c + cr[2] * s + n[2] * d * (1 - c),
        ])
    return out


class RefModel:
    """See module docstring: a copy of `r2_node_test_lib.py`'s `Model`, with
    `pos`/`axes` split out and the soldier exemption + fallback branch added.
    """

    def __init__(self, mass=1.0, inertia_modifier=(1, 1, 1), box=None,
                 gravity_modifier=1.0, com_offset=(0, 0, 0), position=(0, 0, 0),
                 axes=None, is_soldier=False):
        self.mass = mass
        self.inertia_modifier = list(inertia_modifier)
        self.has_geometry = box is not None
        self.inertia = box_inertia(*box) if box is not None else None
        self.gravity_modifier = gravity_modifier
        self.com_offset = list(com_offset)
        self.is_soldier = is_soldier
        self.pos = list(position)
        self.axes = [list(r) for r in axes] if axes is not None else [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        self.v = [0.0, 0.0, 0.0]
        self.w = [0.0, 0.0, 0.0]
        # Born awake, acc still zero: the first `step` seeds no gravity
        # (collision-response.md §4.2; F8's "gravity used in tick N was
        # written at the end of tick N-1").
        self.acc = [0.0, 0.0, 0.0]
        self.racc = [0.0, 0.0, 0.0]
        self.fr = [0.0, 0.0, 0.0]
        self.rfr = [0.0, 0.0, 0.0]
        self.n = 0
        self.sleepiness = FRAMES_BEFORE_SLEEP

    # -- accumulators, F4 --------------------------------------------------

    def add_acceleration_at(self, p, a):
        self.acc = add(self.acc, a)
        r = sub(sub(p, self.pos), self.com_offset)
        self.racc = add(self.racc, cross(r, a))

    def add_acceleration(self, a):
        self.acc = add(self.acc, a)

    def add_friction_at(self, p, f):
        n = self.n
        k = 1.0 / (n + 1)
        self.fr = mul(add(mul(self.fr, n), f), k)
        r = sub(p, self.pos)
        self.rfr = mul(add(mul(self.rfr, n), cross(r, f)), k)
        self.n = n + 1

    def tangent_speed(self, p):
        return add(self.v, cross(self.w, sub(p, self.pos)))

    def translate(self, dp):
        self.pos = add(self.pos, dp)

    def wake(self):
        self.sleepiness = FRAMES_BEFORE_SLEEP

    def reset(self, position=None, axes=None):
        if position is not None:
            self.pos = list(position)
        if axes is not None:
            self.axes = [list(r) for r in axes]
        self.v = [0.0, 0.0, 0.0]
        self.w = [0.0, 0.0, 0.0]
        self.acc = [0.0, 0.0, 0.0]
        self.racc = [0.0, 0.0, 0.0]
        self.fr = [0.0, 0.0, 0.0]
        self.rfr = [0.0, 0.0, 0.0]
        self.n = 0
        self.sleepiness = FRAMES_BEFORE_SLEEP

    # -- the integrator, F8 --------------------------------------------------

    def step(self, dt=TICK):
        if self.sleepiness >= 0 and not self.is_soldier:
            if (dot(self.acc, self.acc) >= WAKE_ACCEL_SQ
                    or dot(self.v, self.v) >= WAKE_LINEAR_SPEED_SQ
                    or dot(self.w, self.w) >= WAKE_ANGULAR_SPEED_SQ):
                self.sleepiness = FRAMES_BEFORE_SLEEP
            elif self.sleepiness > 0:
                self.sleepiness -= 1

        if self.sleepiness <= 0:
            self.v = [0.0, 0.0, 0.0]
            self.w = [0.0, 0.0, 0.0]
            self.acc = [0.0, 0.0, 0.0]
            self.racc = [0.0, 0.0, 0.0]
            self.fr = [0.0, 0.0, 0.0]
            self.rfr = [0.0, 0.0, 0.0]
            self.n = 0
            return

        # No dragHook here: the generator never sets one (drag stays the
        # lead's viewer-side code, per the briefing).

        a2 = dot(self.acc, self.acc)
        if a2 > ACCEL_CLAMP_LIMIT_SQ:
            self.acc = mul(self.acc, ACCEL_CLAMP_SPEED / math.sqrt(a2))
        if dot(self.fr, self.fr) > POSITIONAL_FRICTION_ZERO_SQ:
            self.fr = [0.0, 0.0, 0.0]
        self.v = add(self.v, mul(self.acc, dt))
        self.v = add(self.v, mul(self.fr, dt))
        self.pos = add(self.pos, mul(self.v, dt))
        self.acc = [0.0, 0.0, 0.0]
        self.fr = [0.0, 0.0, 0.0]

        r2 = dot(self.racc, self.racc)
        if r2 > ACCEL_CLAMP_LIMIT_SQ:
            self.racc = mul(self.racc, ACCEL_CLAMP_SPEED / math.sqrt(r2))

        dw = [0.0, 0.0, 0.0]
        if self.has_geometry:
            Tpre = add(self.racc, self.rfr)
            if dot(self.rfr, self.rfr) > ROTATIONAL_FRICTION_ZERO_SQ:
                self.rfr = [0.0, 0.0, 0.0]
            Tpost = add(self.racc, self.rfr)
            I = self.inertia
            imod = self.inertia_modifier
            for axis, T in ((2, Tpre), (1, Tpost), (0, Tpost)):
                e = self.axes[axis]
                l2 = dot(e, e)
                if l2 == 0:
                    continue
                k = dot(T, e) / l2 * (dt / (imod[axis] * I[axis]))
                dw = add(dw, mul(e, k))
            if not all(math.isfinite(x) for x in dw):
                dw = [0.0, 0.0, 0.0]
        else:
            # Fallback (F6 else-branch): no 40000 rfr-zero test (see module
            # docstring), raw racc+rfr scaled by dt/FALLBACK_INERTIA, then
            # the result itself is dropped (not scaled) past 1e6.
            k = dt / FALLBACK_INERTIA
            t = add(self.racc, self.rfr)
            dw = mul(t, k)
            if dot(dw, dw) > ACCEL_CLAMP_LIMIT_SQ:
                dw = [0.0, 0.0, 0.0]
            if not all(math.isfinite(x) for x in dw):
                dw = [0.0, 0.0, 0.0]

        self.w = add(self.w, dw)
        wsq = dot(self.w, self.w)
        if wsq > ROTATION_THRESHOLD_SQ:
            wl = math.sqrt(wsq)
            self.axes = rotate_axes_about(self.axes, mul(self.w, 1.0 / wl), dt * wl)

        self.racc = [0.0, 0.0, 0.0]
        self.rfr = [0.0, 0.0, 0.0]
        self.n = 0
        self.acc = [0.0, GRAVITY * self.gravity_modifier, 0.0]


def snapshot(m: RefModel) -> dict:
    return {
        "pos": list(m.pos), "axes": [list(r) for r in m.axes],
        "v": list(m.v), "w": list(m.w),
        "acc": list(m.acc), "racc": list(m.racc),
        "fr": list(m.fr), "rfr": list(m.rfr),
        "n": m.n, "sleepiness": m.sleepiness,
    }


def apply_op(m: RefModel, op: dict) -> dict:
    kind = op["op"]
    if kind == "step":
        m.step(op.get("dt", TICK))
    elif kind == "addAccelerationAt":
        m.add_acceleration_at(op["p"], op["a"])
    elif kind == "addAcceleration":
        m.add_acceleration(op["a"])
    elif kind == "addFrictionAt":
        m.add_friction_at(op["p"], op["f"])
    elif kind == "translate":
        m.translate(op["dp"])
    elif kind == "wake":
        m.wake()
    elif kind == "setSleepiness":
        m.sleepiness = op["n"]
    elif kind == "setV":
        m.v = list(op["v"])
    elif kind == "setW":
        m.w = list(op["w"])
    elif kind == "setAcc":
        m.acc = list(op["acc"])
    elif kind == "setRacc":
        m.racc = list(op["racc"])
    elif kind == "setFr":
        m.fr = list(op["fr"])
    elif kind == "setRfr":
        m.rfr = list(op["rfr"])
    elif kind == "reset":
        m.reset(op.get("position"), op.get("axes"))
    elif kind == "tangentSpeed":
        return {"tangent": m.tangent_speed(op["p"])}
    else:
        raise ValueError(f"unknown op {kind!r}")
    return snapshot(m)


IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def rot_y_axes(theta):
    c, s = math.cos(theta), math.sin(theta)
    return [[c, 0, -s], [0, 1, 0], [s, 0, c]]


def build_scenarios() -> list[dict]:
    scenarios = []

    def add(name, init, ops):
        scenarios.append({"name": name, "init": init, "ops": ops})

    # 1. Free fall from rest: first integrated tick has zero v (no gravity
    # seeded yet, §4.2); from the second tick on, gravity alone keeps the
    # body awake forever (|g|^2 = 217.05 >= 2.5, §4.3's own observation).
    add("free_fall_from_rest",
        dict(mass=2500, inertia_modifier=[1, 1, 1], box=[2.4, 1.8, 4.2],
             gravity_modifier=1.0, position=[0, 5, 0], axes=IDENTITY),
        [{"op": "step", "dt": TICK} for _ in range(4)])

    # 2. Off-centre acceleration impulses producing spin: non-cubic box,
    # non-trivial inertiaModifier, and axes rotated away from world so the
    # per-axis projection is genuinely exercised (not just identity-aligned).
    # Ends with a reset() to also cover the respawn API against the model.
    add("off_centre_impulse_spin",
        dict(mass=25000, inertia_modifier=[1.5, 0.7, 2.0], box=[3.0, 2.0, 6.0],
             gravity_modifier=0.0, position=[100, 20, -50], axes=rot_y_axes(0.5)),
        [
            {"op": "addAccelerationAt", "p": [101.2, 20.3, -50.8], "a": [0, 25, 0]},
            {"op": "step", "dt": TICK},
            {"op": "addAccelerationAt", "p": [99.4, 20.0, -49.0], "a": [15, 0, 5]},
            {"op": "step", "dt": TICK},
            {"op": "step", "dt": TICK},
        ])

    # 3. Friction accumulator: a running MEAN over 3 non-parallel (p, f)
    # samples, not a sum -- checked after every sample, then integrated.
    add("friction_average_three_samples",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=1.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "addFrictionAt", "p": [1, 0, 0], "f": [0, 3, 0]},
            {"op": "addFrictionAt", "p": [0, 0, 1], "f": [4, 0, 0]},
            {"op": "addFrictionAt", "p": [0, 1, 0], "f": [0, 0, 5]},
            {"op": "step", "dt": TICK},
        ])

    # 4. |acc|^2 just above 1e6: scaled down to speed 1000, direction kept.
    add("accel_clamp_edge",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setAcc", "acc": [1000.1 * 0.6, 1000.1 * 0.8, 0]},  # |acc|^2 = 1000200.01
            {"op": "step", "dt": TICK},
        ])

    # 5. |fr|^2 above 62500: dropped whole, not scaled -- v unaffected.
    add("friction_clamp_drop_edge",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setFr", "fr": [252, 0, 0]},  # |fr|^2 = 63504
            {"op": "step", "dt": TICK},
        ])

    # 6. |rfr|^2 above 40000 with a non-zero Z component: the Tpre/Tpost
    # quirk (Z reads the sum from BEFORE the zeroing, X/Y read it AFTER).
    add("rot_friction_clamp_tpre_tpost_quirk",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[3, 2, 5],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setRacc", "racc": [10, 10, 10]},
            {"op": "setRfr", "rfr": [0, 0, 205]},  # |rfr|^2 = 42025
            {"op": "step", "dt": TICK},
        ])

    # 7. |racc|^2 just above 1e6: scaled to speed 1000 BEFORE Tpre/Tpost.
    add("racc_clamp_edge",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setRacc", "racc": [1000.1 * 0.6, 1000.1 * 0.8, 0]},
            {"op": "step", "dt": TICK},
        ])

    # 8. Sleep countdown to exactly 0. Gravity zeroed out so the countdown
    # can actually complete (a real free body's own gravity re-wakes it
    # every tick forever -- scenario 1's own point).
    add("sleep_countdown_to_zero",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [{"op": "step", "dt": TICK} for _ in range(100)])

    # 9-11. The three wake thresholds at their exact >= boundary, each also
    # checked just below the boundary (must NOT wake, decrements instead).
    add("wake_accel_boundary",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setSleepiness", "n": 5},
            {"op": "setAcc", "acc": [math.sqrt(2.5), 0, 0]},  # |acc|^2 == 2.5
            {"op": "step", "dt": TICK},                        # -> wakes (100)
            {"op": "setSleepiness", "n": 5},
            {"op": "setAcc", "acc": [math.sqrt(2.4), 0, 0]},  # |acc|^2 == 2.4
            {"op": "step", "dt": TICK},                        # -> decrements (4)
        ])
    add("wake_linear_speed_boundary",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setSleepiness", "n": 5},
            {"op": "setV", "v": [0.5, 0, 0]},   # |v|^2 == 0.25 exactly
            {"op": "step", "dt": TICK},          # -> wakes (100)
            {"op": "setSleepiness", "n": 5},
            {"op": "setV", "v": [0.49, 0, 0]},  # |v|^2 == 0.2401
            {"op": "step", "dt": TICK},          # -> decrements (4)
        ])
    add("wake_angular_speed_boundary",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setSleepiness", "n": 5},
            {"op": "setW", "w": [0.5, 0, 0]},   # |w|^2 == 0.25 exactly
            {"op": "step", "dt": TICK},          # -> wakes (100)
            {"op": "setSleepiness", "n": 5},
            {"op": "setW", "w": [0.49, 0, 0]},  # |w|^2 == 0.2401
            {"op": "step", "dt": TICK},          # -> decrements (4)
        ])

    # 12. A sleeping body still accepts addAccelerationAt (the resolve pass
    # has no sleep gate, §4.3/V2 §3), but next tick's asleep branch discards
    # it -- since the acceleration here is far under the wake threshold.
    add("sleeping_body_accel_zeroed_next_step",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "setSleepiness", "n": 0},
            {"op": "addAccelerationAt", "p": [0, 1, 0], "a": [0.5, 0, 0]},
            {"op": "step", "dt": TICK},
        ])

    # 13. Geometry-less fallback branch: the ordinary formula, then a
    # scenario that forces the fallback's own |dw|^2 > 1e6 drop, having
    # first gone through the shared racc pre-clamp (5000 -> 1000).
    add("geometry_less_fallback_branch",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=None,
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "addAccelerationAt", "p": [1, 0, 0], "a": [0, 0, 3]},
            {"op": "addFrictionAt", "p": [0, 0, 1], "f": [2, 0, 0]},
            {"op": "step", "dt": TICK},
            {"op": "setRacc", "racc": [5000, 0, 0]},
            {"op": "setRfr", "rfr": [0, 0, 0]},
            {"op": "step", "dt": TICK},
        ])

    # 14. tangentSpeed: v alone, then a lever arm that is and is not
    # perpendicular to w.
    add("tangent_speed",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[10, 0, 0], axes=IDENTITY),
        [
            {"op": "setV", "v": [3, 0, 0]},
            {"op": "setW", "w": [0, 2, 0]},
            {"op": "tangentSpeed", "p": [10, 0, 0]},
            {"op": "tangentSpeed", "p": [10, 0, 5]},
            {"op": "tangentSpeed", "p": [10, 1, 0]},
        ])

    # 15. Respawn: dirty the state, reset(), then confirm the post-reset
    # body is born awake with the same "no gravity this tick" property as a
    # fresh construction.
    add("respawn_reset",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=1.0, position=[0, 0, 0], axes=IDENTITY),
        [
            {"op": "addAccelerationAt", "p": [1, 1, 1], "a": [10, 10, 10]},
            {"op": "step", "dt": TICK},
            {"op": "step", "dt": TICK},
            {"op": "reset", "position": [7, 8, 9], "axes": rot_y_axes(0.2)},
            {"op": "step", "dt": TICK},   # no gravity yet
            {"op": "step", "dt": TICK},   # gravity now applies
        ])

    # 16. Soldiers are exempt from the automatic wake tests/countdown (F8),
    # but NOT from the isSleeping() gate itself.
    add("soldier_sleep_exemption",
        dict(mass=1, inertia_modifier=[1, 1, 1], box=[2, 2, 2],
             gravity_modifier=0.0, position=[0, 0, 0], axes=IDENTITY, is_soldier=True),
        [
            {"op": "setSleepiness", "n": 5},
            {"op": "step", "dt": TICK},   # no auto countdown: stays 5
            {"op": "step", "dt": TICK},   # still 5
            {"op": "setSleepiness", "n": 0},
            {"op": "addAccelerationAt", "p": [1, 0, 0], "a": [0, 5, 0]},
            {"op": "step", "dt": TICK},   # isSleeping() still gates: zeroed
        ])

    return scenarios


# `RefModel`'s constructor takes Python-style snake_case kwargs; the JSON
# fixture (and `RigidBody`'s own constructor options) use the camelCase names
# the briefing specifies. Translate only at the JSON boundary.
INIT_KEY_MAP = {
    "mass": "mass",
    "inertia_modifier": "inertiaModifier",
    "box": "box",
    "gravity_modifier": "gravityModifier",
    "com_offset": "comOffset",
    "position": "position",
    "axes": "axes",
    "is_soldier": "isSoldier",
}


def camel_init(init: dict) -> dict:
    return {INIT_KEY_MAP[k]: v for k, v in init.items()}


def main():
    scenarios = build_scenarios()
    out = {"scenarios": []}
    for s in scenarios:
        m = RefModel(**s["init"])
        trace = [apply_op(m, op) for op in s["ops"]]
        out["scenarios"].append({
            "name": s["name"], "init": camel_init(s["init"]),
            "ops": s["ops"], "trace": trace,
        })

    dest = Path(__file__).resolve().parent / "rigid_body_golden.json"
    dest.write_text(json.dumps(out, indent=2))
    print(f"wrote {dest} ({len(scenarios)} scenarios)")


if __name__ == "__main__":
    main()
