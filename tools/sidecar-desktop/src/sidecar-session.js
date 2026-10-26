'use strict';
// One sidecar child process per join, at most one at a time. The engine
// (sidecar-engine.js) is the native Kotlin sidecar or sidecar.mjs under
// Electron's own Node (process.execPath with ELECTRON_RUN_AS_NODE=1); both
// ship inside the app, so nothing needs installing beside it. A Kotlin child
// that fails to start (no spawn, or an exit before its first `[sidecar]`
// line) is replaced by the Node one, and the log says why.
//
// Leaving writes `leave` on the sidecar's stdin (and sends SIGINT where
// signals exist) and waits for the exit: the sidecar then sends the server
// its disconnect. A killed sidecar leaves its player on the server for
// about 20 s (features/udp-sidecar/README.md, "Run it").

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { parseLine } = require('./sidecar-status');
const { engineEnv, sidecarArgs } = require('./sidecar-engine');

const LEAVE_GRACE_MS = 6000;    // SIGINT to exit; the sidecar exits ~150 ms after its leave
const PORT_TRIES = 20;

/** The first free 127.0.0.1 port from `start` (the page is told which). */
function freePort(start, tries = PORT_TRIES) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      if (p === 5273) return attempt(p + 1, left);   // the owner's viewer server's port
      const srv = net.createServer();
      srv.once('error', () => (left > 1 ? attempt(p + 1, left - 1) : reject(new Error(`no free port from ${start}`))));
      srv.once('listening', () => srv.close(() => resolve(p)));
      srv.listen(p, '127.0.0.1');
    };
    attempt(start, tries);
  });
}

/** The Node engine's environment (sidecar-engine.js engineEnv). */
function sidecarEnv({ gameDir = null, env = process.env } = {}) {
  return engineEnv('node', { gameDir, env });
}

/** opts.engine, or the Node engine on opts.script (the app before engines). */
function engineOf(opts) {
  if (opts.engine) return opts.engine;
  return { engine: 'node', command: process.execPath, prefix: [opts.script], reason: null, fallback: null };
}

class SidecarSession extends EventEmitter {
  /**
   * opts: { engine | script, host, port, name, team, wsPort, dataDir, extraArgs, gameDir, log }
   * `engine` is resolveEngine's answer (sidecar-engine.js); `script` alone
   * runs sidecar.mjs under Node. `log(line)` gets every line the child prints.
   */
  constructor(opts) {
    super();
    this.opts = opts;
    this.address = `${opts.host}:${opts.port}`;
    this.state = 'starting';
    this.detail = '';
    this.wsPort = opts.wsPort;
    this.serverName = opts.serverName ?? null;
    this.mapName = opts.mapName ?? null;
    this.gameType = opts.gameType ?? null;
    this.mod = opts.mod ?? null;           // the live list's gameId, then what the sidecar reports
    this.reportedName = null;   // what the sidecar says the server calls itself
    this.players = opts.players ?? null;
    this.maxPlayers = opts.maxPlayers ?? null;
    this.pageConnected = false;
    // Who the session plays as: known at the start for a custom or install
    // name; with --name-from-page, once the sidecar says (sidecar-status.js).
    this.nameFromPage = !!opts.nameFromPage;
    this.playerName = opts.nameFromPage ? null : (opts.name ?? null);
    this.playerNameFrom = opts.nameFromPage ? null : (opts.nameSource ?? 'custom');
    this.child = null;
    this.exited = null;   // a promise of the exit code
    this.startedAt = Date.now();
    this.engine = null;   // 'kotlin' or 'node': what runs now
    this.fallbackReason = null;
  }

  start() {
    const { host, port, name, team, wsPort, dataDir, extraArgs = [] } = this.opts;
    const dir = path.join(dataDir, 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const base = path.join(dir, `sidecar-${stamp}-${host.replace(/[^a-z0-9.-]/gi, '_')}-${port}`);
    this.recording = `${base}.ndjson`;
    this.args = sidecarArgs({
      host, port, name, team, wsPort, recording: this.recording, review: `${base}.review.ndjson`,
      nameFromPage: this.opts.nameFromPage, extraArgs,
    });
    this.dir = dir;
    let resolveExit;
    this.exited = new Promise((resolve) => { resolveExit = resolve; });
    this.resolveExit = resolveExit;
    const engine = engineOf(this.opts);
    if (engine.reason) this.opts.log?.(`[app] running the Node sidecar: ${engine.reason}`);
    this.spawnEngine(engine);
    return this;
  }

  /** Spawn one engine's child; a Kotlin child that fails to start hands over to its fallback. */
  spawnEngine(engine) {
    const argv = [...engine.prefix, ...this.args];
    this.engine = engine.engine;
    this.opts.log?.(`[app] spawn (${engine.engine}) ${path.basename(engine.command)} ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    let child;
    try {
      child = spawn(engine.command, argv, {
        cwd: this.dir,
        env: engineEnv(engine.engine, { gameDir: this.opts.gameDir ?? null, env: this.opts.env ?? process.env }),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      // spawn throws synchronously on a bad argument (EACCES on some platforms is async)
      if (this.fallBack(engine, `could not run ${engine.command}: ${e.message}`)) return;
      this.set({ state: 'failed', detail: e.message });
      this.emit('exit', -1, null);
      this.resolveExit(-1);
      return;
    }
    this.child = child;
    let spoke = false;   // a [sidecar] line: it started
    let done = false;
    child.stdin.on('error', () => { /* EPIPE once it has gone */ });
    const finish = (code, signal, failure) => {
      if (done) return; done = true;
      if (!spoke && this.state !== 'leaving' && (failure || code !== 0)) {
        const why = failure ? `it failed to start (${failure})` : `it exited with ${signal ? `signal ${signal}` : `code ${code}`} before saying anything`;
        if (this.fallBack(engine, why)) return;
      }
      if (failure) {
        this.opts.log?.(`[app] sidecar failed to start: ${failure}`);
        this.set({ state: 'failed', detail: failure });
        this.emit('exit', -1, null);
        this.resolveExit(-1);
        return;
      }
      this.opts.log?.(`[app] sidecar exited (code ${code}${signal ? `, signal ${signal}` : ''})`);
      if (!['denied', 'ended', 'failed'].includes(this.state)) {
        this.set({ state: code === 0 || this.state === 'leaving' ? 'idle' : 'failed', detail: this.detail || (code ? `sidecar exited with code ${code}` : '') });
      }
      this.emit('exit', code, signal);
      this.resolveExit(code);
    };
    child.once('error', (e) => finish(null, null, e.message));
    // 'close', not 'exit': every line it printed has been read first, so a
    // child that said `[sidecar] ...` and then failed is not mistaken for one
    // that never started.
    child.once('close', (code, signal) => finish(code, signal, null));
    for (const stream of [child.stdout, child.stderr]) {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) { if (/^\[sidecar\]/.test(line.trim())) spoke = true; this.onLine(line); }
      });
      stream.on('end', () => { if (pending) { if (/^\[sidecar\]/.test(pending.trim())) spoke = true; this.onLine(pending); } pending = ''; });
    }
  }

  /** Start the engine's fallback in place of a child that failed; false when there is none. */
  fallBack(engine, why) {
    if (!engine.fallback) return false;
    this.fallbackReason = `the ${engine.engine} sidecar ${why}`;
    this.opts.log?.(`[app] ${this.fallbackReason}; falling back to the ${engine.fallback.engine} sidecar`);
    this.emit('fallback', { from: engine.engine, to: engine.fallback.engine, reason: this.fallbackReason });
    this.spawnEngine(engine.fallback);
    return true;
  }

  onLine(line) {
    if (!line.trim()) return;
    this.opts.log?.(line);
    const change = parseLine(line);
    if (!change) return;
    const listening = change.state === 'listening';
    // The socket can come up after the server already answered: keep the later state.
    if (listening && this.state !== 'starting') delete change.state;
    this.set(change);
    if (listening) this.emit('listening', change.wsPort);
  }

  set(change) {
    Object.assign(this, change);
    this.emit('change', this.view());
  }

  view() {
    return {
      state: this.state, detail: this.detail, address: this.address, serverName: this.serverName,
      mapName: this.mapName, gameType: this.gameType, mod: this.mod, reportedName: this.reportedName,
      players: this.players, maxPlayers: this.maxPlayers, joinedPlayers: this.joinedPlayers ?? null,
      wsPort: this.wsPort, pageConnected: this.pageConnected,
      playerName: this.playerName, playerNameFrom: this.playerNameFrom, nameFromPage: this.nameFromPage,
      recording: this.recording, startedAt: this.startedAt, engine: this.engine, fallbackReason: this.fallbackReason,
    };
  }

  get running() { return !!this.child && this.child.exitCode === null && this.child.signalCode === null; }

  /** `leave` on stdin (and SIGINT), then wait; a sidecar that does not go in time is killed. */
  async stop({ graceMs = LEAVE_GRACE_MS } = {}) {
    if (!this.running) return this.exited;
    this.set({ state: 'leaving' });
    // `leave` on stdin works on every platform (a signal cannot reach a child
    // on Windows); SIGINT stays as the fallback where signals exist.
    try { this.child.stdin.write('leave\n'); } catch { /* already gone */ }
    if (process.platform !== 'win32') { try { this.child.kill('SIGINT'); } catch { /* already gone */ } }
    const timer = setTimeout(() => {
      if (this.running) { this.opts.log?.('[app] sidecar did not leave in time; killing it'); try { this.child.kill('SIGKILL'); } catch {} }
    }, graceMs);
    const code = await this.exited;
    clearTimeout(timer);
    return code;
  }
}

module.exports = { SidecarSession, freePort, sidecarEnv };
