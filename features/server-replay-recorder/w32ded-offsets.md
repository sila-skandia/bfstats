# w32ded offsets (server-replay-recorder, Windows server port)

Binary: `BF1942_w32ded.exe`, retail v1.61 from the wine install
(md5 `1f75eb8b55ab5bb4d6782dd6f3be2e45`), PE32 console, ImageBase `0x00400000`,
non-ASLR (DllCharacteristics 0), loaded 1:1 at its preferred base. Ghidra
project: `~/ghidra/win-server` (`/BF1942_w32ded.exe`), analyzed 2026-10-01,
10,759 functions.

Method: cross-matched from lnxded's named symbols
(`features/server-replay-recorder/README.md`), anchored by compiler-independent
constants that survive in both binaries: the classManager registration IDs
(`0xc355/56/57`, `0xc35b`, `0xbc3` hash buckets) and the `BObject` ctor's
field constants. Confirmed: **one source tree, two compilers** — engine class
layouts carry over, the STL differs (GCC SGI STL vs MSVC Dinkumware), and the
recorder's map walk and name reading had to be re-derived.

## Anchor chain (each step verified in the w32ded disassembly)

| step | lnxded | w32ded | evidence |
|---|---|---|---|
| `ObjectManager` ctor | `0x08199650` | `0x004c8960` | `0xbc3` buckets, "can't create * culler" strings, `0xc357/56` classManager calls, reserve(0x80/0x200/0x40/0x80) |
| classManager global | `dice::ref2::classManager` | `0x00771168` | read at ctor+`(**classManager+0x28)(id...)` |
| classManager ID table | — | `.rdata 0x006ea31c+` | `0xc355`, `0xc356`, `0xc357`, `0xc35b` at 8-byte stride |
| objectManager global | `0x0871dc24` | `0x0074c52c` | read by `BObject` ctor at `0x004d02c1` before the `(vtable+8)(0xc35b)` call |
| BObject ctor | `0x08191480` | `0x004d0220` | `0.01f` at +0xb4, flags 0x02090400 at +4, template +0x4c |
| registerObject | `0x0819b4a0` | `0x004c7440` (OM vtable+0xd8) | key = obj+0x48, tree lookup at `om+0xa0` (`add ecx,0xa0`) |
| registered-objects map | `om+0x94` (SGI) | **`om+0xa0`** (MSVC) | tree layout below |
| object id read | obj+0x48 via impl vtable+0xd4 | `FUN_004c5a00` (OM vtable+0xd4) is a counter (not the id); the id is at obj+0x48 directly | BObject ctor stores `(**impl+0xd4)()` to obj+0x48 |
| ObjectTemplate name | `+8` (SGI string = 1 ptr) | `+8` (getName vtable+0x14 returns this+8); chars read at `+0x0c`, len at `+0x1c` live | decompiled `FUN_00696d90`; live reader names 62% of roots |
| ObjectTemplate id | `+0x10` | open (candidate +0x34) | live runs pending |
| hitPoints / maxHitPoints | `+0x100 / +0x104` | **`+0x104 / +0x108`** | template dumper `FUN_004fdc80` reads +0x104/+0x108 after `.hasArmor` +0x100 |
| criticalDamage | `+0x160` | **`+0x164`** | dumper prints +0x164 |

## Verified live (wine, 2026-10-01, Berlin and Wake)

The recorder builds as a 32-bit proxy `WINMM.dll`
(`src/w32ded-recorder.c`, `build.sh`), dropped next to `BF1942_w32ded.exe`;
Windows loads it via the standard search order and its DllMain reroutes the
game's four winmm imports to the system winmm.dll (IAT patch), so winmm
callers keep working. Under wine the same dll loads with no override needed
when launched from the exe's directory.

Launch (wine needs a real console for w32ded's SetConsoleMode; run under
`script` or a real terminal, and always `+game bf1942`):

```
cd <dir with exe + WINMM.dll + mods/>
script -qec "wine BF1942_w32ded.exe +game bf1942 +restart 1 +dedicated 1" out.log
```

Result (`replays/replay_*.ndjson`): 844 `o` records for 1140 registered
objects, movement `s` records with sane Wake coordinates, `d` vanishings.
Template names 62% coverage via live-derived reader (below), up from lnxded's
12%; the nameless remainder is the same stage-2 gap the lnxded recorder has.

## MSVC registered-objects tree (std::map<uint32, IObject*>, VC7/Dinkumware)

Tree at `om+0xa0` (lnxded: om+0x94 with SGI layout). Read `FUN_0064ece0`
(lower_bound) and the `registerObject` store:

```
om+0xa0: _Mybase? (allocator/compare, empty)   // +0xa0..0xa3 unused
om+0xa4: _Myhead (sentinel node pointer)       // +0xa4
om+0xa8: _Mysize (node count)                  // +0xa8
```

Node (confirmed by `FUN_0064ece0`'s walk: left = node[0], right = node[2],
key at node[3], value written at `*piVar1+0x10`, nil test on byte node+0x15):

```
+0x00 _Left      +0x04 _Parent   +0x08 _Right
+0x0c key (u32)  +0x10 IObject*  +0x15 _Isnil (byte)
```

Walk law: start at `_Myhead->_Left` (leftmost), in-order successor =
right subtree's leftmost, else climb while this is a right child. Identical
algorithm to the SGI walk in recorder.c; only field offsets differ.

## Engine layout carried over unchanged (verified)

- `BObject<IObject>`: flags u32 +0x04 (ROOT=0x02000000, DISABLED=1), vtable +0,
  manager-impl ptr +0x48 region, object id **+0x48** (ctor:
  `(**impl+0xd4)()` -> +0x48; OM vtable+0xd8 registers), template +0x4c,
  identity Mat4 +0x74..+0xb3, 0.01f +0xb4, std::string +0xb8.
- `ObjectTemplate` (w32ded, live-verified): `ObjectTemplate::getName` is
  vtable slot **+0x14** and returns `this+8` (same as lnxded's this+8); the
  name's chars are readable at `tmpl+0x0c` with its length at `tmpl+0x1c`
  (candidate-A reader in the recorder; 62% of roots named live). The static
  fallback template "Unknown object or method!" shows the same shape. `tid`
  left at 0 until its offset is re-derived — the ASCII garbage seen earlier
  came from reading the name's chars as an int.
- The save() path (`FUN_004fdc80`) reads its template as `esi-4`, i.e. the
  derived save passes base+4; its `hitPoints` at base+0x104 / maxHitPoints
  base+0x108 / criticalDamage base+0x164 readings stand (ledger HP rows keep
  the lnxded side).

## Sampler notes

- Root filter unchanged: `flags & 0x02000000`, `!(flags & 1)`.
- Safe reads: `IsBadReadPtr` pre-check plus bounds (the `/proc/self/mem`
  pread trick is Linux-only). No SEH needed in practice; a racing destroy
  costs a skipped sample.
- The game's console reconfig (SetConsoleMode) dies with a dialog when
  stdin/stdout are pipes and no console is attached — run it with a real
  pty (`script`, a service wrapper with AllocateConsole, or wineconsole).
  Startup also requires `+game bf1942` and a mods/bf1942/init.con copy, or
  it dialogs "couldn't find current mod from maplist.con".
- Test dir used: exe + WINMM.dll + bfcprt.dll + msvcr70.dll + mods/ (symlink
  Archives) + cache/. Maplist from Mods/BF1942/Settings/maplist.con.

## Open

- **Player list / roster: deliberately not started.** The w32ded recording
  has an empty player list, and the lnxded recorder's stage-2 roster work
  (README "Not done yet") is in progress against the same issue. Wait for
  that to resolve, then port: the lnxded offsets in the main README
  (playerManager walk, BFPlayer fields) cross-match here through the same
  anchor chain (objectManager -> OM vtable -> GameServer) that produced this
  table.
- Template `tid` (object-template id) offset: re-derive from live memory
  (lnxded +0x10 / +0x14 both wrong here; candidate +0x34 unconfirmed).
- Template names: 62% live coverage; the nameless remainder is the same gap
  the lnxded recorder has ("statics' templates reached through a
  differently-laid-out class", README "Not done yet").
- `GameServer::updateGhostManager` / `getRelevantObjects` /
  `calculateObjectPriority` counterparts in w32ded (anchor: the `20.0f`
  ghost pad at 0x53374 or the GameServer vtable): wanted for stage 2
  (events), not for the object sampler.
- Event switch (lnxded `handleGameEventManagerEvent` 0x08135cb0, 20 event
  cases): w32ded counterpart unknown; anchor = "createPlayer in Game are not
  in use any more" string or the GameServer vtable.
