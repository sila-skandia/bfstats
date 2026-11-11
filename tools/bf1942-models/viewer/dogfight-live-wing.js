// The pair lesson flown (features/dogfight-school, "Fly the pair"): the live
// fight's wingman. The plain half, with no page and no three.js, so a test
// flies it under node as the live fight does: the wingman's pilot stepped
// with the fight handed to it (`stepWing`, the `wingman` plan wants `team`),
// whom the hunter goes after (`huntTarget`), what the wingman's tag says
// (`WING_WORDS`), and the end card's words (`pairEnd`).

import { pilotView } from './dogfight-duel.js';
import { len, sub } from './dogfight-flight.js';

/** What the wingman is doing, by their plan's phase (`PLANS.wingman`), as
 *  their tag and caption row say it. */
export const WING_WORDS = Object.freeze({
  station: 'On your wing', rejoin: 'Coming back to your wing', cover: 'Breaking onto the hunter',
  shoot: 'Firing on the hunter', clear: 'Looking for the hunter', down: 'Down',
});

/** The same, short, for their mark in the view. */
const WING_SHORT = Object.freeze({ station: 'ON YOUR WING', rejoin: 'COMING BACK', cover: 'BREAKING', shoot: 'FIRING', clear: 'LOOKING', down: 'DOWN' });
export const wingShort = phase => WING_SHORT[phase] ?? WING_SHORT.station;

/** A wingman's words for `phase` (unknown phases read as on your wing). */
export const wingWords = phase => WING_WORDS[phase] ?? WING_WORDS.station;

/** A target is kept unless another is this much nearer (`dogfight-fight.js`). */
const SWITCH = 0.67;

/**
 * Whom the hunter goes after: 1 (you) or 2 (your wingman), the nearer, the
 * one it has kept unless the other is a third nearer, as `runFight` picks
 * a pilot's target. `prev` the last answer; a wingman down (null) leaves you.
 */
export function huntTarget(prev, ace, you, wing) {
  if (!ace) return 1;
  if (!wing) return 1;
  const d1 = you ? len(sub(you.position, ace.position)) : Infinity;
  const d2 = len(sub(wing.position, ace.position));
  const near = d2 < d1 ? 2 : 1;
  if (prev !== 1 && prev !== 2) return near;
  const dPrev = prev === 2 ? d2 : d1, dNear = near === 2 ? d2 : d1;
  return dNear < SWITCH * dPrev ? near : prev;
}

/**
 * One tick of the wingman's pilot, as `runFight` steps it: their own plane
 * (`me`), you their leader (index 1) and the hunter (index 0) as the fight
 * hands them, each seen at the wingman's airframe's pace (`fit.pace`), the
 * hunter's type's level speed beside their own (`PLANS.wingman` holds off a
 * faster one met nose to nose). `ace` null when the hunter is down.
 */
export function stepWing(pilot, fit, { me, you, ace, aceLevel = null, dt, t, groundAt, arena = null }) {
  const view = pilotView(fit.pace);
  const hand = s => (s && fit.hand && s.hand === undefined ? { ...s, hand: fit.hand } : s);
  const seen = s => view.see(s);
  const friends = you ? [{ i: 1, state: seen(you), level: fit.level ?? null }] : [];
  const enemies = ace ? [{ i: 0, state: seen(ace), level: aceLevel }] : [];
  return pilot.step({
    me: seen(hand(me)), him: seen(ace ?? you ?? me), dt, t, groundAt: view.ground(groundAt), ceilingBase: 0,
    arena: view.arena(arena), pace: fit.pace,
    team: { index: 2, target: ace ? 0 : -1, friends, enemies, level: fit.level ?? null },
  });
}

/**
 * The end card of the pair flown: who shot whom, whether the wingman saved
 * you, and when. `how` is what ended it: `'ace'` the hunter down, `'you'`
 * the hunter's rounds enough to shoot you down, `'time'` the lesson's
 * minute over with you still flying; `by` who brought the hunter
 * down (`'you'`, `'gunner'`, `'wingman'`); the counts are rounds that met.
 */
export function pairEnd({ how, by = null, t, onYou = 0, onWing = 0, wingOnAce = 0, gunnerOnAce = 0, youOnAce = 0,
                          wingDown = false, wingEngaged = false, plane = 'your plane' }) {
  const at = `${Math.round(t)} s`;
  const lines = [];
  if (how === 'ace') {
    const who = by === 'wingman' ? 'Your wingman' : by === 'gunner' ? 'Your rear gunner' : 'You';
    lines.push(`${who} shot the hunter down at ${at}.`);
  } else if (how === 'time') {
    lines.push(`${at} and the hunter never shot you down${onYou ? ` (${onYou} rounds met)` : ''}.`);
  } else {
    lines.push(`The hunter shot ${plane === 'your plane' ? 'you' : `your ${plane}`} down at ${at}.`);
  }
  const saved = (how === 'ace' && onYou < 22 && (by === 'wingman' || (wingEngaged && wingOnAce > 0)))
    || (how === 'time' && wingEngaged && !wingDown);
  if (saved && how === 'time') lines.push('Your wingman saved you: they turned onto the hunter and drew it off your tail.');
  else if (saved) lines.push('Your wingman saved you: they turned onto the hunter on your tail.');
  else if (how === 'time' && wingDown) lines.push('Your wingman was shot down; you held on alone.');
  else if (how !== 'ace' && wingDown) lines.push('Your wingman was shot down first: you were alone.');
  else if (how !== 'ace' && !wingEngaged) lines.push('Your wingman never got onto the hunter: stay where they can reach you.');
  else if (how !== 'ace') lines.push('Your wingman broke onto the hunter, but too late.');
  const hits = [`on you ${onYou}`, `on your wingman ${onWing}`, `yours on it ${youOnAce}`, `your wingman's ${wingOnAce}`];
  if (gunnerOnAce) hits.push(`your gunner's ${gunnerOnAce}`);
  lines.push(`Rounds that met: the hunter's ${hits.slice(0, 2).join(', ')}; ${hits.slice(2).join(', ')}.`);
  return {
    tone: how === 'you' ? 'danger' : 'go',
    title: how === 'ace' ? (by === 'wingman' ? 'Your wingman got them' : 'The hunter is down') : how === 'time' ? 'You came through' : 'Shot down',
    lines, saved,
  };
}

/** The hunter's own words about the plane it is after, when that is your
 *  wingman: "he", "him" and "his" are them. */
export function aboutWing(say) {
  return String(say ?? '')
    .replace(/\bHe is\b/g, 'Your wingman is').replace(/\bhe is\b/g, 'your wingman is')
    .replace(/\bHe\b/g, 'Your wingman').replace(/\bhe\b/g, 'your wingman')
    .replace(/\bhimself\b/g, 'themselves').replace(/\bhim\b/g, 'your wingman').replace(/\bhis\b/g, "your wingman's")
    .replace(/\bHis\b/g, "Your wingman's");
}
