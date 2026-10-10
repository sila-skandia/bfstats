// Artillery spotting on the map page: a `magType 2` weapon's pull becomes a
// marker, the gunner in an `artPos` seat looks through it, and the HUD says
// so. The rules are `spotter.js`'s (ledger SPOT-1..SPOT-13); this is the
// page's side of them: the camera ray, the world's players, the seat's
// camera, the keys and the paint.
//
// `page` hands in what this reads of the rest of the page, as getters:
// `altFireHeld`, `bust`, `callArtillery`, `camera`, `collider`, `firerOf`,
// `guns`, `info`, `LOCAL_PLAYER`, `localTeam`, `MAPS_BASE`, `occupancy`,
// `seatView`, `speakerOf`, `sprite`, `text`, `updateSeatPoseVisibility`,
// `world`.

import * as THREE from 'three';
import { chainOnShot } from './seats.js';
import {
  RADIO_ARTILLERY_SUPPORT, ScoutCameras, ScoutSelector, ScoutView,
  artSeat, calledLine, fadeAlpha, isMarkerWeapon, scoutIconFrame, scoutLine, teamMarkers,
  wedgeBlinkAlpha,
} from './spotter.js';

/** The HUD's own 800 x 600 space (`menu/InGame`). */
const VIRTUAL_W = 800;
const VIRTUAL_H = 600;
/** `Icon_scout_1` / `_2`, the "a scout camera is available" icon. */
const SCOUT_ICON_AT = [174, 503];
/** The scout box: "Scout: <name>" and the marker's seconds. */
const SCOUT_BOX_AT = [280, 470];
/** `binocular.tga` over the whole screen while looking. */
const BINOCULAR_RECT = [-8, -2, 825, 625];
/** A marker with no declared life: vanilla's `BinocularsProjectile`. */
const DEFAULT_TIME_TO_LIVE = 120;

export function createMapSpotter(page) {
  const cameras = new ScoutCameras();
  const canvas = document.getElementById('scout-canvas');
  const eye = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const target = new THREE.Vector3();
  const up = new THREE.Vector3();

  /** The game clock the markers live on, seconds of simulated ticks. */
  let now = 0;
  /** The page's own clock, for the blinks and the fade. */
  let clock = 0;
  let fadeAt = -Infinity;
  let fadesSeen = 0;
  let seatKey = '';
  let altWas = false;
  /** The newest teammate marker the gunner has been told of (`BfMap +0x108`). */
  let announced = null;
  /** The seat's latest shell (`Camera +0x254`), a `guns.projectiles` record. */
  let traceShot = null;
  let traceGroup = null;
  let seconds = 0;
  let lastSig = '';

  // --- the table and its pictures ------------------------------------------------

  /** The tree's `_shared/vehicle-spotting.json`, fetched once per tree; null
   *  while it is on its way and where the tree has none. */
  const tables = new Map();
  const images = new Map();
  function table() {
    const base = `${page.MAPS_BASE}/_shared`;
    if (!tables.has(base)) {
      tables.set(base, null);
      fetch(`${base}/vehicle-spotting.json${page.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .then(doc => {
          if (!Array.isArray(doc?.seats)) return;
          tables.set(base, doc);
          for (const [name, file] of Object.entries(doc.sprites ?? {})) {
            const img = new Image();
            img.onload = () => { images.set(`${base}|${name}`, img); lastSig = ''; };
            img.src = `${base}/${file}${page.bust()}`;
          }
        })
        .catch(() => {});
    }
    return tables.get(base);
  }
  const picture = name => images.get(`${page.MAPS_BASE}/_shared|${name}`) ?? null;

  // --- who is who ----------------------------------------------------------------

  const templateOf = node => node?.userData?.control || node?.name || '';
  const teamOf = id => (id == null || id < 0 ? null
    : id === page.LOCAL_PLAYER ? page.localTeam() ?? null
      : page.world?.player?.(id)?.team ?? page.speakerOf?.(id)?.team ?? null);
  const nameOf = id => page.speakerOf?.(id)?.name ?? '';

  /** The local seat as the selector reads it: the table's entry for an
   *  `artPos` seat, null on foot and in any other seat. */
  function localSeat() {
    const occupancy = page.occupancy;
    if (!occupancy?.root) return null;
    const node = occupancy.seatInfo?.(occupancy.activeSeatId)?.node ?? occupancy.root;
    return artSeat(table(), templateOf(node));
  }
  function localSeatKey() {
    const occupancy = page.occupancy;
    return occupancy?.root ? `${occupancy.root.id}|${occupancy.activeSeatId}` : '';
  }

  // --- the camera the view takes over ------------------------------------------------

  const view = new ScoutView({
    // Mode 17 is an outside view: `setViewMode` turns the camera's own
    // LodObject off as the chase views do. The seat's view rig keeps its
    // mode, so restoring is putting the interior back as that mode has it.
    save() {
      const rig = page.seatView?.() ?? null;
      rig?.vehicle?.setFirstPerson?.(false);
      page.updateSeatPoseVisibility?.();
      return { rig, fov: page.camera.fov };
    },
    restore(saved) {
      if (!saved) return;
      const rig = page.seatView?.() ?? null;
      if (rig && rig === saved.rig) rig.vehicle?.setFirstPerson?.(rig.firstPerson);
      if (page.camera.fov !== saved.fov) {
        page.camera.fov = saved.fov;
        page.camera.updateProjectionMatrix();
      }
      page.updateSeatPoseVisibility?.();
    },
  });

  const selector = new ScoutSelector(cameras, view, () => {
    const seat = localSeat();
    return {
      artPos: !!seat,
      externTrace: !!seat?.externTrace,
      team: page.localTeam() ?? null,
      teamOf,
      now,
    };
  });

  // --- placing ---------------------------------------------------------------------

  /** The nearest thing along the ray: the terrain and the objects, as
   *  `placeScoutCamera` asks them. Water is not one of them. */
  function castFrom(skipOwner) {
    return (origin, direction, range) => {
      const collider = page.collider;
      if (!collider?.cast) return null;
      const water = collider.waterLevel;
      collider.waterLevel = null;
      let hit;
      try {
        hit = collider.cast(origin[0], origin[1], origin[2],
          direction[0], direction[1], direction[2], range, skipOwner);
      } finally {
        collider.waterLevel = water;
      }
      return hit ? hit.t : null;
    };
  }

  /** `guns.onMark`: one pull of a marker weapon (`gun-cycle.js`). */
  function mark(group) {
    if (!isMarkerWeapon(group?.stats)) return null;
    const firer = page.firerOf(group) ?? group.firer ?? null;
    // A replayed gun's rounds are the recording's; its markers are too.
    if (firer == null || String(firer).startsWith('replay:')) return null;
    const local = firer === page.LOCAL_PLAYER;
    // `getFireArmsTransformation`: the player's camera under
    // `fireInCameraDof`, else the weapon's own frame. Only the page's own
    // player has a camera here; anyone else's pull is read off the weapon.
    const source = local && group.stats.fireInCameraDof
      ? page.camera : group.muzzles?.[0] ?? group.node;
    source.updateWorldMatrix(true, false);
    source.getWorldPosition(eye);
    source.getWorldQuaternion(quat);
    dir.set(0, 0, -1).applyQuaternion(quat);
    const owner = page.collider?.statics?.ownerOf?.(group.node) ?? -1;
    const marker = cameras.place({
      weapon: group.node,
      owner: firer,
      team: teamOf(firer),
      eye: [eye.x, eye.y, eye.z],
      forward: [dir.x, dir.y, dir.z],
      cast: castFrom(owner),
      timeToLive: group.stats.projectile?.timeToLive ?? DEFAULT_TIME_TO_LIVE,
      now,
    });
    // The spotter's own client calls for artillery when the marker listed is
    // his (SPOT-5): a miss is nobody's.
    if (local && marker.owner === firer) {
      page.callArtillery?.(table()?.strings?.PLAYER_CALLED_FOR_ARTILLERY ?? 'You called for artillery!',
        RADIO_ARTILLERY_SUPPORT);
    }
    return marker;
  }
  // Called from inside the world's tick: a marker that cannot be placed
  // must not take the tick with it.
  page.guns.onMark = group => {
    try {
      mark(group);
    } catch (error) {
      console.warn('scout marker not placed', error);
    }
  };

  // `fireBarrel` names its round to every camera of the firing seat's PCO
  // (SPOT-11). `onShot` runs before the round exists, so the group is
  // remembered and the round found on the next frame.
  chainOnShot(page.guns, group => {
    if (!page.occupancy?.root || isMarkerWeapon(group?.stats)) return;
    if (page.firerOf(group) !== page.LOCAL_PLAYER) return;
    traceGroup = group;
  });
  function tracePosition() {
    if (traceGroup) {
      const list = page.guns.projectiles;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].group === traceGroup) { traceShot = list[i]; break; }
      }
      traceGroup = null;
    }
    if (!traceShot) return null;
    if (!page.guns.projectiles.includes(traceShot)) {
      traceShot = null;
      return null;
    }
    const p = traceShot.mesh.position;
    return [p.x, p.y, p.z];
  }

  // --- the frame -------------------------------------------------------------------

  /**
   * Once a frame, after the seat's camera has been placed: `ticks` world
   * ticks have run (the markers' clock), `dt` seconds of the page's.
   */
  function frame(ticks, dt) {
    now += ticks / 30;
    clock += dt;
    cameras.step(now);

    const key = localSeatKey();
    if (key !== seatKey) {
      // The seat's camera is no longer the player's (SPOT-10: off does
      // nothing outside an `artPos` seat, and nothing follows him out).
      if (view.on) {
        const rig = view.saved?.rig;
        if (rig && rig === page.seatView?.()) rig.vehicle?.setFirstPerson?.(rig.firstPerson);
      }
      selector.leaveSeat();
      seatKey = key;
      altWas = page.altFireHeld();
      traceShot = null;
      traceGroup = null;
    }
    const seat = localSeat();

    // The press of alt-fire (SPOT-8). The seat's own alt-fire weapon is not
    // kept from it here; no `artPos` seat in the surveyed data has one.
    const held = !!page.altFireHeld();
    if (held && !altWas) selector.toggle();
    altWas = held;

    // The gunners' line for a new teammate marker (SPOT-5).
    if (seat) {
      const newest = teamMarkers(cameras, page.localTeam(), now)[0] ?? null;
      if (newest && newest.id !== announced) {
        announced = newest.id;
        page.info?.(calledLine(nameOf(newest.owner), cameras.remaining(newest, now),
          table()?.strings), newest.team ?? 0);
      }
    }

    seconds = selector.frame();
    if (selector.fades !== fadesSeen) {
      fadesSeen = selector.fades;
      fadeAt = clock;
    }

    if (view.on) {
      // One `getTransformation` a rendered frame (SPOT-11).
      const pose = view.step(tracePosition());
      page.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      up.copy(page.camera.up);
      page.camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
      page.camera.lookAt(target.set(pose.target[0], pose.target[1], pose.target[2]));
      page.camera.up.copy(up);
      page.camera.updateMatrixWorld(true);
      page.guns.firstPerson = false;
    }
  }

  /** `c_PINextItem` (+1) / `c_PIPrevItem` (-1) from a seat. False when the
   *  gate is shut and the key keeps its usual meaning (SPOT-9). */
  function step(direction) {
    if (!page.occupancy?.root) return false;
    return selector.step(direction);
  }

  /** A new level: nothing of the old one's is left. */
  function reset() {
    selector.leaveSeat();
    cameras.clear();
    announced = null;
    traceShot = null;
    traceGroup = null;
    seatKey = '';
  }

  // --- the minimap -------------------------------------------------------------------

  /** The gunner's team's live markers, only in an `artPos` seat. */
  function wedges() {
    return localSeat() ? teamMarkers(cameras, page.localTeam(), now) : [];
  }

  /** Changes whenever the paint would. */
  function mapKey() {
    const list = wedges();
    if (!list.length) return '';
    const blink = wedgeBlinkAlpha(clock, table()?.cameraBlink);
    return `w${list.map(m => m.id).join('.')}|${selector.selected ?? ''}|${blink}|${picture('camview') ? 1 : 0}`;
  }

  /**
   * Each marker as `artillery_minimap_camview`, centred on its eye and
   * opening along its gaze; the one selected blinks. `projectToArt` and
   * `toPx` are the surface's own; `rot` is the map's turn.
   */
  function drawMap(ctx, projectToArt, toPx, sc, rot = 0) {
    const img = picture('camview');
    if (!img) return;
    for (const marker of wedges()) {
      const at = marker.matrix.position;
      const p = projectToArt(at[0], at[2]);
      if (!p) continue;
      const q = toPx(p);
      const alpha = marker.id === selector.selected
        ? wedgeBlinkAlpha(clock, table()?.cameraBlink) : 1;
      if (alpha <= 0) continue;
      // The picture's wedge opens to its left; the screen angle of a gaze is
      // the surfaces' own `atan2(x, -z)`.
      const fwd = marker.matrix.forward;
      const angle = Math.atan2(fwd[0], -fwd[2]) + Math.PI / 2 + rot;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(q.x, q.y);
      ctx.rotate(angle);
      ctx.drawImage(img, -img.width * sc / 2, -img.height * sc / 2, img.width * sc, img.height * sc);
      ctx.restore();
    }
  }

  // --- the HUD -----------------------------------------------------------------------

  /** What the HUD shows this frame, for the paint and the test hook. */
  function hud() {
    const seat = localSeat();
    const available = seat ? teamMarkers(cameras, page.localTeam(), now).length > 0 : false;
    const lineMarker = selector.line != null ? cameras.byId(selector.line) : null;
    return {
      icon: available ? scoutIconFrame(clock) : 0,
      line: lineMarker && seconds > 0 ? scoutLine(nameOf(lineMarker.owner), table()?.strings) : null,
      seconds: lineMarker ? seconds : 0,
      viewing: view.on,
      fade: fadeAlpha(clock - fadeAt),
    };
  }

  function paint(stageW, stageH) {
    if (!canvas || !stageW || !stageH) return;
    const h = hud();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const sig = `${h.icon}|${h.line}|${h.seconds}|${h.viewing}|${Math.round(h.fade * 100)}`
      + `|${stageW}x${stageH}@${dpr}|${images.size}|${page.sprite?.('binocular') ? 1 : 0}`;
    if (sig === lastSig) return;
    lastSig = sig;
    const cw = Math.round(stageW * dpr);
    const ch = Math.round(stageH * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(stageW / VIRTUAL_W * dpr, 0, 0, stageH / VIRTUAL_H * dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (h.fade > 0) {
      ctx.globalAlpha = h.fade;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
      ctx.globalAlpha = 1;
    }
    if (h.viewing) {
      const binocular = picture('binocular') ?? page.sprite?.('binocular');
      if (binocular) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(binocular, ...BINOCULAR_RECT);
        ctx.imageSmoothingEnabled = false;
      }
    }
    if (h.icon) {
      const img = picture(`icon_scout_${h.icon}`);
      if (img) ctx.drawImage(img, SCOUT_ICON_AT[0], SCOUT_ICON_AT[1]);
    }
    if (h.line) {
      const width = page.text?.(ctx, h.line, SCOUT_BOX_AT[0], SCOUT_BOX_AT[1]) ?? 0;
      page.text?.(ctx, String(h.seconds), SCOUT_BOX_AT[0] + width + 8, SCOUT_BOX_AT[1]);
    }
  }

  /** For the test hooks: the list, the selector, the view and the HUD. */
  function state() {
    const seat = localSeat();
    return {
      now,
      seat: seat ? { seat: seat.seat, externTrace: seat.externTrace } : null,
      tableReady: !!table(),
      gate: selector.gate(),
      markers: cameras.list.map(m => ({
        id: m.id, owner: m.owner, team: m.team, hit: m.hit,
        eye: m.matrix.position, forward: m.matrix.forward, target: m.target,
        remaining: cameras.remaining(m, now), removeAt: m.removeAt,
      })),
      selected: selector.selected,
      viewing: selector.viewing,
      view: view.markerId,
      lookAt: view.lookAt ? [...view.lookAt] : null,
      trace: traceShot ? traceShot.mesh.position.toArray() : null,
      hud: hud(),
      wedges: wedges().map(m => m.id),
    };
  }

  return {
    cameras, selector, view, mark, frame, step, reset, paint, state,
    mapKey, drawMap, table,
  };
}
