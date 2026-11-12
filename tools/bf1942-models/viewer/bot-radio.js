// The bots' ear: `dice::bf::ai::AIRadio` (lnxded, AIRadio.cpp), the store
// a player's radio message raises in every bot that hears it, and what the
// Change behaviours read from it. Plain data and functions; the referee
// (bot-referee.js) owns one per level and feeds it the human's messages.
//
// What the binary shows (lnxded, read 2026-11-12):
//
//  * `GameServer::radioMessage` 0x0813a120 hands every message a living
//    player sends to `AIRadio::sendMessage(msg, team, speakerId, pos, 70.0,
//    isTeam)` (0x0813a26a; 70.0 is the `0x428c0000` pushed at 0x0813a23b),
//    when the server runs AI (`GameServer+0x64`). `pos` is the speaker's
//    controlled object, his hull when he is seated.
//  * `sendMessage` 0x08482650 drops a message nobody subscribed to (the
//    record's byte +0, 0x0848266a), then, for every bot of the speaker's team
//    (vt+0xd8, 0x084826b5) that is not dead (vt+0xbc) and is not the speaker
//    (vt+0xac): team radio is `receiveBroadCast` (gain 1); a shout reaches a
//    bot within the range (`range < d` skips, 0x084827a4) with gain
//    `range / d` (`fdivrp`, 0x084827cc), so 1 at 70 m and more the nearer.
//  * `receiveMessage` 0x084825e0 / `receiveBroadCast` 0x08482620:
//    `s += (1 - s) * gain * b`, `b` the record's +8. Not clamped: a shout
//    from under 56 m (gain x 0.8 > 1) lifts a fresh strength past 1.
//  * `update` 0x08482330 (`AIMain::action`): once at least 0.5 s has passed
//    since the last step (0x86b05e8), every subscribed strength of every bot
//    falls by `dt * a`, `a` the record's +4, and stops at 0.
//  * `subscribeToMessage` 0x084824e0 / 0x08482510 / 0x08482540: one argument
//    `a = 0.1, b = 0.5`; two `a = 1 / t, b = 0.5`; three `a = 1 / t, b = g`.
//    Vanilla `Game/AI/radio.con` (bf1942/game.rfa) subscribes 22 messages
//    with `10 0.8`, among them `RMLocalBailOut`, `RMLocalGetIn` and
//    `RMLocalAbandonShip`. FH, FHSW, FHSWEurope and EoD ship the same file;
//    GCMOD and bf1918 subscribe with one argument (b = 0.5); the other mods
//    ship none and run vanilla's.
//  * `BBChange::getRadioStrength(unit, bot)` 0x0855fc10: 1 for a soldier
//    unit (`Information+6 & 0x40`, bit 22, `ITSoldier`), else
//    `(1 + s[GetIn 0x33]) * (1 - s[x])` with `x` AbandonShip (0x35) for a
//    naval unit (`+4 & 0x40`, bit 6, `ITNaval`) and BailOut (0x2a) for any
//    other. `BBChangeTeleport::calculateUrgency` 0x085611f0 reads
//    `1 - s[x]` the same way (0x08561422..0x0856145b, 0x08561adb).
//
// The ids are the client's message ids (radio.js `RADIO_MESSAGES`), the
// same `RadioMessage` enum: BBTakeCoverInfantry's 0x29 is TakeCover (41).

/** `RMLocalTakeCover` .. the three Change reads. */
export const RM = Object.freeze({ TakeCover: 41, BailOut: 42, GetIn: 51, AbandonShip: 53 });

/** `GameServer::radioMessage`'s range for a shout (0x0813a23b). */
export const AI_RADIO_RANGE = 70.0;
/** `AIRadio::update` steps once this much time has passed (0x86b05e8). */
export const AI_RADIO_STEP = 0.5;

/** Vanilla `Game/AI/radio.con`: every message it subscribes, `10 0.8`. */
const VANILLA_SUBSCRIBED = [
  15, 16, 17, 18, 19, 20, 21,          // RMArmorSpotted .. RMScoutSpotted
  36, 49, 39, 41, 42,                  // Wait, Go, FireInHole, TakeCover, BailOut
  51, 52, 53,                          // GetIn, CheckYourSix, AbandonShip
  43, 44, 38, 37, 40, 54,              // CoverMe, HoldPosition, HoldFire, Fire, Medic, NeedRepairs
];

/** The mods whose `radio.con` subscribes with one argument (b = 0.5). */
const DEFAULT_GAIN_MODS = new Set(['gcmod', 'bf1918']);

/** The subscription table for a mod: `Map<id, { a, b }>`. */
export function subscriptionsFor(mod = 'bf1942') {
  const oneArg = DEFAULT_GAIN_MODS.has(String(mod ?? '').toLowerCase());
  const rec = oneArg ? { a: 0.1, b: 0.5 } : { a: 1 / 10, b: 0.8 };
  return new Map(VANILLA_SUBSCRIBED.map(id => [id, rec]));
}

/**
 * One level's AIRadio. `strength(botId, id)` is `getMessageStrength`;
 * `send(...)` is `sendMessage` over the bots the caller lists as
 * `{ playerId, team, position, dead }`; `update(now)` the decay step.
 */
export function createAIRadio({ mod = 'bf1942', subscriptions = subscriptionsFor(mod) } = {}) {
  const store = new Map();          // botId -> Map<id, s>
  let last = 0;
  const radio = {
    subscriptions,
    strength(botId, id) {
      return store.get(botId)?.get(id) ?? 0;
    },
    /** `receiveMessage` / `receiveBroadCast`: `s += (1 - s) * gain * b`. */
    receive(botId, id, gain = 1) {
      const rec = subscriptions.get(id);
      if (!rec) return;
      let row = store.get(botId);
      if (!row) store.set(botId, (row = new Map()));
      const s = row.get(id) ?? 0;
      row.set(id, s + (1 - s) * gain * rec.b);
    },
    /**
     * `sendMessage`: `team` the speaker's side, `speakerId` his player id,
     * `at` [x, y, z] of what he controls, `broadcast` true for team radio.
     */
    send(id, { team, speakerId = null, at = null, broadcast = false, bots = [], range = AI_RADIO_RANGE }) {
      if (!subscriptions.has(id)) return;
      for (const bot of bots) {
        if (bot.team !== team || bot.dead || bot.playerId === speakerId) continue;
        if (broadcast) { radio.receive(bot.playerId, id, 1); continue; }
        const p = bot.position;
        if (!at || !p) continue;
        const d = Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
        if (range < d) continue;
        // `range / d`; a speaker standing inside the bot (d = 0) would make
        // it infinite, which the float would carry on as NaN (a guard).
        radio.receive(bot.playerId, id, range / Math.max(d, 1e-3));
      }
    },
    /** `update`: every 0.5 s or more, each strength falls by `dt * a`, to 0. */
    update(now) {
      const dt = now - last;
      if (!(dt >= AI_RADIO_STEP)) return;
      for (const row of store.values()) {
        for (const [id, s] of row) {
          const rec = subscriptions.get(id);
          const v = s - dt * (rec?.a ?? 0);
          row.set(id, v > 0 ? v : 0);
        }
      }
      last = now;
    },
    reset() { store.clear(); last = 0; },
  };
  return radio;
}

/**
 * `BBChange::getRadioStrength` 0x0855fc10 for a unit of `kind` ('foot' for
 * the soldier, 'ship' for a naval unit) and the bot's strengths `s(id)`.
 */
export function changeRadioStrength(kind, s) {
  if (kind === 'foot') return 1;
  const leave = kind === 'ship' ? s(RM.AbandonShip) : s(RM.BailOut);
  return (1 + s(RM.GetIn)) * (1 - leave);
}

/** `BBChangeTeleport`'s message term: the strength in `1 - s` (0x0856145b). */
export function teleportRadioStrength(kind, s) {
  return kind === 'ship' ? s(RM.AbandonShip) : s(RM.BailOut);
}
