import type { RouteLocationNormalized } from 'vue-router'

const VISITOR_KEY = 'bfstats_visitor_id'
const SESSION_KEY = 'bfstats_session_id'
const PAGE_VIEW_URL = '/stats/telemetry/page-view'

type PageViewPayload = {
  pageType: string
  slug?: string | null
  visitorId: string
  sessionId: string
  referrer?: string | null
  routeName?: string | null
  path?: string | null
}

const ROUTE_TO_PAGE_TYPE: Record<string, string> = {
  'landing': 'landing',
  'dashboard': 'dashboard',
  'servers-bf1942': 'server_list',
  'servers-fh2': 'server_list',
  'servers-bfv': 'server_list',
  'servers-bf1942-v3': 'server_list',
  'servers-fh2-v3': 'server_list',
  'servers-bfv-v3': 'server_list',
  'server-details': 'server_details',
  'server-sessions': 'server_sessions',
  'players': 'players',
  'player-comparison': 'player_comparison',
  'player-details': 'player_details',
  'player-sessions': 'player_sessions',
  'player-achievements': 'player_achievements',
  'player-network': 'player_network',
  'round-report': 'round_report',
  'public-tournament': 'tournament',
  'public-tournament-rankings': 'tournament_rankings',
  'public-tournament-rules': 'tournament_rules',
  'public-tournament-teams': 'tournament_teams',
  'public-tournament-matches': 'tournament_matches',
  'public-tournament-stats': 'tournament_stats',
  'public-tournament-files': 'tournament_files',
  'admin-tournament-details-tab': 'admin_tournament',
  'admin-data': 'admin_data',
  'system-stats': 'system_stats',
  'discord-callback': 'discord_callback',
  'community-details': 'community_details',
  'map-popularity': 'map_popularity',
  'alias-detection': 'alias_detection'
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readOrCreate(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key)
    if (existing) return existing
    const id = generateId()
    storage.setItem(key, id)
    return id
  } catch {
    return generateId()
  }
}

function resolveSlug(route: RouteLocationNormalized): string | null {
  const routeName = typeof route.name === 'string' ? route.name : null
  const params = route.params ?? {}

  if (routeName?.startsWith('servers-')) {
    return routeName.replace(/^servers-/, '')
  }

  const pick = (source: Record<string, unknown>, key: string): string | null => {
    const value = source[key]
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
    if (typeof value === 'string' && value.length > 0) return value
    return null
  }

  // player-comparison identifies the "page" via query params, not params.
  if (routeName === 'player-comparison') {
    const query = route.query ?? {}
    const p1 = pick(query, 'player1')
    const p2 = pick(query, 'player2')
    if (p1 && p2) return `${p1}-vs-${p2}`
    return p1 ?? p2 ?? null
  }

  return pick(params, 'serverName')
    ?? pick(params, 'playerName')
    ?? pick(params, 'roundId')
    ?? pick(params, 'id')
    ?? pick(params, 'serverGuid')
    ?? null
}

function resolvePageType(routeName: string | null): string {
  if (!routeName) return 'other'
  return ROUTE_TO_PAGE_TYPE[routeName] ?? 'other'
}

const MIN_INTERVAL_MS = 1_500

class TelemetryService {
  private readonly visitorId: string
  private readonly sessionId: string
  private lastKey: string | null = null
  private lastAt = 0

  constructor() {
    this.visitorId = readOrCreate(localStorage, VISITOR_KEY)
    this.sessionId = readOrCreate(sessionStorage, SESSION_KEY)
  }

  recordPageView(route: RouteLocationNormalized): void {
    const routeName = typeof route.name === 'string' ? route.name : null
    const pageType = resolvePageType(routeName)
    const slug = resolveSlug(route)
    // Dedupe on (pageType, slug, path) only — query-string changes (tab switches,
    // filter updates) must not produce new page views. Routes whose identity lives
    // in query params fold that into slug above.
    const key = `${pageType}|${slug ?? ''}|${route.path}`

    const now = Date.now()
    if (key === this.lastKey && now - this.lastAt < MIN_INTERVAL_MS) return
    this.lastKey = key
    this.lastAt = now

    const payload: PageViewPayload = {
      pageType,
      slug,
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      routeName,
      path: route.path
    }

    this.send(payload)
  }

  private send(payload: PageViewPayload): void {
    const body = JSON.stringify(payload)

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' })
        if (navigator.sendBeacon(PAGE_VIEW_URL, blob)) return
      }
    } catch {
      // fall through to fetch
    }

    try {
      void fetch(PAGE_VIEW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit'
      }).catch(() => { /* swallow — telemetry must never break the UI */ })
    } catch {
      // ignore
    }
  }
}

export const telemetryService = new TelemetryService()
