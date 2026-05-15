<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import {
  fetchServerProximity,
  type ServerProximityResponse,
} from '@/services/playerRelationshipsApi'

// Ping bands — Neutral Depth dark. Olive success / muted ink / olive accent / kill red.
const BANDS = [
  { label: 'Close', max: 50, color: '#7da34c' },     // success olive-green
  { label: 'Far', max: 100, color: '#8a8a8a' },      // muted ink
  { label: 'Remote', max: 150, color: '#7d8849' },   // accent olive
  { label: 'Distant', max: Infinity, color: '#d65a5a' }, // brightened kill red
] as const

const getBand = (ping: number) => BANDS.find(b => ping <= b.max)!
const getBandIndex = (ping: number) => BANDS.findIndex(b => ping <= b.max)

const props = withDefaults(defineProps<{
  serverGuid: string
  serverName?: string
  seamless?: boolean
}>(), { seamless: false })

const emit = defineEmits<{
  (e: 'player-click', playerName: string): void
}>()

const svgElement = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const width = ref(600)
const height = ref(600)
const loading = ref(false)
const error = ref<string | null>(null)
const minPing = ref(0)
const maxPing = ref(250)
const limit = ref(50)
const PING_SLIDER_MAX = 400
const PING_SLIDER_STEP = 25
const searchQuery = ref('')
const showHelp = ref(false)
const data = ref<ServerProximityResponse | null>(null)
let simulation: d3.Simulation<OrbitNode, undefined> | null = null

const tzOffsetHours = new Date().getTimezoneOffset() / -60

type OrbitNode = {
  playerName: string
  ping: number
  sessions: number
  peakHourUtc: number
  lastPlayed: string
  color: string
  radius: number
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

const bandCounts = computed(() => {
  const counts = BANDS.map(b => ({ label: b.label, color: b.color, count: 0 }))
  if (!data.value) return counts
  for (const p of data.value.players) {
    const i = getBandIndex(p.avgPing)
    if (i >= 0) counts[i].count++
  }
  return counts
})

const totalVisible = computed(() => data.value?.players.length ?? 0)
const totalRegulars = computed(() => data.value?.totalRegulars ?? 0)

const hashSigned = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return ((h & 0xffff) / 0xffff) * 2 - 1
}

const hourToAngle = (hourUtc: number) => {
  const localHour = ((hourUtc + tzOffsetHours) % 24 + 24) % 24
  return (localHour / 24) * 2 * Math.PI - Math.PI / 2
}

const JITTER_RAD = (15 / 60 / 24) * 2 * Math.PI

const fetchData = async () => {
  loading.value = true
  error.value = null
  try {
    data.value = await fetchServerProximity(props.serverGuid, {
      minPing: minPing.value,
      maxPing: maxPing.value,
      limit: limit.value,
    })
    await nextTick()
    renderOrbit()
  } catch {
    error.value = 'Failed to load proximity data'
  } finally {
    loading.value = false
  }
}

const renderOrbit = () => {
  if (!svgElement.value || !data.value) return

  simulation?.stop()
  simulation = null

  const w = width.value
  const h = height.value
  const cx = w / 2
  const cy = h / 2
  const rxMax = Math.max(80, cx - 40)
  const ryMax = Math.max(80, cy - 40)
  const innerR = 48

  const span = Math.max(1, maxPing.value - minPing.value)
  const ratio = (ping: number) => Math.max(0, Math.min(1, (ping - minPing.value) / span))
  const rxAt = (ping: number) => Math.max(innerR, ratio(ping) * rxMax)
  const ryAt = (ping: number) => Math.max(innerR, ratio(ping) * ryMax)

  const players = data.value.players
  const maxSessions = Math.max(1, ...players.map(p => p.sessionCount))
  const sizeScale = d3.scaleSqrt().domain([1, maxSessions]).range([4, 12])

  const nodes: OrbitNode[] = players.map(p => {
    const angle = hourToAngle(p.peakHourUtc) + hashSigned(p.playerName) * JITTER_RAD
    const rx = rxAt(p.avgPing)
    const ry = ryAt(p.avgPing)
    const tx = cx + rx * Math.cos(angle)
    const ty = cy + ry * Math.sin(angle)
    return {
      playerName: p.playerName,
      ping: p.avgPing,
      sessions: p.sessionCount,
      peakHourUtc: p.peakHourUtc,
      lastPlayed: p.lastPlayed,
      color: getBand(p.avgPing).color,
      radius: sizeScale(p.sessionCount),
      targetX: tx, targetY: ty, x: tx, y: ty,
      matched: isSearchMatch(p.playerName),
    }
  })

  const svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  const g = svg.append('g').attr('class', 'mm-orbit-content')

  // Ping band guide rings
  const bandRadii = BANDS.filter(b => b.max < Infinity).map(b => ({
    ping: b.max,
    color: b.color,
  }))
  const ringG = g.append('g').attr('class', 'mm-orbit-rings')
  ringG.selectAll('ellipse')
    .data(bandRadii)
    .enter()
    .append('ellipse')
    .attr('cx', cx).attr('cy', cy)
    .attr('rx', d => rxAt(d.ping))
    .attr('ry', d => ryAt(d.ping))
    .attr('fill', 'none')
    .attr('stroke', '#2d2d2d')
    .attr('stroke-width', 0.5)
    .attr('stroke-dasharray', '2 4')

  // Inner server marker
  g.append('circle')
    .attr('cx', cx).attr('cy', cy).attr('r', 22)
    .attr('fill', 'none')
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 1)

  g.append('text')
    .attr('x', cx).attr('y', cy + 4)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--mm-font-mono)')
    .attr('font-size', 9)
    .attr('letter-spacing', '0.08em')
    .attr('fill', '#ffffff')
    .text(props.serverName ? 'SERVER' : '·')

  // Clock-face hour labels
  const hours = [0, 6, 12, 18]
  const labelG = g.append('g').attr('class', 'mm-orbit-hours')
  for (const h of hours) {
    const angle = hourToAngle(h)
    const r = rxMax + 14
    const x = cx + r * Math.cos(angle)
    const y = cy + ryMax * Math.sin(angle) + 4
    labelG.append('text')
      .attr('x', x).attr('y', y)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'var(--mm-font-mono)')
      .attr('font-size', 9)
      .attr('letter-spacing', '0.06em')
      .attr('fill', '#8a8a8a')
      .text(`${h.toString().padStart(2, '0')}h`)
  }

  // Player dots
  const dotG = g.append('g').attr('class', 'mm-orbit-dots')
  const sel = dotG.selectAll('circle.mm-orbit-dot')
    .data(nodes, d => (d as OrbitNode).playerName)
    .enter()
    .append('circle')
    .attr('class', 'mm-orbit-dot')
    .attr('r', d => d.radius)
    .attr('fill', d => d.color)
    .attr('opacity', d => searchTerms.value.length === 0 || d.matched ? 0.85 : 0.18)
    .attr('stroke', d => d.matched ? '#ffffff' : 'none')
    .attr('stroke-width', d => d.matched ? 1.5 : 0)
    .style('cursor', 'pointer')

  sel.append('title').text(d => `${d.playerName} · ${Math.round(d.ping)}ms · ${d.sessions} sessions`)

  sel.on('click', (_event, d) => emit('player-click', (d as OrbitNode).playerName))

  // Force sim: dots orbit toward target with gentle collision
  simulation = d3.forceSimulation<OrbitNode>(nodes)
    .force('x', d3.forceX<OrbitNode>(d => d.targetX).strength(0.3))
    .force('y', d3.forceY<OrbitNode>(d => d.targetY).strength(0.3))
    .force('collide', d3.forceCollide<OrbitNode>(d => d.radius + 1).strength(0.7))
    .alpha(0.4)
    .alphaDecay(0.05)
    .on('tick', () => {
      sel
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
    })
}

const updateSize = () => {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const size = Math.max(360, Math.min(720, rect.width))
  width.value = size
  height.value = size
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  updateSize()
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateSize()
      if (data.value) renderOrbit()
    })
    resizeObserver.observe(containerRef.value)
  }
  fetchData()
})

onUnmounted(() => {
  simulation?.stop()
  resizeObserver?.disconnect()
})

watch(() => props.serverGuid, () => {
  fetchData()
})

watch([minPing, maxPing, limit], () => {
  fetchData()
})

watch(searchQuery, () => {
  if (data.value) renderOrbit()
})
</script>

<template>
  <section
    ref="containerRef"
    class="mm-orbit"
    :class="{ 'mm-orbit--seamless': seamless }"
  >
    <header v-if="!seamless" class="mm-orbit__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">Player proximity</div>
        <div class="mm-card__hint">Regulars by ping (distance) and peak hour (angle)</div>
      </div>
      <button
        type="button"
        class="mm-btn mm-btn--inline"
        @click="showHelp = !showHelp"
      >{{ showHelp ? 'Close' : 'How to read this' }}</button>
    </header>

    <div v-if="showHelp" class="mm-orbit__help">
      <ul>
        <li><strong>Each dot</strong> is a regular on this server.</li>
        <li><strong>Distance from center</strong> = average ping (inner edge = your min, outer edge = your max).</li>
        <li><strong>Angle around the clock</strong> = peak playing hour, local time (00h at top, 06h right, 12h bottom, 18h left).</li>
        <li><strong>Dot size</strong> = session count. <strong>Color</strong> = ping band.</li>
        <li>Hover for details · click to open the player.</li>
      </ul>
    </div>

    <div class="mm-orbit__controls">
      <div class="mm-orbit__row">
        <label class="mm-orbit__control">
          <span class="mm-eyebrow">Min ping</span>
          <input
            v-model.number="minPing"
            type="range"
            min="0"
            :max="PING_SLIDER_MAX"
            :step="PING_SLIDER_STEP"
            class="mm-orbit__range"
          />
          <span class="mm-orbit__value">{{ minPing }}ms</span>
        </label>
        <label class="mm-orbit__control">
          <span class="mm-eyebrow">Max ping</span>
          <input
            v-model.number="maxPing"
            type="range"
            min="0"
            :max="PING_SLIDER_MAX"
            :step="PING_SLIDER_STEP"
            class="mm-orbit__range"
          />
          <span class="mm-orbit__value">{{ maxPing }}ms</span>
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
          placeholder="Search players (comma-separated)…"
        />
      </label>
    </div>

    <div class="mm-orbit__bands">
      <span
        v-for="band in bandCounts"
        :key="band.label"
        class="mm-chip"
        :style="{ borderColor: band.color, color: band.color }"
      >
        <span class="mm-chip__dot" :style="{ background: band.color, animation: 'none' }" />
        {{ band.label }}
        <span style="margin-left: 4px">{{ band.count }}</span>
      </span>
    </div>

    <div v-if="loading" class="mm-orbit__state">
      <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="totalVisible === 0" class="mm-empty">
      No regulars between {{ minPing }}ms and {{ maxPing }}ms. Try widening the range.
    </div>

    <div v-else class="mm-orbit__viz">
      <svg
        ref="svgElement"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        style="display: block; margin: 0 auto"
      />
    </div>

    <div v-if="totalVisible > 0" class="mm-card__foot">
      Showing {{ totalVisible }} of {{ totalRegulars }} regulars
    </div>
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

.mm-orbit__search { width: 100%; max-width: 360px; }

.mm-orbit__bands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mm-orbit__state { padding: 14px 0; }

.mm-orbit__viz {
  display: flex;
  justify-content: center;
}
</style>
