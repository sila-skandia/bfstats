// A recorded fight in words (features/dogfight-recordings): how a plane is
// named, why a fight stopped, and the one line a list gives it. Light on
// purpose: the school's list (`dogfight-recorded.js`) and the replay's
// timeline (`replay-dogfights.js`) both say a fight this way, and the replay
// should not load the school's flight code to do it.

import { decodePlayerName } from './vehicle-players.js';

/** A plane template as people say it: `BF109` stays, `Ju88A` stays. */
export const planeName = tmpl => String(tmpl ?? 'plane').replace(/_/g, ' ');

/**
 * Why a recorded fight stopped (`end`, the detector's rule 8), in words:
 * `title` for the end card, `note` under it, `short` for a list line, and
 * `marks` whether the stop is a moment in the fight (a death, a pilot
 * leaving) rather than its last frame. `names` are the two pilots, decoded.
 * Null for a fight extracted before the detector said (rules version 1).
 */
export function endingWords(end, names) {
  if (!end) return null;
  const who = names[end.side] ?? 'pilot', other = names[1 - end.side] ?? 'pilot';
  const at = `${end.t.toFixed(1)} s`;
  switch (end.why) {
    case 'shot down':
      return { title: `${other} wins at ${at}`, note: `${other} shot ${who} down.`, short: `${other} shot ${who} down`, marks: true };
    case 'downed by another': {
      const by = decodePlayerName(end.by?.name ?? '') || 'someone else';
      const gun = end.by?.weapon ? ` with the ${planeName(end.by.weapon)}` : '';
      return { title: `${who} shot down at ${at}, by ${by}`, note: `Not by ${other}: ${by} got them${gun}, from outside this fight.`,
               short: `${who} shot down by ${by}${gun}`, marks: true };
    }
    case 'died':
      return { title: `${who} went down at ${at}`, note: 'Nobody was credited: the ground, a collision, or their own guns.', short: `${who} went down`, marks: true };
    case 'left his plane':
      return { title: `${who} left their plane at ${at}`, note: 'They bailed out or changed seats; the fight ends with them.', short: `${who} left their plane`, marks: true };
    case 'out of range':
      return { title: `Lost from the recording at ${at}`, note: `${who} flew out of the recording player's range: a client recording sees only what is near it, so the fight may well have gone on.`,
               short: `${who} out of the recorder's range`, marks: false };
    case 'apart':
      return { title: `They broke off at ${at}`, note: `${end.distance ? `${end.distance} m apart and opening` : 'Too far apart to go on'}: neither pressed it.`, short: 'they broke off', marks: false };
    case 'quiet': {
      const since = Number.isFinite(end.since) ? ` since ${end.since.toFixed(1)} s` : '';
      return { title: `Cut at ${at}: no shot${since}`, note: 'Still close and still turning, but neither fired again: the fight is cut there.',
               short: 'circling, nobody firing', marks: false };
    }
    default:
      return null;
  }
}

/** One line for a fight in a list: who, in what, how long, how it ended. */
export function fightLine(row) {
  const [a, b] = row.sides.map(s => `${decodePlayerName(s.name ?? '') || 'pilot'} (${planeName(s.tmpl)})`);
  const names = row.sides.map(s => decodePlayerName(s.name ?? '') || 'pilot');
  const end = endingWords(row.end, names)?.short
    ?? (row.kill ? `${names[row.kill.side]} shot ${names[1 - row.kill.side]} down` : 'no kill');
  return { title: `${a} v ${b}`, sub: `${Math.round(row.duration)} s · ${row.mutual ? 'both shooting' : row.kind === 'dogfight' ? 'turning fight' : 'bounce'} · ${end}` };
}
