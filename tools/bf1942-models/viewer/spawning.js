// Spawning the human: the deploy flow (open, cancel, the side, flag and kit
// chosen, the commit), the spawn at a flag's next point with the kit's body,
// weapon and Armor, and the free camera instead. The bots' spawns are the
// referee's (bot-referee.js). Lifted out of map.html (features/vehicle-
// instance-refactor Part 2); the screen it drives is `deploy-screen.js`.

import { activeDeployGroup as activeDeployGroupFor, flagMapSpots } from './deploy-spots.js';
import { Armor } from './armor.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `capture`, `deployActive`, `deployKitHits`, `deployResumeBtn`,
 * `deployScoreBtn`, `deploySuicideBtn`, `deployTabs`, `discardSoldier`,
 * `disposeHandWeapon`, `drawFullMap`, `drawWeapon`, `ensureHandWeapon`,
 * `flags`, `flashHud`, `fullmapBox`, `fullmapCanvas`, `kitRowLabelFor`,
 * `kitRowLayoutText`, `layoutDeploy`, `leavePilot`, `LOCAL_PLAYER`,
 * `markOnFoot`, `netReconciler`, `netSendAction`, `netTickPoses`,
 * `paintDeployChrome`, `paintDeploySoon`, `params`, `placeCamera`,
 * `projectToArt`, `rebaseDeckSpawns`, `refreshFlags`, `resetCaptureUi`,
 * `revive`, `roomJoined`, `setOnFoot`, `setScoreboard`, `shipFlagInactive`,
 * `snapPresentation`, `soldier`, `soldierDead`, `soldierMaxHp`,
 * `spawnFlagSelect`, `spawnLayout`, `supplyTarget`, `toggleFullMap`,
 * `world`, `worldReady`.
 */
export function createSpawning(page) {
  const spawning = {};

  // The deploy screen's selection. This module is its only writer;
  // `deploy-screen.js` paints it.
  // Whether a live soldier waits behind the screen (M or Shift+R over a life
  // in progress). Cancelling a redeploy keeps him where he stood; cancelling a
  // join has nobody to keep and falls back to fly. It is also the game's
  // `Kit/IsAlive`: SUICIDE / RESUME with a life behind the screen, CLOSE / DONE
  // without one.
  spawning.deployRejoin = false;
  // The selection as it stood when the screen opened, so a cancelled redeploy
  // does not leave the panel's select pointing somewhere nobody went.
  spawning.deployKept = '';
  // Nothing chosen. `spawnFlagSelect` has no empty value and several things
  // read it, so "no spawn" is a flag beside it rather than a cleared select:
  // a click on the map away from every ring sets it, choosing anything clears
  // it, and while it is set the commit is free roam instead of a spawn.
  spawning.deployUnchosen = false;
  // The tab: 1 Axis, 2 Allied — the game's `Kit/ShowKit`. Follows the chosen
  // flag and filters the rings.
  spawning.deployTeamId = 2;
  // The deck spot chosen on a ship flag, as the spawn group its ring stands
  // for. Null for an island flag — their single ring carries no group.
  spawning.deployGroup = null;
  spawning.deployKit = 'assault';
  // The `Kit/MouseOver/*` flag the pointer currently holds true, and the footer
  // button under it, for the mouse-over plate.
  spawning.deployHoverVar = null;
  spawning.deployHoverBtn = null;

  /** Put the soldier at the selected flag, on the next of its spawn points.
   *  The pick itself is the world's (pickSpawn/spawnYaw inside world.js —
   *  `spawnPlayer` holds the per-player walk of the spawn list, so the page
   *  never carries `spawnIndex`); this half is the kit, the latch resets and
   *  the HUD line that always went with a spawn. */
  function spawnAtFlag(advance = false) {
    if (!page.soldier || !page.flags.length || !page.world) return false;
    page.resetCaptureUi();
    // `BFSpawnPoint::spawn` (`0x08163d70`) is `soldier->setAbsolutePosition(
    // this->getAbsolutePosition())` and nothing else, and a deck `SpawnPoint`
    // reached the ship's tree through `addTemplate` — so its world position is its
    // ship-local offset through the hull's **live** transform AT THE MOMENT OF THE
    // SPAWN. Resolving it here is that "at the moment of": drive the carrier two
    // hundred metres and the deck you spawn on is the deck she is standing on now,
    // not the patch of ocean she started in.
    page.rebaseDeckSpawns();
    const flag = page.flags[Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1)];
    // `BFSpawnPoint::getActive`'s Armor gate: a critically damaged ship offers
    // nothing. The engine answers this per spawn point every time the screen is
    // drawn; the viewer answers it at the moment of the spawn, which is the one
    // that matters.
    if (page.shipFlagInactive(flag)) return false;
    const spawned = page.world.spawnPlayer(page.LOCAL_PLAYER, {
      flag, advance, group: flag.vehicle ? activeDeployGroup(flag) : null });
    if (!spawned) return false;
    const spawn = spawned.spawn;
    // A fresh body is full health, from the kit's own template (`soldierMaxHp`,
    // beside `kitLoadout` below) — every spawn and every redeploy passes
    // through here, so this is the one reset point. The world owns the Armor
    // record per player, but this is the same object the HUD has always read.
    const armor = new Armor(page.soldierMaxHp(flag));
    // Respawn clears the death cam: the fresh body is alive, so the latch
    // must not hold the corpse cam over the new soldier.
    page.revive(armor);
    page.world.setPlayerArmor(page.LOCAL_PLAYER, armor);
    page.world.setPlayerSupply(page.LOCAL_PLAYER, { team: spawning.deployTeamId, refillAmmo: page.supplyTarget.refillAmmo });
    // The weapon follows the flag: switching to the other side's spawn swaps
    // the SMG. A no-op when the right one is already in hand.
    page.ensureHandWeapon(flag);
    // A death inside a vehicle leaves the rig holstered (`enterVehicle` hid it
    // and `killOccupantInWreck` deliberately does not raise it); the fresh body
    // has his weapon in hand again. `loadHandWeapon` builds a visible rig, so
    // this only matters on the same-weapon path `ensureHandWeapon` short-cuts.
    page.drawWeapon();
    // A fresh body somewhere else entirely: the eye must not sweep there.
    page.snapPresentation();
    page.flashHud(`${flag.name} · ${spawn.name}`);
    // The room's control channel: the server re-places its own copy of this
    // player on the same flag (fresh Armor at the kit's max — the spawn row
    // names the kit so both sides build the same Armor from loadouts.json).
    if (page.roomJoined) {
      // The ledger describes a body that no longer exists.
      page.netReconciler?.reset();
      page.netTickPoses.length = 0;
      page.netSendAction({
        type: 'spawn',
        flag: Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1),
        // WHICH of the flag's spawn points, so the authority spawns on the one
        // the prediction just used. `spawnPlayer` has already walked the index
        // for this spawn, so this is the point the soldier is standing on.
        spawnIndex: page.world.player(page.LOCAL_PLAYER)?.spawnIndex ?? 0,
        kit: spawning.deployKit,
      });
    }
    return true;
  }

  // --- the state -----------------------------------------------------------------

  /** The flags the current tab may spawn at, as indices into `flags`. A side
   *  with no flag of its own on this level — a one-sided extract — gets them
   *  all rather than an empty map. */
  function deployFlagIndices() {
    const own = [];
    page.flags.forEach((flag, index) => { if (flag.team === spawning.deployTeamId) own.push(index); });
    return own.length ? own : page.flags.map((_, index) => index);
  }

  /** The side the page was launched on, or null.
   *
   *  The Instant Battle screen in `play/` starts the map with `?team=`, which
   *  is the `Campaign/Team` its TEAM list writes: 1 Axis, 2 Allied, the
   *  numbering `menu/SkirmishMenu` itself uses. Names are accepted too so a
   *  hand-typed link reads. The level comes in on `?map=`, which this page
   *  already honoured. */
  const launchTeam = (() => {
    const raw = (page.params.get('team') || '').trim().toLowerCase();
    if (raw === '1' || raw === 'axis') return 1;
    if (raw === '2' || raw === 'allied' || raw === 'allies') return 2;
    return null;
  })();

  /** Fresh join: pick the side that actually has spawn choices. Liberation of
   *  Caen's Allied tab is a single Canadian_Base in empty fields; Axis owns
   *  the bridge and town. Tobruk is the reverse. A rejoin keeps the life's
   *  own team.
   *
   *  A launch from the Instant Battle screen names the side instead, and it
   *  wins outright. The tally is only a guess at which side has somewhere to
   *  stand, and it is not needed here: `deployFlagIndices` already offers
   *  every flag to a side that owns none. That is how Midway works at all
   *  (its control points all start neutral), and it is what makes Wake
   *  playable from the Japanese side — all five of its flags are Allied at
   *  the start, so a tally-based guard would answer ALLIED to a player who
   *  picked AXIS on the screen before this one. */
  function preferredDeployTeam() {
    if (launchTeam) return launchTeam;
    let axis = 0;
    let allied = 0;
    for (const flag of page.flags) {
      if (flag.team === 1) axis++;
      else if (flag.team === 2) allied++;
    }
    if (axis && !allied) return 1;
    if (allied && !axis) return 2;
    if (axis > allied) return 1;
    if (allied > axis) return 2;
    return 2;
  }

  /** The checkbox's on-edge. Joining became a choice rather than a teleport:
   *  the deploy screen opens when the level has flags to choose between, and
   *  the instant path — with its refusal message for a level that declares no
   *  soldier spawns — stays for the levels that do not. */
  function requestOnFoot() {
    page.leavePilot();                      // the two modes are exclusive
    if (!buildSpawnFlags()) {
      page.setOnFoot(true);
      return;
    }
    openDeploy();
  }

  /** Fill the flag picker from the level's own control points.
   *
   *  Rebuilt whole, but not forgetful: the deploy screen writes its choice into
   *  this select and `setOnFoot` rebuilds the options before reading it back,
   *  and an innerHTML wipe resets a select to its first option. A level switch
   *  clears the value in `show()` first, so the memory never crosses maps. */
  function buildSpawnFlags() {
    const kept = page.spawnFlagSelect.value;
    page.refreshFlags();
    page.spawnFlagSelect.innerHTML = '';
    for (const [index, flag] of page.flags.entries()) {
      const option = document.createElement('option');
      const side = flag.team === 1 ? 'Axis' : flag.team === 2 ? 'Allied' : 'neutral';
      option.value = String(index);
      option.textContent = `${flag.name} (${side}, ${flag.spawns.length})`;
      page.spawnFlagSelect.appendChild(option);
    }
    if (kept !== '' && Number(kept) < page.flags.length) page.spawnFlagSelect.value = kept;
    // The sidebar picker is a debug aid; the deploy screen is the real join
    // path (Caps Lock / auto-open). Keep the select populated whenever there
    // are flags so a later commit can read it, and only hide it when empty.
    page.spawnFlagSelect.hidden = !page.flags.length;
    return page.flags.length;
  }

  /** The sidebar picker shown or not (`setOnFoot` hides it with no flags). */
  function showFlagPicker(on) {
    page.spawnFlagSelect.hidden = !on;
  }

  function openDeploy() {
    // Rebuilt on every open, not only when empty: `flags` otherwise survives a
    // level switch, and the rings would be drawn from the previous level's
    // flags — off the current map, or not anywhere at all. Rebuilding is a few
    // DOM options; the kept choice rides the select through it.
    if (!buildSpawnFlags()) return false;
    // A dead body is not a life to go back to: RESUME must not hand the player
    // a corpse, and `Kit/IsAlive` must say so.
    spawning.deployRejoin = !!page.soldier && !page.soldierDead;
    spawning.deployKept = page.spawnFlagSelect.value;
    // A fresh screen always opens on a flag, whether the last one was left
    // unselected for a free roam or not.
    spawning.deployUnchosen = false;
    // The deck-spot choice belongs to the life it was made on; a fresh screen
    // starts with whole flags again (the rejoin path re-derives it below).
    spawning.deployGroup = null;
    // Drop sidebar / footer focus so Enter commits spawn rather than toggling
    // `#onfoot` or synthesising a RESUME click.
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (spawning.deployRejoin) {
      const chosen = page.flags[Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1)];
      setDeployTeam(chosen?.team === 1 ? 1 : 2, false);
    } else {
      const team = preferredDeployTeam();
      setDeployTeam(team, false);
      const first = deployFlagIndices()[0];
      if (first != null) {
        page.spawnFlagSelect.value = String(first);
        page.world?.setSpawnIndex(page.LOCAL_PLAYER, 0);
      }
    }
    page.fullmapBox.classList.add('deploy');
    syncDeployReady();
    page.toggleFullMap(true);
    page.layoutDeploy();
    return true;
  }

  function cancelDeploy() {
    // deploySpawn closes the overlay first; a focused RESUME button can still
    // receive the Enter key's synthetic click afterward. Refuse unless the
    // deploy chrome is actually up, or that click tears down the soldier we
    // just built and dumps the camera into fly-through.
    if (!page.deployActive()) return;
    const rejoin = spawning.deployRejoin;
    const kept = spawning.deployKept;
    page.toggleFullMap(false);
    if (rejoin) {
      // The life in progress resumes untouched; the flag he never committed
      // to goes back to the one he is actually standing at.
      if (kept !== '') page.spawnFlagSelect.value = kept;
      return;
    }
    enterFreeCam();
  }

  /** Free roam: the spawn screen closed with nobody spawned.
   *
   *  The game's own behaviour on a server that allows it — you leave the spawn
   *  menu without taking a spawn and the camera is yours over the level. Caps
   *  Lock brings the screen back, which is how you stop free-roaming.
   *
   *  It takes the pointer with it. The click or the Enter that got here is a
   *  user gesture, which is the only currency pointer lock accepts, and this
   *  is the whole reason the page no longer needs a "click to fly" plate: the
   *  way into the free camera captures the mouse on the way. */
  function enterFreeCam() {
    spawning.deployUnchosen = false;
    page.markOnFoot(false);
    page.setOnFoot(false);
    page.placeCamera();
    page.capture();
  }

  /** The group of `flag` the current selection points at: the chosen deck
   *  spot when one was clicked, else the ship's first group. The law lives in
   *  `deploy-spots.js` (node-tested); this is the page's thin wrapper over its
   *  own `deployGroup` state. */
  function activeDeployGroup(flag) {
    return activeDeployGroupFor(flag, spawning.deployGroup);
  }

  function selectDeployFlag(index, group = null) {
    if (!Number.isInteger(index) || index < 0 || index >= page.flags.length) return false;
    spawning.deployUnchosen = false;
    page.spawnFlagSelect.value = String(index);
    // A fresh choice starts at the flag's first spawn, as the select's own
    // change handler would have it — the world's counter rides the reset.
    page.world?.setSpawnIndex(page.LOCAL_PLAYER, 0);
    spawning.deployGroup = group;
    // The tab follows the flag: a number key or a harness call naming the
    // other side's flag switches the column with it.
    const team = page.flags[index].team;
    if ((team === 1 || team === 2) && team !== spawning.deployTeamId) setDeployTeam(team, false);
    if (page.deployActive()) page.drawFullMap(true);
    return true;
  }

  /** The AXIS / ALLIED tab. `reselect` moves the chosen flag onto the new
   *  side when it is not already there — a tab click — and leaves it alone
   *  when the flag chose the tab. */
  /** The kit buttons' accessible names say the same as the rows draw: the
   *  level's kit for the row on the current team, its `setKitName` resolved.
   *  Called from `setDeployTeam` (the team changed) and `layoutDeploy` (the
   *  layout — and with it the label's fallback — may have just landed). */
  function updateKitAriaLabels() {
    for (const hit of page.deployKitHits) {
      const role = hit.dataset.kit;
      if (role) hit.setAttribute('aria-label',
        page.kitRowLabelFor(role, page.kitRowLayoutText(role)));
    }
  }

  /** The AXIS / ALLIED tab clicked. Switching teams kills the current
   *  soldier, matching retail BF1942: a live player who changes sides on the
   *  deploy screen dies and rejoins from scratch on the new side. */
  function chooseTeam(team) {
    if (spawning.deployRejoin && team !== spawning.deployTeamId && page.soldier) {
      page.discardSoldier();
      spawning.deployRejoin = false;
      page.disposeHandWeapon();
    }
    setDeployTeam(team);
  }

  /** A kit row clicked, by the row's name (`scout` .. `engineer`). */
  function chooseKit(kit) {
    spawning.deployKit = kit;
    page.paintDeployChrome();
  }

  function setDeployTeam(team, reselect = true) {
    spawning.deployTeamId = team;
    for (const tab of page.deployTabs) {
      tab.setAttribute('aria-pressed', String(Number(tab.dataset.team) === team));
    }
    updateKitAriaLabels();
    if (reselect) {
      // Picking a side is picking again: whatever the tab lands on is chosen.
      spawning.deployUnchosen = false;
      const chosen = Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1);
      if (page.flags[chosen]?.team !== team) {
        const first = deployFlagIndices()[0];
        if (first != null) {
          page.spawnFlagSelect.value = String(first);
          page.world?.setSpawnIndex(page.LOCAL_PLAYER, 0);
          spawning.deployGroup = null;
        }
      }
    }
    page.paintDeployChrome();
    if (page.deployActive()) page.drawFullMap(true);
  }

  for (const tab of page.deployTabs) {
    tab.addEventListener('click', e => {
      e.stopPropagation();
      chooseTeam(Number(tab.dataset.team));
      tab.blur();
    });
  }

  // The rows: a click selects, the pointer over one raises its
  // `Kit/MouseOver/*` flag for the game's mouse-over tint.
  page.deployKitHits.forEach((hit, i) => {
    const hoverVar = () => page.spawnLayout.data?.groups.spawn.elements
      .filter(el => el.kind === 'hit' && el.hover)[i]?.hover || null;
    hit.addEventListener('click', e => {
      e.stopPropagation();
      chooseKit(hit.dataset.kit);
      hit.blur();
    });
    hit.addEventListener('pointerenter', () => { spawning.deployHoverVar = hoverVar(); page.paintDeploySoon(); });
    hit.addEventListener('pointerleave', () => {
      if (spawning.deployHoverVar === hoverVar()) spawning.deployHoverVar = null;
      page.paintDeploySoon();
    });
  });
  for (const [btn, id] of [[page.deploySuicideBtn, 'suicide'], [page.deployScoreBtn, 'score'],
                           [page.deployResumeBtn, 'resume']]) {
    btn.addEventListener('pointerenter', () => { spawning.deployHoverBtn = id; page.paintDeploySoon(); });
    btn.addEventListener('pointerleave', () => {
      if (spawning.deployHoverBtn === id) spawning.deployHoverBtn = null;
      page.paintDeploySoon();
    });
  }

  /** The commit. A join builds the soldier through today's `setOnFoot`, whose
   *  rebuilt select keeps the chosen flag; a redeploy moves the one that
   *  exists. Either way the screen goes first, and pointer capture stays with
   *  the gate, exactly as it does today. */
  // The commit button reads LOADING and refuses while the scene streams.
  function syncDeployReady() {
    // Only the commit button reads LOADING and refuses while the scene streams;
    // which button that is depends on the side of the screen the footer puts it
    // on (left with a life behind the screen, right without).
    page.deploySuicideBtn.disabled = spawning.deployRejoin && !page.worldReady;
    page.deployResumeBtn.disabled = !spawning.deployRejoin && !page.worldReady;
    page.paintDeployChrome();
  }

  function deploySpawn() {
    if (!page.deployActive() || !page.worldReady) return false;
    // Nothing chosen: the commit is the way out to the free camera, not a
    // spawn. The game's spawn menu closes the same way on a server that
    // allows it, and there is no flag here to put a soldier at.
    if (spawning.deployUnchosen) {
      page.toggleFullMap(false);
      enterFreeCam();
      return false;
    }
    const rejoin = spawning.deployRejoin;
    // Arm on-foot without firing `change` — that handler calls requestOnFoot
    // and would reopen this screen. Without the box ticked the frame loop
    // keeps flying even after setOnFoot builds a soldier (Caps Lock / auto
    // join never checked it).
    page.markOnFoot(true);
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    page.toggleFullMap(false);
    const spawned = (rejoin && page.soldier) ? spawnAtFlag() : (page.setOnFoot(true), !!page.soldier);
    // The click that commits is a user gesture, which is the only currency
    // pointer lock accepts — capture here and the very first click in the
    // world is a trigger pull, not a mysterious dead click that only grabs
    // the mouse.
    if (spawned) page.capture();
    else if (!page.soldier) page.markOnFoot(false);
    return spawned;
  }

  // Clicking the art is clicking a ring: the nearest one of the chosen side's
  // within a finger's width, measured in CSS pixels so the target does not
  // shrink on a hidpi display. A click only selects — Enter or DONE/SUICIDE
  // commits, matching the game. Touch arrives here as the same click event.
  //
  // A click on open ground, away from every ring, *unselects* instead. That is
  // how you say "no spawn" on this screen, and with nothing selected the same
  // commit that would have spawned you takes the free camera over the level
  // instead (`enterFreeCam`).
  page.fullmapCanvas.addEventListener('click', e => {
    if (!page.deployActive()) return;       // the plain map still closes, above
    e.stopPropagation();
    const rect = page.fullmapCanvas.getBoundingClientRect();
    if (!rect.width) return;
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    let best = -1;
    let bestGroup = null;
    let bestDist = 26;
    for (const index of deployFlagIndices()) {
      for (const spot of flagMapSpots(page.flags[index])) {
        if (!spot.position) continue;
        const p = page.projectToArt(spot.position[0], spot.position[2]);
        if (!p) continue;
        const d = Math.hypot((p.u - u) * rect.width, (p.v - v) * rect.height);
        if (d < bestDist) {
          bestDist = d;
          best = index;
          bestGroup = spot.group;
        }
      }
    }
    if (best < 0) {
      if (spawning.deployUnchosen) return;
      spawning.deployUnchosen = true;
      page.drawFullMap(true);
      page.paintDeployChrome();
      return;
    }
    selectDeployFlag(best, bestGroup);
  });

  // The footer. The left and right buttons swap roles depending on whether a
  // life waits behind the screen (`deployRejoin`):
  //   alive (rejoin): SUICIDE (left) commits spawn, RESUME (right) cancels
  //   dead  (join):   CLOSE   (left) cancels,      DONE   (right) commits
  // SCORE BOARD has no board to show and stays a button in name only.
  // Focus must not stay on any of them: Space is the jump the instant the
  // screen closes, and a focused button turns it back into a click.
  page.deploySuicideBtn.addEventListener('click', e => {
    e.stopPropagation();
    page.deploySuicideBtn.blur();
    if (spawning.deployRejoin) deploySpawn();
    else cancelDeploy();
  });
  page.deployResumeBtn.addEventListener('click', e => {
    e.stopPropagation();
    page.deployResumeBtn.blur();
    if (spawning.deployRejoin) cancelDeploy();
    else deploySpawn();
  });
  page.deployScoreBtn.addEventListener('click', e => {
    e.stopPropagation();
    page.deployScoreBtn.blur();
    // `Kit/ScoreboardSpawnInterface`: the board takes the spawn interface's
    // place until its own DONE (`Kit/DoneSpawnScoreboard`) gives it back.
    page.setScoreboard(true, true);
  });

  Object.assign(spawning, {
    buildSpawnFlags,
    showFlagPicker,
    activeDeployGroup,
    cancelDeploy,
    chooseKit,
    chooseTeam,
    deployFlagIndices,
    deploySpawn,
    launchTeam,
    openDeploy,
    requestOnFoot,
    selectDeployFlag,
    setDeployTeam,
    spawnAtFlag,
    syncDeployReady,
    updateKitAriaLabels,
  });
  return spawning;
}
