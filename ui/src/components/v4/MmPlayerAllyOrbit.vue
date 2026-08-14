<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import {
  fetchPlayerTeammates,
  type PlayerRelationship,
} from '@/services/playerRelationshipsApi'
import { decodePlayerName } from '@/utils/playerName'
import { formatLastSeen } from '@/utils/timeUtils'
import MmPlayerNetworkVisualizer from './MmPlayerNetworkVisualizer.vue'

// View mode: Radial Proximity Orbit vs 2-Hop Connected Social Graph
const viewMode = ref<'orbit' | 'network'>('orbit')

// Co-play tiers (Neutral Depth dark theme: olive success / olive accent / muted ink)
const TIERS = [
  { label: 'Trenches', min: 50, color: '#7da34c', sub: '50+ co-rounds' },
  { label: 'Core', min: 25, color: '#9ab85c', sub: '25–49 co-rounds' },
  { label: 'Regulars', min: 10, color: '#7d8849', sub: '10–24 co-rounds' },
  { label: 'Familiar', min: 5, color: '#8a8a8a', sub: '5–9 co-rounds' },
  { label: 'Passing', min: 1, color: '#5a5a5a', sub: '1–4 co-rounds' },
] as const

const getTier = (rounds: number) => TIERS.find(t => rounds >= t.min) || TIERS[TIERS.length - 1]
const getTierIndex = (rounds: number) => {
  const idx = TIERS.findIndex(t => rounds >= t.min)
  return idx >= 0 ? idx : TIERS.length - 1
}

const props = withDefaults(defineProps<{
  playerName: string
  seamless?: boolean
}>(), { seamless: false })

const emit = defineEmits<{
  (e: 'player-click', playerName: string): void
}>()

const svgElement = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const vizRef = ref<HTMLDivElement | null>(null)
const width = ref(600)
const height = ref(600)
const loading = ref(false)
const error = ref<string | null>(null)
const minRounds = ref(1)
const searchQuery = ref('')
const showHelp = ref(false)
const rawAllies = ref<PlayerRelationship[]>([])
let simulation: d3.Simulation<AllyNode, undefined> | null = null

const tooltip = ref<{
  visible: boolean
  x: number
  y: number
  node: AllyNode | null
}>({
  visible: false,
  x: 0,
  y: 0,
  node: null,
})

type AllyNode = {
  playerName: string
  displayName: string
  sessions: number
  lastPlayed: string
  color: string
  radius: number
  tierLabel: string
  targetX: number
  targetY: number
  x: number
  y: number
  matched: boolean
  vx?: number
  vy?: number
}

const searchTerms = computed(() => {
  const raw = searchQuery.value.trim().toLowerCase()
  if (!raw) return []
  return raw.split(',').map(t => t.trim()).filter(t => t.length > 0)
})

const isSearchMatch = (name: string) => {
  if (searchTerms.value.length === 0) return false
  const lower = name.toLowerCase()
  return searchTerms.value.some(t => lower.includes(t))
}

const filteredAllies = computed(() => {
  return rawAllies.value.filter(a => a.sessionCount >= minRounds.value)
})

const tierCounts = computed(() => {
  const counts = TIERS.map(t => ({ label: t.label, color: t.color, count: 0 }))
  for (const a of filteredAllies.value) {
    const idx = getTierIndex(a.sessionCount)
    if (idx >= 0 && idx < counts.length) counts[idx].count++
  }
  return counts
})

const totalVisible = computed(() => filteredAllies.value.length)
const totalAllies = computed(() => rawAllies.value.length)

const hashSigned = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return ((h & 0xffff) / 0xffff) * 2 - 1
}

const fetchData = async () => {
  if (!props.playerName) return
  loading.value = true
  error.value = null
  try {
    const data = await fetchPlayerTeammates(props.playerName, 60)
    rawAllies.value = data || []
    await nextTick()
    renderOrbit()
  } catch {
    error.value = 'Failed to load ally proximity data'
  } finally {
    loading.value = false
  }
}

const renderOrbit = () => {
  if (!svgElement.value || filteredAllies.value.length === 0) return

  simulation?.stop()
  simulation = null

  const w = width.value
  const h = height.value
  const cx = w / 2
  const cy = h / 2
  const rMax = Math.max(90, Math.min(cx, cy) - 40)
  const innerR = 56

  const allies = filteredAllies.value
  const maxSessions = Math.max(1, ...allies.map(a => a.sessionCount))
  const minSessions = Math.min(...allies.map(a => a.sessionCount))
  const sizeScale = d3.scaleSqrt().domain([1, maxSessions]).range([4.5, 13])

  // Radial mapping: closest to center = most played (max sessions -> innerR, min sessions -> rMax)
  const radiusForSessions = (sessions: number) => {
    if (maxSessions === minSessions) return innerR + (rMax - innerR) * 0.4
    const logMin = Math.log(Math.max(1, minSessions))
    const logMax = Math.log(Math.max(2, maxSessions))
    const logVal = Math.log(Math.max(1, sessions))
    const norm = Math.max(0, Math.min(1, (logVal - logMin) / (logMax - logMin)))
    // Invert: norm = 1 (most played) -> innerR; norm = 0 (least played) -> rMax
    return innerR + (1 - norm) * (rMax - innerR)
  }

  const nodes: AllyNode[] = allies.map((a, idx) => {
    const allyName = a.player2Name || a.player1Name
    const tier = getTier(a.sessionCount)
    // Angular distribution: distribute around circle with subtle hash jitter
    const baseAngle = (idx / allies.length) * 2 * Math.PI - Math.PI / 2
    const jitter = hashSigned(allyName) * 0.15
    const angle = baseAngle + jitter
    const rad = radiusForSessions(a.sessionCount)
    const tx = cx + rad * Math.cos(angle)
    const ty = cy + rad * Math.sin(angle)

    return {
      playerName: allyName,
      displayName: decodePlayerName(allyName),
      sessions: a.sessionCount,
      lastPlayed: a.lastPlayedTogether,
      color: tier.color,
      radius: sizeScale(a.sessionCount),
      tierLabel: tier.label,
      targetX: tx,
      targetY: ty,
      x: tx,
      y: ty,
      matched: isSearchMatch(allyName),
    }
  })

  const svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  const g = svg.append('g').attr('class', 'mm-orbit-content')

  // Concentric tier guide rings
  const ringThresholds = [50, 25, 10, 5].filter(t => t <= maxSessions)
  const ringG = g.append('g').attr('class', 'mm-orbit-rings')

  for (const t of ringThresholds) {
    const r = radiusForSessions(t)
    ringG.append('circle')
      .attr('cx', cx).attr('cy', cy)
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', '#2d2d2d')
      .attr('stroke-width', 0.5)
      .attr('stroke-dasharray', '2 4')

    // Ring label
    ringG.append('text')
      .attr('x', cx + 4)
      .attr('y', cy - r + 11)
      .attr('font-family', 'var(--mm-font-mono)')
      .attr('font-size', 8.5)
      .attr('letter-spacing', '0.06em')
      .attr('fill', '#666666')
      .text(`${t}+ co-rounds`)
  }

  // Outer boundary ring
  ringG.append('circle')
    .attr('cx', cx).attr('cy', cy)
    .attr('r', rMax)
    .attr('fill', 'none')
    .attr('stroke', '#222222')
    .attr('stroke-width', 0.5)

  // Inner center player marker (THE PLAYER)
  const centerG = g.append('g').attr('class', 'mm-orbit-center')
  centerG.append('circle')
    .attr('cx', cx).attr('cy', cy).attr('r', 24)
    .attr('fill', '#1a1a1a')
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 1.2)

  centerG.append('text')
    .attr('x', cx).attr('y', cy - 2)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--mm-font-mono)')
    .attr('font-size', 8.5)
    .attr('letter-spacing', '0.08em')
    .attr('fill', '#7da34c')
    .attr('font-weight', '600')
    .text('PLAYER')

  const centerLabel = decodePlayerName(props.playerName)
  const shortLabel = centerLabel.length > 9 ? centerLabel.slice(0, 8) + '…' : centerLabel
  centerG.append('text')
    .attr('x', cx).attr('y', cy + 9)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--mm-font-mono)')
    .attr('font-size', 8)
    .attr('fill', '#e0e0e0')
    .text(shortLabel)

  // Ally dots
  const dotG = g.append('g').attr('class', 'mm-orbit-dots')
  const sel = dotG.selectAll('circle.mm-orbit-dot')
    .data(nodes, d => (d as AllyNode).playerName)
    .enter()
    .append('circle')
    .attr('class', 'mm-orbit-dot')
    .attr('r', d => d.radius)
    .attr('fill', d => d.color)
    .attr('opacity', d => searchTerms.value.length === 0 || d.matched ? 0.9 : 0.15)
    .attr('stroke', d => d.matched ? '#ffffff' : 'none')
    .attr('stroke-width', d => d.matched ? 1.5 : 0)
    .style('cursor', 'pointer')

  sel
    .on('mouseenter', (event: MouseEvent, d) => {
      const rect = vizRef.value?.getBoundingClientRect()
      if (rect) {
        const mouseX = event.clientX - rect.left
        const mouseY = event.clientY - rect.top
        const tipX = mouseX + 230 > rect.width ? mouseX - 220 : mouseX + 14
        const tipY = mouseY + 110 > rect.height ? mouseY - 85 : mouseY + 14
        tooltip.value = {
          visible: true,
          x: Math.max(8, tipX),
          y: Math.max(8, tipY),
          node: d as AllyNode,
        }
      }
    })
    .on('mousemove', (event: MouseEvent) => {
      const rect = vizRef.value?.getBoundingClientRect()
      if (rect && tooltip.value.visible) {
        const mouseX = event.clientX - rect.left
        const mouseY = event.clientY - rect.top
        const tipX = mouseX + 230 > rect.width ? mouseX - 220 : mouseX + 14
        const tipY = mouseY + 110 > rect.height ? mouseY - 85 : mouseY + 14
        tooltip.value.x = Math.max(8, tipX)
        tooltip.value.y = Math.max(8, tipY)
      }
    })
    .on('mouseleave', () => {
      tooltip.value.visible = false
    })
    .on('click', (_event, d) => emit('player-click', (d as AllyNode).playerName))

  // Force simulation: allies gently orbit around their target distance with collision avoidance
  simulation = d3.forceSimulation<AllyNode>(nodes)
    .force('x', d3.forceX<AllyNode>(d => d.targetX).strength(0.35))
    .force('y', d3.forceY<AllyNode>(d => d.targetY).strength(0.35))
    .force('collide', d3.forceCollide<AllyNode>(d => d.radius + 2).strength(0.8))
    .alpha(0.4)
    .alphaDecay(0.05)
    .on('tick', () => {
      sel
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
    })
}

const updateDimensions = () => {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width > 0) {
    const side = Math.min(Math.max(rect.width, 300), 620)
    width.value = side
    height.value = side
    if (rawAllies.value.length > 0) renderOrbit()
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  fetchData()
  if (containerRef.value) {
    updateDimensions()
    resizeObserver = new ResizeObserver(() => updateDimensions())
    resizeObserver.observe(containerRef.value)
  }
})

watch(() => props.playerName, () => {
  fetchData()
})

watch([minRounds, searchQuery], () => {
  renderOrbit()
})

onUnmounted(() => {
  simulation?.stop()
  simulation = null
  resizeObserver?.disconnect()
})
</script>

<template>
  <section
    ref="containerRef"
    class="mm-orbit"
    :class="{ 'mm-orbit--seamless': seamless }"
  >
    <header class="mm-orbit__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">
          {{ viewMode === 'orbit' ? 'Ally Proximity Orbit' : 'Ally Network Graph' }}
        </div>
        <div class="mm-card__hint">
          {{ viewMode === 'orbit'
            ? 'Closest squadmates mapped radially by time & rounds most played together'
            : 'Interactive 2-hop connected graph showing direct allies and who they play with' }}
        </div>
      </div>

      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <div class="mm-tabs" style="margin-top: 0">
          <button
            type="button"
            class="mm-tab"
            :class="{ 'mm-tab--active': viewMode === 'orbit' }"
            @click="viewMode = 'orbit'"
          >Orbit</button>
          <button
            type="button"
            class="mm-tab"
            :class="{ 'mm-tab--active': viewMode === 'network' }"
            @click="viewMode = 'network'"
          >Network Graph</button>
        </div>

        <button
          v-if="viewMode === 'orbit'"
          type="button"
          class="mm-btn mm-btn--inline"
          @click="showHelp = !showHelp"
        >{{ showHelp ? 'Close' : 'How to read this' }}</button>
      </div>
    </header>

    <div v-if="viewMode === 'network'" style="margin-top: 4px">
      <MmPlayerNetworkVisualizer
        :player-name="playerName"
        :height="500"
        seamless
        @player-click="emit('player-click', $event)"
      />
    </div>

    <template v-else>
      <div v-if="showHelp" class="mm-orbit__help">
        <ul>
          <li><strong>Center node</strong> = {{ decodePlayerName(playerName) }} (focal player).</li>
          <li><strong>Distance from center</strong> = co-play frequency (<strong>closest</strong> = most shared rounds, <strong>further out</strong> = fewer rounds).</li>
          <li><strong>Dot size</strong> = relative co-play volume. <strong>Color</strong> = ally strength tier.</li>
          <li>Hover over any ally dot to see rounds played together & last seen · Click to open their profile.</li>
        </ul>
      </div>

      <div class="mm-orbit__controls">
        <div class="mm-orbit__row">
          <label class="mm-orbit__control">
            <span class="mm-eyebrow">Min co-rounds</span>
            <input
              v-model.number="minRounds"
              type="range"
              min="1"
              max="30"
              step="1"
              class="mm-orbit__range"
            />
            <span class="mm-orbit__value">{{ minRounds }}+</span>
          </label>
        </div>

        <label class="mm-search mm-orbit__search">
          <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            class="mm-search__input"
            placeholder="Filter allies (comma-separated)…"
          />
        </label>
      </div>

      <div class="mm-orbit__bands">
        <span
          v-for="tier in tierCounts"
          :key="tier.label"
          class="mm-chip"
          :style="{ borderColor: tier.color, color: tier.color }"
        >
          <span class="mm-chip__dot" :style="{ background: tier.color, animation: 'none' }" />
          {{ tier.label }}
          <span style="margin-left: 4px">{{ tier.count }}</span>
        </span>
      </div>

      <div v-if="loading" class="mm-orbit__state">
        <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
      </div>

      <div v-else-if="error" class="mm-empty">{{ error }}</div>

      <div v-else-if="totalAllies === 0" class="mm-empty">
        No co-play relationship history recorded for {{ decodePlayerName(playerName) }} yet.
      </div>

      <div v-else-if="totalVisible === 0" class="mm-empty">
        No allies with at least {{ minRounds }} co-rounds. Try lowering the threshold.
      </div>

      <div v-else ref="vizRef" class="mm-orbit__viz">
        <svg
          ref="svgElement"
          :width="width"
          :height="height"
          :viewBox="`0 0 ${width} ${height}`"
          style="display: block; margin: 0 auto"
        />

        <!-- Custom Styled High-End Tooltip -->
        <transition name="mm-tip-fade">
          <div
            v-if="tooltip.visible && tooltip.node"
            class="mm-orbit-tooltip"
            :style="{
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`,
              borderTopColor: tooltip.node.color,
            }"
          >
            <div class="mm-orbit-tooltip__head">
              <div class="mm-orbit-tooltip__name">
                {{ tooltip.node.displayName }}
              </div>
              <span
                class="mm-chip"
                :style="{ borderColor: tooltip.node.color, color: tooltip.node.color, padding: '1px 6px', fontSize: '9.5px' }"
              >
                <span class="mm-chip__dot" :style="{ background: tooltip.node.color, animation: 'none' }" />
                {{ tooltip.node.tierLabel }}
              </span>
            </div>

            <div class="mm-orbit-tooltip__stats">
              <div class="mm-orbit-tooltip__stat">
                <span class="mm-orbit-tooltip__label">Co-rounds</span>
                <strong class="mm-orbit-tooltip__val">{{ tooltip.node.sessions }}</strong>
              </div>
              <div v-if="tooltip.node.lastPlayed" class="mm-orbit-tooltip__stat">
                <span class="mm-orbit-tooltip__label">Last together</span>
                <span class="mm-orbit-tooltip__val">{{ formatLastSeen(tooltip.node.lastPlayed) }}</span>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <div v-if="totalVisible > 0" class="mm-card__foot">
        Showing {{ totalVisible }} of {{ totalAllies }} closest allies plotted by co-play proximity (closest = most played together)
      </div>
    </template>
  </section>
</template>

<style scoped>
.mm-orbit {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-orbit__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.mm-orbit__help {
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  padding: 14px 16px;
  font-family: var(--mm-font-display);
  font-size: 13px;
  color: var(--mm-ink);
}

.mm-orbit__help ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-orbit__controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-orbit__row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}

.mm-orbit__control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 240px;
}

.mm-orbit__range {
  flex: 1;
  min-width: 120px;
  accent-color: var(--mm-ink);
}

.mm-orbit__value {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink);
  min-width: 48px;
  text-align: right;
}

.mm-orbit__search {
  width: 100%;
  max-width: 360px;
}

.mm-orbit__bands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mm-orbit__state {
  padding: 14px 0;
}

.mm-orbit__viz {
  position: relative;
  display: flex;
  justify-content: center;
}

/* Custom High-End Orbit Tooltip */
.mm-orbit-tooltip {
  position: absolute;
  z-index: 100;
  pointer-events: none;
  min-width: 200px;
  max-width: 280px;
  padding: 10px 14px;
  background: rgba(18, 20, 19, 0.94);
  backdrop-filter: blur(10px);
  border: 1px solid var(--mm-rule-strong);
  border-top: 2.5px solid var(--mm-accent);
  border-radius: 3px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mm-orbit-tooltip__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mm-orbit-tooltip__name {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.02em;
  word-break: break-word;
}

.mm-orbit-tooltip__stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--mm-rule);
  padding-top: 6px;
}

.mm-orbit-tooltip__stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
}

.mm-orbit-tooltip__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.mm-orbit-tooltip__val {
  font-family: var(--mm-font-display);
  color: var(--mm-ink);
}

.mm-orbit-tooltip__hint {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: var(--mm-accent);
  margin-top: 2px;
  letter-spacing: 0.04em;
}

.mm-tip-fade-enter-active,
.mm-tip-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.mm-tip-fade-enter-from,
.mm-tip-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
