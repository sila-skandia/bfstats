<template>
  <div class="portal-page">
    <div class="portal-grid" aria-hidden="true" />
    <div class="portal-inner">
      <!-- OPERATIVE LOCATOR Hero -->
      <section class="operative-locator" aria-label="Operative search">
        <div class="operative-locator__bg" aria-hidden="true" />
        <div class="operative-locator__scan" aria-hidden="true" />
        <div class="operative-locator__frame">
          <!-- Terminal chrome -->
          <header class="operative-locator__chrome">
            <span class="operative-locator__led operative-locator__led--red" />
            <span class="operative-locator__led operative-locator__led--amber" />
            <span class="operative-locator__led operative-locator__led--green" />
            <span class="operative-locator__path">gamefront://operative/locator</span>
            <span class="operative-locator__status">
              <span class="operative-locator__status-dot" />
              <span>{{ heroStatusLabel }}</span>
            </span>
          </header>

          <div class="operative-locator__body">
            <div class="operative-locator__intro">
              <span class="operative-locator__prompt">$</span>
              <span class="operative-locator__cmd">locate --operative</span>
              <span class="operative-locator__flag">--fuzzy</span>
            </div>

            <!-- Search Input -->
            <div class="operative-locator__search">
              <span class="operative-locator__caret" aria-hidden="true">&gt;</span>
              <input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                placeholder="enter codename, tag, or fragment..."
                autocomplete="off"
                spellcheck="false"
                class="operative-locator__input"
                @input="onInput"
                @keydown.enter.prevent="executeSearchNow"
              >
              <div class="operative-locator__tail">
                <div
                  v-if="isLoading"
                  class="operative-locator__spinner"
                  aria-label="Searching"
                />
                <button
                  v-else-if="searchQuery.trim()"
                  type="button"
                  class="operative-locator__clear"
                  title="Clear search"
                  @click="clearSearch"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18"/>
                    <path d="m6 6 12 12"/>
                  </svg>
                </button>
                <span v-else class="operative-locator__hint">⏎ to run</span>
              </div>
            </div>

            <!-- Stat line -->
            <div class="operative-locator__meta">
              <span class="operative-locator__meta-group">
                <span class="operative-locator__meta-label">DB</span>
                <span class="operative-locator__meta-val">PLAYER_ARCHIVE</span>
              </span>
              <span class="operative-locator__meta-sep">·</span>
              <span class="operative-locator__meta-group">
                <span class="operative-locator__meta-label">MODE</span>
                <span class="operative-locator__meta-val">CONTAINS</span>
              </span>
              <span class="operative-locator__meta-sep">·</span>
              <span class="operative-locator__meta-group">
                <span class="operative-locator__meta-label">LATENCY</span>
                <span class="operative-locator__meta-val operative-locator__meta-val--accent">REALTIME</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- Main Content -->
      <div class="w-full max-w-screen-2xl mx-auto px-0 sm:px-4 lg:px-6 pt-2">
        <PlayersPage
        ref="playersPageRef"
        :search-query="activeSearchQuery"
        :manual-search="true"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PlayersPage from '../components/PlayersPage.vue'

const route = useRoute()
const router = useRouter()

const searchQuery = ref('')
const activeSearchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const playersPageRef = ref<InstanceType<typeof PlayersPage> | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const isLoading = computed(() => playersPageRef.value?.loading ?? false)

const heroStatusLabel = computed(() => {
  if (isLoading.value) return 'SCANNING'
  if (activeSearchQuery.value) return 'LOCKED'
  return 'STANDBY'
})

function initFromRoute() {
  const q = route.query.q
  if (typeof q === 'string' && q.trim()) {
    const trimmed = q.trim()
    searchQuery.value = trimmed
    activeSearchQuery.value = trimmed
  }
}

onMounted(() => {
  initFromRoute()
  searchInputRef.value?.focus()
})

watch(() => route.query.q, () => initFromRoute())

const triggerSearch = (query: string) => {
  const trimmed = query.trim()
  if (!trimmed) {
    activeSearchQuery.value = ''
    router.replace({ path: '/players', query: {} })
    return
  }
  activeSearchQuery.value = trimmed
  router.replace({ path: '/players', query: { ...route.query, q: trimmed } })
}

const onInput = () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    triggerSearch(searchQuery.value)
  }, 350)
}

const executeSearchNow = () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  triggerSearch(searchQuery.value)
}

const clearSearch = () => {
  searchQuery.value = ''
  if (debounceTimer) clearTimeout(debounceTimer)
  triggerSearch('')
  searchInputRef.value?.focus()
}
</script>

<style src="./portal-layout.css"></style>

<style scoped>
.operative-locator {
  position: relative;
  margin: 0.5rem 0 1.25rem;
  border-radius: 14px;
  border: 1px solid rgba(64, 64, 64, 0.7);
  background: linear-gradient(135deg, rgba(23, 23, 23, 0.95) 0%, rgba(10, 10, 10, 0.95) 100%);
  overflow: hidden;
  isolation: isolate;
  --loc-accent: #fbbf24;
  --loc-accent-rgb: 251, 191, 36;
  --loc-cyan: #22d3ee;
}

.operative-locator__bg {
  position: absolute;
  inset: -2px;
  background:
    radial-gradient(ellipse 45% 90% at 0% 50%, rgba(var(--loc-accent-rgb), 0.10), transparent 60%),
    radial-gradient(ellipse 45% 90% at 100% 50%, rgba(34, 211, 238, 0.06), transparent 60%);
  z-index: -1;
  pointer-events: none;
}

.operative-locator__scan {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--loc-accent) 50%, transparent 100%);
  opacity: 0.45;
  animation: loc-scan 4s ease-in-out infinite;
  z-index: 0;
}

@keyframes loc-scan {
  0%, 100% { transform: translateX(-100%); opacity: 0; }
  50%      { transform: translateX(0%);    opacity: 0.6; }
}

.operative-locator__frame {
  position: relative;
  z-index: 1;
}

.operative-locator__chrome {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  border-bottom: 1px solid rgba(64, 64, 64, 0.6);
  background: rgba(0, 0, 0, 0.35);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
}

.operative-locator__led {
  width: 10px; height: 10px; border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
  flex-shrink: 0;
}
.operative-locator__led--red    { background: #ef4444; color: #ef4444; }
.operative-locator__led--amber  { background: #eab308; color: #eab308; }
.operative-locator__led--green  { background: #4ade80; color: #4ade80; }

.operative-locator__path {
  color: #a3a3a3;
  text-transform: lowercase;
  letter-spacing: 0.05em;
  font-weight: 500;
  margin-left: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.operative-locator__status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.55rem;
  border: 1px solid rgba(var(--loc-accent-rgb), 0.4);
  border-radius: 999px;
  background: rgba(var(--loc-accent-rgb), 0.08);
  color: var(--loc-accent);
  font-weight: 800;
  text-transform: uppercase;
  font-size: 0.6rem;
  flex-shrink: 0;
}

.operative-locator__status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--loc-accent);
  box-shadow: 0 0 6px var(--loc-accent);
  animation: loc-dot 1.6s ease-in-out infinite;
}

@keyframes loc-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.35); }
}

.operative-locator__body {
  padding: 1.125rem 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

@media (min-width: 640px) {
  .operative-locator__body {
    padding: 1.5rem 1.75rem 1.625rem;
  }
}

.operative-locator__intro {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: #a3a3a3;
}

.operative-locator__prompt {
  color: var(--loc-cyan);
  font-weight: 800;
}

.operative-locator__cmd {
  color: #e5e5e5;
  font-weight: 700;
}

.operative-locator__flag {
  color: var(--loc-accent);
  font-weight: 600;
}

.operative-locator__search {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid rgba(82, 82, 82, 0.7);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.5);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.operative-locator__search:focus-within {
  border-color: var(--loc-accent);
  box-shadow: 0 0 0 3px rgba(var(--loc-accent-rgb), 0.18), 0 0 22px rgba(var(--loc-accent-rgb), 0.18);
}

.operative-locator__caret {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: var(--loc-accent);
  font-weight: 900;
  font-size: 1rem;
  line-height: 1;
  flex-shrink: 0;
}

.operative-locator__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #f5f5f4;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.05rem;
  letter-spacing: 0.01em;
  caret-color: var(--loc-accent);
}

.operative-locator__input::placeholder {
  color: #525252;
  font-style: normal;
}

.operative-locator__tail {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.operative-locator__hint {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.625rem;
  color: #525252;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.2rem 0.5rem;
  border: 1px dashed rgba(82, 82, 82, 0.7);
  border-radius: 4px;
}

.operative-locator__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px; height: 26px;
  border: 1px solid rgba(82, 82, 82, 0.6);
  border-radius: 6px;
  background: transparent;
  color: #a3a3a3;
  cursor: pointer;
  transition: all 0.15s ease;
}
.operative-locator__clear:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.operative-locator__spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(82, 82, 82, 0.6);
  border-top-color: var(--loc-accent);
  border-radius: 50%;
  animation: loc-spin 0.7s linear infinite;
}

@keyframes loc-spin {
  to { transform: rotate(360deg); }
}

.operative-locator__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #737373;
}

.operative-locator__meta-group { display: inline-flex; gap: 0.4rem; align-items: baseline; }
.operative-locator__meta-label { color: #525252; font-weight: 600; }
.operative-locator__meta-val   { color: #d4d4d4; font-weight: 700; }
.operative-locator__meta-val--accent { color: var(--loc-accent); }
.operative-locator__meta-sep   { color: #3f3f3f; }
</style>
