#!/usr/bin/env node
// What a bot's gun sounds like from beside him: every AudioBufferSourceNode
// the page starts while one bot holds his trigger through a magazine, named
// by the file its buffer was decoded from. One headless Chromium with the
// default autoplay policy and a real click, closed at the end (pageprobe.cjs).
//
//   node botgunsound.cjs --base http://localhost:5412 --map guadalcanal --weapon M1Garand
//   node botgunsound.cjs --mod fhsw --map battle_of_foy --weapon 2Us_AssaultGarand --team 2
//
// The bot is the first of `--bots` on `--team` whose kit's primary is
// `--weapon` (bots roll their kits; a level is reloaded up to `--tries` times
// for one). Every bot's own tick is emptied, so nobody moves; the chosen one's
// trigger is held for `--frames` frames at 60 Hz with the player standing `--near`
// metres to his side. Counted, per source file:
//   casing   the gun's casing bundle (ledger SND-34, Common/Sounds/shells.ssc,
//            patron*.wav): one a round, 0.07 s after it
//   eject    the clip leaving an ejectClipTime weapon (SND-35, slot 6):
//            once, after the magazine's last round
// Exit 0 when casings >= rounds - 1 and, for a weapon with an eject sound,
// one eject per emptied magazine; 1 otherwise; 2 when no such bot was found.
const path = require('node:path');
const fs = require('node:fs');
const { parseArgs, withPage, sleep } = require('./pageprobe.cjs');

const opts = parseArgs({ base: 'http://localhost:5412', mod: 'bf1942', map: 'guadalcanal', weapon: 'M1Garand',
  team: 2, bots: 16, tries: 3, frames: 900, code: '', near: 3, casing: 'patron', eject: 'M1Reload_2|\\.r6\\.', out: '', w: 960, h: 600 });

function init() {
  // A started voice is named by the file its buffer came from. three's
  // AudioLoader reads the body through a stream and decodes a copy, so the
  // bytes keep no URL; their length does: the decoded buffer remembers the
  // length it was decoded from, and the resource timing entry of each fetched
  // file gives its body's length (a few files may share one, `|`-joined).
  performance.setResourceTimingBufferSize(20000);
  const lengths = new WeakMap();
  const dec = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ok, err) {
    const n = data?.byteLength ?? -1;
    const p = dec.call(this, data, ok && (b => { lengths.set(b, n); ok(b); }), err);
    return p?.then ? p.then(b => { lengths.set(b, n); return b; }) : p;
  };
  const nameOf = n => {
    const hits = performance.getEntriesByType('resource')
      .filter(e => e.decodedBodySize === n && /\.(mp3|wav|ogg)(\?|$)/i.test(e.name))
      .map(e => e.name.split('/').pop().split('?')[0]);
    return [...new Set(hits)].join('|') || `?${n}`;
  };
  window.__starts = [];
  const st = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__starts.push({ t: performance.now(), n: lengths.get(this.buffer) ?? -1 });
    return st.apply(this, a);
  };
  window.__startNames = since => window.__starts.filter(s => s.t >= since)
    .map(s => ({ t: s.t, url: nameOf(s.n) }));
}

async function main() {
  return withPage({ base: opts.base, w: opts.w, h: opts.h, init, code: opts.code }, async probe => {
    const { ev, step } = probe;
    let pick = null;
    for (let t = 0; t < opts.tries && !pick; t++) {
      await probe.open({ mod: opts.mod, map: opts.map, botCount: String(opts.bots), botSkill: '0.75' });
      await probe.page.waitForFunction(n => window.__bots && window.__bots().length >= n, opts.bots, { timeout: 300000 }).catch(() => {});
      // Nobody moves or shoots of his own accord.
      // Nor takes a seat: the referee mounts bots of its own accord, and a bot
      // in an SBD fires its bombs (botfight.cjs's recipe).
      await ev(() => {
        for (const b of window.__bots()) {
          const c = window.__botCtl(b.id); if (!c) continue;
          c.tick = () => {};
          Object.defineProperty(c, 'vehicleCandidates', { get: () => [], set() {}, configurable: true });
          Object.defineProperty(c, 'enterRequest', { get: () => null, set() {}, configurable: true });
        }
      });
      pick = await ev(([w, team]) => {
        const c = window.__bots().map(b => window.__botCtl(b.id))
          .find(c => c && !c.vehicle && c.team === team && String(c.kitPrimary).toLowerCase() === w.toLowerCase());
        return c ? { id: c.playerId, kit: c.kit, weapon: c.kitPrimary } : null;
      }, [opts.weapon, opts.team]);
    }
    if (!pick) { console.log(JSON.stringify({ error: `no bot on team ${opts.team} holds ${opts.weapon}` })); return 2; }
    // The listener is the player: on foot at his side, facing him (a round
    // may wait on a living local player, and the ear is the camera). His
    // drawn gun and its rounds load meanwhile.
    pick.spawn = await probe.spawn(opts.team === 1 ? 2 : 1);
    const place = () => ev(([id, near]) => {
      const c = window.__botCtl(id), p = c.getPosition(), yaw = c.yaw ?? 0;
      const sx = Math.cos(yaw) * near, sz = -Math.sin(yaw) * near;
      window.__teleport(p[0] + sx, p[1] + 0.2, p[2] + sz, Math.atan2(-sx, -sz));
      return { pos: p.map(v => +v.toFixed(1)), yaw: +yaw.toFixed(2) };
    }, [pick.id, opts.near]);
    pick.at = await place();
    await step(60); await sleep(1500); await step(60); await place();
    const trace = [];
    const row = () => ev(id => {
      const b = window.__bots().find(b => b.id === id), s = window.__soldier();
      return { firing: b.firing, weapon: b.weapon, rounds: b.rounds, cool: b.cool, reload: b.reload, rof: b.rof, hp: b.hp,
        pos: b.pos.map(v => +v.toFixed(1)), me: s ? [s.x, s.y, s.z].map(v => +v.toFixed(1)) : null, myHp: s?.hp ?? null };
    }, pick.id);
    const t0 = await ev(() => performance.now());
    await ev(id => {
      const c = window.__botCtl(id);
      // Rounds counted where the referee bills them (`bot.onShot`, once a round).
      const shot = c.onShot.bind(c); c._probeShots = 0;
      c.onShot = (...a) => { c._probeShots++; return shot(...a); };
      c.tick = function () { this.isFiring = true; };
    }, pick.id);
    for (let left = opts.frames; left > 0; left -= 30) {
      await ev(([n, w, h]) => { for (let i = 0; i < n; i++) window.__renderOnce(w, h, 1 / 60); }, [Math.min(30, left), probe.w, probe.h]);
      await place();
      if (trace.length < 40) trace.push(await row());
      await sleep(30);
    }
    await ev(id => { const c = window.__botCtl(id); c.tick = function () { this.isFiring = false; }; }, pick.id);
    await step(60); await sleep(500);
    const r = await ev(([id, t0]) => {
      const c = window.__botCtl(id);
      const mag = c._mags ? [...c._mags.entries()].map(([k, m]) => ({ k, rounds: m.rounds, spare: m.spare, size: m.size, eject: m.ejectClipTime })) : null;
      return { starts: window.__startNames(t0).map(s => ({ dt: +(s.t - t0).toFixed(0), url: s.url })), mag,
        shots: c._probeShots };
    }, [pick.id, t0]);
    const byUrl = {};
    for (const s of r.starts) byUrl[s.url] = (byUrl[s.url] || 0) + 1;
    const casings = r.starts.filter(s => new RegExp(opts.casing, 'i').test(s.url)).length;
    const ejects = r.starts.filter(s => new RegExp(opts.eject, 'i').test(s.url)).length;
    const report = { mod: opts.mod, map: opts.map, code: opts.code || null, bot: pick, shots: r.shots, trace: trace.slice(0, 12), byUrl, casings, ejects, mag: r.mag,
      timeline: r.starts.slice(0, 80), pageErrors: probe.errors.slice(0, 10) };
    // A clip leaves after every emptied magazine: one eject each.
    const emptied = Math.floor((r.shots ?? 0) / Math.max(1, r.mag?.find(m => m.eject > 0)?.size ?? Infinity));
    report.emptied = emptied;
    console.log(JSON.stringify(report, null, 1));
    if (opts.out) { fs.mkdirSync(opts.out, { recursive: true }); fs.writeFileSync(path.join(opts.out, `botgun-${opts.map}${opts.code ? '-code' : ''}.json`), JSON.stringify(report, null, 1)); }
    return casings > 0 && (!opts.eject || !emptied || ejects >= emptied) ? 0 : 1;
  });
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
