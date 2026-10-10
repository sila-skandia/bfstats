/**
 * A marker weapon's pull, from the trigger to `guns.onMark` (ledger SPOT-1):
 * `gun-cycle.js` `advanceGroups` hands a `magType 2` group's press to the
 * page and fires nothing, and leaves every other gun alone.
 *
 * No browser. Run by `tests/test_spotter.py`.
 */
import assert from 'node:assert/strict';
import { advanceGroups } from '../viewer/gun-cycle.js';

function group(stats) {
  return {
    node: { userData: {} }, stats, emitters: [], muzzles: [{}], firing: false,
    cooldown: 0, shots: 0, recoil: null, loadedRounds: false,
  };
}

function rig() {
  const guns = {
    groups: [], marks: [], fired: [], camera: null,
    onMark(g) { this.marks.push(g); },
    fireShot(g) { this.fired.push(g); g.shots += 1; },
  };
  return guns;
}

const tick = (guns, n = 1) => { for (let i = 0; i < n; i++) advanceGroups(guns, 1 / 30); };

// One mark per press, however long the trigger is held, and never a round.
{
  const guns = rig();
  const spotter = group({ magType: 2, input: 'c_PIAltFire' });
  guns.groups.push(spotter);
  tick(guns, 3);
  assert.equal(guns.marks.length, 0, 'no pull, no mark');
  spotter.firing = true;
  tick(guns, 30);
  assert.equal(guns.marks.length, 1, 'a held trigger marks once');
  assert.equal(spotter.marks, 1);
  spotter.firing = false;
  tick(guns, 2);
  spotter.firing = true;
  tick(guns, 1);
  assert.equal(guns.marks.length, 2, 'a second press marks again');
  assert.equal(guns.fired.length, 0, 'a marker weapon fires no round');
  assert.equal(spotter.shots, 0);
  assert.equal(spotter.cooldown, 0, 'and starts no rate-of-fire timer');
}

// A page with no `onMark` (the model browser) is not troubled by one.
{
  const guns = rig();
  guns.onMark = null;
  const spotter = group({ magType: 2 });
  spotter.firing = true;
  guns.groups.push(spotter);
  tick(guns, 2);
  assert.equal(guns.fired.length, 0);
}

// The medic's pack (`magType 1`) and a plain gun still fire.
{
  const guns = rig();
  const pack = group({ magType: 1, roundOfFire: 10 });
  const rifle = group({ roundOfFire: 10 });
  guns.groups.push(pack, rifle);
  pack.firing = true;
  rifle.firing = true;
  tick(guns, 1);
  assert.equal(guns.fired.length, 2, 'other magazine types fire as before');
  assert.equal(guns.marks.length, 0);
}

console.log('ok');
