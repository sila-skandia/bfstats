// Spawning the human: the deploy flow (open, cancel, the side, flag and kit
// chosen, the commit), the spawn at a flag's next point with the kit's body,
// weapon and Armor, and the free camera instead. The bots' spawns are the
// referee's (bot-referee.js). Lifted out of map.html (features/vehicle-
// instance-refactor Part 2); the screen it drives is `deploy-screen.js`.

import { activeDeployGroup as activeDeployGroupFor, flagGroupIds, flagHoldsGroup, flagMapSpots } from './deploy-spots.js';
import { Armor } from './armor.js';
import { kitOverridesAirMovement, kitPackSpec } from './kit-loadout.js';
import { KIT_CLASSES } from './scoreboard.js';
import { deployRowForKit, nearestFlagIndex } from './server-life.js';
import { flagSide } from './spawn-flags.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `capture`, `currentDir`, `currentKit`, `deployActive`, `deployKitHits`, `deployResumeBtn`,
 * `deployScoreBtn`, `deploySuicideBtn`, `deployTabs`, `discardSoldier`,
 * `disposeHandWeapon`, `drawFullMap`, `drawWeapon`, `ensureHandWeapon`, `enterVehicle`, `equipKit`,
 * `flags`, `fullmapBox`, `fullmapCanvas`, `kitRowLabelFor`,
 * `kitRowLayoutText`, `layoutDeploy`, `leavePilot`, `loadouts`, `LOCAL_PLAYER`,
 * `markOnFoot`, `netReconciler`, `netSendAction`, `netTickPoses`, `logToConsole`,
 * `noteServerSpawnAsked`, `serverOwnsSpawn`,
 * `paintDeployChrome`, `paintDeploySoon`, `params`, `placeCamera`,
 * `projectToArt`, `prone`, `rebaseDeckSpawns`, `refreshFlags`,
 * `revive`, `roomJoined`, `round`, `setOnFoot`, `setScoreboard`, `shipFlagInactive`,
 * `snapPresentation`, `soldier`, `soldierDead`, `soldierMaxHp`,
 * `spawnFlagSelect`, `spawnSeat`, `spawnLayout`, `supplyTarget`, `toggleFullMap`, `toggleProne`,
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
  // The spawn map's selection, retail's own (ledger SPAWNGRP-12): the group
  // a click picked, `{ group, index }` (the group id, or null for a flag that
  // names none, and the flag's index in `flags`). Retail keeps it in the map,
  // `BfMap+0xd4`: zero until the first click (`BfMap::BfMap` 0x0046e6be), and
  // written by nothing but a click (0x0046981c), so there is no default, it
  // stays chosen across deaths, team changes and level changes, and a group
  // that goes off or changes hands is simply not drawn (`BfMap::update` draws
  // the selected ring only over a drawn group) and refused by the server.
  // The map and the menu are built once, at the game's start (`FUN_0045e900`
  // -> 0x006e10b0 -> `BfMap::BfMap`, and -> 0x006a9880 -> 0x006ccc20).
  spawning.deployChoice = null;
  // `BfMap+0xd8`, the click's base: a click away from every drawn group keeps
  // it (the pick starts from it, 0x00469360), the close copies the selection
  // into it (0x004679e0), and a team change zeroes it (0x006ccdc0 ->
  // 0x00467df0). So a missed click keeps the selection, except after a team
  // change, when it clears it.
  let clickBase = null;
  // The menu's `+0x18`, the group the last close committed (0x004679e0); a
  // team change (0x006ccdc0) and the committed group passing to the other
  // side (0x006cd610) zero it. The respawn plate reads it:
  // RESPAWN_SPAWN_POINT_SELECTED while it is set, ..._NOT_SELECTED while not.
  spawning.deployCommitted = null;
  // The committed group seen on the other side, so the screen reopens once
  // per loss (0x006cd610's latch, `+0x80`).
  let lostLatch = false;
  // The tab: 1 Axis, 2 Allied — the game's `Kit/ShowKit`. Follows the chosen
  // flag and filters the rings.
  spawning.deployTeamId = 2;
  // Whether the player has spawned on this level. From then on the tab is the
  // side he plays for, and a death opens the screen on it: the guess a fresh
  // join makes (`preferredDeployTeam`) is not made again.
  spawning.deployJoined = false;
  // Nothing chosen: retail's group 0. The commit then closes the screen and
  // asks for no spawn (the page's free camera); the respawn plate says
  // RESPAWN_SPAWN_POINT_NOT_SELECTED.
  Object.defineProperty(spawning, 'deployUnchosen', {
    enumerable: true, get: () => !spawning.deployChoice,
  });
  spawning.deployKit = 'assault';
  // Server-authority mode: the commit has gone to the server and the screen is
  // waiting to be told this player is alive. The screen stays up meanwhile,
  // which is retail's own spawn wait.
  spawning.deployWaiting = false;
  // Set only while `standServerSpawn` is materialising the server's spawn, so
  // the commit below stands the body and does NOT ask for a second one.
  let standingServerSpawn = false;
  // The server's position for a resumed life, while `resumeServerLife` stands
  // it: where the body goes when the flag it is filed under has no point.
  let servedAt = null;
  // The `Kit/MouseOver/*` flag the pointer currently holds true, and the footer
  // button under it, for the mouse-over plate.
  spawning.deployHoverVar = null;
  spawning.deployHoverBtn = null;

  /** Put the soldier at the selected flag, on the next of its spawn points.
   *  The pick itself is the world's (pickSpawn/spawnYaw inside world.js —
   *  `spawnPlayer` holds the per-player walk of the spawn list, so the page
   *  never carries `spawnIndex`); this half is the kit coming up in his hands
   *  and the latches a fresh body resets. */
  function spawnAtFlag(advance = false) {
    if (!page.soldier || !page.flags.length || !page.world) return false;
    // `GameServer::spawnPlayer` (0x0814c990) refuses a human outside the
    // playing status (`cmp [esi+0x58],1` at 0x0814c9b8): nobody comes back
    // during the end of a round, and the spawn waits for the restart (ledger
    // ROUND-10, ROUND-11). The page's own round ends on its tick; a room's
    // copy once the server's `roundEnd` row is in.
    // A spawn a real server already made is not the page's to refuse
    // (`standServerSpawn`): neither by its own round status nor by a carrier
    // it has not drawn yet (`served` below).
    const served = standingServerSpawn && !!page.serverOwnsSpawn?.();
    if (!served && page.round && page.round.status !== 'playing') return false;
    // `BFSpawnPoint::spawn` (`0x08163d70`) is `soldier->setAbsolutePosition(
    // this->getAbsolutePosition())` and nothing else, and a deck `SpawnPoint`
    // reached the ship's tree through `addTemplate` — so its world position is its
    // ship-local offset through the hull's **live** transform AT THE MOMENT OF THE
    // SPAWN. Resolving it here is that "at the moment of": drive the carrier two
    // hundred metres and the deck you spawn on is the deck she is standing on now,
    // not the patch of ocean she started in.
    page.rebaseDeckSpawns();
    const flag = page.flags[Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1)];
    // `BFSpawnPoint::getActive`'s Armor gate: a flag whose carriers are all
    // critically damaged, gone or not stood up (a sinking ship, Weapon Bunkers'
    // bunkers) offers nothing (SPAWN-5, SPAWNGRP-10). The engine answers this
    // per spawn point every time the screen is drawn; the viewer answers it at
    // the moment of the spawn, which is the one that matters, and `pickSpawn`
    // leaves out the dead carriers' points of a flag that still has others.
    if (!served && page.shipFlagInactive(flag)) return false;
    // The side the point's group is asked for (`BFSpawnGroup::getActive`
    // hands `BFfindEntryPoint` the group's team, which is the player's:
    // `spawnPlayer` refuses a group of another side at 0x0814cb3e).
    const seatTeam = flagSide(flag) || spawning.deployTeamId;
    const spawned = page.world.spawnPlayer(page.LOCAL_PLAYER, {
      flag, advance, group: flag.vehicle ? (activeDeployGroup(flag) ?? firstSpotGroup(flag)) : null, enter: true, served,
      servedAt: served ? servedAt : null,
      seatFor: spawn => page.spawnSeat(spawn, { team: seatTeam }) });
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
    // A kit wearing a `nochute` never enters free fall (`parachute.js`
    // `freeFallBarred`). Asked when the gates would arm it, of the kit he
    // wears then, so a kit picked up off the ground counts as the engine's
    // kit parts do; the level's own kit where it declares one (LOAD-1).
    if (page.soldier.chute) {
      page.soldier.chute.freeFallBarred = () =>
        kitOverridesAirMovement(page.loadouts, page.currentKit?.());
    }
    // The kit's accelerating part, asked the same way (`rocket-pack.js`).
    page.soldier.packSource = () => kitPackSpec(page.loadouts, page.currentKit?.());
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
    // The room's control channel: the server re-places its own copy of this
    // player on the same flag (fresh Armor at the kit's max — the spawn row
    // names the kit so both sides build the same Armor from loadouts.json).
    // In server-authority mode the ask has already gone (`askServerSpawn`)
    // and this body IS its answer, stood where the server put it: asking
    // again here would spawn him a second time.
    if (page.roomJoined && !standingServerSpawn) {
      // The ledger describes a body that no longer exists.
      page.netReconciler?.reset();
      page.netTickPoses.length = 0;
      // Server-authority mode: the point is the server's to choose, and the
      // body below is only standing somewhere until it answers
      // (`net-room.js` `noteServerSpawnAsked`).
      page.noteServerSpawnAsked?.();
      page.netSendAction({
        type: 'spawn',
        flag: Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1),
        // WHICH of the flag's spawn points, so the authority spawns on the one
        // the prediction just used. `spawnPlayer` has already walked the index
        // for this spawn, so this is the point the soldier is standing on.
        spawnIndex: page.world.player(page.LOCAL_PLAYER)?.spawnIndex ?? 0,
        // And for a seat point, the point itself: which of them the walk
        // lands on depends on which carriers have a seat to give, and the
        // authority must not pick another (`server/room-control.mjs`).
        ...(spawn.enterOnSpawn ? { point: flag.spawns.indexOf(spawn) } : null),
        kit: spawning.deployKit,
        // What a real BF1942 server needs (the sidecar's SetTeam, ChangeKit
        // and SpawnRequest): the side, the level's spawn group the chosen
        // point belongs to, and the kit as the engine's index (KIT_CLASSES'
        // order: scout, assault, antitank, medic, engineer). The server picks
        // the point inside the group itself.
        team: spawning.deployTeamId,
        spawnGroup: spawn.group ?? flag.group ?? null,
        kitIndex: Math.max(0, KIT_CLASSES.indexOf(spawning.deployKit)),
      });
    }
    // `setEnterOnSpawn 1`: the spawn is a seat of the point's carrier (FH's
    // circling Hellcat, an LVT), not the point itself (FHR-10). A seat that
    // refuses leaves him on the point, as a plain spawn would. After the
    // room's spawn row, so the seat row `enterVehicle` sends finds the
    // authority's copy of him alive and on the point: the seat is taken the
    // way any seat is, and refused the way any seat is.
    //
    // The spawn presses Use for him where he stands (`GameServer::
    // spawnPlayer` 0x0814d27c, `toggleEntryPoint(player, true)`), and the
    // seat is whichever that finds: a door within its own entry radius, the
    // driver's seat first on an armoured hull (SPAWN-26). With none in
    // reach he is left on the point.
    if (spawn.enterOnSpawn) {
      const seat = page.spawnSeat({ position: [page.soldier.x, page.soldier.y, page.soldier.z] },
        { team: seatTeam, taking: true });
      if (seat) page.enterVehicle(seat);
    }
    return true;
  }

  // --- the state -----------------------------------------------------------------

  /** Whether the screen may offer a flag: every one but a capture-only point
   *  (`spawn-flags.js` `captureZone`), which is somewhere to take and hold and
   *  nowhere to spawn. The map still draws its marker from the level's
   *  control points. */
  function offered(flag) {
    return !!flag && !flag.captureOnly;
  }

  /** The server's spawn table on a sidecar page (`server-spawn-groups.js`),
   *  once it has arrived; null otherwise. */
  function servedTable() {
    const table = page.serverSpawnGroups;
    return table?.live ? table : null;
  }

  /** The rings `flag` draws for the current tab (`deploy-spots.js`
   *  `flagMapSpots`), through the server's table on a sidecar page. */
  function deploySpots(flag) {
    return flagMapSpots(flag, { team: spawning.deployTeamId, table: servedTable() });
  }

  /** The flags the current tab may spawn at, as indices into `flags`.
   *
   *  On a sidecar page with the server's table in, a flag is offered exactly
   *  when retail's map would draw one of its groups for the side: the
   *  group's side is his and its active byte is set (`BfMap::update`
   *  0x0046df22.., ledger SPAWNGRP-11). That is the side the server holds,
   *  not the page's own capture state, and it includes a point whose spawns
   *  are off while it is being taken (SPAWN-22). A flag the table names none
   *  of falls back to the page's own reading.
   *
   *  Otherwise the page's own: the flags of the tab's side, and a side with
   *  no flag of its own on this level (a one-sided extract) gets them all
   *  rather than an empty map. */
  function deployFlagIndices() {
    const own = [];
    const all = [];
    const table = servedTable();
    page.flags.forEach((flag, index) => {
      if (!offered(flag)) return;
      all.push(index);
      if (table && flagGroupIds(flag).some(g => table.active(g) != null)) {
        if (deploySpots(flag).length) own.push(index);
      } else if (flagSide(flag) === spawning.deployTeamId) own.push(index);
    });
    if (table) return own;
    return own.length ? own : all;
  }

  /** The group a click on `flag`'s first drawn ring would pick: the page's
   *  number keys and a script's `__deploy.select(name)` name a flag, and
   *  this is the ring on it they mean. Null for a ring that names no group. */
  function firstSpotGroup(flag) {
    return deploySpots(flag)[0]?.group ?? null;
  }

  /** The flag the selection is on, as an index into `flags`, or -1 when the
   *  chosen group is on none of this level's offered flags (a level change
   *  keeps the group, retail's `BfMap+0xd4`). */
  function choiceIndex(choice = spawning.deployChoice) {
    if (!choice) return -1;
    const holds = (index) => offered(page.flags[index])
      && (choice.group == null || flagHoldsGroup(page.flags[index], choice.group));
    if (Number.isInteger(choice.index) && holds(choice.index)) return choice.index;
    if (choice.group == null) return -1;
    return page.flags.findIndex((flag, index) => holds(index));
  }

  /** Point the sidebar select (and with it every reader of the chosen flag)
   *  at the selection's flag. */
  function syncChoiceSelect() {
    const index = choiceIndex();
    if (index < 0) return;
    if (spawning.deployChoice.index !== index) spawning.deployChoice = { ...spawning.deployChoice, index };
    if (page.spawnFlagSelect.value !== String(index)) {
      page.spawnFlagSelect.value = String(index);
      page.world?.setSpawnIndex(page.LOCAL_PLAYER, 0);
    }
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
      if (!offered(flag)) continue;
      if (flagSide(flag) === 1) axis++;
      else if (flagSide(flag) === 2) allied++;
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
    // The option's value is the flag's index in `flags`, which the room's
    // spawn row carries too; a capture-only flag gets no option, and as those
    // come last no index moves.
    let count = 0;
    for (const [index, flag] of page.flags.entries()) {
      if (!offered(flag)) continue;
      const option = document.createElement('option');
      const side = flag.team === 1 ? 'Axis' : flag.team === 2 ? 'Allied' : 'neutral';
      option.value = String(index);
      option.textContent = `${flag.name} (${side}, ${flag.spawns.length})`;
      page.spawnFlagSelect.appendChild(option);
      count++;
    }
    if (kept !== '' && offered(page.flags[Number(kept)])) page.spawnFlagSelect.value = kept;
    // The sidebar picker is a debug aid; the deploy screen is the real join
    // path (Caps Lock / auto-open). Keep the select populated whenever there
    // are flags so a later commit can read it, and only hide it when empty.
    page.spawnFlagSelect.hidden = !count;
    return count;
  }

  /** A new level: the select starts over (it must not keep the old map's
   *  index), and so does the side — the next screen is a fresh join. The
   *  selected group stays: retail's map and menu outlive the level (both are
   *  built once at the game's start, ledger SPAWNGRP-12), so a group of the
   *  same id on the new level is still chosen and still drawn as chosen
   *  where the new level draws it. The commit and the click base go with the
   *  side, as a team change takes them (0x006ccdc0); whether retail's join on
   *  a new level runs that handler is not read. */
  function forgetFlagChoice() {
    page.spawnFlagSelect.selectedIndex = -1;
    spawning.deployJoined = false;
    const group = spawning.deployChoice?.group;
    spawning.deployChoice = group != null ? { group, index: null } : null;
    clickBase = null;
    spawning.deployCommitted = null;
    lostLatch = false;
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
    // The selection is the map's, and the screen opening touches none of it
    // (retail opens the same `BfMap` on a death, 0x004946cf, with its
    // `+0xd4` as the last click left it).
    syncChoiceSelect();
    // Drop sidebar / footer focus so Enter commits spawn rather than toggling
    // `#onfoot` or synthesising a RESUME click.
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (spawning.deployJoined) {
      // He has a side already, alive or dead, and the screen opens on it. The
      // flag he last spawned at says nothing about that: it may have been
      // taken since, or been neutral all along (every flag on Midway is), and
      // reading the side off it put a dead Axis player on the Allied tab.
      // His selection stays as he left it, a lost flag included: it is not
      // drawn, and the server refuses it until he clicks another.
      setDeployTeam(spawning.deployTeamId, false);
    } else if (spawning.deployRejoin) {
      // A soldier who never came through this screen (the sidebar's instant
      // path): his flag is the only word on his side.
      const chosen = page.flags[Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1)];
      setDeployTeam(chosen?.team === 1 ? 1 : 2, false);
    } else {
      // A fresh join opens on a side and selects nothing: retail's map has
      // no default (SPAWNGRP-12), and the player clicks a ring.
      setDeployTeam(preferredDeployTeam(), false);
    }
    page.fullmapBox.classList.add('deploy');
    syncDeployReady();
    page.toggleFullMap(true);
    page.layoutDeploy();
    // A death with a spawn committed: the server cleared the player's group
    // when it stood him (`GameServer::spawnPlayer` 0x0814c990), so the group
    // the last close committed is asked for again, and the wave stands him
    // on it with no click and no close (the respawn plate reads SPAWN POINT
    // SELECTED meanwhile, 0x006cd610). The screen stays up the way retail's
    // does on a death (0x004946cf). Which call re-sends it in the retail
    // client is not read.
    if (!spawning.deployRejoin && spawning.deployJoined && spawning.deployCommitted
        && page.serverOwnsSpawn?.() && !spawning.deployWaiting && page.worldReady) {
      if (askServerSpawn(spawning.deployCommitted)) {
        spawning.deployWaiting = true;
        page.logToConsole?.('deploy: asking the server for the committed spawn');
      }
    }
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
    // A redeploy's spawn asked of the server and left waiting is abandoned
    // with the screen. A dead man's is not: the server stands him on the
    // group it holds whatever the page does (retail has no way to take a
    // committed group back but to commit another), so the wait stays for
    // `standServerSpawn` to take.
    if (rejoin) spawning.deployWaiting = false;
    page.toggleFullMap(false);
    if (rejoin) {
      // The life in progress resumes untouched; the flag he never committed
      // to goes back to the one he is actually standing at.
      if (kept !== '') page.spawnFlagSelect.value = kept;
      // The map took the pointer on the way in (the deploy state is the
      // in-game map on foot, `page-input.js` `mapKey`), so the way back out
      // gives it again — the same gesture the spawn and the free-roam leave
      // pay with. Without this the soldier resumes with nothing captured and
      // every key dead until a click on the stage (`controls.js` `held`).
      page.capture();
      return;
    }
    enterFreeCam();
  }

  /** The screen closed by its own key or button (Caps Lock, the map key,
   *  CLOSE). With a life behind it, the cancel above. Without one it is
   *  retail's close, which commits the selection as it stands (0x006ccf50 ->
   *  0x004679e0 when the player is not alive): a spawn when a group is
   *  chosen, the free camera when none is. Escape alone stays a plain cancel. */
  function closeDeploy() {
    if (!page.deployActive()) return;
    if (spawning.deployRejoin) { cancelDeploy(); return; }
    if (!page.worldReady) { cancelDeploy(); return; }
    deploySpawn();
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
    page.markOnFoot(false);
    page.setOnFoot(false);
    page.placeCamera();
    page.capture();
  }

  /** The group of `flag` the current selection is, or null: the chosen
   *  group when it is one of the flag's, nothing otherwise (no default,
   *  `deploy-spots.js`). */
  function activeDeployGroup(flag) {
    return activeDeployGroupFor(flag, spawning.deployChoice?.group ?? null);
  }

  /** The selection a ring stands for: its group (a land flag's single ring
   *  off a sidecar table names none, and stands for the flag's own group),
   *  and the flag. */
  function choiceFor(index, spotGroup) {
    const group = spotGroup ?? flagGroupIds(page.flags[index])[0] ?? null;
    return { group, index };
  }

  /** Select a ring, the click's write (`BfMap+0xd4` and `+0xd8`, 0x0046981c).
   *  `group` null names the flag's first drawn ring: the page's number keys
   *  and a script's `__deploy.select(name)` name a flag, not a ring. False
   *  for a flag the screen draws nothing of for the side, which retail's
   *  click cannot pick. */
  function selectDeployFlag(index, group = null) {
    if (!Number.isInteger(index) || index < 0 || index >= page.flags.length) return false;
    // A number key past the spawn flags lands on a capture-only point, which
    // is not a spawn to select.
    if (!offered(page.flags[index])) return false;
    // The tab follows the flag: a number key or a harness call naming the
    // other side's flag switches the column with it.
    // A neutral point whose groups are one side's (`flagSide`) is that side's.
    const team = flagSide(page.flags[index]);
    if (team && team !== spawning.deployTeamId) setDeployTeam(team, false);
    const spots = deploySpots(page.flags[index]);
    const spot = group == null ? spots[0] : spots.find(s => s.group === group || s.group == null);
    if (!spot) return false;
    spawning.deployChoice = choiceFor(index, spot.group ?? (group ?? null));
    clickBase = spawning.deployChoice;
    page.spawnFlagSelect.value = String(index);
    // A fresh choice starts at the flag's first spawn, as the select's own
    // change handler would have it — the world's counter rides the reset.
    page.world?.setSpawnIndex(page.LOCAL_PLAYER, 0);
    if (page.deployActive()) page.drawFullMap(true);
    page.paintDeployChrome?.();
    return true;
  }

  /** The side of the committed group now: the server's word on a sidecar
   *  page, else the side of the flag that holds it. Null when nothing says. */
  function committedSide() {
    const choice = spawning.deployCommitted;
    if (!choice) return null;
    const table = servedTable();
    const served = choice.group != null ? table?.team(choice.group) : null;
    if (served != null) return served;
    const index = choiceIndex(choice);
    const team = index >= 0 ? page.flags[index]?.team : null;
    return team === 1 || team === 2 ? team : null;
  }

  /** The respawn plate's check, run while the player has no body (0x006cd610
   *  from the plate's update 0x006ad0a0): a committed group that has passed
   *  to the other side is no longer committed, and the spawn screen opens,
   *  once per loss (its `+0x80` latch). A group that only went off stays
   *  committed and the server refuses it. */
  spawning.watchCommitted = () => {
    if (!spawning.deployCommitted || (page.soldier && !page.soldierDead)) return false;
    const side = committedSide();
    if (side == null || side === spawning.deployTeamId) return false;
    spawning.deployCommitted = null;
    if (!lostLatch) {
      lostLatch = true;
      if (!page.deployActive() && spawning.deployJoined) openDeploy();
    }
    return true;
  };

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

  /** A kit row clicked, by the row's name (`deploy-screen.js` `KITS`:
   *  `scout` .. `engineer`, `slot5` for Desert Combat's sixth). */
  function chooseKit(kit) {
    spawning.deployKit = kit;
    page.paintDeployChrome();
  }

  function setDeployTeam(team, reselect = true) {
    // A change of side takes the click base and the commit (the menu's team
    // handler 0x006ccdc0: `+0x18 = 0`, `BfMap+0xd8 = 0` through 0x00467df0),
    // and leaves the selection itself, which a drawn group of the new side
    // shows again only if it is that group.
    if (team !== spawning.deployTeamId) {
      clickBase = null;
      spawning.deployCommitted = null;
      lostLatch = false;
    }
    spawning.deployTeamId = team;
    for (const tab of page.deployTabs) {
      tab.setAttribute('aria-pressed', String(Number(tab.dataset.team) === team));
    }
    updateKitAriaLabels();
    // A tab click picks nothing (`reselect` is kept for its callers): retail's
    // team change writes no selection.
    void reselect;
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
    // The screen may already be CLOSED while a server-authority spawn is in
    // flight (`deployWaiting`): the stand still has to run when the server's
    // row arrives (`standServerSpawn`), so allow it then too.
    if ((!page.deployActive() && !spawning.deployWaiting) || !page.worldReady) return false;
    const rejoin = spawning.deployRejoin;
    // The close commits the selection as it stands (0x004679e0: `+0xd8` and
    // the menu's `+0x18` take `+0xd4`, and the game's `setSpawnGroup` is
    // handed it) -- the dead man's close; a redeploy over a live soldier
    // commits nothing on retail's screen.
    if (!rejoin && !standingServerSpawn) {
      clickBase = spawning.deployChoice;
      spawning.deployCommitted = spawning.deployChoice;
      lostLatch = false;
    }
    // Nothing chosen, or a group this level has no flag for: the commit is
    // the way out to the free camera, not a spawn. Retail's close asks for
    // group 0 and the server spawns nobody; there is no flag here to put a
    // soldier at.
    if (!standingServerSpawn && (spawning.deployUnchosen || choiceIndex() < 0)) {
      page.toggleFullMap(false);
      enterFreeCam();
      return false;
    }
    if (!standingServerSpawn) syncChoiceSelect();
    // Server-authority mode: the server owns BOTH halves of a spawn, where
    // and when. The page asks and the screen stays up until the server's own
    // row says this player is alive (`net-room.js`, the snapshot handler),
    // which is what retail's screen is doing while it counts its respawn
    // timer down. Standing a body on the press instead let the player walk
    // around for as long as the server made him wait and then teleported him
    // to the point it had actually chosen (live, 2026-10-18).
    //
    // Only for a spawn that has no body yet -- a fresh join, or a death. A
    // redeploy with a live soldier behind the screen (SUICIDE) keeps the old
    // path: a real BF1942 server ignores a SpawnRequest from a player who is
    // already alive, so waiting for a row that will never come would leave
    // the screen up for good.
    if (page.serverOwnsSpawn?.() && !standingServerSpawn && !rejoin) {
      if (!askServerSpawn()) return false;
      spawning.deployWaiting = true;
      // Retail CLOSES the spawn window on commit and shows the "TIME TO SPAWN"
      // bar over the world (a spectator view) until the wave stands the body up
      // -- it does NOT keep the selector up (owner's retail screenshots,
      // 2026-10-19). Close to the free camera; `spawnCountdown` draws the
      // countdown overlay in-world while `deployWaiting`, and the server's own
      // row stands the body (`net-room.js` -> `standServerSpawn`). enterFreeCam
      // takes the pointer, the gesture pointer lock needs.
      page.toggleFullMap(false);
      enterFreeCam();
      page.logToConsole?.('deploy: waiting for the server to spawn you');
      return false;
    }
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
    if (spawned) {
      spawning.deployJoined = true;
      page.capture();
    } else if (!page.soldier) page.markOnFoot(false);
    return spawned;
  }

  /** Ask the server for a spawn, with nothing of the page's own in it: the
   *  side, the chosen flag's spawn group and the kit. A real BF1942 server
   *  picks the point inside the group itself (the sidecar's SetTeam,
   *  ChangeKit and SpawnRequest), so no `spawnIndex` is offered -- there is
   *  no local body yet whose point could be named. */
  function askServerSpawn(choice = spawning.deployChoice) {
    const index = choiceIndex(choice);
    const flag = page.flags[index];
    if (!flag) return false;
    page.noteServerSpawnAsked?.();
    page.netSendAction({
      type: 'spawn',
      flag: index,
      kit: spawning.deployKit,
      team: spawning.deployTeamId,
      spawnGroup: activeDeployGroupFor(flag, choice.group) ?? flag.group ?? null,
      kitIndex: Math.max(0, KIT_CLASSES.indexOf(spawning.deployKit)),
    });
    return true;
  }

  /** Ask again, for a spawn the server never answered. A request can be lost
   *  to a round restart (the server drops every client and the sidecar
   *  rejoins) or refused for a reason the page is not told, and the screen
   *  would otherwise wait for a row that is not coming. `net-room.js` times
   *  the wait and calls this. */
  spawning.reaskServerSpawn = () => {
    // The deploy window is closed while waiting now, so key the re-ask on the
    // wait itself, not on the selector being up.
    if (!spawning.deployWaiting) return false;
    return askServerSpawn(spawning.deployCommitted ?? spawning.deployChoice);
  };

  /** The server has this player alive: stand the body the screen held back,
   *  with the kit, Armor and weapon any other spawn gets. `net-room.js` calls
   *  this from the snapshot that first reports him, and places him on the
   *  server's own point immediately after. */
  spawning.standServerSpawn = () => {
    // Either the selector is still up, or it was closed on commit and we are in
    // the spectator wait (`deployWaiting`): both must let the server stand us.
    if (!page.deployActive() && !spawning.deployWaiting) return false;
    standingServerSpawn = true;
    try { return deploySpawn(); }
    finally { standingServerSpawn = false; spawning.deployWaiting = false; }
  };

  /** A life the server already has (`server-life.js`): the page was reloaded,
   *  or joined, while the sidecar's soldier was alive. Stand the body with the
   *  server's side and kit, no spawn screen and no spawn asked for; the
   *  caller (`net-room.js`) places it on the server's pose right after. The
   *  flag only files the life under a side's base for the page's weapon and
   *  soldier choice (`nearestFlagIndex`). False when no body could be stood. */
  spawning.resumeServerLife = (row) => {
    if (!page.worldReady || !buildSpawnFlags()) return false;
    const team = row.team === 1 ? 1 : 2;
    setDeployTeam(team, false);
    // Never refused for the page's own view of the flags: the server has
    // him alive, so any offered flag files him (`nearestFlagIndex`), and
    // one with no point of its own stands him on the server's position.
    const flagIndex = nearestFlagIndex(page.flags, team, row.x, row.z);
    if (flagIndex < 0) return false;
    // The flag only files the life; the map's selection is the player's
    // and stays as it is (none, on a page just loaded).
    page.spawnFlagSelect.value = String(flagIndex);
    const kit = deployRowForKit(page.loadouts, page.currentDir, team, row.kit);
    if (kit) spawning.deployKit = kit.row;
    updateKitAriaLabels();
    // No spawn screen behind the body: a screen the join opened goes, and the
    // commit below is the server's spawn, not a request.
    spawning.deployRejoin = false;
    spawning.deployWaiting = true;
    servedAt = [row.x, row.y, row.z].every(Number.isFinite) ? [row.x, row.y, row.z] : null;
    let stood;
    try { stood = spawning.standServerSpawn(); } finally { servedAt = null; }
    if (!stood || !page.soldier) return false;
    // A kit he picked up is worn the way a pickup is (`equipKit`): his own
    // row's kit is what the spawn above already put in hand.
    if (kit?.carried) page.equipKit?.(kit.kit, [], { team });
    // His facing and stance as the server holds them. The page's `yaw` is
    // the view's (`soldier.js`), and the row's `viewYaw` is in degrees in the
    // page's own convention; prone is a toggle on the page, a held key is not.
    if (Number.isFinite(row.viewYaw ?? row.yaw)) page.soldier.yaw = (row.viewYaw ?? row.yaw) * Math.PI / 180;
    if (Number.isFinite(row.twist)) page.soldier.twist = row.twist;
    if (row.prone && !page.prone) page.toggleProne?.();
    page.logToConsole?.(`deploy: resumed the server's life (${kit?.kit ?? row.kit ?? 'kit unknown'})`);
    return true;
  };

  // Clicking the art is clicking a ring: the nearest one of the chosen side's
  // within a finger's width, measured in CSS pixels so the target does not
  // shrink on a hidpi display. A click only selects — Enter or DONE/SUICIDE
  // commits, matching the game. Touch arrives here as the same click event.
  //
  // A click away from every ring keeps the selection as it was (the pick
  // starts from `BfMap+0xd8`, 0x00469360), which after a change of side is
  // none. With nothing selected the commit takes the free camera over the
  // level instead of a spawn (`enterFreeCam`).
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
      for (const spot of deploySpots(page.flags[index])) {
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
    const picked = best >= 0 ? choiceFor(best, bestGroup) : clickBase;
    spawning.deployChoice = picked;
    clickBase = picked;
    if (picked) syncChoiceSelect();
    page.drawFullMap(true);
    page.paintDeployChrome();
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
    // On a real server SUICIDE is the retail client's Suicide event (0x33):
    // the server kills the player (its death score, ExitVehicle with the death
    // flag, his spawn camera, measured on the lab 2026-10-22) and the page's
    // own death flow takes the `killed` row from there, to the death cam and
    // the spawn screen and its wave. Spawning in its place, as the solo page
    // does, asked a live soldier's server for a spawn it ignored, and the
    // player went straight back to where he stood (the owner, 2026-10-22).
    if (spawning.deployRejoin && page.serverOwnsSpawn?.()) {
      page.netSendAction?.({ type: 'suicide' });
      cancelDeploy();
      return;
    }
    if (spawning.deployRejoin) deploySpawn();
    else closeDeploy();
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
    forgetFlagChoice,
    showFlagPicker,
    activeDeployGroup,
    cancelDeploy,
    closeDeploy,
    chooseKit,
    chooseTeam,
    deployFlagIndices,
    deployChoiceIndex: () => choiceIndex(),
    deploySpawn,
    deploySpots,
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
