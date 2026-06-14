<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { searchServers, type ServerSearchItem } from '@/services/serverDetailsService'
import { countryCodeToName, countryCodeToFlag } from '@/types/countryCodes'
import MmRankCell from '@/components/v4/MmRankCell.vue'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'

const route = useRoute()
const router = useRouter()

const servers = ref<ServerSearchItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const totalItems = ref(0)
const page = ref(Number(route.query.page) || 1)
const pageSize = 25

const filterName = ref<string>((route.query.q as string) || '')

let searchDebounce: number | undefined

// Mirror of PlayersV4: the page never auto-loads the full server registry.
// The list only renders once the user has typed a query (or deep-linked ?q=).
const hasSearched = computed(() => filterName.value.trim().length > 0)

const load = async () => {
  if (!hasSearched.value) {
    servers.value = []
    totalItems.value = 0
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const r = await searchServers(filterName.value.trim(), page.value, pageSize)
    servers.value = r.items
    totalItems.value = r.totalItems
  } catch (e) {
    error.value = 'Server search temporarily unavailable.'
    servers.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (hasSearched.value) void load()
})

// Keep in sync when the global header search pushes ?q= while we're mounted.
watch(() => route.query.q, (q) => {
  const next = (q as string) ?? ''
  if (next !== filterName.value) filterName.value = next
})

watch(page, () => {
  router.replace({
    query: { ...route.query, page: page.value === 1 ? undefined : String(page.value) },
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
const formatRelative = (iso?: string | null) => {
  if (!iso) return '—'
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 86_400_000 * 30) return `${Math.round(ms / 86_400_000)}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const friendlyCountry = (code?: string | null) => {
  if (!code) return ''
  return countryCodeToName[code.toUpperCase()] ?? code.toUpperCase()
}

const players24hMax = computed(() =>
  Math.max(1, ...servers.value.map(s => s.totalActivePlayersLast24h ?? 0)),
)
const allTimeMax = computed(() =>
  Math.max(1, ...servers.value.map(s => s.totalPlayersAllTime ?? 0)),
)

function highlightName(name: string): string {
  const q = filterName.value.trim()
  if (!q) return escapeHtml(name)
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  return escapeHtml(name).replace(re, '<mark class="mm-servers__mark">$1</mark>')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const goServer = (name: string) => router.push(`/v4/servers/detail/${encodeURIComponent(name)}`)
</script>

<template>
  <div class="mm-container mm-section">
    <h1 class="mm-display">Servers</h1>

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
          placeholder="Search servers by name…"
          aria-label="Search servers by name"
        />
      </label>

      <div v-if="hasSearched" class="mm-eyebrow" style="margin-left: auto">
        Page {{ page }} of {{ totalPages }} · {{ formatNumber(totalItems) }} results
      </div>
    </div>

    <!-- list -->
    <div v-if="!hasSearched" class="mm-empty" style="margin-top: 24px">
      Search by name to find any tracked server — online or offline.
    </div>

    <div v-else-if="loading && servers.length === 0" style="padding: 32px 0">
      <div v-for="i in 8" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty" style="margin-top: 24px">{{ error }}</div>

    <div v-else-if="servers.length === 0" class="mm-empty" style="margin-top: 24px">
      No servers match that search.
    </div>

    <table v-else class="mm-list mm-list--dense" style="margin-top: 18px">
      <thead>
        <tr>
          <th></th>
          <th>Server</th>
          <th>Status</th>
          <th>Region</th>
          <th class="is-num">Players 24h</th>
          <th class="is-num">All-time</th>
          <th class="is-num">Last seen</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(s, i) in servers"
          :key="s.serverGuid"
          @click="goServer(s.serverName)"
        >
          <td class="mm-list__rank is-muted">{{ String((page - 1) * pageSize + i + 1).padStart(2, '0') }}</td>
          <td class="mm-list__name-cell">
            <div class="mm-list__name">
              <span class="mm-list__name-primary" v-html="highlightName(s.serverName)" />
              <span class="mm-list__name-sub">{{ s.serverIp }}:{{ s.serverPort }}</span>
            </div>
          </td>
          <td data-cell-label="Status">
            <span v-if="s.hasActivePlayers" class="mm-chip" style="font-size: 9px; padding: 2px 6px">
              <span class="mm-chip__dot" />
              Live
            </span>
            <span v-else class="mm-chip mm-chip--off" style="font-size: 9px; padding: 2px 6px">
              <span class="mm-chip__dot" />
              Offline
            </span>
            <span v-if="s.currentMap" class="mm-servers__map">{{ s.currentMap }}</span>
          </td>
          <td data-cell-label="Region">
            <span v-if="s.country" class="mm-servers__region">
              <span class="mm-servers__flag">{{ countryCodeToFlag(s.country) }}</span>
              {{ friendlyCountry(s.country) }}
            </span>
            <span v-else class="is-muted">—</span>
          </td>
          <td class="is-num" data-cell-label="Players 24h">
            <MmRankCell v-if="s.totalActivePlayersLast24h" :value="s.totalActivePlayersLast24h" :max="players24hMax" tone="neutral">{{ formatNumber(s.totalActivePlayersLast24h) }}</MmRankCell>
            <span v-else class="is-muted">—</span>
          </td>
          <td class="is-num" data-cell-label="All-time">
            <MmRankCell v-if="s.totalPlayersAllTime" :value="s.totalPlayersAllTime" :max="allTimeMax" tone="neutral">{{ formatNumber(s.totalPlayersAllTime) }}</MmRankCell>
            <span v-else class="is-muted">—</span>
          </td>
          <td class="is-num is-muted" data-cell-label="Last seen" :title="s.lastActivity ? formatLocalTooltip(s.lastActivity) : ''">{{ formatRelative(s.lastActivity) }}</td>
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
.mm-servers__map {
  display: inline-block;
  margin-left: 8px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
}

.mm-servers__region {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-size: 12px;
  color: var(--mm-ink-soft);
}

.mm-servers__flag { font-size: 13px; }

:deep(.mm-servers__mark) {
  background: var(--mm-highlight);
  color: var(--mm-ink);
  padding: 0 2px;
  border-radius: 1px;
}
</style>
