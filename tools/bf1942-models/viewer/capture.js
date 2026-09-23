// The flags: the level's control points as the spawn picker lists them, the
// human's capture (the law is bot-referee.js's, the same the bots take a
// flag by), the capture HUD, the taker's cloth hoisted on the pole, and the
// radio line each side hears. Lifted out of map.html (features/vehicle-
// instance-refactor Part 2).

import * as THREE from 'three';
import { captureDuration, nearestEnemyFlag as nearestEnemyFlagOf } from './bot-referee.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `AUDIO_OFF`, `LOCAL_PLAYER`, `MAPS_BASE`, `bust`, `cull`, `currentRoot`,
 * `deployScreen`, `extras`, `flagMixer`, `flattenCull`, `hud`, `hudFeed`,
 * `levelClips`, `logToConsole`, `mapSurfaces`, `optOnFoot`, `pageAudio`,
 * `room`, `soldier`, `soldierDead`, `spawnFlagSelect`,
 * `syncVehicleSpawnOwnership`, `tagCull`, `thaw`, `updateHud`, `world`.
 */
export function createFlagCapture(page) {
  const flagCapture = {};

  flagCapture.localCapture = null;
  flagCapture.roomCapture = null;
  flagCapture.flags = [];

  /** Fill the flag picker from the level's own control points.
   *
   *  Rebuilt whole, but not forgetful: the deploy screen writes its choice into
   *  this select and `setOnFoot` rebuilds the options before reading it back,
   *  and an innerHTML wipe resets a select to its first option. A level switch
   *  clears the value in `show()` first, so the memory never crosses maps. */
  function buildSpawnFlags() {
    const kept = page.spawnFlagSelect.value;
    // The world owns the flags (world.js builds them from the level data the
    // engine's way); the deploy screen reads the same array it always read.
    flagCapture.flags = page.world?.flags ?? [];
    page.spawnFlagSelect.innerHTML = '';
    for (const [index, flag] of flagCapture.flags.entries()) {
      const option = document.createElement('option');
      const side = flag.team === 1 ? 'Axis' : flag.team === 2 ? 'Allied' : 'neutral';
      option.value = String(index);
      option.textContent = `${flag.name} (${side}, ${flag.spawns.length})`;
      page.spawnFlagSelect.appendChild(option);
    }
    if (kept !== '' && Number(kept) < flagCapture.flags.length) page.spawnFlagSelect.value = kept;
    // The sidebar picker is a debug aid; the deploy screen is the real join
    // path (Caps Lock / auto-open). Keep the select populated whenever there
    // are flags so a later commit can read it, and only hide it when empty.
    page.spawnFlagSelect.hidden = !flagCapture.flags.length;
    return flagCapture.flags.length;
  }



  function nearestEnemyFlag(team, position) {
    return position ? nearestEnemyFlagOf(flagCapture.flags, team, [position.x, position.y, position.z]) : null;
  }


  function capturePosition() {
    const player = page.world?.player(page.LOCAL_PLAYER);
    if (player?.soldier) return player.soldier;
    if (player?.vehicle?.state?.position) return player.vehicle.state.position;
    return null;
  }

  function resetCaptureUi() {
    flagCapture.localCapture = null;
    flagCapture.roomCapture = null;
  }

  /** Hoist the taker's cloth over a captured point: swap the pole's flag-anchor
   *  skin + cloth UVs to the capturing side's own national mesh, or strip the
   *  cloth when the point goes neutral (a take-back always names a side).
   *
   *  The cloth is a skinned mesh whose baked UVs point at one cell of the
   *  `flags_o` atlas (surveyed off `standardMesh/flag*_m1.sm`: us/can
   *  u .003-.425 v -1.0-.75, uk u .001-.422 v -.734-.484, ge
   *  u .438-.859 v -.734-.484, jp u .434-.856 v -1.0-.75). The take rewrites
   *  the pole node in place: visitors re-resolve the anchor + cloth each call
   *  off the point's scene-graph name (no per-flag cache to go stale across a
   *  level switch), retarget the cloth's skin to the anchor's joint chain and
   *  overwrite its UV attribute with the taker's cell. The wave animation keeps
   *  playing — the joints are the pole's own, untouched — only the colours
   *  change, which is exactly what the retail capture does.
   *
    *  A neutral point bakes pole-only (no anchor, no cloth), so there is nothing
    *  to swap: the team's cloth is built fresh the way the extractor builds one
    *  (anchor under the pole at the point's flag height, joints + `FlagBlow`
    *  clip + cloth node), reusing the sibling point's skin/mesh layout. When
    *  the new owner's nation has no cell above (a `flagpl_m1` the pack cannot
    *  draw), the point keeps its old colours rather than flying another
    *  nation's flag — the same neutral-plate rule `drawControlPoint` applies
    *  on the map. */
  const FLAG_UV_CELLS = {
    // Surveyed off the baked cloth (`standardMesh/flag*_m1.sm` UV ranges ==
    // the glb's own baked TEXCOORD_0 ranges): each national mesh samples one
    // cell of the shared `flags_o` atlas. u0,v0,u1,v1 in the file's own stored
    // convention (v negative — the bake carries the .sm values through).
    us: [0.003, -1.000, 0.425, -0.750],
    can: [0.003, -1.000, 0.425, -0.750],
    brit: [0.001, -0.734, 0.422, -0.484],
    ger: [0.438, -0.734, 0.859, -0.484],
    jp: [0.434, -1.000, 0.856, -0.750],
    rus: [0.001, -0.469, 0.422, -0.219],
  };
  function flagUvCellFor(team) {
    // The taker's own national cloth: the nation whose flag that side flies on
    // THIS level (`nation.js` — most control points that side holds; Bocage
    // Axis German, Allies American), not a hardcoded us/ge pair. On a level
    // whose answer is 'unknown' (a `flagpl_m1` the pack has no art for) there
    // is no cell and the point keeps its old colours — the same neutral-plate
    // rule `drawControlPoint` applies on the map.
    const nation = team === 1 || team === 2 ? page.mapSurfaces.teamNation(team) : null;
    return (nation && FLAG_UV_CELLS[nation]) || null;
  }
  /** The stored UV range of a cloth geometry: [u0,v0,u1,v1]. Every baked cloth
   *  samples exactly one atlas cell, so the min/max is the cell. */
  function unitRectOf(uv) {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    return [u0, v0, u1, v1];
  }
  /** Scene-graph names are the extractor's `<point> <part>` run through
   *  `PropertyBinding.sanitizeNodeName` by GLTFLoader (spaces to
   *  underscores): the cloth is `<point>_cloth`, the anchor `<point>_flag`,
   *  the joints `<point>_Bone01..20`, and every `FlagBlow` track names the
   *  joints that way. Raised nodes take the same names so one lookup serves
   *  baked and raised alike -- a `<point> cloth` test with a space matched
   *  nothing the loader had renamed. */
  function flagNodeStem(pointName) {
    return THREE.PropertyBinding.sanitizeNodeName(pointName);
  }
  function captureSceneNodes(flag) {
    if (!page.currentRoot || !flag?.controlPointName) return null;
    const stem = flagNodeStem(flag.controlPointName);
    const pole = page.currentRoot.getObjectByName(flag.controlPointName)
      || page.currentRoot.getObjectByName(stem);
    if (!pole) return null;
    let anchor = null, cloth = null;
    pole.traverse(obj => {
      if (obj.userData?.kind === 'flagAnchor' && !anchor) anchor = obj;
    });
    const clothName = `${stem}_cloth`;
    page.currentRoot.traverse(obj => {
      if (!cloth && obj.userData?.kind === 'flagCloth' && obj.name === clothName) cloth = obj;
    });
    return { pole, anchor, cloth };
  }
  /** The taker's cloth, flown over a pole that baked none.
   *
   *  A neutral point bakes pole-only (no anchor, no cloth, no `FlagBlow`
   *  clip), so the UV swap has nothing to repaint. Build the team's cloth
   *  the way the extractor builds one: an anchor under the pole at the
   *  point's flag height (flagbase poles hoist at 8.2, the donor's own
   *  offset), the same 20-bone joint chain posed at the clip's frame 0, and
   *  a cloth node reusing a sibling point's skinned mesh + skin + material.
   *  The wave animation comes along because the mixer plays every
   *  `FlagBlow <name>` clip by node name — and the joints are named for THIS
   *  point (`<point> Bone01..20`), exactly the nodes a
   *  `FlagBlow <point>` track list would bind. A `FlagBlow` clip for this
   *  point exists only when the extractor baked one; when it did not (a
   *  point the level never flies), the cloth hangs in the skeleton's frame-0
   *  pose — the same correctly-hung sheet a viewer that ignores animations
   *  shows, per the extractor's own comment — rather than erroring.
   *
   *  Returns the new cloth, or null when this level baked no donor cloth to
   *  copy (then the point keeps its bare pole). The donor is any same-level
   *  `flagCloth` (same shared `flags_o` atlas on every level); its mesh,
   *  skin layout and material are the level's own. */
  function raiseCaptureCloth(pole, pointName, cell) {
    let donor = null;
    page.currentRoot.traverse(obj => {
      if (!donor && obj.userData?.kind === 'flagCloth'
          && obj.skeleton?.bones?.length) donor = obj;
    });
    if (!donor) return null;
    const stem = flagNodeStem(pointName);
    const donorStem = donor.name.replace(/_cloth$/, '');
    const donorBones = donor.skeleton.bones;
    // The donor's anchor: the first non-joint ancestor of its root joint.
    let donorAnchor = donorBones[0];
    while (donorAnchor && donorAnchor.isBone) donorAnchor = donorAnchor.parent;
    const anchor = new THREE.Group();
    anchor.name = `${stem}_flag`;
    anchor.userData.kind = 'flagAnchor';
    if (donorAnchor?.userData?.kind === 'flagAnchor') {
      anchor.position.copy(donorAnchor.position);
    } else {
      anchor.position.set(0, 8.2, 0);
    }
    pole.add(anchor);
    // The joint chain: the donor's, bone for bone in skin order, renamed for
    // this point (`<point>_Bone01..20`, the names a `FlagBlow <point>` track
    // list binds) and parented the same way -- a donor root joint hangs off
    // this anchor. Local poses are the donor's current ones; the clip below
    // overwrites them every frame.
    const bones = donorBones.map(src => {
      const b = new THREE.Bone();
      b.name = src.name.startsWith(`${donorStem}_`)
        ? `${stem}_${src.name.slice(donorStem.length + 1)}`
        : `${stem}_${src.name}`;
      b.position.copy(src.position);
      b.quaternion.copy(src.quaternion);
      b.scale.copy(src.scale);
      return b;
    });
    const byDonor = new Map(donorBones.map((src, i) => [src, bones[i]]));
    donorBones.forEach((src, i) => (byDonor.get(src.parent) || anchor).add(bones[i]));
    anchor.updateMatrixWorld(true);
    // The inverse binds are the donor's own, cloned: the extractor bakes each
    // as the offset from the flat sheet at the origin into bone space
    // (`bind = (I, rest - offset)`, extract_map.py), NOT as the inverse of
    // the joint's world pose. `Skeleton.calculateInverses` -- what a bind
    // with no explicit matrix runs -- would make every joint cancel to
    // identity at bind time and draw the sheet where its vertices are: a
    // metre-wide rectangle at the world origin, nowhere near the pole.
    const skin = new THREE.Skeleton(
      bones, donor.skeleton.boneInverses.map(m => m.clone()));
    // The donor geometry is shared: clone it before repainting UVs so the
    // sibling point keeps its own colours. `BufferGeometry.copy` shares the
    // `userData` object, and `paintClothCell` caches the painted cell there,
    // so give the clone its own.
    const geometry = donor.geometry.clone();
    geometry.userData = {
      flagUvCell: donor.geometry.userData.flagUvCell?.slice() ?? null,
    };
    const cloth = new THREE.SkinnedMesh(geometry, donor.material);
    cloth.name = `${stem}_cloth`;
    cloth.userData.kind = 'flagCloth';
    cloth.userData.donorStem = donorStem;
    cloth.frustumCulled = donor.frustumCulled;
    // Explicit bind matrix: `bind(skin)` alone recalculates the inverses.
    cloth.bind(skin, donor.bindMatrix.clone());
    paintClothCell(cloth, cell);
    cloth.visible = true;
    page.currentRoot.add(cloth);
    return cloth;
  }
  /** Wave a raised cloth. The level bakes `FlagBlow <point>` only for the
   *  poles it flies, so a point raised from bare has no clip of its own --
   *  but the clip is the same `FlagBlow.baf` on every pole, so the donor's
   *  is retargeted: each track renamed from the donor's joints to this
   *  point's, which `raiseCaptureCloth` named bone for bone. Falls back to
   *  the point's own clip when the level did bake one. */
  function playRaisedClothClip(cloth, pointName) {
    const stem = flagNodeStem(pointName);
    const donorStem = cloth.userData.donorStem;
    const own = page.levelClips.find(c => c.name === `FlagBlow ${pointName}`);
    // Clip names keep the extractor's spelling; track names carry the
    // sanitized joint names, so the donor's clip is the one whose tracks
    // name the donor's joints.
    const source = own ?? page.levelClips.find(c => c.name.startsWith('FlagBlow ')
      && c.tracks.some(t => t.name.startsWith(`${donorStem}_`)));
    if (!source) return null;
    const tracks = [];
    for (const track of source.tracks) {
      if (source === own) { tracks.push(track); continue; }
      if (!track.name.startsWith(`${donorStem}_`)) continue;
      const renamed = track.clone();
      renamed.name = stem + track.name.slice(donorStem.length);
      tracks.push(renamed);
    }
    if (!tracks.length) return null;
    const clip = source === own
      ? source : new THREE.AnimationClip(`FlagBlow ${pointName}`, source.duration, tracks);
    page.flagMixer ??= new THREE.AnimationMixer(page.currentRoot);
    const action = page.flagMixer.clipAction(clip);
    action.time = Math.random() * clip.duration;
    action.play();
    return action;
  }
  /** Repaint a cloth's UVs into an atlas cell, relatively: each vertex keeps
   *  its fractional position within the geometry's baked cell and takes the
   *  same fraction of the new one, so the weave direction and the hoist edge
   *  survive the swap. (Positions are no guide — the us and ge cloths bake
   *  byte-identical POSITION/NORMAL arrays; only their UVs differ.) */
  function paintClothCell(cloth, cell) {
    const uv = cloth.geometry?.getAttribute('uv');
    if (!uv) return;
    const src = cloth.geometry.userData.flagUvCell
      || (cloth.geometry.userData.flagUvCell = unitRectOf(uv));
    const [u0, v0, u1, v1] = cell;
    const su0 = src[0], sv0 = src[1], su = src[2] - src[0], sv = src[3] - src[1];
    for (let i = 0; i < uv.count; i++) {
      const fu = su ? (uv.getX(i) - su0) / su : 0;
      const fv = sv ? (uv.getY(i) - sv0) / sv : 0;
      uv.setXY(i, u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv);
    }
    uv.needsUpdate = true;
    cloth.geometry.userData.flagUvCell = cell.slice();
  }
  function hoistCaptureFlag(flag) {
    const nodes = captureSceneNodes(flag);
    if (!nodes) return;
    // The map surfaces read `extras.controlPoints`, not the world's live flags
    // — so the team write alone leaves the minimap's marker neutral. Sync the
    // entry by control-point name (`flags[].controlPointName` is the scene
    // node's name; the deploy label in `flags[].name` is not);
    // `drawControlPoint` then resolves the taker's own `conp_<nation>` sprite
    // (or the neutral plate for `unknown`) and the cpbar strip takes the
    // holder's colour on the same repaint.
    const listed = page.extras.controlPoints || [];
    const entry = listed.find(e => e.name === flag.controlPointName);
    if (entry) entry.team = flag.team;
    const cell = flagUvCellFor(flag.team);
    if (cell && nodes.cloth) {
      // The cloth is already skinned to this pole's own joints -- baked for
      // it, or raised below on an earlier take -- so only the colours change.
      // Do NOT rebind it: a fresh `Skeleton` recomputes the inverse binds off
      // the live world pose, which draws the sheet at the world origin (see
      // `raiseCaptureCloth`), and that is a pole with no flag on it.
      paintClothCell(nodes.cloth, cell);
      nodes.cloth.visible = true;
      if (nodes.anchor) nodes.anchor.visible = true;
    } else if (cell && nodes.pole) {
      // A neutral point bakes pole-only: raise the team's cloth fresh (built
      // the way the extractor builds one) rather than leaving a bare pole.
      const cloth = raiseCaptureCloth(nodes.pole, flag.controlPointName, cell);
      if (cloth) {
        // Visibility: the new cloth is a scene-root child like every baked
        // one, so it joins the culled set with its joints' own bounds
        // (`tagCull` reads those for a skinned mesh, not the bind pose).
        page.tagCull(cloth);
        page.cull.push(cloth);
        page.flattenCull();
        // Matrices: `freezeStatics` ran at level load, and a pole chain with
        // nothing moving under it was frozen out of the per-frame matrix
        // walk. Its joints wave every frame the mixer plays from here on, so
        // thaw the chain (a no-op on a node that was never frozen).
        for (let n = nodes.pole; n && n !== page.currentRoot; n = n.parent) page.thaw(n);
        playRaisedClothClip(cloth, flag.controlPointName);
      }
    } else if (!cell && nodes.cloth) {
      nodes.cloth.visible = false;
    }
    page.mapSurfaces.drawMinimap(true);
    page.mapSurfaces.drawFullMap(true);
    if (typeof page.deployScreen.paintDeployChrome === 'function') page.deployScreen.paintDeployChrome();
  }

  function updateCaptureHud(ticks) {
    if (!page.optOnFoot.checked || !page.soldier || page.soldierDead) {
      if (!flagCapture.roomCapture && !flagCapture.localCapture) return;
      resetCaptureUi();
      page.updateHud();
      return;
    }

    // Solo play has no server authority, so run the same delayed capture law
    // locally. Room play only displays the authoritative lifecycle below.
    if (!page.room.roomJoined) {
      const player = page.world?.player(page.LOCAL_PLAYER);
      const target = nearestEnemyFlag(player?.team ?? page.deployScreen.deployTeamId, capturePosition());
      if (!target) {
        if (flagCapture.localCapture) { flagCapture.localCapture = null; page.updateHud(); }
        return;
      }
      if (!flagCapture.localCapture || flagCapture.localCapture.flag !== target) {
        flagCapture.localCapture = { flag: target, elapsed: 0 };
      }
      flagCapture.localCapture.elapsed += (ticks * (1 / 30));
      const progress = Math.min(100, Math.round(
        flagCapture.localCapture.elapsed / captureDuration(target) * 100));
      page.hud.textContent = `CAPTURING ${target.name} · ${progress}%`;
      if (flagCapture.localCapture.elapsed < captureDuration(target)) return;
      const prevTeam = target.team;
      target.team = player?.team ?? page.deployScreen.deployTeamId;
      hoistCaptureFlag(target);
      page.syncVehicleSpawnOwnership();
      page.logToConsole(`${target.name} captured by ${target.team === 1 ? 'Axis' : 'Allied'}`);
      page.hud.textContent = `${target.name} captured`;
      announceCapture(prevTeam, target.team);
      clearTimeout(page.hudFeed.hudViewTimer);
      page.hudFeed.hudViewTimer = setTimeout(page.updateHud, 2200);
      flagCapture.localCapture = null;
      return;
    }

    if (!flagCapture.roomCapture) return;
    if (flagCapture.roomCapture.until && performance.now() >= flagCapture.roomCapture.until) {
      flagCapture.roomCapture = null;
      page.updateHud();
      return;
    }
    if (!flagCapture.roomCapture.contested && !flagCapture.roomCapture.done) {
      flagCapture.roomCapture.elapsed += ticks * (1 / 30);
      const progress = Math.min(100, Math.round(
        flagCapture.roomCapture.elapsed / flagCapture.roomCapture.duration * 100));
      page.hud.textContent = `CAPTURING ${flagCapture.roomCapture.name} · ${progress}%`;
    } else if (flagCapture.roomCapture.contested) {
      page.hud.textContent = `CONTESTED ${flagCapture.roomCapture.name}`;
    } else if (flagCapture.roomCapture.done) {
      page.hud.textContent = `${flagCapture.roomCapture.name} captured`;
    }
  }

  // --- control-point capture voice -------------------------------------------
  //
  // `Bf1942/Game/GamePlay.ssc` (bf1942/Game.rfa): `GainControlPoint` plays one
  // of `WeNowHaveControlOver{,2,3}.wav`, `LoseControlPoint` one of
  // `WeHaveLostControlOf{,2,3}.wav` -- both `randomPlay 1`, both under
  // `Sound/@RTD/@Language/`. `@Language` is the side's own tongue, not a UI
  // setting: every soldier template declares `ObjectTemplate.setRadioLanguage`
  // (`Objects/Soldiers/*/Objects.con` -- USSoldier UsEnglish, BritishSoldier
  // English, RussianSoldier Russian, ...), so the Russians on Kharkov hear
  // Russian and the Marines on Wake hear UsEnglish. `extract_capture_voices.py`
  // lays the lines out per nation code under `_shared/voices/<nation>/`, and
  // the local side's nation (`teamNation`, the same answer the flag cloth and
  // the map sprites use) picks the folder; `en` is the pre-nation English set,
  // the fallback for a tree extracted before the per-nation folders existed.
  //
  // The announcer is team-wide radio: it plays wherever the player is, on foot
  // or in a seat, on every change of ownership the side is party to -- a gain
  // when the side takes a point (the player's own take, a bot's, or the room's
  // word), a loss when a point the side held goes to the enemy. The enemy's
  // gain of a neutral point is nobody's loss and stays silent.
  flagCapture.lastCaptureVoiceTime = 0;
  flagCapture.lastCaptureVoice = null;
  const CAPTURE_VOICE_STEMS = {
    gain: ['WeNowHaveControlOver', 'WeNowHaveControlOver2', 'WeNowHaveControlOver3'],
    loss: ['WeHaveLostControlOf', 'WeHaveLostControlOf2', 'WeHaveLostControlOf3'],
  };
  const missingCaptureVoices = new Set();
  /** 'gain', 'loss' or null: what the local side hears when a point goes from
   *  `prevTeam` to `newTeam`. */
  function captureVoiceKind(prevTeam, newTeam, localTeam) {
    if (newTeam === localTeam && prevTeam !== localTeam) return 'gain';
    if (prevTeam === localTeam && newTeam !== localTeam) return 'loss';
    return null;
  }
  /** The folders to try for the side's announcer, most specific first. */
  function captureVoiceDirs(team) {
    const nation = page.mapSurfaces.teamNation(team);
    const shared = page.MAPS_BASE === 'maps' ? 'maps/_shared' : `${page.MAPS_BASE}/_shared`;
    const dirs = [];
    if (nation && nation !== 'unknown') {
      dirs.push(`${shared}/voices/${nation}`);
      // A mod tree that never extracted voices borrows vanilla's, the way
      // `hudPaths` falls back per file.
      if (shared !== 'maps/_shared') dirs.push(`maps/_shared/voices/${nation}`);
    }
    dirs.push(`${shared}/voices/en`);
    if (shared !== 'maps/_shared') dirs.push('maps/_shared/voices/en');
    return dirs;
  }
  async function loadCaptureVoice(dir, stem) {
    const key = `voices:${dir}/${stem}.mp3`;
    if (missingCaptureVoices.has(key)) return null;
    let pending = page.pageAudio.audioBufferCache.get(key);
    if (!pending) {
      if (!page.pageAudio.audioLoader) return null;
      pending = page.pageAudio.audioLoader.loadAsync(`${dir}/${stem}.mp3${page.bust()}`)
        .catch(() => {
          // Remembered, not retried: a folder the tree does not carry would
          // otherwise be fetched again on every take.
          missingCaptureVoices.add(key);
          page.pageAudio.audioBufferCache.delete(key);
          return null;
        });
      page.pageAudio.audioBufferCache.set(key, pending);
    }
    return pending;
  }
  async function playCaptureVoice(kind = 'gain', team = page.mapSurfaces.localMapTeam()) {
    if (page.AUDIO_OFF || page.pageAudio.masterVolume() <= 0) return;
    const stems = CAPTURE_VOICE_STEMS[kind];
    if (!stems) return;
    // One announcement per take, never stacked.
    const now = performance.now() * 0.001;
    if (now - flagCapture.lastCaptureVoiceTime < 1.0) return;
    page.pageAudio.ensureAudioContext();
    if (!page.pageAudio.audioListener || page.pageAudio.audioListener.context.state === 'suspended') return;
    flagCapture.lastCaptureVoiceTime = now;
    const stem = stems[Math.floor(Math.random() * stems.length)];
    for (const dir of captureVoiceDirs(team)) {
      const buf = await loadCaptureVoice(dir, stem);
      if (!buf) continue;
      // The one-shot path the footsteps and hurt grunts already use: 2D voice,
      // no pitch wobble (a `randomPlay` pick is the variation), script volume 1.
      page.pageAudio.playSoldierOneShot(buf, 1, 0, 0);
      flagCapture.lastCaptureVoice = { kind, team, dir, stem };
      return;
    }
    console.warn(`No capture voice for team ${team} (${kind})`);
  }
  /** A point changed hands: say so if the local side gained or lost it. */
  function announceCapture(prevTeam, newTeam) {
    const team = page.mapSurfaces.localMapTeam();
    const kind = captureVoiceKind(prevTeam, newTeam, team);
    if (kind) playCaptureVoice(kind, team);
  }

  Object.assign(flagCapture, {
    announceCapture,
    buildSpawnFlags,
    capturePosition,
    captureVoiceDirs,
    captureVoiceKind,
    hoistCaptureFlag,
    nearestEnemyFlag,
    playCaptureVoice,
    resetCaptureUi,
    unitRectOf,
    updateCaptureHud,
  });
  return flagCapture;
}
