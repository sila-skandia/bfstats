/**
 * The soldier on foot: the deploy screen, his body, gait and view, the kit
 * and the weapon in hand, demolitions, the parachute, damage, supply and the
 * key lock. Split out of `test-hooks.js`; installed by it under `?shots`.
 *
 * `page` is the test hooks' own bag; this part reads:
 * `aimHeld`, `altFireDemolitions`, `announceCapture`, `applyDamageToPlayer`,
 * `camera`, `cancelDeploy`, `canopySpan`, `captureVoiceDirs`,
 * `captureVoiceKind`, `chooseKit`, `chooseTeam`, `collider`, `crosshairAim`,
 * `crosshairEl`, `currentDir`, `cycleKitWeapon`, `deployActive`,
 * `deployKit`, `deploySpawn`, `deployTeamId`, `deployUnchosen`,
 * `detonatorTemplate`, `effects`, `explosivesTemplate`, `flags`,
 * `foot3pRel`, `footBody`, `footCanopy`, `footView3p`, `forceHideFootBody`,
 * `gameHud`, `groundHeight`, `guns`, `handSlot`, `handWeapon`, `holdDeploy`, `hud`,
 * `isZoomed`, `itemsLocked`, `KBLOCK`, `KBLOCK_KEYS`, `kbLockState`,
 * `kbSession`, `kitLoadout`, `KITS`, `kitWeaponSlots`, `lastCaptureVoice`,
 * `loadouts`, `loadoutsLoad`, `lookDelta`, `mouseInput`, `optOnFoot`,
 * `packAmmo`, `packsLeft`, `parachuteLog`, `playCaptureVoice`,
 * `pressTrigger`, `renderer`, `seatAltFire`, `seatFire`, `selectDeployFlag`,
 * `selectKitWeapon`, `setAim`, `setSeatTriggers`, `shipFlagInactive`,
 * `snapPresentation`, `soldier`, `soldier3pOnFoot`, `soldierArmor`,
 * `soldierDead`, `soldierTemplateFor`, `spawnFlagSelect`, `stage`,
 * `supplyField`, `supplyTarget`, `thrownPackGroup`, `triggerHeld`,
 * `viewmodelRigFor`, `vmCamera`, `weaponBarUntil`, `weaponTemplateFor`.
 */
export function installSoldierHooks(page) {
  window.__lookDelta = (dx, dy) => { page.lookDelta(dx, dy); return window.__soldier(); };
  // `__setOnFoot` drives the real checkbox so the pilot/on-foot exclusion, the
  // flag list and the FOV swap all run exactly as a click would run them.
  // `__setWalk` is the same thing under the name the walk checks use.
  //
  // Since the deploy screen, the checkbox's on-edge parks the join on that
  // screen rather than in the world — `__deploy.spawn()` below is the button
  // press that completes it — so `Boolean(soldier)` here reports false until
  // it is pressed, exactly as the page reports it.
  window.__setOnFoot = on => {
    page.optOnFoot.checked = Boolean(on);
    page.optOnFoot.dispatchEvent(new Event('change'));
    return Boolean(page.soldier);
  };
  window.__setWalk = window.__setOnFoot;
  // The deploy screen, drivable without a pointer: state to read, verbs to
  // press. `select` is the click on a flag marker (by name or by index),
  // `spawn` is the button, and both refuse politely — false — when the
  // screen is not up or the name is not a flag.
  window.__captureVoice = {
    kind: page.captureVoiceKind, dirs: page.captureVoiceDirs, announce: page.announceCapture,
    play: page.playCaptureVoice, last: () => page.lastCaptureVoice,
  };
  window.__deploy = {
    get open() { return page.deployActive(); },
    // Nothing chosen: a click on open ground unselects, and the commit then
    // takes the free camera instead of spawning (`enterFreeCam`).
    get unchosen() { return page.deployUnchosen; },
    get flags() {
      const chosen = page.deployUnchosen ? -1
        : Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1);
      return page.flags.map((flag, index) => ({
        name: flag.name,
        team: flag.team,
        spawns: flag.spawns.length,
        selected: index === chosen,
        // A burning ship: `BFSpawnPoint::getActive`'s Armor gate.
        inactive: page.shipFlagInactive(flag),
      }));
    },
    get team() { return page.deployTeamId; },
    // The kit row, and what pressing SPAWN with it would put in hand: the
    // level's kit for that row, its primary, the soldier whose sleeves it
    // gets — readable without spawning, so a check can assert the table
    // before it waits on a glb.
    get kit() { return page.deployKit; },
    get loadout() {
      const chosen = Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1);
      const flag = page.flags[chosen] || { team: page.deployTeamId };
      return {
        kit: page.deployKit,
        team: flag.team,
        ...page.kitLoadout(flag.team),
        weapon: page.weaponTemplateFor(flag),
        rig: page.viewmodelRigFor(page.weaponTemplateFor(flag), page.soldierTemplateFor(flag)),
        fromFile: !!page.loadouts?.levels?.[page.currentDir],
      };
    },
    select(name) {
      const index = typeof name === 'number' ? name
        : page.flags.findIndex(flag => flag.name === name);
      return page.selectDeployFlag(index);
    },
    setTeam(team) {
      if (!page.deployActive() || (team !== 1 && team !== 2)) return false;
      // The tab click itself: switching teams kills the current soldier.
      page.chooseTeam(team);
      return true;
    },
    // The click on a kit row, by the row's name (`scout` .. `engineer`).
    setKit(name) {
      if (!page.deployActive() || !page.KITS.includes(name)) return false;
      page.chooseKit(name);
      return true;
    },
    spawn() { return page.deploySpawn(); },
    cancel() { if (!page.deployActive()) return false; page.cancelDeploy(); return true; },
  };
  // The man on the ground, for the same reason: his pose has to be readable
  // from outside to assert that a wall stopped him where the capsule says.
  //
  // Both halves are reported — the presentation state this page consumes
  // (stance, gait, bob, eye) and the body state `physics.js` integrates
  // (position, velocity, pose index, contacts, ticks) — because a walk check
  // asserting 6 m/s has to read the velocity the integrator produced, not the
  // distance a frame happened to cover.
  window.__soldier = () => page.soldier && ({
    x: page.soldier.x, y: page.soldier.y, z: page.soldier.z,
    eyeY: page.soldier.eyeY, yaw: page.soldier.yaw, pitch: page.soldier.pitch,
    stance: page.soldier.stance, gait: page.soldier.gait, speed: page.soldier.speed,
    grounded: page.soldier.grounded, blocked: page.soldier.blocked, onWater: page.soldier.onWater,
    steps: page.soldier.steps, casts: page.soldier.casts,
    // The swim state: `c_AsmIsSwimming`, the depth it was decided on, the state
    // the animation machine is in, and how long the water has before it starts
    // taking HP. `onWater` above is now the same bit as `swimming`.
    swimming: page.soldier.swim.swimming, swimDepth: page.soldier.swim.depth,
    swimState: page.soldier.swim.family, swimTime: page.soldier.swim.swimTime,
    // `getCurrentStateFlags()` of the lower machine, and the item gate it
    // drives: `itemsLocked` true means the engine has left him nothing to fire,
    // reload, throw or select. See `itemsLocked()` in this file.
    stateFlags: page.soldier.stateFlags, itemsLocked: page.soldier.itemsLocked,
    drownGrace: page.soldier.drownGrace, drowned: page.soldier.drown.lost,
    waterLevel: page.collider?.waterLevel ?? null,
    // Hit points (verify-r4.md) and the current deploy team (verify-r3.md's
    // depot team gate reads this) — null hp/maxHp is itself informative: it
    // means `soldierArmor` was never created, not that HP is zero.
    hp: page.soldierArmor?.hitPoints ?? null, maxHp: page.soldierArmor?.maxHitPoints ?? null,
    destroyed: page.soldierArmor?.destroyed ?? null, team: page.deployTeamId,
    bobUp: page.soldier.bobUp, bobSide: page.soldier.bobSide,
    ground: page.groundHeight(page.soldier.x, page.soldier.z),
    fov: page.camera.fov, near: page.camera.near,
    flag: page.flags[Number(page.spawnFlagSelect.value) || 0]?.name || null,
    flags: page.flags.map(f => ({ name: f.name, team: f.team, spawns: f.spawns.length })),
    position: { ...page.soldier.body.position },
    velocity: { ...page.soldier.body.velocity },
    pose: page.soldier.body.pose,
    contacts: page.soldier.body.contacts,
    material: page.soldier.body.material,
    ticks: page.soldier.clock.ticks,
    dropped: page.soldier.clock.dropped,
  });
  window.__walkState = window.__soldier;
  // The live soldier, the way `__aircraft` and `__car` are live: a headless
  // check that has to hold one thing still and change exactly one other thing
  // needs the object, not a snapshot of it. The A/B the item gate is proved by
  // is "the same tick, the same camera, the same sea, `swim.family` moved off
  // the flag table for one frame" — with a snapshot there is no such A/B and the
  // measurement becomes two different scenes compared to each other.
  Object.defineProperty(window, '__soldierObject', { get: () => page.soldier });
  // The weapon in hand, for the same reason as the soldier: the magazine,
  // the cone and the trigger have to be readable to assert a burst emptied
  // what it should and bloomed what it should. `__setTrigger`/`__setAim`
  // stand in for mouse buttons the way `__lookDelta` stands in for pointer
  // lock, which headless Chromium does not reliably grant.
  // The live rig object, for bisecting a rendering fault from the console.
  window.__rig = () => page.handWeapon?.rig;
  // The kit table, once fetched, so a check can await it before it reads
  // `__deploy.loadout` and know the answer came from the file.
  window.__loadouts = () => page.loadoutsLoad;
  // The engineer's demolitions state: which pair this kit carries, how many
  // charges are left in the pouch, and how many are live in the world for the
  // plunger to reach. `__altFire` stands in for the right mouse button the
  // way `__setTrigger` stands in for the left.
  window.__demolitions = () => {
    const pouch = page.packAmmo();
    const sized = Number.isFinite(pouch?.size);
    return {
      pack: page.explosivesTemplate,
      detonator: page.detonatorTemplate,
      inHand: page.handWeapon?.name ?? null,
      capacity: sized ? pouch.size : 0,
      down: sized ? pouch.size - pouch.rounds : 0,
      left: page.packsLeft(),
      live: page.thrownPackGroup ? page.guns.liveProjectiles(page.thrownPackGroup) : 0,
    };
  };
  window.__altFire = () => page.altFireDemolitions();
  window.__handWeapon = () => page.handWeapon && ({
    name: page.handWeapon.name,
    soldier: page.handWeapon.soldier,
    rig: page.handWeapon.rigFile,
    hasGroup: !!page.handWeapon.group,
    // The arms rig, when the weapon has one: which clip owns the arms, so a
    // headless check can walk, fire and reload and read the machine back.
    viewmodel: !!page.handWeapon.mixer,
    clip: page.handWeapon.active,
    rounds: page.handWeapon.rounds,
    mags: page.handWeapon.mags,
    reloading: page.handWeapon.reload > 0,
    deviationDeg: page.handWeapon.model.current(),
    zoomed: page.isZoomed(),
    fovFactor: page.handWeapon.fovCur,
    worldFov: page.handWeapon.worldFov,
    fov1p: page.handWeapon.fov1p,          // `set1pFov`, radians, from the rig extras
    nearPassFov: page.vmCamera.fov,        // degrees the near pass last drew with
    rezoom: page.handWeapon.rezoom,
    firing: !!page.handWeapon.group?.firing,
    shots: page.handWeapon.group?.shots ?? 0,
    // The item gate, and whether the rig is drawn at all: a swimmer has no
    // active item, so `locked` is true and `rigVisible` is false.
    locked: page.itemsLocked(),
    rigVisible: page.handWeapon.rig.visible,
    crosshairHidden: page.crosshairEl.hidden,
    crosshairStyle: page.crosshairAim().style,
    crosshairIcon: page.crosshairEl.classList.contains('ch-icon'),
    crosshairArt: page.crosshairEl.classList.contains('ch-art'),
    // The gap on each axis, in CSS px: the cross parts by the same number of
    // HUD units both ways, so the two differ by the stage's own aspect.
    crosshairGap: page.crosshairEl.style.getPropertyValue('--ch-gap-y') || null,
    crosshairGapX: page.crosshairEl.style.getPropertyValue('--ch-gap-x') || null,
    crosshairCentre: page.crosshairEl.classList.contains('ch-centre'),
    crosshairInk: page.crosshairEl.style.getPropertyValue('--ch-ink') || null,
    hitIndicationTime: page.gameHud?.vars?.['CrossHair/HitIndicationTime'] ?? null,
    fov: page.camera.fov,
    // The idle-fidget state, so a headless check can step past the 4-7 s
    // dwell and read which one-shot owns the arms.
    fidget: page.handWeapon.fidget,
    fidgetTimer: page.handWeapon.fidgetTimer,
    fidgetNames: [...page.handWeapon.fidgetNames],
  });
  // The kit-rotation inventory: the spawned kit's slots, the slot in hand,
  // and the verbs a check needs — the same `selectKitWeapon` the number keys
  // and the wheel run (headless Chromium grants neither reliably).
  window.__kitRotation = () => ({
    slots: page.kitWeaponSlots?.map(w => ({ ...w })) ?? null,
    handSlot: page.handSlot,
    weaponBarUp: performance.now() < page.weaponBarUntil,
  });
  window.__selectKitWeapon = page.selectKitWeapon;
  window.__cycleKitWeapon = page.cycleKitWeapon;
  // Stand the man somewhere exact — in front of a known wall — so a burst can
  // be fired at a surface the assertion names rather than wherever a flag
  // happened to put him.
  window.__teleport = (x, y, z, yaw = 0) => {
    if (!page.soldier) return false;
    page.soldier.spawn(x, y, z, yaw);
    page.snapPresentation();
    return true;
  };
  window.__setTrigger = on => {
    page.pressTrigger(on);
  };
  // Bailing out, for a headless check. `__bailOut` puts the man in the air
  // with a velocity the way stepping out of a flying plane does (no floor
  // probe, unlike `__teleport`); `__parachute()` reads the state machine and
  // the numbers a check wants to assert on, and drains the sound and
  // animation events the last frame produced.
  window.__bailOut = (x, y, z, yaw = 0, vx = 0, vy = 0, vz = 0) => {
    if (!page.soldier) return false;
    page.soldier.collider = page.collider;
    page.soldier.bailOut(x, y, z, yaw, vx, vy, vz);
    page.snapPresentation();
    return true;
  };
  window.__parachute = () => {
    if (!page.soldier) return null;
    const v = page.soldier.body.body.velocity;
    const ground = page.collider?.surfaceHeight
      ? page.collider.surfaceHeight(page.soldier.x, page.soldier.z) : NaN;
    const drained = page.parachuteLog.slice();
    page.parachuteLog.length = 0;
    return {
      state: page.soldier.parachuteState,
      fallTime: page.soldier.chute.fallTime,
      open: page.soldier.chute.open,
      clips: page.soldier.chute.clips(page.soldierDead),
      y: page.soldier.y, x: page.soldier.x, z: page.soldier.z,
      height: Number.isFinite(ground) ? page.soldier.y - ground : null,
      velocity: { x: v.x, y: v.y, z: v.z },
      descent: Math.abs(v.y),
      glide: Math.hypot(v.x, v.z),
      drag: page.soldier.body.body.drag,
      grounded: page.soldier.grounded,
      hitPoints: page.soldierArmor?.hitPoints ?? null,
      landing: page.soldier.landing,
      events: drained,
    };
  };
  window.__setDeploy = on => page.holdDeploy(on);
  // The soldier's camera view, for a headless check: read it with no argument,
  // press C with `__footView('cycle')`, or name a mode. `modes` is what
  // `soldier-camera.js` allows this frame -- one on foot, three under a canopy.
  window.__footView = arg => {
    if (arg === 'cycle') page.footView3p.cycle();
    else if (typeof arg === 'string') page.footView3p.setMode(arg);
    return {
      mode: page.footView3p.mode,
      modeId: page.footView3p.modeId,
      modes: page.footView3p.modes,
      firstPerson: page.footView3p.firstPerson,
      // Why `setMode('chase')` may have done nothing. On foot the engine's
      // cycle is a set of ONE (CAM-1: `SoldierCamera` writes `CVMChase 0` and
      // `BFSoldier::nextCamera` is empty), and the server's soldier switch
      // (on by default, `?foot3p=0` off) is the marked departure that widens
      // it. Reported here because a check that asks for a
      // chase view and is refused otherwise reads the refusal as "the body is
      // not being drawn" — which is how W8-B's swim body came to be called
      // missing when it was only invisible.
      cycleOnFoot: page.soldier3pOnFoot(),
      rel: [...page.foot3pRel],
      eye: { x: page.camera.position.x, y: page.camera.position.y, z: page.camera.position.z },
    };
  };
  // What the player's own third-person body is drawing, for a headless check:
  // the clip family `syncFootBody` settled on, the families its rig actually
  // bound, and where the two scenes are. There is nothing else on the page that
  // can tell a crouch from a crawl on the local soldier.
  // Force the body and its canopy out of the frame for one render, so a
  // headless check can read the same box with and without them and attribute
  // the difference to the body alone. Nothing else in the scene moves between
  // the two reads, which is what makes it evidence rather than a screenshot.
  window.__footBodyHide = on => page.forceHideFootBody(on);
  // The subject height the external view frames itself against: feet to canopy
  // top, measured off the drawn canopy.
  window.__canopySpan = () => +page.canopySpan().toFixed(3);
  window.__footBody = () => (page.footBody ? {
    soldier: page.footBody.soldier,
    weapon: page.footBody.weapon,
    want: page.footBody.want,
    bound: Object.keys(page.footBody.families),
    // What the MIXER is actually playing, not what was asked for: every family
    // whose two actions carry weight, with the lower half's clock. `want` is a
    // record of the last switch; this is read back off the actions, so a family
    // that was asked for and never applied shows up as a disagreement between
    // the two instead of having to be inferred from pixels.
    playing: Object.entries(page.footBody.families)
      .filter(([, actions]) => actions.some(a => a.getEffectiveWeight() > 0))
      .map(([family, actions]) => ({
        family,
        weight: +actions[0].getEffectiveWeight().toFixed(3),
        time: +actions[0].time.toFixed(4),
      })),
    weaponNode: page.footBody.weaponNode?.name ?? null,
    weaponVisible: page.footBody.weaponNode ? page.footBody.weaponNode.visible : null,
    visible: page.footBody.scene.visible,
    at: page.footBody.scene.position.toArray().map(v => +v.toFixed(3)),
    gait: page.soldier?.gait ?? null,
    stance: page.soldier?.stance ?? null,
    parachute: page.soldier?.parachuteState ?? null,
    canopy: page.footCanopy ? {
      clip: page.footCanopy.want,
      visible: page.footCanopy.scene.visible,
      attach: page.footCanopy.attach,
      clips: Object.keys(page.footCanopy.actions),
      at: page.footCanopy.scene.position.toArray().map(v => +v.toFixed(3)),
    } : null,
  } : null);
  // The seated player's two mouse triggers, for a headless check: left is the
  // vehicle's `c_PIFire`, right its `c_PIAltFire`. Named apart from
  // `__setTrigger` because that one is the soldier's, and a seated player's
  // is a different input on a different object.
  // Counts per browser pixel, live: call with no argument to read it, with a
  // number to try one. Same knob as `?turret=`, and the only unproven unit in
  // the mouse path.
  window.__turretScale = value => {
    const n = Number(value);
    if (value !== undefined && Number.isFinite(n) && n > 0) {
      page.mouseInput.countsPerPixel = n;
    }
    return page.mouseInput.countsPerPixel;
  };
  // The whole input stage, for a headless check: `__mouseLook()` reads the
  // held axis pair and the live profile, `__mouseLook(dx, dy)` feeds pointer
  // counts in the way a `mousemove` would.
  window.__mouseLook = (dx, dy) => {
    if (dx !== undefined || dy !== undefined) {
      page.mouseInput.accumulate(Number(dx) || 0, Number(dy) || 0);
    }
    return {
      x: page.mouseInput.x,
      y: page.mouseInput.y,
      profile: page.mouseInput.profile,
      scale: page.mouseInput.scaleFor(),
      sensitivity: { ...page.mouseInput.sensitivity },
      countsPerPixel: page.mouseInput.countsPerPixel,
      pendingPixels: page.mouseInput.pendingPixels,
    };
  };
  window.__setSeatFire = (main, alt = false) => {
    page.setSeatTriggers(main, alt);
    return { seatFire: page.seatFire, seatAltFire: page.seatAltFire };
  };
  // A full pouch again, for the perf harness: a Thompson carries 150 rounds
  // and a several-minute burst phase would otherwise fall silent at 15 s.
  window.__refill = () => {
    const hw = page.handWeapon;
    const magazine = hw?.data?.magazine;
    if (!magazine) return false;
    hw.rounds = magazine.size;
    hw.mags = magazine.magazines ?? hw.mags;
    hw.reload = 0;
    return true;
  };
  // `SimpleObject::handleDamage`'s own sign dispatch (R4-19): positive
  // damages, zero or negative heals — the hook the round-2 briefing asks
  // for, so a test can take the soldier's HP down without waiting on fall
  // damage's own approximate trigger. `hit` is an optional round meeting
  // (`soldier-death.js` `roundHit`: `{ travel, height }`), which is what the
  // death the body then plays is picked by. `from` is where the damage came
  // from, `[x, y, z]` or `{ x, y, z }` -- the point the damage arc points at
  // (ledger HFD-4); without one it raises the wash alone.
  window.__damage = (n, hit = null, from = null) => {
    if (!page.soldierArmor) return false;
    const at = Array.isArray(from) ? { x: from[0], y: from[1], z: from[2] } : from;
    page.applyDamageToPlayer(Number(n) || 0, at, null, hit);
    return true;
  };
  // Exercise the fall-damage integration itself (the `onFoot` hook above),
  // not just `Armor.applyDamage` in isolation — `__teleport` cannot stand in
  // for this because `Soldier.spawn` ends in `settle()`, which raycasts down
  // and places the body back on the ground with `grounded=true` and zero
  // velocity every time (`soldier.js`'s own `place()`/`settle()`). This
  // hook instead lifts the *already-settled* body by `extraHeight` metres,
  // zeroes vertical speed and marks it airborne, so the very next
  // `soldier.step()` calls fall under real gravity (`physics.js`,
  // `GRAVITY = -14.73`) into the same landing-edge detection a walked-off
  // ledge would trigger. A headless check reads `window.__soldier().hp`
  // before and after stepping frames until `grounded` is true again.
  window.__dropFromHeight = extraHeight => {
    if (!page.soldier) return false;
    const lift = Number(extraHeight) || 0;
    page.soldier.body.position.y += lift;
    page.soldier.body.velocity.y = 0;
    page.soldier.body.grounded = false;
    // HP-14's `F` is `getLastCollisionHeight() - pos.y`, so the body has to
    // believe it last touched ground at the height it is being dropped from.
    // Without this the lift is free: the fall would be billed a drop of zero
    // and every height would cost the same nothing.
    page.soldier.body.lastCollisionHeight += lift;
    return true;
  };
  // Drive a low-ammo state directly, the same way `__damage(n)` drives a
  // low-HP one: a fresh `handWeapon` spawns full (`ensureHandWeapon`), and
  // driving it dry by actually holding the trigger is `gunfire.js`'s own
  // fire-rate/rate-of-fire-gate territory, not this track's — a headless
  // check that wants to see `supplyTarget.refillAmmo` (this file, above)
  // actually fire should set the "before" state directly instead.
  window.__setAmmo = (rounds, mags) => {
    if (!page.handWeapon) return false;
    page.handWeapon.rounds = Number(rounds) || 0;
    page.handWeapon.mags = Number(mags) || 0;
    page.handWeapon.reload = 0;
    return true;
  };
  // The depot field and this soldier's current standing against it, for a
  // headless check to read without reaching into module-private state.
  window.__supply = () => {
    if (!page.supplyField || !page.soldierArmor) return null;
    const nearest = page.supplyField.nearest(page.supplyTarget);
    return {
      depots: page.supplyField.depots.length,
      hp: page.soldierArmor.hitPoints, maxHp: page.soldierArmor.maxHitPoints,
      destroyed: page.soldierArmor.destroyed,
      canHeal: page.supplyField.canHeal(page.supplyTarget),
      canRearm: page.supplyField.canRearm(page.supplyTarget),
      nearest: nearest && {
        name: nearest.depot.name, distance: nearest.distance,
        radius: nearest.depot.radius, team: nearest.depot.team,
        ammoEnabled: nearest.depot.ammoEnabled, healEnabled: nearest.depot.healEnabled,
      },
    };
  };
  // Seed every random draw the shot path makes — the spread cone, the
  // flash roll, the recoil, the emitters' distributions — so two captures
  // of the same stepped frames are the same picture and a pixel diff
  // between builds measures the build, not the dice. The guns and the
  // effects each hold their own `rand` for exactly this; `Math.random`
  // itself is left alone, because three draws it for every uuid and a build
  // that allocates one object more would otherwise fire a different burst.
  window.__seedRandom = (seed = 1) => {
    let s = seed >>> 0;
    const lcg = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    page.guns.rand = lcg;
    page.effects.rand = lcg;
    return true;
  };
  // Zoom is a press-toggle on every vanilla weapon (`altFireOnce`), so the
  // harness verb sets the latch directly rather than faking a held button.
  window.__setAim = on => {
    const hw = page.handWeapon;
    if (hw?.data?.zoom?.toggle) {
      hw.zoomed = !!on;
      hw.rezoom = 0;
    } else {
      page.setAim(on);
    }
  };
  // Fires a real pointerdown/pointerup/pointermove at the real listeners --
  // pointerdown, pointerup and a chorded pointermove all resolve through
  // `buttonChange` -- so a check exercises the actual wiring instead of
  // a re-implementation of it. `pointerLocked()` stands `?shots` in for
  // real pointer lock (headless Chromium never grants it), the same way
  // `__setTrigger` already stands in for the mouse. `kind` is 'down' | 'up'
  // | 'move'; a 'move' carries `movementX/Y` so a check can assert
  // `lookDelta` was, or was not, applied from a chorded event.
  window.__chordEvent = (kind, button, buttons, movementX = 0, movementY = 0) => {
    const type = kind === 'down' ? 'pointerdown' : kind === 'up' ? 'pointerup' : 'pointermove';
    const ev = new PointerEvent(type, {
      button, buttons, movementX, movementY,
      pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true,
    });
    (type === 'pointermove' ? document : page.renderer.domElement).dispatchEvent(ev);
    return { triggerHeld: page.triggerHeld, aimHeld: page.aimHeld, zoomed: page.isZoomed(), yaw: page.soldier?.yaw ?? null };
  };
  // The `?kblock` prototype, for headless checks. `lock` is only what the last
  // lock() promise said, which is that the browser registered the request --
  // never that a key is reserved: the lock is live only in fullscreen, and no
  // CDP key event can show it holding Ctrl+W (CDP injects below the view that
  // marks locked keys).
  window.__kblock = () => ({
    enabled: page.KBLOCK, session: page.kbSession, lock: page.kbLockState, keys: page.KBLOCK_KEYS,
    fullscreen: document.fullscreenElement === page.stage,
  });
  // The collider itself, for measuring rather than for asserting: `__collision()`
  // drains the accumulated cast cost, so calling it once a second gives the real
}
