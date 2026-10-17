#!/usr/bin/env node
// First-person rigs in the page: which clip the arms play for a fire, a bolt,
// a reload or a prone swing, how far the hands travel in it, and whether the
// weapon's body stays in the left hand. One headless Chromium, closed at the
// end (pageprobe.cjs). The offline checks (the glb's own channels multiplied
// out, the rig reports) say what the exporter wrote; this says what the page
// draws from it.
//
//   node fprigprobe.cjs --base http://localhost:5412 --case k98-hungary
//   node fprigprobe.cjs --case sniper-reload | prone-knife | fhsw-thrown | fhsw-thrown-ru
//   node fprigprobe.cjs --mod fhsw --map battle_of_foy --team 1 --weapons RDG33,GeballteLadung --actions fire
//
// Per weapon and action, per clip the arms passed through:
//   frames         frames sampled in that clip
//   handTravelCm   the right hand's furthest point from where it stood at the
//                  clip's first frame, in the rig's space (a clip that plays
//                  moves the hand; a missing clip leaves it on the idle)
//   bodyInRigDeg   the weapon body's largest turn from its idle pose, in the
//                  rig's space
//   bodyVsLeftDeg  the same turn measured against the left hand: a rifle that
//                  stays in the left hand reads near 0 whatever the arms do
// `--weapons` forces the hand weapon the way `?weapon=` does, one respawn
// each, by answering `URLSearchParams.get('weapon')` from the probe.
// Exit 0 when every check of the case held, 1 when one failed, 2 when the run
// could not be staged.
const path = require('node:path');
const fs = require('node:fs');
const { parseArgs, withPage, sleep } = require('./pageprobe.cjs');

const CASES = {
  // FHV-1: FHSW's bolt rifles spun on a reload (d758adb2).
  'k98-hungary': { mod: 'fhsw', map: 'hungary_forest-1945', team: 1, weapons: 'k98', actions: 'fire,reload',
    check: { bodyVsLeftDegMax: 10 } },
  // FHV-4: vanilla K98Sniper / No4Sniper work the bolt on a reload (26d9523d).
  'sniper-reload': { mod: 'bf1942', map: 'el_alamein', team: 1, weapons: 'K98Sniper,No4Sniper', actions: 'reload',
    check: { clips: { reload: 'reload' }, handTravelCmMin: 3 } },
  // FHV-4: vanilla knives swing lying down (proneFire1..5).
  'prone-knife': { mod: 'bf1942', map: 'el_alamein', team: 1, weapons: 'KnifeAxis,KnifeAllies', actions: 'prone,fire',
    check: { clips: { fire: 'proneFire' }, handTravelCmMin: 3 } },
  // FHV-4: the restored FHSW grenade, smoke and charge rigs (d8a71698).
  'fhsw-thrown': { mod: 'fhsw', map: 'battle_of_foy', team: 1,
    weapons: 'RandomGerGrenadierRG1,RandomGerGrenadierRG2,RandomSmokeItem4Ger1,RandomSmokeItem4Ger4,RandomSmokeItem5Ger1,RandomSmokeItem5Ger4,GeballteLadung,RDG33,RDGGeballte',
    actions: 'throw', check: { rig: true, handTravelCmMin: 3 } },
  'fhsw-thrown-ru': { mod: 'fhsw', map: 'kharkov_outskirts-1943', team: 2,
    weapons: 'RandomSmokeItem4RDG21,RandomSmokeItem4RDG24,RDG33,RDGGeballte,GeballteLadung',
    actions: 'throw', check: { rig: true, handTravelCmMin: 3 } },
};

const opts = parseArgs({ base: 'http://localhost:5412', case: '', mod: 'bf1942', map: 'el_alamein', team: 1,
  kit: '', weapons: '', actions: 'fire,reload', code: '', out: '', w: 960, h: 600 });
const spec = opts.case ? { ...CASES[opts.case] } : { mod: opts.mod, map: opts.map, team: opts.team,
  weapons: opts.weapons, actions: opts.actions, check: {} };
if (opts.case && !CASES[opts.case]) { console.error(`no case ${opts.case}: ${Object.keys(CASES).join(', ')}`); process.exit(2); }

// In the page: per frame, the arms' clip and the right hand, the left hand and
// the weapon body in the rig's space.
function installTracker() {
  const T = window.__THREE;
  const name = s => T.PropertyBinding.sanitizeNodeName(s);
  window.__fpTrack = {
    rows: [], rest: null,
    nodes() {
      const rig = window.__rig?.(); if (!rig) return null;
      const by = n => rig.getObjectByName(name(n));
      let body = null;
      rig.traverse(o => { if (!body && /GUNBODY/i.test(o.name)) body = o; });
      const grip = window.__handRig?.()?.weapon || null;
      return { rig, rh: by('Bip01 R Hand'), lh: by('Bip01 L Hand'), body: body || grip, bodyName: (body || grip)?.name ?? null };
    },
    frame() {
      const n = this.nodes(); if (!n?.rh || !n.lh || !n.body) return null;
      n.rig.updateMatrixWorld(true);
      const inv = new T.Matrix4().copy(n.rig.matrixWorld).invert();
      const local = o => { const m = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld); const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(); m.decompose(p, q, s); return { p, q }; };
      const rh = local(n.rh), lh = local(n.lh), body = local(n.body);
      const vsLeft = lh.q.clone().invert().multiply(body.q);
      return { rh: rh.p.toArray(), body: body.q.toArray(), vsLeft: vsLeft.toArray(), bodyName: n.bodyName };
    },
    markRest() { const f = this.frame(); this.rest = f; return !!f; },
    sample(tag) {
      const f = this.frame(); const hw = window.__hw();
      this.rows.push({ tag, clip: hw?.clip ?? null, ...(f || {}) });
    },
    summary(tag) {
      const T3 = window.__THREE;
      const ang = (a, b) => { if (!a || !b) return 0; const qa = new T3.Quaternion().fromArray(a), qb = new T3.Quaternion().fromArray(b); return qa.angleTo(qb) * 180 / Math.PI; };
      const out = {}; let start = null, last = null;
      for (const r of this.rows.filter(r => r.tag === tag)) {
        if (!r.rh) continue;
        if (r.clip !== last) { start = r.rh; last = r.clip; }
        const c = out[r.clip] ??= { frames: 0, handTravelCm: 0, bodyInRigDeg: 0, bodyVsLeftDeg: 0 };
        c.frames++;
        c.handTravelCm = Math.max(c.handTravelCm, Math.hypot(r.rh[0] - start[0], r.rh[1] - start[1], r.rh[2] - start[2]) * 100);
        c.bodyInRigDeg = Math.max(c.bodyInRigDeg, ang(r.body, this.rest?.body));
        c.bodyVsLeftDeg = Math.max(c.bodyVsLeftDeg, ang(r.vsLeft, this.rest?.vsLeft));
      }
      for (const c of Object.values(out)) for (const k of ['handTravelCm', 'bodyInRigDeg', 'bodyVsLeftDeg']) c[k] = +c[k].toFixed(2);
      return out;
    },
  };
}

async function main() {
  const init = () => {
    window.__forceWeapon = null;
    const get = URLSearchParams.prototype.get;
    URLSearchParams.prototype.get = function (k) { return k === 'weapon' && window.__forceWeapon ? window.__forceWeapon : get.call(this, k); };
  };
  return withPage({ base: opts.base, w: opts.w, h: opts.h, init, code: opts.code }, async probe => {
    const { ev, step } = probe;
    await probe.open({ mod: spec.mod, map: spec.map, botCount: '0' });
    await ev(installTracker);
    // Frames stepped and sampled inside the page, one round trip per batch.
    const run = async (n, tag) => {
      for (let left = n; left > 0; left -= 60) {
        await ev(([c, tag, w, h]) => { for (let i = 0; i < c; i++) { window.__renderOnce(w, h, 1 / 60); window.__fpTrack.sample(tag); } },
          [Math.min(60, left), tag, probe.w, probe.h]);
      }
    };
    const results = [];
    const weapons = String(spec.weapons || '').split(',').filter(Boolean);
    const actions = String(spec.actions).split(',').filter(Boolean);
    for (const weapon of weapons.length ? weapons : [null]) {
      await ev(w => { window.__forceWeapon = w; }, weapon);
      // A forced weapon reaches the hand on a new life (`ensureHandWeapon`).
      if (await ev(() => !!window.__soldier?.())) { await ev(() => window.__damage?.(1e6)); await step(20); }
      const r = await probe.spawn(spec.team, opts.kit || null);
      if (r !== 'ok') { results.push({ weapon, error: `spawn: ${r}` }); continue; }
      const hw = await probe.settleWeapon(weapon);
      const row = { weapon, held: hw?.name, rig: hw?.rig ?? null, viewmodel: !!hw?.viewmodel, actions: {} };
      results.push(row);
      if (!hw?.viewmodel) { row.error = 'no arms rig in hand'; continue; }
      await step(30);
      row.restOk = await ev(() => window.__fpTrack.markRest());
      row.body = (await ev(() => window.__fpTrack.frame()))?.bodyName ?? null;
      for (const action of actions) {
        const tag = `${weapon}:${action}`;
        if (action === 'prone') {
          // The real key (c_PILie, Z in the shipped Infantry map).
          row.focus = await ev(() => { document.activeElement?.blur?.(); return document.activeElement?.tagName; });
          await probe.page.keyboard.down('z');
          await step(2);
          await probe.page.keyboard.up('z');
          await run(300, tag);
          row.stance = await ev(() => window.__soldier()?.stance);
          await ev(() => window.__fpTrack.markRest());
          continue;
        }
        if (action === 'throw') {
          // A thrown item fires on the release after its fireDelay (about 1 s).
          await ev(() => window.__setTrigger(true));
          await run(90, tag);
          await ev(() => window.__setTrigger(false));
        } else if (action === 'fire') {
          await ev(() => window.__setTrigger(true));
          await run(6, tag);
          await ev(() => window.__setTrigger(false));
        } else if (action === 'reload') {
          await ev(() => { window.__setAmmo(0, 4); return window.__reload(); });
        }
        await run(260, tag);
        row.actions[action] = await ev(t => window.__fpTrack.summary(t), tag);
        row.shots = (await ev(() => window.__hw()))?.shots;
      }
      if (opts.out) await probe.capture(path.join(opts.out, `${spec.map}-${weapon}.jpg`));
    }
    // The verdict.
    const failures = [];
    const c = spec.check || {};
    for (const row of results) {
      if (row.error) { failures.push(`${row.weapon}: ${row.error}`); continue; }
      if (c.rig && !row.rig) failures.push(`${row.weapon}: no rig file`);
      for (const [action, clips] of Object.entries(row.actions)) {
        const names = Object.keys(clips);
        const want = c.clips?.[action];
        const playing = names.filter(n => !want || n.startsWith(want));
        if (want && !playing.length) failures.push(`${row.weapon} ${action}: no ${want}* clip (saw ${names.join(',')})`);
        const travel = Math.max(0, ...playing.filter(n => !/^(idle|prone$|crouch$)/.test(n)).map(n => clips[n].handTravelCm));
        if (c.handTravelCmMin && travel < c.handTravelCmMin) failures.push(`${row.weapon} ${action}: hands moved ${travel} cm`);
        // The idle fidgets (idle1..3) may take the left hand off the gun; the
        // rifle staying put is the check, and it reads in bodyInRigDeg there.
        const vs = Math.max(0, ...names.filter(n => !/^idle/.test(n)).map(n => clips[n].bodyVsLeftDeg));
        if (c.bodyVsLeftDegMax && vs > c.bodyVsLeftDegMax) failures.push(`${row.weapon} ${action}: body turned ${vs} deg against the left hand`);
      }
    }
    const report = { case: opts.case || null, mod: spec.mod, map: spec.map, results, failures, pageErrors: probe.errors.slice(0, 20) };
    console.log(JSON.stringify(report, null, 1));
    if (opts.out) { fs.mkdirSync(opts.out, { recursive: true }); fs.writeFileSync(path.join(opts.out, `${opts.case || spec.map}.json`), JSON.stringify(report, null, 1)); }
    return failures.length ? 1 : 0;
  });
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
