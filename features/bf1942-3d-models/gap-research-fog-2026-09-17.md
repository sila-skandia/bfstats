# Fog console words: live vs dead (settled 2026-09-17)

## Verdict

`renderer.fogLinearStart` / `fogLinearEnd` / `setFogColorVec` are **dead
commands**. They appear in vanilla level `Init.con` files but are **not** in
`BF1942.exe` (sha used by the Ghidra project) or `BF1942_w32ded.exe`. The live
registrars are only:

| Word | Client string VA | Notes |
|---|---|---|
| `fogStart` | `0x008cf99c` | Setup `+0x448`; ctor default **1.0f** (lnxded) |
| `fogEnd` | `0x008cfa0c` | Setup `+0x44c`; ctor default **2.0f** |
| `fogColorVec` | `0x008cfa7c` | Midway's `setFogColorVec` is not this word |

Linux dedicated (`bf1942_lnxded.static`) confirms the same API under mangled
names (`Setup::setFogStart` / `setFogEnd` at `0x080c6f00` / `0x080c6f30`).
Server `setFogColorVec` is a stub `ret`; colour is a client concern.

## Why this mattered

`parity-gaps.md` and an earlier fix treated fogLinear* / setFogColorVec as
alternate spellings of the live words. That:

- Applied Tobruk/Gazala/Stalingrad/Kasserine authored-dead ranges as if live
  (Tobruk 150/300 happened to equal `0.5 * Game.setViewDistance`, which hid the
  bug; Gazala 500/850 with VD 500 does not).
- Applied Midway's colour from a word the engine never registers.

Kharkov is the proof pair: it writes fogLinear 120/200 **and** fogstart -40 /
fogend 400. Only the second pair exists in the binary.

## Engine fallback

`Setup::setViewDistance` (lnxded `0x080c6e20`) stores VD at `+0x444` and
retunes fog using float constants **0.5f** (`0x86b05e8`) and **0.33f**
(`0x86ba8c4`). The exporter's undeclared-range rule `start = 0.5 * VD`,
`end = VD` matches that 0.5 factor.

## Fix

`bf42/level.py` now accepts only `fogStart` / `fogEnd` / `fogColorVec`.
Tests: `test_dead_fog_spellings_are_ignored`, `test_live_fogstart_beats_dead_foglinear`.

Re-extract maps that only carried dead spellings before publishing fog to
mesh.bfstats.io (Tobruk, Gazala, Stalingrad, Kasserine_Pass, Midway colour).
