<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import { fetchServerPlayerCloseness, type ServerPlayerCloseness } from '@/services/playerRelationshipsApi'

const BANDS = [
  { label: 'Close', max: 50, color: '#22d3ee', bg: 'rgba(34,211,238,0.08)' },
  { label: 'Far', max: 100, color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  { label: 'Remote', max: 150, color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
  { label: 'Distant', max: Infinity, color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
] as const

// Band radial slice: each band claims an equal fraction of the radius so the
// inner (Close) band gets real room for its dense cluster instead of a tiny ring.
const BAND_INNER_MARGIN = 0.05
const BAND_SLICE = (1 - BAND_INNER_MARGIN - 0.02) / 4
const NODE_FOOTPRINT_PX2 = 280 // approx pixels² each dot needs for comfortable spacing

const getBand = (ping: number) => BANDS.find(b => ping <= b.max)!
const getBandIndex = (ping: number) => BANDS.findIndex(b => ping <= b.max)

const props = withDefaults(defineProps<{
  serverGuid: string
  serverName?: string
  /** When set, switches to delta mode: shows players with similar ping to this player */
  playerName?: string
  /** When true, removes the outer container styles for integrated layouts */
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
const maxPing = ref(200)
const pingDelta = ref(30)
const searchQuery = ref('')
const hoveredPlayer = ref<string | null>(null)
const allData = ref<ServerPlayerCloseness[]>([])
const showAll = ref(false)
const activeBand = ref<number | null>(null)
const zoomTransform = ref<d3.ZoomTransform>(d3.zoomIdentity)
const isFullscreen = ref(false)
let simulation: d3.Simulation<any, undefined> | null = null

const isDeltaMode = computed(() => !!props.playerName)

// In delta mode, find the focus player's ping
const focusPlayerPing = computed(() => {
  if (!props.playerName) return null
  const p = allData.value.find(d => d.playerName === props.playerName)
  return p ? p.avgPing : null
})

const fetchData = async () => {
  loading.value = true
  error.value = null
  try {
    // In delta mode, fetch a wide range to find nearby players
    const fetchMax = isDeltaMode.value ? 500 : maxPing.value
    allData.value = await fetchServerPlayerCloseness(props.serverGuid, fetchMax)
    await nextTick()
    renderOrbit()
  } catch {
    error.value = 'Failed to load ping proximity data'
  } finally {
    loading.value = false
  }
}

// Parse comma-separated search terms
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

// Per-band node capacity derived from current viewport — more screen, more dots.
const bandCapacity = computed<number[]>(() => {
  const rxMax = Math.max(80, width.value / 2 - 40)
  const ryMax = Math.max(80, height.value / 2 - 40)
  return BANDS.map((_, bi) => {
    const inner = BAND_INNER_MARGIN + bi * BAND_SLICE
    const outer = inner + BAND_SLICE
    // Area of elliptical annulus
    const area = Math.PI * rxMax * ryMax * (outer * outer - inner * inner)
    return Math.max(16, Math.floor(area / NODE_FOOTPRINT_PX2))
  })
})

const sampledData = computed(() => {
  let data: ServerPlayerCloseness[]

  if (isDeltaMode.value) {
    if (focusPlayerPing.value === null) return []
    const fp = focusPlayerPing.value
    data = allData.value.filter(p =>
      p.playerName !== props.playerName &&
      Math.abs(p.avgPing - fp) <= pingDelta.value
    )
  } else {
    data = allData.value.filter(p => p.avgPing <= maxPing.value)
    if (activeBand.value !== null) {
      data = data.filter(p => getBandIndex(p.avgPing) === activeBand.value)
    }
  }

  if (searchTerms.value.length > 0) {
    return data.filter(p => isSearchMatch(p.playerName))
  }

  if (showAll.value || isDeltaMode.value) return data

  const caps = bandCapacity.value
  const buckets: ServerPlayerCloseness[][] = BANDS.map(() => [])
  for (const p of data) {
    buckets[getBandIndex(p.avgPing)].push(p)
  }
  const sampled = new Set<string>()
  for (let bi = 0; bi < buckets.length; bi++) {
    const bucket = buckets[bi]
    bucket.sort((a, b) => b.sessionCount - a.sessionCount)
    for (const p of bucket.slice(0, caps[bi])) {
      sampled.add(p.playerName)
    }
  }
  return data.filter(p => sampled.has(p.playerName))
})

const bandCounts = computed(() => {
  const counts = BANDS.map(b => ({ ...b, count: 0, sampled: 0 }))
  const data = isDeltaMode.value
    ? sampledData.value
    : allData.value.filter(p => p.avgPing <= maxPing.value)
  for (const p of data) {
    const idx = getBandIndex(p.avgPing)
    if (idx >= 0) counts[idx].count++
  }
  if (!isDeltaMode.value) {
    for (const p of sampledData.value) {
      const idx = getBandIndex(p.avgPing)
      if (idx >= 0) counts[idx].sampled++
    }
  }
  return counts
})

const totalCount = computed(() => {
  if (isDeltaMode.value) return sampledData.value.length
  return allData.value.filter(p => p.avgPing <= maxPing.value).length
})

const centerLabel = computed(() => {
  if (isDeltaMode.value) return props.playerName!
  return props.serverName || props.serverGuid.substring(0, 8)
})

const toggleBand = (idx: number) => {
  activeBand.value = activeBand.value === idx ? null : idx
}

const resetZoom = () => {
  if (!svgElement.value) return
  const svg = d3.select(svgElement.value)
  const zoomBehavior = (svg.node() as any).__zoom_behavior
  if (zoomBehavior) {
    svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity)
  }
}

// Deterministic hash for stable radial jitter
const hashStr = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return h
}

const renderOrbit = () => {
  if (!svgElement.value) return

  // Stop any running simulation before re-render
  simulation?.stop()
  simulation = null

  const items = sampledData.value
  if (items.length === 0) {
    d3.select(svgElement.value).selectAll('*').remove()
    return
  }

  const w = width.value
  const h = height.value
  const cx = w / 2
  const cy = h / 2
  // Elliptical orbit so widescreen actually uses the width.
  const rxMax = Math.max(80, cx - 40)
  const ryMax = Math.max(80, cy - 40)
  const innerR = 34 // inner radius floor (clear of center node)

  // Determine scale range based on mode
  let scaleMin: number
  let scaleMax: number

  if (isDeltaMode.value) {
    scaleMin = 0
    scaleMax = pingDelta.value
  } else if (activeBand.value !== null) {
    const bi = activeBand.value
    scaleMin = bi === 0 ? 0 : BANDS[bi - 1].max
    scaleMax = BANDS[bi].max === Infinity ? maxPing.value : BANDS[bi].max
  } else {
    scaleMin = 0
    scaleMax = maxPing.value
  }

  // Normalized ratio from center (0) to edge (1), then projected to ellipse axes.
  // Delta/active-band modes use linear. Default server mode gives each band an
  // equal slice of the radius so the dense Close ring isn't crammed near center.
  let ratioScale: (ping: number) => number
  if (isDeltaMode.value || activeBand.value !== null) {
    const linear = d3.scaleLinear().domain([scaleMin, scaleMax]).range([0, 1]).clamp(true)
    ratioScale = (ping: number) => linear(ping) as number
  } else {
    ratioScale = (ping: number) => {
      const bi = getBandIndex(ping)
      if (bi < 0) return 1
      const lo = bi === 0 ? 0 : BANDS[bi - 1].max
      const hi = BANDS[bi].max === Infinity ? scaleMax : BANDS[bi].max
      const span = Math.max(1, hi - lo)
      const t = Math.max(0, Math.min(1, (ping - lo) / span))
      return BAND_INNER_MARGIN + (bi + t) * BAND_SLICE
    }
  }
  const rxAt = (ping: number) => Math.max(innerR, ratioScale(ping) * rxMax)
  const ryAt = (ping: number) => Math.max(innerR, ratioScale(ping) * ryMax)

  const maxSessions = d3.max(items, d => d.sessionCount) || 1
  const sizeScale = d3.scaleSqrt()
    .domain([1, maxSessions])
    .range([4, 14])

  const svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  const defs = svg.append('defs')
  const filter = defs.append('filter').attr('id', 'glow')
  filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
  const fMerge = filter.append('feMerge')
  fMerge.append('feMergeNode').attr('in', 'blur')
  fMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  const radGrad = defs.append('radialGradient').attr('id', 'center-glow')
  radGrad.append('stop').attr('offset', '0%').attr('stop-color', '#22d3ee').attr('stop-opacity', 0.3)
  radGrad.append('stop').attr('offset', '100%').attr('stop-color', '#22d3ee').attr('stop-opacity', 0)

  const g = svg.append('g')

  // Zoom behavior
  const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.5, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
      zoomTransform.value = event.transform
    })
  svg.call(zoomBehavior);
  (svg.node() as any).__zoom_behavior = zoomBehavior
  if (zoomTransform.value !== d3.zoomIdentity) {
    svg.call(zoomBehavior.transform, zoomTransform.value)
  }

  // Center glow
  g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 50).attr('fill', 'url(#center-glow)')

  // Ring guides (ellipses)
  const drawRing = (ping: number, color: string, label: string, opacity = 0.3, textOpacity = 0.6) => {
    const rx = rxAt(ping)
    const ry = ryAt(ping)
    g.append('ellipse')
      .attr('cx', cx).attr('cy', cy).attr('rx', rx).attr('ry', ry)
      .attr('fill', 'none').attr('stroke', color)
      .attr('stroke-width', 0.5).attr('stroke-dasharray', '6,4').attr('opacity', opacity)
    g.append('text')
      .attr('x', cx + 4).attr('y', cy - ry + 12)
      .attr('fill', color).attr('font-size', '9px')
      .attr('font-family', 'monospace').attr('opacity', textOpacity)
      .text(label)
  }

  if (isDeltaMode.value) {
    for (const delta of [10, 20, 30, 50, 75, 100]) {
      if (delta > pingDelta.value) break
      if (ratioScale(delta) <= 0 || ratioScale(delta) >= 1) continue
      drawRing(delta, '#6b7280', `\u00b1${delta}ms`, 0.2, 0.5)
    }
  } else {
    const ringPings = [50, 100, 150].filter(v => v <= scaleMax && v >= scaleMin)
    for (const ping of ringPings) {
      const band = getBand(ping)
      drawRing(ping, band.color, `${ping}ms · ${band.label}`)
    }
  }

  // Build player nodes with a target point on the elliptical ring; forces settle them.
  type PlayerNode = {
    name: string; ping: number; sessions: number;
    targetX: number; targetY: number;
    r: number; color: string; matched: boolean;
    x: number; y: number; vx?: number; vy?: number;
  }

  const fp = focusPlayerPing.value
  const playerNodes: PlayerNode[] = items.map((item) => {
    const band = getBand(item.avgPing)
    const matched = isSearchMatch(item.playerName)

    const ringPing = isDeltaMode.value && fp !== null
      ? Math.abs(item.avgPing - fp)
      : item.avgPing
    const rx = rxAt(ringPing)
    const ry = ryAt(ringPing)

    // Deterministic angle — hash into [0, 2π) so same player lands the same spot each render.
    const seed = hashStr(item.playerName)
    const angle = ((seed & 0xffff) / 0xffff) * Math.PI * 2

    const tx = cx + rx * Math.cos(angle)
    const ty = cy + ry * Math.sin(angle)

    return {
      name: item.playerName,
      ping: item.avgPing,
      sessions: item.sessionCount,
      targetX: tx, targetY: ty,
      r: sizeScale(item.sessionCount),
      color: band.color,
      matched,
      x: tx, y: ty,
    }
  })

  // Connection lines from center to each node
  const connections = g.append('g').attr('class', 'connections')
    .selectAll('line')
    .data(playerNodes)
    .enter()
    .append('line')
    .attr('class', 'connection-line')
    .attr('x1', cx).attr('y1', cy)
    .attr('x2', d => d.x).attr('y2', d => d.y)
    .attr('stroke', d => d.color)
    .attr('stroke-width', d => d.matched ? 1.5 : 0.5)
    .attr('opacity', d => d.matched ? 0.5 : 0.1)

  // Player node groups
  const nodes = g.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(playerNodes)
    .enter()
    .append('g')
    .attr('class', 'player-node')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('mouseenter', (_event: MouseEvent, d: PlayerNode) => {
      hoveredPlayer.value = d.name
      d3.select(_event.currentTarget as SVGGElement).select('circle')
        .transition().duration(200)
        .attr('r', d.r * 1.5)
        .attr('filter', 'url(#glow)')
      connections
        .filter((ld: any) => ld.name === d.name)
        .transition().duration(200)
        .attr('opacity', 0.6).attr('stroke-width', 1.5)
    })
    .on('mouseleave', (_event: MouseEvent, d: PlayerNode) => {
      hoveredPlayer.value = null
      d3.select(_event.currentTarget as SVGGElement).select('circle')
        .transition().duration(200)
        .attr('r', d.r)
        .attr('filter', null)
      connections
        .filter((ld: any) => ld.name === d.name)
        .transition().duration(200)
        .attr('opacity', d.matched ? 0.5 : 0.1)
        .attr('stroke-width', d.matched ? 1.5 : 0.5)
    })
    .on('click', (_event: MouseEvent, d: PlayerNode) => {
      emit('player-click', d.name)
    })

  nodes.append('circle')
    .attr('r', d => d.matched ? d.r * 1.3 : d.r)
    .attr('fill', d => d.color)
    .attr('opacity', d => d.matched ? 1 : 0.8)
    .attr('stroke', d => d.matched ? '#fff' : d.color)
    .attr('stroke-width', d => d.matched ? 2 : 1)
    .attr('stroke-opacity', d => d.matched ? 0.9 : 0.3)

  nodes.append('text')
    .attr('dy', d => -(d.matched ? d.r * 1.3 : d.r) - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', d => d.matched ? '#fff' : d.color)
    .attr('font-size', d => d.matched ? '11px' : d.r > 7 ? '10px' : '8px')
    .attr('font-weight', d => d.matched ? 'bold' : 'normal')
    .attr('font-family', 'monospace')
    .attr('opacity', d => d.matched ? 1 : (d.sessions > maxSessions * 0.3 ? 0.8 : 0.4))
    .style('pointer-events', 'none')
    .style('text-shadow', '0 0 4px rgba(0,0,0,0.9)')
    .text(d => d.name.length > 14 ? d.name.substring(0, 13) + '\u2026' : d.name)

  // Center node (drawn after nodes so it sits on top)
  const centerG = g.append('g').attr('class', 'orbit-center')
  centerG.append('circle')
    .attr('cx', cx).attr('cy', cy).attr('r', 18)
    .attr('fill', '#0d1117')
    .attr('stroke', '#22d3ee').attr('stroke-width', 2)
    .attr('filter', 'url(#glow)')
  centerG.append('text')
    .attr('x', cx).attr('y', cy + 1)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .attr('fill', '#22d3ee').attr('font-size', '9px')
    .attr('font-weight', 'bold').attr('font-family', 'monospace')
    .style('pointer-events', 'none')
    .text(centerLabel.value.length > 10
      ? centerLabel.value.substring(0, 9) + '\u2026'
      : centerLabel.value)

  // Entry animation
  nodes.attr('opacity', 0)
    .transition().duration(400)
    .delay((_d: PlayerNode, i: number) => Math.min(i * 6, 600))
    .attr('opacity', 1)

  // Force simulation: weak pull to each node's ellipse-point, strong collision so dense
  // clusters (e.g. the Close band) spread outward along the ring instead of stacking.
  simulation = d3.forceSimulation<PlayerNode>(playerNodes)
    .force('x', d3.forceX<PlayerNode>(d => d.targetX).strength(0.12))
    .force('y', d3.forceY<PlayerNode>(d => d.targetY).strength(0.12))
    .force('collide', d3.forceCollide<PlayerNode>(d => (d.matched ? d.r * 1.3 : d.r) + 2.5).strength(1).iterations(4))
    .alpha(1)
    .alphaDecay(0.025)
    .velocityDecay(0.4)
    .on('tick', () => {
      // Keep nodes clear of the center badge
      for (const n of playerNodes) {
        const dx = n.x - cx, dy = n.y - cy
        const d2 = dx * dx + dy * dy
        if (d2 < innerR * innerR) {
          const d = Math.sqrt(d2) || 0.001
          n.x = cx + (dx / d) * innerR
          n.y = cy + (dy / d) * innerR
        }
      }
      nodes.attr('transform', (d: PlayerNode) => `translate(${d.x},${d.y})`)
      connections.attr('x2', (d: PlayerNode) => d.x).attr('y2', (d: PlayerNode) => d.y)
    })
}

const handleResize = () => {
  if (!containerRef.value) return
  if (isFullscreen.value) {
    // Measure the actual viz slot so the SVG fills whatever chrome leaves behind.
    const viz = vizRef.value
    if (viz) {
      const rect = viz.getBoundingClientRect()
      const availableHeight = window.innerHeight - rect.top - 8 // leave room for footer line
      width.value = Math.max(320, Math.floor(rect.width))
      height.value = Math.max(320, Math.floor(availableHeight))
    } else {
      const sidebar = window.innerWidth >= 1024 ? 80 : 0
      width.value = window.innerWidth - sidebar - 32
      height.value = window.innerHeight - 160
    }
  } else {
    const rect = containerRef.value.getBoundingClientRect()
    width.value = rect.width
    height.value = Math.min(rect.width, 900)
  }
  renderOrbit()
}

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  nextTick(() => {
    handleResize()
    // One more tick after layout settles so vizRef measurements reflect final chrome.
    requestAnimationFrame(() => handleResize())
  })
}

const handleEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
    nextTick(() => handleResize())
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  handleResize()
  fetchData()
  resizeObserver = new ResizeObserver(handleResize)
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  document.removeEventListener('keydown', handleEscape)
  simulation?.stop()
  simulation = null
})

watch(() => props.serverGuid, () => fetchData())
watch(() => props.playerName, () => fetchData())

let maxPingDebounce: ReturnType<typeof setTimeout> | null = null
watch(maxPing, () => {
  if (isDeltaMode.value) return
  if (maxPingDebounce) clearTimeout(maxPingDebounce)
  maxPingDebounce = setTimeout(() => fetchData(), 300)
})

let pingDeltaDebounce: ReturnType<typeof setTimeout> | null = null
watch(pingDelta, () => {
  if (pingDeltaDebounce) clearTimeout(pingDeltaDebounce)
  pingDeltaDebounce = setTimeout(() => renderOrbit(), 150)
})

watch(searchQuery, () => renderOrbit())
watch(showAll, () => renderOrbit())
watch(activeBand, () => renderOrbit())

const hoveredItem = computed(() => {
  if (!hoveredPlayer.value) return null
  const p = allData.value.find(d => d.playerName === hoveredPlayer.value)
  if (!p) return null
  const delta = isDeltaMode.value && focusPlayerPing.value !== null
    ? Math.abs(p.avgPing - focusPlayerPing.value)
    : null
  return { name: p.playerName, ping: p.avgPing, sessions: p.sessionCount, band: getBand(p.avgPing), delta }
})
</script>

<template>
  <div
    ref="containerRef"
    class="ping-orbit-container"
    :class="{ 'ping-orbit--fullscreen': isFullscreen, 'ping-orbit--seamless': seamless && !isFullscreen }"
  >
    <div
      v-if="!seamless"
      class="orbit-header"
    >
      <h3 class="orbit-title">
        {{ isDeltaMode ? 'NEARBY PLAYERS' : 'PLAYER PROXIMITY' }}
      </h3>
      <p class="orbit-subtitle">
        <template v-if="isDeltaMode">
          Players with similar ping to {{ serverName || serverGuid.substring(0, 8) }}
          <span
            v-if="focusPlayerPing !== null"
            class="orbit-focus-ping"
          >({{ Math.round(focusPlayerPing) }}ms)</span>
        </template>
        <template v-else>
          Players by ping distance to server
        </template>
      </p>
    </div>

    <!-- Controls -->
    <div class="orbit-controls">
      <!-- Delta slider (delta mode) or Max ping slider (server mode) -->
      <div class="control-row">
        <label class="control-label">
          <span>{{ isDeltaMode ? 'Delta' : 'Max ping' }}</span>
          <input
            v-if="isDeltaMode"
            v-model.number="pingDelta"
            type="range"
            min="10"
            max="100"
            step="5"
            class="control-range"
          >
          <input
            v-else
            v-model.number="maxPing"
            type="range"
            min="50"
            max="300"
            step="25"
            class="control-range"
          >
          <span class="control-value">{{ isDeltaMode ? `±${pingDelta}ms` : `${maxPing}ms` }}</span>
        </label>
      </div>
      <div class="control-row">
        <div class="search-wrapper">
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="isDeltaMode ? 'Search players (comma-separated)...' : 'Search players (comma-separated)...'"
            class="search-input"
          >
          <button
            v-if="searchQuery"
            class="search-clear"
            @click="searchQuery = ''"
          >
            &times;
          </button>
        </div>
      </div>
      <div
        v-if="!isDeltaMode"
        class="control-row control-row--between"
      >
        <label class="toggle-label">
          <input
            v-model="showAll"
            type="checkbox"
            class="toggle-checkbox"
          >
          <span>Show all ({{ totalCount }})</span>
        </label>
        <div class="control-actions">
          <button
            class="zoom-reset-btn"
            title="Reset zoom"
            @click="resetZoom"
          >
            Reset zoom
          </button>
          <button
            class="zoom-reset-btn"
            :title="isFullscreen ? 'Exit fullscreen (ESC)' : 'Fullscreen'"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? 'Exit' : 'Fullscreen' }}
          </button>
        </div>
      </div>
      <div
        v-else
        class="control-row control-row--end"
      >
        <div class="control-actions">
          <button
            class="zoom-reset-btn"
            title="Reset zoom"
            @click="resetZoom"
          >
            Reset zoom
          </button>
          <button
            class="zoom-reset-btn"
            :title="isFullscreen ? 'Exit fullscreen (ESC)' : 'Fullscreen'"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? 'Exit' : 'Fullscreen' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Band summary (clickable for filtering in server mode) -->
    <div
      v-if="!isDeltaMode"
      class="band-summary"
    >
      <div
        v-for="(band, idx) in bandCounts"
        :key="band.label"
        class="band-chip"
        :class="{ 'band-chip--active': activeBand === idx, 'band-chip--inactive': activeBand !== null && activeBand !== idx }"
        :style="{ borderColor: band.color, color: band.color, background: activeBand === idx ? band.bg : undefined }"
        @click="toggleBand(idx)"
      >
        <span
          class="band-dot"
          :style="{ background: band.color }"
        />
        {{ band.label }}
        <span class="band-count">{{ showAll || activeBand !== null ? band.count : `${band.sampled}/${band.count}` }}</span>
      </div>
    </div>

    <!-- Loading -->
    <div
      v-if="loading"
      class="orbit-loading"
    >
      <div class="loading-spinner" />
      <span>Scanning proximity...</span>
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="orbit-error"
    >
      {{ error }}
    </div>

    <!-- Empty -->
    <div
      v-else-if="sampledData.length === 0 && !loading"
      class="orbit-empty"
    >
      <p v-if="allData.length === 0">
        No ping proximity data available yet.
      </p>
      <p v-else-if="isDeltaMode && focusPlayerPing === null">
        No ping data found for {{ playerName }}.
      </p>
      <p v-else>
        No players
        <template v-if="isDeltaMode">
          within ±{{ pingDelta }}ms
        </template>
        <template v-else>
          within {{ maxPing }}ms
        </template>
        {{ searchQuery ? ` matching "${searchQuery}"` : '' }}.
      </p>
      <p class="orbit-empty-hint">
        {{ allData.length === 0 ? 'Data populates after the daily sync runs.' : isDeltaMode ? 'Try increasing the delta slider.' : 'Try increasing the max ping slider.' }}
      </p>
    </div>

    <!-- Visualization -->
    <div
      v-show="sampledData.length > 0 && !loading"
      ref="vizRef"
      class="orbit-viz"
    >
      <svg
        ref="svgElement"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
      />

      <!-- Hover tooltip -->
      <div
        v-if="hoveredItem"
        class="orbit-tooltip"
      >
        <div
          class="tooltip-name"
          :style="{ color: hoveredItem.band.color }"
        >
          {{ hoveredItem.name }}
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Ping</span>
          <span class="tooltip-value">{{ Math.round(hoveredItem.ping) }}ms</span>
        </div>
        <div
          v-if="hoveredItem.delta !== null"
          class="tooltip-row"
        >
          <span class="tooltip-label">Delta</span>
          <span class="tooltip-value">±{{ Math.round(hoveredItem.delta) }}ms</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Band</span>
          <span
            class="tooltip-value"
            :style="{ color: hoveredItem.band.color }"
          >{{ hoveredItem.band.label }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Sessions</span>
          <span class="tooltip-value">{{ hoveredItem.sessions }}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div
      v-if="sampledData.length > 0 && !loading"
      class="orbit-footer"
    >
      {{ sampledData.length }}
      <template v-if="!isDeltaMode">
        of {{ totalCount }}
      </template>
      player{{ sampledData.length !== 1 ? 's' : '' }}
      <template v-if="isDeltaMode">
        within ±{{ pingDelta }}ms
      </template>
      <template v-else>
        within {{ maxPing }}ms
      </template>
      <template v-if="!isDeltaMode && !showAll && activeBand === null">
        · capped to fit
      </template>
      <template v-if="activeBand !== null">
        · {{ BANDS[activeBand].label }} only
      </template>
      <template v-if="zoomTransform.k !== 1">
        · {{ Math.round(zoomTransform.k * 100) }}%
      </template>
    </div>
  </div>
</template>

<style scoped>
.ping-orbit-container {
  background: var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  padding: 1.25rem;
  position: relative;
  overflow: hidden;
}

.orbit-header {
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-color, #30363d);
}

.orbit-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--neon-cyan, #22d3ee);
  text-transform: uppercase;
  margin: 0;
  font-family: 'JetBrains Mono', monospace;
}

.orbit-subtitle {
  font-size: 0.7rem;
  color: var(--text-secondary, #8b949e);
  margin: 0.25rem 0 0 0;
  font-family: 'JetBrains Mono', monospace;
}

.orbit-focus-ping {
  color: var(--neon-cyan, #22d3ee);
}

.orbit-controls {
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  border: 1px solid var(--border-color, #30363d);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.control-row { display: flex; align-items: center; }
.control-row--between { justify-content: space-between; }
.control-row--end { justify-content: flex-end; }

.control-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  font-family: 'JetBrains Mono', monospace;
  width: 100%;
}

.control-range {
  flex: 1;
  accent-color: var(--neon-cyan, #22d3ee);
  height: 4px;
}

.control-value {
  color: var(--neon-cyan, #22d3ee);
  min-width: 3.5rem;
  text-align: right;
}

.search-wrapper {
  position: relative;
  width: 100%;
}

.search-input {
  width: 100%;
  padding: 0.375rem 2rem 0.375rem 0.5rem;
  background: var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  color: var(--text-primary, #e6edf3);
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', monospace;
  outline: none;
}

.search-input:focus { border-color: var(--neon-cyan, #22d3ee); }
.search-input::placeholder { color: var(--text-secondary, #8b949e); opacity: 0.5; }

.search-clear {
  position: absolute;
  right: 0.375rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.25rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  user-select: none;
}

.toggle-checkbox {
  accent-color: var(--neon-cyan, #22d3ee);
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.zoom-reset-btn {
  background: var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  color: var(--text-secondary, #8b949e);
  font-size: 0.65rem;
  font-family: 'JetBrains Mono', monospace;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  transition: all 0.15s;
}

.zoom-reset-btn:hover {
  border-color: var(--neon-cyan, #22d3ee);
  color: var(--neon-cyan, #22d3ee);
}

.control-actions {
  display: flex;
  gap: 0.375rem;
}

.band-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
}

.band-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid;
  border-radius: 9999px;
  font-size: 0.65rem;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.band-chip:hover { opacity: 0.9; }

.band-chip--active {
  font-weight: 700;
  box-shadow: 0 0 6px rgba(255,255,255,0.1);
}

.band-chip--inactive {
  opacity: 0.35;
}

.band-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.band-count {
  font-weight: 700;
}

.orbit-viz {
  display: flex;
  justify-content: center;
  position: relative;
}

.orbit-viz svg {
  max-width: 100%;
  height: auto;
}

.orbit-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 0;
  color: var(--text-secondary, #8b949e);
  font-size: 0.875rem;
  font-family: 'JetBrains Mono', monospace;
}

.loading-spinner {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--border-color, #30363d);
  border-top-color: var(--neon-cyan, #22d3ee);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.orbit-error {
  text-align: center;
  padding: 3rem 0;
  color: #f85149;
  font-size: 0.875rem;
}

.orbit-empty {
  text-align: center;
  padding: 3rem 0;
  color: var(--text-secondary, #8b949e);
  font-size: 0.875rem;
}

.orbit-empty-hint {
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  opacity: 0.6;
  margin-top: 0.25rem;
}

.orbit-tooltip {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  pointer-events: none;
  min-width: 8rem;
}

.tooltip-name {
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.375rem;
  font-family: 'JetBrains Mono', monospace;
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.7rem;
  line-height: 1.5;
}

.tooltip-label { color: var(--text-secondary, #8b949e); }
.tooltip-value { color: var(--text-primary, #e6edf3); font-family: 'JetBrains Mono', monospace; }

.orbit-footer {
  text-align: center;
  margin-top: 0.5rem;
  font-size: 0.65rem;
  color: var(--text-secondary, #8b949e);
  opacity: 0.6;
  font-family: 'JetBrains Mono', monospace;
}

/* Fullscreen mode */
.ping-orbit--seamless {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

/* Fullscreen must beat the seamless !important overrides. */
.ping-orbit--fullscreen,
.ping-orbit--seamless.ping-orbit--fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 80px; /* Account for desktop sidebar (w-20) */
  bottom: 0;
  z-index: 50;
  background: var(--bg-panel, #0d1117) !important;
  padding: 0.75rem 1rem !important;
  border: none !important;
  border-radius: 0 !important;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: orbit-fade-in 0.2s ease-out;
}

@keyframes orbit-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 1023px) {
  .ping-orbit--fullscreen {
    right: 0;
  }
}

/* Compact chrome in fullscreen so the SVG gets maximum real estate */
.ping-orbit--fullscreen .orbit-header {
  margin-bottom: 0.4rem;
  padding-bottom: 0.35rem;
}
.ping-orbit--fullscreen .orbit-controls {
  margin-bottom: 0.4rem;
  padding: 0.35rem 0.6rem;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
}
.ping-orbit--fullscreen .orbit-controls .control-row { flex: 1 1 auto; min-width: 180px; }
.ping-orbit--fullscreen .band-summary { margin-bottom: 0.4rem; }
.ping-orbit--fullscreen .orbit-viz {
  flex: 1 1 auto;
  min-height: 0;
  align-items: center;
}
.ping-orbit--fullscreen .orbit-viz svg {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  display: block;
}
</style>
