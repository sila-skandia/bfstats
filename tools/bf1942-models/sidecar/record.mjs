// Map a decoded server event (events.mjs readEvent output) onto the bf42plus
// v5 replay-recording schema, so the sidecar's live stream is the same the
// replayer already reconstructs. Field names and event names are taken from
// bf42plus/src/replay.cpp verbatim.
//
// bf42plus recorded the client's DECODED events plus a 10 Hz sample of every
// object's transform read from the applied client world. The sidecar has the
// events but not an applied world, so it cannot produce the transform samples
// yet (that needs the ghost-stream decode, strategy C). It emits the event
// records here; the ghost stream is framed and sent to the review log instead.
//
// An event with no mapping returns null, and the caller writes a `raw` record
// and a review-log line — the same escape hatch bf42plus uses for events it
// does not model, so nothing is lost and the gaps are visible.

const V = (v) => (v === undefined ? 0 : v);

// decoded event -> { e, ...fields } (the caller adds k:"e" and t)
export function recordFor(ev) {
  switch (ev.type) {
    case 'ServerInfo': return { e: 'serverInfo', mapId: ev.mapId, mod: ev.mod, gameId: ev.gameId };
    case 'ServerInfo2': return { e: 'serverName', name: ev.serverName };
    case 'Challenge': return { e: 'challenge', mod: ev.mod, xpack: ev.xpack };
    case 'SetLevel': return { e: 'setLevel', level: ev.levelPath, mode: ev.modeFile };
    case 'Map': return { e: 'mapList', add: ev.add ? 1 : 0, map: ev.map, mode: ev.mode, mod: ev.mod };
    case 'CreateMultipleObjects': return { e: 'projPool', tid: ev.template, tmpl: '', netId: ev.firstNetId, count: ev.count };
    case 'CreateObject': return {
      e: 'createObject', tid: ev.template, netId: ev.netId, tmpl: '',
      pos: ev.pos ? ev.pos.map(round2) : [0, 0, 0],
      rot: ev.rot ? ev.rot.map(round2) : [0, 0, 0],
    };
    case 'CreatePlayer': return {
      e: 'createPlayer', pid: ev.playerId, name: ev.name, team: ev.team, ai: ev.isAI ? 1 : 0,
      netId: ev.playerNetId, vehNetId: ev.vehicleNetId, camNetId: ev.cameraNetId, kitNetId: ev.kitNetId,
    };
    case 'SetDefaultVehicle': return { e: 'control', pid: ev.playerId, netId: ev.netId };
    case 'SetVehicle': return { e: 'enterVehicle', pid: ev.playerId, netId: ev.netId };
    case 'ExitVehicle': return ev.flag ? { e: 'exitVehicle', pid: ev.playerId, flag: 1 } : { e: 'exitVehicle', pid: ev.playerId };
    case 'DestroyPlayer': return { e: 'destroyPlayer', pid: ev.playerId };
    case 'DestroyObject': return { e: 'destroyObject', netId: ev.netId };
    case 'PickupKit': case 'HandlePickup': return { e: 'pickupKit', pid: ev.playerId, netId: ev.netId };
    case 'GameRules': return {
      e: 'gameRules', extViews: ev.externalViews ? 1 : 0, noseCam: ev.noseCam ? 1 : 0,
      soldierFF: round3(ev.soldierFF), ticketRatio: round3(ev.ticketRatio),
      timeLimit: V(ev.timeLimit), worldTime: V(ev.worldTime), crosshair: ev.crosshairCentre ? 1 : 0,
    };
    case 'TimerSync': return { e: 'clock', timeLimit: ev.timeLimit, worldTime: ev.worldTime };
    case 'Simulation': return { e: 'simStart', running: ev.running ? 1 : 0, worldTime: round3(ev.worldTime) };
    case 'GameStatus': return { e: 'gameStatus', status: ev.status };
    case 'SetTeam': return { e: 'setTeam', pid: ev.playerId, team: ev.team };
    case 'RadioMessage': return { e: 'radio', pid: ev.playerId, msg: ev.message, global: ev.broadcast ? 1 : 0 };
    case 'HitFromPos': return { e: 'hitFrom', dir: ev.sector, strength: ev.strength };
    case 'SessionId': return { e: 'sessionId', id: ev.sessionId };
    case 'WelcomeMsg': return { e: 'welcome', id: ev.index, text: ev.message };
    case 'SpecialGame': return { e: 'special', action: ev.kind };
    case 'DataBaseComplete': return { e: 'dbComplete' };
    case 'ScoreMsg': {
      const r = { e: 'score', kind: ev.scoreType, pid: ev.playerId };
      if (ev.victimId !== undefined) { r.victim = ev.victimId; r.weapon = ev.weapon; r.bodypart = ev.bodyPart; }
      return r;
    }
    case 'StatsKills': case 'StatsShots': case 'StatsHits': {
      const stat = ev.type === 'StatsKills' ? 'kills' : ev.type === 'StatsShots' ? 'shots' : 'hits';
      const rows = (ev.rows || []).slice(0, (ev.rowsMinus1 ?? 0) + 1).map((x) => [x.template, x.count]);
      return { e: 'roundStats', stat, pid: ev.playerId, rows };
    }
    // Client-to-server events never arrive from the server; no record.
    case 'ConnectionType': case 'ChallengeResponse': case 'CreatePlayerAck':
    case 'DatabaseCompleteAck': case 'Ack': case 'SpawnRequest': case 'ChangeKit':
    case 'ReqScoutCamera':
      return undefined; // silently ignore (we sent these)
    default:
      return null; // unmapped server event -> caller writes `raw` + review
  }
}

function round2(x) { return Math.round(x * 100) / 100; }
function round3(x) { return Math.round(x * 1000) / 1000; }

export function header(hz, extra = {}) {
  return { k: 'h', v: 5, plus: 'sidecar', start: new Date().toISOString().slice(0, 19), hz, ...extra };
}
