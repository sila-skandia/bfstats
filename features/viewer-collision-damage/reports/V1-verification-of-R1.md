# V1 — Adversarial verification of the R1 report

Sonnet verifier, 2026-09-17, against
[R1-collision-damage-and-destruction.md](R1-collision-damage-and-destruction.md).
Re-derived independently from `bf1942_lnxded.static` and the shipped archives.

18 claims examined: **13 confirmed, 4 corrected, 1 not checked, 0 refuted.**

**The round's headline survives.** HP-6 / Finding E is safe to plan against,
and the Q7 numbers table reproduced exactly. **One recommendation is not safe
as written**: the smoke/fire triggering cadence — see Finding I.

---

## Per claim

| # | Claim (abbreviated) | Verdict | What the verifier found |
|---|---|---|---|
| A | `SimpleObject::handleCollision` finds nearest Armor via `getComponent(0xc4a4,0xc4a4)`, calls `Armor::collision()` + `setLastHitMaterialIndex` | CONFIRMED | Hand-traced `0x81dad43`–`0x81dae4d`. `getComponent` call at `81dad86` (`call [eax+0x28]`, args `0xc4a4,0xc4a4`); `Armor::collision()` at `81dae3e` sets one byte `+0x129`; `setLastHitMaterialIndex` at `81dae4d` (`[eax+0x60]`) takes `[ebp+0x20]` = last int arg, matching "arg6" exactly. Note: these calls are reached only when the gate (B) is false/absent — "unconditional" is accurate only for the main line. |
| B | Gate is `getRootParent(this)` → walk to nearest `IPlayerControlObject`; even if true, compares `getHoldObjectId()` against **otherObject's** root before bypassing | **CORRECTED** | Traced `81dad43`–`81dafc5` in full. The walk-to-`IPlayerControlObject` structure is exactly as described (`0x86c2a58`=ICompositeObject, `0x86d3c50`=IPlayerControlObject confirmed by `nm`). But the follow-up is **two chained comparisons**, not one: first `ObjectSpawner::getHoldObjectId()` (via `objectManager`, `0x871dc24`) against a field on `getRootParent(this)` (`edi+0x48`) — i.e. **self's** root, not otherObject's; only if that matches does it do a second check, an `ICompositeObject`-identity compare against `getRootParent(otherObject)`. Bypass (`jmp 81daea6`) fires only after both pass. The report describes only the second stage. |
| C | `dice::bf::game`'s vtable dump+0x38/+0x3c resolve to `handleCollisionForProjectile`/`handleCollision`; GameServer overrides them | CONFIRMED | Dumped both vtables (`0x0870d760` Game, `0x0871b0e0` GameServer). Game's own dump+0x38/+0x3c = `0805f640`/`0805f740` (base impls); GameServer's = `08153ba0`/`08156020` — an override, as claimed. Independently re-found the same selector (`this`'s `+0x4c` field's class == `CID_ProjectileTemplate`, `0x86c2b90`) inside `SimpleObject::handleCollision` at `81daec2`/`81daf09`, calling `[edx+0x30]`/`[edx+0x34]` on the `dice::bf::game` global (`0x870d918`). Both addresses are unambiguous single-symbol hits in `nm` — the "46 shared vtables" trap is a stripped-binary hazard and does not apply to lnxded. |
| D | `GameServer::handleCollision` dispatches on `otherObject != NULL` | CONFIRMED | Full disassembly `0x08156020`–`0x08156090`. It is a **tail-call** (`jmp`, not `call`) dispatcher; the forced-null write is `mov [ebp+0xc],0x0` before the LandOrWater jump, which also confirms which parameter is `otherObject`. |
| **E** | **No call in `LandOrWater`/`ObjectVsObject` reaches Armor's damage/heal/setHitPoints/status or `handleDamage`** | **CONFIRMED** | Full disassembly of both (673 + 1127 lines; the LandOrWater count matches the report's own). All direct calls resolved to symbol names — none are damage/heal/setHitPoints/status/handleDamage. Enumerated **every** indirect call-site offset in both: `+0x20`/`+0x24` (damage/heal) never appear at all. `+0x18`/`+0x1c` (setHitPoints/getHitPoints) appear only in ObjectVsObject, at 3 sites; each traced by data-flow to (1) the `playerManager` global singleton and (2) an `IPlayerControlObject`-typed pointer from the same-spawner gate chain — coincidental offset collisions, not Armor. Blind spots the report did not rule out, checked here: no out-of-range or indirect `jmp` (no tail calls) in either function; `SimpleObject::handleDamage` is virtual at SimpleObject-vtable `+0xd8`, which never appears as a call-offset in either function; and `Game::playCollisionEffect` itself (called twice from each) is a 352-byte leaf with one direct call and indirect offsets `{0x8,0xc,0x14,0x2c,0x3c,0x40,0x44,0x74,0x78,0x9c}` — none an Armor HP-mutator slot. |
| F | `Armor+0x28` stores raw world Y from `self->vtable+0x38()+4`, read in LandOrWater's soldier branch | CONFIRMED | `setLastCollisionHeight`/`getLastCollisionHeight` disassembled directly — plain `mov`/`fld` on `[this+0x28]`. The **write site**, which the report never cited by address, is `0x81dae83`–`0x81dae98` inside `SimpleObject::handleCollision`: `this->vtable[0x38]()` returns a Pos3 pointer, `[+0x4]` (Y) is pushed, `Armor(esi)->vtable[0xf8]` (`setLastCollisionHeight`) is called with it. A whole-binary grep confirms this is the **only** call site to `setLastCollisionHeight` (32 `+0xf8]` occurrences scanned; only this one is on an Armor-typed pointer). Read site (`8154d37`, `[eax+0xfc]`) independently confirmed against the vtable dump. |
| G | `handleCollisionForProjectile` calls `Projectile::getDamage`/`getForceOnExploaion`/`canTK` | NOT CHECKED | Out of the priority list; the function was not disassembled. Symbols resolve correctly via `nm`, but the call graph was not verified. |
| H | Spring/PlayerControlObject forward to base; `Obstacle` checks otherObject's class == `CID_BFSoldierTemplate`, **and if so** calls vtable+0x9c and returns true | Spring CONFIRMED; PlayerControlObject partial; **Obstacle CORRECTED — branch direction is backwards** | `Spring::handleCollision` (`0824f9b0`) sets two fields then tail-forwards all args to the base — exact. `Obstacle::handleCollision` (`08315e10`, `0x86c2b88`=`CID_BFSoldierTemplate` via `nm`): when the class **matches**, it returns `true` **without calling** vtable+0x9c; when it does **not** match (or otherObject / its `+0x4c` is null), it **calls** `vtable[0x9c](0,0)` and returns `false`. The inverse of the report. Touches no Armor either way, so HP-6 is unaffected. |
| I | `addArmorEffect` → 3 parallel vectors (`+0x98`/`+0xa4`/`+0xb0`) → `Armor+0x148` map → `getEffect`/`playEffect` | Storage/map/lookup CONFIRMED. **Bidirectional claim CORRECTED and EXTENDED — not merely "still open"** | `addArmorEffect` fully disassembled (89 lines): three `vector<T>::_M_insert_aux` calls on `esi+0x98` (`vector<string>`), `+0xa4` (`vector<Vec3>`), `+0xb0` (`vector<int>`), confirmed by mangled callee names. `getEffect` fully disassembled (121 lines): `Armor+0x148` map header, `_Rb_tree::find` + `_M_decrement` nearest-threshold-below scan, exactly as claimed. **New, from reading all 420 lines of `playEffect` rather than the report's ~70:** the compare-and-teardown logic is real and reached from four different argument computations, but the **only** call site to `playEffect()` in the entire 15 MB binary is inside `Armor::update()`, gated by `cmp byte [edi+0x128],0x0; je <call playEffect>` — and `playEffect()` sets that same byte to `1` on its first non-dead invocation. A whole-binary grep of every `[reg+0x128]` access in Armor's code found only 2 writes (both constructors, initializing to 0) and this one set-to-1; **nothing ever resets it**. So the `update()`-driven "which tier is active" evaluation fires **at most once per Armor's lifetime**, not per tick or per second. Separately, `Armor+0x38` **is** current hitPoints — `setHitPoints`/`getHitPoints` both touch `[this+0x38]` — resolving a gap the report flagged as unverified, in the report's favour. |
| J | Fire-tier `addArmorEffect` threshold == `criticalDamage` on "9 of 9" sampled vehicles | CONFIRMED (with an arithmetic slip) | An independent extractor pointed at `Objects/Vehicles/{Land,Air,Sea}/<veh>/Objects.con` reproduced **all 12 rows of the Q7 table exactly** — every hitpoint/critical/burn/water/explosion number and every `addArmorEffect` line, including the boats' "sink tier instead" shape. The list named in Finding J is **10** names, not 9: "9 of 9" should read "10 of 10". All 10 match exactly (the B17's fire tier is 60, its own `criticalDamage`, despite carrying 4 separate smoke thresholds). |
| K | No mod declares `collisionDamage` | CONFIRMED | Swept every mod directory: 18 exist, 4 have no `Archives/` at all (Pirates, STFHSWE, EoD, interstate) and one more (FHSWEurope) mounts but yields 0 `.con`/`.inc`, leaving **14 active mods, 35,946 files, zero hits**. The report's "17 mods, ~40k files" does not match that directory count; the zero-hit conclusion holds regardless. |
| L | 0/230 vanilla tree/vegetation files declare `hasArmor 1` | CONFIRMED for vanilla; **cross-mod counterexample found** | The vanilla count is exactly 230 tree-like files, 0 with `hasArmor 1` — a precise match. But across the other 13 mods there are **80 `hasArmor 1` hits on tree-like files**, concentrated in **FHSW's `objects/Vegetation/BreakableTree/` (76 distinct tree templates)**, plus one in FH (`EU_pine6_M1_nosway`) and one in DC_Final (`SniperBush_deploy`, arguably not a tree). **FHSW ships destructible vegetation through exactly the `hasArmor` mechanism this round investigated.** The report's own caveat anticipated the possibility, but its tree-immunity paragraph states the conclusion without naming the mod. |
| M | `hasOverDamage` only ever on Effect templates | CONFIRMED | 85/85 hits across all 14 active mods are inside `Effects.con`/`effects.con`/`Compressed.con` paths; zero exceptions. |
| N | `damageWhenLost` is broader than "carriers" | CONFIRMED | 339 hits: armory buildings, deployable-weapon rigs (Mortar, MG34/42 deploys), spawn-rotators (B25/Hellcat/Betty/Cub), objective buildings (ActiveBank, church, bridge), and some genuine vehicles (Enterprise, Ark Royal, C47). |

---

## Load-bearing consequences

- **The recommendation to drive smoke/fire visuals continuously off
  `getEffect(currentHP)` is not retail-verified.** The map and lookup structure
  is confirmed, but the only path into it found in the server binary evaluates
  **once per object lifetime**. A viewer that polls HP against the thresholds
  per frame or at HP-5's 1 Hz cadence would be a reasonable house rule, not a
  mirror of `bf1942_lnxded.static`. Whether client-only code in `BF1942.exe`
  re-evaluates continuously is **untested** — that needs a Ghidra pass on the
  client before anyone writes `confirmed`.
- **Finding B's two-stage gate** is not load-bearing for HP-6 (both stages are
  pure bypass logic), but anyone reimplementing self-collision suppression from
  the report's prose would build the wrong single-comparison version.
- **Finding H's Obstacle branch** is backwards as written. Low risk — nothing
  plans to reimplement Obstacle collision — but do not copy it.
- **FHSW's `BreakableTree`** is the one substantive gap: precisely the "if it
  exists only in a mod, say which" case the prompt asked for. It matters to the
  concurrent tree-collision track if that round ever needs FHSW parity.

## Safe to act on

- HP-6 / Finding E, and everything that follows from it: collisions never apply
  hit-point loss; only projectiles damage.
- The Q7 numbers table, all 12 rows.
- `Armor+0x38` is `hitPoints` (upgraded from the report's own "inferred").
- Findings K, M, N as data claims.

## Not safe to act on

- Continuous re-evaluation of the `addArmorEffect` tier (Finding I cadence).
- Finding B as prose, and Finding H's Obstacle branch, if reimplemented.
- "Trees are immune" as a cross-mod statement (FHSW).
- Finding G, which nobody checked.
