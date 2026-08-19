import type { ServerSummary } from '@/types/server'
import { countryCodeToName } from '@/types/countryCodes'
import { decodePlayerName, decodeServerName } from '@/utils/playerName'
import { formatTimeRemaining, formatRelativeTime } from '@/utils/timeUtils'

export type ColAlign = 'left' | 'right' | 'center'
export type ColKind = 'custom' | 'text' | 'num' | 'bool' | 'link' | 'duration'
export type FilterKind = 'none' | 'text' | 'number' | 'bool'
export type ColGroup = 'identity' | 'live' | 'match' | 'host' | 'geo' | 'links' | 'ids'

export interface ServerColumnDef {
  key: string
  label: string
  align: ColAlign
  w: number
  kind: ColKind
  filter: FilterKind
  group: ColGroup
  sortable?: boolean
  defaultHidden?: boolean
}

export const COLUMN_GROUPS: { id: ColGroup; label: string }[] = [
  { id: 'identity', label: 'Server' },
  { id: 'live', label: 'Population' },
  { id: 'match', label: 'Match' },
  { id: 'host', label: 'Host' },
  { id: 'geo', label: 'Location' },
  { id: 'links', label: 'Links' },
  { id: 'ids', label: 'IDs' },
]

export const ALL_COLUMNS: ServerColumnDef[] = [
  { key: 'rank', label: '#', align: 'right', w: 48, kind: 'custom', filter: 'none', group: 'identity', sortable: false },
  { key: 'action', label: 'Join', align: 'center', w: 168, kind: 'custom', filter: 'none', group: 'identity', sortable: false },
  { key: 'name', label: 'Server', align: 'left', w: 300, kind: 'custom', filter: 'text', group: 'identity' },
  { key: 'players', label: 'Players', align: 'right', w: 115, kind: 'custom', filter: 'number', group: 'live' },
  { key: 'load', label: 'Load', align: 'right', w: 115, kind: 'custom', filter: 'number', group: 'live' },
  { key: 'emptySlots', label: 'Empty', align: 'right', w: 80, kind: 'num', filter: 'number', group: 'live', defaultHidden: true },
  { key: 'humans', label: 'Humans', align: 'right', w: 90, kind: 'num', filter: 'number', group: 'live', defaultHidden: true },
  { key: 'bots', label: 'Bots', align: 'right', w: 72, kind: 'num', filter: 'number', group: 'live', defaultHidden: true },
  { key: 'map', label: 'Map', align: 'left', w: 180, kind: 'custom', filter: 'text', group: 'match' },
  { key: 'gameType', label: 'Mode', align: 'left', w: 115, kind: 'custom', filter: 'text', group: 'match' },
  { key: 'gameMode', label: 'Game Mode', align: 'left', w: 110, kind: 'text', filter: 'text', group: 'match', defaultHidden: true },
  { key: 'region', label: 'Country', align: 'left', w: 155, kind: 'custom', filter: 'text', group: 'geo' },
  { key: 'ping', label: 'Avg Ping', align: 'right', w: 100, kind: 'custom', filter: 'number', group: 'live' },
  { key: 'timeRemain', label: 'Time Left', align: 'right', w: 105, kind: 'custom', filter: 'number', group: 'match' },
  { key: 'roundTime', label: 'Round Len', align: 'right', w: 100, kind: 'duration', filter: 'number', group: 'match', defaultHidden: true },
  { key: 'tickets', label: 'Tickets', align: 'right', w: 115, kind: 'custom', filter: 'number', group: 'match', defaultHidden: true },
  { key: 'ticketLead', label: 'Ticket Δ', align: 'right', w: 95, kind: 'num', filter: 'number', group: 'match', defaultHidden: true },
  { key: 'teams', label: 'Teams', align: 'left', w: 160, kind: 'text', filter: 'text', group: 'match', defaultHidden: true },
  { key: 'balance', label: 'Balance', align: 'right', w: 90, kind: 'num', filter: 'number', group: 'live', defaultHidden: true },
  { key: 'ip', label: 'Address', align: 'left', w: 165, kind: 'custom', filter: 'text', group: 'host', defaultHidden: true },
  { key: 'queryPort', label: 'Query Port', align: 'right', w: 105, kind: 'num', filter: 'number', group: 'host', defaultHidden: true },
  { key: 'password', label: 'Password', align: 'center', w: 100, kind: 'bool', filter: 'bool', group: 'host', defaultHidden: true },
  { key: 'version', label: 'Version', align: 'left', w: 90, kind: 'text', filter: 'text', group: 'host', defaultHidden: true },
  { key: 'fps', label: 'Avg FPS', align: 'right', w: 90, kind: 'num', filter: 'number', group: 'host', defaultHidden: true },
  { key: 'dedicated', label: 'Dedicated', align: 'center', w: 105, kind: 'bool', filter: 'bool', group: 'host', defaultHidden: true },
  { key: 'reserved', label: 'Reserved', align: 'right', w: 95, kind: 'num', filter: 'number', group: 'host', defaultHidden: true },
  { key: 'anticheat', label: 'Anticheat', align: 'center', w: 105, kind: 'bool', filter: 'bool', group: 'host', defaultHidden: true },
  { key: 'contentCheck', label: 'Content Chk', align: 'center', w: 115, kind: 'bool', filter: 'bool', group: 'host', defaultHidden: true },
  { key: 'unpureMods', label: 'Mods', align: 'left', w: 140, kind: 'text', filter: 'text', group: 'host', defaultHidden: true },
  { key: 'status', label: 'Status', align: 'right', w: 80, kind: 'num', filter: 'number', group: 'host', defaultHidden: true },
  { key: 'geoRegion', label: 'Region', align: 'left', w: 140, kind: 'text', filter: 'text', group: 'geo', defaultHidden: true },
  { key: 'city', label: 'City', align: 'left', w: 130, kind: 'text', filter: 'text', group: 'geo', defaultHidden: true },
  { key: 'timezone', label: 'Timezone', align: 'left', w: 140, kind: 'text', filter: 'text', group: 'geo', defaultHidden: true },
  { key: 'org', label: 'Org / ASN', align: 'left', w: 200, kind: 'text', filter: 'text', group: 'geo', defaultHidden: true },
  { key: 'postal', label: 'Postal', align: 'left', w: 90, kind: 'text', filter: 'text', group: 'geo', defaultHidden: true },
  { key: 'loc', label: 'Coords', align: 'left', w: 140, kind: 'text', filter: 'text', group: 'geo', defaultHidden: true },
  { key: 'discord', label: 'Discord', align: 'left', w: 140, kind: 'link', filter: 'text', group: 'links', defaultHidden: true },
  { key: 'forum', label: 'Forum', align: 'left', w: 140, kind: 'link', filter: 'text', group: 'links', defaultHidden: true },
  { key: 'joinLink', label: 'Join Link', align: 'left', w: 180, kind: 'link', filter: 'text', group: 'links', defaultHidden: true },
  { key: 'guid', label: 'GUID', align: 'left', w: 220, kind: 'text', filter: 'text', group: 'ids', defaultHidden: true },
  { key: 'mapId', label: 'Map ID', align: 'left', w: 120, kind: 'text', filter: 'text', group: 'ids', defaultHidden: true },
  { key: 'lastSeen', label: 'Last Seen', align: 'left', w: 130, kind: 'text', filter: 'text', group: 'ids', defaultHidden: true },
]

export const DEFAULT_HIDDEN = ALL_COLUMNS.filter(c => c.defaultHidden).map(c => c.key)
export const DEFAULT_PINNED = ['rank', 'action', 'name']
export const DEFAULT_SORT = [{ key: 'players', dir: 'desc' as const }]

export const getCol = (key: string) => ALL_COLUMNS.find(c => c.key === key)

export const friendlyCountry = (code?: string | null) => {
  if (!code) return '—'
  return countryCodeToName[code.toUpperCase()] ?? code.toUpperCase()
}

export const getAveragePing = (s: ServerSummary): number | null => {
  if (!s.players || s.players.length === 0) return null
  const validPings = s.players.map(p => p.ping).filter(p => p > 0)
  if (validPings.length === 0) return null
  return Math.round(validPings.reduce((acc, p) => acc + p, 0) / validPings.length)
}

export const getBotCount = (s: ServerSummary) =>
  (s.players ?? []).filter(p => p.aiBot).length

export const getHumanCount = (s: ServerSummary) => {
  const players = s.players ?? []
  if (players.length === 0) return s.numPlayers || 0
  return players.filter(p => !p.aiBot).length
}

export const getTeamPlayerCount = (s: ServerSummary, teamIndex: number) =>
  (s.players ?? []).filter(p => p.team === teamIndex).length

const teamLabel = (s: ServerSummary, teamIndex: number) => {
  const t = (s.teams ?? []).find(tm => tm.index === teamIndex)
  if (t?.label) return t.label
  return teamIndex === 1 ? 'Allied' : 'Axis'
}

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export const getCellValue = (s: ServerSummary, key: string): unknown => {
  switch (key) {
    case 'rank': return 0
    case 'name': return decodeServerName(s.name || '').toLowerCase()
    case 'players': return s.numPlayers || 0
    case 'load': return s.maxPlayers ? Math.round(((s.numPlayers || 0) / s.maxPlayers) * 100) : 0
    case 'emptySlots': return Math.max(0, (s.maxPlayers || 0) - (s.numPlayers || 0))
    case 'humans': return getHumanCount(s)
    case 'bots': return getBotCount(s)
    case 'map': return (s.mapName || '').toLowerCase()
    case 'gameType': return (s.gameType || '').toLowerCase()
    case 'gameMode': return s.gameMode || ''
    case 'region': return friendlyCountry(s.country).toLowerCase()
    case 'ping': return getAveragePing(s)
    case 'timeRemain': return s.roundTimeRemain !== undefined && s.roundTimeRemain >= 0 ? s.roundTimeRemain : null
    case 'roundTime': return s.roundTime && s.roundTime > 0 ? s.roundTime : null
    case 'tickets': return Math.max(s.tickets1 ?? 0, s.tickets2 ?? 0)
    case 'ticketLead': return (s.tickets1 ?? 0) - (s.tickets2 ?? 0)
    case 'teams': return `${teamLabel(s, 1)} / ${teamLabel(s, 2)}`
    case 'balance': return Math.abs(getTeamPlayerCount(s, 1) - getTeamPlayerCount(s, 2))
    case 'ip': return `${s.ip}:${s.port}`
    case 'queryPort': return s.queryPort || null
    case 'password': return !!s.password
    case 'version': return s.gameVersion || ''
    case 'fps': return s.averageFps && s.averageFps > 0 ? s.averageFps : null
    case 'dedicated': return (s.dedicated ?? 0) !== 0
    case 'reserved': return s.reservedSlots ?? 0
    case 'anticheat': return !!s.anticheat
    case 'contentCheck': return !!s.contentCheck
    case 'unpureMods': return s.unpureMods || ''
    case 'status': return s.status ?? null
    case 'geoRegion': return s.region || ''
    case 'city': return s.city || ''
    case 'timezone': return s.timezone || ''
    case 'org': return s.org || ''
    case 'postal': return s.postal || ''
    case 'loc': return s.loc || ''
    case 'discord': return s.discordUrl || ''
    case 'forum': return s.forumUrl || ''
    case 'joinLink': return s.joinLink || s.joinLinkWeb || ''
    case 'guid': return s.guid || ''
    case 'mapId': return s.mapId || ''
    case 'lastSeen': return s.lastSeenTime || ''
    default: return (s as unknown as Record<string, unknown>)[key] ?? ''
  }
}

export const getDisplayValue = (s: ServerSummary, key: string): string => {
  const col = getCol(key)
  const value = getCellValue(s, key)
  if (value === null || value === undefined || value === '') return ''
  if (key === 'name') return decodeServerName(s.name || '')
  if (key === 'load') return s.maxPlayers ? `${Math.round(((s.numPlayers || 0) / s.maxPlayers) * 100)}%` : '0%'
  if (key === 'players') return `${s.numPlayers || 0} / ${s.maxPlayers || 0}`
  if (key === 'tickets') {
    if ((s.tickets1 ?? 0) <= 0 && (s.tickets2 ?? 0) <= 0) return ''
    return `${s.tickets1 ?? 0}:${s.tickets2 ?? 0}`
  }
  if (key === 'ping') return value === null ? '' : `${value}`
  if (key === 'timeRemain' || key === 'roundTime') {
    return typeof value === 'number' ? formatTimeRemaining(value) : ''
  }
  if (key === 'lastSeen' && typeof value === 'string') {
    return formatRelativeTime(value) || value
  }
  if (col?.kind === 'bool' || typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (key === 'region') return friendlyCountry(s.country)
  return stringify(value)
}

const parseBoolQuery = (q: string): boolean | null => {
  const n = q.trim().toLowerCase()
  if (['y', 'yes', 'true', '1', 'on', 'locked'].includes(n)) return true
  if (['n', 'no', 'false', '0', 'off', 'open', '-'].includes(n)) return false
  return null
}

const toNum = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return null
}

const matchText = (hay: string, q: string): boolean =>
  hay.toLowerCase().includes(q.toLowerCase())

export interface NumberRangeBounds {
  min: number | null
  max: number | null
}

export const parseNumberRangeQuery = (q: string): NumberRangeBounds | null => {
  const t = q.trim()
  if (!t) return { min: null, max: null }
  const range = t.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  const op = t.match(/^(<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?)$/)
  if (op) {
    const n = Number(op[2])
    switch (op[1]) {
      case '>':
      case '>=':
        return { min: n, max: null }
      case '<':
      case '<=':
        return { min: null, max: n }
      case '=':
        return { min: n, max: n }
    }
  }
  const asNum = Number(t)
  if (t !== '' && !Number.isNaN(asNum)) return { min: asNum, max: asNum }
  return null
}

export const formatNumberRangeQuery = (min: number, max: number): string => {
  if (min === max) return String(min)
  return `${min}..${max}`
}

export const formatFilterNumber = (key: string, n: number): string => {
  if (key === 'load') return `${Math.round(n)}%`
  if (key === 'timeRemain' || key === 'roundTime') return formatTimeRemaining(n)
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 10) / 10)
}

export const formatColFilterValue = (key: string, query: string): string => {
  const col = getCol(key)
  const q = query.trim()
  if (!q) return ''
  if (col?.filter === 'number') {
    const parsed = parseNumberRangeQuery(q)
    if (parsed && (parsed.min !== null || parsed.max !== null)) {
      const lo = parsed.min !== null ? formatFilterNumber(key, parsed.min) : ''
      const hi = parsed.max !== null ? formatFilterNumber(key, parsed.max) : ''
      if (parsed.min !== null && parsed.max !== null && parsed.min === parsed.max) return lo
      if (parsed.min !== null && parsed.max !== null) return `${lo}–${hi}`
      if (parsed.min !== null) return `${lo}+`
      return `≤${hi}`
    }
  }
  return q
}

export const formatColFilterLabel = (key: string, query: string): string => {
  const heading = (getCol(key)?.label || key).toUpperCase()
  const value = formatColFilterValue(key, query)
  return value ? `${heading}: ${value}` : heading
}

export const columnNumericExtent = (servers: ServerSummary[], key: string): { min: number; max: number } | null => {
  let min = Infinity
  let max = -Infinity
  for (const s of servers) {
    const n = toNum(getCellValue(s, key))
    if (n === null) continue
    if (n < min) min = n
    if (n > max) max = n
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

export const columnFilterStep = (key: string, extent: { min: number; max: number }): number => {
  if (key === 'timeRemain' || key === 'roundTime') return 30
  const span = extent.max - extent.min
  if (span > 500) return 10
  if (Number.isInteger(extent.min) && Number.isInteger(extent.max)) return 1
  return 0.1
}

const matchNumber = (num: number | null, q: string): boolean => {
  if (num === null) return false
  const range = q.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/)
  if (range) return num >= Number(range[1]) && num <= Number(range[2])
  const op = q.match(/^(<=|>=|!=|<|>|=)\s*(-?\d+(?:\.\d+)?)$/)
  if (op) {
    const n = Number(op[2])
    switch (op[1]) {
      case '>': return num > n
      case '>=': return num >= n
      case '<': return num < n
      case '<=': return num <= n
      case '=': return num === n
      case '!=': return num !== n
    }
  }
  const asNum = Number(q)
  if (q !== '' && !Number.isNaN(asNum)) return num === asNum
  return false
}

export const matchColumnFilter = (value: unknown, rawQuery: string, kind: FilterKind): boolean => {
  const q = rawQuery.trim()
  if (!q || kind === 'none') return true
  if (kind === 'bool') {
    const want = parseBoolQuery(q)
    if (want === null) return matchText(stringify(value), q)
    return Boolean(value) === want
  }
  if (kind === 'number') return matchNumber(toNum(value), q)
  return matchText(stringify(value), q)
}

export const matchesGlobalSearch = (s: ServerSummary, rawQuery: string): boolean => {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return true
  const haystacks = [
    decodeServerName(s.name || ''),
    s.name || '',
    s.ip || '',
    `${s.ip}:${s.port}`,
    s.mapName || '',
    s.gameType || '',
    s.gameMode || '',
    s.gameVersion || '',
    s.city || '',
    s.region || '',
    s.org || '',
    s.guid || '',
    friendlyCountry(s.country),
    s.country || '',
    ...(s.players ?? []).flatMap(p => [p.name, decodePlayerName(p.name)]),
  ]
  return haystacks.some(h => h.toLowerCase().includes(q))
}

export const uniqueColumnValues = (
  servers: ServerSummary[],
  key: string,
  limit = 80,
): { value: string; count: number }[] => {
  const counts = new Map<string, number>()
  for (const s of servers) {
    const display = getDisplayValue(s, key).trim()
    if (!display) continue
    counts.set(display, (counts.get(display) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))
}

export const csvEscape = (value: string): string => `"${value.replace(/"/g, '""')}"`

export const rowsToCsv = (rows: ServerSummary[], columns: string[]): string => {
  const headers = columns.map(k => csvEscape(getCol(k)?.label || k)).join(',')
  const lines = rows.map(s =>
    columns.map(k => csvEscape(getDisplayValue(s, k) || stringify(getCellValue(s, k)))).join(','),
  )
  return `\uFEFF${[headers, ...lines].join('\r\n')}`
}

export const rowsToTsv = (rows: ServerSummary[], columns: string[]): string => {
  const headers = columns.map(k => getCol(k)?.label || k).join('\t')
  const lines = rows.map(s =>
    columns.map(k => (getDisplayValue(s, k) || stringify(getCellValue(s, k))).replace(/\t/g, ' ')).join('\t'),
  )
  return [headers, ...lines].join('\n')
}

export const linkHostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
