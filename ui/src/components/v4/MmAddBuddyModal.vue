<script setup lang="ts">
import { ref, watch } from 'vue'
import MmBaseModal from '@/components/v4/MmBaseModal.vue'
import { statsService } from '@/services/statsService'
import { decodePlayerName } from '@/utils/playerName'
import { kdClass } from '@/views/v4/mmTokens'

interface PlayerSearchResult {
  playerName: string
  totalPlayTimeMinutes: number
  totalKills?: number
  totalDeaths?: number
  totalRounds?: number
  lastSeen: string
  isActive: boolean
  currentServer?: {
    serverName: string
    mapName?: string
    sessionKills?: number
    sessionDeaths?: number
  }
}

interface PlayerSearchResponse {
  items: PlayerSearchResult[]
  totalItems: number
}

const emit = defineEmits<{
  close: []
  added: [playerName: string]
}>()

const open = ref(true)
const query = ref('')
const results = ref<PlayerSearchResult[]>([])
const isSearching = ref(false)
// Multi-select: store the chosen playerName strings. Set keeps lookups O(1)
// and order doesn't matter for bulk-add.
const selected = ref<Set<string>>(new Set())
const submitting = ref(false)
const progressTotal = ref(0)
const progressDone = ref(0)
const error = ref<string | null>(null)
let debounceTimer: number | undefined

const isSelected = (name: string) => selected.value.has(name)

const monogram = (name: string): string =>
  decodePlayerName(name).charAt(0).toUpperCase() || '?'

const kdOf = (r: PlayerSearchResult): number => {
  const k = r.totalKills ?? 0
  const d = r.totalDeaths ?? 0
  if (d === 0) return k
  return k / d
}

const formatHours = (mins: number): string => {
  if (!mins) return '0h'
  const h = mins / 60
  return h >= 100 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`
}

const formatRelative = (iso: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`
  return `${Math.round(ms / (30 * 86_400_000))}mo ago`
}

const runSearch = async (q: string) => {
  if (!q || q.length < 2) {
    results.value = []
    return
  }
  isSearching.value = true
  try {
    const r = await fetch(`/stats/Players/search?query=${encodeURIComponent(q)}&pageSize=10`)
    if (!r.ok) throw new Error('search failed')
    const data: PlayerSearchResponse = await r.json()
    results.value = data.items ?? []
  } catch {
    results.value = []
  } finally {
    isSearching.value = false
  }
}

watch(query, (q) => {
  if (debounceTimer) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => void runSearch(q), 250)
})

const toggle = (r: PlayerSearchResult) => {
  const next = new Set(selected.value)
  if (next.has(r.playerName)) next.delete(r.playerName)
  else next.add(r.playerName)
  selected.value = next
}

const submit = async () => {
  if (selected.value.size === 0 || submitting.value) return
  submitting.value = true
  error.value = null
  const names = Array.from(selected.value)
  progressTotal.value = names.length
  progressDone.value = 0
  const failures: string[] = []
  for (const name of names) {
    try {
      await statsService.addBuddy(name)
      emit('added', name)
    } catch (e) {
      failures.push(name)
    } finally {
      progressDone.value++
    }
  }
  submitting.value = false
  if (failures.length === 0) {
    open.value = false
  } else if (failures.length === names.length) {
    error.value = 'Failed to add any buddies.'
  } else {
    error.value = `Added ${names.length - failures.length} of ${names.length}. Failed: ${failures.join(', ')}`
  }
}

const cancel = () => {
  open.value = false
  emit('close')
}
</script>

<template>
  <MmBaseModal
    v-model="open"
    title="Add a buddy"
    subtitle="Squad"
    size="lg"
    @close="cancel"
  >
    <p class="mm-card__hint" style="margin-bottom: 14px">
      Link an in-game alias to <em>track</em> stats, rank, and squad presence.
    </p>

    <label class="mm-search" style="width: 100%; max-width: none; margin-bottom: 18px">
      <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        v-model="query"
        type="text"
        class="mm-search__input"
        placeholder="Search players…"
        aria-label="Search players"
        autofocus
      />
    </label>

    <p
      v-if="results.length > 0"
      class="mm-eyebrow"
      style="margin-bottom: 10px"
    >{{ results.length }} {{ results.length === 1 ? 'match' : 'matches' }}</p>

    <div v-if="isSearching" style="padding: 16px 0">
      <div v-for="i in 3" :key="i" class="mm-skeleton mm-skeleton--lg" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="query.length >= 2 && results.length === 0" class="mm-empty" style="padding: 32px">
      No players match "{{ query }}".
    </div>

    <ol v-else class="mm-add-list">
      <li
        v-for="r in results"
        :key="r.playerName"
        class="mm-add-row"
        :class="{ 'mm-add-row--selected': isSelected(r.playerName) }"
        @click="toggle(r)"
      >
        <span class="mm-add-row__monogram">{{ monogram(r.playerName) }}</span>
        <div class="mm-add-row__body">
          <span class="mm-add-row__name">{{ $pn(r.playerName) }}</span>
          <span class="mm-add-row__sub">
            <span v-if="r.isActive" class="mm-success">● ONLINE</span>
            <span v-else>OFFLINE</span>
            <span class="mm-meta-row__sep">·</span>
            <span>{{ formatRelative(r.lastSeen) }}</span>
          </span>
          <span class="mm-add-row__stats">
            <span :class="kdClass(kdOf(r))">{{ kdOf(r).toFixed(2) }} K/D</span>
            <template v-if="r.totalKills">
              <span class="mm-meta-row__sep">·</span>
              <span class="mm-num--kill">{{ r.totalKills }}</span> K
              <span class="mm-meta-row__sep">·</span>
              <span class="mm-num--death">{{ r.totalDeaths }}</span> D
            </template>
            <template v-if="r.totalPlayTimeMinutes">
              <span class="mm-meta-row__sep">·</span>
              <span>{{ formatHours(r.totalPlayTimeMinutes) }}</span>
            </template>
          </span>
        </div>
        <span v-if="isSelected(r.playerName)" class="mm-add-row__check">✓</span>
        <span v-else class="mm-add-row__plus">+</span>
      </li>
    </ol>

    <p v-if="error" class="mm-empty" style="border: 0; color: var(--mm-kill); padding: 8px 0; margin-top: 12px">
      {{ error }}
    </p>

    <template #footer>
      <span v-if="submitting" class="mm-eyebrow" style="margin-right: auto">
        Adding {{ progressDone }} of {{ progressTotal }}…
      </span>
      <span v-else-if="selected.size > 0" class="mm-eyebrow" style="margin-right: auto">
        {{ selected.size }} selected
      </span>
      <button type="button" class="mm-btn" :disabled="submitting" @click="cancel">Cancel</button>
      <button
        type="button"
        class="mm-btn mm-btn--accent"
        :disabled="selected.size === 0 || submitting"
        @click="submit"
      >{{ submitting ? 'Adding…' : selected.size > 1 ? `Add (${selected.size})` : 'Add' }}</button>
    </template>
  </MmBaseModal>
</template>

<style scoped>
.mm-success { color: var(--mm-success); font-weight: 600; }

.mm-add-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mm-add-row {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}
.mm-add-row:hover { border-color: var(--mm-ink); background: var(--mm-bg-soft); }

.mm-add-row--selected {
  border-color: var(--mm-accent);
  background: rgba(125, 136, 73, 0.08);
}

.mm-add-row__monogram {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 16px;
  font-weight: 600;
  display: grid;
  place-items: center;
}

.mm-add-row__body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.mm-add-row__name {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-ink);
}

.mm-add-row__sub,
.mm-add-row__stats {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  flex-wrap: wrap;
}

.mm-add-row__check,
.mm-add-row__plus {
  width: 30px;
  height: 30px;
  border-radius: 2px;
  display: grid;
  place-items: center;
  font-family: var(--mm-font-mono);
  font-size: 16px;
}

.mm-add-row__check {
  background: var(--mm-accent);
  color: var(--mm-highlight-ink);
}

.mm-add-row__plus {
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-muted);
}
</style>
