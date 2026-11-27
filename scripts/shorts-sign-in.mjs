#!/usr/bin/env node
// Signs the Replay Shorts job in, once (features/replay-shorts, "Signing in"):
// the relay's browser hand-off (features/app-sign-in) under the bfstats-shorts
// client. It opens bfstats.io's Allow page in the default browser; sign in
// there as an admin (or a BfvAdmin, for Battlefield Vietnam's Shorts alone) and
// press Allow. The sign-in is kept in ~/.config/bfstats/shorts-sign-in.json
// (SHORTS_SIGN_IN), which every Shorts tool reads (scripts/shorts-auth.mjs).
//
//   node scripts/shorts-sign-in.mjs [--site=https://bfstats.io] [--api=<site>] [--device=<name>] [--no-open] [--wait=<minutes>]
//   node scripts/shorts-sign-in.mjs --status      who it is signed in as, and until when
//   node scripts/shorts-sign-in.mjs --sign-out    revoke it and remove the file
//
// It shows in the account's Signed-in apps (bfstats.io/v4/dashboard?tab=apps)
// as "bfstats Shorts job", where it can be signed out from too.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { SHORTS_CLIENT, SIGN_IN_FILE, readSignIn, shortsAuth, signInFrom, writeSignIn } from './shorts-auth.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SITE = opt('site', 'https://bfstats.io').replace(/\/$/, '');
const API = opt('api', SITE).replace(/\/$/, '');
// Not the hostname: a Mac's is often its owner's name, and the Allow page and Signed-in apps show it.
const DEVICE = opt('device', 'Shorts nightly');
/** How long to wait for Allow; the one-time code itself lives two minutes once Allow is pressed. */
const WAIT_MINUTES = Number(opt('wait', 10));

if (args.includes('--status')) {
  const signIn = readSignIn();
  if (!signIn) {
    console.log(`not signed in (${SIGN_IN_FILE})`);
    process.exit(1);
  }
  try {
    await shortsAuth();
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
  const now = readSignIn();
  console.log(`signed in to ${now.api} as ${now.user?.username} (account ${now.user?.id})`);
  console.log(`access token until ${now.expiresAt}, sign-in until ${now.refreshExpiresAt}`);
  process.exit(0);
}

if (args.includes('--sign-out')) {
  const signIn = readSignIn();
  if (signIn) {
    const res = await fetch(`${signIn.api}/stats/auth/app/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: signIn.refreshToken }),
    });
    console.log(`revoke answered ${res.status}`);
    fs.rmSync(SIGN_IN_FILE, { force: true });
  }
  console.log('signed out');
  process.exit(0);
}

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');

let done;
const callback = new Promise(resolve => { done = resolve; });
const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>`
  + `<body style="font:16px system-ui;padding:3em;background:#101418;color:#e8ecef"><p>${text}</p>`;
const listener = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(ok ? page('bfstats Shorts job', 'The Shorts job is signed in. You can close this tab.')
    : page('bfstats Shorts job', 'The sign-in did not finish. Run the sign-in again.'));
  done(url);
});
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const redirectUri = `http://127.0.0.1:${listener.address().port}/callback`;

const query = new URLSearchParams({
  client: SHORTS_CLIENT, device: DEVICE, redirect_uri: redirectUri, state,
  code_challenge: challenge, code_challenge_method: 'S256',
});
const allowUrl = `${SITE}/auth/app?${query}`;
console.log(`Sign in on bfstats.io as an admin and press Allow:\n\n  ${allowUrl}\n`);
if (!args.includes('--no-open')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(opener, [allowUrl], () => {});
}

const timeout = setTimeout(() => {
  console.error(`no answer from the browser within ${WAIT_MINUTES} minutes; run it again`);
  process.exit(1);
}, WAIT_MINUTES * 60_000);
const back = await callback;
clearTimeout(timeout);
listener.close();

if (back.searchParams.get('state') !== state) {
  console.error('the browser came back with the wrong state; nothing kept');
  process.exit(1);
}
if (back.searchParams.get('error')) {
  console.error(`the sign-in was declined (${back.searchParams.get('error')})`);
  process.exit(1);
}

const res = await fetch(`${API}/stats/auth/app/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: back.searchParams.get('code'), codeVerifier: verifier, redirectUri }),
});
const answer = await res.json().catch(() => null);
if (!res.ok || !answer?.accessToken) {
  console.error(`the code exchange answered ${res.status}: ${JSON.stringify(answer)}`);
  process.exit(1);
}
writeSignIn(signInFrom(API, answer));

// Whether the account may write at all: the prune's dry run is a writer's call that changes nothing.
const check = await fetch(`${API}/stats/shorts/prune?dryRun=true`, { method: 'POST', headers: { Authorization: `Bearer ${answer.accessToken}` } });
console.log(`signed in as ${answer.user?.username} (account ${answer.user?.id}); kept in ${SIGN_IN_FILE}`);
if (check.ok) {
  console.log('this account may write Shorts');
} else {
  console.error(`but this account may not write Shorts (the prune's dry run answered ${check.status}): sign in as an admin`);
  process.exit(1);
}
