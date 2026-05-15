<script setup lang="ts">
import { ref, watch } from 'vue'

interface PlayerSearchResult {
  playerName: string
  totalPlayTimeMinutes: number
  lastSeen: string
  isActive: boolean
  currentServer?: {
    serverGuid: string
    serverName: string
    sessionKills: number
    sessionDeaths: number
    mapName: string
    gameId: string
  }
}

interface PlayerSearchResponse {
  items: PlayerSearchResult[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

interface Props {
  modelValue: string
  placeholder?: string
  fullWidth?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Search players…',
  fullWidth: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [player: PlayerSearchResult]
  enter: []
}>()

const searchResults = ref<PlayerSearchResult[]>([])
const isLoading = ref(false)
const showDropdown = ref(false)
const searchDebounceTimeout = ref<number | null>(null)

const formatPlayTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

const searchPlayers = async (query: string) => {
  if (!query || query.length < 2) {
    searchResults.value = []
    showDropdown.value = false
    return
  }

  isLoading.value = true

  try {
    const response = await fetch(`/stats/Players/search?query=${encodeURIComponent(query)}&pageSize=10`)
    if (!response.ok) throw new Error('Failed to search players')

    const data: PlayerSearchResponse = await response.json()
    searchResults.value = data.items
    showDropdown.value = data.items.length > 0 || query.length >= 2
  } catch (error) {
    console.error('Error searching players:', error)
    searchResults.value = []
    showDropdown.value = false
  } finally {
    isLoading.value = false
  }
}

const onInput = (query: string) => {
  emit('update:modelValue', query)

  if (searchDebounceTimeout.value) clearTimeout(searchDebounceTimeout.value)

  searchDebounceTimeout.value = setTimeout(() => {
    searchPlayers(query)
  }, 300) as unknown as number
}

// Auto-search is deliberately suppressed. The dropdown only opens once
// the user has *typed* something in this session — we never search just
// because the value is preloaded from a URL query (`?player1=dylan`) or
// because the input got focus while already filled.
const onFocus = () => {
  // Re-show any results the user has already fetched in this session
  // (typed → results → blurred → came back). Don't issue a new request
  // just because the field is focused.
  if (searchResults.value.length > 0) showDropdown.value = true
}

const onBlur = () => {
  setTimeout(() => { showDropdown.value = false }, 200)
}

const selectPlayer = (player: PlayerSearchResult) => {
  emit('update:modelValue', player.playerName)
  emit('select', player)
  showDropdown.value = false
  searchResults.value = []
}

// Watcher fires both when the user types AND when the parent updates
// the value programmatically (URL deep link, selection from another
// input). We only want to *clear* state on programmatic updates, never
// trigger a new search — that's reserved for the @input handler.
watch(() => props.modelValue, (newValue) => {
  if (newValue.length < 2) {
    searchResults.value = []
    showDropdown.value = false
  }
})
</script>

<template>
  <div class="mm-psearch" :class="{ 'mm-psearch--full': fullWidth }">
    <label class="mm-search mm-psearch__input">
      <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        :value="modelValue"
        type="text"
        class="mm-search__input"
        :placeholder="placeholder"
        :aria-label="placeholder"
        @input="(e) => onInput((e.target as HTMLInputElement).value)"
        @keyup.enter="$emit('enter')"
        @focus="onFocus"
        @blur="onBlur"
      />
      <span v-if="isLoading" class="mm-psearch__spinner" aria-hidden="true" />
    </label>

    <div v-if="showDropdown" class="mm-psearch__dropdown" role="listbox">
      <button
        v-for="player in searchResults"
        :key="player.playerName"
        type="button"
        class="mm-psearch__row"
        @mousedown.prevent="selectPlayer(player)"
      >
        <div class="mm-psearch__row-main">
          <span class="mm-psearch__name">{{ $pn(player.playerName) }}</span>
          <span class="mm-chip" :class="{ 'mm-chip--off': !player.isActive }">
            <span class="mm-chip__dot" />
            {{ player.isActive ? 'Online' : 'Offline' }}
          </span>
        </div>
        <div class="mm-psearch__row-meta">
          <span>{{ formatPlayTime(player.totalPlayTimeMinutes) }}</span>
          <template v-if="player.currentServer && player.isActive">
            <span class="mm-meta-row__sep">·</span>
            <span>{{ player.currentServer.serverName }}</span>
            <span class="mm-meta-row__sep">·</span>
            <span>{{ player.currentServer.mapName }}</span>
          </template>
        </div>
      </button>
      <div
        v-if="searchResults.length === 0 && !isLoading && modelValue.length >= 2"
        class="mm-empty"
        style="padding: 24px 16px"
      >
        No players found
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-psearch {
  position: relative;
  width: 320px;
  max-width: 100%;
}

.mm-psearch--full {
  width: 100%;
}

.mm-psearch__input {
  width: 100%;
}

.mm-psearch__spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--mm-rule-strong);
  border-top-color: var(--mm-ink);
  border-radius: 50%;
  animation: mm-psearch-spin 0.8s linear infinite;
}

@keyframes mm-psearch-spin {
  to { transform: rotate(360deg); }
}

.mm-psearch__dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  max-height: 360px;
  overflow-y: auto;
  z-index: 50;
}

.mm-psearch__row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--mm-rule);
  text-align: left;
  cursor: pointer;
  color: var(--mm-ink);
  transition: background-color 0.12s ease;
}

.mm-psearch__row:last-child { border-bottom: 0; }
.mm-psearch__row:hover { background: var(--mm-bg-soft); }

.mm-psearch__row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mm-psearch__name {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
}

.mm-psearch__row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}
</style>
