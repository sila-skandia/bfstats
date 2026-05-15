<script setup lang="ts">
import { ref, watch } from 'vue'
import MmBaseModal from '@/components/v4/MmBaseModal.vue'
import { statsService } from '@/services/statsService'

interface ServerSearchResult {
  serverGuid: string
  serverName: string
  serverIp?: string
  serverPort?: number
  gameId?: string
  country?: string
  mapName?: string
  numPlayers?: number
  maxPlayers?: number
}

const emit = defineEmits<{
  close: []
  added: [serverGuid: string]
}>()

const open = ref(true)
const query = ref('')
const results = ref<ServerSearchResult[]>([])
const isSearching = ref(false)
// Multi-select: bulk-favourite many servers at once.
const selected = ref<Set<string>>(new Set())
const submitting = ref(false)
const progressTotal = ref(0)
const progressDone = ref(0)
const error = ref<string | null>(null)
let debounceTimer: number | undefined

const isSelected = (guid: string) => selected.value.has(guid)

const runSearch = async (q: string) => {
  if (!q || q.length < 2) {
    results.value = []
    return
  }
  isSearching.value = true
  try {
    const r = await fetch(`/stats/servers/search?query=${encodeURIComponent(q)}&game=bf1942&pageSize=15`)
    if (!r.ok) throw new Error('search failed')
    const data = await r.json()
    results.value = (data.items ?? data ?? []) as ServerSearchResult[]
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

const toggle = (r: ServerSearchResult) => {
  const next = new Set(selected.value)
  if (next.has(r.serverGuid)) next.delete(r.serverGuid)
  else next.add(r.serverGuid)
  selected.value = next
}

const submit = async () => {
  if (selected.value.size === 0 || submitting.value) return
  submitting.value = true
  error.value = null
  const guids = Array.from(selected.value)
  progressTotal.value = guids.length
  progressDone.value = 0
  const failures: string[] = []
  for (const guid of guids) {
    try {
      await statsService.addFavoriteServer(guid)
      emit('added', guid)
    } catch {
      failures.push(guid)
    } finally {
      progressDone.value++
    }
  }
  submitting.value = false
  if (failures.length === 0) {
    open.value = false
  } else if (failures.length === guids.length) {
    error.value = 'Failed to add any servers.'
  } else {
    error.value = `Added ${guids.length - failures.length} of ${guids.length}.`
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
    title="Favourite a server"
    subtitle="Servers"
    size="lg"
    @close="cancel"
  >
    <p class="mm-card__hint" style="margin-bottom: 14px">
      Save servers to <em>monitor</em> status and quick-jump from the dashboard.
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
        placeholder="Search servers…"
        aria-label="Search servers"
        autofocus
      />
    </label>

    <p v-if="results.length > 0" class="mm-eyebrow" style="margin-bottom: 10px">
      {{ results.length }} {{ results.length === 1 ? 'match' : 'matches' }}
    </p>

    <div v-if="isSearching" style="padding: 16px 0">
      <div v-for="i in 3" :key="i" class="mm-skeleton mm-skeleton--lg" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="query.length >= 2 && results.length === 0" class="mm-empty" style="padding: 32px">
      No servers match "{{ query }}".
    </div>

    <ol v-else class="mm-add-list">
      <li
        v-for="r in results"
        :key="r.serverGuid"
        class="mm-add-row mm-add-row--server"
        :class="{ 'mm-add-row--selected': isSelected(r.serverGuid) }"
        @click="toggle(r)"
      >
        <div class="mm-add-row__body">
          <span class="mm-add-row__name">{{ r.serverName }}</span>
          <span class="mm-add-row__sub">
            <span v-if="r.gameId" class="mm-chip">{{ r.gameId.toUpperCase() }}</span>
            <span v-if="r.mapName" class="mm-meta-row__sep">·</span>
            <span v-if="r.mapName">{{ r.mapName }}</span>
            <span v-if="r.country" class="mm-meta-row__sep">·</span>
            <span v-if="r.country">{{ r.country.toUpperCase() }}</span>
          </span>
          <span v-if="r.numPlayers != null && r.maxPlayers != null" class="mm-add-row__stats">
            <span :class="r.numPlayers > 0 ? 'mm-success' : ''">{{ r.numPlayers > 0 ? '● Online' : 'Quiet' }}</span>
            <span class="mm-meta-row__sep">·</span>
            <span>{{ r.numPlayers }} / {{ r.maxPlayers }}</span>
          </span>
        </div>
        <span v-if="isSelected(r.serverGuid)" class="mm-add-row__check">✓</span>
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
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 14px;
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

.mm-add-row__body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }

.mm-add-row__name {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
