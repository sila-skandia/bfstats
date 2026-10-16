#!/usr/bin/env node
// Compare a sidecar recording with a bf42plus client recording of the same
// round, object by object. Network ids are the server's, so both files name
// every object the same way; only the clocks differ. The clocks are aligned by
// events both files carry (a player entering a vehicle, taking control of a
// soldier, the 10 s clock ticks), never by the headers' start times: a
// recorder's start stamp and its t are not one clock.
//
//   node compare.mjs sidecar.ndjson client.ndjson [--json] [--ids 560,562]
//
// The client is ground truth for what it simulated or was sent. Its own
// player's objects are what it predicted, which the server overrules within a
// few hundred milliseconds, so a few decimetres of error there are expected.

import fs from 'node:fs';

export function readRec(path) {
  const rows = [];
  for (const l of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!l) continue;
    try { rows.push(JSON.parse(l)); } catch { /* a torn last line */ }
  }
  return rows;
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// The whole rotation between two unit quaternions, in degrees: catches a
// mirrored pitch or roll that a yaw check passes.
const quatAngle = (a, b) => {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
};

// Event keys both recorders write, for the clock alignment.
function alignKeys(rows) {
  const out = new Map();
  for (const r of rows) {
    if (r.k !== 'e' || r.derived) continue;
    let key = null;
    if (r.e === 'enterVehicle') key = `ent:${r.pid}:${r.netId}`;
    else if (r.e === 'control') key = `ctl:${r.pid}:${r.netId}`;
    else if (r.e === 'clock' && r.worldTime > 0) key = `clk:${r.worldTime}`;
    else if (r.e === 'createPlayer') key = `cp:${r.pid}`;
    if (key && !out.has(key)) out.set(key, r.t);
  }
  return out;
}

export function alignClocks(side, client) {
  const a = alignKeys(side), b = alignKeys(client);
  const d = [];
  for (const [k, t] of a) if (b.has(k)) d.push(t - b.get(k));
  return { offset: median(d) ?? 0, matches: d.length, spread: d.length ? r2(Math.max(...d) - Math.min(...d)) : null };
}

function tracks(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.k !== 's') continue;
    for (const o of r.o) {
      if (!m.has(o[0])) m.set(o[0], []);
      m.get(o[0]).push([r.t, o[1], o[2], o[3], o[4], o[5], o[6], o[7]]);
    }
  }
  return m;
}

// A track's sample at t: the latest at or before t, if it is no older than
// `hold` (a recorder writes only when an object moved).
function sampleAt(track, t, hold = 1.0) {
  let lo = 0, hi = track.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (track[mid][0] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  if (best < 0) return null;
  const a = track[best], b = track[best + 1];
  if (b && b[0] - a[0] < 0.6) {
    const f = (t - a[0]) / (b[0] - a[0]);
    return [t, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, a[4], a[5], a[6], a[7]];
  }
  return t - a[0] <= hold ? a : null;
}

function hpSeries(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.k !== 'a') continue;
    for (const [id, hp] of r.a) {
      if (!m.has(id)) m.set(id, []);
      const s = m.get(id);
      if (!s.length || s[s.length - 1][1] !== hp) s.push([r.t, hp]);
    }
  }
  return m;
}

function fires(rows, clientSide) {
  const out = [];
  for (const r of rows) {
    if (r.k === 'f') out.push({ t: r.t, pid: r.pid ?? null, id: r.id ?? null, w: r.w ?? '', d: r.d ?? null });
  }
  return out;
}

function events(rows, name) { return rows.filter((r) => r.k === 'e' && r.e === name && !r.derived); }

export function compare(sideRows, clientRowsAll, opts = {}) {
  const clk = alignClocks(sideRows, clientRowsAll);
  const off = clk.offset; // side t = client t + off
  // Only the span both recorded counts. The client's last rows are its own
  // teardown (every object closed at quit), and its first are the world dump
  // it was sent on joining, whose events the sidecar saw at its own join.
  const endC = clientRowsAll.find((r) => r.k === 'end')?.t ?? Infinity;
  const joinC = clientRowsAll.find((r) => r.k === 'e' && r.e === 'dbComplete')?.t ?? 0;
  const clientRows = clientRowsAll.filter((r) => !(r.k === 'd' && r.t >= endC - 0.5)
    && !(r.k === 'e' && r.t <= joinC + 0.5 && (r.e === 'enterVehicle' || r.e === 'exitVehicle')));
  sideRows = sideRows.filter((r) => r.k === 'h' || r.k === 'anim' || r.k === 'o' || r.t == null || r.t <= endC + off - 0.3);
  // When each object was in the sidecar's scope: from its k:"o" to its k:"d".
  // The server sends a client only what is near its own control object, and
  // the sidecar's and the client's differ, so only those spans compare.
  const scope = new Map();
  for (const r of sideRows) {
    if (r.k === 'o') { if (!scope.has(r.id)) scope.set(r.id, []); const l = scope.get(r.id); if (!l.length || l[l.length - 1][1] !== Infinity) l.push([r.t, Infinity]); }
    else if (r.k === 'd' && scope.has(r.id)) { const l = scope.get(r.id); if (l.length && l[l.length - 1][1] === Infinity) l[l.length - 1][1] = r.t; }
  }
  const inScope = (id, t) => (scope.get(id) ?? []).some(([a, b]) => t >= a + 0.3 && t <= b);
  // Objects the server never sent the sidecar (out of its scope the whole
  // time) cannot be compared; they are listed, not counted as mismatches.
  const seenSide = new Set(sideRows.filter((r) => r.k === 'o').map((r) => r.id));
  const report = { clock: clk, objects: [], hp: [], fires: {}, destroys: {}, seats: [], tickets: {}, flags: {}, unscoped: [], mismatches: [] };
  const miss = (kind, msg, extra = {}) => report.mismatches.push({ kind, msg, ...extra });

  // Templates, for the report.
  const tmpl = new Map();
  for (const r of clientRows) if (r.k === 'o' && r.tmpl) tmpl.set(r.id, r.tmpl);
  for (const r of sideRows) if (r.k === 'o' && r.tmpl && !tmpl.has(r.id)) tmpl.set(r.id, r.tmpl);

  // --- positions and facings ---
  const ts = tracks(sideRows), tc = tracks(clientRows);
  const ids = opts.ids ?? [...tc.keys()];
  for (const id of ids) {
    const c = tc.get(id); if (!c) continue;
    const s = ts.get(id);
    if (!seenSide.has(id)) { if (c.length > 3) report.unscoped.push(id); continue; }
    // Only samples where the object moved in the client's file count; a static
    // object's one sample says nothing.
    const moving = c.length > 3;
    const pe = [], ye = [];
    let covered = 0, total = 0;
    for (const cs of c) {
      if (!inScope(id, cs[0] + off)) continue;
      total++;
      const ss = s ? sampleAt(s, cs[0] + off) : null;
      if (!ss) continue;
      covered++;
      pe.push(Math.hypot(ss[1] - cs[1], ss[2] - cs[2], ss[3] - cs[3]));
      ye.push(quatAngle(ss.slice(4), cs.slice(4)));
    }
    const row = {
      id, tmpl: tmpl.get(id) ?? '', clientSamples: total, sideSamples: s?.length ?? 0,
      coverage: total ? r2(covered / total) : null,
      posMed: r2(median(pe)), posP95: r2(pct(pe, 0.95)), posMax: r2(pe.length ? Math.max(...pe) : null),
      rotMed: r2(median(ye)), rotP95: r2(pct(ye, 0.95)),
    };
    report.objects.push(row);
    if (!moving || total < 4) continue;
    if (!s) miss('pos', `${id} ${row.tmpl}: no sidecar samples (${total} in client)`, { id });
    else if (row.coverage < 0.8) miss('pos', `${id} ${row.tmpl}: sidecar covers ${row.coverage} of client samples`, { id });
    if (row.posMed != null && row.posMed > 1.5) miss('pos', `${id} ${row.tmpl}: median position error ${row.posMed} m (p95 ${row.posP95})`, { id });
    if (row.rotMed != null && row.rotMed > 10) miss('rot', `${id} ${row.tmpl}: median rotation error ${row.rotMed} deg (p95 ${row.rotP95})`, { id });
  }

  // --- hit points ---
  const hs = hpSeries(sideRows), hc = hpSeries(clientRows);
  for (const [id, c] of hc) {
    const s = hs.get(id);
    if (!seenSide.has(id)) continue;
    const lastC = c[c.length - 1][1], lastS = s ? s[s.length - 1][1] : null;
    const firstC = c[0][1], firstS = s ? s[0][1] : null;
    report.hp.push({ id, tmpl: tmpl.get(id) ?? '', client: c.map((x) => r2(x[1])), side: s ? s.map((x) => x[1]) : null });
    if (!s) { if (c.length > 1 || firstC < 100) miss('hp', `${id} ${tmpl.get(id) ?? ''}: hp ${c.map((x) => r2(x[1])).join('>')} in client, none from sidecar`, { id }); continue; }
    if (Math.abs(firstS - firstC) > 2 || Math.abs(lastS - lastC) > 2) {
      miss('hp', `${id} ${tmpl.get(id) ?? ''}: client ${c.map((x) => r2(x[1])).join('>')} vs sidecar ${s.map((x) => x[1]).join('>')}`, { id });
    }
  }

  // --- shots ---
  const fc = fires(clientRows), fs_ = fires(sideRows);
  const fcLocal = fc; // the client writes every round it simulates
  const matched = new Set();
  let hit = 0;
  const lag = [], dirErr = [];
  for (const f of fcLocal) {
    let best = -1, bd = 0.35;
    for (let i = 0; i < fs_.length; i++) {
      if (matched.has(i)) continue;
      const g = fs_[i];
      if (g.pid != null && f.pid != null && g.pid !== f.pid) continue;
      const d = Math.abs(g.t - (f.t + off));
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      matched.add(best); hit++; lag.push(fs_[best].t - (f.t + off));
      const g = fs_[best];
      if (g.d && f.d) dirErr.push(Math.acos(Math.max(-1, Math.min(1, g.d[0] * f.d[0] + g.d[1] * f.d[1] + g.d[2] * f.d[2]))) * 180 / Math.PI);
    }
  }
  const byPid = (list) => list.reduce((m, f) => (m[f.pid] = (m[f.pid] || 0) + 1, m), {});
  report.fires = {
    client: fc.length, side: fs_.length, matched: hit, lagMed: r2(median(lag)), dirMed: r2(median(dirErr)),
    sideWithDir: fs_.filter((f) => f.d).length, clientByPid: byPid(fc), sideByPid: byPid(fs_),
    clientByWeapon: fc.reduce((m, f) => (m[f.w] = (m[f.w] || 0) + 1, m), {}),
  };
  if (hit < fc.length * 0.8) miss('fire', `only ${hit}/${fc.length} client rounds have a sidecar shot within 0.35 s`);
  if (fs_.length && report.fires.sideWithDir < fs_.length) miss('fire', `${fs_.length - report.fires.sideWithDir}/${fs_.length} sidecar shots carry no direction`);
  if (dirErr.length && report.fires.dirMed > 5) miss('fire', `shot direction off by ${report.fires.dirMed} deg (median)`);

  // --- destroys ---
  // A k:"d" is a scope-out as well as a removal, and the two recorders'
  // scopes differ, so the comparison is on the server's own DestroyObject
  // events, which reach every client, and on wrecks (hit points reaching 0).
  const dEv = (rows, o) => new Map(events(rows, 'destroyObject').map((r) => [r.netId, r.t - o]));
  const dc = dEv(clientRows, 0), ds = dEv(sideRows, off);
  const dOnlyC = [...dc.keys()].filter((id) => !ds.has(id));
  const dOnlyS = [...ds.keys()].filter((id) => !dc.has(id) && ds.get(id) > (clientRowsAll.find((r) => r.t != null && r.k !== 'h')?.t ?? 0));
  const wreck = (h, id) => (h.get(id) ?? []).find((x) => x[1] === 0)?.[0];
  const wrecks = [];
  for (const id of hc.keys()) {
    const wc = wreck(hc, id); if (wc == null || !seenSide.has(id)) continue;
    const ws = wreck(hs, id);
    wrecks.push({ id, client: r2(wc), side: ws == null ? null : r2(ws - off) });
    if (ws == null) miss('wreck', `${id} ${tmpl.get(id) ?? ''} wrecked at ${r2(wc)} in the client, never in the sidecar`);
    else if (Math.abs(ws - off - wc) > 0.5) miss('wreck', `${id} ${tmpl.get(id) ?? ''} wrecked at ${r2(wc)} in the client, ${r2(ws - off)} in the sidecar`);
  }
  report.destroys = { client: dc.size, side: ds.size, onlyClient: dOnlyC, onlySide: dOnlyS, wrecks };
  if (dOnlyC.length) miss('destroy', `client has DestroyObject for ${dOnlyC.length} objects the sidecar lacks: ${dOnlyC.slice(0, 12).join(', ')}`);

  // --- seats ---
  const seatKeys = (rows) => rows.filter((r) => r.k === 'e' && !r.derived && (r.e === 'enterVehicle' || r.e === 'exitVehicle')).map((r) => ({ t: r.t, key: `${r.e}:${r.pid}:${r.netId ?? ''}` }));
  const sc = seatKeys(clientRows), ss = seatKeys(sideRows);
  const used = new Set();
  for (const e of sc) {
    const i = ss.findIndex((x, j) => !used.has(j) && x.key === e.key && Math.abs(x.t - (e.t + off)) < 1);
    if (i >= 0) used.add(i); else miss('seat', `client ${e.key} at ${r2(e.t)} has no sidecar match`);
  }
  report.seats = { client: sc.length, side: ss.length, matched: used.size };

  // --- the event story: scores (kills, deaths, captures, spawns), team and
  // kit changes, control, objects made and destroyed ---
  const evKey = (r) => {
    if (r.e === 'score') return `score:${r.kind}:${r.pid}${r.kind === 3 || r.kind === 6 ? ':' + r.victim : ''}`;
    if (r.e === 'setTeam') return `setTeam:${r.pid}:${r.team}`;
    if (r.e === 'pickupKit') return `pickupKit:${r.pid}:${r.netId}`;
    if (r.e === 'destroyPlayer') return `destroyPlayer:${r.pid}`;
    if (r.e === 'createObject') return `createObject:${r.netId}:${r.tid}`;
    if (r.e === 'createPlayer') return `createPlayer:${r.pid}`;
    return null;
  };
  const evsC = clientRows.filter((r) => r.k === 'e' && !r.derived && r.t > joinC + 0.5).map((r) => ({ t: r.t, key: evKey(r) })).filter((x) => x.key);
  const evsS = sideRows.filter((r) => r.k === 'e' && !r.derived).map((r) => ({ t: r.t - off, key: evKey(r) })).filter((x) => x.key);
  const usedE = new Set();
  let evMatched = 0;
  for (const e of evsC) {
    const i = evsS.findIndex((x, j) => !usedE.has(j) && x.key === e.key && Math.abs(x.t - e.t) < 1);
    if (i >= 0) { usedE.add(i); evMatched++; } else miss('event', `client ${e.key} at ${r2(e.t)} has no sidecar match`);
  }
  report.events = { client: evsC.length, matched: evMatched };

  // --- tickets ---
  const tkC = clientRows.filter((r) => r.k === 'tk' && (r.v[0] || r.v[1])).map((r) => [r.t, r.v]);
  const tkS = sideRows.filter((r) => r.k === 'tk').map((r) => [r.t, r.v]);
  report.tickets = { client: tkC.map((x) => x[1].join('/')), side: tkS.map((x) => x[1].join('/')) };
  const lastTk = (l) => (l.length ? l[l.length - 1][1].join('/') : null);
  if (lastTk(tkC) !== lastTk(tkS)) miss('tickets', `final tickets client ${lastTk(tkC)} vs sidecar ${lastTk(tkS)}`);

  // --- flags ---
  // A client names a point by its gid and template, the sidecar by netId and
  // template: matched on the template. Every change after the client's first
  // side must reach the sidecar within a second.
  const cpTmpl = new Map();
  for (const r of clientRows) if (r.k === 'cp' && r.tmpl) cpTmpl.set(r.id, r.tmpl);
  const changes = (list) => { const out = [], last = new Map(); for (const [t, k, v] of list) { if (last.get(k) !== v) { out.push([t, k, v]); last.set(k, v); } } return out; };
  const fcC = changes(clientRows.filter((r) => r.k === 'cp' && r.team >= 0).map((r) => [r.t, cpTmpl.get(r.id), r.team]));
  const fcS = changes(sideRows.filter((r) => r.k === 'e' && r.e === 'cp').map((r) => [r.t - off, r.tmpl ?? r.id, r.team]));
  report.flags = { client: fcC.map(([t, k, v]) => `${r2(t)} ${k}=${v}`), side: fcS.filter(([t]) => t > joinC + 0.5).map(([t, k, v]) => `${r2(t)} ${k}=${v}`) };
  for (const [t, k, v] of fcC) {
    // The sidecar's side for the point a second after the client's change.
    let cur = null;
    for (const [u, k2, v2] of fcS) if (k2 === k && u <= t + 1) cur = v2;
    if (cur !== v) miss('flag', `${k} -> ${v} at ${r2(t)} in the client, not in the sidecar`);
  }

  // --- stances of matched soldiers ---
  const stC = new Map(), stS = new Map();
  for (const r of clientRows) if (r.k === 'st') for (const o of r.o) { if (!stC.has(o[0])) stC.set(o[0], []); stC.get(o[0]).push([r.t, ...o.slice(1)]); }
  for (const r of sideRows) if (r.k === 'st') for (const o of r.o) { if (!stS.has(o[0])) stS.set(o[0], []); stS.get(o[0]).push([r.t, ...o.slice(1)]); }
  // While a soldier's player sits in a vehicle the client stops writing the
  // soldier's body (he is not drawn) and the server keeps sending its seated
  // state, so those spans do not compare.
  const ownerOf = new Map(), seatedSpans = new Map();
  for (const r of clientRowsAll) {
    if (r.k !== 'e') continue;
    if (r.e === 'control') ownerOf.set(r.netId, r.pid);
    if (r.e === 'enterVehicle') { if (!seatedSpans.has(r.pid)) seatedSpans.set(r.pid, []); seatedSpans.get(r.pid).push([r.t, Infinity]); }
    if (r.e === 'exitVehicle' || r.e === 'control') { const l = seatedSpans.get(r.pid); if (l?.length && l[l.length - 1][1] === Infinity) l[l.length - 1][1] = r.t; }
  }
  const seated = (id, t) => (seatedSpans.get(ownerOf.get(id)) ?? []).some(([a, b]) => t >= a - 0.2 && t <= b + 0.3);
  // The client's own soldier's states are its local animation's (it picks a
  // weapon's aim pose during a parachute drop where the server sends
  // Ub_ParachuteOpen), so only other soldiers' compare; the own one is shown.
  const ownPid = clientRowsAll.find((r) => r.k === 'f' && r.local)?.pid ?? null;
  report.stances = [];
  for (const [id, c] of stC) {
    const own = ownPid != null && ownerOf.get(id) === ownPid;
    const s = stS.get(id) ?? [];
    let same = 0, n = 0;
    for (const x of c) {
      if (seated(id, x[0]) || !inScope(id, x[0] + off)) continue;
      let y = null;
      for (const z of s) { if (z[0] <= x[0] + off + 0.15) y = z; else break; }
      if (!y) continue;
      n++; if (y[1] === x[1] && y[2] === x[2]) same++;
    }
    report.stances.push({ id, client: c.length, side: s.length, sameState: n ? r2(same / n) : null, ...(own ? { own: true } : {}) });
    if (!n || own) continue;
    if (!s.length) miss('stance', `${id} ${tmpl.get(id) ?? ''}: ${c.length} client stance rows, none from sidecar`);
    else if (n && same / n < 0.7) miss('stance', `${id} ${tmpl.get(id) ?? ''}: anim states agree on ${r2(same / n)} of rows`);
  }

  // --- turrets, guns and ramps (k:"jn" names, k:"j" rotations) ---
  // Both write each part's rotation from its root; the part ids differ, the
  // names do not. A client row is matched with the sidecar's in force then.
  const jointRuns = (rows, o) => {
    const names = new Map(), out = new Map();
    for (const r of rows) {
      if (r.k === 'jn') for (const x of r.o) names.set(`${x[0]}:${x[1]}`, x[2]);
      if (r.k === 'j') for (const x of r.o) {
        const n = names.get(`${x[0]}:${x[1]}`); if (!n) continue;
        const k = `${x[0]} ${n}`;
        if (!out.has(k)) out.set(k, []);
        out.get(k).push([r.t - o, x.slice(2, 6)]);
      }
    }
    return out;
  };
  const jc = jointRuns(clientRows, 0), js = jointRuns(sideRows, off);
  report.joints = {};
  for (const [k, c] of jc) {
    // A part that never moved: its rest rows, all at first sight (a ship's
    // three cannons share a name and each writes its own rest turn).
    if (new Set(c.map(([t]) => t)).size < 3) continue;
    const root = Number(k.split(' ')[0]);
    const s = js.get(k);
    const errs = [];
    for (const [t, q] of c) {
      if (!inScope(root, t + off)) continue;
      // The client draws a remote part through its interpolation, a tenth of
      // a second or so behind what it was sent: the best match within 0.2 s.
      let best = null;
      for (const z of s ?? []) if (Math.abs(z[0] - t) <= 0.2) { const e = quatAngle(q, z[1]); if (best == null || e < best) best = e; }
      if (best != null) errs.push(best);
    }
    report.joints[k] = { client: c.length, side: s?.length ?? 0, errMed: r2(median(errs)) };
    if (!s) { if (seenSide.has(root)) miss('joint', `${k}: ${c.length} client rotations, none from the sidecar`); continue; }
    if (errs.length && median(errs) > 10) miss('joint', `${k}: median rotation error ${r2(median(errs))} deg`);
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const idsAt = argv.indexOf('--ids');
  const ids = idsAt >= 0 ? argv[idsAt + 1].split(',').map(Number) : null;
  const [a, b] = argv.filter((x, i) => !x.startsWith('--') && (idsAt < 0 || i !== idsAt + 1));
  const rep = compare(readRec(a), readRec(b), ids ? { ids } : {});
  if (json) { console.log(JSON.stringify(rep, null, 1)); process.exit(0); }
  console.log(`clock: sidecar = client + ${r2(rep.clock.offset)} s (${rep.clock.matches} events, spread ${rep.clock.spread})`);
  console.log('objects that moved (id tmpl  cover  pos med/p95/max  rot med/p95):');
  for (const o of rep.objects.filter((o) => o.clientSamples > 3)) {
    console.log(`  ${o.id} ${o.tmpl.padEnd(22)} ${String(o.coverage).padEnd(5)} ${o.posMed}/${o.posP95}/${o.posMax}  ${o.rotMed}/${o.rotP95}  (${o.clientSamples} vs ${o.sideSamples})`);
  }
  console.log('fires:', JSON.stringify(rep.fires));
  console.log('destroys:', JSON.stringify(rep.destroys));
  console.log('seats:', JSON.stringify(rep.seats));
  console.log('events:', JSON.stringify(rep.events));
  console.log('tickets:', JSON.stringify(rep.tickets));
  console.log('flags:', JSON.stringify(rep.flags));
  console.log('stances:', JSON.stringify(rep.stances));
  console.log('joints:', JSON.stringify(rep.joints));
  console.log('never in the sidecar\'s scope:', rep.unscoped.join(', '));
  console.log(`\n${rep.mismatches.length} mismatches:`);
  for (const m of rep.mismatches) console.log(`  [${m.kind}] ${m.msg}`);
}
