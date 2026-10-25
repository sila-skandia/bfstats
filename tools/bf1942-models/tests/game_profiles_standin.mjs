// A stand-in for the bfstats API's game profiles (features/game-profiles, the
// API contract), for the viewer's tests while the real API is built: the four
// routes under /stats/account/game-profiles, the sign-in refresh the viewer's
// client makes on the same origin, and, optionally, the viewer's files, so a
// headless page is served the way play.bfstats.io serves it (one origin).
//
//   import { startStandin } from './game_profiles_standin.mjs';
//   const s = await startStandin({ signedIn: true });   // s.url, s.profiles, s.log, s.close()
//
//   node tests/game_profiles_standin.mjs --port 5291 --static viewer [--signed-out] [--seed <profile dir> <name>]
//
// Not the API: no users, one account, held in memory.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FILE_KEYS = ['Controls/Common.con', 'Controls/Infantry.con', 'Controls/Air.con', 'Controls/Land.con', 'GeneralOptions.con'];
const MAX_PROFILES = 10;
const MAX_FILE = 64 * 1024;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.dds': 'application/octet-stream', '.bin': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ktx2': 'image/ktx2' };

const playerNameOf = (text) => /^game\.setPlayerName\s+"([^"]*)"/m.exec(String(text ?? ''))?.[1] ?? null;

export async function startStandin({ port = 0, signedIn = true, staticRoot = null, failList = false } = {}) {
  const state = { signedIn, failList, profiles: [], log: [] };
  const find = (name) => state.profiles.find((p) => p.name.toLowerCase() === String(name).toLowerCase());
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(undefined); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://standin');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/stats/')) state.log.push({ method: req.method, path: p, at: Date.now() });
    if (p === '/stats/auth/refresh' && req.method === 'POST') {
      if (!state.signedIn) return send(res, 401, { message: 'no session' });
      return send(res, 200, { accessToken: 'standin.eyJyb2xlIjoiVXNlciJ9.sig', expiresAt: new Date(Date.now() + 3600e3).toISOString() });
    }
    if (p === '/stats/recordings' && req.method === 'GET') return send(res, 200, { items: [], total: 0 });
    const m = /^\/stats\/account\/game-profiles(?:\/([^/]+))?(\/activate)?$/.exec(p);
    if (m) {
      if (!state.signedIn || !/^Bearer \S+/.test(req.headers.authorization ?? '')) return send(res, 401, { message: 'Sign in first.' });
      const [, name, activate] = m;
      if (!name && req.method === 'GET') {
        if (state.failList) return send(res, 500, { message: 'stand-in failure' });
        return send(res, 200, state.profiles);
      }
      if (name && !activate && req.method === 'PUT') {
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || !body.files || typeof body.files !== 'object') return send(res, 400, { message: 'files required' });
        const bad = Object.keys(body.files).filter((k) => !FILE_KEYS.includes(k));
        if (bad.length) return send(res, 400, { message: `unknown files: ${bad.join(', ')}` });
        if (Object.values(body.files).some((t) => typeof t !== 'string' || t.length > MAX_FILE)) return send(res, 400, { message: 'a file is too big' });
        let prof = find(name);
        if (!prof) {
          if (state.profiles.length >= MAX_PROFILES) return send(res, 409, { message: 'ten profiles already' });
          prof = { name, isActive: state.profiles.length === 0 };
          state.profiles.push(prof);
        }
        prof.files = { ...body.files };
        prof.playerName = body.playerName ?? playerNameOf(body.files['GeneralOptions.con']) ?? null;
        prof.updatedAt = new Date().toISOString();
        if (body.makeActive) for (const q of state.profiles) q.isActive = q === prof;
        return send(res, 200, prof);
      }
      if (name && activate && req.method === 'POST') {
        const prof = find(name);
        if (!prof) return send(res, 404, { message: 'no such profile' });
        for (const q of state.profiles) q.isActive = q === prof;
        return send(res, 204);
      }
      if (name && !activate && req.method === 'DELETE') {
        const prof = find(name);
        if (!prof) return send(res, 404, { message: 'no such profile' });
        state.profiles = state.profiles.filter((q) => q !== prof);
        if (prof.isActive && state.profiles.length) {
          const next = [...state.profiles].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
          next.isActive = true;
        }
        return send(res, 204);
      }
      return send(res, 405, { message: 'not here' });
    }
    if (staticRoot) {
      const file = path.join(staticRoot, path.normalize(p === '/' ? '/index.html' : p));
      if (!file.startsWith(staticRoot)) return send(res, 403, {});
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': st.size, 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, state,
    get profiles() { return state.profiles; },
    get log() { return state.log; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

// The CLI, for a headless page against the stand-in.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticRoot = opt('static', null) ? path.resolve(here, '..', opt('static')) : null;
  const s = await startStandin({ port: Number(opt('port', 0)), signedIn: !args.includes('--signed-out'), staticRoot });
  const seed = args.indexOf('--seed');
  if (seed >= 0) {
    const dir = args[seed + 1];
    const name = args[seed + 2];
    const files = {};
    for (const key of FILE_KEYS) {
      const f = path.join(dir, key);
      if (fs.existsSync(f)) files[key] = fs.readFileSync(f, 'latin1');
    }
    s.state.profiles.push({ name, isActive: true, files, playerName: playerNameOf(files['GeneralOptions.con']) ?? name, updatedAt: new Date().toISOString() });
  }
  console.log(`[standin] ${s.url}  static ${staticRoot ?? '(none)'}  signed ${s.state.signedIn ? 'in' : 'out'}  profiles ${s.state.profiles.map((p) => p.name).join(', ') || '(none)'}`);
  setInterval(() => {
    const fresh = s.state.log.splice(0);
    for (const r of fresh) console.log(`[standin] ${r.method} ${r.path}`);
  }, 250);
  process.on('SIGINT', () => { s.close().then(() => process.exit(0)); });
}
