<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPlayersList } from '@/services/playerStatsApi'
import type { PlayerListItem } from '@/types/playerStatsTypes'
import { decodePlayerName } from '@/utils/playerName'
import MmRankCell from '@/components/v4/MmRankCell.vue'
import { kdClass } from '@/views/v4/mmTokens'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'

// The /stats/players API returns enhanced aggregate stats (kills, deaths,
// rounds, favorite server, recent activity) that the canonical
// PlayerListItem type doesn't acknowledge. Extend locally so the template
// can read them without `as any` everywhere.
interface PlayersV4ListItem extends PlayerListItem {
  totalKills?: number
  totalDeaths?: number
  totalRounds?: number
  favoriteServer?: string
  recentActivity?: {
    roundsThisWeek: number
    lastScore?: number
  }
}

const route = useRoute()
const router = useRouter()

const players = ref<PlayersV4ListItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const totalItems = ref(0)
const page = ref(Number(route.query.page) || 1)
const pageSize = 50

const sortBy = ref<string>((route.query.sortBy as string) || 'totalPlayTimeMinutes')
const sortOrder = ref<'asc' | 'desc'>((route.query.sortOrder as 'asc' | 'desc') || 'desc')
const filterName = ref<string>((route.query.q as string) || '')

let searchDebounce: number | undefined

// "Has the user actually searched for anything?" — drives whether the
// list is rendered at all. The page intentionally does NOT auto-load
// the full player registry on mount; the API search is exclusively
// triggered by the user typing in the filter box (or arriving with
// `?q=...` in the URL).
const hasSearched = computed(() => filterName.value.trim().length > 0)

const load = async () => {
  if (!hasSearched.value) {
    players.value = []
    totalItems.value = 0
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const filters: Record<string, string> = {}
    filters.playerName = filterName.value.trim()
    const r = await fetchPlayersList(page.value, pageSize, sortBy.value, sortOrder.value, filters)
    players.value = r.items as PlayersV4ListItem[]
    totalItems.value = r.totalItems
  } catch (e) {
    error.value = 'Player feed temporarily unavailable.'
    players.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // Only load if the URL already has a search query (deep-link).
  if (hasSearched.value) void load()
})

// When the route query changes WHILE the component stays mounted (e.g.
// the global header search submits `?q=…` while the user is already on
// /v4/players), Vue doesn't re-run setup. Sync the query into
// filterName here — that fires the debounced search watcher below.
watch(() => route.query.q, (q) => {
  const next = (q as string) ?? ''
  if (next !== filterName.value) filterName.value = next
})

watch([page, sortBy, sortOrder], () => {
  router.replace({
    query: {
      ...route.query,
      page: page.value === 1 ? undefined : String(page.value),
      sortBy: sortBy.value === 'totalPlayTimeMinutes' ? undefined : sortBy.value,
      sortOrder: sortOrder.value === 'desc' ? undefined : sortOrder.value,
    },
  })
  if (hasSearched.value) void load()
})

watch(filterName, (q) => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => {
    page.value = 1
    router.replace({ query: { ...route.query, q: q.trim() || undefined, page: undefined } })
    void load()
  }, 350)
})

onUnmounted(() => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
})

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

const formatNumber = (n: number) => n.toLocaleString()
const formatHours = (mins: number) => {
  if (!mins) return '0h'
  const h = mins / 60
  return h >= 100 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`
}
const formatRelative = (iso: string) => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 86_400_000 * 30) return `${Math.round(ms / 86_400_000)}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const headers: { id: string; label: string; sortable?: boolean; align?: 'right' }[] = [
  { id: 'rank', label: '' },
  { id: 'playerName', label: 'Player', sortable: true },
  { id: 'currentServer', label: 'Status' },
  { id: 'totalPlayTimeMinutes', label: 'Playtime', sortable: true, align: 'right' },
  { id: 'totalKills', label: 'K/D', align: 'right' },
  { id: 'totalRounds', label: 'Rounds', align: 'right' },
  { id: 'lastSeen', label: 'Last seen', sortable: true, align: 'right' },
]

// Per-column maxes for in-cell magnitude bars
const playtimeMax = computed(() =>
  Math.max(1, ...players.value.map(p => p.totalPlayTimeMinutes ?? 0)),
)
const kdMax = computed(() =>
  Math.max(1, ...players.value.map(p => kdValue(p))),
)
const roundsMax = computed(() =>
  Math.max(1, ...players.value.map(p => p.totalRounds ?? 0)),
)

function kdValue(p: PlayersV4ListItem): number {
  if (p.totalKills == null || p.totalDeaths == null) return 0
  if (p.totalDeaths === 0) return p.totalKills
  return p.totalKills / p.totalDeaths
}

function hasKd(p: PlayersV4ListItem): boolean {
  return p.totalKills != null && p.totalDeaths != null && (p.totalKills > 0 || p.totalDeaths > 0)
}

// Highlight the user's search query inside a name.
function highlightName(name: string): string {
  const decoded = decodePlayerName(name)
  const q = filterName.value.trim()
  if (!q) return escapeHtml(decoded)
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  return escapeHtml(decoded).replace(re, '<mark class="mm-players__mark">$1</mark>')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sessionKd(srv: { sessionKills?: number; sessionDeaths?: number } | undefined | null): number {
  if (!srv) return 0
  const k = srv.sessionKills ?? 0
  const d = srv.sessionDeaths ?? 0
  if (d === 0) return k
  return k / d
}

const onHeaderClick = (id: string) => {
  if (id === 'rank' || id === 'currentServer') return
  if (sortBy.value === id) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortBy.value = id
    sortOrder.value = 'desc'
  }
  page.value = 1
}

const goPlayer = (name: string) => router.push(`/v4/players/${encodeURIComponent(name)}`)
</script>

<template>
  <div class="mm-container mm-section">
    <h1 class="mm-display">Players</h1>

    <hr class="mm-rule" style="margin-top: 24px" />

    <!-- search row -->
    <div style="display: flex; align-items: center; gap: 18px; margin-top: 24px; flex-wrap: wrap">
      <label class="mm-search" style="flex: 1; min-width: 220px; max-width: 420px">
        <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          v-model="filterName"
          class="mm-search__input"
          type="text"
          placeholder="Filter by name…"
          aria-label="Filter players by name"
        />
      </label>

      <div v-if="hasSearched" class="mm-eyebrow" style="margin-left: auto">
        Page {{ page }} of {{ totalPages }} · {{ formatNumber(totalItems) }} results
      </div>
    </div>

    <!-- list -->
    <div v-if="!hasSearched" />

    <div v-else-if="loading && players.length === 0" style="padding: 32px 0">
      <div v-for="i in 8" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty" style="margin-top: 24px">{{ error }}</div>

    <div v-else-if="players.length === 0" class="mm-empty" style="margin-top: 24px">
      No players match that filter.
    </div>

    <table v-else class="mm-list mm-list--dense" style="margin-top: 18px">
      <thead>
        <tr>
          <th
            v-for="h in headers"
            :key="h.id"
            :class="{ 'is-num': h.align === 'right' }"
            :style="h.sortable ? 'cursor: pointer; user-select: none' : ''"
            @click="h.sortable && onHeaderClick(h.id)"
          >
            {{ h.label }}
            <template v-if="h.sortable && sortBy === h.id">
              <span style="color: var(--mm-accent)">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
            </template>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(p, i) in players"
          :key="p.playerName"
          @click="goPlayer(p.playerName)"
        >
          <td class="mm-list__rank is-muted">{{ String((page - 1) * pageSize + i + 1).padStart(2, '0') }}</td>
          <td class="mm-list__name-cell">
            <div class="mm-list__name">
              <span class="mm-list__name-primary" v-html="highlightName(p.playerName)" />
              <span v-if="p.favoriteServer" class="mm-list__name-sub">FAV · {{ p.favoriteServer }}</span>
            </div>
          </td>
          <td data-cell-label="Status">
            <template v-if="p.isActive && p.currentServer">
              <div class="mm-players__live">
                <span class="mm-chip" style="font-size: 9px; padding: 2px 6px">
                  <span class="mm-chip__dot" />
                  Live
                </span>
                <div class="mm-players__live-detail">
                  <span class="mm-players__live-server">{{ p.currentServer.serverName }}</span>
                  <span v-if="p.currentServer.mapName" class="mm-players__live-meta">
                    {{ p.currentServer.mapName }}
                  </span>
                  <span
                    v-if="p.currentServer.sessionKills != null || p.currentServer.sessionDeaths != null"
                    class="mm-players__live-meta"
                  >
                    <span class="mm-num--kill">{{ p.currentServer.sessionKills ?? 0 }}</span>
                    <span class="mm-num__sep">/</span>
                    <span class="mm-num--death">{{ p.currentServer.sessionDeaths ?? 0 }}</span>
                    <span class="mm-num__sep">·</span>
                    <span :class="kdClass(sessionKd(p.currentServer))">{{ sessionKd(p.currentServer).toFixed(2) }}</span>
                  </span>
                </div>
              </div>
            </template>
            <span
              v-else-if="p.isActive"
              class="mm-chip"
              style="font-size: 9px; padding: 2px 6px"
            >
              <span class="mm-chip__dot" />
              Online
            </span>
            <span
              v-else
              class="mm-chip mm-chip--off"
              style="font-size: 9px; padding: 2px 6px"
            >
              <span class="mm-chip__dot" />
              Offline
            </span>
          </td>
          <td class="is-num" data-cell-label="Playtime">
            <MmRankCell :value="p.totalPlayTimeMinutes ?? 0" :max="playtimeMax" tone="neutral">{{ formatHours(p.totalPlayTimeMinutes) }}</MmRankCell>
          </td>
          <td class="is-num" data-cell-label="K/D">
            <MmRankCell v-if="hasKd(p)" :value="kdValue(p)" :max="kdMax" tone="kd">
              <span :class="kdClass(kdValue(p))">{{ kdValue(p).toFixed(2) }}</span>
            </MmRankCell>
            <span v-else class="is-muted">—</span>
          </td>
          <td class="is-num" data-cell-label="Rounds">
            <MmRankCell v-if="p.totalRounds" :value="p.totalRounds" :max="roundsMax" tone="neutral">{{ formatNumber(p.totalRounds) }}</MmRankCell>
            <span v-else class="is-muted">—</span>
          </td>
          <td class="is-num is-muted" data-cell-label="Last seen" :title="formatLocalTooltip(p.lastSeen)">{{ formatRelative(p.lastSeen) }}</td>
        </tr>
      </tbody>
    </table>

    <!-- pagination -->

    <div
      v-if="totalPages > 1"
      style="display: flex; justify-content: space-between; align-items: center; margin-top: 24px; gap: 16px"
    >
      <button
        class="mm-btn"
        type="button"
        :disabled="page <= 1"
        :style="page <= 1 ? 'opacity: 0.35; cursor: not-allowed' : ''"
        @click="page > 1 && (page = page - 1)"
      >← Previous</button>
      <span class="mm-eyebrow">Page {{ page }} of {{ totalPages }}</span>
      <button
        class="mm-btn"
        type="button"
        :disabled="page >= totalPages"
        :style="page >= totalPages ? 'opacity: 0.35; cursor: not-allowed' : ''"
        @click="page < totalPages && (page = page + 1)"
      >Next →</button>
    </div>
  </div>
</template>

<style scoped>
.mm-players__live {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.mm-players__live-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-players__live-server {
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  font-size: 12.5px;
}

.mm-players__live-meta {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
}

:deep(.mm-players__mark) {
  background: var(--mm-highlight);
  color: var(--mm-ink);
  padding: 0 2px;
  border-radius: 1px;
}
</style>
