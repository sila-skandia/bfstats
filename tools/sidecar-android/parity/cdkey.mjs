// Writes core/src/test/resources/parity/cdkey.json from the Node sidecar's
// cdkey.mjs and paths.mjs: the challenge string, the 73-byte key hash for
// fixed r values, keys and r values from a seeded crypto.randomInt, the key
// store's file across runs (exact bytes), and the config / cache dirs.
// CdKeyTest.kt replays them with the same seeded randomInt.
//   node parity/cdkey.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sidecar, write, prng } from './lib/fixture.mjs';

const K = await sidecar('cdkey.mjs');
const P = await sidecar('paths.mjs');
const out = {};
const realRandomInt = crypto.randomInt;
const seeded = (seed) => { const r = prng(seed); return (max) => Math.floor(r() * max); };

const sw = Buffer.from('77646a76756a62776300', 'hex');
out.challengeString = [
  [sw, 'bf1942'], [Buffer.from('abcdefghij'), 'xpack2'], [Buffer.from('abcdefghij'), 'mod\0tail'], [Buffer.alloc(10), 'x'],
  [Buffer.from('757378676e746c746f00', 'hex'), ''], [Buffer.from('ab'), 'é'],
].map(([c, m]) => ({ challenge: c.toString('hex'), mod: m, out: K.challengeString({ challenge: c, mod: m }).toString('hex') }));

const KEY = '1234567890123456789012';
out.keyHash = [
  [KEY, sw.subarray(0, 9), 0x12345678], [KEY, sw.subarray(0, 9), 0], [KEY, sw.subarray(0, 9), 0xffffffff], [KEY, sw.subarray(0, 9), 0xffff],
  ['', Buffer.alloc(0), 1], ['éè', Buffer.from('zz'), 65534], [KEY, Buffer.from('abcdefghijxpack2'), -1], [KEY, Buffer.from('q'), 2 ** 32 + 5],
].map(([k, c, r]) => ({ key: k, challenge: c.toString('hex'), r, out: K.keyHashResponse(k, c, r).toString('hex') }));
out.keyHashString = [['k', 'wdjvujbwc', 7], ['k', 'é€', 9]].map(([k, c, r]) => ({ key: k, challenge: c, r, out: K.keyHashResponse(k, c, r).toString('hex') }));
try { K.keyHashResponse('x'.repeat(250), Buffer.alloc(4), 1); out.tooLong = null; } catch (e) { out.tooLong = e.message; }
try { K.keyHashResponse('x'.repeat(249), Buffer.alloc(5), 1); out.justFits = 'ok'; } catch (e) { out.justFits = e.message; }

crypto.randomInt = seeded(4242);
out.rand = Array.from({ length: 20 }, () => K.retailRand());
out.keys = Array.from({ length: 40 }, () => K.generateCdKey());

// The store, against a file in a scratch dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdkey-parity-'));
const file = path.join(dir, 'k', 'cdkeys.json');
const warns = [];
const warn = (m) => warns.push(m.replace(/\(.*\)/, '(...)'));
const steps = [];
const read = () => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
crypto.randomInt = seeded(99);
const store = (override) => K.cdKeyStore({ file, override, warn });
const s1 = store('');
steps.push(['new', ''], ['get', -1, s1(-1)], ['get', 783, s1(783)], ['get', 783, s1(783)], ['get', null, s1(null)], ['file', read()]);
const s2 = store('');
steps.push(['new', ''], ['get', 713, s2(713)], ['get', -1, s2(-1)], ['file', read()]);
const s3 = store('OVERRIDE');
steps.push(['new', 'OVERRIDE'], ['get', -1, s3(-1)], ['get', 783, s3(783)], ['get', 1, s3(1)], ['file', read()]);
fs.writeFileSync(file, '{"-1": "", "783": 7, "abc": "keep", "10": "ten", "2": "two"}');
const s4 = store('');
steps.push(['write', read()], ['new', ''], ['get', 783, s4(783)], ['get', -1, s4(-1)], ['get', 2, s4(2)], ['file', read()]);
fs.writeFileSync(file, 'not json');
const s5 = store('');
steps.push(['write', read()], ['new', ''], ['get', -1, s5(-1)], ['file', read()]);
steps.push(['warns', warns.length]);
fs.rmSync(dir, { recursive: true, force: true });
out.store = steps;
crypto.randomInt = realRandomInt;

out.paths = [
  { env: {}, platform: 'linux', home: '/home/u' },
  { env: { SIDECAR_CACHE: '/tmp/c' }, platform: 'linux', home: '/home/u' },
  { env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, platform: 'win32', home: 'C:\\Users\\u' },
  { env: {}, platform: 'win32', home: 'C:\\Users\\u' },
  { env: {}, platform: 'darwin', home: '/Users/u' },
  { env: {}, platform: 'android', home: '/data/user/0/io.bfstats.sidecar/files' },
].map((a) => ({ ...a, configDir: P.configDir(a), cacheDir: P.cacheDir(a) }));

write('cdkey', out);
