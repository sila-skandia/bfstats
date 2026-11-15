// Match recaps' picker under node (replay-recap-pick.js, features/match-recap):
// how salty a chat line is, which lines make the salt, and what counts as a
// stutter. One node run, one JSON report.
// watches: tools/bf1942-models/viewer/replay-recap-pick.js

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const P = await import(pathToFileURL(path.join(viewer, 'replay-recap-pick.js')).href);
const R = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);

/** A round with a roster and its chat box: `[t, pid, text]` lines. */
function chatRound(lines) {
  const out = [JSON.stringify({ k: 'roster', t: 0, p: [[0, 2, 0, 'Maj.MerliN', 0], [1, 1, 0, 'Tyson', 1], [2, 1, 1, 'Bot_7', 0], [3, 2, 0, 'Chad Negro', 0]] })];
  for (const [t, pid, text] of lines) out.push(JSON.stringify({ k: 'chat', t, pid, team: pid === 1 ? 1 : 2, text }));
  out.push(JSON.stringify({ k: 's', t: 400, o: [] }));
  return R.parseRecording(out.join('\n'));
}

const rec = chatRound([
  [10, 0, 'Maj.MerliN: HOW FUQING STUPID ARE U'],
  [14, 0, 'Maj.MerliN: UR AN IDIOT AND THIS IS PROOF'],
  [60, 1, 'Tyson [axis]: LETS SINK THESE JERMANS'],
  [70, 1, 'Tyson: shit sorry'],
  [80, 2, 'Bot_7: fucking campers'],
  [90, -1, '*Any player causing problems? Report in our forum.'],
  [100, 1, 'Tyson: !kick 26'],
  [110, 1, 'Tyson: BANZAI'],
  [120, 3, 'Chad Negro: this server is rigged'],
  [130, 1, 'Tyson [axis]: stop raping main base MORON'],
  [131, 1, 'Tyson [axis]: admin????'],
  [140, 0, 'Maj.MerliN: you are all n1ggers'],
  [200, 0, 'Maj.MerliN: HOW FUQING STUPID ARE U'],
]);

/** A man running +x at 5 m/s, sampled every `every` s; `still` stands him
 *  still from t 5 on. */
function runner(every, { still = false } = {}) {
  const lines = [JSON.stringify({ k: 'e', t: 0, e: 'createObject', netId: 7, tmpl: 'Tiger', tid: 1701, pos: [0, 0, 0], rot: [0, 0, 0] })];
  lines.push(JSON.stringify({ k: 'o', t: 0, id: 7, tmpl: 'Tiger', tid: 1701, team: 1, maxhp: 60 }));
  for (let t = 0; t <= 10.0001; t += every) {
    const x = still ? Math.min(t, 5) * 5 : t * 5;
    if (still && t > 5 && t < 9.9) continue;
    lines.push(JSON.stringify({ k: 's', t: Math.round(t * 1000) / 1000, o: [[7, x, 0, 0, 0, 0, 0, 1]] }));
  }
  return R.parseRecording(lines.join('\n')).lives.find(l => l.tmpl === 'Tiger');
}

const salt = P.saltOf(rec);
console.log(JSON.stringify({
  scores: ['fucking asshole', 'LETS SINK THESE JERMANS', 'BANZAI', 'shit man - sry', 'WORTHLESS BS', 'stupid camper', 'nice shot', 'gg ez noobs', 'you f4ggot'].map(t => P.saltScore(t).score),
  slur: P.saltScore('you are a retard').slur,
  hot: P.saltScore('stupid fucking camper').hot,
  parts: [P.chatParts('Tyson [axis]: admin????'), P.chatParts('*Welcome')],
  salt: salt.map(s => ({ name: s.name, team: s.team, teamChat: s.teamChat, lines: s.lines.map(l => l.text) })),
  secs: salt.map(s => P.slideSeconds(s)),
  gaps: {
    full: P.sampleGapAt(runner(0.104), 4.05),
    stutter: P.sampleGapAt(runner(0.2), 4.05),
    standing: P.sampleGapAt(runner(0.104, { still: true }), 7),
    outside: P.sampleGapAt(runner(0.104), 30),
  },
  tune: { reach: P.RECAP.reach, gap: P.RECAP.gap, duels: P.RECAP.duels, min: P.RECAP.min, budget: P.RECAP.budget, beat: P.RECAP.beat },
}));
