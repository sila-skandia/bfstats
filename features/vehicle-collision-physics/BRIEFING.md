# Briefing: Refractor 1 (BF1942) rigid-body collision research round, 2026-09-19

You are one of several agents reverse-engineering how Battlefield 1942's engine
handles **physical collisions between objects** (a jeep ramming a parked plane
pushes the plane and damages both), so it can later be re-implemented in a
browser viewer. This round only researches and documents. Do not edit any file
in the repository. Do not launch sub-agents.

`SP` below means
`/tmp/claude-1000/-home-dylan-projects-skandia-bfstats/210673ea-022f-4973-850c-736a73538647/scratchpad`.

## 1. Sources, in order of authority

1. **`/home/dylan/projects/public/bf42plus/bf1942_lnxded.static`** - the Linux
   dedicated server: same engine source, 54,895 symbols intact, and the
   authority for gameplay simulation (physics, hit points). All addresses in
   this briefing are lnxded unless marked `client`.
2. **`BF1942.exe`** (client, stripped) through the Ghidra HTTP bridge on
   `127.0.0.1:8089`, wrapped by
   `/home/dylan/projects/skandia/bfstats/features/bf1942-engine-reference/xref.py`
   (`./xref.py check`, `sym`, `decompile 0x…`, `xrefs 0x…`, `strings '…'`).
   The bridge has ONE program open (`BF1942.exe`). Never call `/open_program`,
   `/switch_program`, `/close_program`, `/save_program` or any analysis endpoint.
3. Game data: `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/*/Archives/*.rfa`
   (readers in `/home/dylan/projects/skandia/bfstats/tools/bf1942-models/bf42/`,
   survey template `features/viewer-collision-damage/surveys/con_properties.py`).
4. Existing corpus (read what is relevant before starting):
   `features/bf1942-engine-reference/subsystems/physics.md`,
   `subsystems/hitpoints-and-damage.md`, `subsystems/tank-driving.md`,
   `ledger.md` (rows PHY-*, HP-6*, ARM-*, COL-1). **Parts of it are wrong** -
   see section 4.

## 2. Tooling that already exists (use it; do not rebuild it)

- `SP/decomp/<addr>.c` - Ghidra decompiles of ~200 lnxded functions (every
  `ResponsePhysics*`, `PhysicsNode` physics method, `MaterialManager` getter,
  `GameServer::handleCollision*`, `giveDamage`, `_giveDamage`, `Armor` bits,
  `Spring`, `PhysicsSpring`, `getGeometryInertia`, ...). File name = lowercase
  hex address without `0x`. `SP/list-main.txt` and `SP/list-2.txt` map address
  to demangled name. Names inside the C are mangled; pipe through `c++filt`.
- `SP/nm-demangled.txt`, `SP/nm-raw.txt` - the symbol table.
- `SP/vt.py <0xVTABLE_SYMBOL_ADDR | name-substring> [nslots]` - dumps a gcc
  vtable with offsets **relative to the vptr** (symbol + 8 - the classic trap
  is counting from the symbol and landing two slots early). So a
  `call *0x58(%eax)` is the row printed as `+0x058`. `import vt; vt.rd32(va)`,
  `vt.rdf(va)` read a u32 / float at a virtual address (use for constants).
- To decompile more lnxded functions: **make your own project copy first**
  (two headless runs on one project collide on its lock):

      cp -r SP/ghidra-proj SP/<yourtag>-proj
      printf '0x08xxxxxx label\n' > SP/<yourtag>-list.txt
      /opt/ghidra/support/analyzeHeadless SP/<yourtag>-proj linux-server \
        -process bf1942_lnxded.static -noanalysis -scriptPath SP/scripts \
        -postScript DumpDecomp.java SP/<yourtag>-list.txt SP/<yourtag>-decomp

  About 15 s plus 0.1 s per function. Prefix every scratch file you create
  with your track tag; other agents share this directory.
- Ground truth when the decompiler looks odd:
  `objdump -d --no-show-raw-insn --start-address=0x… --stop-address=0x… <lnxded>`.
- The shell is **zsh**: an unmatched glob aborts the whole command line. Quote
  globs or put multi-step logic in a `bash` script file.
- `pytest` is not installed; `python3` is.

### Reading the decompiler's x87 output

- `(byte)(x < 0.0 | NAN(x)<<10>>8 | (x == 0.0)<<0xe>>8) == 0x40` is the
  `fnstsw; and $0x45; cmp $0x40` idiom and simply means **`x == 0.0`**; `!= 0x40`
  means `x != 0`.
- `param_1[0x1a]` on an `int *this` is the field at byte offset `0x1a*4 = 0x68`.
  `(int)(float …)` casts on stores are artefacts: the fields are floats.
- Ghidra can get x87 operand order and sign wrong (`fsubp` / `fsubrp`,
  `fchs`, comparisons). **Any claim that depends on a sign, a comparison
  direction, or which operand is subtracted must be confirmed in `objdump`**,
  working the `fnstsw` / `test $0x45,%ah` flags out by hand. This project has
  shipped wrong numbers from exactly this three times.

## 3. Reference tables (verified by the lead against the binary)

Interface / class ids: `0xc378` IID_IObject = ICompositeObject = IPlayerObject,
`0xc422` IID_IPhysicsNode, `0xc42c` IID_IResponsePhysics, `0xc4a4` Armor
component, `0xc4c5` IID_IPlayerControlObject, `0x492fe0fe` IID_IGeometry;
template class ids (`obj->template(+0x4c)->getClassID()`, vtable +0xc):
`0x9481` SpringTemplate (wheels), `0x9493` BFSoldierTemplate, `0x9495`
ProjectileTemplate, `0xc4c2` PlayerControlObjectTemplate.

Object (`SimpleObject` family, vtable `0x08725020`) fields: `+0x4` flags,
`+0x4c` template, `+0x50` parent, `+0x60` physics node, `+0x64` response
physics. Slots: `+0x08` queryInterface, `+0x28` queryComponent(id,id), `+0x38`
getAbsolutePosition, `+0x40` getAbsoluteTransformation, `+0x48`
getBoundingRadius, `+0x58` handleCollision(other, speed, normal, relPos,
matSelf, matOther).

`PhysicsNode` vtable `0x0872df00`: `+0x18` getParent, `+0x20/+0x24`
get/setAbsoluteTransformation, `+0x2c/+0x30` get/setAbsolutePosition, `+0x38`
getPositionalSpeed, `+0x3c` getRotationalSpeed, `+0x48` addPositionalSpeed,
`+0x4c` addRotationalSpeed, `+0x60` addSpeedAtAbsolutePosition, `+0x68`
addAccelerationAtAbsolutePosition, `+0x70` addFrictionAtAbsolutePosition,
`+0x74` getTangentSpeed(pos), `+0x90` updatePhysics, `+0xa0` getMass, `+0xb0`
getInertiaModifier, `+0xbc` getHasSeparatePhysicsUpdate, `+0xcc` isSleeping,
`+0xd4` setIsAwake. Fields (byte offsets): `+0x1c` rotational speed, `+0x28`
positional acceleration accumulator, `+0x34` rotational acceleration (torque
per unit mass) accumulator, `+0x4c` rotational friction accumulator, `+0x70`
centre-of-mass offset, `+0x7c` inertiaModifier (x,y,z), `+0x91` a byte that
makes a child node forward `addAccelerationAt…` to its parent.

`ResponsePhysics` vtable `0x0872e240`: `+0x10` getObject, `+0x14` reset, `+0x18`
impulseOn, `+0x1c` solveImpulse, `+0x20` addFriction, `+0x24` checkVsTerrain,
`+0x40` getNextToCheck, `+0x50` shouldCheckCollision, `+0x58`
getFaceCollision(lod), `+0x5c` getVertexCollision(lod), `+0x60`
checkObjectVsObject, `+0x6c` getPermanentGrip, `+0x7c` getPositionalAdjusts,
`+0x80` getRootResponse. Fields: `+0x10` object, `+0x14` positional adjust
(Vec3), `+0x20` root's positional adjust copy, `+0x2c` speed adjust (Vec3),
`+0x68` averaged contact normal, `+0x74` averaged contact speed, `+0x8c`
averaged contact position (relative to the object), `+0xa4` contact count,
`+0xa8/+0xac/+0xb0` averaged friction / elasticity / resistance, `+0xb4` live
grip byte, `+0xb5` authored grip.

`MaterialManager` (global `dice::ref2::world::materialManager`, vtable
`0x0871d3a0`): `+0x20` getSpeedDamageMod, `+0x28` getDefaultDamageMod, `+0x4c`
getDamageMod(att, def), `+0x50` getEffectTemplate(att, def, float), `+0x54`
getDamageForMaterial, `+0x58` getFrictionForMaterial, `+0x5c`
getElasticityForMaterial, `+0x60` getResistanceForMaterial.

`Armor` vtable `0x0871d220`: `+0x20` damage, `+0x24` heal, `+0x3c`
getDamageMod, `+0x44` getAngleMod, `+0x4c` getSpeedMod, `+0x8c` getObject,
`+0xc8` isDestroyed, `+0xe8` collision, `+0xf8/+0xfc`
set/getLastCollisionHeight.

`GameServer` vtable `0x0871b0e0`: `+0x30` handleCollisionForProjectile, `+0x34`
handleCollision, `+0x38` handleExplosion, **`+0x15c` giveDamage(IObject*,
float, int, int, int, Pos3, int, bool, bool) = `0x0814b2e0`**.

Fixed tick: 30 Hz (`g_simulationFps` = 30.0), gravity -14.73.

## 4. What the lead has read so far (UNVERIFIED - treat as leads, confirm or refute)

1. `ResponsePhysicsManager::update(dt, obj)` `0x0825d0b0`: pass 1, per
   registered response (two lists: `+0x14` flat, `+0xc` roots walked through
   `getNextToCheck`), skipping sleeping nodes and nodes with
   `hasSeparatePhysicsUpdate`: `checkObjectVsObjects(dt, obj)` then
   `checkVsTerrain(dt)`. Pass 2: `solveImpulse(node)` then
   `addFriction(node, 0.45, 0.9, 0.45, 2.0, 0, 0)`.
2. `ResponsePhysics::checkObjectVsObject(A, B, f4, f5)` `0x08259690`: soldier
   vs soldier is a cylinder push-apart; otherwise **A's collision vertices are
   swept as segments against B's face-collision mesh** (LOD 1 when A's root
   bounding radius < 4.0 or A is a soldier, else LOD 0). Per hit: relative speed
   = `nodeA.getTangentSpeed(hit) - nodeB.getTangentSpeed(hit)`; if its square
   > 0.1 both objects' `handleCollision` are called and both must return 1 for
   a physical response. Share: `shareA = massB / (massA + massB)`,
   `shareB = -(1 - shareA)`, snapped to 1/0 above 0.95 and 0/1 below 0.05 (the
   sign of the snapped `shareB` needs checking in objdump). Then
   `responseA.impulseOn(relPos, shareA*relSpeed, normal, shareA*depth, matV, matF)`
   and the mirror for B.
3. `impulseOn` `0x08258900`: `speedAdjust = -(v.n / n.n) n`, positional adjust
   `-depth * n`, each merged per axis by `setAdjust` `0x0825cec0` (same sign:
   keep larger magnitude; opposite sign: add), running averages of normal /
   speed / position, material friction-elasticity-resistance averaged over the
   two materials.
4. `solveImpulse` `0x08258d30`: Spring (wheel) objects only take the positional
   adjust along the normal, clamped 0..1. Others: node position += positional
   adjust, then `node.addAccelerationAtAbsolutePosition(avgContact + nodePos,
   speedAdjust * 30 * (1 + elasticity) * 0.5)`; a child part applies both to
   the ROOT's node. Projectiles are additionally pitched/rolled toward the
   normal by up to 10 degrees.
5. `PhysicsNode::addAccelerationAtAbsolutePosition` `0x08255110`: `accel += a;
   torque += (pos - nodePos - centreOfMassOffset) x a`.
   `updateRotationalPhysics` `0x082539e0`: torque clamped to |1000|, projected
   on each body axis and divided by `inertiaModifier.axis * I_axis` where
   `getGeometryInertia` `0x08253930` gives `I_x = (DY^2+DZ^2)/3` etc. from the
   geometry bounding box; **mass does not enter rotation**.
6. `SimpleObject::handleCollision(self, other, speed, normal, relPos, matSelf,
   matOther)` `0x081dab40` returns 1 ("respond physically") except for a
   spawner-held-object case; with an Armor it calls `Armor::collision()`,
   `setLastHitMaterialIndex(matOther)`, and - only when
   `Armor::isInColList(other)` (`+0x12c`) is false - dispatches
   `game->handleCollision(other, self, speed, normal, relPos, matOther,
   matSelf)` (note the swap) and then `Armor::addColObject(other)` (`+0x120`).
   Where and how often `clearColObjectList` (`+0x128`, `0x081737b0`) runs is
   unread: it is the damage repeat-rate limiter.
7. `GameServer::handleCollisionObjectVsObject(this, attacker, victim, speed,
   normal, relPos, matAttacker, matVictim)` `0x081551c0`: for the victim's
   nearest Armor (none or destroyed -> collision effect only):
   `damage = attackerArmor.getDamageMod() (1.0 if none)
   * (angleMod + (1-angleMod)*sin(|cos(speed,normal)|*pi/2))
   * speedMod * |speed|^2
   * getDamageMod(matAttacker, matVictim) * getDamageForMaterial(matAttacker)`;
   if `damage > 1.0` -> `this->giveDamage(victimArmor.getObject(), damage,
   attackerPlayerId, attackerTeam, -1, 0,0,0, matVictim, 1, 1)` through
   GameServer vtable `+0x15c`. **So object-vs-object collisions DO cost hit
   points for vehicles.** The existing corpus says the opposite
   (hitpoints-and-damage.md section 3, ledger HP-6, viewer-collision-damage
   README) and mis-identifies the `*0x15c` receiver as
   `BFSoldier::handleDamage`; the receiver is the GameServer. A soldier victim
   (`0x9493`) takes a separate branch (8 m/s floor, speed projections, kit
   damping).

## 5. Discipline

- Evidence or `open`. Every claim carries an address (function + the
  instruction or decompile line that shows it). Separate what you **read**
  from what you **infer**.
- Never invent a field or function name. Unknown stays `unknown_+0xNN`.
- Constants: read them from the binary (`vt.rdf`), never guess from a
  decompiler literal you have not checked when it matters.
- Measure game data before theorising about it: a `Counter` over every mod's
  `.con` files answers most "is this ever used" questions in seconds.
- State units and the tick they apply to (per 1/30 s tick vs per second).

## 6. Report

Write the report as Markdown to `SP/reports/<TRACK>.md` using Bash (for
example `python3 - <<'EOF' ... open(path,'w').write(text) ... EOF` or a quoted
heredoc with `cat >`); the Write tool is not available to you. Then make your
final message a summary of at most 300 words plus the file path. If the file
write fails, return the whole report as your final message instead.

Report structure: (1) findings, each with a confidence (`verified` = read in
the binary and cross-checked in objdump where a sign/comparison matters;
`read` = read in the decompile only; `inferred`), addresses, and the formula in
plain pseudo-code; (2) a symbol table (address, name, one-line note);
(3) corrections to this briefing or to the existing corpus; (4) what stays
open and the best next lead; (5) implementation notes for a JavaScript
re-implementation at a fixed 30 Hz tick.
