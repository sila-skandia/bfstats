<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import 'primeicons/primeicons.css'
import { fetchAllServers, peekCachedLiveServers } from '@/services/serverDetailsService'
import type { ServerSummary } from '@/types/server'
import { countryCodeToFlag } from '@/types/countryCodes'
import { loadClass, teamColor } from './mmTokens'
import MmInstallationLinks from '@/components/v4/MmInstallationLinks.vue'
import MmServerConnectAction from '@/components/v4/MmServerConnectAction.vue'
import MmPopulationTrendPanel from '@/components/v4/MmPopulationTrendPanel.vue'
import LandingColumnFilterPanel from './LandingColumnFilterPanel.vue'
import { formatTimeRemaining, formatRelativeTime, formatLocalTooltip, parseUtc } from '@/utils/timeUtils'
import {
  ALL_COLUMNS,
  COLUMN_GROUPS,
  DEFAULT_HIDDEN,
  DEFAULT_PINNED,
  DEFAULT_SORT,
  formatColFilterLabel,
  formatColFilterValue,
  friendlyCountry,
  getAveragePing,
  getCellValue,
  getCol,
  getDisplayValue,
  getTeamPlayerCount,
  linkHostname,
  matchColumnFilter,
  matchesGlobalSearch,
  rowsToCsv,
  rowsToTsv,
} from './landingServerTable'

type GameKey = 'bf1942'
const GAME_LABEL = 'Battlefield 1942'

defineProps<{ initialMode?: string }>()

const router = useRouter()
const route = useRoute()

// ============================================================================
// Layout Preferences & LocalStorage Persistence
// ============================================================================
const STORAGE_KEY = 'bfstats_landing_table_layout_v1'

const loadSavedLayout = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const saved = loadSavedLayout()

const order = ref<string[]>(
  Array.isArray(saved?.order) && saved.order.length > 0
    ? [
        ...saved.order.filter((k: string) => ALL_COLUMNS.some(c => c.key === k)),
        ...ALL_COLUMNS.map(c => c.key).filter(k => !saved.order.includes(k))
      ]
    : ALL_COLUMNS.map(c => c.key)
)

const hidden = ref<Set<string>>((() => {
  const known = new Set(ALL_COLUMNS.map(c => c.key))
  const fromSave = Array.isArray(saved?.hidden)
    ? saved.hidden.filter((k: string) => known.has(k))
    : [...DEFAULT_HIDDEN]
  const next = new Set<string>(fromSave)
  if (Array.isArray(saved?.order)) {
    for (const col of ALL_COLUMNS) {
      if (!saved.order.includes(col.key) && col.defaultHidden) next.add(col.key)
    }
  }
  return next
})())

const pinned = ref<string[]>(
  Array.isArray(saved?.pinned)
    ? saved.pinned.filter((k: string) => ALL_COLUMNS.some(c => c.key === k))
    : [...DEFAULT_PINNED]
)

const widths = ref<Record<string, number>>({
  ...ALL_COLUMNS.reduce((acc, c) => { acc[c.key] = c.w; return acc }, {} as Record<string, number>),
  ...(typeof saved?.widths === 'object' && saved?.widths !== null ? saved.widths : {})
})

const sort = ref<{ key: string; dir: 'asc' | 'desc' }[]>(
  Array.isArray(saved?.sort) && saved.sort.length > 0
    ? saved.sort
    : [...DEFAULT_SORT]
)

const colFilters = ref<Record<string, string>>(
  saved?.colFilters && typeof saved.colFilters === 'object' ? { ...saved.colFilters } : {}
)

const filtersOpen = ref(false)
const filterColKey = ref<string | null>(null)

const density = ref<'comfortable' | 'compact'>(
  saved?.density === 'compact' ? 'compact' : 'comfortable'
)

const filterPreset = ref<'all' | 'populated' | 'standby'>(
  saved?.filterPreset === 'populated' || saved?.filterPreset === 'standby' ? saved.filterPreset : 'all'
)

const filterQuery = ref('')

watch([order, hidden, pinned, widths, sort, density, filterPreset, colFilters], () => {
  try {
    const payload = {
      order: order.value,
      hidden: Array.from(hidden.value),
      pinned: pinned.value,
      widths: widths.value,
      sort: sort.value,
      density: density.value,
      filterPreset: filterPreset.value,
      colFilters: colFilters.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota/security errors
  }
}, { deep: true })

const resetColumns = () => {
  order.value = ALL_COLUMNS.map(c => c.key)
  hidden.value = new Set(DEFAULT_HIDDEN)
  pinned.value = [...DEFAULT_PINNED]
  widths.value = ALL_COLUMNS.reduce((acc, c) => { acc[c.key] = c.w; return acc }, {} as Record<string, number>)
}

const resetAll = () => {
  resetColumns()
  sort.value = [...DEFAULT_SORT]
  density.value = 'comfortable'
  filterPreset.value = 'all'
  filterQuery.value = ''
  colFilters.value = {}
  filtersOpen.value = false
  filterColKey.value = null
  selectedGuids.value = new Set()
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
  void router.replace({ query: {} })
}

// Active & visible columns computation (pinned placed first)
const visibleOrderedCols = computed(() => order.value.filter(k => !hidden.value.has(k)))
const pinnedCols = computed(() => visibleOrderedCols.value.filter(k => pinned.value.includes(k)))
const unpinnedCols = computed(() => visibleOrderedCols.value.filter(k => !pinned.value.includes(k)))
const displayCols = computed(() => [...pinnedCols.value, ...unpinnedCols.value])

const pinnedOffsets = computed(() => {
  let acc = 0
  const offsets: Record<string, number> = {}
  for (const k of pinnedCols.value) {
    offsets[k] = acc
    acc += widths.value[k] || 80
  }
  return { offsets, totalPinnedWidth: acc }
})

const togglePin = (key: string) => {
  if (pinned.value.includes(key)) {
    pinned.value = pinned.value.filter(k => k !== key)
  } else {
    pinned.value = [...pinned.value, key]
  }
}

const toggleHideCol = (key: string) => {
  const next = new Set(hidden.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  hidden.value = next
}

const showAllColumns = () => {
  hidden.value = new Set()
}

const hideExtraColumns = () => {
  hidden.value = new Set(DEFAULT_HIDDEN)
}

// Drag & Resize state
const resizing = ref<{ key: string; startX: number; startW: number } | null>(null)
const dragKey = ref<string | null>(null)
const menuKey = ref<string | null>(null)
const colPanelOpen = ref(false)
const colPanelQuery = ref('')
const searchInputEl = ref<HTMLInputElement | null>(null)
const copyToast = ref('')
const shortcutsOpen = ref(false)
const isFullscreen = ref(false)
const selectedGuids = ref<Set<string>>(new Set())
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
let copyToastTimer: number | undefined
let narrowMql: MediaQueryList | null = null

const onNarrowChange = (e: MediaQueryListEvent) => { isNarrow.value = e.matches }
const colIsPinned = (key: string) => !isNarrow.value && pinned.value.includes(key)

const groupedPanelColumns = computed(() => {
  const q = colPanelQuery.value.trim().toLowerCase()
  return COLUMN_GROUPS.map(group => ({
    ...group,
    cols: ALL_COLUMNS.filter(c => c.group === group.id && (!q || c.label.toLowerCase().includes(q) || c.key.includes(q))),
  })).filter(g => g.cols.length > 0)
})

const openFilters = (key: string | null = null) => {
  if (key) {
    const col = getCol(key)
    if (!col || col.filter === 'none') return
    filterColKey.value = key
    filtersOpen.value = true
    return
  }
  if (filtersOpen.value && !filterColKey.value) {
    closeFilters()
    return
  }
  filterColKey.value = null
  filtersOpen.value = true
}

const closeFilters = () => {
  filtersOpen.value = false
  filterColKey.value = null
}

const setColFilter = (key: string, value: string) => {
  const next = { ...colFilters.value }
  if (value.trim()) next[key] = value
  else delete next[key]
  colFilters.value = next
}

const clearColFilter = (key: string) => {
  const next = { ...colFilters.value }
  delete next[key]
  colFilters.value = next
}

const onHeaderClick = (key: string, e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (target?.closest('.lb-th-actions, .lb-resize-handle')) return
  if (e.altKey) {
    openFilters(key)
    return
  }
  toggleSort(key, e.shiftKey)
}

const startResize = (key: string, e: MouseEvent) => {
  resizing.value = {
    key,
    startX: e.clientX,
    startW: widths.value[key] || ALL_COLUMNS.find(c => c.key === key)?.w || 80
  }
  document.body.style.cursor = 'col-resize'
  e.preventDefault()
}

const onMouseMove = (e: MouseEvent) => {
  if (resizing.value) {
    const dx = e.clientX - resizing.value.startX
    const newW = Math.max(40, resizing.value.startW + dx)
    widths.value = { ...widths.value, [resizing.value.key]: newW }
  }
}

const onMouseUp = () => {
  if (resizing.value) {
    resizing.value = null
    document.body.style.cursor = ''
  }
}

const onDragStart = (key: string, e: DragEvent) => {
  dragKey.value = key
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }
}

const onDrop = (targetKey: string) => {
  const from = dragKey.value
  dragKey.value = null
  if (!from || from === targetKey) return

  const newOrder = [...order.value]
  const fromIdx = newOrder.indexOf(from)
  if (fromIdx < 0) return
  newOrder.splice(fromIdx, 1)
  const targetIdx = newOrder.indexOf(targetKey)
  newOrder.splice(targetIdx, 0, from)
  order.value = newOrder
}

const onDocClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (!target?.closest('[data-lbmenu="panel"]')) {
    colPanelOpen.value = false
  }
  if (!target?.closest('[data-lbmenu="m"]')) {
    menuKey.value = null
  }
}

const flashCopy = (label: string) => {
  copyToast.value = label
  if (copyToastTimer) window.clearTimeout(copyToastTimer)
  copyToastTimer = window.setTimeout(() => { copyToast.value = '' }, 1800)
}

const copyText = async (text: string, label: string) => {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      flashCopy(label)
      return
    }
  } catch { /* fallback */ }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  document.body.removeChild(area)
  flashCopy(label)
}

const exportCsv = () => {
  const csv = rowsToCsv(sortedServers.value, displayCols.value)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `bfstats_servers_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const copyJson = () => {
  void copyText(JSON.stringify(sortedServers.value, null, 2), 'JSON copied')
}

const copyVisibleTsv = (rows: ServerSummary[]) => {
  void copyText(rowsToTsv(rows, displayCols.value), `${rows.length} row${rows.length === 1 ? '' : 's'} copied`)
}

const copyShareLink = () => {
  void copyText(window.location.href, 'Link copied')
}

const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
      isFullscreen.value = true
    } else {
      await document.exitFullscreen()
      isFullscreen.value = false
    }
  } catch {
    isFullscreen.value = !isFullscreen.value
  }
}

const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement
}

const isTypingTarget = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

const applyUrlState = () => {
  const q = route.query
  if (typeof q.q === 'string') filterQuery.value = q.q
  if (q.preset === 'populated' || q.preset === 'standby' || q.preset === 'all') {
    filterPreset.value = q.preset
  }
  const nextFilters: Record<string, string> = {}
  for (const [key, value] of Object.entries(q)) {
    if (!key.startsWith('f.') || typeof value !== 'string' || !value) continue
    const colKey = key.slice(2)
    if (ALL_COLUMNS.some(c => c.key === colKey)) nextFilters[colKey] = value
  }
  if (Object.keys(nextFilters).length > 0) {
    colFilters.value = nextFilters
  }
  if (typeof q.sort === 'string' && q.sort) {
    const parsed = q.sort.split(',').flatMap(part => {
      const [key, dir] = part.split(':')
      if (!key || (dir !== 'asc' && dir !== 'desc')) return []
      if (!ALL_COLUMNS.some(c => c.key === key)) return []
      return [{ key, dir: dir as 'asc' | 'desc' }]
    })
    if (parsed.length) sort.value = parsed
  }
}

let urlSyncTimer: number | undefined
const syncUrl = () => {
  const query: Record<string, string> = {}
  if (filterQuery.value.trim()) query.q = filterQuery.value.trim()
  if (filterPreset.value !== 'all') query.preset = filterPreset.value
  for (const [key, value] of Object.entries(colFilters.value)) {
    if (value.trim()) query[`f.${key}`] = value.trim()
  }
  if (sort.value.length && !(sort.value.length === 1 && sort.value[0].key === 'players' && sort.value[0].dir === 'desc')) {
    query.sort = sort.value.map(s => `${s.key}:${s.dir}`).join(',')
  }
  const current = route.query as Record<string, string | string[] | undefined>
  const same = Object.keys({ ...current, ...query }).every(k => (current[k] ?? '') === (query[k] ?? ''))
  if (same && Object.keys(current).length === Object.keys(query).length) return
  void router.replace({ query })
}

watch([filterQuery, filterPreset, colFilters, sort], () => {
  if (urlSyncTimer) window.clearTimeout(urlSyncTimer)
  urlSyncTimer = window.setTimeout(syncUrl, 280)
}, { deep: true })

// ============================================================================
// Row Expansion (Inline Ladder) State
// ============================================================================
const expandedGuids = ref<Set<string>>(new Set())

const toggleRowExpand = (guid: string) => {
  const next = new Set(expandedGuids.value)
  if (next.has(guid)) {
    next.delete(guid)
  } else {
    next.add(guid)
  }
  expandedGuids.value = next
}

// ============================================================================
// Data Loading & Live Sync
// ============================================================================
const game = ref<GameKey>('bf1942')
const servers = ref<ServerSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
let refreshTimer: number | undefined
let tickTimer: number | undefined

const REFRESH_INTERVAL_MS = 30_000
const nextRefreshAt = ref(Date.now() + REFRESH_INTERVAL_MS)
const now = ref(Date.now())
const lastUpdated = ref<string | null>(null)
const STALE_THRESHOLD_MS = 90_000

const dataAgeMs = computed(() => {
  if (!lastUpdated.value) return Infinity
  const fetchedAt = parseUtc(lastUpdated.value).getTime()
  if (Number.isNaN(fetchedAt)) return Infinity
  return Math.max(0, now.value - fetchedAt)
})
const isDataStale = computed(() => dataAgeMs.value >= STALE_THRESHOLD_MS)
const staleSince = computed(() => (lastUpdated.value ? formatRelativeTime(lastUpdated.value) : ''))
const hasRevalidated = ref(false)

const trendOpen = ref(false)

const openTrend = () => { trendOpen.value = true }
const closeTrend = () => { trendOpen.value = false }

const pickerServers = computed(() =>
  servers.value.map(s => ({
    guid: s.guid,
    name: s.name,
    country: s.country,
    numPlayers: s.numPlayers || 0,
  })),
)

const applyServerList = (data: ServerSummary[]) => {
  servers.value = [...data]
}

const cached = peekCachedLiveServers()
if (cached && cached.servers.length > 0) {
  applyServerList(cached.servers)
  lastUpdated.value = cached.lastUpdated
  loading.value = false
}

const load = async (showSpinner = false) => {
  if (showSpinner && servers.value.length === 0) loading.value = true
  error.value = null
  try {
    const result = await fetchAllServers(game.value)
    if (result.servers && result.servers.length > 0) {
      applyServerList(result.servers)
    } else if (servers.value.length === 0) {
      servers.value = []
    }
    lastUpdated.value = result.lastUpdated
  } catch {
    error.value = 'Server feed temporarily unavailable.'
  } finally {
    loading.value = false
    hasRevalidated.value = true
    nextRefreshAt.value = Date.now() + REFRESH_INTERVAL_MS
  }
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (trendOpen.value) { closeTrend(); return }
    if (filtersOpen.value) { closeFilters(); return }
    if (shortcutsOpen.value) { shortcutsOpen.value = false; return }
    if (colPanelOpen.value) { colPanelOpen.value = false; return }
    if (menuKey.value) { menuKey.value = null; return }
    if (filterQuery.value) { filterQuery.value = ''; return }
    if (selectedGuids.value.size) { selectedGuids.value = new Set(); return }
    if (expandedGuids.value.size) { expandedGuids.value = new Set() }
    return
  }
  if (isTypingTarget(e.target)) return
  if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    searchInputEl.value?.focus()
    searchInputEl.value?.select()
    return
  }
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    shortcutsOpen.value = !shortcutsOpen.value
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedGuids.value.size > 0) {
    e.preventDefault()
    const rows = sortedServers.value.filter(s => selectedGuids.value.has(s.guid))
    copyVisibleTsv(rows)
  }
}

watch([trendOpen, filtersOpen], () => {
  document.body.style.overflow = (trendOpen.value || filtersOpen.value) ? 'hidden' : ''
  document.documentElement.classList.toggle('mm-fs-lock', trendOpen.value)
})

onMounted(() => {
  applyUrlState()
  void load(servers.value.length === 0)
  refreshTimer = window.setInterval(() => void load(false), REFRESH_INTERVAL_MS)
  tickTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousedown', onDocClick)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  narrowMql = window.matchMedia('(max-width: 720px)')
  isNarrow.value = narrowMql.matches
  narrowMql.addEventListener('change', onNarrowChange)
})

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  if (tickTimer) window.clearInterval(tickTimer)
  if (urlSyncTimer) window.clearTimeout(urlSyncTimer)
  if (copyToastTimer) window.clearTimeout(copyToastTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  narrowMql?.removeEventListener('change', onNarrowChange)
  document.body.style.overflow = ''
  document.documentElement.classList.remove('mm-fs-lock')
})

const refreshProgress = computed(() => {
  const remaining = Math.max(0, nextRefreshAt.value - now.value)
  return 1 - Math.min(1, remaining / REFRESH_INTERVAL_MS)
})
const secondsUntilRefresh = computed(() =>
  Math.max(0, Math.ceil((nextRefreshAt.value - now.value) / 1000)),
)
const REFRESH_RING_CIRCUMFERENCE = 2 * Math.PI * 6

const totalPlayers = computed(() =>
  servers.value.reduce((s, srv) => s + (srv.numPlayers || 0), 0),
)

const populatedCount = computed(() =>
  servers.value.filter(s => (s.numPlayers || 0) > 0).length,
)

const standbyCount = computed(() =>
  servers.value.filter(s => (s.numPlayers || 0) === 0).length,
)

const formatNumber = (n: number) => n.toLocaleString()

const navigateToPlayerProfile = (playerName: string) => {
  router.push(`/v4/players/${encodeURIComponent(playerName)}`)
}

const getSortedTeamPlayers = (server: ServerSummary, teamIndex: number) => {
  const players = (server.players ?? []).filter(p => p.team === teamIndex)
  return [...players].sort((a, b) => (b.score || 0) - (a.score || 0))
}

const getTeamLabel = (server: ServerSummary, teamIndex: number) => {
  if (server.teams && server.teams.length > 0) {
    const t = server.teams.find(tm => tm.index === teamIndex)
    if (t?.label) return t.label.toUpperCase()
  }
  return teamIndex === 1 ? 'AXIS' : 'ALLIED'
}

const getTeamTickets = (server: ServerSummary, teamIndex: number) => {
  if (server.teams && server.teams.length > 0) {
    const t = server.teams.find(tm => tm.index === teamIndex)
    if (t?.tickets !== undefined) return t.tickets
  }
  return teamIndex === 1 ? (server.tickets1 ?? 0) : (server.tickets2 ?? 0)
}

const pingClass = (ping: number) => {
  if (ping <= 0) return 'lb-ping--muted'
  if (ping < 60) return 'lb-ping--good'
  if (ping < 120) return 'lb-ping--mid'
  return 'lb-ping--high'
}

const isInitialLoad = computed(() => loading.value && servers.value.length === 0)

const filteredServers = computed(() => {
  let list = servers.value

  if (filterPreset.value === 'populated') {
    list = list.filter(s => (s.numPlayers || 0) > 0)
  } else if (filterPreset.value === 'standby') {
    list = list.filter(s => (s.numPlayers || 0) === 0)
  }

  if (filterQuery.value.trim()) {
    list = list.filter(s => matchesGlobalSearch(s, filterQuery.value))
  }

  const active = Object.entries(colFilters.value).filter(([, v]) => v.trim())
  if (active.length) {
    list = list.filter(s =>
      active.every(([key, query]) => {
        const col = getCol(key)
        return matchColumnFilter(getCellValue(s, key), query, col?.filter ?? 'text')
      }),
    )
  }

  return list
})

const toggleSort = (key: string, multi = false) => {
  const col = getCol(key)
  if (col && col.sortable === false) return

  const existing = sort.value.find(s => s.key === key)
  if (!multi) {
    if (!existing) {
      sort.value = [{ key, dir: 'desc' }]
    } else if (existing.dir === 'desc') {
      sort.value = [{ key, dir: 'asc' }]
    } else {
      sort.value = [{ key, dir: 'desc' }]
    }
  } else {
    if (!existing) {
      sort.value = [...sort.value, { key, dir: 'desc' }]
    } else if (existing.dir === 'desc') {
      existing.dir = 'asc'
    } else {
      sort.value = sort.value.filter(s => s.key !== key)
      if (sort.value.length === 0) {
        sort.value = [{ key, dir: 'desc' }]
      }
    }
  }
}

const sortedServers = computed(() => {
  const list = [...filteredServers.value]
  const sorts = sort.value
  if (sorts.length === 0) return list

  return list.sort((a, b) => {
    for (const s of sorts) {
      const va = getCellValue(a, s.key)
      const vb = getCellValue(b, s.key)

      if (va === null || va === undefined || va === '') {
        if (vb === null || vb === undefined || vb === '') continue
        return 1
      }
      if (vb === null || vb === undefined || vb === '') {
        return -1
      }

      let cmp = 0
      if (typeof va === 'boolean' && typeof vb === 'boolean') {
        cmp = Number(va) - Number(vb)
      } else if (typeof va === 'string' && typeof vb === 'string') {
        cmp = va.localeCompare(vb)
      } else if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb
      } else {
        cmp = String(va).localeCompare(String(vb))
      }

      if (cmp !== 0) {
        return s.dir === 'desc' ? -cmp : cmp
      }
    }
    return 0
  })
})

const MOBILE_FILTER_PILLS = [
  { key: 'map', label: 'Map' },
  { key: 'players', label: 'Players' },
  { key: 'region', label: 'Country' },
] as const

const pillSummary = (key: string) => formatColFilterValue(key, colFilters.value[key] || '') || 'All'

const clearAllColFilters = () => {
  colFilters.value = {}
}

const onRowClick = (s: ServerSummary, idx: number, e: MouseEvent) => {
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(selectedGuids.value)
    if (next.has(s.guid)) next.delete(s.guid)
    else next.add(s.guid)
    selectedGuids.value = next
    return
  }
  if (e.shiftKey && selectedGuids.value.size > 0) {
    const guids = sortedServers.value.map(row => row.guid)
    const selectedIdx = guids.reduce<number[]>((acc, g, i) => {
      if (selectedGuids.value.has(g)) acc.push(i)
      return acc
    }, [])
    const from = selectedIdx.length ? selectedIdx[selectedIdx.length - 1] : idx
    const start = Math.min(from, idx)
    const end = Math.max(from, idx)
    selectedGuids.value = new Set(guids.slice(start, end + 1))
    return
  }
  toggleRowExpand(s.guid)
}

const selectedRows = computed(() =>
  sortedServers.value.filter(s => selectedGuids.value.has(s.guid)),
)

const sortSummary = computed(() => {
  if (sort.value.length === 0) return 'DEFAULT'
  return sort.value
    .map(s => `${getCol(s.key)?.label || s.key} ${s.dir.toUpperCase()}`)
    .join(', ')
})

const activeFilterChips = computed(() => {
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (filterQuery.value.trim()) {
    chips.push({
      key: 'search',
      label: `SEARCH: "${filterQuery.value.trim()}"`,
      clear: () => { filterQuery.value = '' },
    })
  }
  if (filterPreset.value === 'populated') {
    chips.push({
      key: 'populated',
      label: 'POPULATED ONLY',
      clear: () => { filterPreset.value = 'all' },
    })
  } else if (filterPreset.value === 'standby') {
    chips.push({
      key: 'standby',
      label: 'STANDBY ONLY',
      clear: () => { filterPreset.value = 'all' },
    })
  }
  for (const [key, value] of Object.entries(colFilters.value)) {
    if (!value.trim()) continue
    chips.push({
      key: `col:${key}`,
      label: formatColFilterLabel(key, value),
      clear: () => clearColFilter(key),
    })
  }
  return chips
})

const hasActiveColFilter = (key: string) => Boolean(colFilters.value[key]?.trim())
</script>

<template>
  <div class="mm lb-container" :class="{ 'lb-container--fullscreen': isFullscreen }">
    <!-- meta top row -->
    <div class="mm-landing__top">
      <div class="mm-meta-row">
        <span class="mm-meta-row__strong">
          <span v-if="isInitialLoad" class="mm-skeleton" style="width: 24px; height: 1em; display: inline-block; vertical-align: middle"></span>
          <template v-else>{{ formatNumber(totalPlayers) }}</template>
        </span> in combat
        <span class="mm-landing__meta-extra">
          <span class="mm-meta-row__sep">·</span>
          <span class="mm-meta-row__strong">
            <span v-if="isInitialLoad" class="mm-skeleton" style="width: 24px; height: 1em; display: inline-block; vertical-align: middle"></span>
            <template v-else>{{ formatNumber(servers.length) }}</template>
          </span> tracked
        </span>
        <span class="mm-meta-row__sep">·</span>
        <button
          type="button"
          class="mm-trend-launch"
          data-testid="open-population-trend"
          @click="openTrend"
        >
          View trend →
        </button>
        <span class="mm-meta-row__sep">·</span>
        <span
          class="mm-refresh-ring"
          :title="`Next refresh in ${secondsUntilRefresh}s`"
          :aria-label="`Next refresh in ${secondsUntilRefresh} seconds`"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--mm-rule)" stroke-width="1.5" />
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="var(--mm-accent)"
              stroke-width="1.5"
              stroke-linecap="round"
              :stroke-dasharray="REFRESH_RING_CIRCUMFERENCE"
              :stroke-dashoffset="REFRESH_RING_CIRCUMFERENCE * (1 - refreshProgress)"
              transform="rotate(-90 8 8)"
            />
          </svg>
          <span class="mm-refresh-ring__label">{{ secondsUntilRefresh }}s</span>
        </span>
      </div>
      <MmInstallationLinks />
    </div>

    <!-- Stale data banner -->
    <div v-if="hasRevalidated && isDataStale && !loading && servers.length > 0" class="mm-landing__stale-banner" role="status">
      <svg class="mm-landing__stale-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
      <span class="mm-landing__stale-text">
        Live server data is temporarily unavailable — showing data from <strong>{{ staleSince }}</strong>.
      </span>
      <router-link to="/v4/servers/search" class="mm-landing__stale-link">
        Search all tracked servers →
      </router-link>
    </div>

    <!-- Toolbar & Slicers -->
    <div class="lb-filter-wrapper">
      <div class="lb-filter-card">
        <div class="lb-toolbar">
          <!-- Search input -->
          <label class="lb-search-wrap">
            <i class="pi pi-search lb-search-icon" aria-hidden="true"></i>
            <input
              ref="searchInputEl"
              v-model="filterQuery"
              type="text"
              class="lb-search-input"
              placeholder="Search servers, maps, players, IP…  (/ to focus)"
              aria-label="Filter servers"
            />
            <button
              v-if="filterQuery"
              type="button"
              class="lb-search-clear"
              title="Clear search"
              aria-label="Clear search"
              @click="filterQuery = ''"
            >×</button>
          </label>

          <!-- Preset Filter -->
          <div class="lb-control-group">
            <span class="lb-slicer-label">Filter</span>
            <select v-model="filterPreset" class="lb-select">
              <option value="all">All Servers ({{ servers.length }})</option>
              <option value="populated">Populated Only ({{ populatedCount }})</option>
              <option value="standby">Standby Only ({{ standbyCount }})</option>
            </select>
          </div>

          <button
            type="button"
            class="lb-btn lb-desktop-only"
            :class="{ 'lb-btn--active': filtersOpen || Object.values(colFilters).some(v => v.trim()) }"
            data-testid="landing-filters-open"
            title="Column filters"
            @click="openFilters()"
          >
            <i class="pi pi-sliders-h"></i>
            <span>FILTERS{{ Object.values(colFilters).some(v => v.trim()) ? ` (${Object.values(colFilters).filter(v => v.trim()).length})` : '' }}</span>
          </button>

          <div class="lb-spacer"></div>

          <!-- Density Toggle -->
          <button
            class="lb-btn lb-desktop-only"
            :class="{ 'lb-btn--active': density === 'compact' }"
            title="Toggle compact table density"
            @click="density = density === 'compact' ? 'comfortable' : 'compact'"
          >
            <i :class="density === 'compact' ? 'pi pi-bars' : 'pi pi-align-justify'"></i>
            <span>{{ density === 'compact' ? 'COMPACT' : 'COMFORTABLE' }}</span>
          </button>

          <!-- Columns Popover Trigger -->
          <div class="lb-menu-anchor lb-desktop-only" data-lbmenu="panel">
            <button
              class="lb-btn"
              :class="{ 'lb-btn--active': colPanelOpen }"
              @click="colPanelOpen = !colPanelOpen"
            >
              <i class="pi pi-table"></i>
              <span>COLUMNS ({{ ALL_COLUMNS.length - hidden.size }}/{{ ALL_COLUMNS.length }})</span>
            </button>

            <div v-if="colPanelOpen" class="lb-col-popover" data-lbmenu="panel">
              <div class="lb-popover-title">SHOW / HIDE COLUMNS</div>
              <input
                v-model="colPanelQuery"
                type="text"
                class="lb-col-search"
                placeholder="Find a column…"
                aria-label="Find a column"
              />
              <div class="lb-col-scroll">
                <div v-for="group in groupedPanelColumns" :key="group.id" class="lb-col-group">
                  <div class="lb-col-group__label">{{ group.label }}</div>
                  <label
                    v-for="col in group.cols"
                    :key="col.key"
                    class="lb-col-check"
                  >
                    <input
                      type="checkbox"
                      :checked="!hidden.has(col.key)"
                      @change="toggleHideCol(col.key)"
                    />
                    <span>{{ col.label }}</span>
                  </label>
                </div>
              </div>
              <div class="lb-col-actions">
                <button type="button" class="lb-btn lb-btn--muted" @click="showAllColumns">Show all</button>
                <button type="button" class="lb-btn lb-btn--muted" @click="hideExtraColumns">Defaults</button>
              </div>
            </div>
          </div>

          <button
            class="lb-btn lb-desktop-only"
            title="Download visible rows as CSV"
            @click="exportCsv"
          >
            <i class="pi pi-download"></i>
            <span>CSV</span>
          </button>
          <button
            class="lb-btn lb-desktop-only"
            :title="copyToast || 'Copy filtered rows as JSON'"
            @click="copyJson"
          >
            <i class="pi pi-copy"></i>
            <span>{{ copyToast || 'JSON' }}</span>
          </button>
          <button
            class="lb-btn lb-desktop-only"
            title="Copy a shareable link with the current filters"
            @click="copyShareLink"
          >
            <i class="pi pi-share-alt"></i>
            <span>SHARE</span>
          </button>
          <button
            class="lb-btn lb-desktop-only"
            :class="{ 'lb-btn--active': isFullscreen }"
            title="Toggle fullscreen"
            @click="toggleFullscreen"
          >
            <i :class="isFullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"></i>
          </button>
          <button
            class="lb-btn lb-desktop-only"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            @click="shortcutsOpen = !shortcutsOpen"
          >
            <i class="pi pi-question-circle"></i>
          </button>

          <!-- Reset -->
          <button
            class="lb-btn lb-btn--muted"
            title="Reset all filters, sorting, and layout"
            @click="resetAll"
          >
            <i class="pi pi-refresh"></i>
            <span>RESET</span>
          </button>
        </div>

        <!-- Active filter chips -->
        <div v-if="activeFilterChips.length" class="lb-active-filters">
          <button
            v-for="chip in activeFilterChips"
            :key="chip.key"
            type="button"
            class="lb-empty-chip"
            :aria-label="`Clear ${chip.label} filter`"
            @click="chip.clear()"
          >
            <span>{{ chip.label }}</span>
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>
        <div v-if="selectedGuids.size" class="lb-active-filters">
          <button type="button" class="lb-empty-chip" @click="copyVisibleTsv(selectedRows)">
            <span>{{ selectedGuids.size }} SELECTED · COPY TSV</span>
          </button>
          <button type="button" class="lb-empty-chip" @click="selectedGuids = new Set()">
            <span>CLEAR SELECTION</span>
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>

    <div class="lbm-filter-strip lbm-scroll lb-mobile-only">
      <button
        v-for="pill in MOBILE_FILTER_PILLS"
        :key="pill.key"
        type="button"
        class="lbm-filter-pill"
        :class="{ 'lbm-filter-pill--active': hasActiveColFilter(pill.key) }"
        :data-testid="`landing-filter-pill-${pill.key}`"
        @click="openFilters(pill.key)"
      >
        <span class="lbm-pill-label">{{ pill.label }}</span> {{ pillSummary(pill.key) }}
      </button>
      <button
        type="button"
        class="lbm-filter-pill lbm-filter-pill--round"
        :class="{ 'lbm-filter-pill--active': Object.values(colFilters).some(v => v.trim()) }"
        data-testid="landing-filters-pill"
        @click="openFilters()"
      >
        <i class="pi pi-sliders-h"></i> Filters
      </button>
    </div>

    <LandingColumnFilterPanel
      :open="filtersOpen"
      :column-key="filterColKey"
      :servers="servers"
      :filters="colFilters"
      :is-narrow="isNarrow"
      @close="closeFilters"
      @update:column-key="filterColKey = $event"
      @set-filter="setColFilter"
      @clear-filter="clearColFilter"
      @clear-all="clearAllColFilters"
    />

    <div class="lbm-summary-bar" data-testid="landing-summary">
      <span class="lbm-summary-count">
        <span class="mm-meta-row__strong">{{ formatNumber(totalPlayers) }}</span> in combat
        <span class="mm-meta-row__sep">·</span>
        showing {{ sortedServers.length }} of {{ servers.length }} tracked
        <span v-if="filterPreset === 'populated'" class="lbm-summary-tag"> · populated</span>
        <span v-else-if="filterPreset === 'standby'" class="lbm-summary-tag"> · standby</span>
        <span v-if="filterQuery" class="lbm-summary-tag"> · search: "{{ filterQuery }}"</span>
      </span>
      <span class="lbm-summary-tag lb-desktop-only">sort · {{ sortSummary }}</span>
    </div>

    <!-- Loading / Error / Empty States -->
    <div v-if="loading && servers.length === 0" style="padding: 48px 0">
      <div v-for="i in 8" :key="i" class="mm-skeleton" style="margin-bottom: 14px; height: 36px;" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="servers.length === 0" class="mm-empty mm-landing__empty">
      <span>No {{ GAME_LABEL }} servers reporting in right now.</span>
      <router-link to="/v4/servers/search" class="mm-landing__stale-link">
        Search all tracked servers →
      </router-link>
    </div>

    <!-- Full-Width Responsive Table with Optimal Breakpoint Framing -->
    <div v-else class="mm-landing__full">
      <div class="mm-landing__list-container">
        <div v-if="sortedServers.length === 0" class="mm-empty" style="padding: 36px 0;">
          No servers match the selected filters.
          <div style="margin-top: 14px;">
            <button class="lb-btn" @click="resetAll">Reset Filters</button>
          </div>
        </div>

        <div v-else class="lb-scroll-pane" data-testid="landing-table-scroll">
          <table class="lb-table" :class="{ 'lb-table--compact': density === 'compact' }">
            <thead>
              <tr>
                <th
                  v-for="key in displayCols"
                  :key="key"
                  :style="{
                    width: `${widths[key] || 80}px`,
                    minWidth: `${widths[key] || 80}px`,
                    maxWidth: `${widths[key] || 80}px`,
                    left: colIsPinned(key) ? `${pinnedOffsets.offsets[key]}px` : undefined,
                    zIndex: colIsPinned(key) ? 6 : 4
                  }"
                  :class="{
                    'lb-th--pinned': colIsPinned(key),
                    'lb-th--pinned-last': colIsPinned(key) && pinnedOffsets.offsets[key] + (widths[key] || 80) >= pinnedOffsets.totalPinnedWidth,
                    'lb-th--right': getCol(key)?.align === 'right',
                    'lb-th--center': getCol(key)?.align === 'center',
                    'lb-th--filtered': hasActiveColFilter(key),
                    'lb-th--filter-focus': filtersOpen && filterColKey === key
                  }"
                  :data-testid="`col-header-${key}`"
                  :draggable="!isNarrow"
                  @dragstart="onDragStart(key, $event)"
                  @dragover.prevent
                  @drop="onDrop(key)"
                  @click="onHeaderClick(key, $event)"
                >
                  <div class="lb-th-inner">
                    <div class="lb-th-label-group">
                      <i v-if="colIsPinned(key)" class="pi pi-lock lb-pin-icon" title="Pinned column"></i>
                      <span class="lb-th-text">{{ getCol(key)?.label }}</span>
                      <span v-if="sort.find(s => s.key === key)" class="lb-sort-arrow">
                        {{ sort.find(s => s.key === key)?.dir === 'desc' ? '↓' : '↑' }}
                        <sup v-if="sort.length > 1" class="lb-sort-idx">
                          {{ sort.findIndex(s => s.key === key) + 1 }}
                        </sup>
                      </span>
                      <i
                        v-if="hasActiveColFilter(key)"
                        class="pi pi-filter lb-filter-dot"
                        title="Column filter active — click to edit"
                        @click.stop="openFilters(key)"
                      ></i>
                    </div>

                    <!-- Header Context Menu Trigger -->
                    <div class="lb-th-actions" data-lbmenu="m">
                      <button
                        class="lb-th-menu-btn"
                        title="Column options"
                        @click.stop="menuKey = menuKey === key ? null : key"
                      >
                        <i class="pi pi-chevron-down"></i>
                      </button>

                      <!-- Context Menu Dropdown -->
                      <div v-if="menuKey === key" class="lb-menu-popover" data-lbmenu="m">
                        <button v-if="getCol(key)?.sortable !== false" class="lb-menu-item" @click.stop="sort = [{ key, dir: 'asc' }]; menuKey = null">
                          <i class="pi pi-sort-amount-up"></i> Sort Ascending
                        </button>
                        <button v-if="getCol(key)?.sortable !== false" class="lb-menu-item" @click.stop="sort = [{ key, dir: 'desc' }]; menuKey = null">
                          <i class="pi pi-sort-amount-down"></i> Sort Descending
                        </button>
                        <button class="lb-menu-item lb-desktop-only" @click.stop="togglePin(key)">
                          <i :class="pinned.includes(key) ? 'pi pi-unlock' : 'pi pi-lock'"></i>
                          {{ pinned.includes(key) ? 'Unpin column' : 'Pin column' }}
                        </button>
                        <button class="lb-menu-item" @click.stop="toggleHideCol(key); menuKey = null">
                          <i class="pi pi-eye-slash"></i> Hide column
                        </button>
                      </div>
                    </div>

                    <!-- Column Resize Handle -->
                    <span
                      class="lb-resize-handle"
                      @mousedown.stop="startResize(key, $event)"
                      @click.stop
                    ></span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(s, idx) in sortedServers" :key="s.guid">
                <tr
                  class="lb-row"
                  :class="{
                    'lb-row--selected': expandedGuids.has(s.guid),
                    'lb-row--picked': selectedGuids.has(s.guid)
                  }"
                  @click="onRowClick(s, idx, $event)"
                >
                  <td
                    v-for="k in displayCols"
                    :key="k"
                    :style="{
                      width: `${widths[k] || 80}px`,
                      minWidth: `${widths[k] || 80}px`,
                      maxWidth: `${widths[k] || 80}px`,
                      left: colIsPinned(k) ? `${pinnedOffsets.offsets[k]}px` : undefined,
                      zIndex: k === 'action' ? (colIsPinned(k) ? 3 : 2) : (colIsPinned(k) ? 2 : 1)
                    }"
                    :class="{
                      'lb-td--pinned': colIsPinned(k),
                      'lb-td--pinned-last': colIsPinned(k) && pinnedOffsets.offsets[k] + (widths[k] || 80) >= pinnedOffsets.totalPinnedWidth,
                      'lb-td--action': k === 'action',
                      'lb-td--right': getCol(k)?.align === 'right',
                      'lb-td--center': getCol(k)?.align === 'center'
                    }"
                  >
                    <!-- Rank Cell -->
                    <template v-if="k === 'rank'">
                      <div class="lb-rank-cell">
                        <i
                          class="pi lb-expand-chevron"
                          :class="expandedGuids.has(s.guid) ? 'pi-chevron-down' : 'pi-chevron-right'"
                          :title="expandedGuids.has(s.guid) ? 'Collapse roster' : 'Expand roster ladder'"
                        ></i>
                        <span class="lb-rank" :class="{ 'lb-rank--podium': idx < 3 && (s.numPlayers || 0) > 0 }">
                          {{ String(idx + 1).padStart(2, '0') }}
                        </span>
                      </div>
                    </template>

                    <!-- Join / Connect Action Cell -->
                    <template v-else-if="k === 'action'">
                      <div class="lb-action-cell" @click.stop>
                        <MmServerConnectAction
                          :ip="s.ip"
                          :port="s.port"
                          :server-name="s.name"
                          compact
                        />
                      </div>
                    </template>

                    <!-- Server Name Cell -->
                    <template v-else-if="k === 'name'">
                      <div class="lb-name-cell">
                        <div class="lb-server-cell">
                          <span v-if="(s.numPlayers || 0) > 0" class="lb-online-dot" title="Populated and active"></span>
                          <span v-else class="lb-standby-dot" title="Standby host"></span>
                          <span v-if="s.password" class="lb-lock" title="Password protected">
                            <i class="pi pi-lock" aria-hidden="true"></i>
                          </span>
                          <RouterLink
                            :to="`/v4/servers/detail/${encodeURIComponent(s.name)}`"
                            class="lb-server-link"
                            :title="`View ${$pn(s.name)} details`"
                            @click.stop
                          >
                            {{ $pn(s.name) }}
                          </RouterLink>
                        </div>
                        <div class="lb-server-subline">
                          <span>{{ s.ip }}:{{ s.port }}</span>
                          <template v-if="s.country"> · <span class="lb-flag" :title="friendlyCountry(s.country)">{{ countryCodeToFlag(s.country) }}</span> {{ friendlyCountry(s.country) }}</template>
                          <template v-if="s.mapName"> · {{ s.mapName }}</template>
                        </div>
                      </div>
                    </template>

                    <!-- Players Count (Interactive ladder toggle) -->
                    <template v-else-if="k === 'players'">
                      <div class="lb-players-cell">
                        <span class="lb-players-val" :class="loadClass(s.maxPlayers ? s.numPlayers / s.maxPlayers : 0)">{{ s.numPlayers }}</span>
                        <span class="lb-players-max"> / {{ s.maxPlayers }}</span>
                        <span v-if="(s.numPlayers || 0) > 0" class="lb-players-ladder-hint" title="Click to view live team ladder">
                          <i class="pi pi-users" style="font-size: 11px; margin-left: 5px; opacity: 0.85;"></i>
                        </span>
                      </div>
                    </template>

                    <!-- Load Bar & % -->
                    <template v-else-if="k === 'load'">
                      <div class="lb-load-wrap">
                        <span class="lb-load-pct">{{ s.maxPlayers ? Math.round((s.numPlayers / s.maxPlayers) * 100) : 0 }}%</span>
                        <div class="mm-list__bar" :title="`${s.maxPlayers ? Math.round((s.numPlayers / s.maxPlayers) * 100) : 0}%`">
                          <div
                            class="mm-list__bar-fill"
                            :class="{
                              'mm-list__bar-fill--accent': s.maxPlayers && s.numPlayers / s.maxPlayers >= 0.66,
                              'mm-list__bar-fill--idle': !s.numPlayers,
                            }"
                            :style="{ width: (s.maxPlayers ? Math.min(100, (s.numPlayers / s.maxPlayers) * 100) : 0) + '%' }"
                          />
                        </div>
                      </div>
                    </template>

                    <!-- Map -->
                    <template v-else-if="k === 'map'">
                      <span class="lb-text-cell">{{ s.mapName || '—' }}</span>
                    </template>

                    <!-- Game Mode -->
                    <template v-else-if="k === 'gameType'">
                      <span class="is-muted lb-text-cell">{{ s.gameType || 'Conquest' }}</span>
                    </template>

                    <!-- Region / Country -->
                    <template v-else-if="k === 'region'">
                      <div class="lb-region-cell">
                        <span v-if="s.country" class="lb-flag" :title="friendlyCountry(s.country)">{{ countryCodeToFlag(s.country) }}</span>
                        <span>{{ friendlyCountry(s.country) }}</span>
                      </div>
                    </template>

                    <!-- Average Ping -->
                    <template v-else-if="k === 'ping'">
                      <template v-if="getAveragePing(s) !== null">
                        <span class="lb-ping-val" :class="pingClass(getAveragePing(s) || 0)">
                          {{ getAveragePing(s) }}
                        </span>
                        <span class="lb-ping-unit">ms</span>
                      </template>
                      <span v-else class="lb-muted">—</span>
                    </template>

                    <!-- Round Time Left -->
                    <template v-else-if="k === 'timeRemain'">
                      <span style="font-family: var(--mm-font-mono);">
                        {{ s.roundTimeRemain !== undefined && s.roundTimeRemain !== -1 ? formatTimeRemaining(s.roundTimeRemain) : '—' }}
                      </span>
                    </template>

                    <!-- Tickets -->
                    <template v-else-if="k === 'tickets'">
                      <template v-if="s.tickets1 !== undefined && s.tickets2 !== undefined && (s.tickets1 > 0 || s.tickets2 > 0)">
                        <span class="lb-ticket lb-ticket--t1">{{ s.tickets1 }}</span>
                        <span class="lb-ticket-sep">:</span>
                        <span class="lb-ticket lb-ticket--t2">{{ s.tickets2 }}</span>
                      </template>
                      <span v-else class="lb-muted">—</span>
                    </template>

                    <template v-else-if="k === 'ip'">
                      <button
                        type="button"
                        class="lb-copy-cell"
                        title="Copy address"
                        @click.stop="copyText(`${s.ip}:${s.port}`, 'Address copied')"
                      >{{ s.ip }}:{{ s.port }}</button>
                    </template>

                    <template v-else-if="getCol(k)?.kind === 'bool'">
                      <span class="lb-bool" :class="getCellValue(s, k) ? 'lb-bool--yes' : 'lb-bool--no'">
                        {{ getCellValue(s, k) ? 'Yes' : '—' }}
                      </span>
                    </template>

                    <template v-else-if="getCol(k)?.kind === 'link'">
                      <a
                        v-if="getCellValue(s, k)"
                        :href="String(getCellValue(s, k))"
                        class="lb-cell-link"
                        target="_blank"
                        rel="noopener noreferrer"
                        @click.stop
                      >{{ linkHostname(String(getCellValue(s, k))) }}</a>
                      <span v-else class="lb-muted">—</span>
                    </template>

                    <template v-else-if="getCol(k)?.kind === 'duration'">
                      <span class="lb-mono">{{ getDisplayValue(s, k) || '—' }}</span>
                    </template>

                    <template v-else>
                      <span
                        class="lb-text-cell"
                        :class="{ 'lb-mono': getCol(k)?.kind === 'num' || k === 'guid' || k === 'loc' || k === 'lastSeen' }"
                        :title="k === 'lastSeen' && s.lastSeenTime ? formatLocalTooltip(s.lastSeenTime) : getDisplayValue(s, k)"
                      >{{ getDisplayValue(s, k) || '—' }}</span>
                    </template>
                  </td>
                </tr>

                <!-- In-Game Scoreboard Aesthetic: Authentic AXIS vs ALLIED Scoreboard -->
                <tr v-if="expandedGuids.has(s.guid)" class="lb-expand-row">
                  <td :colspan="displayCols.length" class="lb-expand-td">
                    <div class="lb-roster-scroll" data-testid="landing-roster-scroll">
                      <div class="lb-inline-roster">
                      <div v-if="s.players && s.players.length > 0" class="lb-roster-teams">
                        <div
                          v-for="teamIdx in [1, 2]"
                          :key="teamIdx"
                          class="lb-roster-team-card"
                          :class="teamIdx === 1 ? 'lb-roster-team--axis' : 'lb-roster-team--allies'"
                          :data-testid="teamIdx === 1 ? 'roster-team-axis' : 'roster-team-allies'"
                        >
                          <!-- Team Header: Clean Faction Title & Direct Tickets Number -->
                          <div class="lb-team-strip">
                            <span class="lb-team-name" :style="{ color: teamColor(getTeamLabel(s, teamIdx)) }">
                              {{ getTeamLabel(s, teamIdx) }}
                            </span>
                            <div class="lb-team-tickets-plain" :style="{ color: teamColor(getTeamLabel(s, teamIdx)) }">
                              {{ getTeamTickets(s, teamIdx) }}
                            </div>
                          </div>

                          <!-- In-Game Styled Player Scoreboard Ladder -->
                          <div class="lb-player-list">
                            <div class="lb-player-list-head">
                              <span class="lb-pcol-name">PLAYERNAME</span>
                              <span class="lb-pcol-score">SCORE</span>
                              <span class="lb-pcol-kd">K</span>
                              <span class="lb-pcol-kd">D</span>
                              <span class="lb-pcol-ping">PING</span>
                            </div>

                            <div
                              v-for="player in getSortedTeamPlayers(s, teamIdx)"
                              :key="player.name"
                              class="lb-player-item"
                              :class="{
                                'lb-player-item--axis': teamIdx === 1,
                                'lb-player-item--allies': teamIdx === 2
                              }"
                              @click.stop="navigateToPlayerProfile(player.name)"
                            >
                              <!-- Player Name with Authentic Color Tint -->
                              <div class="lb-pcol-name">
                                <RouterLink
                                  :to="`/v4/players/${encodeURIComponent(player.name)}`"
                                  class="lb-player-link"
                                  :class="teamIdx === 1 ? 'lb-player-link--axis' : 'lb-player-link--allies'"
                                  :title="`View ${$pn(player.name)} profile`"
                                  @click.stop
                                >
                                  {{ $pn(player.name) }}
                                </RouterLink>
                              </div>

                              <!-- Score (Trophy Column) -->
                              <span class="lb-pcol-score">
                                <span class="lb-score-val">{{ formatNumber(player.score) }}</span>
                              </span>

                              <!-- Kills -->
                              <span class="lb-pcol-kd">
                                <span class="lb-num--kill">{{ player.kills }}</span>
                              </span>

                              <!-- Deaths -->
                              <span class="lb-pcol-kd">
                                <span class="lb-num--death">{{ player.deaths }}</span>
                              </span>

                              <!-- Ping -->
                              <span class="lb-pcol-ping">
                                <span class="lb-ping-badge" :class="pingClass(player.ping)">
                                  {{ player.ping > 0 ? `${player.ping}ms` : '—' }}
                                </span>
                              </span>
                            </div>

                            <div v-if="getTeamPlayerCount(s, teamIdx) === 0" class="lb-player-empty">
                              <span>No soldiers currently deployed on this side.</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div v-else class="lb-roster-empty">
                        <i class="pi pi-info-circle" style="font-size: 18px; color: var(--mm-accent);"></i>
                        <span>No active combatants currently on this server. Be the first to join!</span>
                      </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="copyToast" class="lb-toast" role="status">{{ copyToast }}</div>

    <div
      v-if="shortcutsOpen"
      class="lb-shortcuts"
      role="dialog"
      aria-label="Keyboard shortcuts"
      @click.self="shortcutsOpen = false"
    >
      <div class="lb-shortcuts__panel">
        <div class="lb-shortcuts__title">Keyboard</div>
        <dl class="lb-shortcuts__list">
          <div><dt>/</dt><dd>Focus search</dd></div>
          <div><dt>Click header</dt><dd>Sort</dd></div>
          <div><dt>Alt + click header</dt><dd>Open that column’s filter</dd></div>
          <div><dt>Shift + click header</dt><dd>Add a sort level</dd></div>
          <div><dt>Ctrl/⌘ + click row</dt><dd>Select row</dd></div>
          <div><dt>Shift + click row</dt><dd>Select range</dd></div>
          <div><dt>Ctrl/⌘ + C</dt><dd>Copy selected rows as TSV</dd></div>
          <div><dt>?</dt><dd>Toggle this help</dd></div>
          <div><dt>Esc</dt><dd>Clear filter / close / collapse</dd></div>
        </dl>
      </div>
    </div>
  </div>

  <!-- Population Trend Teleport Drawer -->
  <Teleport to="body">
    <Transition name="mm-pop-drawer">
      <div
        v-if="trendOpen"
        class="mm mm-pop-drawer"
        data-testid="population-trend-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Network player trend"
      >
        <div class="mm-pop-drawer__back" @click="closeTrend" />
        <aside class="mm-pop-drawer__panel">
          <div class="mm-pop-drawer__head">
            <div>
              <span class="mm-eyebrow">Network trend</span>
              <div class="mm-pop-drawer__title">Players online</div>
            </div>
            <button type="button" class="mm-pop-drawer__close" aria-label="Close" @click="closeTrend">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <MmPopulationTrendPanel
            show-picker
            :servers="pickerServers"
            game="bf1942"
          />
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lb-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-width: 0;
  background: var(--mm-bg);
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  width: 100%;
  max-width: 1920px;
  margin: 0 auto;
  padding: 22px 32px 48px;
  box-sizing: border-box;
}

@media (max-width: 1024px) {
  .lb-container {
    padding: 16px 20px 36px;
  }
}

@media (max-width: 640px) {
  .lb-container {
    padding: 12px 12px 24px;
  }
}

.mm-landing__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 16px;
}

.mm-landing__meta-extra { display: contents; }

@media (max-width: 720px) {
  .mm-landing__meta-extra { display: none; }
}

/* Staleness banner */
.mm-landing__stale-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-bottom: 16px;
  padding: 11px 16px;
  border: 1px solid var(--mm-danger);
  border-radius: 2px;
  background: color-mix(in srgb, var(--mm-danger) 14%, var(--mm-bg-mute));
}

.mm-landing__stale-icon {
  flex: 0 0 auto;
  color: var(--mm-danger);
}

.mm-landing__stale-text {
  flex: 1 1 240px;
  font-size: 13px;
  color: var(--mm-ink-soft);
}

.mm-landing__stale-text strong {
  color: var(--mm-ink);
  font-weight: 600;
}

.mm-landing__stale-link {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mm-ink);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s ease;
}

.mm-landing__stale-link:hover {
  color: var(--mm-accent);
}

.mm-landing__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

/* Toolbar & Filters */
.lb-filter-wrapper {
  width: 100%;
  box-sizing: border-box;
}

.lb-filter-card {
  border: 1px solid var(--mm-rule);
  border-radius: 3px;
  background: var(--mm-bg-soft);
}

.lb-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding: 12px 16px;
}

.lb-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 240px;
  max-width: 420px;
}

.lb-search-icon {
  position: absolute;
  left: 10px;
  font-size: 12px;
  color: var(--mm-ink-muted);
  pointer-events: none;
}

.lb-search-input {
  width: 100%;
  font-family: var(--mm-font-display);
  font-size: 13px;
  padding: 6px 28px 6px 30px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  outline: none;
  transition: border-color 0.12s ease;
}

.lb-search-input:focus {
  border-color: var(--mm-accent);
}

.lb-search-clear {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: var(--mm-ink-muted);
  cursor: pointer;
  padding: 0 4px;
  font-size: 15px;
  line-height: 1;
}

.lb-search-clear:hover {
  color: var(--mm-ink);
}

.lb-control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lb-slicer-label {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.lb-select {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  letter-spacing: 0.05em;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 6px 10px;
  cursor: pointer;
  outline: none;
}

.lb-select:focus {
  border-color: var(--mm-accent);
}

.lb-spacer {
  flex: 1;
  min-width: 8px;
}

.lb-btn {
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  cursor: pointer;
  transition: all 0.12s ease;
}

.lb-btn:hover {
  border-color: var(--mm-accent-soft);
  color: var(--mm-ink);
}

.lb-btn--active {
  border-color: var(--mm-accent);
  background: var(--mm-bg);
  color: var(--mm-ink);
}

.lb-btn--muted {
  color: var(--mm-ink-muted);
}

.lb-menu-anchor {
  position: relative;
}

.lb-col-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 3px;
  padding: 14px;
  width: 260px;
  box-shadow: 0 10px 32px rgba(0,0,0,0.65);
}

.lb-col-search {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  padding: 6px 8px;
  margin-bottom: 10px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  outline: none;
}

.lb-col-search:focus {
  border-color: var(--mm-accent);
}

.lb-col-scroll {
  max-height: min(60vh, 420px);
  overflow-y: auto;
  padding-right: 4px;
}

.lb-col-group + .lb-col-group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--mm-rule);
}

.lb-col-group__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  margin-bottom: 4px;
}

.lb-col-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.lb-col-actions .lb-btn {
  flex: 1;
  justify-content: center;
}

.lb-popover-title {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--mm-ink-muted);
  margin-bottom: 10px;
}

.lb-col-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
  font-size: 13.5px;
  color: var(--mm-ink-soft);
}

.lb-col-check:hover {
  color: var(--mm-ink);
}

.lb-active-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 12px;
}

.lb-empty-chip {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: 2px;
  border: 1px solid var(--mm-accent);
  background: color-mix(in srgb, var(--mm-accent) 15%, var(--mm-bg));
  color: var(--mm-ink);
  cursor: pointer;
}

.lb-empty-chip:hover {
  background: color-mix(in srgb, var(--mm-accent) 25%, var(--mm-bg));
}

.lb-mobile-only {
  display: none;
}

.lbm-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.lbm-scroll::-webkit-scrollbar {
  display: none;
}

.lbm-filter-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 0 2px;
  -webkit-overflow-scrolling: touch;
}

.lbm-filter-pill {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 8px 11px;
  min-height: 40px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  background: transparent;
  color: var(--mm-ink);
  cursor: pointer;
  white-space: nowrap;
}

.lbm-filter-pill:hover {
  border-color: var(--mm-accent-soft);
}

.lbm-filter-pill--active {
  border-color: var(--mm-accent);
  color: var(--mm-ink);
}

.lbm-filter-pill--round {
  border-radius: 999px;
  color: var(--mm-ink-muted);
}

.lbm-pill-label {
  color: var(--mm-ink-muted);
}

.lbm-summary-bar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 16px 0 8px;
  padding: 0;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.lbm-summary-count {
  min-width: 0;
  flex: 1 1 auto;
  color: var(--mm-ink-muted);
}

.lbm-summary-tag {
  color: var(--mm-ink-faint);
}

/* Table */
.mm-landing__full {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.mm-landing__list-container {
  min-width: 0;
  max-width: 100%;
}

.lb-scroll-pane {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  min-width: 0;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg);
}

.lb-scroll-pane::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}

.lb-scroll-pane::-webkit-scrollbar-thumb {
  background: var(--mm-rule-strong);
  border-radius: 2px;
}

.lb-scroll-pane::-webkit-scrollbar-track {
  background: var(--mm-bg);
}

.lb-table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  table-layout: fixed;
}

/* TH */
th {
  position: sticky;
  top: 0;
  height: 42px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  padding: 0;
  user-select: none;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  font-weight: 700;
  text-transform: uppercase;
  border-right: 1px solid rgba(0,0,0,0.12);
  box-sizing: border-box;
}

.lb-th--pinned {
  position: sticky;
  background: var(--mm-highlight);
}

.lb-th--pinned-last {
  border-right: 2px solid var(--mm-bg) !important;
}

.lb-th--right {
  text-align: right;
}

.lb-th--filtered {
  box-shadow: inset 0 -2px 0 var(--mm-highlight-ink);
}

.lb-container--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: var(--mm-bg);
  overflow: auto;
  max-width: none;
  padding-bottom: 32px;
}

.lb-th--filter-focus .lb-th-inner {
  outline: 1px solid color-mix(in srgb, var(--mm-highlight-ink) 35%, transparent);
  outline-offset: -2px;
}

.lb-filter-dot {
  font-size: 9px;
  opacity: 0.85;
}

.lb-th--center {
  text-align: center;
}

.lb-th-inner {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 12px;
  cursor: pointer;
}

.lb-th--right .lb-th-inner {
  justify-content: flex-end;
}

.lb-th--center .lb-th-inner {
  justify-content: center;
}

.lb-th-label-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.lb-pin-icon {
  font-size: 9px;
  opacity: 0.7;
}

.lb-th-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lb-sort-arrow {
  margin-left: 4px;
  color: var(--mm-highlight-ink);
}

.lb-sort-idx {
  font-size: 9px;
  margin-left: 1px;
}

.lb-th-actions {
  position: relative;
}

.lb-th-menu-btn {
  background: transparent;
  border: none;
  color: var(--mm-highlight-ink);
  opacity: 0.65;
  cursor: pointer;
  padding: 3px;
  font-size: 10px;
  line-height: 1;
}

.lb-th-menu-btn:hover {
  opacity: 1;
}

.lb-menu-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 60;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 3px;
  padding: 5px;
  min-width: 170px;
  box-shadow: 0 10px 32px rgba(0,0,0,0.65);
  font-family: var(--mm-font-display);
}

.lb-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--mm-ink);
  font-size: 12.5px;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 2px;
}

.lb-menu-item:hover {
  background: var(--mm-bg-mute);
  color: var(--mm-accent-soft);
}

.lb-resize-handle {
  position: absolute;
  right: -3px;
  top: 0;
  height: 100%;
  width: 8px;
  cursor: col-resize;
  z-index: 7;
}

/* TD */
td {
  padding: 10px 14px;
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: 1px solid var(--mm-rule);
  background: var(--mm-bg);
  box-sizing: border-box;
}

.lb-table--compact td {
  padding: 7px 10px;
  font-size: 12.5px;
}

.lb-td--action {
  overflow: visible !important;
  position: relative;
  padding-left: 6px !important;
  padding-right: 6px !important;
}

.lb-row:hover .lb-td--action,
.lb-row:focus-within .lb-td--action,
.lb-row:has(.is-open) td,
.lb-row:has(.is-open) .lb-td--action,
.lb-row:has(.is-active) td,
.lb-row:has(.is-active) .lb-td--action {
  z-index: 50 !important;
}

.lb-td--pinned {
  position: sticky;
  background: var(--mm-bg);
}

.lb-td--pinned-last {
  border-right: 2px solid var(--mm-rule-strong) !important;
}

.lb-td--right {
  text-align: right;
}

.lb-td--center {
  text-align: center;
}

/* Rows */
.lb-row {
  cursor: pointer;
  transition: background 0.1s ease;
}

.lb-row:hover td {
  background: var(--mm-bg-soft);
}

.lb-row--selected td {
  background: var(--mm-bg-mute) !important;
}

.lb-row--selected .lb-server-link {
  color: var(--mm-accent);
}

/* Cell Elements */
.lb-rank-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
}

.lb-expand-chevron {
  font-size: 10px;
  color: var(--mm-ink-muted);
  transition: transform 0.15s ease;
}

.lb-action-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: visible;
}

.lb-rank {
  font-weight: 400;
  color: var(--mm-ink-muted);
  font-size: 13.5px;
}

.lb-rank--podium {
  font-weight: 700;
  color: var(--mm-accent);
}

.lb-name-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.lb-server-cell {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mm-font-display);
  min-width: 0;
}

.lb-server-link {
  color: var(--mm-ink);
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: none;
}

.lb-server-link:hover {
  color: var(--mm-accent);
}

.lb-server-subline {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-online-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mm-success);
  box-shadow: 0 0 7px var(--mm-success);
  flex-shrink: 0;
}

.lb-standby-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mm-ink-faint);
  flex-shrink: 0;
}

.lb-players-cell {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}

.lb-players-val {
  font-size: 15px;
  font-weight: 600;
}

.lb-players-max {
  color: var(--mm-ink-faint);
  font-size: 14px;
}

.lb-load-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.lb-load-pct {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  color: var(--mm-ink-muted);
  min-width: 36px;
  text-align: right;
}

.lb-text-cell {
  font-family: var(--mm-font-display);
  font-size: 14px;
}

.lb-region-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mm-font-display);
  font-size: 14px;
}

.lb-flag {
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  font-size: 1.1em;
  vertical-align: -0.05em;
}

.lb-ping-val {
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-weight: 600;
}

.lb-ping-unit {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  margin-left: 2px;
}

.lb-ping--good {
  color: var(--mm-success);
}

.lb-ping--mid {
  color: var(--mm-accent-soft);
}

.lb-ping--high {
  color: var(--mm-danger);
}

.lb-ping--muted {
  color: var(--mm-ink-muted);
}

.lb-ticket-sep {
  color: var(--mm-ink-muted);
  margin: 0 4px;
}

.lb-ticket {
  font-weight: 700;
}

.lb-ticket--t1 {
  color: var(--mm-success);
}

.lb-ticket--t2 {
  color: var(--mm-danger);
}

.lb-lock {
  color: var(--mm-ink-muted);
  font-size: 10px;
  flex-shrink: 0;
}

.lb-bool--yes {
  color: var(--mm-success);
  font-weight: 600;
}

.lb-bool--no {
  color: var(--mm-ink-faint);
}

.lb-cell-link {
  color: var(--mm-accent-soft);
  text-decoration: none;
}

.lb-cell-link:hover {
  color: var(--mm-accent);
  text-decoration: underline;
}

.lb-copy-cell {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 0;
}

.lb-copy-cell:hover {
  color: var(--mm-accent);
}

.lb-mono {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
}

.lb-row--picked td {
  background: color-mix(in srgb, var(--mm-accent) 18%, var(--mm-bg)) !important;
}

.lb-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 90;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 10px 14px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-accent);
  color: var(--mm-ink);
}

.lb-shortcuts {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--mm-bg) 55%, transparent);
}

.lb-shortcuts__panel {
  width: min(92vw, 420px);
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  padding: 20px 22px;
}

.lb-shortcuts__title {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  margin-bottom: 14px;
}

.lb-shortcuts__list {
  margin: 0;
  display: grid;
  gap: 8px;
}

.lb-shortcuts__list > div {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 12px;
  align-items: baseline;
}

.lb-shortcuts__list dt {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-accent-soft);
}

.lb-shortcuts__list dd {
  margin: 0;
  font-size: 13px;
  color: var(--mm-ink-soft);
}

@media (max-width: 720px) {
  .lb-desktop-only {
    display: none !important;
  }

  .lbm-filter-strip.lb-mobile-only {
    display: flex;
  }

  .lb-scroll-pane {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x pan-y;
    overscroll-behavior-x: contain;
    min-width: 0;
    margin-left: -20px;
    margin-right: -20px;
    width: calc(100% + 40px);
    max-width: none;
    border-left: none;
    border-right: none;
    container-type: inline-size;
    container-name: lb-pane;
  }

  .lb-table {
    width: max-content;
    min-width: 100%;
    table-layout: auto;
  }

  .lb-table th,
  .lb-table td,
  .lb-th--pinned,
  .lb-td--pinned {
    position: static !important;
    left: auto !important;
  }

  .lb-resize-handle {
    display: none;
  }
}

@media (max-width: 640px) {
  .lb-scroll-pane {
    margin-left: -12px;
    margin-right: -12px;
    width: calc(100% + 24px);
  }
}

.lb-muted {
  color: var(--mm-ink-faint);
}

/* ============================================================================
   Authentic Battlefield 1942 In-Game Inspired Scoreboard (AXIS vs ALLIED)
   ============================================================================ */
.lb-expand-row td,
.lb-expand-td {
  padding: 0 !important;
  overflow: visible !important;
  white-space: normal;
  background: color-mix(in srgb, var(--mm-bg-soft) 85%, var(--mm-bg)) !important;
  border-bottom: 2px solid var(--mm-rule-strong);
}

.lb-roster-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  min-width: 0;
}

.lb-roster-scroll::-webkit-scrollbar {
  height: 8px;
}

.lb-roster-scroll::-webkit-scrollbar-thumb {
  background: var(--mm-rule-strong);
  border-radius: 2px;
}

.lb-roster-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.lb-inline-roster {
  padding: 18px 24px 24px;
  box-sizing: border-box;
  min-width: 100%;
  width: max-content;
}

.lb-roster-teams {
  display: grid;
  grid-template-columns: repeat(2, minmax(320px, 1fr));
  gap: 24px;
  min-width: 100%;
}

@media (max-width: 860px) {
  .lb-inline-roster {
    padding: 14px 14px 20px;
  }
  .lb-roster-teams {
    gap: 16px;
  }
}

@media (max-width: 720px) {
  .lb-roster-scroll {
    position: sticky;
    left: 0;
    width: 100vw;
    width: 100cqw;
    max-width: 100vw;
    max-width: 100cqw;
    touch-action: pan-x pan-y;
  }
}

.lb-roster-team-card {
  display: flex;
  flex-direction: column;
  min-width: 320px;
  border-radius: 4px;
  background: var(--mm-bg);
  overflow: clip;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  border: 1px solid var(--mm-rule);
  transition: border-color 0.15s ease;
}

.lb-roster-team--axis {
  border-color: rgba(214, 90, 90, 0.5);
}

.lb-roster-team--axis:hover {
  border-color: rgba(214, 90, 90, 0.75);
}

.lb-roster-team--allies {
  border-color: rgba(97, 175, 239, 0.5);
}

.lb-roster-team--allies:hover {
  border-color: rgba(97, 175, 239, 0.75);
}

.lb-team-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  border-bottom: 1px solid var(--mm-rule);
}

.lb-roster-team--axis .lb-team-strip {
  background: linear-gradient(90deg, rgba(214, 90, 90, 0.22) 0%, rgba(214, 90, 90, 0.05) 100%);
}

.lb-roster-team--allies .lb-team-strip {
  background: linear-gradient(90deg, rgba(97, 175, 239, 0.22) 0%, rgba(97, 175, 239, 0.05) 100%);
}

.lb-team-strip-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lb-team-flag {
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  font-size: 1.25em;
  line-height: 1;
}

.lb-team-name {
  font-family: var(--mm-font-display);
  font-size: 15.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.lb-team-badge {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--mm-rule);
  padding: 2px 7px;
  border-radius: 2px;
}

.lb-team-tickets-plain {
  font-family: var(--mm-font-mono);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
  padding-right: 4px;
}

.lb-player-list {
  display: flex;
  flex-direction: column;
}

.lb-player-list-head {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: var(--mm-bg-mute);
  border-bottom: 1px solid var(--mm-rule);
}

.lb-player-item {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--mm-rule) 60%, transparent);
  cursor: pointer;
  transition: all 0.12s ease;
  font-family: var(--mm-font-mono);
  font-size: 13.5px;
}

.lb-player-item:hover {
  background: var(--mm-bg-soft);
}

.lb-player-item:last-child {
  border-bottom: none;
}

/* Player Name Cell with In-Game Color Tints */
.lb-pcol-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.lb-player-link {
  text-decoration: none;
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.12s ease;
}

.lb-player-link--axis {
  color: #e06c75;
}

.lb-player-link--axis:hover {
  color: #ff858d;
  text-decoration: underline;
}

.lb-player-link--allies {
  color: #61afef;
}

.lb-player-link--allies:hover {
  color: #85c5ff;
  text-decoration: underline;
}

/* Stats Columns */
.lb-pcol-score {
  width: 72px;
  flex-shrink: 0;
  text-align: right;
}

.lb-score-val {
  font-weight: 700;
  color: var(--mm-ink);
  font-size: 13.5px;
}

.lb-pcol-kd {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  font-size: 13px;
}

.lb-num--kill {
  color: #ff7b72;
  font-weight: 600;
}

.lb-num--death {
  color: var(--mm-ink-soft);
}

.lb-pcol-ratio {
  width: 64px;
  flex-shrink: 0;
  text-align: right;
}

.lb-kd-pill {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 2px;
}

.lb-kd-pill.mm-kd--elite {
  color: #b4c060;
  font-weight: 700;
  background: rgba(180, 192, 96, 0.16);
  border: 1px solid rgba(180, 192, 96, 0.35);
}

.lb-kd-pill.mm-kd--good {
  color: #7da34c;
  font-weight: 600;
  background: rgba(125, 163, 76, 0.14);
}

.lb-kd-pill.mm-kd--mid {
  color: var(--mm-ink);
}

.lb-kd-pill.mm-kd--low {
  color: #a0a07a;
}

.lb-kd-pill.mm-kd--poor {
  color: #777777;
}

.lb-pcol-ping {
  width: 58px;
  flex-shrink: 0;
  text-align: right;
}

.lb-ping-badge {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 500;
}

.lb-player-empty {
  padding: 20px 16px;
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  font-style: italic;
  text-align: center;
}

.lb-roster-empty {
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  color: var(--mm-ink-soft);
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 3px;
}

/* Flag & Refresh ring */
.mm-landing__flag {
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  font-size: 1.1em;
  margin-right: 4px;
  vertical-align: -0.05em;
}

.mm-refresh-ring {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.04em;
}

.mm-refresh-ring svg {
  display: block;
}

.mm-refresh-ring svg circle:last-child {
  transition: stroke-dashoffset 1s linear;
}

.mm-refresh-ring__label {
  min-width: 24px;
  text-align: left;
}

.mm-trend-launch {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-accent);
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.mm-trend-launch:hover { color: var(--mm-accent-soft); }

.mm-pop-drawer {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  justify-content: flex-end;
  align-items: stretch;
  background: transparent;
}
.mm-pop-drawer__back {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--mm-bg) 42%, transparent);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.mm-pop-drawer__panel {
  position: relative;
  width: min(calc(100vw - 72px), 1280px);
  height: calc(100% - 32px);
  margin: 16px 16px 16px 0;
  background: color-mix(in srgb, var(--mm-bg) 88%, transparent);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--mm-rule-strong);
  padding: 26px 32px 40px;
  overflow-y: auto;
  box-sizing: border-box;
  box-shadow: -20px 0 48px color-mix(in srgb, #000 40%, transparent);
}
.mm-pop-drawer__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.mm-pop-drawer__title {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 28px;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin-top: 4px;
}
.mm-pop-drawer__close {
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink-muted);
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.mm-pop-drawer__close:hover {
  border-color: var(--mm-ink);
  color: var(--mm-ink);
}
@media (max-width: 720px) {
  .mm-pop-drawer {
    z-index: 9999;
    background: var(--mm-bg);
    overscroll-behavior: none;
  }
  .mm-pop-drawer__back {
    display: none;
  }
  .mm-pop-drawer__panel {
    width: 100%;
    height: 100%;
    height: 100dvh;
    margin: 0;
    padding: 18px 16px 32px;
    padding-top: max(18px, env(safe-area-inset-top));
    padding-bottom: max(32px, env(safe-area-inset-bottom));
    border: 0;
    box-shadow: none;
    background: var(--mm-bg);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    overscroll-behavior: contain;
  }
  .mm-pop-drawer__close {
    width: 44px;
    height: 44px;
  }
}

/* Drawer Transitions */
.mm-pop-drawer-enter-active,
.mm-pop-drawer-leave-active {
  transition: opacity 0.22s ease;
}

.mm-pop-drawer-enter-active .mm-pop-drawer__panel,
.mm-pop-drawer-leave-active .mm-pop-drawer__panel {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.mm-pop-drawer-enter-from,
.mm-pop-drawer-leave-to {
  opacity: 0;
}

.mm-pop-drawer-enter-from .mm-pop-drawer__panel,
.mm-pop-drawer-leave-to .mm-pop-drawer__panel {
  transform: translateX(100%);
}

@media (max-width: 720px) {
  .mm-pop-drawer-enter-from .mm-pop-drawer__panel,
  .mm-pop-drawer-leave-to .mm-pop-drawer__panel {
    transform: translateY(100%);
  }
}
</style>
