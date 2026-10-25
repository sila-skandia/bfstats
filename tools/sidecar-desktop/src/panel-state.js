'use strict';
// What the popup panel draws, as plain data: the same context the tray menu
// is built from (main.js context()), reduced to what src/ui/panel.js needs.
// Pure, so the shape is tested without Electron.

const { mapImageUrl } = require('./map-image');
const { displayName, mapTitle, gameTypeTitle, trayIconState } = require('./sidecar-status');
const { decodeName } = require('./servers');

const ENDED = new Set(['idle', 'denied', 'ended', 'failed']);
const SERVERS_MAX = 150;     // the live list is ~80; a cap keeps a bad day cheap

const NAME_SOURCE_LABELS = {
  account: 'bfstats.io profile',
  page: 'Viewer profile',
  install: 'Install profile',
  custom: 'Custom name',
};

/** The live session's card, or null when not on a server. */
function sessionCard(session, listed) {
  if (!session || ENDED.has(session.state)) return null;
  const mod = session.mod ?? listed?.gameId ?? null;
  const mapName = session.mapName ?? listed?.mapName ?? null;
  const players = listed?.numPlayers ?? session.players ?? session.joinedPlayers ?? null;
  const maxPlayers = listed?.maxPlayers ?? session.maxPlayers ?? null;
  return {
    state: session.state,
    dot: trayIconState(session),               // 'joined' | 'joining' | null
    name: displayName(session),
    address: session.address,
    map: mapTitle(mapName),
    gameType: gameTypeTitle(session.gameType ?? listed?.gameType),
    mod,
    thumb: mapImageUrl(mod, mapName),
    players, maxPlayers,
    // The round as the live list last saw it (null when it does not say).
    roundTimeRemain: listed?.roundTimeRemain ?? null,
    tickets1: listed?.tickets1 ?? null,
    tickets2: listed?.tickets2 ?? null,
    team1: listed?.team1 ?? null,
    team2: listed?.team2 ?? null,
    playerName: session.playerName ?? null,
    waitingForName: !session.playerName && !!session.nameFromPage,
    pageConnected: !!session.pageConnected,
    canOpenViewer: !!session.wsPort,
    canLeave: session.state !== 'leaving',
    detail: session.detail || '',
  };
}

/**
 * The account section (features/app-sign-in): signed out, waiting for the
 * browser, or signed in with the profile list. Player names are shown
 * decoded (as the site shows them); `name` is what activate is called with.
 * `playsAs` is the name a join uses (the sidecar name when set, else the
 * game's `playerName`); `renamed` says they differ; `sidecarName` is raw,
 * for the edit field.
 */
function accountSection(account) {
  if (!account) return null;
  const profiles = (account.profiles ?? []).map((p) => {
    const playerName = decodeName(p.playerName) || p.name;
    const sidecarName = p.sidecarName ?? null;
    const playsAs = sidecarName ? decodeName(sidecarName) || sidecarName : playerName;
    return {
      name: p.name,
      playerName,
      playsAs,
      sidecarName,
      renamed: !!sidecarName && playsAs !== playerName,
      active: !!p.active,
    };
  });
  return {
    status: account.status,
    username: account.username ?? null,
    profiles,
    loaded: Array.isArray(account.profiles),
    active: profiles.find((p) => p.active) ?? null,
    error: account.profilesError ?? null,
    notice: account.notice ?? null,
    // basic_text: saved, but not under a keyring (Linux without one); memory: not saved at all.
    protection: account.protection ?? 'keyring',
    importUrl: account.importUrl ?? null,
  };
}

/**
 * The panel's state. `ctx`: { session, servers, serversError, serversAt,
 * settings, nameInfo, tray, mode, hint }.
 */
function panelState(ctx) {
  const session = ctx.session ?? null;
  const servers = ctx.servers ?? [];
  const listed = session ? servers.find((s) => `${s.ip}:${s.port}` === session.address) ?? null : null;
  const card = sessionCard(session, listed);
  const ended = session && ['denied', 'ended', 'failed'].includes(session.state)
    ? (session.detail || session.state) : null;
  const source = ctx.nameInfo?.source ?? ctx.settings?.nameSource ?? 'custom';
  return {
    card,
    lastEnded: card ? null : ended,
    dot: trayIconState(session),
    current: session && !ENDED.has(session.state) ? session.address : null,
    servers: servers.slice(0, SERVERS_MAX),
    serversTotal: servers.length,
    serversError: ctx.serversError ?? null,
    serversAt: ctx.serversAt ?? null,
    recent: ctx.settings?.recent ?? [],
    name: {
      source,
      label: NAME_SOURCE_LABELS[source] ?? NAME_SOURCE_LABELS.custom,
      // The name the next join uses; for the viewer's profile the fallback
      // (the profile's own name arrives once the viewer opens).
      name: ctx.nameInfo?.name ?? ctx.settings?.playerName ?? '',
      fromPage: source === 'page',
      profile: ctx.nameInfo?.profile ?? null,
      detail: ctx.nameInfo?.detail ?? '',
    },
    // Window mode (src/app-mode.js): the panel is the app's window, and
    // carries the tray hint until it is dismissed.
    trayless: ctx.mode ? ctx.mode === 'window' : ctx.tray?.visible === false,
    hint: (ctx.mode ? ctx.mode === 'window' : ctx.tray?.visible === false) ? ctx.hint ?? null : null,
    account: accountSection(ctx.account),
  };
}

module.exports = { panelState, sessionCard, accountSection, NAME_SOURCE_LABELS, SERVERS_MAX };
