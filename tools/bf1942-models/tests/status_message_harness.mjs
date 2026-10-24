// Drives `viewer/status-message.js` outside a browser.
import { createStatusMessage, stepStatusMessage } from './status-message.js';

const out = {};
const frames = (s, n, dt, args) => {
  const seen = [];
  for (let i = 0; i < n; i++) {
    stepStatusMessage(s, dt, args);
    seen.push(s.show ? s.text : null);
  }
  return seen;
};

// A lab Wake round: min players 2, nine on the server. The line reads GAME IS
// RESTARTING from the first frame and is gone after five seconds.
{
  const s = createStatusMessage();
  const seen = frames(s, 70, 0.1, { status: 3, minPlayers: 2, players: 9 });
  out.join = { first: seen[0], at49: seen[49], at50: seen[50], last: seen[69] };
}

// One player short: the count, following the players, until the second joins.
{
  const s = createStatusMessage();
  const short = frames(s, 3, 0.1, { status: 3, minPlayers: 3, players: 1 });
  const nearly = frames(s, 1, 0.1, { status: 3, minPlayers: 3, players: 2 });
  const enough = frames(s, 1, 0.1, { status: 3, minPlayers: 3, players: 3 });
  out.short = { short: short[2], nearly: nearly[0], enough: enough[0] };
}

// The end of a round clears the latch, so the next round shows the line again.
{
  const s = createStatusMessage();
  frames(s, 80, 0.1, { status: 1, minPlayers: 2, players: 9 });
  const before = s.show;
  frames(s, 5, 0.1, { status: 2, minPlayers: 2, players: 9 });
  const after = frames(s, 1, 0.1, { status: 3, minPlayers: 2, players: 9 });
  out.restart = { before, after: after[0] };
}

// Nothing known: no line.
{
  const s = createStatusMessage();
  out.unknown = frames(s, 2, 0.1, { status: 1, minPlayers: null, players: 9 })[1];
}

console.log(JSON.stringify(out));
