// The followed soldier's own hand sounds in a replay (viewer/replay-own-sound.js):
// his reload and his medic bag's or wrench's loop, which only the man holding
// the weapon hears. Run by test_replay_own_sound.py.
import assert from 'node:assert/strict';
import { createReplayOwnHandSound } from '../viewer/replay-own-sound.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const played = [];
const loops = [];
const fetched = [];
const fires = {
  mp40: { spec: { loop: false }, buffer: {}, playReload: () => played.push('Mp40') },
  medpack: { spec: { loop: true, volume: 0.8 }, buffer: {}, playReload: () => played.push('MedPack') },
};
const kit = {
  fetchHandFireSound: async name => { fetched.push(name); return fires[name.toLowerCase()] ?? null; },
  setReplayFireLoop: fire => loops.push(fire),
};
const hand = createReplayOwnHandSound(kit);

// A reload before its sounds decode still plays, once they have.
hand.reload('Mp40');
await tick();
assert.deepEqual(played, ['Mp40']);
// Decoded once per weapon, whatever its case.
hand.reload('MP40');
hand.reload('Mp40');
await tick();
assert.deepEqual(played, ['Mp40', 'Mp40', 'Mp40']);
assert.deepEqual(fetched, ['Mp40']);
// A weapon with no sounds is quiet, and asked once.
hand.reload('Binoculars');
hand.reload('Binoculars');
await tick();
assert.equal(played.length, 3);
assert.equal(fetched.filter(n => n === 'Binoculars').length, 1);

// The pack's loop starts with the frame that names it and is let go on the
// first that does not.
await hand.prime('MedPack');
hand.loop('MedPack');
assert.equal(loops.at(-1), fires.medpack);
hand.loop(null);
assert.equal(loops.at(-1), null);
// A loop asked for while its sounds decode, then let go before they land,
// does not start late.
const slow = createReplayOwnHandSound({
  fetchHandFireSound: async () => { await tick(); await tick(); return fires.medpack; },
  setReplayFireLoop: fire => loops.push(fire),
});
const before = loops.length;
slow.loop('MedPack');
slow.loop(null);
await tick(); await tick(); await tick();
assert.deepEqual(loops.slice(before), [null]);
// Nothing to name, nothing to play.
hand.reload(null);
assert.equal(await hand.prime(''), null);
// A kit without the calls (a page with no hand weapon) is not an error.
const bare = createReplayOwnHandSound(null);
bare.reload('Mp40');
bare.loop('MedPack');
await tick();
console.log('ok');
