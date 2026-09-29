// The creator view's panel (features/replay-creator-view), docked on the right
// where the replay log and the comments dock: three tabs.
//
//   PLAYER  the followed man's round (replay-dossier.js): his tally, then his
//           streaks, longest shots, multi-kills, vehicles, kills, deaths and
//           weapons, each row a jump to its moment with the lead-in, a bullet
//           cam where a round is known, and a range set round it;
//   CAMERA  bullet time, what the camera does after a hit, the lens, the
//           frame guides and the camera track's keys;
//   CLIPS   the in and out points, playing and recording the range, and the
//           clips kept for this recording.
//
// DOM only: every action is the creator's (replay-creator.js).

import { recorderMime } from './replay-clip.js';

/** Seconds a jump to a moment starts before it: the choices (the creator's
 *  default is 3). */
export const LEAD_INS = Object.freeze([2, 3, 5]);
/** The field of view's range, degrees. */
export const FOV_RANGE = Object.freeze([12, 110]);

/** A recording time as the bar shows it: `2:41.3`. */
export function fmt(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

const ICON = {
  bullet: '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.7"/><path d="M8 .8v3.1M8 12.1v3.1M.8 8h3.1M12.1 8h3.1" stroke="currentColor" stroke-width="1.4"/>',
  clip: '<path d="M3 2.5v11M13 2.5v11" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 8h4.8" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 5.6 3.4 8l2.2 2.4M10.4 5.6 12.6 8l-2.2 2.4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  play: '<path d="M4.5 2.5v11l9-5.5z"/>',
  rec: '<circle cx="8" cy="8" r="4.6"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6"/>',
  key: '<path d="M8 1.6 14.4 8 8 14.4 1.6 8z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  collapse: '<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};
const svg = name => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[name] ?? ''}</svg>`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A click that throws is a warning, never a panel that stops answering. */
function act(what, fn) {
  return e => {
    e?.stopPropagation?.();
    try {
      fn(e);
    } catch (error) {
      console.warn(`creator panel: ${what} threw`, error);
    }
  };
}

const teamClass = team => (team === 1 ? 't1' : team === 2 ? 't2' : '');
const metres = d => (Number.isFinite(d) ? `${Math.round(d)} m` : '');
const clock = t => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class CreatorPanel {
  constructor(creator) {
    this.creator = creator;
    this.tab = 'player';
    this.openSections = new Map([['streaks', true], ['longest', true], ['multis', true]]);
    this.shownKey = '';
    injectStyle();
    const panel = el('div', 'rp-panel rc-panel');
    const head = el('div', 'rp-panel-head');
    head.append(el('span', '', 'Creator'));
    const close = el('button', 'rp-btn');
    close.type = 'button';
    close.title = 'Close the creator view (V)';
    close.innerHTML = svg('close');
    close.addEventListener('click', act('closing', () => creator.toggle(false)));
    head.append(close);
    const tabs = el('div', 'rc-tabs');
    this.tabBtns = {};
    for (const [id, label] of [['player', 'Player'], ['camera', 'Camera'], ['clips', 'Clips']]) {
      const b = el('button', 'rp-btn', label);
      b.type = 'button';
      b.addEventListener('click', act('a tab', () => this.setTab(id)));
      this.tabBtns[id] = b;
      tabs.append(b);
    }
    this.body = el('div', 'rc-body');
    panel.append(head, tabs, this.body);
    this.el = panel;
    this.sections = { player: el('section', 'rc-tab'), camera: el('section', 'rc-tab'), clips: el('section', 'rc-tab') };
    this.body.append(this.sections.player, this.sections.camera, this.sections.clips);
    this.buildCamera();
    this.buildClips();
    this.setTab('player');
  }

  show() {
    this.refresh(true);
  }

  setTab(id) {
    this.tab = id;
    for (const [name, b] of Object.entries(this.tabBtns)) b.classList.toggle('on', name === id);
    for (const [name, s] of Object.entries(this.sections)) s.hidden = name !== id;
    this.refresh(true);
  }

  /** Redraw what shows: the player tab when the man or his round changed (or
   *  `force`), the others' values every tick. */
  refresh(force = false) {
    if (!this.creator.on) return;
    if (this.tab === 'player') this.renderPlayer(force);
    else if (this.tab === 'camera') this.syncCamera(force);
    else this.syncClips(force);
  }

  // --- small controls ------------------------------------------------------------------------

  /** A row of choices, one on: `[[value, label]...]`. */
  segment(choices, get, set) {
    const wrap = el('div', 'rp-seg rc-seg');
    const buttons = choices.map(([value, label]) => {
      const b = el('button', 'rp-btn', label);
      b.type = 'button';
      b.addEventListener('click', act(label, () => {
        set(value);
        sync();
      }));
      wrap.append(b);
      return [value, b];
    });
    const sync = () => {
      const now = get();
      for (const [value, b] of buttons) b.classList.toggle('on', value === now);
    };
    wrap.sync = sync;
    sync();
    return wrap;
  }

  button(label, icon, title, fn, className = '') {
    const b = el('button', `rp-btn ${className}`.trim());
    b.type = 'button';
    b.title = title;
    b.innerHTML = `${icon ? svg(icon) : ''}<span>${label}</span>`;
    b.addEventListener('click', act(title, fn));
    return b;
  }

  group(title, ...children) {
    const g = el('div', 'rc-group');
    g.append(el('h4', '', title), ...children);
    return g;
  }

  leadInControl() {
    const creator = this.creator;
    return this.segment(LEAD_INS.map(s => [s, `${s} s`]), () => creator.prefs.leadIn, v => creator.setPref('leadIn', v));
  }

  // --- the player tab ------------------------------------------------------------------------

  renderPlayer(force) {
    const creator = this.creator;
    const player = creator.player;
    const pid = creator.subjectPid();
    const key = `${pid}|${player.followPid}`;
    if (!force && key === this.shownKey) return;
    this.shownKey = key;
    const root = this.sections.player;
    root.textContent = '';
    const d = creator.dossier(pid);
    if (!d) {
      root.append(el('p', 'rc-none', 'Follow a player to see his round: click him in the view, or pick him from the Players list.'));
      return;
    }
    const s = d.summary;
    const who = el('div', 'rc-who');
    const name = el('b', teamClass(d.team), d.name);
    const side = el('span', '', d.team === 1 ? 'Axis' : d.team === 2 ? 'Allies' : '');
    who.append(name, side);
    // The camera went elsewhere (a bullet cam's victim): back to him.
    if (pid !== player.followPid) who.append(this.button('Follow', null, 'Follow him again', () => creator.followPlayer(pid), 'rc-next rc-back'));
    who.append(this.button('Next round', 'bullet', 'Chase his next round (5)', () => creator.chaseNext(), 'rc-next'));
    const tiles = el('div', 'rc-tiles');
    for (const [value, label] of [[s.kills, 'kills'], [s.deaths, 'deaths'], [s.bestStreak, 'best streak'], [metres(s.longest) || '-', 'longest']]) {
      const tile = el('div', 'rc-tile');
      tile.append(el('b', '', String(value)), el('span', '', label));
      tiles.append(tile);
    }
    const more = [
      `K/D ${s.ratio.toFixed(2)}`,
      s.vehicles ? `${s.vehicles} vehicle${s.vehicles === 1 ? '' : 's'}` : null,
      s.rounds ? `${s.rounds} rounds fired` : null,
      s.teamkills ? `${s.teamkills} team kill${s.teamkills === 1 ? '' : 's'}` : null,
      s.favourite ? `${s.favourite.name} x${s.favourite.kills}` : null,
    ].filter(Boolean).join(' · ');
    const lead = el('div', 'rc-leadin');
    lead.append(el('span', '', 'Lead-in'), this.leadInControl());
    root.append(who, tiles, el('p', 'rc-more', more), lead);

    const row = (t, title, detail, { num = null, kill = null, t1 = t, cls = '' } = {}) => {
      const r = el('div', `rc-row ${cls}`.trim());
      r.tabIndex = 0;
      r.setAttribute('role', 'button');
      r.title = `Watch from ${creator.prefs.leadIn} s before`;
      const time = el('time', '', clock(t));
      const main = el('span', 'rc-row-main');
      main.append(el('b', '', title));
      if (detail) main.append(el('small', '', detail));
      const tail = el('span', 'rc-row-act');
      if (num !== null) tail.append(el('em', '', num));
      if (kill?.round?.f) {
        tail.append(this.button('', 'bullet', 'Bullet cam: ride the round that killed him', () => creator.bulletCam(kill), 'rc-ico'));
      }
      tail.append(this.button('', 'clip', 'Set the range round it', () => creator.clipAround(t, t1, pid), 'rc-ico'));
      r.append(time, main, tail);
      const go = act('a moment', () => creator.goTo(t, pid));
      r.addEventListener('click', go);
      r.addEventListener('keydown', e => {
        if (e.key === 'Enter') go(e);
      });
      return r;
    };
    const section = (id, title, items, render, note = null, reel = null) => {
      const box = el('details', 'rc-sec');
      box.open = this.openSections.get(id) ?? false;
      box.addEventListener('toggle', () => this.openSections.set(id, box.open));
      const sum = el('summary');
      sum.append(el('span', '', title), el('i', '', String(items.length)));
      box.append(sum);
      if (note) box.append(el('p', 'rc-note', note));
      // Every ride of the section, one after another.
      const rides = reel ? items.filter(reel) : [];
      if (rides.length > 1) {
        const all = this.button(`Ride all ${rides.length}`, 'bullet', 'The bullet cam on each in turn', () => creator.playAll(rides), 'rc-small rc-all');
        box.append(all);
      }
      if (!items.length) box.append(el('p', 'rc-none', 'None'));
      for (const item of items) box.append(render(item));
      root.append(box);
    };
    const killDetail = k => [k.victimName, k.weaponName ? `[${k.weaponName}]` : null, k.from === 'vehicle' ? 'from a vehicle' : null]
      .filter(Boolean).join(' ');

    section('streaks', 'Streaks', d.streaks, st => row(st.t0, `${st.n} kills`,
      [`${clock(st.t0)}-${clock(st.t1)}`, st.end ? `ended by ${st.end.byName ?? 'a fall'}${st.end.weapon ? ` [${st.end.weapon}]` : ''}` : 'never ended']
        .join(' · '), { num: `x${st.n}`, t1: st.t1 }));
    section('longest', 'Longest shots', d.longest, k => row(k.t, metres(k.distance), killDetail(k), { kill: k, cls: 'long' }), null,
      k => k.round?.f);
    section('multis', 'Multi-kills', d.multis, m => row(m.t0, m.label,
      `${m.n} kills in ${(m.t1 - m.t0).toFixed(1)} s`, { num: `x${m.n}`, t1: m.t1 }));
    section('vehicles', 'Vehicles destroyed', d.vehicles, v => row(v.t, v.name, v.crew ? `${v.crew} aboard` : ''));
    section('kills', 'Kills', d.kills, k => row(k.t, k.victimName, [k.weaponName ? `[${k.weaponName}]` : null, metres(k.distance),
      k.teamkill ? 'team kill' : null].filter(Boolean).join(' '), { kill: k, cls: k.teamkill ? 'tk' : '' }), null, k => k.round?.f && !k.teamkill);
    const nemesis = s.nemesis ? `Killed most by ${s.nemesis.name} (${s.nemesis.kills})` : null;
    // A death's own round, seen from the man who fired it.
    const deathRound = x => {
      const found = x.killer !== null && x.killer !== undefined ? creator.killAt(x.t, pid) : null;
      return found?.round ? { round: found.round, t: x.t, victim: pid, kill: found.kill } : null;
    };
    section('deaths', 'Deaths', d.deaths, x => row(x.t, x.killerName ?? (x.kind === 'death' ? 'His own death' : 'Unknown'),
      [x.weaponName ? `[${x.weaponName}]` : null, metres(x.distance), x.kind === 'teamkill' ? 'team kill' : null].filter(Boolean).join(' '),
      { cls: 'death', kill: deathRound(x) }), nemesis);
    section('weapons', 'Weapons', d.weapons, w => {
      const r = el('div', 'rc-row static');
      const main = el('span', 'rc-row-main');
      main.append(el('b', '', w.name), el('small', '', w.longest ? `longest ${metres(w.longest)}` : ''));
      const tail = el('span', 'rc-row-act');
      tail.append(el('em', '', `x${w.kills}`));
      r.append(el('time', '', ''), main, tail);
      return r;
    });
  }

  // --- the camera tab ------------------------------------------------------------------------

  buildCamera() {
    const creator = this.creator;
    const root = this.sections.camera;
    const pace = this.segment([['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong'], ['extreme', 'Extreme']],
      () => creator.prefs.pace, v => creator.setPref('pace', v));
    const after = this.segment([['victim', 'Victim'], ['shooter', 'Shooter'], ['stay', 'Stay']],
      () => creator.prefs.afterHit, v => creator.setPref('afterHit', v));
    const next = this.button('Chase the next round', 'bullet', 'Chase the followed player\'s next round (5)', () => creator.chaseNext(), 'rc-wide');
    root.append(
      this.group('Bullet time', pace),
      this.group('After the hit', after),
      next,
      el('p', 'rc-note', 'Click a round in the view to ride it. Drag while it flies, or paused, to swing round it.'),
    );

    // The lens.
    const fov = el('input');
    fov.type = 'range';
    fov.min = String(FOV_RANGE[0]);
    fov.max = String(FOV_RANGE[1]);
    fov.step = '1';
    const fovOut = el('output');
    fov.addEventListener('input', act('the field of view', () => creator.setFov(Number(fov.value))));
    const fovAuto = this.button('Auto', null, 'The page\'s own lens', () => creator.setFov(null), 'rc-small');
    const roll = el('input');
    roll.type = 'range';
    roll.min = '-30';
    roll.max = '30';
    roll.step = '0.5';
    const rollOut = el('output');
    roll.addEventListener('input', act('the roll', () => creator.setRoll(Number(roll.value))));
    const level = this.button('Level', null, 'No roll', () => creator.setRoll(0), 'rc-small');
    const slider = (label, input, out, reset) => {
      const line = el('label', 'rc-slider');
      line.append(el('span', '', label), input, out, reset);
      return line;
    };
    root.append(this.group('Lens', slider('Field of view', fov, fovOut, fovAuto), slider('Roll', roll, rollOut, level)));
    this.lensInputs = { fov, fovOut, roll, rollOut };

    // The frame.
    const frame = this.segment([['none', 'None'], ['239', '2.39:1'], ['185', '1.85:1'], ['916', '9:16']],
      () => creator.prefs.frame, v => creator.setPref('frame', v));
    const thirds = el('label', 'rc-check');
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', act('the thirds', () => creator.setPref('thirds', box.checked)));
    thirds.append(box, el('span', '', 'Thirds grid'));
    root.append(this.group('Frame', frame, thirds));
    this.frameInputs = { thirds: box };

    // The camera track.
    const keyBtn = this.button('Keep view', 'key', 'Keep the view on screen as a key at the playhead (K)', () => creator.addKey());
    const playBtn = this.button('Fly', 'play', 'Fly the camera along the keys from the first', () => creator.playTrack(), 'rc-fly');
    const clearBtn = this.button('Clear', null, 'Take every key away', () => creator.clearKeys());
    const row = el('div', 'rc-line');
    row.append(keyBtn, playBtn, clearBtn);
    this.keyList = el('div', 'rc-keys');
    root.append(this.group('Camera track', row, this.keyList,
      el('p', 'rc-note', 'Keep a view at each moment (K); Fly takes the camera through them, time for time.')));
    this.cameraSegs = [pace, after, frame];
  }

  syncCamera(force) {
    const creator = this.creator;
    for (const seg of this.cameraSegs) seg.sync();
    const { fov, fovOut, roll, rollOut } = this.lensInputs;
    const cam = creator.ctx.camera;
    const f = creator.lens.fov ?? cam.fov;
    if (document.activeElement !== fov) fov.value = String(Math.round(f));
    fovOut.textContent = `${Math.round(f)}°${creator.lens.fov === null ? ' auto' : ''}`;
    if (document.activeElement !== roll) roll.value = String(creator.lens.roll);
    rollOut.textContent = `${creator.lens.roll.toFixed(1)}°`;
    this.frameInputs.thirds.checked = creator.prefs.thirds;
    const sig = creator.keys.map(k => k.t).join(',');
    if (force || sig !== this.keySig) {
      this.keySig = sig;
      this.keyList.textContent = '';
      creator.keys.forEach((key, i) => {
        const r = el('div', 'rc-keyrow');
        const go = el('button', 'rc-keygo', `${i + 1}  ${fmt(key.t)}${Number.isFinite(key.fov) ? `  ${Math.round(key.fov)}°` : ''}`);
        go.type = 'button';
        go.title = 'Go to this key';
        go.addEventListener('click', act('a key', () => creator.player.seek(key.t)));
        r.append(go, this.button('', 'close', 'Take this key away', () => creator.removeKey(key), 'rc-ico'));
        this.keyList.append(r);
      });
      if (!creator.keys.length) this.keyList.append(el('p', 'rc-none', 'No keys yet'));
    }
  }

  // --- the clips tab -------------------------------------------------------------------------

  buildClips() {
    const creator = this.creator;
    const root = this.sections.clips;
    this.inText = el('time', 'rc-point');
    this.outText = el('time', 'rc-point');
    const setIn = this.button('In', null, 'In point at the playhead (I)', () => creator.setIn(), 'rc-small');
    const setOut = this.button('Out', null, 'Out point at the playhead (O)', () => creator.setOut(), 'rc-small');
    const points = el('div', 'rc-points');
    points.append(setIn, this.inText, el('span', 'rc-dash', 'to'), setOut, this.outText);
    this.playBtn = this.button('Play', 'play', 'Play the range (P)', () => creator.playRange());
    this.loopBtn = this.button('Loop', null, 'Round again at the out point', () => creator.toggleLoop());
    const clear = this.button('Clear', null, 'Clear the range', () => creator.clearRange());
    const line = el('div', 'rc-line');
    line.append(this.playBtn, this.loopBtn, clear);
    this.recBtn = this.button('Record', 'rec', 'Record the range to a video file', () => {
      if (creator.recorder) creator.stopRecording(false);
      else creator.record();
    }, 'rc-rec');
    const save = this.button('Keep as a clip', null, 'Keep the range in this recording\'s clips', () => creator.saveClip());
    const line2 = el('div', 'rc-line');
    line2.append(this.recBtn, save);
    this.recNote = el('p', 'rc-note');
    root.append(this.group('Lead-in', this.leadInControl()),
      this.group('Range', points, line, line2, this.recNote));
    this.clipList = el('div', 'rc-clips');
    root.append(this.group('Clips', this.clipList));
  }

  syncClips(force) {
    const creator = this.creator;
    const { in: t0, out: t1, loop } = creator.range;
    this.inText.textContent = t0 === null ? '--' : fmt(t0);
    this.outText.textContent = t1 === null ? '--' : fmt(t1);
    this.loopBtn.classList.toggle('on', loop);
    const recording = Boolean(creator.recorder);
    this.recBtn.classList.toggle('on', recording);
    this.recBtn.querySelector('span').textContent = recording ? 'Stop' : 'Record';
    if (force) {
      const mime = recorderMime(true);
      this.recNote.textContent = mime
        ? `${/mp4/.test(mime) ? 'MP4' : 'WebM'} of the 3D view alone, no chrome, with the game's sound. It records as it plays: keep other windows quiet.`
        : 'This browser cannot record video; capture the view with OBS instead.';
    }
    const sig = creator.clips.map(c => `${c.name}|${c.in}|${c.out}`).join(';');
    if (!force && sig === this.clipSig) return;
    this.clipSig = sig;
    this.clipList.textContent = '';
    if (!creator.clips.length) this.clipList.append(el('p', 'rc-none', 'None kept yet'));
    for (const clip of creator.clips) {
      const r = el('div', 'rc-clip');
      const name = el('input', 'rc-clip-name');
      name.value = clip.name;
      name.title = 'Rename';
      name.addEventListener('change', act('renaming', () => creator.renameClip(clip, name.value)));
      name.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') name.blur();
      });
      const span = el('time', '', `${fmt(clip.in)}-${fmt(clip.out)}`);
      const acts = el('span', 'rc-row-act');
      acts.append(
        this.button('', 'play', 'Play this clip', () => creator.useClip(clip), 'rc-ico'),
        this.button('', 'rec', 'Record this clip', () => {
          creator.useClip(clip, false);
          creator.record();
        }, 'rc-ico'),
        this.button('', 'close', 'Forget this clip', () => creator.removeClip(clip), 'rc-ico'),
      );
      r.append(name, span, acts);
      this.clipList.append(r);
    }
  }
}

// --- the look ------------------------------------------------------------------------------
//
// The replay chrome's own (replay-ui.js): its plates, khaki strips, olive
// edges, gold for what stands out, the message log's team colours.

const STYLE = `
.rp-root .rc-btn.on { background: var(--rp-gold); border-color: var(--rp-gold); color: var(--rp-khaki-ink); }
.rp-input.rc-over { cursor: pointer; }

/* The panel, where the replay log and the comments dock: one at a time. */
.rc-panel { position: absolute; right: 12px; top: var(--rp-log-top); bottom: calc(var(--rp-bar-h) + 22px); width: min(372px, calc(100% - 24px));
  display: none; flex-direction: column; min-height: 0; font: 12px/1.4 var(--rp-font); }
.rp-root.rc-on:not(.log-open):not(.rs-open) .rc-panel { display: flex; }
.rc-tabs { display: flex; border-bottom: 1px solid var(--rp-edge); }
.rc-tabs .rp-btn { flex: 1; height: 30px; border-radius: 0; }
.rc-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 0 10px; scrollbar-width: thin;
  scrollbar-color: rgba(200, 194, 152, .38) transparent; }
.rc-tab[hidden] { display: none; }
.rc-none { margin: 4px 12px; color: var(--rp-muted); font-size: 11px; opacity: .75; }
.rc-note { margin: 4px 12px 2px; color: var(--rp-muted); font-size: 11px; line-height: 1.4; }
.rc-group { padding: 4px 12px 8px; }
.rc-group h4 { margin: 4px 0 5px; font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase; color: var(--rp-muted); }
.rc-group .rc-note { margin: 5px 0 0; }
.rc-seg { display: flex; }
.rc-seg .rp-btn { flex: 1; height: 26px; min-width: 0; padding: 0 5px; font-size: 10px; }
.rc-line { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.rc-line .rp-btn, .rc-wide { border-color: var(--rp-edge); }
.rc-wide { display: flex; width: calc(100% - 24px); margin: 2px 12px 0; height: 32px; border-color: var(--rp-gold); color: var(--rp-gold); }
.rc-panel .rp-btn svg { width: 14px; height: 14px; }
.rc-small { height: 24px; min-width: 0; padding: 0 7px; font-size: 10px; border-color: var(--rp-edge); }
.rc-ico { height: 24px; min-width: 24px; padding: 0 4px; color: var(--rp-muted); }
.rc-ico:hover { color: var(--rp-ink); }
.rc-rec svg { color: #ff5b4d; }
.rc-rec.on { background: #c9352a; border-color: #ff7a6e; color: #fff; }
.rc-rec.on svg { color: #fff; animation: rc-blink 1s steps(2, start) infinite; }
@keyframes rc-blink { to { visibility: hidden; } }

/* The player tab. */
.rc-who { display: flex; align-items: center; gap: 8px; padding: 0 12px 6px; min-width: 0; }
.rc-who b { font: 800 16px/1.2 var(--rp-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-who b.t1 { color: #ff8b8b; } .rc-who b.t2 { color: #9ab8ff; }
.rc-who span { color: var(--rp-muted); font: 700 10px var(--rp-font); letter-spacing: .12em; text-transform: uppercase; }
.rc-who .rc-next { margin-left: auto; height: 26px; border-color: var(--rp-gold); color: var(--rp-gold); font-size: 10px; }
.rc-who .rc-back + .rc-next { margin-left: 0; }
.rc-who .rc-back { border-color: var(--rp-edge); color: var(--rp-ink); }
.rc-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; margin: 0 12px; border: 1px solid var(--rp-edge);
  border-radius: 6px; overflow: hidden; background: var(--rp-edge); }
.rc-tile { display: flex; flex-direction: column; align-items: center; padding: 6px 2px 5px; background: rgba(12, 12, 10, .55); }
.rc-tile b { font: 800 19px/1.1 var(--rp-font); color: var(--rp-ink); }
.rc-tile:nth-child(3) b, .rc-tile:nth-child(4) b { color: var(--rp-gold); text-shadow: 0 0 10px rgba(232, 195, 90, .35); }
.rc-tile span { color: var(--rp-muted); font: 700 9px var(--rp-font); letter-spacing: .1em; text-transform: uppercase; }
.rc-more { margin: 6px 12px 4px; color: var(--rp-muted); font-size: 11px; }
.rc-leadin { display: flex; align-items: center; gap: 10px; padding: 2px 12px 6px; }
.rc-leadin > span { color: var(--rp-muted); font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase; }
.rc-leadin .rc-seg { flex: 1; }
.rc-sec { border-top: 1px solid rgba(200, 194, 152, .14); }
.rc-sec summary { display: flex; align-items: center; gap: 8px; padding: 7px 12px 5px; cursor: pointer; list-style: none;
  font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase; color: var(--rp-khaki); }
.rc-sec summary::-webkit-details-marker { display: none; }
.rc-sec summary::before { content: ''; width: 0; height: 0; border: 4px solid transparent; border-left: 5px solid currentColor;
  border-right: 0; transition: transform .15s; }
.rc-sec[open] summary::before { transform: rotate(90deg); }
.rc-sec summary i { margin-left: auto; min-width: 18px; padding: 0 5px; border-radius: 8px; background: rgba(255, 255, 255, .1);
  color: var(--rp-muted); font: 700 10px/16px var(--rp-mono); font-style: normal; text-align: center; letter-spacing: 0; }
.rc-row { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; column-gap: 8px; padding: 3px 6px 3px 12px;
  cursor: pointer; outline: none; }
.rc-row:hover, .rc-row:focus-visible { background: rgba(255, 255, 255, .07); }
.rc-row.static { cursor: default; }
.rc-row time { color: var(--rp-muted); font: 11px var(--rp-mono); font-variant-numeric: tabular-nums; }
.rc-row-main { min-width: 0; }
.rc-row-main b { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-row-main small { display: block; color: var(--rp-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-row.long .rc-row-main b { color: var(--rp-gold); font: 800 14px/1.2 var(--rp-mono); }
.rc-row.death .rc-row-main b { color: #ff9a9a; }
.rc-row.tk { opacity: .6; }
.rc-row-act { display: flex; align-items: center; gap: 1px; }
.rc-row-act em { margin-right: 4px; color: var(--rp-gold); font: 800 12px var(--rp-mono); font-style: normal; }
.rc-all { margin: 0 12px 4px; border-color: var(--rp-gold); color: var(--rp-gold); }

/* The camera tab. */
.rc-slider { display: grid; grid-template-columns: 82px minmax(0, 1fr) 54px auto; align-items: center; gap: 8px; margin: 4px 0;
  color: var(--rp-muted); font: 700 10px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; }
.rc-slider input { width: 100%; accent-color: var(--rp-gold); margin: 0; }
.rc-slider output { color: var(--rp-ink); font: 12px var(--rp-mono); text-align: right; letter-spacing: 0; text-transform: none; }
.rc-check { display: inline-flex; align-items: center; gap: 6px; margin-top: 7px; color: var(--rp-muted); cursor: pointer; }
.rc-check input { accent-color: var(--rp-gold); margin: 0; }
.rc-keys { display: flex; flex-direction: column; margin-top: 6px; }
.rc-keyrow { display: flex; align-items: center; }
.rc-keygo { flex: 1; appearance: none; border: 0; background: none; padding: 3px 0; text-align: left; color: var(--rp-ink);
  font: 12px var(--rp-mono); white-space: pre; cursor: pointer; }
.rc-keygo:hover { color: var(--rp-gold); }

/* The clips tab. */
.rc-points { display: flex; align-items: center; gap: 6px; }
.rc-point { min-width: 52px; font: 13px var(--rp-mono); color: var(--rp-ink); }
.rc-dash { color: var(--rp-muted); font-size: 11px; }
.rc-clips { display: flex; flex-direction: column; gap: 2px; }
.rc-clip { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 6px; }
.rc-clip-name { min-width: 0; padding: 3px 5px; border: 1px solid transparent; border-radius: 4px; background: none; color: var(--rp-ink);
  font: 700 12px var(--rp-font); }
.rc-clip-name:hover, .rc-clip-name:focus { border-color: var(--rp-edge); background: rgba(0, 0, 0, .25); outline: none; }
.rc-clip time { color: var(--rp-muted); font: 11px var(--rp-mono); white-space: nowrap; }

/* The range and the camera keys on the timeline. */
.rc-range { position: absolute; top: -3px; bottom: -3px; background: rgba(232, 195, 90, .26); border-radius: 2px; pointer-events: none; }
.rc-range[hidden] { display: none; }
.rc-range i { position: absolute; top: -4px; bottom: -4px; width: 3px; background: var(--rp-gold); border-radius: 2px; }
.rc-range i[hidden] { display: none; }
.rc-range-in { left: -1px; } .rc-range-out { right: -1px; }
.rc-keymarks { position: absolute; left: 0; right: 0; top: 1px; height: 16px; pointer-events: none; }
.rc-key { position: absolute; bottom: 2px; width: 9px; height: 9px; margin-left: -4.5px; padding: 0; border: 1.5px solid var(--rp-gold);
  background: rgba(20, 20, 17, .9); transform: rotate(45deg); cursor: pointer; pointer-events: auto; }
.rc-key:hover { background: var(--rp-gold); }
.rp-root:not(.rc-on) .rc-keymarks, .rp-root:not(.rc-on) .rc-range { display: none; }

/* What the camera is doing, over the view. */
.rc-plate { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
  max-width: calc(100% - 24px); padding: 3px 4px 3px 10px; pointer-events: auto; border-radius: 6px; background: var(--rp-plate-deep);
  border: 1px solid var(--rp-gold); box-shadow: 0 0 0 1px rgba(232, 195, 90, .25), 0 6px 20px rgba(0, 0, 0, .45); }
.rc-plate[hidden] { display: none; }
.rc-plate-text { color: var(--rp-gold); font: 800 10px/1.5 var(--rp-font); letter-spacing: .12em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-plate-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--rp-gold); flex: none; }
.rc-plate.k-flying .rc-plate-dot { animation: rc-pulse .5s ease-in-out infinite alternate; }
.rc-plate.k-rec { border-color: #ff7a6e; }
.rc-plate.k-rec .rc-plate-text { color: #ffb3ab; }
.rc-plate.k-rec .rc-plate-dot { background: #ff4b3e; animation: rc-pulse .6s ease-in-out infinite alternate; }
.rc-plate .rp-btn { height: 22px; }
@keyframes rc-pulse { from { opacity: .35; transform: scale(.75); } to { opacity: 1; transform: scale(1.15); } }

/* The ring and name over what the pointer can pick. */
.rc-reticle { position: absolute; left: 0; top: 0; display: none; border-radius: 50%; pointer-events: none; color: var(--rp-ink);
  border: 1.5px solid currentColor; box-shadow: 0 0 0 1px rgba(0, 0, 0, .55), 0 0 14px -2px currentColor; will-change: transform; }
.rc-reticle.show { display: block; }
.rc-reticle.t1 { color: #ff7d7d; } .rc-reticle.t2 { color: #8fb0ff; } .rc-reticle.k-round { color: var(--rp-fire); border-style: dashed; }
.rc-reticle-label { position: absolute; left: 50%; top: calc(100% + 5px); transform: translateX(-50%); padding: 1px 7px; border-radius: 3px;
  background: rgba(10, 10, 9, .78); border: 1px solid rgba(255, 255, 255, .12); font: 700 11px/1.35 var(--rp-font); white-space: nowrap; }

/* Frame guides: the picture's shape, the rest dimmed; the thirds. */
.rc-frame { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; overflow: hidden; }
.rc-frame[hidden] { display: none; }
.rc-frame::before { content: ''; width: 100%; height: 100%; }
.rc-frame.f-239::before, .rc-frame.f-185::before, .rc-frame.f-916::before { width: auto; height: auto; max-width: 100%; max-height: 100%; }
.rc-frame.f-239::before { aspect-ratio: 2.39; width: 100%; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .9); }
.rc-frame.f-185::before { aspect-ratio: 1.85; width: 100%; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .9); }
.rc-frame.f-916::before { aspect-ratio: 9 / 16; height: 100%; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .6); outline: 1px solid rgba(232, 195, 90, .6); }
.rc-frame.thirds::before { background:
  linear-gradient(to right, transparent calc(33.333% - .5px), rgba(255, 255, 255, .35) calc(33.333% - .5px), rgba(255, 255, 255, .35) calc(33.333% + .5px), transparent calc(33.333% + .5px),
    transparent calc(66.667% - .5px), rgba(255, 255, 255, .35) calc(66.667% - .5px), rgba(255, 255, 255, .35) calc(66.667% + .5px), transparent calc(66.667% + .5px)),
  linear-gradient(to bottom, transparent calc(33.333% - .5px), rgba(255, 255, 255, .35) calc(33.333% - .5px), rgba(255, 255, 255, .35) calc(33.333% + .5px), transparent calc(33.333% + .5px),
    transparent calc(66.667% - .5px), rgba(255, 255, 255, .35) calc(66.667% - .5px), rgba(255, 255, 255, .35) calc(66.667% + .5px), transparent calc(66.667% + .5px)); }
.rc-help h3 { color: var(--rp-gold); }
/* The HUD hidden (H) for a capture: the picture's shape stays, its edges
   black, the thirds gone. */
.rp-root.rp-bare > .rc-frame.rc-frame:not([hidden]) { display: grid !important; }
.rp-root.rp-bare > .rc-frame::before { background: none; box-shadow: 0 0 0 100vmax #000; outline: none; }
.rp-root.rp-bare > .rc-frame.f-none { display: none !important; }

@media (max-width: 720px) {
  .rc-panel { top: auto; right: 6px; height: 46%; width: calc(100% - 12px); }
}
@media (pointer: coarse) {
  .rc-seg .rp-btn, .rc-small, .rc-ico { height: 34px; min-width: 34px; }
  .rc-row { padding-top: 6px; padding-bottom: 6px; }
}
`;

function injectStyle() {
  if (document.getElementById('rc-style')) return;
  const style = el('style');
  style.id = 'rc-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}
