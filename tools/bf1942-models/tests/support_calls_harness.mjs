// Drives `viewer/support-calls.js` outside a browser.
import { createSupportCalls, hearCall, expireCalls, callOf, callSprite, kitIndexOf } from './support-calls.js';

const out = {};
const medic = { localTeam: 2, localOnFoot: true, localKit: 3 };

// A teammate shouts "Medic!" (40) to a medic on foot: raised, pulsing, drawn.
{
  const c = createSupportCalls();
  out.raised = hearCall(c, { msg: 40, key: 'slot:5', team: 2, ...medic, now: 100 });
  out.pulse = callOf(c, 'slot:5', 110);
  out.sprite = callSprite(c, 'slot:5', 110, medic);
  // In a seat the local medic sees no sprite, though the call stands.
  out.spriteSeated = callSprite(c, 'slot:5', 110, { ...medic, localOnFoot: false });
  // After a kit change to engineer, the medic call draws nothing.
  out.spriteEngineer = callSprite(c, 'slot:5', 110, { ...medic, localKit: 4 });
  // 25 s on it is gone.
  out.at124 = callOf(c, 'slot:5', 124.9);
  expireCalls(c, 125);
  out.at125 = callOf(c, 'slot:5', 125);
}

// Not raised: an enemy, a listener with the wrong kit, one in a seat, another shout.
{
  const c = createSupportCalls();
  out.enemy = hearCall(c, { msg: 40, key: 'slot:6', team: 1, ...medic, now: 0 });
  out.wrongKit = hearCall(c, { msg: 40, key: 'slot:6', team: 2, ...medic, localKit: 4, now: 0 });
  out.seated = hearCall(c, { msg: 40, key: 'slot:6', team: 2, ...medic, localOnFoot: false, now: 0 });
  out.other = hearCall(c, { msg: 41, key: 'slot:6', team: 2, ...medic, now: 0 });
}

// "Need repairs!" (54) to an engineer: the engineer's sprite; medic wins a tie.
{
  const c = createSupportCalls();
  const eng = { localTeam: 2, localOnFoot: true, localKit: 4 };
  out.repairs = hearCall(c, { msg: 54, key: 'slot:7', team: 2, ...eng, now: 0 });
  out.repairsSprite = callSprite(c, 'slot:7', 1, eng);
  hearCall(c, { msg: 40, key: 'slot:7', team: 2, ...medic, now: 0 });
  out.bothPulse = callOf(c, 'slot:7', 1);
}

out.kits = ['scout', 'medic', 'engineer', 'nonsense'].map(kitIndexOf);
console.log(JSON.stringify(out));
