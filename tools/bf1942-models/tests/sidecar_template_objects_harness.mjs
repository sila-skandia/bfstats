// test_sidecar_template_objects.py's node half: every object a real round
// named (fixtures/sidecar_object_corpus.json: lab server recordings of
// vanilla, Desert Combat, FHSW and FHSWEurope, bf42plus client recordings of
// vanilla, Secret Weapons and FHSWEurope) put through the live path, a
// BodyDecoder fed ServerInfo, SetLevel and a CreateObject per object, so its
// class, hull spec, hit points and turning parts come from the install as the
// sidecar computes them. Also the Wake class map (sidecar/classes.json) and the
// vanilla soldier constants against the computed ones. Prints one JSON line.
import fs from 'node:fs';
import { BodyDecoder } from '../sidecar/body-decoder.mjs';
import { childrenFor, hullFor, soldierFor, jointPartsFor, seatSpecFor } from '../sidecar/ghost/children.mjs';
import { VANILLA_SOLDIER_HP, VANILLA_AIM_TWIST_DEG, VANILLA_AIM_PITCH_DEG } from '../sidecar/soldier-ghost.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
const corpus = read('./fixtures/sidecar_object_corpus.json').tables;
const only = process.env.CORPUS_MODS ? new Set(process.env.CORPUS_MODS.split(',')) : null;
const out = { tables: {}, wake: null, soldiers: {} };

for (const t of corpus) {
  if (only && !only.has(t.mod)) continue;
  const dc = new BodyDecoder();
  dc.note({ e: 'serverInfo', mod: t.mod });
  dc.note({ e: 'setLevel', level: `bf1942/levels/${t.level}/`, mode: `${t.mode}.con` });
  const r = {
    computed: !!dc.tidClasses, objects: 0, named: 0, classed: 0, classes: {}, specs: 0,
    seats: 0, maxhp: 0, maxhpAgree: 0, joints: 0, jointsRecorded: 0, jointsPivot: 0, misses: [],
  };
  let netId = 1000;
  for (const [tmpl, o] of Object.entries(t.objects)) {
    if (o.tid == null) continue;
    r.objects++;
    const id = netId; netId += 20;   // room for a hull's seats
    dc.note({ e: 'createObject', netId: id, tid: o.tid });
    const info = dc.info(id);
    if (info?.tmpl?.toLowerCase() === tmpl.toLowerCase()) r.named++;
    else r.misses.push([tmpl, 'name', info?.tmpl ?? null]);
    if (!info?.objectClass) { r.misses.push([tmpl, 'class']); continue; }
    r.classed++;
    r.classes[info.objectClass] = (r.classes[info.objectClass] ?? 0) + 1;
    if (info.objectClass === 'PlayerControlObject') {
      const spec = childrenFor(tmpl);
      const letters = spec ? [...spec.children, ...Object.values(spec.seats ?? {}).flatMap((s) => s.children)] : null;
      if (spec && letters.every((c) => 'ESRFO'.includes(c))) r.specs++;
      else r.misses.push([tmpl, 'spec', spec ? letters.join('') : null]);
      // A seat is the netId after its hull, read with its own spec.
      for (const seat of Object.keys(spec?.seats ?? {})) {
        if (dc.classOf(id + Number(seat)) === 'Seat' && seatSpecFor(tmpl, Number(seat))) r.seats++;
        else r.misses.push([tmpl, 'seat', seat]);
      }
    }
    if (o.maxhp?.length) {
      const got = hullFor(tmpl)?.maxHp ?? soldierFor(tmpl)?.maxHp ?? null;
      if (got != null) {
        r.maxhp++;
        if (o.maxhp.every((v) => Math.round(v) === got)) r.maxhpAgree++;
        else r.misses.push([tmpl, 'maxhp', o.maxhp, got]);
      } else if (info.objectClass === 'PlayerControlObject') r.misses.push([tmpl, 'no hull', o.maxhp]);
    }
    if (o.joints?.length && info.objectClass === 'PlayerControlObject') {
      const recorded = new Set(o.joints.map((j) => j.toLowerCase()));
      const pivots = new Set(Object.keys(hullFor(tmpl)?.parts ?? {}).map((p) => p.toLowerCase()));
      for (const seat of [0, ...Object.keys(childrenFor(tmpl)?.seats ?? {}).map(Number)]) {
        for (const [name] of jointPartsFor(tmpl, seat) ?? []) {
          r.joints++;
          if (recorded.has(name.toLowerCase())) r.jointsRecorded++; else r.misses.push([tmpl, 'joint', seat, name]);
          if (pivots.has(name.toLowerCase())) r.jointsPivot++;
        }
      }
    }
  }
  out.tables[`${t.mod}|${t.level}|${t.mode}`] = r;
}

// The Wake class map (classes.json, read from a lab capture) against the
// computed table of the round it was read on, Wake co-op.
{
  const classes = read('../sidecar/classes.json');
  const dc = new BodyDecoder();
  dc.note({ e: 'serverInfo', mod: 'bf1942' });
  dc.note({ e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con' });
  const w = { byTid: 0, byTidAgree: [], byNetId: 0, byNetIdAgree: 0, misses: [] };
  for (const [tid, e] of Object.entries(classes.byTid)) {
    const id = 5000 + Number(tid);
    dc.note({ e: 'createObject', netId: id, tid: Number(tid) });
    const info = dc.info(id);
    w.byTid++;
    const same = info?.tmpl === e.tmpl && info?.objectClass === e.objectClass && info?.networkableClass === e.networkableClass;
    if (same) w.byTidAgree.push(e.tmpl); else w.misses.push([tid, e, info]);
  }
  for (const [netId, e] of Object.entries(classes.byNetId)) {
    w.byNetId++;
    const id = 9000 + Number(netId);
    dc.note({ e: 'createObject', netId: id, tid: e.tid });
    if (dc.classOf(id) === e.networkableClass) w.byNetIdAgree++;
  }
  out.wake = w;
  for (const s of ['USMarineSoldier', 'JapaneseSoldier']) out.soldiers[s] = soldierFor(s);
  out.soldierConstants = { maxHp: VANILLA_SOLDIER_HP, aimTwist: VANILLA_AIM_TWIST_DEG, aimPitch: VANILLA_AIM_PITCH_DEG };
}
console.log(JSON.stringify(out));
