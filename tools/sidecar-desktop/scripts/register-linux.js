#!/usr/bin/env node
'use strict';
// Dev on this PC: make bfstats-sidecar:// links open this checkout's app.
// Writes ~/.local/share/applications/bfstats-sidecar.desktop with Exec =
// this checkout's electron binary + the app folder, and makes it the
// default handler with xdg-mime. Run again after moving the checkout; the
// packaged app (AppImage) rewrites the same entry for itself when it starts.
//
//   npm run register-linux

const path = require('node:path');
const fs = require('node:fs');
const { installProtocolHandler } = require('../src/linux-integration');

const APP = path.resolve(__dirname, '..');
const electron = path.join(APP, 'node_modules', 'electron', 'dist', 'electron');

if (process.platform !== 'linux') {
  console.error('register-linux is for Linux; Windows registers the handler from the app itself.');
  process.exit(1);
}
if (!fs.existsSync(electron)) {
  console.error(`no electron at ${electron}: run npm install first`);
  process.exit(1);
}

installProtocolHandler({ exec: [electron, APP], icon: path.join(APP, 'assets', 'icon.png') }).then((r) => {
  console.log(`wrote ${r.file}`);
  for (const [step, res] of r.steps) console.log(`${step}: ${res.ok ? 'ok' : `failed (${res.error})`}`);
  console.log(`default handler for x-scheme-handler/bfstats-sidecar: ${r.default || '(none)'}`);
  if (!r.ok) process.exit(1);
  console.log("try: xdg-open 'bfstats-sidecar://join/127.0.0.1:14568'");
});
