<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import {
  fetchServerProximity,
  type ServerProximityEntry,
  type ServerProximityResponse,
} from '@/services/playerRelationshipsApi'

const BANDS = [
  { label: 'Close', max: 50, color: '#22d3ee' },
  { label: 'Far', max: 100, color: '#f59e0b' },
  { label: 'Remote', max: 150, color: '#f97316' },
  { label: 'Distant', max: Infinity, color: '#ef4444' },
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
const vizRef = ref<HTMLDivElement | null>(null)
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
const hoveredPlayer = ref<string | null>(null)
const data = ref<ServerProximityResponse | null>(null)
const zoomTransform = ref<d3.ZoomTransform>(d3.zoomIdentity)
const isFullscreen = ref(false)
let simulation: d3.Simulation<OrbitNode, undefined> | null = null

// Local timezone offset in hours, evaluated once per mount. Used to show peak
// hours in the viewer's local time rather than raw UTC from the DB.
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

// Deterministic hash → [-1, 1] so same name lands the same angular jitter each render.
const hashSigned = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return ((h & 0xffff) / 0xffff) * 2 - 1
}

// Hour-of-day (0-23) → angle. Midnight is at the top, 6am on the right,
// noon at the bottom, 6pm on the left — clock face in canvas coordinates.
const hourToAngle = (hourUtc: number) => {
  const localHour = ((hourUtc + tzOffsetHours) % 24 + 24) % 24
  return (localHour / 24) * 2 * Math.PI - Math.PI / 2
}

const JITTER_RAD = (15 / 60 / 24) * 2 * Math.PI // ±15 min of arc, so same-hour dots fan out

const resetZoom = () => {
  if (!svgElement.value) return
  const svg = d3.select(svgElement.value)
  const zoomBehavior = (svg.node() as unknown as { __zoom_behavior?: d3.ZoomBehavior<SVGSVGElement, unknown> }).__zoom_behavior
  if (zoomBehavior) {
    svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity)
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

  // Linear radial across the viewer's ping window. Inner edge = minPing (the
  // best ping in scope), outer edge = maxPing. Falls back to a safe span so
  // a zero-width window doesn't collapse every dot onto the inner ring.
  const span = Math.max(1, maxPing.value - minPing.value)
  const ratio = (ping: number) => Math.max(0, Math.min(1, (ping - minPing.value) / span))
  const rxAt = (ping: number) => Math.max(innerR, ratio(ping) * rxMax)
  const ryAt = (ping: number) => Math.max(innerR, ratio(ping) * ryMax)

  const players = data.value.players
  const maxSessions = Math.max(1, ...players.map(p => p.sessionCount))
  const sizeScale = d3.scaleSqrt().domain([1, maxSessions]).range([4, 14])

  const nodes: OrbitNode[] = players.map((p) => {
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

  if (nodes.length === 0) return

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

  const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.5, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
      zoomTransform.value = event.transform
    })
  svg.call(zoomBehavior)
  ;(svg.node() as unknown as { __zoom_behavior: d3.ZoomBehavior<SVGSVGElement, unknown> }).__zoom_behavior = zoomBehavior
  if (zoomTransform.value !== d3.zoomIdentity) {
    svg.call(zoomBehavior.transform, zoomTransform.value)
  }

  // Hour spokes (every 3h) + labels for the cardinal four.
  const spokes = g.append('g').attr('class', 'hour-spokes')
  for (let h = 0; h < 24; h += 3) {
    const angle = (h / 24) * 2 * Math.PI - Math.PI / 2
    const xOuter = cx + rxMax * Math.cos(angle)
    const yOuter = cy + ryMax * Math.sin(angle)
    const isCardinal = h % 6 === 0
    spokes.append('line')
      .attr('x1', cx).attr('y1', cy)
      .attr('x2', xOuter).attr('y2', yOuter)
      .attr('stroke', '#30363d')
      .attr('stroke-width', 0.5)
      .attr('stroke-dasharray', isCardinal ? '2,4' : '1,6')
      .attr('opacity', isCardinal ? 0.5 : 0.2)
    if (isCardinal) {
      const labelR = rxMax * 0.98
      const lx = cx + labelR * Math.cos(angle)
      const ly = cy + ryMax * 0.98 * Math.sin(angle)
      spokes.append('text')
        .attr('x', lx).attr('y', ly)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#8b949e')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('opacity', 0.7)
        .text(formatHourLabel(h))
    }
  }

  g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 50).attr('fill', 'url(#center-glow)')

  // Ring guides at ping bands
  const drawRing = (ping: number, color: string, label: string) => {
    const rx = rxAt(ping)
    const ry = ryAt(ping)
    g.append('ellipse')
      .attr('cx', cx).attr('cy', cy).attr('rx', rx).attr('ry', ry)
      .attr('fill', 'none').attr('stroke', color)
      .attr('stroke-width', 0.5).attr('stroke-dasharray', '6,4').attr('opacity', 0.3)
    g.append('text')
      .attr('x', cx + 4).attr('y', cy - ry + 12)
      .attr('fill', color).attr('font-size', '9px')
      .attr('font-family', 'monospace').attr('opacity', 0.6)
      .text(label)
  }
  for (const ping of [50, 100, 150, 200, 250, 300].filter(v => v > minPing.value && v < maxPing.value)) {
    const band = getBand(ping)
    drawRing(ping, band.color, `${ping}ms · ${band.label}`)
  }

  const connections = g.append('g').attr('class', 'connections')
    .selectAll('line')
    .data(nodes)
    .enter()
    .append('line')
    .attr('class', 'connection-line')
    .attr('x1', cx).attr('y1', cy)
    .attr('x2', d => d.x).attr('y2', d => d.y)
    .attr('stroke', d => d.color)
    .attr('stroke-width', d => d.matched ? 1.5 : 0.4)
    .attr('opacity', d => d.matched ? 0.5 : 0.12)

  const nodeG = g.append('g').attr('class', 'nodes')
    .selectAll<SVGGElement, OrbitNode>('g')
    .data(nodes)
    .enter()
    .append('g')
    .attr('class', 'orbit-node')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('mouseenter', function (_event, d) {
      hoveredPlayer.value = d.playerName
      // Raise the hovered group to the end of the parent so its label
      // always paints on top of sibling dots.
      d3.select(this).raise()
      d3.select(this).select('circle.core')
        .transition().duration(150)
        .attr('r', d.radius * 1.5)
        .attr('filter', 'url(#glow)')
      d3.select(this).select('text.hover-label')
        .transition().duration(150)
        .attr('opacity', 1)
      nodeG.filter(n => n.playerName !== d.playerName)
        .transition().duration(150)
        .attr('opacity', 0.18)
      connections.filter(ld => ld.playerName !== d.playerName)
        .transition().duration(150)
        .attr('opacity', 0.05)
      connections
        .filter(ld => ld.playerName === d.playerName)
        .transition().duration(150)
        .attr('opacity', 0.8).attr('stroke-width', 1.5)
    })
    .on('mouseleave', function (_event, d) {
      hoveredPlayer.value = null
      d3.select(this).select('circle.core')
        .transition().duration(150)
        .attr('r', d.radius)
        .attr('filter', null)
      d3.select(this).select('text.hover-label')
        .transition().duration(150)
        .attr('opacity', 0)
      nodeG.transition().duration(150).attr('opacity', 1)
      connections
        .transition().duration(150)
        .attr('opacity', ld => ld.matched ? 0.5 : 0.12)
        .attr('stroke-width', ld => ld.matched ? 1.5 : 0.4)
    })
    .on('click', (_event, d) => emit('player-click', d.playerName))

  nodeG.append('circle')
    .attr('class', 'core')
    .attr('r', d => d.matched ? d.radius * 1.3 : d.radius)
    .attr('fill', d => d.color)
    .attr('opacity', d => d.matched ? 1 : 0.85)
    .attr('stroke', d => d.matched ? '#fff' : d.color)
    .attr('stroke-width', d => d.matched ? 2 : 1)
    .attr('stroke-opacity', d => d.matched ? 0.9 : 0.3)

  // Persistent label only for search-matched players. All others are
  // label-free to keep the galaxy readable; the hover-label below takes
  // over when the user actually points at a dot.
  nodeG.filter(d => d.matched)
    .append('text')
    .attr('class', 'matched-label')
    .attr('dy', d => -(d.radius * 1.3) - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', '#fff')
    .attr('font-size', '11px')
    .attr('font-weight', 'bold')
    .attr('font-family', 'monospace')
    .style('pointer-events', 'none')
    .style('text-shadow', '0 0 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)')
    .text(d => d.playerName.length > 14 ? d.playerName.substring(0, 13) + '…' : d.playerName)

  // Hover label (hidden until mouseenter) — big, bold, with a dark halo
  // so it stays legible above dim siblings.
  nodeG.append('text')
    .attr('class', 'hover-label')
    .attr('dy', d => -(d.radius * 1.5) - 6)
    .attr('text-anchor', 'middle')
    .attr('fill', '#fff')
    .attr('font-size', '12px')
    .attr('font-weight', 'bold')
    .attr('font-family', 'monospace')
    .attr('opacity', 0)
    .style('pointer-events', 'none')
    .style('text-shadow', '0 0 6px rgba(0,0,0,1), 0 0 3px rgba(0,0,0,1)')
    .style('paint-order', 'stroke')
    .style('stroke', '#0d1117')
    .style('stroke-width', '3px')
    .style('stroke-linejoin', 'round')
    .text(d => d.playerName)

  const centerG = g.append('g').attr('class', 'orbit-center')
  centerG.append('circle')
    .attr('cx', cx).attr('cy', cy).attr('r', 18)
    .attr('fill', '#0d1117')
    .attr('stroke', '#22d3ee').attr('stroke-width', 2)
    .attr('filter', 'url(#glow)')
  const centerLabel = props.serverName || props.serverGuid.substring(0, 8)
  centerG.append('text')
    .attr('x', cx).attr('y', cy + 1)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .attr('fill', '#22d3ee').attr('font-size', '9px')
    .attr('font-weight', 'bold').attr('font-family', 'monospace')
    .style('pointer-events', 'none')
    .text(centerLabel.length > 10 ? centerLabel.substring(0, 9) + '…' : centerLabel)

  nodeG.attr('opacity', 0)
    .transition().duration(400)
    .delay((_d, i) => Math.min(i * 10, 600))
    .attr('opacity', 1)

  // Gentle force keeps the dot near its hour-and-ping target; collision spreads
  // same-hour-same-band dots so labels don't stack.
  simulation = d3.forceSimulation<OrbitNode>(nodes)
    .force('x', d3.forceX<OrbitNode>(d => d.targetX).strength(0.2))
    .force('y', d3.forceY<OrbitNode>(d => d.targetY).strength(0.2))
    .force('collide', d3.forceCollide<OrbitNode>(d => (d.matched ? d.radius * 1.3 : d.radius) + 2.5).strength(1).iterations(4))
    .alpha(1)
    .alphaDecay(0.03)
    .velocityDecay(0.4)
    .on('tick', () => {
      for (const n of nodes) {
        const dx = n.x - cx, dy = n.y - cy
        const d2 = dx * dx + dy * dy
        if (d2 < innerR * innerR) {
          const d = Math.sqrt(d2) || 0.001
          n.x = cx + (dx / d) * innerR
          n.y = cy + (dy / d) * innerR
        }
      }
      nodeG.attr('transform', d => `translate(${d.x},${d.y})`)
      connections.attr('x2', d => d.x).attr('y2', d => d.y)
    })
}

const formatHourLabel = (hour: number) => {
  // Hour passed in is UTC; show the label in local time for legibility.
  const localHour = ((hour + tzOffsetHours) % 24 + 24) % 24
  const h = Math.round(localHour) % 24
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  if (h < 12) return `${h}a`
  return `${h - 12}p`
}

const handleResize = () => {
  if (!containerRef.value) return
  if (isFullscreen.value) {
    const viz = vizRef.value
    if (viz) {
      const rect = viz.getBoundingClientRect()
      const availableHeight = window.innerHeight - rect.top - 8
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

let pingRangeDebounce: ReturnType<typeof setTimeout> | null = null
const scheduleRefetch = () => {
  if (pingRangeDebounce) clearTimeout(pingRangeDebounce)
  pingRangeDebounce = setTimeout(() => fetchData(), 300)
}
watch(minPing, (newVal) => {
  // Keep min <= max. Nudge max up if user drags min past it.
  if (newVal > maxPing.value) maxPing.value = newVal
  scheduleRefetch()
})
watch(maxPing, (newVal) => {
  if (newVal < minPing.value) minPing.value = newVal
  scheduleRefetch()
})

watch(searchQuery, () => renderOrbit())

const hoveredItem = computed<ServerProximityEntry | null>(() => {
  if (!hoveredPlayer.value || !data.value) return null
  return data.value.players.find(p => p.playerName === hoveredPlayer.value) ?? null
})

const formatRelative = (iso: string) => {
  try {
    const d = new Date(iso)
    const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
    if (days <= 0) return 'today'
    if (days === 1) return '1d ago'
    if (days < 30) return `${days}d ago`
    if (days < 365) return `${Math.floor(days / 30)}mo ago`
    return `${Math.floor(days / 365)}y ago`
  } catch { return '' }
}

const formatPeakHour = (hourUtc: number) => {
  const localHour = ((hourUtc + tzOffsetHours) % 24 + 24) % 24
  const h = Math.round(localHour) % 24
  const period = h < 12 ? 'am' : 'pm'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}${period}`
}
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
      <div class="orbit-header-row">
        <div>
          <h3 class="orbit-title">
            PLAYER PROXIMITY
          </h3>
          <p class="orbit-subtitle">
            Regulars by ping (distance) &amp; peak hour (angle)
          </p>
        </div>
        <button
          class="orbit-help-btn"
          :class="{ 'orbit-help-btn--active': showHelp }"
          type="button"
          :aria-expanded="showHelp"
          :title="showHelp ? 'Hide guide' : 'WTF am I looking at?'"
          @click="showHelp = !showHelp"
        >
          {{ showHelp ? 'Close' : 'WTF?' }}
        </button>
      </div>
    </div>

    <div
      v-if="showHelp"
      class="orbit-help"
    >
      <div class="orbit-help-title">
        How to read this
      </div>
      <ul class="orbit-help-list">
        <li>
          <strong>Each dot</strong> is a regular who plays on this server.
        </li>
        <li>
          <strong>Distance from the center</strong> = their average ping, mapped across the range you've picked. Inner edge = your min-ping setting, outer edge = your max. Closer in = lower ping; further out = higher.
        </li>
        <li>
          <strong>Use the range</strong> to focus a ping tier. E.g. set min to 200 to see only the distant crew you probably play with most, or keep min at 0 to see everyone.
        </li>
        <li>
          <strong>Angle around the clock</strong> = the hour they usually play, in your local time. Midnight sits at the top, 6am on the right, noon at the bottom, 6pm on the left &mdash; like a 24-hour clock face.
        </li>
        <li>
          <strong>Dot size</strong> = how many sessions they've logged here. Bigger dot = bigger regular.
        </li>
        <li>
          <strong>Colour</strong> = ping tier (Close / Far / Remote / Distant).
        </li>
        <li>
          <strong>Hover</strong> to see who it is. <strong>Click</strong> to open the player.
        </li>
      </ul>
      <div class="orbit-help-hint">
        Clusters are real behaviour: a dense arc at 8pm-ish means an evening crew. A second arc across the clock at 2am-ish is typically a different timezone showing up.
      </div>
    </div>

    <div class="orbit-controls">
      <div class="control-row">
        <label class="control-label">
          <span>Min ping</span>
          <input
            v-model.number="minPing"
            type="range"
            min="0"
            :max="PING_SLIDER_MAX"
            :step="PING_SLIDER_STEP"
            class="control-range"
          >
          <span class="control-value">{{ minPing }}ms</span>
        </label>
      </div>
      <div class="control-row">
        <label class="control-label">
          <span>Max ping</span>
          <input
            v-model.number="maxPing"
            type="range"
            :min="PING_SLIDER_STEP"
            :max="PING_SLIDER_MAX"
            :step="PING_SLIDER_STEP"
            class="control-range"
          >
          <span class="control-value">{{ maxPing }}ms</span>
        </label>
      </div>
      <div class="control-row">
        <div class="search-wrapper">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search players (comma-separated)..."
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
      <div class="control-row control-row--end">
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

    <div class="band-summary">
      <div
        v-for="band in bandCounts"
        :key="band.label"
        class="band-chip"
        :style="{ borderColor: band.color, color: band.color }"
      >
        <span
          class="band-dot"
          :style="{ background: band.color }"
        />
        {{ band.label }}
        <span class="band-count">{{ band.count }}</span>
      </div>
    </div>

    <div
      v-if="loading"
      class="orbit-loading"
    >
      <div class="loading-spinner" />
      <span>Scanning proximity...</span>
    </div>

    <div
      v-else-if="error"
      class="orbit-error"
    >
      {{ error }}
    </div>

    <div
      v-else-if="totalVisible === 0 && !loading"
      class="orbit-empty"
    >
      <p>No regulars between {{ minPing }}ms and {{ maxPing }}ms.</p>
      <p class="orbit-empty-hint">
        Try widening the range. Data populates after the daily sync runs.
      </p>
    </div>

    <div
      v-show="totalVisible > 0 && !loading"
      ref="vizRef"
      class="orbit-viz"
    >
      <svg
        ref="svgElement"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
      />

      <div
        v-if="hoveredItem"
        class="orbit-tooltip"
      >
        <div
          class="tooltip-name"
          :style="{ color: getBand(hoveredItem.avgPing).color }"
        >
          {{ hoveredItem.playerName }}
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Ping</span>
          <span class="tooltip-value">{{ Math.round(hoveredItem.avgPing) }}ms</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Peak hour</span>
          <span class="tooltip-value">{{ formatPeakHour(hoveredItem.peakHourUtc) }} local</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Sessions</span>
          <span class="tooltip-value">{{ hoveredItem.sessionCount }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Last seen</span>
          <span class="tooltip-value">{{ formatRelative(hoveredItem.lastPlayed) }}</span>
        </div>
      </div>
    </div>

    <div
      v-if="totalVisible > 0 && !loading"
      class="orbit-footer"
    >
      {{ totalVisible }} of {{ totalRegulars }} regular{{ totalRegulars === 1 ? '' : 's' }}
      {{ minPing > 0 ? `at ${minPing}-${maxPing}ms` : `within ${maxPing}ms` }}
      <template v-if="zoomTransform.k !== 1">
        &middot; {{ Math.round(zoomTransform.k * 100) }}%
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

.orbit-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.orbit-help-btn {
  flex-shrink: 0;
  background: var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  color: var(--neon-cyan, #22d3ee);
  font-size: 0.65rem;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  transition: all 0.15s;
  text-transform: uppercase;
}

.orbit-help-btn:hover {
  border-color: var(--neon-cyan, #22d3ee);
  box-shadow: 0 0 8px rgba(34, 211, 238, 0.3);
}

.orbit-help-btn--active {
  background: rgba(34, 211, 238, 0.12);
  border-color: var(--neon-cyan, #22d3ee);
}

.orbit-help {
  margin-bottom: 0.75rem;
  padding: 0.75rem 0.9rem;
  background: rgba(34, 211, 238, 0.04);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
}

.orbit-help-title {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--neon-cyan, #22d3ee);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 0.5rem;
}

.orbit-help-list {
  margin: 0 0 0.5rem 0;
  padding-left: 1.1rem;
  list-style: disc;
  color: var(--text-primary, #e6edf3);
  font-size: 0.75rem;
  line-height: 1.55;
}

.orbit-help-list li + li {
  margin-top: 0.25rem;
}

.orbit-help-list strong {
  color: var(--neon-cyan, #22d3ee);
  font-weight: 600;
}

.orbit-help-hint {
  font-size: 0.7rem;
  color: var(--text-secondary, #8b949e);
  font-style: italic;
  line-height: 1.5;
  border-top: 1px dashed rgba(34, 211, 238, 0.2);
  padding-top: 0.5rem;
  margin-top: 0.25rem;
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
  min-width: 4rem;
  text-align: right;
}

.search-wrapper { position: relative; width: 100%; }

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

.control-actions { display: flex; gap: 0.375rem; }

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
  user-select: none;
}

.band-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.band-count { font-weight: 700; }

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
  min-width: 10rem;
  z-index: 2;
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
  opacity: 0.7;
  font-family: 'JetBrains Mono', monospace;
}

.ping-orbit--seamless {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

.ping-orbit--fullscreen,
.ping-orbit--seamless.ping-orbit--fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 80px;
  bottom: 0;
  z-index: 50;
  /* Hard-coded opaque colour: ServerDetails sets --bg-panel to an 82%-alpha
     rgba for its glass-panel look, which bleeds through in fullscreen. */
  background: #0d1117 !important;
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
.ping-orbit--fullscreen .orbit-controls .control-row {
  flex: 1 1 auto;
  min-width: 200px;
}
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
