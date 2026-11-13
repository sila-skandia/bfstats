// A room's votes: retail's map vote, kick vote and team kick vote, read from
// the dedicated server (lnxded.static) and run on the room's own clock.
//
// `GameServer` holds four `Vote` objects (`getVoteObjectFromType` 0x08149d10):
// the map vote at `+0x320`, the kick vote at `+0x360` and one team kick vote a
// side at `+0x3a0 + team * 0x40`. A `Vote` (ctor 0x0815dab0) starts enabled
// (`+1 = 1`), with a majority of 0.6 (`+0x10 = 0x3f19999a`) and two options,
// 0 and 1 (`+0x8`, `+0xc`): 0 is yes (the issuer's own vote, `voteMap`
// 0x0814a000 pushes option 0; the VoteEvent's "yes" byte is count 0).
//
// `GameServer::castVote(type, player, target, option, team)` 0x081497c0, in
// its order:
//   - a type that is switched off answers the caller alone, "Vote Failed: %s
//     is disabled on server." (0x086c06e0; the names are "Map Vote",
//     "Kick Vote", "Kick Vote (Team)", 0x086c0872 / 0x086c0868 / 0x086c0857);
//   - a vote of that type already running on another target: "Vote Failed: %s
//     already in progress." (0x086c0720);
//   - a map id outside the map list: "Vote Failed: Map id outside Map Cycle"
//     (0x086c0760); a kick target that is no player: "Vote Failed: Target
//     player not found." (0x086c0820);
//   - a team kick asked or voted on by a player of the other side: "%s
//     Failed: Target player not on the same team." (0x086c07e0);
//   - with none running, the caller issues one, unless they issued one of
//     this type less than 180 s ago (`BFPlayer+0x1a0 + type * 4`, 180.0 at
//     0x086c031c): "Vote Failed: Minimum %d seconds between issuing votes."
//     (0x086c07a0, `push $0xb4`). Issuing fixes the votes needed
//     (`calcVotesNeeded` 0x08148880: `ceil(players * majority)` under x87
//     round-up, over every player for a map or kick vote, vt+0x78, and over
//     the target's side for a team kick, vt+0x7c) and the end time, now +
//     `votingTime` (`GameServer+0x31c`, 60.0 from the ctor 0x0812f1ef;
//     `Vote::issueVote` 0x0815dd50);
//   - the vote is laid (`Vote::layVote` 0x0815dc30, `insert_unique` on the
//     player: a player's first vote stands) and a VoteEvent goes to everyone
//     (vt+0x210 `sendGameEventToAll`): target, yes, no, required, the voter,
//     the type, and action 0 with the voting time for the issue, action 3
//     for a vote laid on a running one (0x08149ae7..0x08149b66; NET-20).
//
// `GameServer::updateVoteSystemVote` 0x08149dc0, every server frame on each
// of the four (`updateVoteSystem` 0x08149d60): a running vote ends the frame
// its yes count reaches the votes needed, or when its time is out. It sends a
// VoteEvent with action 2 (passed, required 0) or action 1 (failed, required
// = needed - yes). A passed map vote calls `changeMap(target)` (vt+0x348,
// 0x081496b0: the map list's entry, `setNextLevel` + `runNextLevel`); a
// passed kick or team kick calls `banPlayer(target, "Round")` (vt+0x344,
// 0x08148f60: the address banned for the round, then `kickPlayer`). A "no"
// never ends a vote early. A kick vote whose target has left answers "Vote
// failed: Target not found" (0x086c087b) and the vote runs out.
//
// The shipped `AdminSettings.con` writes the same values the constructors
// do: all three votes on, each majority 0.6, `admin.votingTime 60`.

/** `Vote::VoteType`. */
export const VOTE_TYPE = Object.freeze({ map: 0, kick: 1, teamKick: 2 });
/** The VoteEvent's action (`+0x15`): issued, failed, passed, a vote laid. */
export const VOTE_ACTION = Object.freeze({ issued: 0, failed: 1, passed: 2, laid: 3 });
/** `Vote::VoteOption`: 0 yes, 1 no (the ctor's `+0x8`, `+0xc`). */
export const VOTE_OPTION = Object.freeze({ yes: 0, no: 1 });

/** The `Vote` ctor's majority, 0.6 (0x0815dada), and `GameServer`'s voting
 *  time, 60 s (0x0812f1ef). */
export const VOTE_MAJORITY = 0.6;
export const VOTING_TIME = 60;
/** Seconds a player waits between two votes of a type they issue (180.0 at
 *  0x086c031c, printed as `%d` 180). */
export const VOTE_ISSUE_GAP = 180;

const NAMES = ['Map Vote', 'Kick Vote', 'Kick Vote (Team)'];

/**
 * `calcVotesNeeded` 0x08148880: the player count (`fildl`) times the vote's
 * majority, a float32 (`fmuls`, 0x081488b4), rounded up on the x87 stack
 * (`frndint` under control word 0x800, 0x081488ba..0x081488d2) before it is
 * ever stored. The majority is the float32 nearest the number set, and 0.6f
 * is 0.60000002384, a hair over 0.6, so a count whose 60 % is whole needs one
 * more than the arithmetic says: 5 players need 4, 10 need 7, 15 need 10.
 */
export function votesNeeded(players, majority = VOTE_MAJORITY) {
  return Math.ceil(Math.trunc(players) * Math.fround(majority));
}

/** The vote settings a room starts with (`admin.enableMapVote`,
 *  `enableKickPlayerVote`, `enableKickTeamPlayerVote`, the three majorities
 *  and `admin.votingTime`). */
export function defaultVoteSettings() {
  return {
    enabled: [true, true, true],
    majority: [VOTE_MAJORITY, VOTE_MAJORITY, VOTE_MAJORITY],
    votingTime: VOTING_TIME,
  };
}

/**
 * @param {object} ctx
 * @param {() => number} ctx.now          seconds, the room's clock
 * @param {() => Iterable<{slot, team}>} ctx.players  the room's players
 * @param {() => number} ctx.mapCount     entries in the room's map list
 * @param {(row) => void} ctx.onRow       a `vote` row to every client
 * @param {(slot, text) => void} ctx.say  a server line to one player
 * @param {(slot) => void} ctx.onKick     a passed kick: ban for the round
 * @param {(index) => void} ctx.onMap     a passed map vote: change to it
 * @param {object} [ctx.settings]         `defaultVoteSettings()`'s shape
 */
export function createRoomVotes(ctx) {
  const settings = ctx.settings ?? defaultVoteSettings();
  const blank = type => ({ type, active: false, endAt: -1, target: 0, team: 0, needed: 0,
                           votes: new Map() });
  /** map, kick, team kick for side 1, team kick for side 2. */
  const votes = [blank(0), blank(1), blank(2), blank(2)];
  /** slot -> [the time they last issued a vote of each type] (`+0x1a0`). */
  const issuedAt = new Map();
  /** map index -> votes laid for it in this map vote (`GameServer+0xec`,
   *  what `game.listMaps` prints as ` NumVotes:%d`). */
  let mapVotes = new Map();

  const voteOf = (type, team) => type === 2 ? votes[team === 2 ? 3 : 2] : votes[type === 1 ? 1 : 0];
  const playerOf = slot => { for (const p of ctx.players()) if (p.slot === slot) return p; return null; };
  const countAll = () => { let n = 0; for (const _ of ctx.players()) n++; return n; };
  const countSide = team => { let n = 0; for (const p of ctx.players()) if (p.team === team) n++; return n; };
  const running = vote => vote.active && ctx.now() < vote.endAt;
  const tally = vote => {
    let yes = 0, no = 0;
    for (const option of vote.votes.values()) if (option === 0) yes++; else no++;
    return { yes, no };
  };
  const eventRow = (vote, action, extra = {}) => {
    const { yes, no } = tally(vote);
    return { type: 'vote', kind: vote.type, target: vote.target, yes, no,
             required: vote.needed, action, team: vote.team, ...extra };
  };

  /**
   * `castVote`: `slot` votes `option` on `target` in a vote of `type`,
   * issuing it when none runs. Returns whether a vote was laid.
   */
  function cast(type, slot, target, option = 0) {
    const player = playerOf(slot);
    if (!player || !(type === 0 || type === 1 || type === 2)) return false;
    if (!Number.isInteger(target)) return false;
    const vote = voteOf(type, player.team);
    const name = NAMES[type];
    if (!settings.enabled[type]) {
      ctx.say(slot, `Vote Failed: ${name} is disabled on server.`);
      return false;
    }
    const inProgress = running(vote);
    if (inProgress && vote.target !== target) {
      ctx.say(slot, `Vote Failed: ${name} already in progress.`);
      return false;
    }
    let victim = null;
    if (type === 0) {
      if (target < 0 || target > ctx.mapCount() - 1) {
        ctx.say(slot, 'Vote Failed: Map id outside Map Cycle');
        return false;
      }
    } else {
      victim = playerOf(target);
      if (!victim) {
        ctx.say(slot, 'Vote Failed: Target player not found.');
        return false;
      }
      if (type === 2 && victim.team !== player.team) {
        ctx.say(slot, `${name} Failed: Target player not on the same team.`);
        return false;
      }
    }
    let issuing = false;
    if (!inProgress) {
      const mine = issuedAt.get(slot) ?? [0, 0, 0];
      // `fldz; fucom`: a player who never issued one (0) is not held.
      if (mine[type] !== 0 && mine[type] + VOTE_ISSUE_GAP > ctx.now()) {
        ctx.say(slot, `Vote Failed: Minimum ${VOTE_ISSUE_GAP} seconds between issuing votes.`);
        return false;
      }
      issuing = true;
      if (type === 0) mapVotes = new Map();
      else vote.team = victim.team;
      vote.needed = votesNeeded(type === 2 ? countSide(vote.team) : countAll(), settings.majority[type]);
      vote.target = target;
      vote.votes = new Map();
      vote.active = true;
      vote.endAt = ctx.now() + settings.votingTime;
      mine[type] = ctx.now();
      issuedAt.set(slot, mine);
    }
    // `layVote`: an option outside 0..1 lays nothing; `insert_unique` keeps a
    // player's first vote.
    if (!(option === 0 || option === 1)) return false;
    if (!vote.votes.has(slot)) vote.votes.set(slot, option);
    if (type === 0) mapVotes.set(target, (mapVotes.get(target) ?? 0) + 1);
    ctx.onRow(eventRow(vote, issuing ? VOTE_ACTION.issued : VOTE_ACTION.laid,
      { voter: slot, time: issuing ? settings.votingTime : 0 }));
    return true;
  }

  /** `updateVoteSystem`: each running vote ends on its count or its clock. */
  function step() {
    for (const vote of votes) {
      if (!vote.active) continue;
      if (vote.type !== 0 && !playerOf(vote.target)) {
        // The target left: the engine says so to everyone each frame until
        // the vote runs out and never concludes it. Here it is said once and
        // the vote ends, failed.
        vote.active = false;
        ctx.say(null, 'Vote failed: Target not found');
        continue;
      }
      const { yes } = tally(vote);
      const passed = yes >= vote.needed;
      if (!passed && running(vote)) continue;
      vote.active = false;
      vote.endAt = 0;
      const required = passed ? 0 : vote.needed - yes;
      ctx.onRow({ ...eventRow(vote, passed ? VOTE_ACTION.passed : VOTE_ACTION.failed), required });
      if (!passed) continue;
      if (vote.type === 0) ctx.onMap(vote.target);
      else ctx.onKick(vote.target);
    }
  }

  return {
    settings,
    cast,
    step,
    /** A running vote of `type` for a player of `team`, as a `vote` row with
     *  the seconds left, or null (a joiner's HELLO). */
    state(type, team = 0) {
      const vote = voteOf(type, team);
      if (!running(vote)) return null;
      return { ...eventRow(vote, VOTE_ACTION.laid), time: Math.max(0, vote.endAt - ctx.now()) };
    },
    /** Votes laid for map `index` in the last map vote (` NumVotes:%d`). */
    mapVotes: index => mapVotes.get(index) ?? 0,
    /** A player left: their issue clock goes with their BFPlayer. Their laid
     *  vote stays in the count, as the engine's map keeps it. */
    forget(slot) { issuedAt.delete(slot); },
    /** A new level: no vote survives the load. */
    reset() {
      for (const vote of votes) { vote.active = false; vote.votes = new Map(); }
      mapVotes = new Map();
    },
  };
}
