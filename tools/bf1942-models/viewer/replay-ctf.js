// Capture the Flag in a replay: where each flag is at a time, worked out from
// the recording, for the page's own flags to draw (ctf-page.js `showState`,
// features/replay-feature-sweep-2026-11-01 entry 15).
//
// What is recorded: who took a flag and who let one go (FlagHolderEvent 0x1E,
// `rec.flagHolds`: a client's raw event, a server recording's from BFPlayer's
// carrier byte, core.c `sample_players`), the score the server paid for a
// capture, a pick-up and a return (ScoreMsg kinds 0, 1 and 2, `rec.scores`;
// ledger CTF-2..CTF-4, CTF-6), and the deaths. What is worked out, by the
// server's law:
//   - the flag a player takes is the one of the other side (two flags, one a
//     side, CTF-1); every pick-up, at the base or off the ground, pays Attack
//     (Flag::handlePickup, CTF-3, CTF-4), so an Attack is a take too where the
//     file has no FlagHolder for it (the feed's El Alamein CTF client file
//     558jj8m4nb has five thefts before its first FlagHolder);
//   - a carrier's death lets his flag go where he fell (CTF-5);
//   - a flag let go by a carrier the server paid a capture to goes home
//     (CTF-2: a living carrier's drop at his base is the capture); any other
//     lies where its carrier was (CTF-5 puts it on the terrain under him plus
//     1.5 m; the page's `orient` lays it on the slope);
//   - a flag on the ground goes home when a player of its own side is paid a
//     return (Defence), or when its `TimeToReSpawn` has run (CTF-4).
// Where a lying flag is, is the carrier's place as the recording last had him.

import { whereIs } from './replay-battles.js';
import { teamAt } from './replay-recording.js';

/** Score kinds (replay-recording.js `SCORE`): a flag capture and a return. */
const CAPTURE = 0;
const ATTACK = 1;
const DEFENCE = 2;
/** Seconds between a capturer's drop and his capture's score that are one
 *  call (GameServer::handleDrop then handleScore, a sample apart at most). */
const SAME_CALL = 0.5;
/** Metres the flag lies over the ground under its dead carrier (CTF-5). */
const DROP_HEIGHT = 1.5;

/**
 * Each flag at `t`: `[{ index, team, home, carrier, carrierTeam, position }]`
 * over `flags` (the page's law's, ctf.js: `index`, `team`, `position` at
 * home, `respawnIn` its TimeToReSpawn). `positionOf(pid, t)` answers where a
 * player is, `[x, y, z]` in the page's frame, or null; `groundAt(x, z)` the
 * terrain's height, or null.
 */
export function ctfStateAt(rec, t, flags, positionOf, groundAt = null) {
  const out = (flags ?? []).map(f => ({
    index: f.index, team: f.team, home: true, carrier: null, carrierTeam: 0,
    position: f.homePosition ? f.homePosition.slice() : f.position.slice(),
    homeAt: (f.homePosition ?? f.position).slice(),
    droppedAt: null, respawn: Number.isFinite(f.respawnIn) ? f.respawnIn : 30,
  }));
  if (!out.length) return out;
  const events = [];
  for (const h of rec?.flagHolds ?? []) if (h.t <= t) events.push({ t: h.t, kind: h.flag ? 'take' : 'drop', pid: h.pid });
  for (const s of rec?.scores ?? []) {
    if (s.t > t + SAME_CALL) continue;
    if (s.kind === CAPTURE) events.push({ t: s.t, kind: 'capture', pid: s.pid });
    else if (s.kind === DEFENCE && s.t <= t) events.push({ t: s.t, kind: 'return', pid: s.pid });
    else if (s.kind === ATTACK && s.t <= t) events.push({ t: s.t, kind: 'take', pid: s.pid });
  }
  for (const d of rec?.deaths ?? []) if (d.t <= t) events.push({ t: d.t, kind: 'drop', pid: d.pid, death: true });
  events.sort((a, b) => a.t - b.t);
  const captures = events.filter(e => e.kind === 'capture');
  const goHome = f => {
    f.home = true; f.carrier = null; f.carrierTeam = 0; f.droppedAt = null;
    f.position = f.homeAt.slice();
  };
  const settle = until => {
    for (const f of out) if (f.droppedAt !== null && until - f.droppedAt > f.respawn) goHome(f);
  };
  for (const e of events) {
    if (e.t > t) continue;
    settle(e.t);
    const team = teamAt(rec, e.pid, e.t);
    if (e.kind === 'take') {
      // His already (the FlagHolder and the Attack of one pick-up), or the
      // other side's flag: one not carried first, else the one a carrier
      // holds whose loss the file did not have (a death out of its range).
      if (out.some(f => f.carrier === e.pid)) continue;
      const flag = out.find(f => f.team !== team && f.carrier === null)
        ?? out.find(f => f.team !== team) ?? null;
      if (!flag) continue;
      flag.home = false; flag.carrier = e.pid; flag.carrierTeam = team ?? 0; flag.droppedAt = null;
    } else if (e.kind === 'drop') {
      const flag = out.find(f => f.carrier === e.pid);
      if (!flag) continue;
      if (!e.death && captures.some(c => c.pid === e.pid && Math.abs(c.t - e.t) <= SAME_CALL)) { goHome(flag); continue; }
      flag.carrier = null; flag.carrierTeam = 0; flag.droppedAt = e.t;
      const at = positionOf?.(e.pid, e.t);
      if (Array.isArray(at)) {
        const ground = groundAt?.(at[0], at[2]);
        flag.position = [at[0], Number.isFinite(ground) ? ground + DROP_HEIGHT : at[1], at[2]];
      }
    } else if (e.kind === 'return') {
      const flag = out.find(f => f.team === team && !f.home && f.carrier === null);
      if (flag) goHome(flag);
    }
  }
  settle(t);
  for (const f of out) {
    if (f.carrier === null) continue;
    const at = positionOf?.(f.carrier, t);
    if (Array.isArray(at)) f.position = at.slice();
  }
  return out.map(({ homeAt, droppedAt, respawn, ...f }) => f);
}

/** The same for a replay player (replay.js), by its recording and time. */
export function replayCtfState(player, flags, groundAt = null) {
  if (!player?.rec?.flagHolds?.length) return null;
  const rec = player.rec;
  const positionOf = (pid, at) => whereIs(rec, pid, at, player.kills ?? rec.kills).pos;
  return ctfStateAt(rec, player.time, flags, positionOf, groundAt);
}
