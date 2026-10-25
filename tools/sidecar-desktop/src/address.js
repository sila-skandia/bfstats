'use strict';
// Strict parsing of what a join is given: an address typed into the join
// window, picked from the server list, or carried by a bfstats-sidecar:// link
// any web page can open. Nothing is spawned unless this says the input is a
// plain host and port; a link from a page is untrusted input.

const SCHEME = 'bfstats-sidecar';
const DEFAULT_PORT = 14567;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// A DNS name: labels of letters, digits and inner hyphens, 253 characters at most.
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

function isHostname(h) {
  if (h.length > 253 || h.endsWith('.')) return false;
  const labels = h.split('.');
  // All-digit dotted names that failed IPV4 (999.1.1.1) are not hostnames.
  if (labels.every((l) => /^\d+$/.test(l))) return false;
  return labels.every((l) => LABEL.test(l));
}

/** `host[:port]` -> { host, port } or null. The port defaults to 14567. */
function parseAddress(text, { defaultPort = DEFAULT_PORT } = {}) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > 260) return null;
  const m = /^([^:\s/]+)(?::(\d{1,5}))?$/.exec(t);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = m[2] === undefined ? defaultPort : Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!IPV4.test(host) && !isHostname(host)) return null;
  return { host, port };
}

// A player name as the sidecar sends it: printable ASCII, no quotes or
// backslashes, 1 to 32 characters (BF1942's own limit is 32 bytes).
function cleanName(name) {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  if (!t || t.length > 32) return null;
  return /^[\x20-\x7e]+$/.test(t) && !/["\\`]/.test(t) ? t : null;
}

function cleanTeam(team) {
  const n = Number(team);
  return n === 1 || n === 2 ? n : 0;
}

/**
 * `bfstats-sidecar://join/<host>:<port>[?name=<name>]` -> { action: 'join',
 * host, port, name? } or null. Anything else (another action, a path after
 * the address, a bad name) is null.
 */
function parseJoinLink(link) {
  if (typeof link !== 'string' || link.length > 512) return null;
  let u;
  try { u = new URL(link); } catch { return null; }
  if (u.protocol !== `${SCHEME}:`) return null;
  if (u.username || u.password) return null;
  // `bfstats-sidecar://join/1.2.3.4:14567` parses with `join` as the host.
  if (u.hostname.toLowerCase() !== 'join' || u.port) return null;
  const rest = decodeURIComponent(u.pathname.replace(/^\/+/, '').replace(/\/+$/, ''));
  const addr = parseAddress(rest, { defaultPort: DEFAULT_PORT });
  if (!addr) return null;
  const out = { action: 'join', ...addr };
  if (u.searchParams.has('name')) {
    const name = cleanName(u.searchParams.get('name'));
    if (!name) return null;
    out.name = name;
  }
  return out;
}

/** The first bfstats-sidecar:// link in a process argv, or null. */
function linkFromArgv(argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${SCHEME}://`)) ?? null;
}

const formatAddress = ({ host, port }) => `${host}:${port}`;

module.exports = { SCHEME, DEFAULT_PORT, parseAddress, parseJoinLink, linkFromArgv, cleanName, cleanTeam, formatAddress };
