// Headless checks of what a human's radio and a human's Use / seat key do to
// a bot holding a seat (viewer/bot-radio.js, bot-mount.js `urgencyChange`,
// bot-vehicle.js `unitUrgency`, bot-referee.js `radioMessage` /
// `requestSeat`). Prints one JSON object.

import { createAIRadio, subscriptionsFor, changeRadioStrength, teleportRadioStrength, RM, AI_RADIO_RANGE }
  from '../viewer/bot-radio.js';
import { urgencyChange, seatRequestAge, SEAT_REQUEST_SECONDS } from '../viewer/bot-mount.js';
import { unitUrgency, teleportChangeUrgency, TANK } from '../viewer/bot-vehicle.js';
import { createBotReferee } from '../viewer/bot-referee.js';

const out = {};

// --- AIRadio ------------------------------------------------------------------
{
  const radio = createAIRadio();
  const bot = (playerId, team, position, dead = false) => ({ playerId, team, position, dead });
  const bots = [
    bot('at70', 1, [70, 0, 0]), bot('at35', 1, [35, 0, 0]), bot('at71', 1, [71, 0, 0]),
    bot('enemy', 2, [10, 0, 0]), bot('dead', 1, [10, 0, 0], true), bot('speaker', 1, [0, 0, 0]),
  ];
  radio.send(RM.BailOut, { team: 1, speakerId: 'speaker', at: [0, 0, 0], bots });
  const s = id => radio.strength(id, RM.BailOut);
  out.shout = { at70: s('at70'), at35: s('at35'), at71: s('at71'), enemy: s('enemy'), dead: s('dead'),
                speaker: s('speaker'), range: AI_RADIO_RANGE };
  // A second shout from 70 m on top of the first: s += (1 - s) 0.8.
  radio.send(RM.BailOut, { team: 1, at: [0, 0, 0], bots: [bot('at70', 1, [70, 0, 0])] });
  out.shout.at70Twice = s('at70');
  // Team radio reaches the side at any range with gain 1.
  radio.send(RM.GetIn, { team: 1, at: [0, 0, 0], broadcast: true, bots: [bot('far', 1, [5000, 0, 0])] });
  out.broadcast = radio.strength('far', RM.GetIn);
  // A message radio.con does not subscribe (RADIO_LOCAL_ATTACKING) is dropped.
  radio.send(30, { team: 1, at: [0, 0, 0], bots: [bot('at35', 1, [35, 0, 0])] });
  out.unsubscribed = radio.strength('at35', 30);
  // The decay: nothing before half a second, then dt x 0.1, to 0.
  const before = s('at35');
  radio.update(0.4);
  const after04 = s('at35');
  radio.update(1.0);
  const after10 = s('at35');
  radio.update(100);
  out.decay = { before, after04, after10, after100: s('at35') };
  const gc = subscriptionsFor('GCMOD').get(RM.BailOut);
  const vanilla = subscriptionsFor('bf1942').get(RM.BailOut);
  out.subscriptions = { vanilla, gc, getIn: subscriptionsFor().has(RM.GetIn),
                        abandon: subscriptionsFor().has(RM.AbandonShip), attacking: subscriptionsFor().has(30) };
}

// --- getRadioStrength -----------------------------------------------------------
{
  const str = m => id => m[id] ?? 0;
  out.radioStrength = {
    foot: changeRadioStrength('foot', str({ [RM.BailOut]: 0.8 })),
    bail: changeRadioStrength('vehicle', str({ [RM.BailOut]: 0.8 })),
    getIn: changeRadioStrength('vehicle', str({ [RM.GetIn]: 0.8 })),
    shipIgnoresBail: changeRadioStrength('ship', str({ [RM.BailOut]: 0.8 })),
    shipAbandon: changeRadioStrength('ship', str({ [RM.AbandonShip]: 0.8 })),
    teleport: [teleportRadioStrength('vehicle', str({ [RM.BailOut]: 0.6 })),
               teleportRadioStrength('ship', str({ [RM.BailOut]: 0.6, [RM.AbandonShip]: 0.3 }))],
  };
  // The teleport's term scales the stay and the seats alike: same pick.
  const seats = [{ id: 'mg', u: 6 }];
  const a = teleportChangeUrgency({ where: 'seatUnderDriver', rootU: 10, selfU: 8, seats, radio: 0 });
  const b = teleportChangeUrgency({ where: 'seatUnderDriver', rootU: 10, selfU: 8, seats, radio: 0.6 });
  out.teleportSame = { a: a.best?.id ?? null, b: b.best?.id ?? null, ua: a.urgency, ub: b.urgency };
}

// --- a seated bot's Change under the radio and a request ------------------------
// A parked hull with no guns: its seat is worth its `value` (20) to the bot,
// the soldier on foot 1 + 5 x 4 x 0.5 = 11. Staying is 25 and wins.
const NOW = 100;
function seatedBot({ drives = true, strengths = {}, request = null } = {}) {
  const mine = { id: 'A', vehicleId: 'A', pos: [0, 0, 0], seats: [{ isRoot: true, occupied: true }], value: 20 };
  return {
    playerId: 'me', team: 1, position: [0, 0, 0], waypoints: null, navGrid: null,
    vehicleCandidates: [mine], changedTarget: {}, _lastChangeAt: -100, _changeResult: null, _leftVehicle: null,
    vehicle: { id: 'A', vehicleId: 'A', drives, maxSpeed: 0, kind: 'ground', template: 'Sherman',
               driverOf: () => (drives ? null : 'someone') },
    world: { armorOf: () => null, occupiedDamageable: () => null },
    _fireStrengthOf: () => 0, _seatStrengths: () => ({}), _otherSeats: () => [], _myType: () => 'Infantry',
    _fixedAimable: () => true, _candidateFire: () => 0, _urgencyChangeTeleport: () => null,
    _insideOrderedArea: () => true,
    radio: { strength: (_bot, id) => strengths[id] ?? 0 },
    seatRequest: request,
  };
}
const run = opts => {
  const bot = seatedBot(opts);
  const u = urgencyChange(bot, 1, NOW);
  return { urgency: u, best: bot._changeResult?.best?.id ?? null, bail: !!bot._changeResult?.bail,
           request: bot.seatRequest };
};
out.seated = {
  foot: unitUrgency({ fire: 0, maxSpeed: TANK.soldierMaxSpeed, value: 1 }),
  quiet: run(),
  // "Bail out!" from 70 m: strength 0.8, radio 0.2, the stay bar 5 under the foot's 11.
  bailFar: run({ strengths: { [RM.BailOut]: 0.8 } }),
  // From 10 m: strength 5.6, radio -4.6.
  bailNear: run({ strengths: { [RM.BailOut]: 5.6 } }),
  gunnerBailFar: run({ drives: false, strengths: { [RM.BailOut]: 0.8 } }),
  gunnerBailNear: run({ drives: false, strengths: { [RM.BailOut]: 5.6 } }),
  // "Get in!" makes the seat worth more: still no Change.
  getIn: run({ strengths: { [RM.GetIn]: 0.8 } }),
  // The human's press just now, half the window ago, and a stale one.
  requestNow: run({ request: { id: 'A', at: NOW } }),
  requestHalf: run({ request: { id: 'A', at: NOW - 7.5 } }),
  requestLate: run({ request: { id: 'A', at: NOW - 14 } }),
  requestStale: run({ request: { id: 'A', at: NOW - SEAT_REQUEST_SECONDS } }),
  requestOther: run({ request: { id: 'B', at: NOW } }),
};
out.requestAge = {
  same: seatRequestAge({ seatRequest: { id: 'A', at: 90 } }, 'A', 100),
  other: seatRequestAge({ seatRequest: { id: 'A', at: 90 } }, 'B', 100),
  none: seatRequestAge({ seatRequest: null }, 'A', 100),
  scaled: unitUrgency({ value: 20, requestAge: 7.5 }),
  unscaled: unitUrgency({ value: 20 }),
};

// --- the referee: who gets the radio and who takes a request --------------------
{
  const dead = new Set(['d']);
  const referee = createBotReferee({ world: () => ({ armorOf: id => ({ destroyed: dead.has(id) }) }) });
  const mk = (playerId, team, position, vehicle = null) => ({ playerId, team, position, vehicle, getPosition: () => position });
  referee.bots = [mk('seated', 1, [5, 0, 0], { id: 'S' }), mk('foot', 1, [5, 0, 0]), mk('enemy', 2, [5, 0, 0], { id: 'E' }),
                  mk('d', 1, [5, 0, 0], { id: 'D' })];
  referee.clock = 42;
  out.request = {
    sameSide: referee.requestSeat(1, 'seated'),
    stored: referee.bots[0].seatRequest,
    otherSide: referee.requestSeat(1, 'enemy'),
    onFoot: referee.requestSeat(1, 'foot'),
    dead: referee.requestSeat(1, 'd'),
    nobody: referee.requestSeat(1, 'nobody'),
  };
  referee.radioMessage(RM.BailOut, { team: 1, speakerId: 'human', at: [0, 0, 0] });
  out.refereeRadio = {
    seated: referee.radio.strength('seated', RM.BailOut),
    enemy: referee.radio.strength('enemy', RM.BailOut),
    dead: referee.radio.strength('d', RM.BailOut),
  };
}

process.stdout.write(JSON.stringify(out));
