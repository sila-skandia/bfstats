// The sidecar's answer to a Challenge (`sidecar/session.mjs`
// `challengeResponses`): one ChallengeResponse for the base game, and a
// second for the expansion a Challenge names. Prints one JSON blob for
// `tests/test_sidecar_challenge.py`.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { challengeResponses, contentAck, CLIENT_PUNKBUSTER } = await import(pathToFileURL(path.join(here, '..', 'sidecar', 'session.mjs')).href);
const { challengeString, keyHashResponse, cdKeyStore } = await import(pathToFileURL(path.join(here, '..', 'sidecar', 'cdkey.mjs')).href);
const { crc32Bzip2, objectsChecksum } = await import(pathToFileURL(path.join(here, '..', 'sidecar', 'objects-checksum.mjs')).href);
const { contentCrc, parseContentCrc32, gpmFor, levelName } = await import(pathToFileURL(path.join(here, '..', 'sidecar', 'content-crc.mjs')).href);
import fs from 'node:fs';
import os from 'node:os';

// A Secret Weapons lab server's Challenge, as it arrived (2026-10-17).
const challenge = Buffer.from('77646a76756a62776300', 'hex');
const KEY = '1234567890123456789012';
const keys = (x) => (x === -1 ? KEY : `xp${x}`);
const hashes = (rs) => rs.map((x) => x.keyHash.toString('latin1'));

// The key file: generated once per product, read back on the next run, and
// an override replaces only the base game's.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdkey-'));
const file = path.join(dir, 'k', 'cdkeys.json');
const first = cdKeyStore({ file, override: '' });
const base = first(-1), sw = first(783);
const again = cdKeyStore({ file, override: '' });
const over = cdKeyStore({ file, override: 'OVERRIDE' });
const store = { base, sw, baseAgain: again(-1), swAgain: again(783), overBase: over(-1), overSw: over(783) };
fs.rmSync(dir, { recursive: true, force: true });

// The retail client joining a real 1.612 server (capture 2026-10-24): this
// Challenge, and b = 0x31597125 in its ChallengeResponse.
const retailChallenge = Buffer.from('757378676e746c746f00', 'hex');
const retailCrc = objectsChecksum('BF1942');
// TheGreatEscape (2026-10-24): a retail client's Ack on vanilla Market Garden
// Conquest, after the Challenge 'wbtnrsrod'.
const tge = { challenge0: Buffer.from('wbtn', 'latin1').readUInt32LE(0), ack: 4190777010 };
const quiet = console.warn; console.warn = () => {};
const content = {
  marketGarden: contentCrc({ mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/market_garden/', modeFile: 'conquest.con' }),
  noLevel: contentCrc({ mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/no_such_level/', modeFile: 'conquest.con' }),
  noInstall: contentCrc({ mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/market_garden/', modeFile: 'conquest.con' },
    { dir: path.join(os.tmpdir(), 'no-such-bf1942-install') }),
  nothing: contentCrc({ mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/market_garden/', modeFile: 'conquest.con' },
    { dir: path.join(os.tmpdir(), 'no-such-bf1942-install'), bundled: false }),
  bundledSw: contentCrc({ mod: 'xpack2', mapId: 'XPack2', levelPath: 'xpack2/levels/peenemunde/', modeFile: 'conquest.con' }, { dir: null }),
};
const missing = objectsChecksum('BF1942', { dir: path.join(os.tmpdir(), 'no-such-bf1942-install') });
console.warn = quiet;

process.stdout.write(JSON.stringify({
  checkValue: crc32Bzip2(Buffer.from('123456789')),
  retailCrc,
  missing,
  retail: retailCrc == null ? null
    : challengeResponses({ challenge: retailChallenge, xpack: -1, mod: 'bf1942' }, () => null, (m) => objectsChecksum(m)),
  injected: challengeResponses({ challenge, xpack: 783, mod: 'xpack2' }, () => null, (m) => (m === 'BF1942' ? 0x11111111 : m === 'xpack2' ? 0x22222222 : null)),

  store,
  key: KEY,
  fixed: keyHashResponse(KEY, challengeString({ challenge, mod: 'bf1942' }), 0x12345678).toString('latin1'),
  chNul: challengeString({ challenge, mod: 'bf1942' }).toString('latin1'),
  chFull: challengeString({ challenge: Buffer.from('abcdefghij'), mod: 'xpack2' }).toString('latin1'),
  swHashes: hashes(challengeResponses({ challenge, xpack: 783, mod: 'xpack2' }, keys)),
  sw: challengeResponses({ challenge, xpack: 783, mod: 'xpack2' }),
  rtr: challengeResponses({ challenge, xpack: 713, mod: 'xpack1' }),
  vanilla: challengeResponses({ challenge, xpack: -1, mod: 'bf1942' }),
  punkbuster: CLIENT_PUNKBUSTER,
  tge,
  content,
  tgeAck: content.marketGarden == null ? null : contentAck(tge.challenge0, content.marketGarden),
  ackUnknown: contentAck(tge.challenge0, null),
  parsed: Object.fromEntries(parseContentCrc32('game.addContentCrc32 XPack1 Anzio GPM_CQ 2747151060\r\ngame.addContentCrc32 XPack1 Anzio GPM_CQ 7\n// x\n')),
  gpm: ['conquest.con', 'coop.con', 'CTF.con', 'tdm.con', 'ObjectiveMode.con', 'other.con'].map(gpmFor),
  level: [levelName('bf1942/levels/market_garden/'), levelName('XPack1\\Levels\\Anzio')],
}));
