// The round's dogfights on the replay's timeline (replay-dogfights.js): which
// rows of the dogfight index a page marks, and where on its clock. Run by
// test_replay_dogfights.py; prints one JSON object.

globalThis.location = { origin: 'https://play.bfstats.io', search: '', href: 'https://play.bfstats.io/map.html' };
const m = await import('../viewer/replay-dogfights.js');

const side = (name, tmpl) => ({ name, team: 1, tmpl, aimed: 3, hits: 0, turned: 200 });
const row = (id, slug, t0, duration, kind = 'dogfight', extra = {}) => ({
  id, slug, mod: 'bf1942', level: 'battle_of_britain', t0, duration, kind, mutual: false,
  kill: null, end: { why: 'apart', t: duration, side: 0 }, sides: [side('Option_X', 'Spitfire'), side('Zincha', 'Ju88A')], ...extra,
});
const rows = [
  row('aaaaaaaaaa-1', 'aaaaaaaaaa', 100, 20),
  row('aaaaaaaaaa-2', 'aaaaaaaaaa', 50, 10, 'bounce'),
  row('aaaaaaaaaa-3', 'aaaaaaaaaa', 900, 30),
  row('bbbbbbbbbb-1', 'bbbbbbbbbb', 40, 15),
  row('cccccccccc-1', 'cccccccccc', 10, 15),
];
const feed = s => `https://bfstats.io/stats/recordings/${s}.ndjson`;
const ids = list => list.map(f => [f.id, +f.t0.toFixed(3), +f.t1.toFixed(3)]);

const single = m.placeFights(rows, [feed('aaaaaaaaaa')], { duration: 920 });
const merged = m.placeFights(rows, [feed('aaaaaaaaaa'), feed('bbbbbbbbbb')], {
  duration: 1000, merged: [{ offset: 5, drift: 0 }, { offset: 120, drift: 0 }],
});
// Two `replay`s whose merge fell back to the first: the first's clock alone.
const fellBack = m.placeFights(rows, [feed('aaaaaaaaaa'), feed('bbbbbbbbbb')], { duration: 1000, merged: null });

const searchFor = (...params) => '?' + params.join('&');
console.log(JSON.stringify({
  slugs: [feed('aaaaaaaaaa'), 'replays/rec/aaaaaaaaaa.ndjson', 'x/aaaaaaaaaa.ndjson.gz', 'dogfights/aaaaaaaaaa-1.ndjson', 'round.ndjson'].map(m.slugOf),
  single: ids(single),
  merged: ids(merged),
  fellBack: ids(fellBack),
  href: single[0]?.href,
  title: single[0]?.title,
  sub: single[0]?.sub,
  clip: await m.recordingFights({ duration: 100 }, searchFor('replay=dogfights/aaaaaaaaaa-1.ndjson', 'clip')),
  school: await m.recordingFights({ duration: 100 }, searchFor(`replay=${feed('aaaaaaaaaa')}`, 'school=aaaaaaaaaa-1')),
}));
