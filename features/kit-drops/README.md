# Dropped kits

Owner's request (2026-09-25): a dead soldier drops his kit, anyone on either
side can pick it up, it shows what it is, and it despawns after a while. Engine
rules read from `bf1942_lnxded.static` (client `BF1942.exe` where marked) and
the vanilla archives; ledger KITDROP-1..KITDROP-8.

## What the game does

- **The object** is the soldier's own `Kit` (`addKitByName` 0x0826ddd0 makes it
  at spawn). `BFSoldier::dropKit` 0x08279890 moves every inventory item but a
  flag, and every `KitPart`, back into it: the weapons keep their rounds.
- **Which deaths**: `GameServer::killPlayer` 0x0814d920 calls `dropKit`
  (0x0814e0ea) on every death, then `destroyObject`s the kit (0x0814e11e) when
  the player's vehicle is not his soldier. So only a death on foot leaves one
  (walking, swimming, falling, parachuting); a death in any seat leaves none.
- **Where**: straight down under his origin, no fall: terrain height
  (0x08279bd3) or the first non-vehicle surface along (0,-1000,0) (0x08279bea,
  `intersectLine` 0x08279ca3, `ObjectDropKitPredicator` 0x082806e0 refuses
  `IPlayerControlObject`), whichever is nearer his height (0x08279cd1). Up = the
  surface normal, heading kept (0x08279d08..0x08279dda).
- **What you see**: the kit template's own `geometry` (`Kit_<Side>_<Class>`,
  `Objects/Items/Common/Geometries.con`, LODs at 3/10/20/30/100 m, every LOD has
  geometry): a bag with the kit's weapon beside it, the class badge (red cross,
  wrench, arrow, scope, tank) painted on its texture (`Kits_*_H`), and a blended
  shadow quad (`Kits_Shade_H`). No sprite, no HUD element, no sound; the
  lexicon's only kit string is the options row `CONTROLS_INFANTRY_DROP`.
- **Spin**: `Item::handleUpdate` 0x08295900 yaws a parentless item by
  `yawSpeed` degrees (ItemTemplate +0x158, default 1.0 at 0x08295b60,
  `ConsoleClass246` 0x082c3cf0) about its own up axis every world update: 30
  deg/s at 30 Hz. Client twin: ctor 0x0054dc70 (+0x208), update 0x0054dfa0.
- **Despawn**: `Kit::enable` 0x08296710 posts message 22 `timeToLiveAftherDeath`
  seconds on (KitTemplate +0x16c, `ConsoleClass568` 0x082ff3f0; default 30.0 at
  0x08296b80, client 0x0054e8c0 +0x21c); `Kit::handleMessage` 0x08296790
  destroys the kit. No vanilla kit sets it: 30 s. No cap on live kits.
- **Pickup**: `c_PIDrop` (input bit 25, `io::Module::init` 0x083f9a80), `IDKey_G`
  `c_CMNonRepetive` in `Settings/Default/Controls/Infantry.con`. Gate in
  `GameServer::checkPlayerTriggers` 0x081502f0..0x081504a0: on foot
  (`CID_BFSoldierTemplate`), `isNotFireingOrHaveRecoil` 0x0827eaf0, > 2.0 s
  since the last pickup (0x086c0330 vs `BFPlayer+0x84`), then
  `findKitObject(origin, 1.1)` 0x0814a770: the nearest `Kit` whose origin is
  within 1.1 m + its bounding radius (`QuadTreeCuller::getObjects` 0x081a4dc0),
  whose `itemType` (-1) matches the soldier's container type (-1). **No team
  test anywhere**: either side's kit is anyone's.
- **Swap**: `BFSoldier::pickupKit` 0x08279390 drops his own kit first
  (0x082793bb, fresh 30 s), takes the new kit's items as they are (no refill,
  no heal: `addItem` 0x08277bd0) and its worn parts, ends on slot 3. The health
  bar art follows the carried kit (client 0x006ad7c4..0x006ad810).
- **Bots never pick up**: no AI code presses input 25 (only the name parser
  0x084859e0 mentions it); no vanilla AI data names `PIDrop`.

## What was built

- `viewer/kit-drops.js`: the rules (rest place, 30 s, 1 deg/tick spin, 1.1 m +
  radius reach, 2 s gate, bot ammo rows). No three.js, tested under node.
- `viewer/kit-drops-page.js`: pickup meshes (`kits.json` `pickup.glb`), bot and
  human drops, the human's `c_PIDrop` pickup with the swap, `__kitDrops` hooks.
- Wiring: `map.html` (create, tick on world ticks, bot `onDeath`, human
  `dieOnFoot`, level reset), `page-input.js` (`c_PIDrop` key and pad),
  `hand-weapon.js` `equipKit` / `carriedAmmo`, `kit-loadout.js` `currentKit`,
  `kit-ammo.js` `adopt`, `demolitions.js`, `foot-body.js`, `seat-pose.js`,
  `soldier-hud.js` (worn parts and health-bar art follow the carried kit).
- Tests: `tests/test_kit_drops.py` (6), plus the touched modules' suites.

## Open

- **Live check not run** (budget): the page-side wiring (meshes, key, swap,
  worn gear) is untested in a browser. First thing to do next.
- Pickup reach uses the pickup mesh's farthest vertex as the kit's bounding
  radius; the engine's radius is the composite's (`BCompositeObject::
  getBoundingRadius` 0x08165630, with its children), not read out.
- The spin's sense (clockwise from above) is the engine's +1 deg mirrored by
  `bf42/gltf.py`'s Z flip; not checked against a retail capture.
- Cross-team first-person arms: `viewmodelRigFor` falls back to another
  nation's sleeves (e.g. a Soviet with a Panzershreck gets German ones). The
  owner can extract the missing pairs with
  `python3 tools/bf1942-models/extract_viewmodel.py RussianSoldier Panzershreck ... --game-dir <game> --mod bf1942 --out viewer/models/viewmodels` and publish them.
- Not replicated in rooms (drops and pickups are off while joined); the
  engineer's thrown packs stay the human's whatever kit he picks up; the
  scoreboard's local kit glyph still reads the deploy row.
