<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { fetchPlayerNetworkGraph, type PlayerNetworkGraph } from '@/services/playerRelationshipsApi'

const STRENGTH_BANDS = [
  { label: 'Trenches', min: 100, sub: '100+ co-rounds' },
  { label: 'Core', min: 50, sub: '50–99' },
  { label: 'Regulars', min: 25, sub: '25–49' },
  { label: 'Familiar', min: 10, sub: '10–24' },
  { label: 'Occasional', min: 5, sub: '5–9' },
  { label: 'Passing', min: 3, sub: '3–4' },
  { label: 'Drifters', min: 1, sub: '1–2' },
] as const

const getBandIndex = (weight: number) =>
  STRENGTH_BANDS.findIndex(b => weight >= b.min)

const props = defineProps<{
  playerName: string
}>()

const emit = defineEmits<{
  (e: 'player-click', playerName: string): void
}>()

const router = useRouter()

const depth = ref(1)
const maxNodes = ref(100)
const loading = ref(false)
const error = ref<string | null>(null)
const networkData = ref<PlayerNetworkGraph | null>(null)
const searchQuery = ref('')
const activeBandIndex = ref(0)

const searchTerms = computed(() => {
  const raw = searchQuery.value.trim().toLowerCase()
  if (!raw) return []
  return raw.split(',').map(t => t.trim()).filter(t => t.length > 0)
})

const isSearchMatch = (name: string) => {
  if (searchTerms.value.length === 0) return true
  const lower = name.toLowerCase()
  return searchTerms.value.some(t => lower.includes(t))
}

interface WeightedNode {
  id: string
  label: string
  weight: number
  lastPlayed: string
  bandIndex: number
}

const weightedNodes = computed<WeightedNode[]>(() => {
  if (!networkData.value) return []

  const nodeWeights = new Map<string, number>()
  const nodeLastPlayed = new Map<string, string>()

  for (const e of networkData.value.edges) {
    const other = e.source === props.playerName
      ? e.target
      : e.target === props.playerName
        ? e.source
        : null
    if (other) {
      nodeWeights.set(other, (nodeWeights.get(other) || 0) + e.weight)
      const existing = nodeLastPlayed.get(other)
      if (!existing || e.lastInteraction > existing) {
        nodeLastPlayed.set(other, e.lastInteraction)
      }
    }
  }

  return networkData.value.nodes
    .filter(n => n.id !== props.playerName)
    .map(n => ({
      id: n.id,
      label: n.label,
      weight: nodeWeights.get(n.id) || 0,
      lastPlayed: nodeLastPlayed.get(n.id) || '',
      bandIndex: getBandIndex(nodeWeights.get(n.id) || 0),
    }))
    .filter(n => n.bandIndex >= 0)
    .sort((a, b) => b.weight - a.weight)
})

const bandGroups = computed(() =>
  STRENGTH_BANDS.map((band, idx) => {
    const nodes = weightedNodes.value.filter(n => n.bandIndex === idx)
    return { ...band, index: idx, nodes }
  }),
)

const populatedBands = computed(() => bandGroups.value.filter(b => b.nodes.length > 0))

const activeBand = computed(() => {
  const populated = populatedBands.value
  if (populated.length === 0) return null
  const idx = Math.min(activeBandIndex.value, populated.length - 1)
  return populated[idx]
})

const visibleNodes = computed(() => {
  if (!activeBand.value) return []
  return activeBand.value.nodes.filter(n => isSearchMatch(n.label))
})

const totalConnections = computed(() => weightedNodes.value.length)

const fetchData = async () => {
  loading.value = true
  error.value = null
  try {
    networkData.value = await fetchPlayerNetworkGraph(props.playerName, depth.value, maxNodes.value)
    activeBandIndex.value = 0
  } catch {
    error.value = 'Failed to load network data'
  } finally {
    loading.value = false
  }
}

const formatDate = (iso?: string) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

const goPlayer = (name: string) => {
  emit('player-click', name)
  router.push(`/v4/players/${encodeURIComponent(name)}`)
}

onMounted(fetchData)
watch(() => props.playerName, fetchData)
watch([depth, maxNodes], fetchData)

const maxWeight = computed(() => {
  if (visibleNodes.value.length === 0) return 1
  return visibleNodes.value[0].weight
})

const barWidth = (weight: number): number => {
  if (maxWeight.value === 0) return 0
  return (weight / maxWeight.value) * 100
}
</script>

<template>
  <section class="mm-net">
    <header class="mm-net__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">Network of regulars</div>
        <div class="mm-card__hint">Players grouped by shared rounds — strongest connections first</div>
      </div>
      <div class="mm-net__controls">
        <label class="mm-net__control">
          <span class="mm-eyebrow">Depth</span>
          <select v-model.number="depth" class="mm-net__select">
            <option :value="1">Direct</option>
            <option :value="2">+ friends of friends</option>
          </select>
        </label>
        <label class="mm-net__control">
          <span class="mm-eyebrow">Max nodes</span>
          <select v-model.number="maxNodes" class="mm-net__select">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </label>
      </div>
    </header>

    <label class="mm-search mm-net__search">
      <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        class="mm-search__input"
        placeholder="Search names (comma-separated)…"
      />
    </label>

    <div v-if="loading" class="mm-net__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchData">Retry</button>
    </div>

    <div v-else-if="totalConnections === 0" class="mm-empty">
      No co-play connections recorded yet.
    </div>

    <template v-else>
      <div class="mm-tabs mm-net__tabs">
        <button
          v-for="(band, i) in populatedBands"
          :key="band.label"
          type="button"
          class="mm-tab"
          :class="{ 'mm-tab--active': activeBandIndex === i }"
          @click="activeBandIndex = i"
        >
          {{ band.label }}
          <span class="mm-net__tab-count">{{ band.nodes.length }}</span>
        </button>
      </div>

      <div v-if="activeBand" class="mm-net__band-meta">
        <span class="mm-eyebrow mm-eyebrow--strong">{{ activeBand.label }}</span>
        <span class="mm-eyebrow">{{ activeBand.sub }}</span>
        <span class="mm-meta-row__sep">·</span>
        <span class="mm-eyebrow">{{ visibleNodes.length }} / {{ activeBand.nodes.length }} shown</span>
      </div>

      <table class="mm-list" style="margin-top: 12px">
        <thead>
          <tr>
            <th class="mm-list__rank">#</th>
            <th>Player</th>
            <th class="is-num">Co-rounds</th>
            <th>Last together</th>
            <th style="width: 30%">Relative strength</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(node, idx) in visibleNodes"
            :key="node.id"
            @click="goPlayer(node.id)"
          >
            <td class="mm-list__rank">{{ idx + 1 }}</td>
            <td class="mm-list__name-cell">
              <div class="mm-list__name">
                <span class="mm-list__name-primary">{{ $pn(node.label) }}</span>
              </div>
            </td>
            <td class="is-num" data-cell-label="Co-rounds">{{ node.weight }}</td>
            <td class="is-muted" data-cell-label="Last together">{{ formatDate(node.lastPlayed) }}</td>
            <td data-cell-label="Strength">
              <div class="mm-list__bar">
                <div
                  class="mm-list__bar-fill mm-list__bar-fill--accent"
                  :style="{ width: barWidth(node.weight) + '%' }"
                />
              </div>
            </td>
          </tr>
          <tr v-if="visibleNodes.length === 0">
            <td colspan="5" class="mm-empty" style="border: 0">No connections in this tier match the search.</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.mm-net { display: flex; flex-direction: column; gap: 14px; }

.mm-net__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.mm-net__controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.mm-net__control {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-net__select {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 5px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  min-width: 140px;
}

.mm-net__search { max-width: 360px; }

.mm-net__state { padding: 14px 0; }

.mm-net__tabs { margin-top: 4px; }

.mm-net__tab-count {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  margin-left: 6px;
  color: var(--mm-ink-muted);
  letter-spacing: 0.06em;
}

.mm-tab--active .mm-net__tab-count { color: var(--mm-ink); }

.mm-net__band-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
}
</style>
