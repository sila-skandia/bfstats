---
name: bf1942-map-player-investigation
description: >
  Ghidra-first investigation workflow for Battlefield 1942 and Refractor map/player
  mechanics. Use this skill whenever the task involves control points, flag capture,
  spawn points, spawn availability, vehicle activation, team ownership, contested
  zones, tickets, player HUD feedback, radio/voice/audio, deploy screens, or any
  other gameplay behavior in a BF1942 map or mod. Do not implement a mechanic from
  modern FPS convention, viewer behavior, authored data alone, or a guessed audio
  replacement: trace the retail binary and record evidence first, or explicitly
  leave the behavior unresolved.
---

# BF1942 Map/Player Investigation

This project recreates BF1942 behavior. A plausible mechanic is not evidence of the
engine's mechanic. Use the retail executable, the map/mod archives, and the existing
reference corpus to establish what the game actually does before changing the viewer,
server, extractor, or assets.

## Non-negotiable rules

1. **Do not invent mechanics.** Do not choose capture times, radii, ownership rules,
   contested behavior, spawn gating, ticket rules, UI text, or audio because they are
   familiar from another game or convenient to implement.
2. **Binary evidence outranks assumptions.** Existing code, tests, a successful render,
   and a field name are leads, not proof. A survey of authored data explains what maps
   request; it does not prove what the client does with the request.
3. **Never synthesize retail audio.** Do not use Web Speech, generated voice, oscillator
   tones, or invented radio lines as a substitute for BF1942 audio. Locate the real
   sound/voice asset and the binary path that selects or plays it. If that remains
   unknown, keep the feature silent and report the gap.
4. **Separate executable contexts.** Investigate `BF1942.exe` client behavior and the
   dedicated/server binary independently. Never assume a server rule exists in the
   client, or that a client presentation event is authoritative.
5. **Unknown means unknown.** Label claims `confirmed`, `refuted`, `inferred`, or
   `open`. Stop and ask for direction when implementation requires an open claim;
   do not silently promote it to a default.

## Start with the reference corpus

Before opening Ghidra:

1. Read `features/bf1942-engine-reference/ledger.md` and search for the mechanic,
   field, console word, or subsystem. Preserve earlier refuted readings; do not repeat
   an overturned interpretation.
2. Read the relevant subsystem note under
   `features/bf1942-engine-reference/subsystems/` and inspect `symbols.json`.
3. Run the reference check from the repository root:

   ```bash
   cd features/bf1942-engine-reference
   ./xref.py check
   ```

   Do not trust addresses until the bridge is connected to the documented executable
   and the SHA-256 matches the corpus. A relocated or different executable needs a new
   symbol basis; do not transfer addresses by intuition.

## Investigation sequence

### 1. Define the observable contract

Write down the exact question in engine terms, including:

- map and mod, game mode, and executable context;
- initial team/ownership state;
- player state (alive, dead, on foot, occupant, vehicle type);
- the input/action that should cause the behavior;
- visible, audible, and stateful outcomes;
- what is known from files versus what is only suspected.

For a flag/spawn question, distinguish at least:

- `ControlPoint`/`ControlPointTemplate` ownership;
- soldier spawn groups and vehicle `SpawnPoint` groups;
- `ObjectSpawner` activation and pad availability;
- capture ring membership and capture progress;
- contested and cancellation transitions;
- deploy-screen presentation versus actual spawn eligibility;
- client feedback versus authoritative state change.

### 2. Survey the authored data

Use the existing parsers and write a small repeatable survey before decompiling. Compare
all relevant maps/mods, not only the failing map. Record the source files and counts:

- `ControlPoints.con`, `ControlPointTemplates.con`;
- `SoldierSpawns.con`, `SoldierSpawnTemplates.con`;
- `ObjectSpawns.con`, `ObjectSpawnTemplates.con`;
- `spawnPointManagerSettings.con`, `GlobalSpawnGroups.con`;
- vehicle `Objects.con` deck/ship spawn templates;
- `Init.con`, game-mode and ticket settings;
- sound/voice registrars and referenced asset paths.

Use data to identify candidate fields, strings, templates, and edge cases. Do not turn
field names such as `radius`, `timeToGetControl`, or `unableToChangeTeam` into runtime
rules until the executable path has been read.

### 3. Trace the binary in Ghidra

Start from a known string, console registrar, exported symbol, or existing verified
symbol. Use the bridge through `xref.py` where possible:

```bash
./xref.py strings 'ControlPoint|SpawnPoint|capture|contested|voice'
./xref.py sym <known-name-or-address>
./xref.py xrefs <address>
./xref.py decompile <function-address>
```

In Ghidra, follow the value from parser/registrar to the runtime object, then through
the state transition and its consumers. Record:

- function name and address;
- executable and binary hash;
- relevant struct offsets and field interpretations;
- callers and callees that establish the lifecycle;
- conditions, units, clamps, defaults, and reset paths;
- client/server boundary and network message/event, if any;
- the exact asset/string lookup for presentation or audio;
- disassembly/decompiler evidence sufficient for another investigator to reproduce it.

For timing and spatial behavior, verify units and cadence in the binary. Do not assume
world units are metres, seconds are simulation ticks, or a field is a radius merely
because its value looks plausible.

### 4. Record the finding before coding

Add or update a ledger row and, for a substantial mechanic, a feature note under
`features/<brief-feature-name>/`. Every implemented rule must point to evidence. A
minimal finding table is:

| Claim | Context | Evidence | Status | Consequence |
|---|---|---|---|---|
| what the game does | client/server + mode | executable/hash/address or data path | confirmed/refuted/inferred/open | code/test impact |

If binary work is blocked, report the blocker and leave the implementation unchanged
or behind an explicitly labelled experiment. Do not fill the gap with synthetic voice,
generic HUD copy, or a guessed state machine.

## Implementation and verification gate

Only after the evidence is recorded:

1. Implement the smallest behavior matching the traced lifecycle. Keep extraction,
   simulation, networking, presentation, and audio separate so an uncertain layer is
   not disguised as a confirmed rule.
2. Add tests for the evidence-backed transitions and for the map/mod edge cases found
   by the survey. Tests validate the reconstruction; they do not establish the retail
   mechanic on their own.
3. For audio, test asset resolution and playback selection against the real extracted
   asset. Never add a speech-synthesis fallback.
4. Run the relevant unit tests and the repository verification script. If a live
   behavior differs from the binary finding, stop, document the contradiction, and
   investigate rather than adjusting constants until it looks right.

## Required report format

End an investigation with:

1. **Question and scope** — map/mod, mode, executable, and player state.
2. **Evidence** — archive paths, survey results, binary hash, Ghidra addresses,
   decompiled/disassembly findings, and asset paths.
3. **Confirmed behavior** — only claims supported by the evidence.
4. **Open/refuted claims** — clearly separated; include the next investigation step.
5. **Implementation impact** — files changed, tests added, and any intentionally
   unimplemented presentation/audio.
6. **Verification** — exact commands and results.

When the evidence does not answer the question, say so plainly. A precise unknown is a
successful investigation; a convincing invented mechanic is a regression.
