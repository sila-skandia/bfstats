// The dogfight school's coach (features/dogfight-school): what to say to a
// pilot flying against one of the school's aces, a frame at a time. Pure:
// the lesson, what the ace is doing (`pilot.step`'s answer) and both
// aircraft's states in, one line of what is happening, one of what to do,
// the keys that do it, and how urgent it is.
//
// A move being practised (the Dip, the Flip or the Ninja: `move`) speaks
// first after the ground and the stall: its name and what its pilot is doing
// in your seat now. Then the ace's own phase (the lesson's `coach` table):
// the move being flown at you, and its answer. Then the rules that hold in
// every fight, worst first: the ground, being slow, a bandit on your tail,
// a shot you could take. Boelcke's rules (features/dogfight-doctrine) speak
// where they apply, each line carrying its rule's number (`rule`): hold fire
// past the plane's useful range (3), no advantage going in (1), committed to
// a dive (2), lost sight of them (4), coming in from the side (5).

import { geometry, situation } from './dogfight-pilot.js';
import { len, pitchOf } from './dogfight-flight.js';

/** Tones, worst first. */
export const TONE = { danger: 'danger', warn: 'warn', go: 'go', info: 'info' };

/**
 * The coach's words for this frame. `you` and `him` are flight states
 * (`dogfight-flight.js` `stateOf`), `ace` the ace's last answer (`phase`,
 * `say`, `fire`), `ground` the floor's height under you, `move` the move
 * being practised (`{ name, say, phase }`: what the guide's pilot is doing).
 */
export function coach(lesson, ace, you, him, { ground = 0, gunRange = 350, move = null, useful = null, falloff = null, seen = null, offScreen = 0 } = {}) {
  const g = geometry(you, him);
  const sit = situation(g);
  const agl = you.position[1] - ground;
  const speed = len(you.velocity);
  const lines = [];
  // The floor, always first.
  if (agl < 60 + Math.max(0, -you.velocity[1]) * 3) {
    lines.push({ tone: TONE.danger, line: 'GROUND', tip: 'Pull up now: roll wings level and pull back.', keys: ['Mouse', 'Arrows'] });
  }
  // Out of speed: nothing else works until this does.
  if (speed < 28 && agl > 80) {
    lines.push({ tone: TONE.danger, line: `Slow: ${Math.round(speed)} m/s`, tip: 'Nose down and full throttle. Below 30 m/s a Spitfire can barely turn.', keys: ['W', 'Mouse'] });
  }
  // The move you are practising, and what to do in it now.
  if (move?.say) lines.push({ tone: TONE.go, line: move.name, tip: move.say, keys: [], phase: move.phase, move: true });
  // The move he is flying at you, and its answer.
  const phase = ace?.phase;
  const said = lesson?.coach?.[phase];
  if (said) lines.push({ tone: sit === 'defensive' ? TONE.danger : TONE.warn, line: said.line, tip: said.tip, keys: said.keys ?? [], phase });
  // A bandit on your tail, inside his guns.
  if (sit === 'defensive' && g.range < gunRange + 80) {
    lines.push({ tone: TONE.danger, line: `They are on your tail, ${Math.round(g.range)} m`, tip: 'Break turn into them: roll toward them and pull hard. Do not fly straight.', keys: ['Mouse', 'Arrows'] });
  }
  // Lost sight of them (rule 4): they have been off your screen this long.
  if (offScreen >= 2 && g.range < 1400) {
    lines.push({ tone: TONE.warn, line: `Lost sight · ${Math.round(offScreen)} s`, tip: 'Find them: look back into your last turn. The sphere shows where they are.', keys: ['Mouse'], rule: 4 });
  }
  // A shot you could take, inside the plane's useful range; past it, hold
  // your fire (rule 3).
  const reach = useful ?? gunRange;
  if (g.ata < 8 && g.range < reach) {
    lines.push({ tone: TONE.go, line: `Guns: ${Math.round(g.range)} m`, tip: 'Fire! Put the sight a little ahead of them, where they are going.', keys: ['Space'] });
  } else if (useful && g.ata < 8 && g.range < Math.max(gunRange, useful * 1.8)) {
    const why = falloff?.start > 50 ? `Full damage inside ${Math.round(falloff.start)} m.` : falloff ? 'Your rounds weaken with every metre.' : "Past it your guns' streams part.";
    lines.push({ tone: TONE.info, line: `Hold fire: ${Math.round(g.range)} m`, tip: `Closer: fire inside ${Math.round(useful)} m. ${why}`, keys: ['Mouse'], rule: 3 });
  } else if (sit === 'offensive' && g.range < gunRange * 1.6) {
    lines.push({ tone: TONE.go, line: 'You are behind them', tip: g.closure > 18 && g.range < 250 ? 'Closing fast: ease the throttle (S) or pull up a little so you do not fly past.' : 'Close in and pull the sight ahead of them.', keys: ['Mouse'] });
  }
  // Going in (rules 1, 2 and 5): your nose on them inside 900 m, nobody on
  // your tail.
  const lead = -g.energy;
  if (sit !== 'defensive' && g.ata < 30 && g.range > 300 && g.range < 900) {
    if (pitchOf(you.orientation) < -20 && lead >= 50 && you.velocity[1] < -5) {
      lines.push({ tone: TONE.go, line: 'Committed', tip: 'You have the height: hold the dive to 150 m, fire, then zoom away. Do not break off halfway.', keys: ['Mouse', 'Space'], rule: 2 });
    } else if (lead < 50 && seen === true) {
      lines.push({ tone: TONE.warn, line: 'No advantage', tip: 'They see you and you have no height on them. Climb on the side away from them before you go in.', keys: ['Mouse', 'W'], rule: 1 });
    } else if (g.aspect > 60 && g.range < 700) {
      lines.push({ tone: TONE.info, line: g.aspect > 120 ? 'Head on' : 'From the side', keys: ['Mouse'], rule: 5,
        tip: `${g.aspect > 120 ? 'Their guns face yours. ' : ''}Swing round to their tail before you close: from behind they cannot see you or shoot.` });
    }
  }
  // Following him up when he is faster.
  if (pitchOf(you.orientation) > 50 && g.hisSpeed > speed + 6 && him.velocity[1] > 5) {
    lines.push({ tone: TONE.warn, line: 'Straight up after them', tip: 'Ease the nose down to 25 degrees: follow shallow, keep your speed, catch them at the top.', keys: ['Mouse'] });
  }
  // Practising a move, only the ground and the stall come before it: a
  // bandit on your tail is what the move is for.
  const floor = lines.find(l => l.line === 'GROUND' || l.line.startsWith('Slow'));
  const top = (move?.say ? floor ?? lines.find(l => l.move) : null) ?? lines.find(l => l.tone === TONE.danger) ?? lines[0] ?? {
    tone: TONE.info, line: sit === 'neutral' ? 'Neutral' : 'Watch them', tip: 'Keep your speed over 50 m/s and keep them in sight.', keys: ['W'],
  };
  return {
    ...top,
    others: lines.filter(l => l !== top).slice(0, 2),
    // Boelcke's rule in play when the top line is another: the live fight
    // gives it its own row.
    ruleLine: top.rule ? null : lines.find(l => l.rule) ?? null,
    situation: sit,
    geometry: g,
    energy: { you: g.myEnergy - ground, him: g.hisEnergy - ground, lead: Math.round(-g.energy) },
  };
}

/** A short verdict on who holds the energy, for the scope's caption. */
export function energyWords(lead) {
  if (Math.abs(lead) < 40) return 'Energy even';
  return lead > 0 ? `You +${Math.round(lead)} m of energy` : `They have +${Math.round(-lead)} m of energy`;
}
