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
(`src/target_w32ded.c`, `build.sh`), dropped next to `BF1942_w32ded.exe`;
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
algorithm to the SGI walk in `src/target_lnxded.c`; only field offsets differ.

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

## Stage-3 cross-match, pass 4 (2026-10-02, resumed session B)

All raw-checked against `objdump` of the exe (no Ghidra-only guesses below unless
said so). Object dump: `/tmp/w32.dis`.

- **sendGameEventToAll = `0x00471090`** (hook site 2). thiscall(this, const
  GameEvent& ev, bool onlyInGame). Prologue, 14 position-independent bytes
  (`0x471090..0x47109e`; the next instruction `mov ecx,[esi+0x150]` spans the
  16-byte line, so the patch cuts at 14): `51 56 8b f1` `8b 86 d8 01 00 00`
  `85 c0` `74 4b`. Body then walks the connection set at `this+0x150` with
  successor `0x0047ccc0`, in-game byte at node+0x10's +8, and
  `addEvent 0x00478a50(ev)`. Semantics byte-for-byte the lnxded 0x08153b10
  shape. **GameServer event-manager pointer = this+0x1d8** (lnxded +0x18c).
  Detour: patch 14 bytes, trampoline jmps back to `0x0047109e`.
- **playerManager roster list**: pm vtable slot 0x2c (`0x005a7500`) = `lea
  eax,[ecx+0xc]` — returns pm+0xc, the address of list #1's header. Raw walk
  (GameServer update loop `0x00473887`..): `sentinel = *(pm+0x10)` (the
  ctor-allocated 0xc-byte head node; ctor `0x005342f0`), `node = *sentinel`,
  player = `*(node+8)`, advance `node = *node` until `node == sentinel`.
  Node = {next +0, prev +4, BFPlayer* +8} (SGI shape, like lnxded). Second list
  at pm+0x1c/pm+0x20. Walk law for the shared core: `head = *(pm+pm_list_off)`
  with pm_list_off = 0x10, then node = *head, player = node+8 — a one-flag
  difference from lnxded (embedded header vs sentinel pointer).
- **Armor reconcile: the +0x104/+0x108/+0x164 rows are ObjectTemplate fields,
  NOT Armor.** The save() dumper `0x004fdc80` prints template hitPoints/
  maxHitPoints/criticalDamage (per-template values). The Armor *component*
  keeps the lnxded offsets: Armor factory `0x00461490` -> ctor **`0x0047f9f0`**
  (vtable **`0x006e9f38`**): maxHitPoints setter clamps at 128 -> **+0x3c**
  (slot 4), damage/heal paths read/write **+0x38** with max clamp from +0x3c
  (`0x0047f790`/`0x0047f7f0`), lastHitPlayer setter skips -1 -> **+0x14**
  (slot 29). So armor_hp/maxhp/crit/lasthit = lnxded 0x38/0x3c/0xf0/0x14
  unchanged; the Armor component key stays 0xc4a4 (getter wrappers at
  `0x004044c0/0x004044f0/0x00450910`: this->vt+0x38 -> root, root->vt+0x24
  (0xc4a4, 0xc4a4) -> component). Armor class id 0xc4a5 (registrar
  `0x00462e94`).
- **BObject layout deltas (w32 ctor `0x004d0220`, raw)**: +0x04 flags 0x02090400,
  +0x48 id, +0x4c template, +0x50/+0x54 parent/root slots zeroed, member
  component SmartPtrs +0x58..+0x68 zeroed, +0x6c secondary vptr, Mat4 +0x74,
  0.01f +0xb4, **std::string +0xc4 (ctor `FUN_005500d0`) — not +0xb8**,
  +0xe0/+0xe4/+0xe8 zeroed (candidate root cache / component map trio — to be
  confirmed live; lnxded's +0xd4 cache and +0xb8 map sit at the same slot
  shifted by the string's 0xc-byte growth).
- **net-id read verified**: createPlayer builder reads the u16 at
  `*(obj+0x68)+4` for vehicle/camera/kit — same as lnxded's net_id_of.
- **template classManager global = `0x0074c530`** (the registration loop
  `0x00487a7a`+: `ecx = *0x74c530; call vt+0xc(name, id)`). Same cluster as
  om/pm: om 0x74c52c, **tm 0x74c530**, pm 0x74c534. Template class ids from the
  id table `.rdata 0x006ea490+` (8-byte name-id stride): **BFSoldier = 0x9493**
  (this is the "kit template" class id the createPlayer builder tests — lnxded's
  0x9493 was BFSoldier's getClassID all along), **FireArms = 0x9494**,
  HandFireArms 0x9497, names at 0x006ec0xx ("BFSoldier" 0x6ec078, "FireArms"
  0x6ec06c).
- **ScoreManager vtable = `0x006e8858`** (ctor `0x00466930` first store).
  Team array base 0x60, stride 0x50, tickets +0x48 stand.
- BFSoldier/Engine/RotationalBundle/PhysicsEngine vtables: to be taken from the
  live vptr census (RECORDER_DEBUG) — no RTTI and the template-driven
  registration does not carry a static world-class vtable reference. Engine
  *field* layout carries over (running +0x142, disabled +0x143, throttle +0x124,
  pe +0x60, revs pe+0xA0, gear pe+0xBC — verified earlier).
- fireBarrel w32: not yet located statically (lnxded 0x0828aba0; its w32 twin
  evades the anchor scans — FireArms field offsets differ from lnxded, so the
  lnxded constants don't hit). Open item; the detour site is a table entry, so
  it slots in without code changes.
- Setup/level: `write_level` will skip on w32 for now (setup global not
  located; gpm is mirrored at GameServer+0x3a8).

## Open

- **Player list / roster: not ported yet.** The lnxded side has finished its
  roster work (README stage 3: it synthesises createPlayer/control and kits
  from the playerManager walk), so the port is unblocked: cross-match the
  playerManager global, the BFPlayer fields and the detour sites through
  the anchor chain that produced this table.
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

## Stage-3 cross-match, pass 2 (2026-10-02, resumed session)

All of the below decompiled from the same Ghidra project (headless, scripts in
/tmp/w32probe, dumps in /tmp/w32out). Note: no RTTI in this binary (no .?AV
type descriptors) -- vtables are found by xrefs, not by name.

- **GameEventMgr::addEvent** = `0x00478a50` (thiscall; arg1 = event*).
  Evidence: references "Trying to send unregistred GameEvent " (0x006e986c);
  body = vcall [ev] (getType) -> `0x0046d820` (getEventMaker, reads the
  DAT_0074c08c-keyed table entry +0x10) -> clone vcall -> `0x00478490`.
  Identical to lnxded `GameEventManager::addEvent` 0x0812d610 (getType ->
  getEventMaker -> maker->vt[1] clone -> addEventToSendQueue).
- **GameEventManager::addEventToSendQueue** = `0x00478490`  **(hook site 1)**.
  Evidence: body sets `ev+4 = GEM+0x7c` (sequence counter, then ++), then pushes
  into the queue: first `GEM+0x14`, last `GEM+0x18`, count `GEM+0x20`, next at
  `ev+8`; returns 1. Byte-identical semantics to lnxded 0x0812d730 (sets
  ev+4 = GEM+0xa4, calls GameEventList::pushBack(GEM+0x14, ev)).
- **scoreManager global** = `0x00749c70`. Evidence: the status-line printer
  `0x0043ed60` (has "Tickets: Axis ") reads `*DAT_00749c70`, calls vt+0x10
  (getTeamScore) and prints TeamScore+0x48 as tickets (also +0x20 score in CQ,
  +0x8 captures). Matches lnxded getTeamScore 0x081616c0 / tickets +0x48.
- **ScoreManager ctor** = `0x00466930` (registered as classManager id 0xc4b9,
  name "dice.ref2.world.ScoreManager", by registrar `0x0044ff00` -> factory
  `0x0044f130` -> ctor). Team array: `this+0x60`, two teams, stride 0x14 dwords
  = **0x50** (lnxded base 0x10 + team*0x50; w32 base is 0x60).
- **playerManager global** = `0x0074c534` (strong candidate). Evidence:
  `0x0043ed60` walks `(**(code **)(*DAT_0074c534 + 0x2c))()` which returns a
  list head, iterating `p = *p` while `p != head` -- the player list walk.
  Also `0x00475330` uses vt+0x20 on it. lnxded pm sits right after om/tm in
  the globals cluster; w32ded om=0x0074c52c, so tm would be 0x0074c530 and pm
  0x0074c534 -- same cluster.
- **GameServer global** = `0x00747278` (the instance; written by the GameServer
  ctor `0x0043aef0` -- big ctor, "BF1942"/"ServerSettings.con" strings, quit
  event "bf1942_server_quit_event"). Fields seen: gpm enum at **+0x3a8**
  (switch 3=score / 1=captures / else tickets in 0x0043ed60; lnxded reads the
  same value from Setup+0x240), player counts +0x52c/+0x5a0, HANDLE +0xaa0.
- **GameServer player/connection set** = `this+0x150` (MSVC std::set; lnxded
  walked +0x100): iterated with successor `0x0047ccc0`; node+0x10 = connection
  object whose byte +8 is the in-game flag; per-node fields seen at +0x44
  (name/id), +0x9c, +0xa9, +0xac, +0x150.

## Pass 3: stage-3 anchors (Ghidra headless, 2026-10-02, scripts in /tmp/w32probe, decompiles in /tmp/w32out)

- **CreatePlayer event builder = `0x004787e0`** (the richest find). Pool
  alloc `0x0046beb0`, event vptr `0x006e927c`. Fills:
  - name chars `ev+0xf` (cap 0x1f, via BFPlayer vcall **vt+0x18** = getName)
  - ai `ev+0x2f` (vcall vt+0x44 = getIsAIPlayer)
  - **id `ev+0x30` = BFPlayer+0x0c** (u16, same as lnxded)
  - **team `ev+0xc` = BFPlayer+0xac** (lnxded +0x7c)
  - `ev+0xd` = BFPlayer+0xc4 (lnxded +0x90)
  - **vehicle-netid `ev+0x34` from object at BFPlayer+0xa4**
  - **camera-netid `ev+0x32` from object at BFPlayer+0x98**
    (note: net-id read = word at obj+0x68+4, same shape as lnxded; which of
    0x98/0xa4 is soldier-vehicle vs camera needs the live check)
  - `ev+0x36` = kit netid. Kit derivation: template obj+0x4c -> getClassID
    (tmpl vt+0xc) == **0x9493 (same as lnxded)** -> getKit at **soldier
    vt+0x100** (lnxded vptr+0x17c) -> objectManager lookup om vt+0x20,
    fallback +0x24 (same).
  -> w32ded BFPlayer: `bf_id_off=0x0c, bf_team_off=0xac,
  bf_veh/cam_off=0x98/0xa4`; name and ai are virtual calls (no plain field
  located yet).
- **GameEventMgr::addEvent** = `0x00478a50` (refs "Trying to send
  unregistred GameEvent " @0x006e986c). Mirror of lnxded 0x0812d610.
- **PlayerManager vtable = `0x00709b78`** (ctor `0x005342f0`, 0x5c-byte
  object, two 0xc-byte list nodes at +0x10/+0x1c). The player list is
  reached through **pm vtable+0x2c**, not a plain field -- lnxded's
  `pm+0xc` field walk must NOT be copied; read vtable slot 0x2c to find the
  real list offset.
- Anchors staged, not finished: rotBundle class name `0x006f7ad4` xrefs ->
  `0x00454800`, `0x004d0f7a` (RotationalBundle vtable leads); Armor key
  0xc4a4 pushed at `0x004044c0/0x004044f0/0x00450910`, CMP'd at
  `0x0047ef62`; Armor vtable `0x006e7c60` xref -> `0x00462e94`
  (/tmp/w32out/armor_462e94.c).
- Still open: `sendGameEventToAll` w32 address (hunt the GameServer
  event-send cluster 0x454xxx-0x457xxx, or GameServer vptr from ctor
  `0x0043aef0` and compare slot 134 vs lnxded's setTicketRatio signature:
  writes this+0x1f4 / this+0xc0+team*4); `fireBarrel`; RotationalBundle
  vtable; BFSoldier anim offsets (+0x2b4/0x2f8/0x3b8/0x3e6 unverified);
  Armor component read -- CAUTION: the earlier hp +0x104/+0x108/+0x164 rows
  came from the save() dumper and disagree with lnxded's Armor-component
  +0x38/+0x3c/+0xf0; reconcile before trusting. Detour site prologue bytes
  for the patch installer; pm list offset; the VirtualProtect detour
  implementation; -DREC_STAGE3=1 in build.sh; the wine live run.
- No RTTI in this binary -- vtables via xrefs only. Strings dump:
  /tmp/w32strings.txt.
