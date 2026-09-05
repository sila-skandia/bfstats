<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import 'primeicons/primeicons.css'
import MmHigherLowerGame from '@/components/v4/arcade/MmHigherLowerGame.vue'
import MmMysterySoldierGame from '@/components/v4/arcade/MmMysterySoldierGame.vue'
import MmFieldTriviaGame from '@/components/v4/arcade/MmFieldTriviaGame.vue'
import MmTheaterScope from '@/components/v4/arcade/MmTheaterScope.vue'
import { fetchArcadeServers, type ArcadeServer } from '@/services/arcadeService'
import { decodeServerName } from '@/utils/playerName'

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

const activeTab = ref<ArcadeTab>(initialTab())
const servers = ref<ArcadeServer[]>([])
const serversLoading = ref(false)
const selectedServerGuid = ref<string>((route.query.server as string) || '')
const isPickerOpen = ref(false)
const serverSearchQuery = ref('')
const serverSearchInputRef = ref<HTMLInputElement | null>(null)

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

// Top servers sorted by total play time (falling back to candidate pool count)
const topServersByPlayTime = computed(() => {
  return servers.value
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

const setServer = (guid: string) => {
  selectedServerGuid.value = guid
  isPickerOpen.value = false
  serverSearchQuery.value = ''
  router.replace({
    query: {
      ...route.query,
      server: guid || undefined,
    },
  })
}

const togglePicker = () => {
  isPickerOpen.value = !isPickerOpen.value
  if (isPickerOpen.value) {
    serverSearchQuery.value = ''
    nextTick(() => {
      serverSearchInputRef.value?.focus()
    })
  }
}

const closePicker = () => {
  isPickerOpen.value = false
}

const onDocClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (!target?.closest('[data-server-picker]')) {
    isPickerOpen.value = false
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
    selectedServerGuid.value = (newServer as string) || ''
  }
)

watch([isPickerOpen, isNarrow], () => {
  if (isPickerOpen.value && isNarrow.value) {
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
  serversLoading.value = true
  try {
    servers.value = await fetchArcadeServers()
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
      <span class="mm-chip"><span class="mm-chip__dot" />Arcade</span>
      <span class="mm-meta-row__sep">·</span>
      <span v-if="selectedServer">{{ $pn(selectedServer.name) }}</span>
      <span v-else>Global Network</span>
    </div>

    <!-- Header & Prompt -->
    <h1
      class="mm-display"
      style="margin-bottom: 8px"
    >
      Arcade
    </h1>
    <p class="mm-arcade-prompt">
      Plot a contact on the scope. The exercise follows.
    </p>

    <MmTheaterScope
      :servers="servers"
      :selected-guid="selectedServerGuid"
      :loading="serversLoading"
      @select="setServer"
    />

    <!-- Prominent Server Selector Card -->
    <div
      class="arcade-server-picker-card"
      data-server-picker
    >
      <div class="arcade-picker-row">
        <!-- Main Selector Trigger -->
        <div class="arcade-picker-field">
          <label class="arcade-picker-label">Server</label>
          <div class="arcade-picker-dropdown-wrap">
            <button
              type="button"
              class="arcade-picker-btn"
              :class="{
                'arcade-picker-btn--active': Boolean(selectedServerGuid),
                'arcade-picker-btn--open': isPickerOpen
              }"
              aria-haspopup="listbox"
              :aria-expanded="isPickerOpen"
              @click="togglePicker"
            >
              <i
                :class="selectedServer ? 'pi pi-server' : 'pi pi-globe'"
                class="arcade-picker-icon"
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
              <template v-else>
                <span class="arcade-picker-placeholder">Choose server…</span>
                <span class="arcade-picker-scope">(Global)</span>
              </template>
              <i class="pi pi-chevron-down arcade-picker-chevron" />
            </button>

            <!-- Clear button to reset to Global -->
            <button
              v-if="selectedServerGuid"
              type="button"
              class="arcade-picker-clear-btn"
              title="Clear server filter (play Global)"
              aria-label="Clear server filter"
              @click.stop="setServer('')"
            >
              <span aria-hidden="true">×</span>
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
                role="listbox"
                aria-label="Select a server"
              >
                <!-- Sheet Header (mobile only) -->
                <div class="arcade-sheet-head">
                  <div>
                    <div class="mm-eyebrow">
                      CHOOSE SERVER
                    </div>
                    <h2 class="arcade-sheet-title">
                      Battleground
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
                  <!-- All Servers (Global) Option -->
                  <button
                    type="button"
                    class="arcade-server-option"
                    :class="{ 'arcade-server-option--selected': !selectedServerGuid }"
                    role="option"
                    :aria-selected="!selectedServerGuid"
                    @click="setServer('')"
                  >
                    <i class="pi pi-globe arcade-option-icon" />
                    <div class="arcade-option-body">
                      <span class="arcade-option-title">All Servers (Global Network)</span>
                      <span class="arcade-option-sub">Play across all tracked players worldwide</span>
                    </div>
                    <i
                      v-if="!selectedServerGuid"
                      class="pi pi-check arcade-option-check"
                    />
                  </button>

                  <!-- Server Items -->
                  <button
                    v-for="s in filteredServers"
                    :key="s.guid"
                    type="button"
                    class="arcade-server-option"
                    :class="{ 'arcade-server-option--selected': selectedServerGuid === s.guid }"
                    role="option"
                    :aria-selected="selectedServerGuid === s.guid"
                    @click="setServer(s.guid)"
                  >
                    <span class="mm-country-badge">{{ s.country || 'UN' }}</span>
                    <div class="arcade-option-body">
                      <span class="arcade-option-title">{{ $pn(s.name) }}</span>
                      <span class="arcade-option-sub">
                        <template v-if="s.totalPlayTimeHours">{{ formatHours(s.totalPlayTimeHours) }} played</template>
                        <template v-else-if="s.totalCandidates">{{ s.totalCandidates }} candidate pool</template>
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
                    v-if="filteredServers.length === 0"
                    class="arcade-server-empty"
                  >
                    No servers matching "{{ serverSearchQuery }}"
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
              :title="`Select ${$pn(s.name)} (${formatHours(s.totalPlayTimeHours) || `${s.totalCandidates} pool`})`"
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
      aria-label="Arcade game modes"
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
      <MmHigherLowerGame
        v-if="activeTab === 'higher-lower'"
        :server-guid="selectedServerGuid || undefined"
        :server-name="selectedServer ? selectedServer.name : undefined"
      />
      <MmMysterySoldierGame
        v-else-if="activeTab === 'mystery'"
        :server-guid="selectedServerGuid || undefined"
        :server-name="selectedServer ? selectedServer.name : undefined"
      />
      <MmFieldTriviaGame
        v-else-if="activeTab === 'trivia'"
        :server-guid="selectedServerGuid || undefined"
        :server-name="selectedServer ? selectedServer.name : undefined"
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
</style>
