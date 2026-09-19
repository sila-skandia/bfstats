# Tools kept from the round

Everything here was written by a research or verification agent in its
scratchpad and copied over because it is worth running again. None of it is
part of any build.

## `emulator/` — the server's integrator, run as machine code

`r2_emu.py` maps `bf1942_lnxded.static` into the Unicorn CPU emulator and calls
the real functions — the `PhysicsNode` constructor, the accumulators,
`getTangentSpeed`, `rotateAboutLine`, `updatePhysics` — on a fake object, and
`r2_node_test*.py` compare them tick by tick with a plain-Python model of
`collision-response.md` §4. The model in `r2_node_test_lib.py` is therefore a
**reference implementation validated against the binary to float32 rounding**
(worst absolute error 6.5e-6 over 40 random ticks), and the right thing to
port from and to test a JavaScript port against.

```bash
cd emulator && uv run --with unicorn python3 r2_node_test.py      # random ticks
uv run --with unicorn python3 r2_node_test2.py                     # clamps and sleep edges
uv run --with unicorn python3 r2_rot_test.py                       # rotateAboutLine sense and units
uv run --with unicorn python3 v2-emu-extra.py                      # the verifier's additions: the torque clamp, the sleeping-root impulse
```

The same trick works for any pure-arithmetic server function: no decompiler
reading, no x87 sign to get wrong.

## `surveys/` — the game data behind §9

| | |
|---|---|
| `r4-build-cell-table.py` | replays `materialManagerSettings.con` and its `run` chain into the (attacker, defender) cell table. **Known bug**: it reads inside `beginRem`/`endRem` blocks and ignores `setCell` lines, giving 5,165 cells where the engine loads 5,153 |
| `v4-cells.py` | the verifier's own replay, which honours comment blocks and `setCell`; use this one |
| `r4-vehicle-survey.py`, `v4-props.py` | mass, inertiaModifier, drag, speedMod, angleMod, damageMod, hit points per vehicle |
| `r4-collision-materials.py`, `v4-sm.py` | per-layer face and **vertex** material histograms of a `.sm` |

They import the readers in `tools/bf1942-models/bf42/` and expect the game
under `~/.wine/drive_c/EA Games/Battlefield 1942/`.

## `r3-x87.py`

Disassembles a range of the server from raw opcode bytes and tracks the x87
stack symbolically, printing each `fsub`/`fdiv` with its operands in the right
order. Written because objdump's AT&T output reverses the r-sense of the
register-destination forms; use it to check a formula before trusting one.
