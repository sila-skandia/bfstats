# The Windows server port

How the recorder was ported to BF1942_w32ded.exe. Offsets and evidence: [w32ded-offsets.md](w32ded-offsets.md).

## Windows server port (BF1942_w32ded.exe)

The same recorder runs inside the Windows dedicated server as a proxy
`WINMM.dll` (`src/target_w32ded.c`; derivation and evidence in
[w32ded-offsets.md](w32ded-offsets.md)).

**How it loads.** w32ded imports winmm (`timeGetTime` and friends). Windows
resolves DLL imports from the application directory before System32, so a
`WINMM.dll` built next to the exe is loaded by the loader itself; its
DllMain reroutes the game's winmm IAT entries to the real system winmm.dll
and starts the sampler thread. No injected code, no game logic touched; on
a Windows host nothing beyond copying the file, under wine the same file
loads. Antivirus may quarantine a locally placed `WINMM.dll` (hijacking is
also a malware technique) -- whitelist it on the server host.

**Offsets, cross-matched from lnxded.** The two servers are one source tree
compiled twice (GCC 3.2.3 vs MSVC 7): the classManager registration IDs
(`0xc355/6/7`, `0xc35b`), the culler error strings and the `BObject` ctor's
field constants locate lnxded's named functions inside the stripped w32ded.
Engine class layout carries over unchanged; the STL does not, and every
STL-typed read was re-derived from the w32ded disassembly.

| what | lnxded | w32ded |
|---|---|---|
| objectManager global | `0x0871dc24` | `0x0074c52c` |
| ObjectManager ctor | `0x08199650` | `0x004c8960` |
| registerObject | OM vtable+0xd8 (`0x0819b4a0`) | OM vtable+0xd8 (`0x004c7440`) |
| registered map | om+0x94, SGI: header ptr, node parent+4 left+8 right+0xc key+0x10 obj+0x14 | om+0xa0, MSVC: head +4 size +8, node left+0 parent+4 right+8 key+0xc obj+0x10 nil byte+0x15 |
| `BObject` fields | flags +4, template +0x4c, id +0x48, Mat4 +0x74 | identical (ctor `0x004d0220`) |
| ObjectTemplate name | std::string +8 (chars via one ptr) | getName = vtable+0x14, returns this+8; live reader: chars +0x0c, len +0x1c (62% of roots named) |
| hp / maxhp / criticalDamage | +0x100 / +0x104 / +0x160 | +0x104 / +0x108 / +0x164 (save `0x004fdc80`) |

**What the run showed.** Wine, Wake GPM_CQ: 844 root objects of 1,140
registered, movement at 10 Hz with sane Wake coordinates, destruction
lines, template names on 62% of roots (`PALMHIGH_M1`, `tankobs_ste_M1`,
`stebarbwire_m1`...). Same ndjson the viewer parses.

**Launch gotchas.** `+game bf1942` and a `mods/bf1942/init.con` copy are
required, or the server dialogs "couldn't find current mod from
maplist.con". w32ded's SetConsoleMode dialogs "couldn't change console
flags" when stdin/stdout are pipes with no console attached -- run it with
a real console/pty:

```
script -qec "wine BF1942_w32ded.exe +game bf1942 +restart 1 +dedicated 1" out.log
```

**Status.** Stage-2 equivalent: the object sampler, template names and
destruction only. The stage-3 surfaces (the three detours, joints, engines,
armor, tickets, kits) are not ported; each detour site needs its w32ded
address through the anchor chain in w32ded-offsets.md. With the lnxded
stage-3 work above landed, that port is unblocked.

Run it:

```bash
features/server-replay-recorder/build.sh            # build/WINMM.dll
# copy WINMM.dll next to BF1942_w32ded.exe with its game dir, recorder.con
# in mods/bf1942/settings/, then launch as above; the recording is in
# replays/ under the exe's cwd
```

Run it (linux):

```bash
features/server-replay-recorder/build.sh
features/server-replay-recorder/tests/run.sh      # the core against a fake target
python3 tools/bf1942-models/lab/lab.py start tools/bf1942-models/lab/scenarios/wake-coop-rec.json
# let a round run 60 s+, then:
python3 tools/bf1942-models/lab/lab.py stop
# stop copies the server's recordings into the run dir's server/ and the
# viewer's replays/<run>/, and prints a viewer URL for each
```

Scenarios with the recorder preloaded: `wake-coop-rec`, `elalamein-coop-rec`
(armour), `midway-coop-rec` (aircraft and ships), `mapchange-coop-rec`
(a Wake round to its end and the next, for the per-round split).

Check the result in the viewer (serve `tools/bf1942-models/viewer/` and open
`map.html?replay=replays/<file>.ndjson`), or assert the parse directly:
`import('/replay-recording.js')` in the page, `parseRecording(text)`, and
check `version==5`, `soldiers` with `kitTemplate`, `joints` (a Map: root nid
-> parts), `engines`, `fires`, `deaths`, `tickets`.

