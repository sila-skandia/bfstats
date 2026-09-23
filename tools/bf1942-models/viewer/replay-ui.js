// The replay's page chrome: the transport bar, the event feed, the labels over
// replayed objects and the mouse orbit of the follow camera. Reads and drives a
// ReplayPlayer (replay.js); owns only DOM.

import { roundClock, fmtHp } from './replay-recording.js';

// Labels further than this from the camera are not drawn.
const LABEL_RANGE = 450;

function fmtTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

// --- the page -------------------------------------------------------------------

const STYLE = `
.rp-bar { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 30;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px;
  background: var(--panel, rgba(19,19,19,.82)); border: 1px solid var(--line, #2d2d2d);
  border-radius: 6px; color: var(--text, #c8c8c8); font: 12px/1.4 var(--mm-font-mono, monospace); }
.rp-bar button, .rp-bar select { font: inherit; color: var(--text, #c8c8c8); width: auto; margin: 0;
  background: var(--mm-bg-mute, #222); border: 1px solid var(--line, #2d2d2d); border-radius: 4px; padding: 3px 10px; }
.rp-bar button:hover { border-color: var(--accent, #9aa666); }
.rp-bar input[type=range] { flex: 1 1 220px; accent-color: var(--accent, #9aa666); }
.rp-bar label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted, #8a8a8a); }
.rp-time { min-width: 15ch; font-variant-numeric: tabular-nums; }
.rp-clock { color: var(--muted, #8a8a8a); font-variant-numeric: tabular-nums; }
.rp-status { flex-basis: 100%; color: var(--muted, #8a8a8a); font-size: 11px; }
.rp-feed { position: absolute; right: 12px; top: 212px; bottom: 96px; z-index: 30;
  width: min(390px, calc(100% - 24px)); display: flex; flex-direction: column;
  background: var(--panel, rgba(19,19,19,.82)); border: 1px solid var(--line, #2d2d2d);
  border-radius: 6px; font: 12px/1.45 var(--mm-font-mono, monospace); }
.rp-feed-head { display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 6px 10px; border-bottom: 1px solid var(--line, #2d2d2d); color: var(--muted, #8a8a8a); cursor: pointer; }
.rp-feed.collapsed { bottom: auto; }
.rp-feed.collapsed .rp-feed-list { display: none; }
.rp-feed.collapsed .rp-feed-head { border-bottom: 0; }
.rp-feed-list { overflow: auto; min-height: 0; }
.rp-row { display: grid; grid-template-columns: 6ch 6.5ch 1fr; gap: 8px; padding: 3px 10px;
  color: var(--muted, #8a8a8a); cursor: pointer; opacity: .5; }
.rp-row.past { opacity: 1; color: var(--text, #c8c8c8); }
.rp-row.current { background: rgba(154,166,102,.16); }
.rp-row:hover { background: rgba(255,255,255,.05); }
.rp-row.hidden { display: none; }
.rp-row time { font-variant-numeric: tabular-nums; }
.rp-src { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; text-align: center;
  border: 1px solid; border-radius: 3px; padding: 0 3px; align-self: start; }
.rp-src.client { color: var(--accent, #9aa666); border-color: rgba(154,166,102,.5); }
.rp-src.server { color: #d9b36a; border-color: rgba(217,179,106,.5); }
.rp-row.k-destroyed .rp-text, .rp-row.k-destroyVehicle .rp-text { color: #e07a5a; }
.rp-row.k-damage .rp-text { color: #d9b36a; }
.rp-labels { position: absolute; inset: 0; z-index: 25; pointer-events: none; overflow: hidden; }
.rp-label { position: absolute; transform: translate(-50%, -100%); padding: 2px 6px; white-space: nowrap;
  background: rgba(19,19,19,.8); border: 1px solid var(--line, #2d2d2d); border-radius: 4px;
  color: var(--text, #c8c8c8); font: 11px/1.3 var(--mm-font-mono, monospace); }
.rp-label.player { border-color: rgba(154,166,102,.7); color: #fff; }
.rp-hp { height: 4px; margin-top: 3px; background: rgba(255,255,255,.12); border-radius: 2px; overflow: hidden; }
.rp-hp > i { display: block; height: 100%; background: #9aa666; }
.rp-hp.smoke > i { background: #d9b36a; }
.rp-hp.fire > i { background: #e07a5a; }
.rp-toast { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 40;
  max-width: calc(100% - 32px); padding: 8px 12px; background: var(--panel, rgba(19,19,19,.9));
  border: 1px solid #d9b36a; border-radius: 6px; color: var(--text, #c8c8c8); font: 12px var(--mm-font-mono, monospace); }
@media (max-width: 720px) {
  .rp-feed { top: auto; bottom: 150px; height: 34%; }
}
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function toast(stage, message) {
  const node = el('div', 'rp-toast', message);
  stage.appendChild(node);
  setTimeout(() => node.remove(), 9000);
}

export class ReplayUi {
  constructor(player, pids) {
    this.player = player;
    this.stage = player.ctx.stage;
    this.scrubbing = false;
    this.currentRow = -1;
    if (!document.getElementById('rp-style')) {
      const style = el('style');
      style.id = 'rp-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    const rec = player.rec;

    this.bar = el('div', 'rp-bar');
    this.playBtn = el('button', '', 'Pause');
    this.playBtn.addEventListener('click', () => {
      if (!player.playing && player.time >= rec.duration) player.seek(0);
      player.playing = !player.playing;
    });
    this.timeText = el('span', 'rp-time');
    this.clockText = el('span', 'rp-clock');
    this.range = el('input');
    this.range.type = 'range';
    this.range.min = '0';
    this.range.max = String(rec.duration);
    this.range.step = '0.05';
    this.range.addEventListener('input', () => { this.scrubbing = true; player.seek(Number(this.range.value)); });
    this.range.addEventListener('change', () => { this.scrubbing = false; });
    const speed = el('select');
    for (const s of [0.25, 0.5, 1, 2, 4, 8]) speed.appendChild(new Option(`${s}x`, String(s), s === 1, s === 1));
    speed.addEventListener('change', () => { player.speed = Number(speed.value); });
    const follow = el('select');
    follow.appendChild(new Option('free camera', ''));
    for (const pid of pids) {
      const name = rec.players.get(pid)?.name ?? `player ${pid}`;
      follow.appendChild(new Option(`follow ${name}`, String(pid), pid === player.followPid, pid === player.followPid));
    }
    follow.addEventListener('change', () => {
      player.followPid = follow.value === '' ? null : Number(follow.value);
      player.followReady = false;
    });
    const serverToggle = this.checkbox('server log', player.showServer, on => {
      player.showServer = on;
      this.applyRowFilter();
    });
    serverToggle.title = player.alignment ? 'show the server event log on the level and in the feed'
      : 'load a server log (&serverlog=) to overlay it';
    serverToggle.querySelector('input').disabled = !player.alignment;
    const ghosts = this.checkbox('out-of-range objects', player.showGhosts, on => { player.showGhosts = on; });
    ghosts.title = 'objects announced to the client but beyond its ~520 m update radius';
    this.statusText = el('span', 'rp-status');
    this.bar.append(this.playBtn, this.timeText, this.range, speed, follow, serverToggle, ghosts, this.clockText, this.statusText);

    this.feed = el('div', 'rp-feed');
    const head = el('div', 'rp-feed-head');
    head.append(el('span', '', 'events'), this.legend());
    head.title = 'show or hide the event list';
    head.addEventListener('click', () => this.feed.classList.toggle('collapsed'));
    this.list = el('div', 'rp-feed-list');
    this.feed.append(head, this.list);

    this.labels = el('div', 'rp-labels');
    for (const node of [this.bar, this.feed]) {
      // The view takes pointer-lock on a click; the replay's own controls must
      // not hand the mouse to the camera.
      node.addEventListener('pointerdown', e => e.stopPropagation());
      node.addEventListener('mousedown', e => e.stopPropagation());
      node.addEventListener('keydown', e => e.stopPropagation());
    }
    this.stage.append(this.labels, this.feed, this.bar);
    // The click-to-fly gate would sit over the middle of a replay that needs
    // no mouse; the free camera still takes one when it is chosen.
    const gate = document.getElementById('gate');
    if (gate) gate.hidden = true;

    // Orbiting the followed object: drag, or move the mouse while the view
    // holds the pointer lock; the wheel zooms. Off the replay's own panels.
    const onPanel = e => Boolean(e.target?.closest?.('.rp-bar, .rp-feed'));
    this.onMouseMove = e => {
      if (player.followPid === null || onPanel(e)) return;
      if (!document.pointerLockElement && !(e.buttons & 1)) return;
      player.orbit.yaw -= e.movementX * 0.005;
      player.orbit.pitch = Math.min(1.45, Math.max(-0.15, player.orbit.pitch + e.movementY * 0.004));
    };
    this.onWheel = e => {
      if (player.followPid === null || onPanel(e)) return;
      player.orbit.zoom = Math.min(6, Math.max(0.2, player.orbit.zoom * Math.exp(e.deltaY * 0.0012)));
    };
    document.addEventListener('mousemove', this.onMouseMove);
    this.stage.addEventListener('wheel', this.onWheel, { passive: true });
  }

  checkbox(text, checked, onChange) {
    const label = el('label');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, document.createTextNode(text));
    return label;
  }

  legend() {
    const wrap = el('span');
    wrap.append(el('span', 'rp-src client', 'client'), document.createTextNode(' '), el('span', 'rp-src server', 'server'));
    return wrap;
  }

  status(text) {
    this.statusText.textContent = text;
  }

  renderFeed() {
    this.list.textContent = '';
    this.rowNodes = this.player.rows.map(row => {
      const node = el('div', `rp-row k-${row.kind}`);
      node.append(el('time', '', fmtTime(row.t)), el('span', `rp-src ${row.source}`, row.source), el('span', 'rp-text', row.text));
      node.addEventListener('click', () => this.player.seek(row.t - 1.5));
      this.list.appendChild(node);
      return node;
    });
    this.applyRowFilter();
  }

  applyRowFilter() {
    if (!this.rowNodes) return;
    this.player.rows.forEach((row, i) => {
      this.rowNodes[i].classList.toggle('hidden', row.source === 'server' && !this.player.showServer);
    });
  }

  update(t) {
    const player = this.player;
    const rec = player.rec;
    this.playBtn.textContent = player.playing ? 'Pause' : 'Play';
    this.timeText.textContent = `${fmtTime(t)} / ${fmtTime(rec.duration)}`;
    if (!this.scrubbing) this.range.value = String(t);
    const clock = roundClock(rec, t);
    this.clockText.textContent = clock === null ? '' : `round ${fmtTime(clock).replace(/\.\d$/, '')}`;

    if (this.rowNodes) {
      let index = -1;
      const rows = player.rows;
      let lo = 0;
      let hi = rows.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].t <= t) { index = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (index !== this.currentRow) {
        const from = Math.min(index, this.currentRow) + 1;
        const to = Math.max(index, this.currentRow);
        for (let i = Math.max(0, from - 1); i <= to && i < rows.length; i++) {
          if (i >= 0) this.rowNodes[i].classList.toggle('past', i <= index);
        }
        if (this.currentRow >= 0) this.rowNodes[this.currentRow]?.classList.remove('current');
        if (index >= 0) {
          this.rowNodes[index].classList.add('current');
          if (!this.list.matches(':hover')) this.rowNodes[index].scrollIntoView({ block: 'nearest' });
        }
        this.currentRow = index;
      }
    }
    this.updateLabels(t);
  }

  updateLabels(t) {
    const player = this.player;
    const camera = player.ctx.camera;
    // This runs before the frame's render, and projects through the camera:
    // its matrices must describe where it points now.
    camera.updateMatrixWorld();
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    const focus = player.followPid !== null ? player.focusLife(t) : null;
    const name = player.followPid !== null ? (player.rec.players.get(player.followPid)?.name ?? '') : '';
    const v = player.v2;
    for (const entity of player.entities) {
      const { life } = entity;
      const isFocus = focus === life;
      const damaged = life.maxhp > 0 && entity.hp !== null && entity.hp < life.maxhp;
      let show = entity.group.visible && !entity.ghost && (isFocus || damaged);
      if (show) {
        v.copy(entity.group.position);
        v.y += life.soldier ? 2.2 : 4.5;
        const distance = v.distanceTo(camera.position);
        v.project(camera);
        show = distance < LABEL_RANGE && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      }
      if (!show) {
        if (entity.label) entity.label.style.display = 'none';
        continue;
      }
      if (!entity.label) {
        entity.label = el('div', 'rp-label');
        entity.label.append(el('div', 'rp-label-text'), el('div', 'rp-hp'));
        entity.label.lastChild.appendChild(el('i'));
        this.labels.appendChild(entity.label);
      }
      const label = entity.label;
      label.style.display = '';
      label.style.left = `${((v.x + 1) / 2) * width}px`;
      label.style.top = `${((1 - v.y) / 2) * height}px`;
      label.classList.toggle('player', isFocus);
      const hp = entity.hp;
      const text = isFocus ? (life.soldier ? name : `${name} · ${life.tmpl}`) : life.tmpl;
      label.firstChild.textContent = life.maxhp > 0 && hp !== null
        ? `${text} ${hp <= 0 ? 'wreck' : `${fmtHp(Math.round(hp * 10) / 10)}/${fmtHp(life.maxhp)}`}`
        : text;
      const bar = label.lastChild;
      bar.style.display = life.maxhp > 0 && hp !== null ? '' : 'none';
      if (life.maxhp > 0 && hp !== null) {
        bar.firstChild.style.width = `${Math.max(0, Math.min(1, hp / life.maxhp)) * 100}%`;
        // The recording carries the fire threshold; the smoke threshold is a
        // per-template armor effect it does not, and half health is where the
        // vanilla vehicles put it.
        bar.classList.toggle('fire', life.crit > 0 && hp <= life.crit);
        bar.classList.toggle('smoke', hp <= life.maxhp / 2 && !(life.crit > 0 && hp <= life.crit));
      }
    }
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouseMove);
    this.stage.removeEventListener('wheel', this.onWheel);
    this.bar.remove();
    this.feed.remove();
    this.labels.remove();
  }
}
