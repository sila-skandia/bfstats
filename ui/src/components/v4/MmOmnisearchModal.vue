<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { countryCodeToFlag, countryCodeToName } from '@/types/countryCodes'
import { decodePlayerName } from '@/utils/playerName'

interface PlayerResult {
  playerName: string
  totalPlayTimeMinutes: number
  lastSeen?: string
  isActive?: boolean
  currentServer?: {
    serverGuid: string
    serverName: string
    mapName?: string
  }
}

interface ServerResult {
  serverGuid: string
  serverName: string
  serverIp: string
  serverPort: number
  country?: string | null
  currentMap?: string | null
  hasActivePlayers?: boolean
  totalActivePlayersLast24h?: number
  numPlayers?: number
  maxPlayers?: number
}

interface NavShortcut {
  id: string
  title: string
  subtitle: string
  path: string
  badge: string
  badgeVariant: 'green' | 'amber' | 'purple' | 'olive' | 'cyan'
  iconVariant: 'green' | 'amber' | 'purple' | 'olive' | 'cyan'
  icon: 'server' | 'player' | 'compare' | 'dashboard' | 'stats'
  requiresAuth?: boolean
}

interface FlatResultItem {
  id: string
  type: 'player' | 'server' | 'nav'
  title: string
  subtitle: string
  subtitleHtml?: string
  badge?: string
  badgeVariant?: 'live' | 'active' | 'idle' | 'time' | 'green' | 'amber' | 'purple' | 'olive' | 'gold' | 'cyan' | 'muted'
  iconVariant?: 'player' | 'server' | 'green' | 'amber' | 'purple' | 'olive' | 'gold' | 'cyan'
  icon?: string
  flag?: string
  path: string
  raw?: any
}

interface Props {
  modelValue: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const router = useRouter()
const { isAuthenticated } = useAuth()
const query = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const listContainerEl = ref<HTMLElement | null>(null)

const players = ref<PlayerResult[]>([])
const servers = ref<ServerResult[]>([])
const loading = ref(false)
const selectedIndex = ref(0)
let searchTimer: number | undefined
let activeAbortController: any = null

const navShortcuts: NavShortcut[] = [
  {
    id: 'nav-servers',
    title: 'Live Servers',
    subtitle: 'Real-time server browser, map rotations & player counts',
    path: '/v4/servers/bf1942',
    badge: 'LIVE SERVERS',
    badgeVariant: 'green',
    iconVariant: 'green',
    icon: 'server',
  },
  {
    id: 'nav-players',
    title: 'Players Leaderboard',
    subtitle: 'Search all tracked player records, aliases & achievements',
    path: '/v4/players',
    badge: 'LEADERBOARDS',
    badgeVariant: 'amber',
    iconVariant: 'amber',
    icon: 'player',
  },
  {
    id: 'nav-compare',
    title: 'Compare Players',
    subtitle: 'Head-to-head combat breakdown and win rate comparison',
    path: '/v4/players/compare',
    badge: 'ANALYTICS',
    badgeVariant: 'purple',
    iconVariant: 'purple',
    icon: 'compare',
  },
  {
    id: 'nav-dashboard',
    title: 'Dashboard',
    subtitle: 'Your active squad, online buddies & favorite hosts',
    path: '/v4/dashboard',
    badge: 'MY PROFILE',
    badgeVariant: 'olive',
    iconVariant: 'olive',
    icon: 'dashboard',
    requiresAuth: true,
  },
  {
    id: 'nav-system',
    title: 'System Stats',
    subtitle: 'Database telemetry, total players & servers tracked',
    path: '/system-stats',
    badge: 'TELEMETRY',
    badgeVariant: 'cyan',
    iconVariant: 'cyan',
    icon: 'stats',
  },
]

const formatPlayTime = (minutes: number): string => {
  if (!minutes) return '0h'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h playtime`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h playtime`
}

const availableNavShortcuts = computed<NavShortcut[]>(() =>
  navShortcuts.filter(item => !item.requiresAuth || isAuthenticated.value),
)

const filteredNavItems = computed<NavShortcut[]>(() => {
  const q = query.value.trim().toLowerCase()
  const list = availableNavShortcuts.value
  if (!q) return list.slice(0, 4)
  return list.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.subtitle.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q)
  )
})

const flatResults = computed<FlatResultItem[]>(() => {
  const items: FlatResultItem[] = []

  // 1. Players
  for (const p of players.value) {
    let subtitle = formatPlayTime(p.totalPlayTimeMinutes)
    let subtitleHtml: string | undefined
    let badge: string = 'VETERAN'
    let badgeVariant: FlatResultItem['badgeVariant'] = 'time'

    if (p.currentServer) {
      subtitle = `In combat on ${decodePlayerName(p.currentServer.serverName)}`
      subtitleHtml = `In combat on <span class="mm-omni-highlight">${decodePlayerName(p.currentServer.serverName)}</span>`
      badge = 'IN COMBAT'
      badgeVariant = 'live'
    } else if (p.isActive) {
      badge = 'ACTIVE RECENTLY'
      badgeVariant = 'active'
    }

    items.push({
      id: `player-${p.playerName}`,
      type: 'player',
      title: decodePlayerName(p.playerName),
      subtitle,
      subtitleHtml,
      badge,
      badgeVariant,
      iconVariant: 'player',
      path: `/v4/players/${encodeURIComponent(p.playerName)}`,
      raw: p,
    })
  }

  // 2. Servers
  for (const s of servers.value) {
    const flag = s.country ? countryCodeToFlag(s.country) : ''
    const country = s.country ? (countryCodeToName[s.country.toUpperCase()] || s.country.toUpperCase()) : ''
    const mapInfo = s.currentMap ? `${s.currentMap} · ` : ''
    const subtitle = `${mapInfo}${s.serverIp}:${s.serverPort}${country ? ` (${country})` : ''}`
    const subtitleHtml = s.currentMap
      ? `<span class="mm-omni-highlight mm-omni-highlight--green">${s.currentMap}</span> · <span class="mm-omni-mono">${s.serverIp}:${s.serverPort}</span>`
      : `<span class="mm-omni-mono">${s.serverIp}:${s.serverPort}</span>`

    let badge = 'ONLINE'
    let badgeVariant: FlatResultItem['badgeVariant'] = 'active'

    if (s.hasActivePlayers) {
      badge = 'ACTIVE'
      badgeVariant = 'green'
    } else {
      badge = 'STANDBY'
      badgeVariant = 'idle'
    }

    items.push({
      id: `server-${s.serverGuid || s.serverName}`,
      type: 'server',
      title: decodePlayerName(s.serverName),
      subtitle,
      subtitleHtml,
      badge,
      badgeVariant,
      iconVariant: 'server',
      flag,
      path: `/v4/servers/detail/${encodeURIComponent(s.serverName)}`,
      raw: s,
    })
  }

  // 3. Navigation shortcuts
  for (const nav of filteredNavItems.value) {
    items.push({
      id: nav.id,
      type: 'nav',
      title: nav.title,
      subtitle: nav.subtitle,
      badge: nav.badge,
      badgeVariant: nav.badgeVariant,
      iconVariant: nav.iconVariant,
      icon: nav.icon,
      path: nav.path,
      raw: nav,
    })
  }

  return items
})

const executeSearch = async (searchTerm: string) => {
  const q = searchTerm.trim()
  if (!q) {
    players.value = []
    servers.value = []
    loading.value = false
    return
  }

  if (activeAbortController) {
    activeAbortController.abort()
  }
  activeAbortController = typeof window !== 'undefined' && window.AbortController ? new window.AbortController() : null
  const signal = activeAbortController?.signal

  loading.value = true

  try {
    const [playersRes, serversRes] = await Promise.allSettled([
      fetch(`/stats/Players/search?query=${encodeURIComponent(q)}&pageSize=5`, { signal })
        .then(r => r.ok ? r.json() : { items: [] })
        .then(d => d.items || []),
      fetch(`/stats/servers/search?query=${encodeURIComponent(q)}&game=bf1942&pageSize=5`, { signal })
        .then(r => r.ok ? r.json() : { items: [] })
        .then(d => d.items || []),
    ])

    if (!signal?.aborted) {
      players.value = playersRes.status === 'fulfilled' ? playersRes.value : []
      servers.value = serversRes.status === 'fulfilled' ? serversRes.value : []
      selectedIndex.value = 0
    }
  } catch {
    if (!signal?.aborted) {
      players.value = []
      servers.value = []
    }
  } finally {
    if (!signal?.aborted) {
      loading.value = false
    }
  }
}

const onQueryInput = () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void executeSearch(query.value)
  }, 160)
}

const close = () => {
  emit('update:modelValue', false)
  emit('close')
}

const navigateTo = (item: FlatResultItem) => {
  close()
  void router.push(item.path)
}

const selectCurrent = () => {
  const items = flatResults.value
  if (items.length > 0 && selectedIndex.value >= 0 && selectedIndex.value < items.length) {
    navigateTo(items[selectedIndex.value])
  } else if (query.value.trim()) {
    close()
    void router.push({ path: '/v4/players', query: { q: query.value.trim() } })
  }
}

const onKeydown = (e: KeyboardEvent) => {
  const items = flatResults.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (items.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % items.length
      scrollToSelected()
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (items.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + items.length) % items.length
      scrollToSelected()
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    selectCurrent()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

const scrollToSelected = () => {
  nextTick(() => {
    const el = listContainerEl.value?.querySelector('.is-selected') as HTMLElement | null
    if (el && listContainerEl.value) {
      const container = listContainerEl.value
      const elTop = el.offsetTop
      const elBottom = elTop + el.offsetHeight
      const containerTop = container.scrollTop
      const containerBottom = containerTop + container.offsetHeight

      if (elTop < containerTop) {
        container.scrollTop = elTop
      } else if (elBottom > containerBottom) {
        container.scrollTop = elBottom - container.offsetHeight
      }
    }
  })
}

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    query.value = ''
    players.value = []
    servers.value = []
    selectedIndex.value = 0
    nextTick(() => {
      inputEl.value?.focus()
    })
  } else {
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }
  }
})

const handleBackdropClick = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="mm-omni-backdrop"
      @click="handleBackdropClick"
      @keydown="onKeydown"
    >
      <div class="mm-omni-modal" role="dialog" aria-modal="true" aria-label="Command palette and search">
        <!-- Search Input Bar -->
        <div class="mm-omni-header">
          <svg
            class="mm-omni-header__icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>

          <input
            ref="inputEl"
            v-model="query"
            type="text"
            class="mm-omni-input"
            placeholder="Search players, live servers, maps, or pages…"
            aria-label="Search query"
            autocomplete="off"
            spellcheck="false"
            @input="onQueryInput"
          />

          <div class="mm-omni-header__actions">
            <span v-if="loading" class="mm-omni-spinner" aria-label="Loading results" />
            <button
              v-else-if="query"
              type="button"
              class="mm-omni-clear-btn"
              title="Clear search"
              aria-label="Clear query"
              @click="query = ''; onQueryInput(); inputEl?.focus()"
            >
              ×
            </button>
            <span class="mm-search__hint">ESC</span>
          </div>
        </div>

        <!-- Scrollable Results Container -->
        <div ref="listContainerEl" class="mm-omni-body">
          <!-- Empty Results State -->
          <div
            v-if="query.trim() && !loading && flatResults.length === 0"
            class="mm-omni-empty"
          >
            <p>No players, servers, or pages matching <span class="mm-omni-empty__query">"{{ query }}"</span></p>
            <span class="mm-omni-empty__hint">Press ↵ to search full player directory</span>
          </div>

          <!-- Categorized Results List -->
          <div v-else class="mm-omni-list">
            <!-- 1. PLAYERS SECTION -->
            <template v-if="players.length > 0">
              <div class="mm-omni-section-title mm-omni-section-title--players">
                <span>Players</span>
                <span class="mm-omni-section-count">{{ players.length }} found</span>
              </div>
              <div
                v-for="item in flatResults.filter(r => r.type === 'player')"
                :key="item.id"
                class="mm-omni-item"
                :class="{ 'is-selected': flatResults.indexOf(item) === selectedIndex }"
                @click="navigateTo(item)"
                @mouseenter="selectedIndex = flatResults.indexOf(item)"
              >
                <div class="mm-omni-item__icon-wrap mm-omni-item__icon-wrap--amber">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div class="mm-omni-item__content">
                  <div class="mm-omni-item__title-row">
                    <span class="mm-omni-item__title">{{ item.title }}</span>
                    <span
                      v-if="item.badge"
                      class="mm-omni-item__badge"
                      :class="`mm-omni-item__badge--${item.badgeVariant}`"
                    >
                      <span v-if="item.badgeVariant === 'live'" class="mm-omni-dot-pulse" />
                      {{ item.badge }}
                    </span>
                  </div>
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <span v-if="item.subtitleHtml" class="mm-omni-item__sub" v-html="item.subtitleHtml" />
                  <span v-else class="mm-omni-item__sub">{{ item.subtitle }}</span>
                </div>
                <span class="mm-omni-item__arrow" aria-hidden="true">↵</span>
              </div>
            </template>

            <!-- 2. SERVERS SECTION -->
            <template v-if="servers.length > 0">
              <div class="mm-omni-section-title mm-omni-section-title--servers">
                <span>Servers</span>
                <span class="mm-omni-section-count">{{ servers.length }} found</span>
              </div>
              <div
                v-for="item in flatResults.filter(r => r.type === 'server')"
                :key="item.id"
                class="mm-omni-item"
                :class="{ 'is-selected': flatResults.indexOf(item) === selectedIndex }"
                @click="navigateTo(item)"
                @mouseenter="selectedIndex = flatResults.indexOf(item)"
              >
                <div class="mm-omni-item__icon-wrap mm-omni-item__icon-wrap--green">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>
                </div>
                <div class="mm-omni-item__content">
                  <div class="mm-omni-item__title-row">
                    <span v-if="item.flag" class="mm-omni-flag">{{ item.flag }}</span>
                    <span class="mm-omni-item__title">{{ item.title }}</span>
                    <span
                      v-if="item.badge"
                      class="mm-omni-item__badge"
                      :class="`mm-omni-item__badge--${item.badgeVariant}`"
                    >
                      {{ item.badge }}
                    </span>
                  </div>
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <span v-if="item.subtitleHtml" class="mm-omni-item__sub" v-html="item.subtitleHtml" />
                  <span v-else class="mm-omni-item__sub">{{ item.subtitle }}</span>
                </div>
                <span class="mm-omni-item__arrow" aria-hidden="true">↵</span>
              </div>
            </template>

            <!-- 3. NAVIGATION SECTION -->
            <template v-if="filteredNavItems.length > 0">
              <div class="mm-omni-section-title mm-omni-section-title--nav">
                <span>{{ query.trim() ? 'Navigation Shortcuts' : 'Quick Navigation' }}</span>
              </div>
              <div
                v-for="item in flatResults.filter(r => r.type === 'nav')"
                :key="item.id"
                class="mm-omni-item"
                :class="{ 'is-selected': flatResults.indexOf(item) === selectedIndex }"
                @click="navigateTo(item)"
                @mouseenter="selectedIndex = flatResults.indexOf(item)"
              >
                <!-- Color-Coded Category Icons -->
                <div class="mm-omni-item__icon-wrap" :class="`mm-omni-item__icon-wrap--${item.iconVariant}`">
                  <!-- Live Servers -->
                  <svg v-if="item.icon === 'server'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>

                  <!-- Players -->
                  <svg v-else-if="item.icon === 'player'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>

                  <!-- Compare -->
                  <svg v-else-if="item.icon === 'compare'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>

                  <!-- Dashboard -->
                  <svg v-else-if="item.icon === 'dashboard'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>

                  <!-- System Stats -->
                  <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>

                <div class="mm-omni-item__content">
                  <div class="mm-omni-item__title-row">
                    <span class="mm-omni-item__title mm-omni-item__title--nav">{{ item.title }}</span>
                    <span
                      v-if="item.badge"
                      class="mm-omni-item__badge"
                      :class="`mm-omni-item__badge--${item.badgeVariant}`"
                    >
                      {{ item.badge }}
                    </span>
                  </div>
                  <span class="mm-omni-item__sub">{{ item.subtitle }}</span>
                </div>
                <span class="mm-omni-item__arrow" aria-hidden="true">↵</span>
              </div>
            </template>
          </div>
        </div>

        <!-- Footer Shortcuts Legend -->
        <div class="mm-omni-foot">
          <div class="mm-omni-foot__hints">
            <span class="mm-omni-foot__hint"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span class="mm-omni-foot__hint"><kbd>↵</kbd> Open</span>
            <span class="mm-omni-foot__hint"><kbd>Esc</kbd> Close</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mm-omni-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(10, 10, 10, 0.78);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 70px 16px 24px;
  animation: mm-omni-fade-in 0.15s ease-out;
}

@keyframes mm-omni-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.mm-omni-modal {
  width: 100%;
  max-width: 640px;
  background: #141414;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--mm-font-display);
}

.mm-omni-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #1a1a1a;
}

.mm-omni-header__icon {
  color: var(--mm-accent);
  flex-shrink: 0;
}

.mm-omni-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 14.5px;
  font-weight: 500;
  font-family: var(--mm-font-display);
  color: #ffffff;
  min-width: 0;
}

.mm-omni-input::placeholder {
  color: #737373;
}

.mm-omni-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mm-omni-clear-btn {
  background: transparent;
  border: 0;
  color: #888888;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.mm-omni-clear-btn:hover {
  color: #ffffff;
}

.mm-omni-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--mm-accent);
  border-radius: 50%;
  animation: mm-spin 0.6s linear infinite;
}

@keyframes mm-spin {
  to { transform: rotate(360deg); }
}

.mm-omni-body {
  max-height: 400px;
  overflow-y: auto;
  padding: 8px 0;
}

.mm-omni-empty {
  padding: 40px 20px;
  text-align: center;
  color: #a3a3a3;
}

.mm-omni-empty p {
  font-size: 14px;
  margin: 0 0 8px;
  color: #e5e5e5;
}

.mm-omni-empty__query {
  color: var(--mm-accent);
  font-weight: 600;
}

.mm-omni-empty__hint {
  font-size: 11.5px;
  color: #737373;
  font-family: var(--mm-font-mono);
  letter-spacing: 0.04em;
}

/* Categorized section headers */
.mm-omni-section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.mm-omni-section-title--players {
  color: #d4a359;
}

.mm-omni-section-title--servers {
  color: #7da34c;
}

.mm-omni-section-title--nav {
  color: #7ea3c8;
}

.mm-omni-section-count {
  font-size: 9.5px;
  opacity: 0.8;
  letter-spacing: 0.05em;
}

/* Item row */
.mm-omni-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  cursor: pointer;
  transition: background 0.12s ease, border-left-color 0.12s ease;
  user-select: none;
  border-left: 3px solid transparent;
}

.mm-omni-item:hover,
.mm-omni-item.is-selected {
  background: #202020;
  border-left-color: var(--mm-accent);
}

.mm-omni-item.is-selected .mm-omni-item__title {
  color: #ffffff;
}

.mm-omni-item.is-selected .mm-omni-item__arrow {
  opacity: 1;
  transform: translateX(0);
}

/* Category Icon Boxes */
.mm-omni-item__icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.mm-omni-item__icon-wrap--player,
.mm-omni-item__icon-wrap--amber {
  background: rgba(212, 163, 89, 0.14);
  border-color: rgba(212, 163, 89, 0.3);
  color: #e5b369;
}

.mm-omni-item__icon-wrap--server,
.mm-omni-item__icon-wrap--green {
  background: rgba(125, 163, 76, 0.14);
  border-color: rgba(125, 163, 76, 0.3);
  color: #8db55c;
}

.mm-omni-item__icon-wrap--purple {
  background: rgba(142, 151, 198, 0.14);
  border-color: rgba(142, 151, 198, 0.3);
  color: #a3abdc;
}

.mm-omni-item__icon-wrap--olive {
  background: rgba(139, 153, 82, 0.16);
  border-color: rgba(139, 153, 82, 0.35);
  color: #a6b567;
}

.mm-omni-item__icon-wrap--gold {
  background: rgba(229, 169, 60, 0.14);
  border-color: rgba(229, 169, 60, 0.3);
  color: #f0b74b;
}

.mm-omni-item__icon-wrap--cyan {
  background: rgba(91, 184, 186, 0.14);
  border-color: rgba(91, 184, 186, 0.3);
  color: #6ec7c9;
}

/* Content block */
.mm-omni-item__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mm-omni-item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-omni-flag {
  font-size: 13px;
  line-height: 1;
}

.mm-omni-item__title {
  font-size: 13.5px;
  font-weight: 600;
  color: #eeeeee;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-omni-item__title--nav {
  color: #f5f5f5;
}

.mm-omni-item__sub {
  font-size: 11.5px;
  color: #999999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

:deep(.mm-omni-highlight) {
  color: #c5d47e;
  font-weight: 500;
}

:deep(.mm-omni-highlight--green) {
  color: #8db55c;
  font-weight: 500;
}

:deep(.mm-omni-mono) {
  font-family: var(--mm-font-mono);
  color: #888888;
  font-size: 11px;
}

/* Colored Micro-Badges */
.mm-omni-item__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  flex-shrink: 0;
  line-height: 1;
}

.mm-omni-item__badge--live {
  background: rgba(220, 53, 69, 0.2);
  color: #ff6b6b;
  border: 1px solid rgba(220, 53, 69, 0.4);
}

.mm-omni-dot-pulse {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ff4d4d;
  box-shadow: 0 0 6px #ff4d4d;
  animation: mm-pulse 1.4s infinite;
}

@keyframes mm-pulse {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}

.mm-omni-item__badge--active {
  background: rgba(125, 163, 76, 0.18);
  color: #8db55c;
  border: 1px solid rgba(125, 163, 76, 0.35);
}

.mm-omni-item__badge--green {
  background: rgba(125, 163, 76, 0.18);
  color: #8db55c;
  border: 1px solid rgba(125, 163, 76, 0.35);
}

.mm-omni-item__badge--amber {
  background: rgba(212, 163, 89, 0.18);
  color: #e5b369;
  border: 1px solid rgba(212, 163, 89, 0.35);
}

.mm-omni-item__badge--purple {
  background: rgba(142, 151, 198, 0.18);
  color: #a3abdc;
  border: 1px solid rgba(142, 151, 198, 0.35);
}

.mm-omni-item__badge--olive {
  background: rgba(139, 153, 82, 0.2);
  color: #a6b567;
  border: 1px solid rgba(139, 153, 82, 0.4);
}

.mm-omni-item__badge--gold {
  background: rgba(229, 169, 60, 0.18);
  color: #f0b74b;
  border: 1px solid rgba(229, 169, 60, 0.35);
}

.mm-omni-item__badge--cyan {
  background: rgba(91, 184, 186, 0.18);
  color: #6ec7c9;
  border: 1px solid rgba(91, 184, 186, 0.35);
}

.mm-omni-item__badge--idle {
  background: rgba(255, 255, 255, 0.05);
  color: #737373;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.mm-omni-item__badge--time {
  background: rgba(255, 255, 255, 0.06);
  color: #a3a3a3;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Arrow */
.mm-omni-item__arrow {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--mm-accent);
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.12s ease, transform 0.12s ease;
  flex-shrink: 0;
}

.mm-omni-foot {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: 9px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: #171717;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: #737373;
}

.mm-omni-foot__hints {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mm-omni-foot__hint kbd {
  background: #222222;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 9.5px;
  color: #d4d4d4;
  margin-right: 4px;
}

@media (max-width: 720px) {
  .mm-omni-backdrop {
    padding: 16px 8px 16px;
    align-items: flex-start;
  }

  .mm-omni-modal {
    max-height: 90vh;
  }

  .mm-omni-body {
    max-height: calc(90vh - 120px);
  }

  .mm-omni-foot__hints {
    display: none;
  }
}
</style>
