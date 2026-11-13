// The side a player joins when none is asked for: retail's
// `PlayerManager::getTeamToAddPlayer(float ratio1, float ratio2)` (lnxded
// 0x08261670), which `GameServer::setTeam(BFPlayer*, int)` 0x08131800 calls
// for team 0 or under `autoBalanceTeam` with the server's team ratios
// (`+0x2bc`, `+0x2c0`), and which the bot top-up in `gameStatusPlaying`
// calls for each new bot (0x08150ee3). Read 2026-11-12 from the x87 code:
//
//   - it counts every player on team 1 (`n1`) and on team 2 (`n2`), bots
//     included (the list walk 0x08261696..0x082616ba, `+0x7c` the team);
//   - with S = ratio1 + ratio2 and N = n1 + n2, each side's excess over its
//     share is d1 = n1/N - ratio1/S and d2 = n2/N - ratio2/S
//     (0x082616bc..0x082616f2); the side over its share loses: d1 > d2 gives
//     team 2 (0x082616fd), d2 > d1 team 1 (0x0826170e);
//   - otherwise (equal, or N = 0, where the shares are NaN and every compare
//     is unordered) it weighs the two choices with the newcomer counted,
//     X = |((n1+1)/(N+1) - ratio1/S) - (n2/(N+1) - ratio2/S)| for team 1 and
//     Y = |(n1/(N+1) - ratio1/S) - ((n2+1)/(N+1) - ratio2/S)| for team 2
//     (0x08261714..0x0826176f), takes the smaller (X > Y gives team 2,
//     0x0826177a; Y > X team 1, 0x08261795), and breaks a tie with
//     `rand() & 1` + 1 (0x0826179e).
//
// objdump prints the reversed-operand x87 forms (`fsubp %st,%st(i)`,
// `fdivp %st,%st(i)`) with AT&T's swapped mnemonics: each is st(i) =
// st0 - st(i) (st0 / st(i)), which is what makes d1 n1/N - ratio1/S and not
// its negative.

/**
 * @param {number} n1      players on team 1, bots included
 * @param {number} n2      players on team 2
 * @param {number} ratio1  the ratio `setTeam` passes first (`GameServer+0x2bc`)
 * @param {number} ratio2  the second (`+0x2c0`)
 * @param {() => number} random  a [0, 1) source for the tie (`rand() & 1`)
 * @returns {1|2}
 */
export function teamToAddPlayer(n1, n2, ratio1 = 1, ratio2 = 1, random = Math.random) {
  const s = ratio1 + ratio2;
  const n = n1 + n2;
  const d1 = n1 / n - ratio1 / s;
  const d2 = n2 / n - ratio2 / s;
  if (d1 > d2) return 2;
  if (d2 > d1) return 1;
  const m = n + 1;
  const x = Math.abs((n1 + 1) / m - ratio1 / s - (n2 / m - ratio2 / s));
  const y = Math.abs((n1 / m - ratio1 / s) - ((n2 + 1) / m - ratio2 / s));
  if (x > y) return 2;
  if (y > x) return 1;
  return random() < 0.5 ? 1 : 2;
}
