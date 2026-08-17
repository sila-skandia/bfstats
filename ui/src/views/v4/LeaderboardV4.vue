<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import 'primeicons/primeicons.css'
import { fetchLeaderboard, fetchLeaderboardMaps, type LeaderboardPlayer, type LeaderboardServer, type LeaderboardMap } from '@/services/leaderboardApi'
import { kdClass } from './mmTokens'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'
import { decodeServerName } from '@/utils/playerName'

interface ColumnDef {
  key: string
  label: string
  align: 'left' | 'right' | 'center'
  w: number
  type: 'rank' | 'player' | 'kd' | 'kills' | 'deaths' | 'score' | 'kpm' | 'time' | 'int' | 'date' | 'server' | 'map' | 'status'
  sortable?: boolean
  groupable?: boolean
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '#', align: 'right', w: 66, type: 'rank', sortable: false },
  { key: 'player', label: 'Player', align: 'left', w: 230, type: 'player', sortable: true },
  { key: 'kd', label: 'K/D', align: 'right', w: 92, type: 'kd', sortable: true, groupable: true },
  { key: 'kills', label: 'Kills', align: 'right', w: 96, type: 'kills', sortable: true },
  { key: 'deaths', label: 'Deaths', align: 'right', w: 96, type: 'deaths', sortable: true },
  { key: 'score', label: 'Score', align: 'right', w: 112, type: 'score', sortable: true },
  { key: 'kpm', label: 'Kill rate', align: 'right', w: 104, type: 'kpm', sortable: true },
  { key: 'playMin', label: 'Play time', align: 'right', w: 112, type: 'time', sortable: true },
  { key: 'rounds', label: 'Rounds', align: 'right', w: 96, type: 'int', sortable: true },
  { key: 'lastSeen', label: 'Last seen', align: 'right', w: 112, type: 'date', sortable: false },
  { key: 'favServer', label: 'Fav. server', align: 'left', w: 200, type: 'server', sortable: true, groupable: true },
  { key: 'favMap', label: 'Fav. map', align: 'left', w: 160, type: 'map', sortable: true, groupable: true },
  { key: 'status', label: 'Status', align: 'center', w: 90, type: 'status', sortable: false }
]

const route = useRoute()
const router = useRouter()

// Data state
const rawPlayers = ref<LeaderboardPlayer[]>([])
const servers = ref<LeaderboardServer[]>([])
const maps = ref<LeaderboardMap[]>([])
const loading = ref(true)
const hasLoaded = ref(false)
const isRefreshing = computed(() => loading.value && hasLoaded.value)
let loadSeq = 0
const error = ref<string | null>(null)
const copyToast = ref(false)

// Server-side pagination / sort metadata
const serverTotalPlayers = ref(0)
const serverTotalPages = ref(1)

// Slicer / filter state
const days = ref<number>((() => {
  const raw = Number(route.query.days)
  if (!Number.isFinite(raw) || raw === 30) return 30
  const hasServer = Boolean((route.query.server as string) || '')
  if (!hasServer && (raw === 0 || raw > 365)) return 365
  return raw
})())
const minPlay = ref<number>(Number(route.query.minPlay) || 0)
const minRounds = ref<number>(Number(route.query.minRounds) || 1)
const includedServers = ref<string[]>(
  route.query.server ? (route.query.server as string).split(',').filter(Boolean) : []
)
const serverMode = ref<'include' | 'exclude'>((route.query.serverMode as string) === 'exclude' ? 'exclude' : 'include')
const excludedServers = ref<string[]>(
  route.query.exclude ? (route.query.exclude as string).split(',').filter(Boolean) : []
)
const populatedOnly = ref(
  route.query.populatedOnly !== '0' && route.query.populatedOnly !== 'false'
)
const includedMaps = ref<string[]>(
  route.query.map ? (route.query.map as string).split(',').filter(Boolean) : []
)
const mapDisplayNames = ref<Record<string, string>>({})
const searchQuery = ref<string>((route.query.q as string) || '')
const debouncedSearch = ref(searchQuery.value.trim())
const serverSearchQuery = ref<string>('')
const mapSearchQuery = ref<string>('')
const serverDropdownOpen = ref(false)
const mapDropdownOpen = ref(false)
const periodSheetOpen = ref(false)
const serverSearchInputRef = ref<HTMLInputElement | null>(null)
const mapSearchInputRef = ref<HTMLInputElement | null>(null)
const groupBy = ref<'favServer' | 'favMap' | 'kdBand' | null>((route.query.group as any) || null)
const collapsedGroups = ref<Set<string>>(new Set())

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
let narrowMql: MediaQueryList | null = null
const onNarrowChange = (e: MediaQueryListEvent) => { isNarrow.value = e.matches }

const closeAllSheets = () => {
  serverDropdownOpen.value = false
  mapDropdownOpen.value = false
  periodSheetOpen.value = false
}

const toggleServerDropdown = async () => {
  const next = !serverDropdownOpen.value
  closeAllSheets()
  serverDropdownOpen.value = next
  if (serverDropdownOpen.value && !isNarrow.value) {
    await nextTick()
    serverSearchInputRef.value?.focus()
  }
}

const mapsList = ref<string[]>([])
const loadingMaps = ref(false)
let mapLoadSeq = 0

const formatMapTitle = (name: string) => {
  if (!name) return ''
  return name.split(/[\s_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

const loadMaps = async (query = '') => {
  const seq = ++mapLoadSeq
  loadingMaps.value = true
  try {
    const res = await fetchLeaderboardMaps(query, 50)
    if (seq === mapLoadSeq) {
      mapsList.value = res
    }
  } finally {
    if (seq === mapLoadSeq) {
      loadingMaps.value = false
    }
  }
}

let mapSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(mapSearchQuery, (q) => {
  if (mapSearchDebounceTimer) clearTimeout(mapSearchDebounceTimer)
  const trimmed = q.trim()
  if (!trimmed) {
    void loadMaps('')
    return
  }
  mapSearchDebounceTimer = setTimeout(() => {
    void loadMaps(trimmed)
  }, 300)
})

const toggleMapDropdown = async () => {
  const next = !mapDropdownOpen.value
  closeAllSheets()
  mapDropdownOpen.value = next
  if (mapDropdownOpen.value) {
    if (mapsList.value.length === 0) {
      await loadMaps(mapSearchQuery.value)
    }
    if (!isNarrow.value) {
      await nextTick()
      mapSearchInputRef.value?.focus()
    }
  }
}

const togglePeriodSheet = () => {
  const next = !periodSheetOpen.value
  closeAllSheets()
  periodSheetOpen.value = next
}

const periodOptions = computed(() => {
  const opts = [
    { value: 30, label: '30 Days' },
    { value: 90, label: '90 Days' },
    { value: 180, label: '6 Months' },
    { value: 365, label: '1 Year' },
  ]
  if (includedServers.value.length > 0 && serverMode.value === 'include') {
    opts.push({ value: 0, label: 'All Time' })
  }
  return opts
})

const periodLabel = computed(() =>
  periodOptions.value.find(o => o.value === days.value)?.label ?? (days.value === 0 ? 'All Time' : `${days.value} Days`)
)

const selectedServerObj = computed(() => {
  if (includedServers.value.length !== 1) return null
  const srvLower = includedServers.value[0].toLowerCase()
  return servers.value.find(s => s.name.toLowerCase() === srvLower || s.guid.toLowerCase() === srvLower)
})

const filteredServers = computed(() => {
  const q = serverSearchQuery.value.trim().toLowerCase()
  const list = !q
    ? servers.value
    : servers.value.filter(s =>
        s.name.toLowerCase().includes(q) ||
        decodeServerName(s.name).toLowerCase().includes(q) ||
        (s.shortName && s.shortName.toLowerCase().includes(q)) ||
        (s.country && s.country.toLowerCase().includes(q))
      )
  const rank = (s: LeaderboardServer) => {
    if (serverMode.value === 'exclude') return isServerExcluded(s.name) ? 0 : 1
    return isServerIncluded(s.name) || isServerIncluded(s.guid) ? 0 : 1
  }
  return [...list].sort((a, b) => rank(a) - rank(b))
})

// Exclude mode helpers
const isServerIncluded = (srvName: string) =>
  includedServers.value.some(e => e.toLowerCase() === srvName.toLowerCase())

const toggleIncludeServer = (srvName: string) => {
  const lower = srvName.toLowerCase()
  if (includedServers.value.some(e => e.toLowerCase() === lower)) {
    includedServers.value = includedServers.value.filter(e => e.toLowerCase() !== lower)
  } else {
    includedServers.value = [...includedServers.value, srvName]
  }
}

const clearIncludedServers = () => {
  includedServers.value = []
}

const isServerExcluded = (srvName: string) =>
  excludedServers.value.some(e => e.toLowerCase() === srvName.toLowerCase())

const toggleExcludeServer = (srvName: string) => {
  const lower = srvName.toLowerCase()
  if (excludedServers.value.some(e => e.toLowerCase() === lower)) {
    excludedServers.value = excludedServers.value.filter(e => e.toLowerCase() !== lower)
  } else {
    excludedServers.value = [...excludedServers.value, srvName]
  }
}

const clearExcludedServers = () => {
  excludedServers.value = []
}

const serverChipLabel = (name: string) => {
  const srv = servers.value.find(s =>
    s.name.toLowerCase() === name.toLowerCase() || s.guid.toLowerCase() === name.toLowerCase()
  )
  return decodeServerName(srv?.shortName || srv?.name || name)
}

const switchServerMode = (mode: 'include' | 'exclude') => {
  serverMode.value = mode
  if (mode === 'exclude') {
    includedServers.value = []
  } else {
    excludedServers.value = []
  }
}

const selectedMapObj = computed(() => {
  if (includedMaps.value.length !== 1) return null
  const mLower = includedMaps.value[0].toLowerCase()
  return mapsForPicker.value.find(m => m.name.toLowerCase() === mLower) ?? null
})

const mapsForPicker = computed(() => {
  const list = mapsList.value.map(name => ({
    name,
    displayName: formatMapTitle(name)
  }))
  const missing = includedMaps.value.filter(
    sel => !list.some(m => m.name.toLowerCase() === sel.toLowerCase())
  )
  if (missing.length === 0) return list
  return [
    ...missing.map(name => ({
      name,
      displayName: mapDisplayNames.value[name] || formatMapTitle(name)
    })),
    ...list
  ]
})

const isMapIncluded = (mapName: string) =>
  includedMaps.value.some(m => m.toLowerCase() === mapName.toLowerCase())

const toggleIncludeMap = (mapName: string, displayName?: string) => {
  const lower = mapName.toLowerCase()
  if (includedMaps.value.some(m => m.toLowerCase() === lower)) {
    includedMaps.value = includedMaps.value.filter(m => m.toLowerCase() !== lower)
  } else {
    includedMaps.value = [...includedMaps.value, mapName]
    if (displayName) {
      mapDisplayNames.value = { ...mapDisplayNames.value, [mapName]: displayName }
    }
  }
}

const clearIncludedMaps = () => {
  includedMaps.value = []
}

const filteredMaps = computed(() => {
  const q = mapSearchQuery.value.trim().toLowerCase()
  const list = !q
    ? mapsForPicker.value
    : mapsForPicker.value.filter(m =>
        m.displayName.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q)
      )
  return [...list].sort((a, b) => Number(isMapIncluded(b.name)) - Number(isMapIncluded(a.name)))
})

const mapChipLabel = (name: string) => {
  const found = mapsForPicker.value.find(m => m.name.toLowerCase() === name.toLowerCase())
  return found?.displayName || mapDisplayNames.value[name] || name
}

// Table configuration state
const order = ref<string[]>(ALL_COLUMNS.map(c => c.key))
const hidden = ref<Set<string>>(new Set(['status', 'lastSeen']))
const pinned = ref<string[]>(['rank', 'player'])
const widths = ref<Record<string, number>>(ALL_COLUMNS.reduce((acc, c) => { acc[c.key] = c.w; return acc }, {} as Record<string, number>))
const sort = ref<{ key: string; dir: 'asc' | 'desc' }[]>([{ key: 'score', dir: 'desc' }])
const density = ref<'comfortable' | 'compact'>('comfortable')
const page = ref(1)
const pageSize = ref(25)
const selectedPlayer = ref<string | null>(null)

// UI Popovers / Menus
const menuKey = ref<string | null>(null)
const colPanelOpen = ref(false)

// Drag & Resize state
const resizing = ref<{ key: string; startX: number; startW: number } | null>(null)
const dragKey = ref<string | null>(null)

const loadData = async () => {
  const seq = ++loadSeq
  loading.value = true
  if (!hasLoaded.value) error.value = null
  try {
    const primarySort = sort.value[0]
    const res = await fetchLeaderboard({
      page: page.value,
      pageSize: pageSize.value,
      sortBy: primarySort?.key ?? 'score',
      sortDir: primarySort?.dir ?? 'desc',
      q: debouncedSearch.value || undefined,
      server: serverMode.value === 'include' && includedServers.value.length > 0
        ? includedServers.value.join(',')
        : undefined,
      exclude: serverMode.value === 'exclude' && excludedServers.value.length > 0
        ? excludedServers.value.join(',')
        : undefined,
      populatedOnly: populatedOnly.value,
      map: includedMaps.value.length > 0 ? includedMaps.value.join(',') : undefined,
      days: days.value,
      minRounds: minRounds.value,
      minPlay: minPlay.value,
    })
    if (seq !== loadSeq) return
    rawPlayers.value = res.players || []
    servers.value = res.servers || []
    maps.value = res.maps || []
    serverTotalPlayers.value = res.totalPlayers ?? 0
    serverTotalPages.value = res.totalPages ?? 1
    error.value = null
  } catch {
    if (seq !== loadSeq) return
    if (!hasLoaded.value) error.value = 'Leaderboard data is temporarily unavailable.'
  } finally {
    if (seq !== loadSeq) return
    loading.value = false
    hasLoaded.value = true
  }
}

const onMouseMove = (e: MouseEvent) => {
  if (resizing.value) {
    const dx = e.clientX - resizing.value.startX
    const newW = Math.max(56, resizing.value.startW + dx)
    widths.value = { ...widths.value, [resizing.value.key]: newW }
  }
}

const onMouseUp = () => {
  if (resizing.value) {
    resizing.value = null
    document.body.style.cursor = ''
  }
}

const onDocClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (!target?.closest('[data-lbmenu="panel"]')) {
    colPanelOpen.value = false
  }
  if (!target?.closest('[data-lbmenu="server"]')) {
    serverDropdownOpen.value = false
  }
  if (!target?.closest('[data-lbmenu="map"]')) {
    mapDropdownOpen.value = false
  }
  if (!target?.closest('[data-lbmenu="period"]')) {
    periodSheetOpen.value = false
  }
  if (!target?.closest('[data-lbmenu="m"]')) {
    menuKey.value = null
  }
}

const isFullscreen = ref(false)

const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      }
      isFullscreen.value = true
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen()
      }
      isFullscreen.value = false
    }
  } catch {
    isFullscreen.value = !isFullscreen.value
  }
}

const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeAllSheets()
}

const syncBodyScrollLock = () => {
  const sheetOpen = isNarrow.value && (serverDropdownOpen.value || mapDropdownOpen.value || periodSheetOpen.value)
  document.body.style.overflow = sheetOpen ? 'hidden' : ''
}

onMounted(() => {
  void loadData()
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousedown', onDocClick)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  narrowMql = window.matchMedia('(max-width: 720px)')
  isNarrow.value = narrowMql.matches
  narrowMql.addEventListener('change', onNarrowChange)
})

onUnmounted(() => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  if (mapSearchDebounceTimer) clearTimeout(mapSearchDebounceTimer)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  narrowMql?.removeEventListener('change', onNarrowChange)
  document.body.style.overflow = ''
})

watch(isNarrow, (narrow) => {
  if (!narrow) closeAllSheets()
})

watch([serverDropdownOpen, mapDropdownOpen, periodSheetOpen, isNarrow], () => {
  syncBodyScrollLock()
})

watch([days, minPlay, minRounds, includedMaps, includedServers, excludedServers, serverMode, populatedOnly], () => {
  page.value = 1
})

watch(sort, () => {
  page.value = 1
}, { deep: true })

watch(searchQuery, (q) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    page.value = 1
    debouncedSearch.value = q.trim()
  }, 250)
})

watch(() => maps.value, (list) => {
  if (includedMaps.value.length === 0) return
  const next = { ...mapDisplayNames.value }
  let changed = false
  for (const sel of includedMaps.value) {
    const found = list.find(m => m.name.toLowerCase() === sel.toLowerCase())
    if (found && next[sel] !== found.displayName) {
      next[sel] = found.displayName
      changed = true
    }
  }
  if (changed) mapDisplayNames.value = next
})

watch(includedServers, (list) => {
  if (list.length === 0 && days.value === 0) days.value = 365
})

const requestKey = computed(() => [
  page.value,
  pageSize.value,
  sort.value[0]?.key ?? 'score',
  sort.value[0]?.dir ?? 'desc',
  debouncedSearch.value,
  serverMode.value,
  includedServers.value.join('\0'),
  excludedServers.value.join('\0'),
  populatedOnly.value ? '1' : '0',
  includedMaps.value.join('\0'),
  days.value,
  minRounds.value,
  minPlay.value
].join('|'))

watch(requestKey, () => {
  void loadData()
})

// URL sync
watch([days, minPlay, minRounds, searchQuery, groupBy, includedMaps, includedServers, excludedServers, serverMode, populatedOnly], () => {
  router.replace({
    query: {
      ...route.query,
      days: days.value === 30 ? undefined : String(days.value),
      minPlay: minPlay.value === 0 ? undefined : String(minPlay.value),
      minRounds: minRounds.value === 1 ? undefined : String(minRounds.value),
      server: (serverMode.value === 'include' && includedServers.value.length > 0) ? includedServers.value.join(',') : undefined,
      serverMode: serverMode.value === 'exclude' ? 'exclude' : undefined,
      exclude: (serverMode.value === 'exclude' && excludedServers.value.length > 0) ? excludedServers.value.join(',') : undefined,
      populatedOnly: populatedOnly.value ? undefined : '0',
      map: includedMaps.value.length > 0 ? includedMaps.value.join(',') : undefined,
      q: searchQuery.value.trim() || undefined,
      group: groupBy.value || undefined
    }
  })
})

const getCol = (key: string) => ALL_COLUMNS.find(c => c.key === key)

// Helper formatting functions
const formatInt = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US')
const formatAvg = (n: number | null | undefined) => {
  const v = n ?? 0
  return v > 0 ? v.toFixed(1) : '—'
}
const populatedServerCount = computed(() => servers.value.filter(s => s.isPopulated).length)
const formatTime = (min: number | null | undefined) => {
  const m = min ?? 0
  const hours = Math.floor(m / 60)
  const remainder = m % 60
  if (hours >= 100) return `${formatInt(hours)}h`
  return `${hours}h ${String(remainder).padStart(2, '0')}m`
}

const formatRelativeDate = (isoString?: string) => {
  if (!isoString) return '—'
  const d = parseUtc(isoString)
  if (isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const daysAgo = Math.floor(diffMs / 86_400_000)
  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return '1d ago'
  if (daysAgo < 7) return `${daysAgo}d ago`
  const weeksAgo = Math.round(daysAgo / 7)
  return `${weeksAgo}w ago`
}

const getKdBand = (kd: number) => {
  if (kd < 0.5) return 'POOR (<0.5)'
  if (kd < 1.0) return 'LOW (0.5–1.0)'
  if (kd < 2.0) return 'MID (1.0–2.0)'
  if (kd < 3.0) return 'GOOD (2.0–3.0)'
  return 'ELITE (3.0+)'
}

const getCellValue = (p: LeaderboardPlayer, key: string): any => {
  switch (key) {
    case 'rank': return p.rank ?? 0
    case 'player': return p.name.toLowerCase()
    case 'kd': return p.kd
    case 'kills': return p.kills
    case 'deaths': return p.deaths
    case 'score': return p.score
    case 'kpm': return p.kpm
    case 'playMin': return p.playMin
    case 'rounds': return p.rounds
    case 'lastSeen': return p.lastSeen ? new Date(p.lastSeen).getTime() : 0
    case 'favServer': return p.favServer || ''
    case 'favMap': return p.favMap || ''
    case 'status': return p.isActive ? 1 : 0
    default: return (p as any)[key] ?? ''
  }
}

// Server-side: rawPlayers IS the current page. No client-side filter/sort.
type ProcessedPlayer = LeaderboardPlayer

const processedData = computed<ProcessedPlayer[]>(() => rawPlayers.value)

// Active columns (ordered and filtered by visibility, with pinned placed first)
const visibleOrderedCols = computed(() => order.value.filter(k => !hidden.value.has(k)))
const pinnedCols = computed(() => visibleOrderedCols.value.filter(k => pinned.value.includes(k)))
const unpinnedCols = computed(() => visibleOrderedCols.value.filter(k => !pinned.value.includes(k)))
const displayCols = computed(() => [...pinnedCols.value, ...unpinnedCols.value])

// Pinned column left offsets
const pinnedOffsets = computed(() => {
  let acc = 0
  const offsets: Record<string, number> = {}
  for (const k of pinnedCols.value) {
    offsets[k] = acc
    acc += widths.value[k] || 80
  }
  return { offsets, totalPinnedWidth: acc }
})

// Grouping (operates on current page data for visual grouping)
interface PlayerGroup {
  groupKey: string
  label: string
  players: ProcessedPlayer[]
  avgKd: number
  totalKills: number
}

const groupedRows = computed<PlayerGroup[] | null>(() => {
  if (!groupBy.value) return null
  const groupsMap = new Map<string, ProcessedPlayer[]>()
  for (const p of processedData.value) {
    let key = ''
    if (groupBy.value === 'favServer') key = p.favServer || 'Other'
    else if (groupBy.value === 'favMap') key = p.favMap || 'Other'
    else if (groupBy.value === 'kdBand') key = getKdBand(p.kd)
    if (!groupsMap.has(key)) groupsMap.set(key, [])
    groupsMap.get(key)!.push(p)
  }

  const result: PlayerGroup[] = []
  for (const [key, list] of groupsMap) {
    const avgKd = list.reduce((sum, p) => sum + p.kd, 0) / list.length
    const totalKills = list.reduce((sum, p) => sum + p.kills, 0)
    result.push({ groupKey: key, label: key, players: list, avgKd, totalKills })
  }
  return result
})

// Pagination — driven by server response metadata
const totalItems = computed(() => serverTotalPlayers.value)
const totalPages = computed(() => serverTotalPages.value)
const pagedRows = computed(() => processedData.value)

// Interactions
const toggleSort = (key: string, _shiftKey?: boolean) => {
  const col = getCol(key)
  if (!col || col.sortable === false) return

  // Server-side: single-column sort only (shift-click behaves same as click)
  const cur = sort.value.find(s => s.key === key)
  if (!cur) sort.value = [{ key, dir: 'desc' }]
  else if (cur.dir === 'desc') sort.value = [{ key, dir: 'asc' }]
  else sort.value = [{ key: 'score', dir: 'desc' }]
  page.value = 1
}

const togglePin = (key: string) => {
  if (pinned.value.includes(key)) {
    pinned.value = pinned.value.filter(k => k !== key)
  } else {
    pinned.value = [...pinned.value, key]
  }
  menuKey.value = null
}

const toggleHideCol = (key: string) => {
  const next = new Set(hidden.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hidden.value = next
}

const toggleGroupCollapse = (groupKey: string) => {
  const next = new Set(collapsedGroups.value)
  if (next.has(groupKey)) next.delete(groupKey)
  else next.add(groupKey)
  collapsedGroups.value = next
}

const resetAll = () => {
  includedServers.value = []
  serverMode.value = 'include'
  excludedServers.value = []
  populatedOnly.value = true
  serverSearchQuery.value = ''
  serverDropdownOpen.value = false
  includedMaps.value = []
  mapDisplayNames.value = {}
  mapSearchQuery.value = ''
  mapDropdownOpen.value = false
  periodSheetOpen.value = false
  days.value = 30
  minPlay.value = 0
  minRounds.value = 1
  searchQuery.value = ''
  debouncedSearch.value = ''
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  groupBy.value = null
  sort.value = [{ key: 'score', dir: 'desc' }]
  pinned.value = ['rank', 'player']
  hidden.value = new Set(['status', 'lastSeen'])
  page.value = 1
  selectedPlayer.value = null
}

const clearServerFilter = () => {
  includedServers.value = []
  excludedServers.value = []
  serverMode.value = 'include'
}

const activeFilterChips = computed(() => {
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (includedServers.value.length === 1) {
    chips.push({
      key: 'server',
      label: decodeServerName(selectedServerObj.value?.shortName || includedServers.value[0]),
      clear: clearIncludedServers
    })
  } else if (includedServers.value.length > 1) {
    chips.push({
      key: 'server',
      label: `${includedServers.value.length} servers`,
      clear: clearIncludedServers
    })
  } else if (serverMode.value === 'exclude' && excludedServers.value.length > 0) {
    chips.push({
      key: 'exclude',
      label: `Excl. ${excludedServers.value.length} ${excludedServers.value.length === 1 ? 'server' : 'servers'}`,
      clear: clearExcludedServers
    })
  }
  if (includedMaps.value.length === 1) {
    chips.push({
      key: 'map',
      label: selectedMapObj.value?.displayName || includedMaps.value[0],
      clear: clearIncludedMaps
    })
  } else if (includedMaps.value.length > 1) {
    chips.push({
      key: 'map',
      label: `${includedMaps.value.length} maps`,
      clear: clearIncludedMaps
    })
  }
  if (days.value !== 30) {
    chips.push({
      key: 'period',
      label: periodLabel.value,
      clear: () => { days.value = 30 }
    })
  }
  return chips
})

// Column resize start
const startResize = (key: string, e: MouseEvent) => {
  e.stopPropagation()
  e.preventDefault()
  resizing.value = {
    key,
    startX: e.clientX,
    startW: widths.value[key] || 80
  }
  document.body.style.cursor = 'col-resize'
}

// Column drag and drop
const onDragStart = (key: string, e: any) => {
  dragKey.value = key
  if (e?.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }
}

const onDrop = (targetKey: string) => {
  const from = dragKey.value
  dragKey.value = null
  if (!from || from === targetKey) return

  const newOrder = order.value.filter(k => k !== from)
  const targetIdx = newOrder.indexOf(targetKey)
  newOrder.splice(targetIdx, 0, from)
  order.value = newOrder
}

// Export functions (current page data)
const exportCsv = () => {
  try {
    const headers = displayCols.value.map(k => getCol(k)?.label || k).join(',')
    const lines = rawPlayers.value.map(p =>
      displayCols.value.map(k => {
        const val = getCellValue(p, k)
        if (val === null || val === undefined) return '""'
        const str = String(val).replace(/"/g, '""')
        return `"${str}"`
      }).join(',')
    )
    const csvContent = '\uFEFF' + [headers, ...lines].join('\r\n')
    const blob = new window.Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `bfstats_leaderboard_${days.value === 0 ? 'alltime' : `${days.value}d`}_p${page.value}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Failed to export CSV:', err)
  }
}

const copyJson = async () => {
  try {
    const jsonStr = JSON.stringify(rawPlayers.value, null, 2)
    let copied = false
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(jsonStr)
        copied = true
      } catch {
        // fallback
      }
    }
    if (!copied) {
      try {
        const textArea = document.createElement('textarea')
        textArea.value = jsonStr
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        copied = document.execCommand('copy')
        document.body.removeChild(textArea)
      } catch {
        // fallback
      }
    }

    if (!copied) {
      // Fallback to instant JSON file download
      const blob = new window.Blob([jsonStr], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', `bfstats_leaderboard_${days.value === 0 ? 'alltime' : `${days.value}d`}_p${page.value}.json`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }

    copyToast.value = true
    setTimeout(() => { copyToast.value = false }, 2500)
  } catch (err) {
    console.error('Failed to copy JSON:', err)
  }
}

const sortSummary = computed(() => {
  return sort.value
    .map(s => `${getCol(s.key)?.label || s.key} ${s.dir === 'desc' ? '↓' : '↑'}`)
    .join(', ')
})

const rankTintClass = (rank: number) => {
  if (rank === 1) return 'mm-rank--gold'
  if (rank === 2) return 'mm-rank--silver'
  if (rank === 3) return 'mm-rank--bronze'
  return ''
}
</script>

<template>
  <div class="mm lb-container" :class="{ 'lb-container--fullscreen': isFullscreen }">
    <!-- Header Section -->
    <header class="lb-header">
      <h1 class="mm-display lb-title">Leaderboard</h1>
    </header>

    <!-- Toolbar / Slicers Bar -->
    <div class="lb-filter-wrapper">
      <div class="lb-filter-card">
        <!-- Controls Toolbar -->
        <div class="lb-controls-row">
          <!-- Timeframe Slicer -->
          <div class="lb-control-group" data-lbmenu="period">
            <span class="lb-slicer-label">Period</span>
            <select v-model.number="days" class="lb-select lb-desktop-only">
              <option :value="7">7 Days</option>
              <option :value="30">30 Days</option>
              <option :value="90">90 Days</option>
              <option :value="365">1 Year</option>
              <option v-if="includedServers.length > 0 && serverMode === 'include'" :value="0">All Time</option>
            </select>
            <button
              type="button"
              class="lb-server-dropdown-btn lb-period-dropdown-btn lb-mobile-only"
              :class="{ 'lb-server-dropdown-btn--open': periodSheetOpen }"
              @click="togglePeriodSheet"
            >
              <span class="lb-server-dropdown-text">{{ periodLabel }}</span>
              <i class="pi pi-chevron-down lb-chevron-icon"></i>
            </button>
            <Teleport to="body" :disabled="!isNarrow">
              <div
                v-if="periodSheetOpen"
                class="mm lb-server-popover"
                :class="{ 'lb-server-popover--sheet': isNarrow }"
                data-lbmenu="period"
                :role="isNarrow ? 'dialog' : undefined"
                :aria-modal="isNarrow ? true : undefined"
                aria-label="Period"
              >
                <div class="lb-sheet-head">
                  <div>
                    <div class="mm-eyebrow">FILTER</div>
                    <h2 class="lb-sheet-title">Period</h2>
                  </div>
                  <div class="lb-sheet-actions">
                    <button
                      v-if="days !== 30"
                      type="button"
                      class="lb-sheet-clear"
                      @click="days = 30; periodSheetOpen = false"
                    >Clear</button>
                    <button type="button" class="lb-sheet-done" @click="periodSheetOpen = false">Done</button>
                  </div>
                </div>
                <div class="lb-server-list">
                  <button
                    v-for="opt in periodOptions"
                    :key="opt.value"
                    type="button"
                    class="lb-server-item"
                    :class="{ 'lb-server-item--active': days === opt.value }"
                    @click="days = opt.value; periodSheetOpen = false"
                  >
                    <span class="lb-pick-mark" :class="{ 'is-on': days === opt.value }" aria-hidden="true"></span>
                    <span class="lb-server-item-name">{{ opt.label }}</span>
                    <span v-if="days === opt.value" class="lb-pick-state">ON</span>
                  </button>
                </div>
              </div>
            </Teleport>
          </div>

          <!-- Searchable Server Slicer -->
          <div class="lb-control-group lb-server-select-wrap" data-lbmenu="server">
            <span class="lb-slicer-label">Server</span>
            <div class="lb-server-dropdown-anchor">
              <button
                class="lb-server-dropdown-btn"
                :class="{
                  'lb-server-dropdown-btn--active': includedServers.length > 0 || excludedServers.length > 0,
                  'lb-server-dropdown-btn--exclude': serverMode === 'exclude' && excludedServers.length > 0,
                  'lb-server-dropdown-btn--open': serverDropdownOpen
                }"
                title="Filter by server"
                @click="toggleServerDropdown"
              >
                <!-- Include mode -->
                <template v-if="serverMode === 'include'">
                  <template v-if="selectedServerObj">
                    <span v-if="selectedServerObj.flag" class="lb-flag">{{ selectedServerObj.flag }}</span>
                    <span class="lb-server-dropdown-text">{{ $pn(selectedServerObj.shortName || selectedServerObj.name) }}</span>
                    <span class="lb-server-count">{{ formatAvg(selectedServerObj.avgPlayers) }}</span>
                  </template>
                  <template v-else-if="includedServers.length > 1">
                    <i class="pi pi-server lb-server-icon"></i>
                    <span class="lb-server-dropdown-text">{{ includedServers.length }} servers</span>
                    <span class="lb-server-count">{{ includedServers.length }}</span>
                  </template>
                  <template v-else-if="includedServers.length === 1">
                    <span class="lb-server-dropdown-text">{{ $pn(includedServers[0]) }}</span>
                  </template>
                  <template v-else>
                    <i class="pi pi-server lb-server-icon"></i>
                    <span class="lb-server-dropdown-text">{{ populatedOnly ? 'Populated' : 'All Servers' }}</span>
                    <span v-if="servers.length > 0" class="lb-server-count">{{ populatedOnly ? populatedServerCount : servers.length }}</span>
                  </template>
                </template>
                <!-- Exclude mode -->
                <template v-else>
                  <i class="pi pi-ban lb-server-icon lb-server-icon--exclude"></i>
                  <span class="lb-server-dropdown-text">
                    <template v-if="excludedServers.length === 0">Exclude Servers</template>
                    <template v-else-if="excludedServers.length === 1">Excl. {{ $pn(excludedServers[0]) }}</template>
                    <template v-else>Excl. {{ excludedServers.length }} servers</template>
                  </span>
                  <span v-if="excludedServers.length > 0" class="lb-exclude-badge">{{ excludedServers.length }}</span>
                </template>
                <i class="pi pi-chevron-down lb-chevron-icon"></i>
              </button>

              <!-- Clear button: works for both modes -->
              <button
                v-if="includedServers.length > 0 || excludedServers.length > 0"
                type="button"
                class="lb-server-clear-btn"
                :aria-label="serverMode === 'exclude' ? 'Clear all exclusions' : 'Clear server filter'"
                :title="serverMode === 'exclude' ? 'Clear all exclusions' : 'Clear server filter'"
                @click.stop="serverMode === 'exclude' ? clearExcludedServers() : clearIncludedServers()"
              >
                <span aria-hidden="true">×</span>
              </button>

              <!-- Server Search Popover -->
              <Teleport to="body" :disabled="!isNarrow">
              <div
                v-if="serverDropdownOpen"
                class="mm lb-server-popover"
                :class="{ 'lb-server-popover--sheet': isNarrow }"
                data-lbmenu="server"
                :role="isNarrow ? 'dialog' : undefined"
                :aria-modal="isNarrow ? true : undefined"
                aria-label="Server"
              >
                <div class="lb-sheet-head">
                  <div>
                    <div class="mm-eyebrow">FILTER</div>
                    <h2 class="lb-sheet-title">Server</h2>
                  </div>
                  <div class="lb-sheet-actions">
                    <button
                      v-if="includedServers.length > 0 || excludedServers.length > 0"
                      type="button"
                      class="lb-sheet-clear"
                      @click="clearServerFilter(); serverDropdownOpen = false"
                    >Clear</button>
                    <button type="button" class="lb-sheet-done" @click="serverDropdownOpen = false">Done</button>
                  </div>
                </div>
                <!-- Mode Toggle -->
                <div class="lb-server-mode-toggle">
                  <button
                    class="lb-mode-btn"
                    :class="{ 'lb-mode-btn--active': serverMode === 'include' }"
                    @click="switchServerMode('include')"
                  >
                    <i class="pi pi-check-circle"></i>
                    Include
                  </button>
                  <button
                    class="lb-mode-btn lb-mode-btn--exclude"
                    :class="{ 'lb-mode-btn--active': serverMode === 'exclude' }"
                    @click="switchServerMode('exclude')"
                  >
                    <i class="pi pi-ban"></i>
                    Exclude
                  </button>
                </div>

                <button
                  class="lb-populated-toggle"
                  :class="{ 'lb-populated-toggle--on': populatedOnly }"
                  :aria-pressed="populatedOnly"
                  title="Keep servers with a regular player count; drop empty and bot-heavy boxes"
                  @click="populatedOnly = !populatedOnly"
                >
                  <i :class="populatedOnly ? 'pi pi-users' : 'pi pi-globe'"></i>
                  <span>{{ populatedOnly ? 'Populated servers only' : 'Include empty / bot servers' }}</span>
                  <span v-if="populatedServerCount > 0" class="lb-live-pill">{{ populatedServerCount }} live</span>
                </button>

                <div class="lb-server-search-box">
                  <i class="pi pi-search lb-server-search-icon"></i>
                  <input
                    ref="serverSearchInputRef"
                    v-model="serverSearchQuery"
                    type="text"
                    placeholder="Search server name / country..."
                    class="lb-server-search-input"
                  />
                  <button
                    v-if="serverSearchQuery"
                    class="lb-server-search-clear"
                    title="Clear search"
                    @click="serverSearchQuery = ''"
                  >
                    <i class="pi pi-times"></i>
                  </button>
                </div>

                <div
                  v-if="serverMode === 'include' && includedServers.length > 0"
                  class="lb-picked-strip"
                >
                  <span class="lb-picked-strip-kicker">Selected · {{ includedServers.length }}</span>
                  <div class="lb-picked-strip-chips">
                    <button
                      v-for="name in includedServers"
                      :key="name"
                      type="button"
                      class="lb-picked-chip"
                      :aria-label="`Remove ${serverChipLabel(name)}`"
                      @click="toggleIncludeServer(name)"
                    >
                      {{ serverChipLabel(name) }}
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                </div>
                <div
                  v-else-if="serverMode === 'exclude' && excludedServers.length > 0"
                  class="lb-picked-strip lb-picked-strip--excl"
                >
                  <span class="lb-picked-strip-kicker">Excluded · {{ excludedServers.length }}</span>
                  <div class="lb-picked-strip-chips">
                    <button
                      v-for="name in excludedServers"
                      :key="name"
                      type="button"
                      class="lb-picked-chip lb-picked-chip--excl"
                      :aria-label="`Stop excluding ${serverChipLabel(name)}`"
                      @click="toggleExcludeServer(name)"
                    >
                      {{ serverChipLabel(name) }}
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                </div>

                <div class="lb-server-list">
                  <!-- All Servers Option (include mode only) -->
                  <button
                    v-if="serverMode === 'include'"
                    class="lb-server-item"
                    :class="{ 'lb-server-item--active': includedServers.length === 0 }"
                    :aria-pressed="includedServers.length === 0"
                    @click="clearIncludedServers()"
                  >
                    <span class="lb-pick-mark" :class="{ 'is-on': includedServers.length === 0 }" aria-hidden="true"></span>
                    <i class="pi pi-globe lb-server-item-icon"></i>
                    <span class="lb-server-item-name">All Servers</span>
                    <span class="lb-server-count">{{ servers.length }}</span>
                    <span v-if="includedServers.length === 0" class="lb-pick-state">ON</span>
                  </button>

                  <!-- Clear All Exclusions (exclude mode) -->
                  <button
                    v-if="serverMode === 'exclude' && excludedServers.length > 0"
                    class="lb-server-item lb-server-item--clear-excl"
                    @click="clearExcludedServers()"
                  >
                    <i class="pi pi-times-circle lb-server-item-icon"></i>
                    <span class="lb-server-item-name">Clear all exclusions</span>
                    <span class="lb-exclude-badge">{{ excludedServers.length }}</span>
                  </button>

                  <!-- Include mode: multi-select server list -->
                  <template v-if="serverMode === 'include'">
                    <button
                      v-for="srv in filteredServers"
                      :key="srv.guid"
                      class="lb-server-item"
                      :class="{
                        'lb-server-item--active': isServerIncluded(srv.name) || isServerIncluded(srv.guid),
                        'lb-server-item--quiet': populatedOnly && !srv.isPopulated && !isServerIncluded(srv.name) && !isServerIncluded(srv.guid)
                      }"
                      :aria-pressed="isServerIncluded(srv.name) || isServerIncluded(srv.guid)"
                      @click="toggleIncludeServer(srv.name)"
                    >
                      <span
                        class="lb-pick-mark"
                        :class="{ 'is-on': isServerIncluded(srv.name) || isServerIncluded(srv.guid) }"
                        aria-hidden="true"
                      ></span>
                      <span v-if="srv.flag" class="lb-flag">{{ srv.flag }}</span>
                      <span class="lb-server-item-name">{{ $pn(srv.name) }}</span>
                      <span
                        class="lb-server-avg"
                        :class="{ 'lb-server-avg--live': srv.isPopulated }"
                        :title="`${formatAvg(srv.avgPlayers)} avg concurrent · ${srv.playerCount} ranked`"
                      >{{ formatAvg(srv.avgPlayers) }}</span>
                      <span
                        v-if="isServerIncluded(srv.name) || isServerIncluded(srv.guid)"
                        class="lb-pick-state"
                      >ON</span>
                    </button>
                  </template>

                  <!-- Exclude mode: multi-select server list -->
                  <template v-else>
                    <button
                      v-for="srv in filteredServers"
                      :key="srv.guid"
                      class="lb-server-item"
                      :class="{
                        'lb-server-item--excluded': isServerExcluded(srv.name),
                        'lb-server-item--quiet': populatedOnly && !srv.isPopulated && !isServerExcluded(srv.name)
                      }"
                      :aria-pressed="isServerExcluded(srv.name)"
                      @click="toggleExcludeServer(srv.name)"
                    >
                      <span
                        class="lb-pick-mark lb-pick-mark--excl"
                        :class="{ 'is-on': isServerExcluded(srv.name) }"
                        aria-hidden="true"
                      ></span>
                      <span v-if="srv.flag" class="lb-flag">{{ srv.flag }}</span>
                      <span class="lb-server-item-name">{{ $pn(srv.name) }}</span>
                      <span
                        class="lb-server-avg"
                        :class="{ 'lb-server-avg--live': srv.isPopulated }"
                        :title="`${formatAvg(srv.avgPlayers)} avg concurrent · ${srv.playerCount} ranked`"
                      >{{ formatAvg(srv.avgPlayers) }}</span>
                      <span v-if="isServerExcluded(srv.name)" class="lb-pick-state lb-pick-state--excl">EXCL</span>
                    </button>
                  </template>

                  <div v-if="filteredServers.length === 0" class="lb-server-empty">
                    No servers match "{{ serverSearchQuery }}"
                  </div>
                </div>
              </div>
              </Teleport>
            </div>
          </div>

          <!-- Searchable Map Slicer -->
          <div class="lb-control-group lb-server-select-wrap" data-lbmenu="map">
            <span class="lb-slicer-label">Map</span>
            <div class="lb-server-dropdown-anchor">
              <button
                class="lb-server-dropdown-btn lb-map-dropdown-btn"
                :class="{ 'lb-server-dropdown-btn--active': includedMaps.length > 0, 'lb-server-dropdown-btn--open': mapDropdownOpen }"
                title="Filter by map"
                @click="toggleMapDropdown"
              >
                <template v-if="selectedMapObj">
                  <i class="pi pi-map lb-server-icon"></i>
                  <span class="lb-server-dropdown-text">{{ selectedMapObj.displayName }}</span>
                </template>
                <template v-else-if="includedMaps.length > 1">
                  <i class="pi pi-map lb-server-icon"></i>
                  <span class="lb-server-dropdown-text">{{ includedMaps.length }} maps</span>
                  <span class="lb-server-count">{{ includedMaps.length }}</span>
                </template>
                <template v-else-if="includedMaps.length === 1">
                  <i class="pi pi-map lb-server-icon"></i>
                  <span class="lb-server-dropdown-text">{{ includedMaps[0] }}</span>
                </template>
                <template v-else>
                  <i class="pi pi-globe lb-server-icon"></i>
                  <span class="lb-server-dropdown-text">All Maps</span>
                </template>
                <i class="pi pi-chevron-down lb-chevron-icon"></i>
              </button>

              <button
                v-if="includedMaps.length > 0"
                type="button"
                class="lb-server-clear-btn"
                aria-label="Clear map filter"
                title="Clear map filter"
                @click.stop="clearIncludedMaps()"
              >
                <span aria-hidden="true">×</span>
              </button>

              <!-- Map Search Popover -->
              <Teleport to="body" :disabled="!isNarrow">
              <div
                v-if="mapDropdownOpen"
                class="mm lb-server-popover"
                :class="{ 'lb-server-popover--sheet': isNarrow }"
                data-lbmenu="map"
                :role="isNarrow ? 'dialog' : undefined"
                :aria-modal="isNarrow ? true : undefined"
                aria-label="Map"
              >
                <div class="lb-sheet-head">
                  <div>
                    <div class="mm-eyebrow">FILTER</div>
                    <h2 class="lb-sheet-title">Map</h2>
                  </div>
                  <div class="lb-sheet-actions">
                    <button
                      v-if="includedMaps.length > 0"
                      type="button"
                      class="lb-sheet-clear"
                      @click="clearIncludedMaps(); mapDropdownOpen = false"
                    >Clear</button>
                    <button type="button" class="lb-sheet-done" @click="mapDropdownOpen = false">Done</button>
                  </div>
                </div>
                <div class="lb-server-search-box">
                  <i class="pi pi-search lb-server-search-icon"></i>
                  <input
                    ref="mapSearchInputRef"
                    v-model="mapSearchQuery"
                    type="text"
                    placeholder="Search map name..."
                    class="lb-server-search-input lb-map-search-input"
                  />
                  <button
                    v-if="mapSearchQuery"
                    class="lb-server-search-clear"
                    title="Clear search"
                    @click="mapSearchQuery = ''"
                  >
                    <i class="pi pi-times"></i>
                  </button>
                </div>

                <div v-if="includedMaps.length > 0" class="lb-picked-strip">
                  <span class="lb-picked-strip-kicker">Selected · {{ includedMaps.length }}</span>
                  <div class="lb-picked-strip-chips">
                    <button
                      v-for="name in includedMaps"
                      :key="name"
                      type="button"
                      class="lb-picked-chip"
                      :aria-label="`Remove ${mapChipLabel(name)}`"
                      @click="toggleIncludeMap(name)"
                    >
                      {{ mapChipLabel(name) }}
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                </div>

                <div class="lb-server-list">
                  <!-- All Maps Option -->
                  <button
                    class="lb-server-item"
                    :class="{ 'lb-server-item--active': includedMaps.length === 0 }"
                    :aria-pressed="includedMaps.length === 0"
                    @click="clearIncludedMaps()"
                  >
                    <span class="lb-pick-mark" :class="{ 'is-on': includedMaps.length === 0 }" aria-hidden="true"></span>
                    <i class="pi pi-globe lb-server-item-icon"></i>
                    <span class="lb-server-item-name">All Maps</span>
                    <span v-if="includedMaps.length === 0" class="lb-pick-state">ON</span>
                  </button>

                  <div v-if="loadingMaps" class="lb-server-empty" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="pi pi-spin pi-spinner"></i> Searching...
                  </div>

                  <!-- Filtered Map Options -->
                  <button
                    v-for="m in filteredMaps"
                    :key="m.name"
                    class="lb-server-item"
                    :class="{ 'lb-server-item--active': isMapIncluded(m.name) }"
                    :aria-pressed="isMapIncluded(m.name)"
                    @click="toggleIncludeMap(m.name, m.displayName)"
                  >
                    <span class="lb-pick-mark" :class="{ 'is-on': isMapIncluded(m.name) }" aria-hidden="true"></span>
                    <i class="pi pi-map lb-server-item-icon"></i>
                    <span class="lb-server-item-name">{{ m.displayName }}</span>
                    <span v-if="isMapIncluded(m.name)" class="lb-pick-state">ON</span>
                  </button>

                  <div v-if="!loadingMaps && filteredMaps.length === 0" class="lb-server-empty">
                    No maps match "{{ mapSearchQuery }}"
                  </div>
                </div>
              </div>
              </Teleport>
            </div>
          </div>

          <!-- Min Play Slicer -->
          <div class="lb-control-group lb-desktop-only">
            <span class="lb-slicer-label">Min Play</span>
            <select v-model.number="minPlay" class="lb-select">
              <option :value="0">Any</option>
              <option :value="60">1h+</option>
              <option :value="300">5h+</option>
              <option :value="600">10h+</option>
              <option :value="1500">25h+</option>
              <option :value="3000">50h+</option>
            </select>
          </div>

          <!-- Min Rounds Slicer -->
          <div class="lb-control-group lb-desktop-only">
            <span class="lb-slicer-label">Min Rounds</span>
            <select v-model.number="minRounds" class="lb-select">
              <option :value="1">1+ round</option>
              <option :value="3">3+ rounds</option>
              <option :value="5">5+ rounds</option>
              <option :value="10">10+ rounds</option>
              <option :value="25">25+ rounds</option>
            </select>
          </div>

          <!-- Group By Slicer -->
          <div class="lb-control-group lb-desktop-only">
            <span class="lb-slicer-label">Group By</span>
            <select v-model="groupBy" class="lb-select">
              <option :value="null">None</option>
              <option value="favServer">Fav. Server</option>
              <option value="favMap">Fav. Map</option>
              <option value="kdBand">K/D Band</option>
            </select>
          </div>

          <!-- Client Search -->
          <div class="lb-search-group lb-desktop-only">
            <i class="pi pi-search lb-search-icon"></i>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search player, server, map..."
              class="lb-search-input"
            />
            <button
              v-if="searchQuery"
              class="lb-search-clear"
              title="Clear search"
              @click="searchQuery = ''"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>

          <div class="lb-spacer lb-desktop-only"></div>

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

            <!-- Columns Show / Hide Panel -->
            <div v-if="colPanelOpen" class="lb-col-popover" data-lbmenu="panel">
              <div class="lb-popover-title">SHOW / HIDE COLUMNS</div>
              <label
                v-for="col in ALL_COLUMNS.filter(c => c.key !== 'rank')"
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

          <!-- Export, Fullscreen & Reset Actions -->
          <button class="lb-btn lb-desktop-only" title="Export as CSV" @click="exportCsv">
            <i class="pi pi-download"></i>
            <span>CSV</span>
          </button>

          <button class="lb-btn lb-desktop-only" :title="copyToast ? 'Copied!' : 'Copy raw JSON data'" @click="copyJson">
            <i :class="copyToast ? 'pi pi-check' : 'pi pi-copy'"></i>
            <span>{{ copyToast ? 'COPIED' : 'JSON' }}</span>
          </button>

          <button
            class="lb-btn lb-btn-fullscreen lb-desktop-only"
            :class="{ 'lb-btn--active': isFullscreen }"
            :title="isFullscreen ? 'Exit Fullscreen' : 'Toggle Fullscreen Mode'"
            @click="toggleFullscreen"
          >
            <i :class="isFullscreen ? 'pi pi-compress' : 'pi pi-window-maximize'"></i>
            <span>{{ isFullscreen ? 'EXIT' : 'FULLSCREEN' }}</span>
          </button>

          <button
            class="lb-btn lb-btn--muted"
            :class="{ 'lb-desktop-only': activeFilterChips.length === 0 }"
            title="Reset all slicers and sort"
            @click="resetAll"
          >
            <i class="pi pi-refresh"></i>
            <span>RESET</span>
          </button>
        </div>
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
      </div>
    </div>

    <!-- Olive Section Bar -->
    <div class="lb-section-bar-wrap">
      <div class="lb-section-bar">
        <div v-if="isRefreshing" class="lb-refresh-bar is-on" aria-hidden="true"></div>
        <div class="lb-section-left">
          <span>
            SHOWING {{ totalItems === 0 ? 0 : (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, totalItems) }} OF {{ formatInt(totalItems) }} RANKED PLAYERS
          </span>
          <span v-if="groupBy" class="lb-desktop-only">
            · GROUPED BY {{ groupBy === 'favServer' ? 'FAVOURITE SERVER' : groupBy === 'favMap' ? 'FAVOURITE MAP' : 'K/D BAND' }} (THIS PAGE)
          </span>
          <span v-if="includedServers.length === 1" class="lb-server-active-tag">
            · SRV: {{ $pn((selectedServerObj?.shortName || includedServers[0])).toUpperCase() }}
          </span>
          <span v-else-if="includedServers.length > 1" class="lb-server-active-tag">
            · SRV: {{ includedServers.length }} SERVERS
          </span>
          <span v-else-if="serverMode === 'exclude' && excludedServers.length > 0" class="lb-excluded-tag">
            · EXCL. {{ excludedServers.length }} {{ excludedServers.length === 1 ? 'SERVER' : 'SERVERS' }}
          </span>
          <span v-if="populatedOnly && includedServers.length === 0" class="lb-populated-tag">
            · POPULATED
          </span>
          <span v-if="includedMaps.length === 1" class="lb-map-active-tag">
            · MAP: {{ (selectedMapObj?.displayName || includedMaps[0]).toUpperCase() }}
          </span>
          <span v-else-if="includedMaps.length > 1" class="lb-map-active-tag">
            · MAP: {{ includedMaps.length }} MAPS
          </span>
        </div>
        <div class="lb-section-right lb-desktop-only">
          <span>SORT · {{ sortSummary }}</span>
        </div>
      </div>
    </div>

    <!-- Table Container -->
    <div class="lb-table-container">
      <div v-if="loading && !hasLoaded" class="lb-state-box" role="status" aria-live="polite">
        <i class="pi pi-spin pi-spinner lb-spinner" aria-hidden="true"></i>
        <span>Loading global player leaderboard...</span>
      </div>

      <div v-else-if="error && !hasLoaded" class="lb-state-box lb-state-box--error">
        <i class="pi pi-exclamation-triangle"></i>
        <span>{{ error }}</span>
      </div>

      <div v-else-if="!isRefreshing && totalItems === 0" class="lb-state-box">
        <span>NO PLAYERS MATCH THE SELECTED FILTERS.</span>
        <div v-if="activeFilterChips.length" class="lb-empty-filters">
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
        <button class="lb-btn lb-btn--inline" @click="resetAll">Reset Filters</button>
      </div>

      <div
        v-else
        class="lb-results"
        :class="{ 'is-refreshing': isRefreshing }"
        :aria-busy="isRefreshing"
      >
        <ol class="lb-mobile-list">
          <li v-for="p in pagedRows" :key="`m-${p.name}`">
            <RouterLink
              :to="`/v4/players/${encodeURIComponent(p.name)}`"
              class="mm-session-row mm-session-row--rank"
              :class="rankTintClass(p.rank)"
            >
              <span class="mm-session-row__chip">{{ String(p.rank).padStart(2, '0') }}</span>
              <span class="mm-session-row__map">{{ $pn(p.name) }}</span>
              <span class="mm-session-row__date" :class="kdClass(p.kd)">{{ p.kd.toFixed(2) }}</span>
              <span class="mm-session-row__server">
                {{ p.favServer ? $pn(p.favServer) : '—' }}
                <template v-if="p.favMap"> · {{ p.favMap }}</template>
              </span>
              <span class="mm-session-row__stats">
                <span class="mm-num--kill">{{ formatInt(p.kills) }}</span>
                <span class="mm-num__sep">/</span>
                <span class="mm-num--death">{{ formatInt(p.deaths) }}</span>
                <span class="mm-num__sep">·</span>
                <span>{{ formatInt(p.score) }}</span>
              </span>
            </RouterLink>
          </li>
        </ol>
        <div class="lb-scroll-pane">
        <table class="lb-table" :class="{ 'lb-table--compact': density === 'compact' }">
          <!-- Table Header -->
          <thead>
            <tr>
              <th
                v-for="key in displayCols"
                :key="key"
                :style="{
                  width: `${widths[key] || 80}px`,
                  minWidth: `${widths[key] || 80}px`,
                  maxWidth: `${widths[key] || 80}px`,
                  left: pinned.includes(key) ? `${pinnedOffsets.offsets[key]}px` : undefined,
                  zIndex: pinned.includes(key) ? 6 : 4
                }"
                :class="{
                  'lb-th--pinned': pinned.includes(key),
                  'lb-th--pinned-last': pinned.includes(key) && pinnedOffsets.offsets[key] + (widths[key] || 80) >= pinnedOffsets.totalPinnedWidth,
                  'lb-th--right': getCol(key)?.align === 'right'
                }"
                draggable="true"
                @dragstart="onDragStart(key, $event)"
                @dragover.prevent
                @drop="onDrop(key)"
                @click="toggleSort(key, $event.shiftKey)"
              >
                <div class="lb-th-inner">
                  <div class="lb-th-label-group">
                    <i v-if="pinned.includes(key)" class="pi pi-lock lb-pin-icon" title="Pinned column"></i>
                    <span class="lb-th-text">{{ getCol(key)?.label }}</span>
                    <!-- Sort Direction Indicator -->
                    <span v-if="sort.find(s => s.key === key)" class="lb-sort-arrow">
                      {{ sort.find(s => s.key === key)?.dir === 'desc' ? '↓' : '↑' }}
                      <sup v-if="sort.length > 1" class="lb-sort-idx">
                        {{ sort.findIndex(s => s.key === key) + 1 }}
                      </sup>
                    </span>
                  </div>

                  <!-- Header Context Menu Trigger -->
                  <div v-if="key !== 'rank'" class="lb-th-actions" data-lbmenu="m">
                    <button
                      class="lb-th-menu-btn"
                      title="Column options"
                      @click.stop="menuKey = menuKey === key ? null : key"
                    >
                      <i class="pi pi-chevron-down"></i>
                    </button>

                    <!-- Context Menu Dropdown -->
                    <div v-if="menuKey === key" class="lb-menu-popover" data-lbmenu="m">
                      <button class="lb-menu-item" @click.stop="sort = [{ key, dir: 'asc' }]; menuKey = null">
                        <i class="pi pi-sort-amount-up"></i> Sort Ascending
                      </button>
                      <button class="lb-menu-item" @click.stop="sort = [{ key, dir: 'desc' }]; menuKey = null">
                        <i class="pi pi-sort-amount-down"></i> Sort Descending
                      </button>
                      <button class="lb-menu-item lb-desktop-only" @click.stop="togglePin(key)">
                        <i :class="pinned.includes(key) ? 'pi pi-unlock' : 'pi pi-lock'"></i>
                        {{ pinned.includes(key) ? 'Unpin column' : 'Pin column' }}
                      </button>
                      <button
                        v-if="getCol(key)?.groupable"
                        class="lb-menu-item"
                        @click.stop="groupBy = key === 'favServer' ? 'favServer' : key === 'kd' ? 'kdBand' : null; menuKey = null"
                      >
                        <i class="pi pi-folder"></i> Group by this
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

          <!-- Table Body -->
          <tbody>
            <!-- Grouped Rendering Mode -->
            <template v-if="groupedRows">
              <template v-for="grp in groupedRows" :key="grp.groupKey">
                <!-- Group Header Row -->
                <tr class="lb-group-row" @click="toggleGroupCollapse(grp.groupKey)">
                  <td :colspan="displayCols.length" class="lb-group-cell">
                    <div class="lb-group-content">
                      <i :class="collapsedGroups.has(grp.groupKey) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" class="lb-group-chevron"></i>
                      <span class="lb-group-name">{{ $pn(grp.label) }}</span>
                      <span class="lb-group-badge">{{ grp.players.length }} PLAYERS</span>
                      <span class="lb-group-stat">AVG K/D {{ grp.avgKd.toFixed(2) }}</span>
                      <span class="lb-group-stat">TOTAL KILLS {{ formatInt(grp.totalKills) }}</span>
                    </div>
                  </td>
                </tr>

                <!-- Group Player Rows -->
                <template v-if="!collapsedGroups.has(grp.groupKey)">
                  <tr
                    v-for="p in grp.players"
                    :key="p.name"
                    class="lb-row"
                    :class="{ 'lb-row--selected': selectedPlayer === p.name }"
                    @click="selectedPlayer = selectedPlayer === p.name ? null : p.name"
                  >
                    <td
                      v-for="k in displayCols"
                      :key="k"
                      :style="{
                        width: `${widths[k] || 80}px`,
                        minWidth: `${widths[k] || 80}px`,
                        maxWidth: `${widths[k] || 80}px`,
                        left: pinned.includes(k) ? `${pinnedOffsets.offsets[k]}px` : undefined,
                        zIndex: pinned.includes(k) ? 2 : 1
                      }"
                      :class="{
                        'lb-td--pinned': pinned.includes(k),
                        'lb-td--pinned-last': pinned.includes(k) && pinnedOffsets.offsets[k] + (widths[k] || 80) >= pinnedOffsets.totalPinnedWidth,
                        'lb-td--right': getCol(k)?.align === 'right',
                        'lb-td--center': getCol(k)?.align === 'center'
                      }"
                    >
                      <!-- Rank Cell -->
                      <template v-if="k === 'rank'">
                        <span class="lb-rank" :class="{ 'lb-rank--podium': p.rank <= 3 }">
                          {{ String(p.rank).padStart(2, '0') }}
                        </span>
                      </template>

                      <!-- Player Cell -->
                      <template v-else-if="k === 'player'">
                        <div class="lb-player-cell">
                          <span v-if="p.isActive" class="lb-online-dot" title="Currently online playing"></span>
                          <span v-if="p.tag" class="lb-tag">{{ p.tag }}</span>
                          <RouterLink
                            :to="`/v4/players/${encodeURIComponent(p.name)}`"
                            class="lb-player-link"
                            :title="`View ${$pn(p.name)}'s profile`"
                            @click.stop
                          >
                            {{ $pn(p.name) }}
                          </RouterLink>
                        </div>
                      </template>

                      <!-- K/D Cell -->
                      <template v-else-if="k === 'kd'">
                        <span class="lb-kd" :class="kdClass(p.kd)">{{ p.kd.toFixed(2) }}</span>
                      </template>

                      <!-- Kills Cell -->
                      <template v-else-if="k === 'kills'">
                        <span class="lb-kill">{{ formatInt(p.kills) }}</span>
                      </template>

                      <!-- Deaths Cell -->
                      <template v-else-if="k === 'deaths'">
                        <span class="lb-death">{{ formatInt(p.deaths) }}</span>
                      </template>

                      <!-- Score Cell -->
                      <template v-else-if="k === 'score'">
                        <span class="lb-score">{{ formatInt(p.score) }}</span>
                      </template>

                      <!-- Kill Rate KPM -->
                      <template v-else-if="k === 'kpm'">
                        <span class="lb-kpm">{{ p.kpm.toFixed(2) }}</span>
                      </template>

                      <!-- Play Time -->
                      <template v-else-if="k === 'playMin'">
                        <span class="lb-time">{{ formatTime(p.playMin) }}</span>
                      </template>

                      <!-- Rounds -->
                      <template v-else-if="k === 'rounds'">
                        <span class="lb-int">{{ formatInt(p.rounds) }}</span>
                      </template>

                      <!-- Last Seen -->
                      <template v-else-if="k === 'lastSeen'">
                        <span class="lb-date" :title="p.lastSeen ? formatLocalTooltip(p.lastSeen) : undefined">
                          {{ formatRelativeDate(p.lastSeen) }}
                        </span>
                      </template>

                      <!-- Favorite Server -->
                      <template v-else-if="k === 'favServer'">
                        <div class="lb-server-cell">
                          <span v-if="p.favServerFlag" class="lb-flag">{{ p.favServerFlag }}</span>
                          <RouterLink
                            v-if="p.favServer"
                            :to="`/v4/servers/detail/${encodeURIComponent(p.favServer)}`"
                            class="lb-server-link"
                            :title="$pn(p.favServer)"
                            @click.stop
                          >
                            {{ $pn(p.favServer) }}
                          </RouterLink>
                          <span v-else class="lb-muted">—</span>
                        </div>
                      </template>

                      <!-- Favorite Map -->
                      <template v-else-if="k === 'favMap'">
                        <div class="lb-map-cell">
                          <i class="pi pi-map lb-map-icon"></i>
                          <span v-if="p.favMap" class="lb-map-name" :title="p.favMap">{{ p.favMap }}</span>
                          <span v-else class="lb-muted">—</span>
                        </div>
                      </template>

                      <!-- Online Status -->
                      <template v-else-if="k === 'status'">
                        <span v-if="p.isActive" class="lb-status-badge lb-status-badge--online">ONLINE</span>
                        <span v-else class="lb-status-badge lb-status-badge--offline">OFFLINE</span>
                      </template>
                    </td>
                  </tr>
                </template>
              </template>
            </template>

            <!-- Flat Paged Rendering Mode -->
            <template v-else>
              <tr
                v-for="p in pagedRows"
                :key="p.name"
                class="lb-row"
                :class="{ 'lb-row--selected': selectedPlayer === p.name }"
                @click="selectedPlayer = selectedPlayer === p.name ? null : p.name"
              >
                <td
                  v-for="k in displayCols"
                  :key="k"
                  :style="{
                    width: `${widths[k] || 80}px`,
                    minWidth: `${widths[k] || 80}px`,
                    maxWidth: `${widths[k] || 80}px`,
                    left: pinned.includes(k) ? `${pinnedOffsets.offsets[k]}px` : undefined,
                    zIndex: pinned.includes(k) ? 2 : 1
                  }"
                  :class="{
                    'lb-td--pinned': pinned.includes(k),
                    'lb-td--pinned-last': pinned.includes(k) && pinnedOffsets.offsets[k] + (widths[k] || 80) >= pinnedOffsets.totalPinnedWidth,
                    'lb-td--right': getCol(k)?.align === 'right',
                    'lb-td--center': getCol(k)?.align === 'center'
                  }"
                >
                  <!-- Rank Cell -->
                  <template v-if="k === 'rank'">
                    <span class="lb-rank" :class="{ 'lb-rank--podium': p.rank <= 3 }">
                      {{ String(p.rank).padStart(2, '0') }}
                    </span>
                  </template>

                  <!-- Player Cell -->
                  <template v-else-if="k === 'player'">
                    <div class="lb-player-cell">
                      <span v-if="p.isActive" class="lb-online-dot" title="Currently online playing"></span>
                      <span v-if="p.tag" class="lb-tag">{{ p.tag }}</span>
                      <RouterLink
                        :to="`/v4/players/${encodeURIComponent(p.name)}`"
                        class="lb-player-link"
                        :title="`View ${$pn(p.name)}'s profile`"
                        @click.stop
                      >
                        {{ $pn(p.name) }}
                      </RouterLink>
                    </div>
                  </template>

                  <!-- K/D Cell -->
                  <template v-else-if="k === 'kd'">
                    <span class="lb-kd" :class="kdClass(p.kd)">{{ p.kd.toFixed(2) }}</span>
                  </template>

                  <!-- Kills Cell -->
                  <template v-else-if="k === 'kills'">
                    <span class="lb-kill">{{ formatInt(p.kills) }}</span>
                  </template>

                  <!-- Deaths Cell -->
                  <template v-else-if="k === 'deaths'">
                    <span class="lb-death">{{ formatInt(p.deaths) }}</span>
                  </template>

                  <!-- Score Cell -->
                  <template v-else-if="k === 'score'">
                    <span class="lb-score">{{ formatInt(p.score) }}</span>
                  </template>

                  <!-- Kill Rate KPM -->
                  <template v-else-if="k === 'kpm'">
                    <span class="lb-kpm">{{ p.kpm.toFixed(2) }}</span>
                  </template>

                  <!-- Play Time -->
                  <template v-else-if="k === 'playMin'">
                    <span class="lb-time">{{ formatTime(p.playMin) }}</span>
                  </template>

                  <!-- Rounds -->
                  <template v-else-if="k === 'rounds'">
                    <span class="lb-int">{{ formatInt(p.rounds) }}</span>
                  </template>

                  <!-- Last Seen -->
                  <template v-else-if="k === 'lastSeen'">
                    <span class="lb-date" :title="p.lastSeen ? formatLocalTooltip(p.lastSeen) : undefined">
                      {{ formatRelativeDate(p.lastSeen) }}
                    </span>
                  </template>

                  <!-- Favorite Server -->
                  <template v-else-if="k === 'favServer'">
                    <div class="lb-server-cell">
                      <span v-if="p.favServerFlag" class="lb-flag">{{ p.favServerFlag }}</span>
                      <RouterLink
                        v-if="p.favServer"
                        :to="`/v4/servers/detail/${encodeURIComponent(p.favServer)}`"
                        class="lb-server-link"
                        :title="$pn(p.favServer)"
                        @click.stop
                      >
                        {{ $pn(p.favServer) }}
                      </RouterLink>
                      <span v-else class="lb-muted">—</span>
                    </div>
                  </template>

                  <!-- Favorite Map -->
                  <template v-else-if="k === 'favMap'">
                    <div class="lb-map-cell">
                      <i class="pi pi-map lb-map-icon"></i>
                      <span v-if="p.favMap" class="lb-map-name" :title="p.favMap">{{ p.favMap }}</span>
                      <span v-else class="lb-muted">—</span>
                    </div>
                  </template>

                  <!-- Online Status -->
                  <template v-else-if="k === 'status'">
                    <span v-if="p.isActive" class="lb-status-badge lb-status-badge--online">ONLINE</span>
                    <span v-else class="lb-status-badge lb-status-badge--offline">OFFLINE</span>
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        </div>
      </div>
    </div>

    <!-- Server-side paginator -->
    <div v-if="totalItems > 0" class="lb-pagination-bar">
      <div class="lb-page-meta">
        PAGE {{ page }} OF {{ totalPages }} · {{ pageSize }} PER PAGE
      </div>

      <div class="lb-page-controls">
        <button
          class="lb-page-btn"
          :disabled="page <= 1 || loading"
          @click="page = Math.max(1, page - 1); selectedPlayer = null"
        >
          ← PREV
        </button>

        <template v-for="pIndex in totalPages" :key="pIndex">
          <!-- Always show first, last, current, and neighbors; collapse rest with ellipsis -->
          <template v-if="pIndex === 1 || pIndex === totalPages || Math.abs(pIndex - page) <= 1">
            <button
              class="lb-page-num"
              :class="{ 'lb-page-num--active': page === pIndex }"
              :disabled="loading"
              @click="page = pIndex; selectedPlayer = null"
            >
              {{ pIndex }}
            </button>
          </template>
          <span
            v-else-if="pIndex === 2 && page > 3"
            class="lb-page-ellipsis"
          >…</span>
          <span
            v-else-if="pIndex === totalPages - 1 && page < totalPages - 2"
            class="lb-page-ellipsis"
          >…</span>
        </template>

        <button
          class="lb-page-btn"
          :disabled="page >= totalPages || loading"
          @click="page = Math.min(totalPages, page + 1); selectedPlayer = null"
        >
          NEXT →
        </button>
      </div>

      <div class="lb-page-size-selector lb-desktop-only">
        <select v-model.number="pageSize" class="lb-select" @change="page = 1">
          <option :value="25">25 / page</option>
          <option :value="50">50 / page</option>
          <option :value="100">100 / page</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lb-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--mm-bg);
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  width: 100%;
}

.lb-container--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: var(--mm-bg);
  overflow-y: auto;
  padding-bottom: 24px;
}

/* Header */
.lb-header {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 28px 24px 18px;
  box-sizing: border-box;
}

.lb-title {
  font-size: 48px;
  font-weight: 300;
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1.1;
}

/* Filters & Toolbar */
.lb-filter-wrapper {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0 24px;
  box-sizing: border-box;
}

.lb-filter-card {
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg-soft);
}

/* Server Select Dropdown */
.lb-server-select-wrap {
  position: relative;
}

.lb-server-dropdown-anchor {
  position: relative;
  display: flex;
  align-items: stretch;
  max-width: 292px;
}

.lb-server-dropdown-btn {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.05em;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 5px 24px 5px 8px;
  cursor: pointer;
  outline: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.12s ease;
  max-width: 260px;
  flex: 1;
  min-width: 0;
  text-align: left;
  position: relative;
}

.lb-server-dropdown-btn:hover {
  border-color: var(--mm-accent);
}

.lb-server-dropdown-btn--active {
  border-color: var(--mm-accent);
  background: var(--mm-bg);
}

.lb-server-dropdown-btn--open {
  border-color: var(--mm-accent);
  box-shadow: 0 0 0 1px var(--mm-accent);
}

.lb-server-icon {
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.lb-server-dropdown-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.lb-chevron-icon {
  position: absolute;
  right: 8px;
  font-size: 9px;
  color: var(--mm-ink-muted);
  pointer-events: none;
}

.lb-server-clear-btn {
  flex-shrink: 0;
  width: 32px;
  border: 1px solid var(--mm-rule);
  border-left: 0;
  border-radius: 0 2px 2px 0;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  cursor: pointer;
  padding: 0;
  font-family: var(--mm-font-display);
  font-size: 18px;
  font-weight: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.lb-server-dropdown-btn:has(+ .lb-server-clear-btn) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.lb-server-clear-btn:hover {
  color: var(--mm-ink);
}

/* Server Dropdown Popover */
.lb-server-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 50;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  width: 320px;
  max-width: 90vw;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lb-mobile-only {
  display: none;
}

.lb-sheet-head {
  display: none;
}

.lb-sheet-title {
  margin: 4px 0 0;
  font-family: var(--mm-font-display);
  font-size: 28px;
  font-weight: 500;
  color: var(--mm-ink);
  line-height: 1.1;
}

.lb-sheet-done {
  flex-shrink: 0;
  min-height: 44px;
  min-width: 44px;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.lb-sheet-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.lb-sheet-clear {
  flex-shrink: 0;
  min-height: 44px;
  padding: 8px 14px;
  background: transparent;
  border: 0;
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.lb-sheet-clear:hover,
.lb-sheet-done:hover {
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.lb-sheet-clear:hover {
  border-color: transparent;
}

.lb-server-popover--sheet {
  position: fixed;
  inset: 0;
  top: 0;
  left: 0;
  z-index: 1100;
  width: 100%;
  height: 100dvh;
  max-width: none;
  border: 0;
  border-radius: 0;
  padding: 0 0 env(safe-area-inset-bottom);
  box-shadow: none;
  background: var(--mm-bg);
  gap: 10px;
  overflow: hidden;
}

.lb-server-popover--sheet .lb-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  padding-top: max(16px, env(safe-area-inset-top));
  border-bottom: 1px solid var(--mm-rule);
}

.lb-server-popover--sheet .lb-server-mode-toggle,
.lb-server-popover--sheet .lb-populated-toggle,
.lb-server-popover--sheet .lb-server-search-box,
.lb-server-popover--sheet .lb-picked-strip {
  margin-left: 16px;
  margin-right: 16px;
  width: auto;
}

.lb-server-popover--sheet .lb-mode-btn {
  min-height: 44px;
}

.lb-server-popover--sheet .lb-populated-toggle {
  min-height: 48px;
}

.lb-server-popover--sheet .lb-server-search-input {
  min-height: 44px;
  font-size: 16px;
  padding: 10px 36px 10px 32px;
}

.lb-server-popover--sheet .lb-server-list {
  flex: 1;
  max-height: none;
  min-height: 0;
  padding: 0 8px 16px;
}

.lb-server-popover--sheet .lb-server-item {
  min-height: 48px;
  padding: 12px 10px;
  font-size: 14px;
}

.lb-server-search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.lb-server-search-icon {
  position: absolute;
  left: 8px;
  font-size: 11px;
  color: var(--mm-ink-muted);
  pointer-events: none;
}

.lb-server-search-input {
  width: 100%;
  padding: 6px 24px 6px 26px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink);
  outline: none;
}

.lb-server-search-input:focus {
  border-color: var(--mm-accent);
}

.lb-server-search-clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--mm-ink-muted);
  cursor: pointer;
  padding: 2px;
  font-size: 10px;
}

.lb-server-list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lb-server-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 2px;
  border: none;
  background: transparent;
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: all 0.1s ease;
  width: 100%;
}

.lb-server-item:hover {
  background: var(--mm-bg-mute);
  color: var(--mm-accent);
}

.lb-pick-mark {
  width: 15px;
  height: 15px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  flex-shrink: 0;
  background: var(--mm-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.lb-pick-mark.is-on {
  background: var(--mm-accent);
  border-color: var(--mm-accent);
}

.lb-pick-mark.is-on::after {
  content: '';
  width: 7px;
  height: 4px;
  margin-top: -1px;
  border-left: 1.5px solid var(--mm-highlight-ink);
  border-bottom: 1.5px solid var(--mm-highlight-ink);
  transform: rotate(-45deg);
}

.lb-pick-mark--excl.is-on {
  background: var(--mm-danger);
  border-color: var(--mm-danger);
}

.lb-pick-mark--excl.is-on::after {
  width: 8px;
  height: 0;
  margin: 0;
  border-left: none;
  border-bottom: 1.5px solid #fff;
  transform: none;
}

.lb-pick-state {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  font-weight: 700;
  color: var(--mm-highlight-ink);
  background: var(--mm-accent);
  padding: 2px 5px;
  border-radius: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.lb-pick-state--excl {
  background: var(--mm-danger);
  color: #fff;
}

.lb-server-item--active {
  background: color-mix(in srgb, var(--mm-accent) 18%, var(--mm-bg-mute));
  color: var(--mm-ink);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--mm-accent);
}

.lb-server-item--active:hover {
  background: color-mix(in srgb, var(--mm-accent) 26%, var(--mm-bg-mute));
  color: var(--mm-ink);
}

.lb-server-item--active .lb-server-item-icon {
  color: var(--mm-accent);
}

.lb-picked-strip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: color-mix(in srgb, var(--mm-accent) 14%, var(--mm-bg-mute));
  border: 1px solid var(--mm-accent);
  border-radius: 2px;
}

.lb-picked-strip--excl {
  background: color-mix(in srgb, var(--mm-danger) 14%, var(--mm-bg-mute));
  border-color: var(--mm-danger);
}

.lb-picked-strip-kicker {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-accent);
  font-weight: 700;
}

.lb-picked-strip--excl .lb-picked-strip-kicker {
  color: var(--mm-danger);
}

.lb-picked-strip-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 72px;
  overflow-y: auto;
}

.lb-picked-chip {
  font-family: var(--mm-font-display);
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 7px;
  border: none;
  border-radius: 2px;
  background: var(--mm-accent);
  color: var(--mm-highlight-ink);
  cursor: pointer;
}

.lb-picked-chip span {
  font-size: 13px;
  line-height: 1;
  opacity: 0.75;
}

.lb-picked-chip:hover {
  filter: brightness(1.08);
}

.lb-picked-chip--excl {
  background: var(--mm-danger);
  color: #fff;
}

.lb-server-item-icon {
  font-size: 12px;
  color: var(--mm-ink-muted);
  flex-shrink: 0;
}

.lb-server-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-server-check {
  font-size: 10px;
  color: var(--mm-accent);
  margin-left: auto;
  flex-shrink: 0;
}

.lb-server-empty {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  padding: 12px 8px;
  text-align: center;
  font-style: italic;
}

.lb-server-active-tag {
  color: var(--mm-highlight-ink);
  font-weight: 700;
}

.lb-server-count {
  color: var(--mm-ink-muted);
  font-size: 9.5px;
}

.lb-server-dropdown-btn--exclude {
  border-color: var(--mm-danger);
  color: var(--mm-danger);
}

.lb-server-icon--exclude {
  color: var(--mm-danger);
}

.lb-exclude-badge {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: var(--mm-danger);
  color: var(--mm-bg);
  border-radius: 8px;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.lb-server-mode-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.lb-mode-btn {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-mute);
  color: var(--mm-ink-muted);
  cursor: pointer;
}

.lb-mode-btn:hover {
  color: var(--mm-ink);
  border-color: var(--mm-accent-soft);
}

.lb-mode-btn--active {
  background: var(--mm-bg);
  border-color: var(--mm-accent);
  color: var(--mm-accent);
  font-weight: 600;
}

.lb-mode-btn--exclude.lb-mode-btn--active {
  border-color: var(--mm-danger);
  color: var(--mm-danger);
}

.lb-populated-toggle {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 8px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-mute);
  color: var(--mm-ink-soft);
  cursor: pointer;
}

.lb-populated-toggle:hover {
  border-color: var(--mm-accent-soft);
  color: var(--mm-ink);
}

.lb-populated-toggle--on {
  border-color: var(--mm-accent);
  background: var(--mm-bg);
  color: var(--mm-ink);
}

.lb-live-pill {
  margin-left: auto;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--mm-success);
  flex-shrink: 0;
}

.lb-server-item--excluded {
  color: var(--mm-ink);
  background: color-mix(in srgb, var(--mm-danger) 16%, var(--mm-bg-mute));
  box-shadow: inset 3px 0 0 var(--mm-danger);
  font-weight: 600;
}

.lb-server-item--excluded:hover {
  background: color-mix(in srgb, var(--mm-danger) 24%, var(--mm-bg-mute));
  color: var(--mm-ink);
}

.lb-server-item--excluded .lb-server-item-name {
  text-decoration: line-through;
  text-decoration-color: var(--mm-danger);
}

.lb-server-item--clear-excl {
  color: var(--mm-danger);
  border-bottom: 1px solid var(--mm-rule);
  margin-bottom: 4px;
  border-radius: 0;
}

.lb-server-item--quiet {
  opacity: 0.55;
}

.lb-server-exclude-icon {
  font-size: 10px;
  color: var(--mm-danger);
  margin-left: auto;
  flex-shrink: 0;
}

.lb-server-avg {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  flex-shrink: 0;
}

.lb-server-avg--live {
  color: var(--mm-success);
  font-weight: 600;
}

.lb-controls-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  flex-wrap: wrap;
  position: relative;
}

.lb-control-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lb-slicer-label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.lb-select {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 5px 8px;
  cursor: pointer;
  outline: none;
}

.lb-select:focus {
  border-color: var(--mm-accent);
}

/* Search input */
.lb-search-group {
  position: relative;
  display: flex;
  align-items: center;
}

.lb-search-icon {
  position: absolute;
  left: 8px;
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.lb-search-input {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 5px 24px 5px 26px;
  width: 190px;
  outline: none;
  transition: width 0.2s ease, border-color 0.2s ease;
}

.lb-search-input:focus {
  border-color: var(--mm-accent);
  width: 230px;
}

.lb-search-clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--mm-ink-muted);
  cursor: pointer;
  font-size: 9px;
  padding: 2px;
}

.lb-spacer {
  flex: 1;
  min-width: 8px;
}

/* Buttons */
.lb-btn {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
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

.lb-btn--inline {
  margin-top: 12px;
}

/* Popover Panel */
.lb-menu-anchor {
  position: relative;
}

.lb-col-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 12px;
  width: 210px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.6);
}

.lb-popover-title {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: var(--mm-ink-muted);
  margin-bottom: 8px;
}

.lb-col-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  cursor: pointer;
  font-size: 13px;
  color: var(--mm-ink-soft);
}

.lb-col-check:hover {
  color: var(--mm-ink);
}

/* Olive Section Bar */
.lb-section-bar-wrap {
  width: 100%;
  max-width: 100%;
  margin: 16px 0 0;
  padding: 0 24px;
  box-sizing: border-box;
}

.lb-refresh-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 0;
  background: var(--mm-highlight-ink);
  pointer-events: none;
  z-index: 1;
}

.lb-refresh-bar.is-on {
  animation: mm-progress-run 1.8s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .lb-refresh-bar.is-on {
    animation: none;
    width: 100%;
  }

  .lb-results.is-refreshing {
    transition: none;
  }
}

.lb-section-bar {
  position: relative;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  border-radius: 2px 2px 0 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  font-weight: 500;
}

.lb-section-right {
  opacity: 0.85;
}

.lb-excluded-tag {
  color: var(--mm-highlight-ink);
  font-weight: 700;
}

.lb-populated-tag {
  color: var(--mm-highlight-ink);
  font-weight: 700;
  opacity: 0.85;
}

.lb-results.is-refreshing {
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

/* Table */
.lb-table-container {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0 24px;
  box-sizing: border-box;
}

.lb-scroll-pane {
  overflow-x: auto;
  border: 1px solid var(--mm-rule);
  border-top: none;
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
  height: 38px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  padding: 0;
  user-select: none;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  font-weight: 600;
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

.lb-th-inner {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 10px;
  cursor: pointer;
}

.lb-th--right .lb-th-inner {
  justify-content: flex-end;
}

.lb-th-label-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.lb-pin-icon {
  font-size: 8px;
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
  font-size: 8px;
  margin-left: 1px;
}

.lb-th-actions {
  position: relative;
}

.lb-th-menu-btn {
  background: transparent;
  border: none;
  color: var(--mm-highlight-ink);
  opacity: 0.6;
  cursor: pointer;
  padding: 2px;
  font-size: 9px;
  line-height: 1;
}

.lb-th-menu-btn:hover {
  opacity: 1;
}

.lb-menu-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.6);
  font-family: var(--mm-font-display);
}

.lb-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--mm-ink);
  font-size: 12px;
  padding: 7px 9px;
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
  padding: 10px 10px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: 1px solid var(--mm-rule);
  background: var(--mm-bg);
  box-sizing: border-box;
}

.lb-table--compact td {
  padding: 6px 10px;
  font-size: 12px;
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
  background: var(--mm-bg-soft) !important;
}

/* Cell Elements */
.lb-rank {
  font-weight: 400;
  color: var(--mm-ink-muted);
}

.lb-rank--podium {
  font-weight: 600;
  color: var(--mm-accent);
}

.lb-player-cell {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mm-font-display);
  min-width: 0;
}

.lb-online-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mm-success);
  box-shadow: 0 0 6px var(--mm-success);
  flex-shrink: 0;
}

.lb-tag {
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  flex-shrink: 0;
}

.lb-player-link {
  color: var(--mm-ink);
  font-size: 13.5px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lb-player-link:hover {
  color: var(--mm-accent);
}

.lb-kd {
  font-weight: 600;
}

.lb-kill {
  color: var(--mm-kill);
}

.lb-death {
  color: var(--mm-death);
}

.lb-score {
  color: var(--mm-ink);
}

.lb-kpm {
  color: var(--mm-ink-soft);
}

.lb-time {
  color: var(--mm-ink-soft);
}

.lb-int {
  color: var(--mm-ink-soft);
}

.lb-date {
  color: var(--mm-ink-muted);
}

.lb-server-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  min-width: 0;
}

.lb-flag {
  font-size: 13px;
  flex-shrink: 0;
}

.lb-server-link {
  color: var(--mm-ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lb-server-link:hover {
  color: var(--mm-accent);
}

.lb-map-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lb-map-icon {
  font-size: 11px;
  color: var(--mm-accent);
  flex-shrink: 0;
}

.lb-map-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-map-active-tag {
  color: var(--mm-highlight-ink);
  font-weight: 700;
}

.lb-muted {
  color: var(--mm-ink-faint);
}

.lb-status-badge {
  font-size: 9.5px;
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.lb-status-badge--online {
  background: var(--mm-success-bg);
  color: var(--mm-success);
}

.lb-status-badge--offline {
  background: var(--mm-bg-mute);
  color: var(--mm-ink-faint);
}

/* Grouping Rows */
.lb-group-row {
  cursor: pointer;
}

.lb-group-cell {
  position: sticky;
  left: 0;
  background: var(--mm-bg-soft);
  border-top: 1px solid var(--mm-rule-strong);
  border-bottom: 1px solid var(--mm-rule-strong);
  padding: 8px 12px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
}

.lb-group-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.lb-group-chevron {
  color: var(--mm-accent);
  font-size: 9px;
}

.lb-group-name {
  color: var(--mm-accent-soft);
  font-weight: 600;
  text-transform: uppercase;
}

.lb-group-badge {
  color: var(--mm-ink-muted);
}

.lb-group-stat {
  color: var(--mm-ink-muted);
}

/* State Box */
.lb-state-box {
  padding: 60px 32px;
  text-align: center;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  border: 1px solid var(--mm-rule);
  border-top: none;
  background: var(--mm-bg);
  overflow: hidden;
}

.lb-state-box--error {
  color: var(--mm-danger);
}

.lb-empty-filters,
.lb-active-filters {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}

.lb-active-filters {
  justify-content: flex-start;
  margin: 0;
  padding: 0 14px 12px;
  border-top: 1px solid var(--mm-rule);
  padding-top: 10px;
}

.lb-empty-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.lb-empty-chip:hover {
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.lb-empty-chip .pi {
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.lb-spinner {
  font-size: 20px;
  color: var(--mm-accent);
  display: block;
  width: 1em;
  height: 1em;
  line-height: 1;
  margin: 0 auto 12px;
  overflow: hidden;
}

/* Paginator */
.lb-pagination-bar {
  width: 100%;
  max-width: 100%;
  margin: 0 0 40px;
  padding: 16px 24px 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.lb-page-meta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
}

.lb-page-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lb-page-btn, .lb-page-num {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  padding: 5px 9px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: transparent;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: all 0.1s ease;
}

.lb-page-btn:disabled {
  color: var(--mm-ink-faint);
  cursor: default;
}

.lb-page-btn:not(:disabled):hover, .lb-page-num:hover {
  border-color: var(--mm-accent);
  color: var(--mm-ink);
}

.lb-page-num--active {
  border-color: var(--mm-accent);
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
  font-weight: 600;
}

.lb-page-ellipsis {
  color: var(--mm-ink-faint);
  padding: 0 4px;
}

.lb-page-size-selector {
  display: flex;
  align-items: center;
}

.lb-mobile-list {
  display: none;
  list-style: none;
  margin: 0;
  padding: 8px 4px 4px;
  border: 1px solid var(--mm-rule);
  border-top: none;
  background: var(--mm-bg);
}

.lb-mobile-list .mm-session-row {
  padding-left: 10px;
  padding-right: 10px;
}

.lb-mobile-list .mm-session-row--rank .mm-session-row__chip {
  font-family: var(--mm-font-mono);
  background: transparent;
  color: var(--mm-ink-muted);
  border-color: var(--mm-rule);
}

.lb-mobile-list .mm-rank--gold .mm-session-row__chip {
  color: var(--mm-kd-elite);
  border-color: var(--mm-kd-elite);
}

.lb-mobile-list .mm-rank--silver .mm-session-row__chip {
  color: var(--mm-ink);
  border-color: var(--mm-ink-soft);
}

.lb-mobile-list .mm-rank--bronze .mm-session-row__chip {
  color: var(--mm-accent-soft);
  border-color: var(--mm-accent-soft);
}

@media (max-width: 720px) {
  .lb-desktop-only {
    display: none !important;
  }

  .lb-mobile-only {
    display: inline-flex;
  }

  .lb-header {
    padding: 16px 12px 8px;
  }

  .lb-title {
    font-size: 32px;
  }

  .lb-filter-wrapper,
  .lb-section-bar-wrap,
  .lb-table-container,
  .lb-pagination-bar {
    padding-left: 12px;
    padding-right: 12px;
  }

  .lb-controls-row {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 10px 10px;
  }

  .lb-control-group:not(.lb-desktop-only) {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .lb-server-select-wrap,
  .lb-server-dropdown-anchor,
  .lb-server-dropdown-btn {
    width: 100%;
    max-width: none;
  }

  .lb-server-dropdown-btn {
    min-height: 44px;
    font-size: 13px;
    padding: 10px 28px 10px 12px;
  }

  .lb-server-clear-btn {
    width: 44px;
    min-height: 44px;
    font-size: 22px;
  }

  .lb-controls-row > .lb-btn {
    min-height: 44px;
    width: 100%;
    justify-content: center;
  }

  .lb-section-bar {
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    font-size: 10px;
  }

  .lb-scroll-pane {
    display: none;
  }

  .lb-mobile-list {
    display: flex;
    flex-direction: column;
  }

  .lb-th--pinned,
  .lb-td--pinned {
    position: static;
    left: auto !important;
    z-index: auto !important;
  }

  .lb-pagination-bar {
    justify-content: center;
    margin-bottom: 24px;
  }

  .lb-page-btn,
  .lb-page-num {
    min-height: 44px;
    min-width: 44px;
    padding: 8px 12px;
  }
}
</style>
