<template>
  <div class="t2-search">
    <div class="t2-search__input-wrap">
      <input
        :value="modelValue"
        type="text"
        class="t2-input"
        :placeholder="placeholder"
        @input="onInput(($event.target as HTMLInputElement).value)"
        @focus="onFocus"
        @blur="onBlur"
        @keydown.enter.prevent="emit('enter')"
      >
      <span
        v-if="isLoading"
        class="t2-search__spinner"
      />
    </div>

    <div
      v-if="showDropdown"
      class="t2-search__dropdown"
    >
      <div
        v-for="player in searchResults"
        :key="player.playerName"
        class="t2-search__opt"
        @mousedown.prevent="selectPlayer(player)"
      >
        <span class="t2-search__opt-name">{{ $pn(player.playerName) }}</span>
        <span class="t2-search__opt-meta">
          {{ player.isActive ? 'online' : 'last ' + formatPlayTime(player.totalPlayTimeMinutes) }}
        </span>
      </div>
      <div
        v-if="searchResults.length === 0 && !isLoading"
        class="t2-search__empty"
      >
        No players found
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface PlayerSearchResult {
  playerName: string
  totalPlayTimeMinutes: number
  lastSeen: string
  isActive: boolean
}

interface PlayerSearchResponse {
  items: PlayerSearchResult[]
}

const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string }>(), {
  placeholder: 'Search players...',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [player: PlayerSearchResult]
  enter: []
}>()

const searchResults = ref<PlayerSearchResult[]>([])
const isLoading = ref(false)
const showDropdown = ref(false)
let debounce: ReturnType<typeof setTimeout> | null = null

const formatPlayTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

// Same endpoint the legacy PlayerSearch uses
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
  } catch (err) {
    console.error('Error searching players:', err)
    searchResults.value = []
    showDropdown.value = false
  } finally {
    isLoading.value = false
  }
}

const onInput = (query: string) => {
  emit('update:modelValue', query)
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => searchPlayers(query), 300)
}

const onFocus = () => {
  if (props.modelValue.length >= 2) searchPlayers(props.modelValue)
}

const onBlur = () => {
  setTimeout(() => { showDropdown.value = false }, 150)
}

const selectPlayer = (player: PlayerSearchResult) => {
  emit('update:modelValue', player.playerName)
  emit('select', player)
  showDropdown.value = false
  searchResults.value = []
}

watch(() => props.modelValue, (value) => {
  if (value.length < 2) {
    searchResults.value = []
    showDropdown.value = false
  }
})
</script>
