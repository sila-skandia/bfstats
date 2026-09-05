<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import 'primeicons/primeicons.css'
import MmHigherLowerGame from '@/components/v4/arcade/MmHigherLowerGame.vue'
import MmMysterySoldierGame from '@/components/v4/arcade/MmMysterySoldierGame.vue'
import MmFieldTriviaGame from '@/components/v4/arcade/MmFieldTriviaGame.vue'
import { fetchArcadeServers, type ArcadeServer } from '@/services/arcadeService'
import { decodeServerName } from '@/utils/playerName'

const ORBIT_STORAGE_KEY = 'bfstats:arcade-orbit-player'
const SERVER_STORAGE_KEY = 'bfstats:arcade-server-guid'

type ArcadeTab = 'higher-lower' | 'mystery' | 'trivia'

const route = useRoute()
const router = useRouter()

const validTabs: ArcadeTab[] = ['higher-lower', 'mystery', 'trivia']

const initialTab = (): ArcadeTab => {
  const queryTab = route.query.game as string
  if (queryTab && validTabs.includes(queryTab as ArcadeTab)) {
    return queryTab as ArcadeTab
  }
  return 'higher-lower'
}

const readStoredServerGuid = (): string => {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(SERVER_STORAGE_KEY)?.trim() || ''
}

const initialServerGuid = (): string => {
  const fromQuery = typeof route.query.server === 'string' ? route.query.server.trim() : ''
  if (fromQuery) return fromQuery
  return readStoredServerGuid()
}

const activeTab = ref<ArcadeTab>(initialTab())
const servers = ref<ArcadeServer[]>([])
const serversLoading = ref(false)
const selectedServerGuid = ref<string>(initialServerGuid())
const isPickerOpen = ref(false)
const serverSearchQuery = ref('')
const serverSearchInputRef = ref<HTMLInputElement | null>(null)

const initialOrbitPlayer = (): string => {
  const fromQuery = typeof route.query.player === 'string' ? route.query.player.trim() : ''
  if (fromQuery) return fromQuery
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(ORBIT_STORAGE_KEY)?.trim() || ''
}

const orbitPlayer = ref(initialOrbitPlayer())
const orbitQuery = ref('')
const orbitResults = ref<{ playerName: string; isActive: boolean }[]>([])
const orbitLoading = ref(false)
const isOrbitOpen = ref(false)
const orbitInputRef = ref<HTMLInputElement | null>(null)
let orbitDebounce: ReturnType<typeof setTimeout> | null = null

const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
let narrowMql: MediaQueryList | null = null
const onNarrowChange = (e: MediaQueryListEvent) => {
  isNarrow.value = e.matches
}

const tabs = [
  { id: 'higher-lower' as ArcadeTab, label: 'Higher or Lower' },
  { id: 'mystery' as ArcadeTab, label: 'Mystery Soldier' },
  { id: 'trivia' as ArcadeTab, label: 'Field Lore' },
]

const selectedServer = computed(() => {
  if (!selectedServerGuid.value) return null
  return servers.value.find(s => s.guid === selectedServerGuid.value) ?? null
})

const hasServer = computed(() => Boolean(selectedServerGuid.value))

// Top servers sorted by total play time (falling back to candidate pool count)
const topServersByPlayTime = computed(() => {
  return servers.value
    .filter(s => (s.totalCandidates || 0) >= 8 || (s.currentPlayers || 0) > 0)
    .slice()
    .sort((a, b) => {
      const aHours = a.totalPlayTimeHours || 0
      const bHours = b.totalPlayTimeHours || 0
      if (bHours !== aHours) return bHours - aHours
      return b.totalCandidates - a.totalCandidates
    })
    .slice(0, 4)
})

const filteredServers = computed(() => {
  const q = serverSearchQuery.value.trim().toLowerCase()
  if (!q) {
    return servers.value
      .slice()
      .sort((a, b) => {
        const aHours = a.totalPlayTimeHours || 0
        const bHours = b.totalPlayTimeHours || 0
        if (bHours !== aHours) return bHours - aHours
        return b.totalCandidates - a.totalCandidates
      })
  }
  return servers.value
    .filter(s =>
      s.name.toLowerCase().includes(q) ||
      decodeServerName(s.name).toLowerCase().includes(q) ||
      (s.country || '').toLowerCase().includes(q)
    )
    .sort((a, b) => {
      const aHours = a.totalPlayTimeHours || 0
      const bHours = b.totalPlayTimeHours || 0
      if (bHours !== aHours) return bHours - aHours
      return b.totalCandidates - a.totalCandidates
    })
})

const formatHours = (hours?: number) => {
  if (!hours || hours <= 0) return ''
  if (hours >= 1000) {
    return `${(hours / 1000).toFixed(1)}k hrs`
  }
  return `${Math.round(hours)} hrs`
}

const setTab = (tab: ArcadeTab) => {
  activeTab.value = tab
  router.replace({
    query: {
      ...route.query,
      game: tab === 'higher-lower' ? undefined : tab,
    },
  })
}

const persistServerGuid = (guid: string) => {
  if (typeof window !== 'undefined') {
    if (guid) {
      window.localStorage.setItem(SERVER_STORAGE_KEY, guid)
    } else {
      window.localStorage.removeItem(SERVER_STORAGE_KEY)
    }
  }
  router.replace({
    query: {
      ...route.query,
      server: guid || undefined,
    },
  })
}

const setServer = (guid: string) => {
  const next = guid.trim()
  if (!next) return
  selectedServerGuid.value = next
  isPickerOpen.value = false
  serverSearchQuery.value = ''
  persistServerGuid(next)
}

const syncServerToUrl = (guid: string) => {
  if (!guid) return
  selectedServerGuid.value = guid
  persistServerGuid(guid)
}

const persistOrbitQuery = (name: string) => {
  router.replace({
    query: {
      ...route.query,
      player: name || undefined,
    },
  })
}

const setOrbitPlayer = (name: string) => {
  const trimmed = name.trim()
  orbitPlayer.value = trimmed
  isOrbitOpen.value = false
  orbitQuery.value = ''
  orbitResults.value = []
  if (typeof window !== 'undefined') {
    if (trimmed) {
      window.localStorage.setItem(ORBIT_STORAGE_KEY, trimmed)
    } else {
      window.localStorage.removeItem(ORBIT_STORAGE_KEY)
    }
  }
  persistOrbitQuery(trimmed)
}

const searchOrbitPlayers = async (query: string) => {
  const q = query.trim()
  if (q.length < 2) {
    orbitResults.value = []
    return
  }

  orbitLoading.value = true
  try {
    const response = await fetch(`/stats/Players/search?query=${encodeURIComponent(q)}&pageSize=8`)
    if (!response.ok) throw new Error('Failed to search players')
    const data = await response.json() as { items?: { playerName: string; isActive: boolean }[] }
    orbitResults.value = data.items ?? []
  } catch {
    orbitResults.value = []
  } finally {
    orbitLoading.value = false
  }
}

const onOrbitInput = (value: string) => {
  orbitQuery.value = value
  if (orbitDebounce) clearTimeout(orbitDebounce)
  orbitDebounce = setTimeout(() => {
    void searchOrbitPlayers(value)
  }, 300)
}

const toggleOrbitPicker = () => {
  isOrbitOpen.value = !isOrbitOpen.value
  isPickerOpen.value = false
  if (isOrbitOpen.value) {
    orbitQuery.value = ''
    orbitResults.value = []
    nextTick(() => {
      orbitInputRef.value?.focus()
    })
  }
}

const closeOrbitPicker = () => {
  isOrbitOpen.value = false
}

const openPicker = () => {
  isPickerOpen.value = true
  isOrbitOpen.value = false
  serverSearchQuery.value = ''
  nextTick(() => {
    serverSearchInputRef.value?.focus()
  })
}

const togglePicker = () => {
  if (isPickerOpen.value) {
    closePicker()
    return
  }
  openPicker()
}

const closePicker = () => {
  isPickerOpen.value = false
}

const onDocClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (!target?.closest('[data-server-picker]')) {
    isPickerOpen.value = false
  }
  if (!target?.closest('[data-orbit-picker]')) {
    isOrbitOpen.value = false
  }
}

watch(
  () => route.query.game,
  (newGame) => {
    if (newGame && validTabs.includes(newGame as ArcadeTab)) {
      activeTab.value = newGame as ArcadeTab
    } else if (!newGame) {
      activeTab.value = 'higher-lower'
    }
  }
)

watch(
  () => route.query.server,
  (newServer) => {
    const guid = typeof newServer === 'string' ? newServer.trim() : ''
    if (!guid) {
      if (selectedServerGuid.value) {
        persistServerGuid(selectedServerGuid.value)
      }
      return
    }
    if (guid === selectedServerGuid.value) return
    selectedServerGuid.value = guid
    persistServerGuid(guid)
  }
)

watch(
  () => route.query.player,
  (newPlayer) => {
    const name = typeof newPlayer === 'string' ? newPlayer.trim() : ''
    if (name !== orbitPlayer.value) {
      orbitPlayer.value = name
    }
  }
)

watch([isPickerOpen, isOrbitOpen, isNarrow], () => {
  if ((isPickerOpen.value || isOrbitOpen.value) && isNarrow.value) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(async () => {
  if (typeof window !== 'undefined') {
    narrowMql = window.matchMedia('(max-width: 720px)')
    narrowMql.addEventListener('change', onNarrowChange)
  }
  document.addEventListener('click', onDocClick)
  if (orbitPlayer.value && route.query.player !== orbitPlayer.value) {
    persistOrbitQuery(orbitPlayer.value)
  }
  serversLoading.value = true
  try {
    servers.value = await fetchArcadeServers()
    if (selectedServerGuid.value && route.query.server !== selectedServerGuid.value) {
      syncServerToUrl(selectedServerGuid.value)
    }
  } finally {
    serversLoading.value = false
  }
})

onUnmounted(() => {
  narrowMql?.removeEventListener('change', onNarrowChange)
  document.removeEventListener('click', onDocClick)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="mm-container mm-section">
    <!-- Meta row -->
    <div
      class="mm-meta-row"
      style="margin-bottom: 12px"
    >
      <span class="mm-chip"><span class="mm-chip__dot" />Trivia</span>
      <span class="mm-meta-row__sep">·</span>
      <span v-if="selectedServer">{{ $pn(selectedServer.name) }}</span>
      <span v-else-if="hasServer">Your server</span>
      <span v-else>Pick a server to begin</span>
      <template v-if="orbitPlayer">
        <span class="mm-meta-row__sep">·</span>
        <span>Playing as {{ $pn(orbitPlayer) }}</span>
      </template>
    </div>

    <!-- Header & Prompt -->
    <h1
      class="mm-display"
      style="margin-bottom: 8px"
    >
      Trivia
    </h1>
    <p class="mm-arcade-prompt">
      Three games about real Battlefield 1942 stats. Pick the server you play on, then choose a game. Add your soldier name if you want questions about people you actually play with.
    </p>

    <!-- Prominent Server Selector Card -->
    <div class="arcade-server-picker-card">
      <div class="arcade-picker-row">
        <!-- Main Selector Trigger -->
        <div
          class="arcade-picker-field"
          data-server-picker
        >
          <label class="arcade-picker-label">Server</label>
          <div class="arcade-picker-dropdown-wrap">
            <button
              type="button"
              class="arcade-picker-btn"
              :class="{
                'arcade-picker-btn--active': hasServer,
                'arcade-picker-btn--required': !hasServer,
                'arcade-picker-btn--open': isPickerOpen
              }"
              data-testid="arcade-server-trigger"
              aria-haspopup="listbox"
              :aria-expanded="isPickerOpen"
              aria-required="true"
              @click="togglePicker"
            >
              <i
                class="pi pi-server arcade-picker-icon"
              />
              <template v-if="selectedServer">
                <span class="mm-country-badge">{{ selectedServer.country || 'UN' }}</span>
                <span class="arcade-picker-text">{{ $pn(selectedServer.name) }}</span>
                <span
                  v-if="selectedServer.currentPlayers > 0"
                  class="arcade-picker-live"
                >
                  {{ selectedServer.currentPlayers }} live
                </span>
              </template>
              <template v-else-if="hasServer">
                <span class="arcade-picker-text">Selected server</span>
              </template>
              <template v-else>
                <span class="arcade-picker-placeholder">The server you play on</span>
                <span class="arcade-picker-scope">start here</span>
              </template>
              <i class="pi pi-chevron-down arcade-picker-chevron" />
            </button>

            <!-- Search Popover / Sheet -->
            <Teleport
              to="body"
              :disabled="!isNarrow"
            >
              <div
                v-if="isPickerOpen"
                class="mm arcade-popover"
                :class="{ 'arcade-popover--sheet': isNarrow }"
                data-server-picker
                role="listbox"
                aria-label="Select a server"
              >
                <!-- Sheet Header (mobile only) -->
                <div class="arcade-sheet-head">
                  <div>
                    <div class="mm-eyebrow">
                      YOUR SERVER
                    </div>
                    <h2 class="arcade-sheet-title">
                      Where do you play?
                    </h2>
                  </div>
                  <button
                    type="button"
                    class="arcade-sheet-close"
                    aria-label="Close"
                    @click="closePicker"
                  >
                    Done
                  </button>
                </div>

                <!-- Search Input -->
                <div class="arcade-search-box">
                  <i class="pi pi-search arcade-search-icon" />
                  <input
                    ref="serverSearchInputRef"
                    v-model="serverSearchQuery"
                    type="text"
                    placeholder="Search server name..."
                    class="arcade-search-input"
                  >
                  <button
                    v-if="serverSearchQuery"
                    type="button"
                    class="arcade-search-clear"
                    title="Clear search"
                    @click="serverSearchQuery = ''"
                  >
                    <i class="pi pi-times" />
                  </button>
                </div>

                <!-- Single-select Server Option List -->
                <div class="arcade-server-list">
                  <div
                    v-if="serversLoading"
                    class="arcade-server-empty"
                  >
                    Loading servers…
                  </div>
                  <button
                    v-for="s in filteredServers"
                    :key="s.guid"
                    type="button"
                    class="arcade-server-option"
                    :class="{ 'arcade-server-option--selected': selectedServerGuid === s.guid }"
                    role="option"
                    data-testid="arcade-server-option"
                    :aria-selected="selectedServerGuid === s.guid"
                    @click="setServer(s.guid)"
                  >
                    <span class="mm-country-badge">{{ s.country || 'UN' }}</span>
                    <div class="arcade-option-body">
                      <span class="arcade-option-title">{{ $pn(s.name) }}</span>
                      <span class="arcade-option-sub">
                        <template v-if="s.totalPlayTimeHours">{{ formatHours(s.totalPlayTimeHours) }} played</template>
                        <template v-else-if="s.totalCandidates">{{ s.totalCandidates }} regulars</template>
                        <template v-if="s.currentPlayers > 0"> · {{ s.currentPlayers }} online</template>
                      </span>
                    </div>
                    <span
                      v-if="s.currentPlayers > 0"
                      class="arcade-live-pill"
                    >{{ s.currentPlayers }} live</span>
                    <i
                      v-if="selectedServerGuid === s.guid"
                      class="pi pi-check arcade-option-check"
                    />
                  </button>

                  <div
                    v-if="filteredServers.length === 0 && !serversLoading"
                    class="arcade-server-empty"
                  >
                    {{ serverSearchQuery ? `No servers matching "${serverSearchQuery}"` : 'No servers available.' }}
                  </div>
                </div>
              </div>
            </Teleport>
          </div>
        </div>

        <div
          class="arcade-picker-field"
          data-orbit-picker
          data-testid="arcade-orbit-picker"
        >
          <label class="arcade-picker-label">You</label>
          <div class="arcade-picker-dropdown-wrap">
            <button
              type="button"
              class="arcade-picker-btn"
              :class="{
                'arcade-picker-btn--active': Boolean(orbitPlayer),
                'arcade-picker-btn--open': isOrbitOpen
              }"
              aria-haspopup="listbox"
              :aria-expanded="isOrbitOpen"
              aria-label="Add your soldier name so questions include people you play with"
              @click="toggleOrbitPicker"
            >
              <i class="pi pi-user arcade-picker-icon" />
              <template v-if="orbitPlayer">
                <span class="arcade-picker-text">{{ $pn(orbitPlayer) }}</span>
              </template>
              <template v-else>
                <span class="arcade-picker-placeholder">Your soldier name</span>
                <span class="arcade-picker-scope">optional</span>
              </template>
              <i class="pi pi-chevron-down arcade-picker-chevron" />
            </button>

            <button
              v-if="orbitPlayer"
              type="button"
              class="arcade-picker-clear-btn"
              title="Remove your name"
              aria-label="Remove your name"
              @click.stop="setOrbitPlayer('')"
            >
              <span aria-hidden="true">×</span>
            </button>

            <Teleport
              to="body"
              :disabled="!isNarrow"
            >
              <div
                v-if="isOrbitOpen"
                class="mm arcade-popover"
                :class="{ 'arcade-popover--sheet': isNarrow }"
                role="listbox"
                aria-label="Add your soldier name"
              >
                <div class="arcade-sheet-head">
                  <div>
                    <div class="mm-eyebrow">
                      YOUR NAME
                    </div>
                    <h2 class="arcade-sheet-title">
                      Find your soldier
                    </h2>
                  </div>
                  <button
                    type="button"
                    class="arcade-sheet-close"
                    aria-label="Close"
                    @click="closeOrbitPicker"
                  >
                    Done
                  </button>
                </div>

                <div class="arcade-search-box">
                  <i class="pi pi-search arcade-search-icon" />
                  <input
                    ref="orbitInputRef"
                    :value="orbitQuery"
                    type="text"
                    placeholder="Search your soldier name..."
                    class="arcade-search-input"
                    @input="onOrbitInput(($event.target as HTMLInputElement).value)"
                  >
                  <button
                    v-if="orbitQuery"
                    type="button"
                    class="arcade-search-clear"
                    title="Clear search"
                    @click="onOrbitInput('')"
                  >
                    <i class="pi pi-times" />
                  </button>
                </div>

                <div class="arcade-server-list">
                  <button
                    v-for="player in orbitResults"
                    :key="player.playerName"
                    type="button"
                    class="arcade-server-option"
                    :class="{ 'arcade-server-option--selected': orbitPlayer === player.playerName }"
                    role="option"
                    :aria-selected="orbitPlayer === player.playerName"
                    @click="setOrbitPlayer(player.playerName)"
                  >
                    <i class="pi pi-user arcade-option-icon" />
                    <div class="arcade-option-body">
                      <span class="arcade-option-title">{{ $pn(player.playerName) }}</span>
                      <span class="arcade-option-sub">
                        {{ player.isActive ? 'Online now' : 'Questions will include people you play with' }}
                      </span>
                    </div>
                    <i
                      v-if="orbitPlayer === player.playerName"
                      class="pi pi-check arcade-option-check"
                    />
                  </button>

                  <div
                    v-if="orbitLoading"
                    class="arcade-server-empty"
                  >
                    Searching…
                  </div>
                  <div
                    v-else-if="orbitQuery.trim().length >= 2 && orbitResults.length === 0"
                    class="arcade-server-empty"
                  >
                    No soldiers matching "{{ orbitQuery }}"
                  </div>
                  <div
                    v-else-if="orbitQuery.trim().length < 2"
                    class="arcade-server-empty"
                  >
                    Type at least two characters to find your name.
                  </div>
                </div>
              </div>
            </Teleport>
          </div>
        </div>

        <!-- Quick Defaults: Most Play Time -->
        <div
          v-if="topServersByPlayTime.length > 0"
          class="arcade-quick-defaults"
        >
          <span class="arcade-quick-label">Popular:</span>
          <div class="arcade-quick-pills">
            <button
              v-for="s in topServersByPlayTime"
              :key="s.guid"
              type="button"
              class="arcade-quick-btn"
              :class="{ 'arcade-quick-btn--active': selectedServerGuid === s.guid }"
              data-testid="arcade-quick-server"
              :title="`Play on ${$pn(s.name)}`"
              @click="setServer(s.guid)"
            >
              <span class="mm-country-badge">{{ s.country || 'UN' }}</span>
              <span class="arcade-quick-name">{{ $pn(s.name) }}</span>
              <span
                v-if="s.totalPlayTimeHours"
                class="arcade-quick-meta"
              >
                {{ formatHours(s.totalPlayTimeHours) }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Mode Tabs: Site-standard .mm-tabs -->
    <nav
      class="mm-tabs"
      aria-label="Trivia games"
      style="margin-top: 24px; margin-bottom: 28px"
    >
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="mm-tab"
        :class="{ 'mm-tab--active': activeTab === t.id }"
        @click="setTab(t.id)"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- Active Game Arena -->
    <main class="mm-arcade-container">
      <div
        v-if="!hasServer"
        class="arcade-server-gate"
        data-testid="arcade-server-gate"
      >
        <div class="mm-eyebrow">
          Before you play
        </div>
        <h2 class="arcade-server-gate__title">
          Pick your server
        </h2>
        <p class="arcade-server-gate__copy">
          Start with the community you play on. Then choose a game below, or tap a popular server above.
        </p>
        <button
          type="button"
          class="mm-cta-strip arcade-server-gate__cta"
          data-testid="arcade-choose-server"
          @click.stop="openPicker"
        >
          Choose server
        </button>
      </div>
      <MmHigherLowerGame
        v-else-if="activeTab === 'higher-lower'"
        :server-guid="selectedServerGuid"
        :server-name="selectedServer ? selectedServer.name : undefined"
        :orbit-player="orbitPlayer || undefined"
      />
      <MmMysterySoldierGame
        v-else-if="activeTab === 'mystery'"
        :server-guid="selectedServerGuid"
        :server-name="selectedServer ? selectedServer.name : undefined"
        :orbit-player="orbitPlayer || undefined"
      />
      <MmFieldTriviaGame
        v-else-if="activeTab === 'trivia'"
        :server-guid="selectedServerGuid"
        :server-name="selectedServer ? selectedServer.name : undefined"
        :orbit-player="orbitPlayer || undefined"
      />
    </main>
  </div>
</template>

<style scoped>
.mm-arcade-prompt {
  margin: 0 0 16px;
  font-family: var(--mm-font-display, sans-serif);
  font-size: 14px;
  color: var(--mm-ink-muted, #8a8a8a);
  line-height: 1.5;
}

/* Prominent Server Selector Card */
.arcade-server-picker-card {
  width: 100%;
  box-sizing: border-box;
  background: var(--mm-bg-soft, #161616);
  border: 1px solid var(--mm-rule, #282828);
  border-radius: 2px;
  padding: 12px 16px;
}

.arcade-picker-row {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.arcade-picker-field {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 1 auto;
}

.arcade-picker-label {
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted, #8a8a8a);
  white-space: nowrap;
}

.arcade-picker-dropdown-wrap {
  position: relative;
  display: flex;
  align-items: stretch;
  min-width: 260px;
  max-width: 380px;
}

.arcade-picker-btn {
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 12px;
  background: var(--mm-bg-mute, #1e1e1e);
  color: var(--mm-ink, #ffffff);
  border: 1px solid var(--mm-rule, #2d2d2d);
  border-radius: 2px;
  padding: 8px 32px 8px 12px;
  cursor: pointer;
  outline: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.12s ease;
  flex: 1;
  min-width: 0;
  text-align: left;
  position: relative;
}

.arcade-picker-btn:hover {
  border-color: var(--mm-accent, #7d8849);
}

.arcade-picker-btn--active {
  border-color: var(--mm-accent, #7d8849);
  background: var(--mm-bg, #131313);
}

.arcade-picker-btn--required {
  border-color: var(--mm-accent, #7d8849);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mm-accent, #7d8849) 35%, transparent);
}

.arcade-picker-btn--open {
  border-color: var(--mm-accent, #7d8849);
  box-shadow: 0 0 0 1px var(--mm-accent, #7d8849);
}

.arcade-picker-icon {
  font-size: 12px;
  color: var(--mm-ink-muted, #8a8a8a);
  flex-shrink: 0;
}

.arcade-picker-placeholder {
  color: var(--mm-ink-soft, #b0b0b0);
  font-weight: 500;
  font-size: 12px;
}

.arcade-picker-scope {
  font-size: 10.5px;
  color: var(--mm-ink-muted, #707070);
}

.arcade-picker-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-family: var(--mm-font-display, sans-serif);
  font-size: 13px;
}

.arcade-picker-live {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-success, #68b855);
  margin-left: auto;
  flex-shrink: 0;
}

.arcade-picker-chevron {
  position: absolute;
  right: 10px;
  font-size: 9px;
  color: var(--mm-ink-muted, #8a8a8a);
  pointer-events: none;
}

.arcade-picker-clear-btn {
  flex-shrink: 0;
  width: 32px;
  border: 1px solid var(--mm-rule, #2d2d2d);
  border-left: 0;
  border-radius: 0 2px 2px 0;
  background: var(--mm-bg-mute, #1e1e1e);
  color: var(--mm-ink, #ffffff);
  cursor: pointer;
  padding: 0;
  font-family: var(--mm-font-display, sans-serif);
  font-size: 18px;
  font-weight: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.arcade-picker-btn:has(+ .arcade-picker-clear-btn) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.arcade-picker-clear-btn:hover {
  color: var(--mm-accent, #7d8849);
}

/* Quick Defaults / Popular */
.arcade-quick-defaults {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.arcade-quick-label {
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted, #8a8a8a);
  flex-shrink: 0;
}

.arcade-quick-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.arcade-quick-btn {
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule, #2d2d2d);
  background: var(--mm-bg-mute, #1e1e1e);
  color: var(--mm-ink-soft, #c0c0c0);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.arcade-quick-btn:hover {
  border-color: var(--mm-accent-soft, #5d6637);
  color: var(--mm-ink, #ffffff);
}

.arcade-quick-btn--active {
  border-color: var(--mm-accent, #7d8849);
  background: var(--mm-bg, #131313);
  color: var(--mm-ink, #ffffff);
  box-shadow: inset 0 0 0 1px var(--mm-accent, #7d8849);
}

.arcade-quick-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arcade-quick-meta {
  font-size: 9.5px;
  color: var(--mm-ink-muted, #777);
}

/* Popover & Sheet */
.arcade-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 50;
  background: var(--mm-bg-soft, #181818);
  border: 1px solid var(--mm-rule-strong, #383838);
  border-radius: 2px;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.65);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.arcade-sheet-head {
  display: none;
}

.arcade-sheet-title {
  margin: 4px 0 0;
  font-family: var(--mm-font-display, sans-serif);
  font-size: 26px;
  font-weight: 500;
  color: var(--mm-ink, #ffffff);
  line-height: 1.1;
}

.arcade-sheet-close {
  flex-shrink: 0;
  min-height: 44px;
  min-width: 44px;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--mm-rule, #333333);
  border-radius: 2px;
  color: var(--mm-ink, #ffffff);
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.arcade-sheet-close:hover {
  border-color: var(--mm-accent, #7d8849);
  color: var(--mm-accent, #7d8849);
}

/* Mobile Sheet Viewport */
.arcade-popover--sheet {
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
  background: var(--mm-bg, #111111);
  gap: 12px;
  overflow: hidden;
}

.arcade-popover--sheet .arcade-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  padding-top: max(16px, env(safe-area-inset-top));
  border-bottom: 1px solid var(--mm-rule, #282828);
}

.arcade-popover--sheet .arcade-search-box {
  margin-left: 16px;
  margin-right: 16px;
  width: auto;
}

.arcade-popover--sheet .arcade-search-input {
  min-height: 44px;
  font-size: 15px;
  padding: 10px 36px 10px 32px;
}

.arcade-popover--sheet .arcade-server-list {
  flex: 1;
  max-height: none;
  min-height: 0;
  padding: 0 12px 16px;
}

.arcade-popover--sheet .arcade-server-option {
  min-height: 52px;
  padding: 10px 12px;
}

/* Search Box inside popover */
.arcade-search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.arcade-search-icon {
  position: absolute;
  left: 9px;
  font-size: 11px;
  color: var(--mm-ink-muted, #8a8a8a);
  pointer-events: none;
}

.arcade-search-input {
  width: 100%;
  padding: 7px 24px 7px 28px;
  background: var(--mm-bg-mute, #202020);
  border: 1px solid var(--mm-rule, #303030);
  border-radius: 2px;
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--mm-ink, #ffffff);
  outline: none;
  box-sizing: border-box;
}

.arcade-search-input:focus {
  border-color: var(--mm-accent, #7d8849);
}

.arcade-search-clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--mm-ink-muted, #8a8a8a);
  cursor: pointer;
  padding: 4px;
  font-size: 11px;
}

/* Single-select Server Option List */
.arcade-server-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.arcade-server-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 2px;
  border: none;
  background: transparent;
  color: var(--mm-ink, #ffffff);
  text-align: left;
  cursor: pointer;
  transition: all 0.1s ease;
  width: 100%;
}

.arcade-server-option:hover {
  background: var(--mm-bg-mute, #222222);
}

.arcade-server-option--selected {
  background: color-mix(in srgb, var(--mm-accent, #7d8849) 18%, var(--mm-bg-mute, #202020));
  box-shadow: inset 3px 0 0 var(--mm-accent, #7d8849);
}

.arcade-option-icon {
  font-size: 14px;
  color: var(--mm-ink-muted, #8a8a8a);
  flex-shrink: 0;
}

.arcade-option-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.arcade-option-title {
  font-family: var(--mm-font-display, sans-serif);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--mm-ink, #ffffff);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arcade-option-sub {
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--mm-ink-muted, #8a8a8a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arcade-option-check {
  font-size: 11px;
  color: var(--mm-accent, #7d8849);
  margin-left: auto;
  flex-shrink: 0;
}

.arcade-live-pill {
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--mm-success, #68b855);
  flex-shrink: 0;
}

.arcade-server-empty {
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--mm-ink-muted, #8a8a8a);
  padding: 16px 8px;
  text-align: center;
  font-style: italic;
}

/* Country Badge */
.mm-country-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 4px;
  font-family: var(--mm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: inherit;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  line-height: 1;
  flex-shrink: 0;
}

/* Arena Container */
.mm-arcade-container {
  min-height: 480px;
}

.arcade-server-gate {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 36px 8px 16px;
  max-width: 480px;
}

.arcade-server-gate__title {
  margin: 0;
  font-family: var(--mm-font-display, sans-serif);
  font-size: 28px;
  font-weight: 500;
  color: var(--mm-ink, #ffffff);
  line-height: 1.15;
}

.arcade-server-gate__copy {
  margin: 0;
  font-family: var(--mm-font-display, sans-serif);
  font-size: 14px;
  line-height: 1.5;
  color: var(--mm-ink-muted, #8a8a8a);
}

.arcade-server-gate__cta {
  width: auto;
  min-width: 180px;
  margin: 8px 0 0;
}
</style>
