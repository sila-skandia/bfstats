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
//    `a = 0.1, b = 0.5` (`0x3dcccccd`, `0x3f000000`); two `a = 1 / t,
//    b = 0.5`; three `a = 1 / t, b = g`. The message is a name, parsed by
//    `operator>>(istream&, RadioMessage&)` 0x08489060: a chain of string
//    compares over 46 names (`RADIO_MESSAGE_IDS` below), then
//    `RMNumberOfRadioMessages` -> 60, and any other word -> 0
//    (0x08489646..0x08489657: `sete; dec; and -60; add 60`). One name is
//    wrong in the binary: `RMShipSpotted` jumps to the store of the name
//    before it (`je 0x8489218` at 0x08489235, the `movl $0x11`), so it
//    parses to 17, RMUnitSpotted. Message 18 can never be subscribed, a
//    player's "Ship spotted" is dropped by `sendMessage`, and `BBScout`'s
//    read of it is always 0.
//    Vanilla `Game/AI/radio.con` (bf1942/game.rfa) has 21 lines, each `10
//    0.8`, which subscribe 20 messages (17 twice), among them
//    `RMLocalBailOut`, `RMLocalGetIn` and `RMLocalAbandonShip`. XPack1, XPack2, DesertCombat and DC_Final ship
//    none and run vanilla's; FH, FHSW, FHSWEurope and EoD ship the same 21
//    lines; GCMOD and bf1918 write the 21 with one argument (b = 0.5)
//    and add a 22nd line, `RMFirstRadioSpotted`, a name the parser does not
//    know: it subscribes message 0, which nobody sends.
//    The table a level plays under is its mod's own file, carried as
//    `radio` in the maps tree's `_shared/vehicle-ai.json`
//    (`extract_vehicle_ai.py` `radio_subscriptions`); a tree extracted before
//    that key existed runs the list built in here (`subscriptionsFor`).
//  * `BBChange::getRadioStrength(unit, bot)` 0x0855fc10: 1 for a soldier
//    unit (`Information+6 & 0x40`, bit 22, `ITSoldier`), else
//    `(1 + s[GetIn 0x33]) * (1 - s[x])` with `x` AbandonShip (0x35) for a
//    naval unit (`+4 & 0x40`, bit 6, `ITNaval`) and BailOut (0x2a) for any
//    other. `BBChangeTeleport::calculateUrgency` 0x085611f0 reads
//    `1 - s[x]` the same way (0x08561422..0x0856145b, 0x08561adb).
//  * Every other reader (38 call sites of `getMessageStrength`, read
//    2026-11-13; the message id is the `pushl` before each call). `1 - s` is
//    `fld1; fsubp %st, %st(1)` with the bytes `de e1`, which is Intel's
//    FSUBRP: st(1) = st(0) - st(1) = 1 - s, at every one of the eight sites.
//     - Fire: `BBFire` 0x08563570 (0x085652b9 / e3 / 0x08565313),
//       `BBFire3d` (0x08567d47..), `BBFireLargeBore` (0x0856cba7..),
//       `BBFireUnarmed` (0x0856f8fa..) and `BBFireGuided` (0x08570a8c..):
//       `(1 + s[Fire 0x25]) x (1 + s[CoverMe 0x2b]) x (1 - s[HoldFire 0x26])`
//       (`de e1` at 0x0856531d, 0x08567da5, 0x0856cc0b, 0x0856f95e,
//       0x08570aea). The product times the row's modifier (0x08565415)
//       times `Declein(2 best)` is the generator's value (0x0856543b): its
//       urgency and what `addToFireInclination` takes.
//     - MoveTo: `BBMoveTo` 0x08574f80 (0x08575039 / 5d / 84) and
//       `BBMoveToFixed` 0x08575680 (0x085756f2..):
//       `(1 + s[Go 0x31]) x (1 - s[HoldPosition 0x2c]) x (1 - s[Wait 0x24])`
//       (`de e1` at 0x0857506a, 0x08575091, 0x0857574d), times the modifier
//       times the waypoint's urgency (0x08575143..0x08575152; the Fixed
//       row's published order urgency the same, 0x08575862..0x08575871).
//     - Scout: `BBScout` 0x08579a50 (0x0857a81e..0x0857a968):
//       `(1 + s[CheckYourSix 0x34]) x` the seven `(1 + s[0x0f..0x15])`, the
//       team's "spotted" calls; `Declein((accum x 0.2 + interest x 0.1) x
//       product x boost)` (0.1 at 0x086b1ca0, 0.2 at 0x086c4f74,
//       0x0857a98a..0x0857a9b6).
//     - TakeCover: `BBTakeCover` 0x0857c120 (0x0857d063) and
//       `BBTakeCoverInfantry` 0x08580140 (0x0858103d): `s[TakeCover 0x29] +
//       1.0` (`fadds 0x86ba8d4`), a factor of the urgency at its recompute
//       (0x08581086; AI-41). `BBTakeCover3d` 0x0857e4c0 reads CheckYourSix
//       (0x0857e654).
//     - MedicAssist: `BBMedicAssist` 0x08573840 keeps `1 + s[Medic 0x28]`
//       and `1 + s[NeedRepairs 0x36]` (0x08573d59, 0x08573d83). Neither
//       enters the sum: a soldier target's term (`Information+6 & 0x40`,
//       0x085742ae) is multiplied by the first, any other target's by the
//       second (0x08574320), only for the "is this the best target"
//       compare (0x085742ba).
//    `RMLocalFireInHole` (39) is subscribed and read by nothing.
//
// The ids are the client's message ids (radio.js `RADIO_MESSAGES`), the
// same `RadioMessage` enum: BBTakeCoverInfantry's 0x29 is TakeCover (41).

/** The messages a behaviour reads, by the engine's id. */
export const RM = Object.freeze({
  ArmorSpotted: 15, InfantrySpotted: 16, UnitSpotted: 17, ShipSpotted: 18,
  SubmarineSpotted: 19, AirplaneSpotted: 20, ScoutSpotted: 21,
  Wait: 36, Fire: 37, HoldFire: 38, FireInHole: 39, Medic: 40, TakeCover: 41, BailOut: 42,
  CoverMe: 43, HoldPosition: 44, Go: 49, GetIn: 51, CheckYourSix: 52, AbandonShip: 53, NeedRepairs: 54,
});

/**
 * `operator>>(istream&, RadioMessage&)` 0x08489060: the names `radio.con`
 * may subscribe, and the id each parses to. A name not in here parses to 0.
 */
export const RADIO_MESSAGE_IDS = Object.freeze({
  RMRoger: 1, RMNegative: 2, RMPickup: 8, RMReinforcement: 9, RMAntitankSupport: 10, RMNavalSupport: 11,
  RMAirSupport: 12, RMArtilleryReady: 13, RMArtillerySupport: 59,
  RMArmorSpotted: 15, RMInfantrySpotted: 16, RMUnitSpotted: 17,
  // 17, not 18: the parser's own slip (0x08489235).
  RMShipSpotted: 17, RMSubmarineSpotted: 19,
  RMAirplaneSpotted: 20, RMScoutSpotted: 21,
  RMControlPoint1: 22, RMControlPoint2: 23, RMControlPoint3: 24, RMControlPoint4: 25, RMControlPoint5: 26,
  RMControlPoint6: 27, RMControlPoint7: 28, RMControlPointAuto: 50,
  RMLocalDefending: 29, RMLocalAttacking: 30, RMLocalRoger: 31, RMLocalNegative: 32,
  RMLocalWait: 36, RMLocalFire: 37, RMLocalHoldFire: 38, RMLocalFireInHole: 39, RMLocalMedic: 40,
  RMLocalTakeCover: 41, RMLocalBailOut: 42, RMLocalCoverMe: 43, RMLocalHoldPosition: 44,
  RMLocalYouTakePoint: 45, RMLocalFallBack: 46, RMLocalStickTogether: 47, RMLocalFollowMe: 48, RMLocalGo: 49,
  RMLocalGetIn: 51, RMLocalCheckYourSix: 52, RMLocalAbandonShip: 53, RMLocalNeedRepairs: 54,
  RMNumberOfRadioMessages: 60,
});

/** `subscribeToMessage`'s one-argument defaults (0x084824f7, 0x08482501). */
export const SUBSCRIBE_DEFAULT = Object.freeze({ a: 0.1, b: 0.5 });

/** `GameServer::radioMessage`'s range for a shout (0x0813a23b). */
export const AI_RADIO_RANGE = 70.0;
/** `AIRadio::update` steps once this much time has passed (0x86b05e8). */
export const AI_RADIO_STEP = 0.5;

/** Vanilla `Game/AI/radio.con`: the 20 messages its 21 lines subscribe, `10 0.8`. */
const VANILLA_SUBSCRIBED = [
  15, 16, 17, 19, 20, 21,              // RMArmorSpotted .. RMScoutSpotted; RMShipSpotted is 17 again
  36, 49, 39, 41, 42,                  // Wait, Go, FireInHole, TakeCover, BailOut
  51, 52, 53,                          // GetIn, CheckYourSix, AbandonShip
  43, 44, 38, 37, 40, 54,              // CoverMe, HoldPosition, HoldFire, Fire, Medic, NeedRepairs
];

/** The mods whose `radio.con` subscribes with one argument (b = 0.5). */
const DEFAULT_GAIN_MODS = new Set(['gcmod', 'bf1918']);

/**
 * The subscription table for a mod whose tree carries none: `Map<id, { a,
 * b }>`, vanilla's list (the engine default for a mod with no file of its
 * own is the file it inherits, vanilla's).
 */
export function subscriptionsFor(mod = 'bf1942') {
  const oneArg = DEFAULT_GAIN_MODS.has(String(mod ?? '').toLowerCase());
  const rec = oneArg ? { ...SUBSCRIBE_DEFAULT } : { a: 1 / 10, b: 0.8 };
  const table = new Map(VANILLA_SUBSCRIBED.map(id => [id, rec]));
  // Their 22nd line, `RMFirstRadioSpotted`, parses to message 0.
  if (oneArg) table.set(0, rec);
  return table;
}

/**
 * `radio.con` as the engine runs it: every `aiRadio.subscribeToMessage
 * <name> [t [g]]` line, in order, a later line for the same message
 * replacing the earlier (the record is written again). Returns `Map<id, {
 * a, b }>`. A `rem` line and any other command are skipped.
 */
export function parseRadioCon(text) {
  const table = new Map();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0]?.toLowerCase() !== 'airadio.subscribetomessage' || !parts[1]) continue;
    const id = RADIO_MESSAGE_IDS[parts[1]] ?? 0;
    const t = Number(parts[2]), g = Number(parts[3]);
    table.set(id, {
      a: parts[2] !== undefined && Number.isFinite(t) ? 1 / t : SUBSCRIBE_DEFAULT.a,
      b: parts[3] !== undefined && Number.isFinite(g) ? g : SUBSCRIBE_DEFAULT.b,
    });
  }
  return table;
}

/**
 * The table from the tree's own rows (`vehicle-ai.json` `radio`: `[{ id, a,
 * b }]`, what `extract_vehicle_ai.py` wrote from the mod's `radio.con`), or
 * null when the tree has none.
 */
export function subscriptionsFrom(rows) {
  if (!Array.isArray(rows)) return null;
  const table = new Map();
  for (const r of rows) {
    if (!Number.isInteger(r?.id) || !Number.isFinite(r.a) || !Number.isFinite(r.b)) continue;
    table.set(r.id, { a: r.a, b: r.b });
  }
  return table;
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
    /** What the table was last built from (`vehicle-ai.json`'s `radio`). */
    source: null,
    /**
     * The level's own table, once its tree's AI file is read: `rows` as
     * `subscriptionsFrom` takes them. The strengths already raised stay.
     * False when the rows carry no table (the built-in one stays).
     */
    subscribe(rows) {
      const table = subscriptionsFrom(rows);
      radio.source = rows ?? null;
      if (!table) return false;
      subscriptions = table;
      radio.subscriptions = table;
      return true;
    },
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

/** A bot's strengths as `s(id)`: its referee's AIRadio, 0 without one. */
export function radioOf(bot) {
  const r = bot?.radio;
  return id => (r ? r.strength(bot.playerId, id) : 0);
}

/**
 * The Fire generators' message product (`BBFire` 0x085652b5..0x08565329 and
 * its four siblings): `(1 + Fire)(1 + Cover me)(1 - Hold fire)`.
 */
export function fireRadioFactor(s) {
  return (1 + s(RM.Fire)) * (1 + s(RM.CoverMe)) * (1 - s(RM.HoldFire));
}

/**
 * `BBMoveTo` / `BBMoveToFixed`'s (0x08575035..0x08575096):
 * `(1 + Go)(1 - Hold position)(1 - Wait)`.
 */
export function moveRadioFactor(s) {
  return (1 + s(RM.Go)) * (1 - s(RM.HoldPosition)) * (1 - s(RM.Wait));
}

/** The seven team "spotted" calls `BBScout` reads, 0x0f..0x15. */
const SPOTTED = [RM.ArmorSpotted, RM.InfantrySpotted, RM.UnitSpotted, RM.ShipSpotted,
                 RM.SubmarineSpotted, RM.AirplaneSpotted, RM.ScoutSpotted];

/**
 * `BBScout`'s (0x0857a81a..0x0857a982): `(1 + Check your six)` times `(1 +
 * s)` of each "spotted" call.
 */
export function scoutRadioFactor(s) {
  let f = 1 + s(RM.CheckYourSix);
  for (const id of SPOTTED) f *= 1 + s(id);
  return f;
}

/** `BBTakeCover` / `BBTakeCoverInfantry`'s (0x0857d063, 0x0858103d): `1 + Take cover`. */
export function coverRadioFactor(s) {
  return 1 + s(RM.TakeCover);
}

/**
 * `BBMedicAssist`'s target weights (0x08573d59, 0x08573d83): `{ soldier: 1
 * + Medic, other: 1 + Need repairs }`.
 */
export function medicRadioFactors(s) {
  return { soldier: 1 + s(RM.Medic), other: 1 + s(RM.NeedRepairs) };
}
