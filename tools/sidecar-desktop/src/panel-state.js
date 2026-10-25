'use strict';
// What the popup panel draws, as plain data: the same context the tray menu
// is built from (main.js context()), reduced to what src/ui/panel.js needs.
// Pure, so the shape is tested without Electron.

const { mapImageUrl } = require('./map-image');
const { displayName, mapTitle, gameTypeTitle, trayIconState } = require('./sidecar-status');

const ENDED = new Set(['idle', 'denied', 'ended', 'failed']);
const SERVERS_MAX = 150;     // the live list is ~80; a cap keeps a bad day cheap

const NAME_SOURCE_LABELS = {
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
 * The panel's state. `ctx`: { session, servers, serversError, serversAt,
 * settings, nameInfo, tray }.
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
      detail: ctx.nameInfo?.detail ?? '',
    },
    trayless: ctx.tray?.visible === false,
  };
}

module.exports = { panelState, sessionCard, NAME_SOURCE_LABELS, SERVERS_MAX };
