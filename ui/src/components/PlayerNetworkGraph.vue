<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, nextTick, computed } from 'vue'
import * as d3 from 'd3'
import { fetchPlayerNetworkGraph, type PlayerNetworkGraph } from '@/services/playerRelationshipsApi'

const STRENGTH_BANDS = [
  { label: 'Trenches', min: 100, color: '#facc15', bg: 'rgba(250,204,21,0.10)' },
  { label: 'Core', min: 50, color: '#eab308', bg: 'rgba(234,179,8,0.10)' },
  { label: 'Regulars', min: 25, color: '#00e5a0', bg: 'rgba(0,229,160,0.08)' },
  { label: 'Familiar', min: 10, color: '#34d399', bg: 'rgba(52,211,153,0.08)' },
  { label: 'Occasional', min: 5, color: '#22d3ee', bg: 'rgba(34,211,238,0.08)' },
  { label: 'Passing', min: 3, color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  { label: 'Drifters', min: 1, color: '#475569', bg: 'rgba(71,85,105,0.08)' },
] as const

const getBandForWeight = (weight: number) =>
  STRENGTH_BANDS.find(b => weight >= b.min) ?? STRENGTH_BANDS[STRENGTH_BANDS.length - 1]

const getBandIndex = (weight: number) =>
  STRENGTH_BANDS.findIndex(b => weight >= b.min)

const props = defineProps<{
  playerName: string
}>()

const width = ref(800)
const height = ref(600)
const depth = ref(1)
const maxNodes = ref(100)
const loading = ref(false)
const error = ref<string | null>(null)
const networkData = ref<PlayerNetworkGraph | null>(null)
const showControls = ref(false)
const isMobile = ref(false)
const isFullscreen = ref(false)
const searchQuery = ref('')
const hoveredPlayer = ref<string | null>(null)
const activeBandIndex = ref(0) // Which tier tab is selected

const svgElement = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
let g: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
let zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

const checkMobile = () => {
  isMobile.value = window.innerWidth < 768
}

// Parse search terms
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

// Build weighted node data from edges
const weightedNodes = computed(() => {
  if (!networkData.value) return []

  const nodeWeights = new Map<string, number>()
  const nodeLastPlayed = new Map<string, string>()

  for (const e of networkData.value.edges) {
    const other = e.source === props.playerName ? e.target
      : e.target === props.playerName ? e.source
      : null
    if (other) {
      nodeWeights.set(other, (nodeWeights.get(other) || 0) + e.weight)
      const existing = nodeLastPlayed.get(other)
      if (!existing || e.lastInteraction > existing) {
        nodeLastPlayed.set(other, e.lastInteraction)
      }
    }
  }

  // Indirect connections (depth > 1)
  for (const e of networkData.value.edges) {
    if (e.source !== props.playerName && e.target !== props.playerName) {
      for (const id of [e.source, e.target]) {
        if (!nodeWeights.has(id)) nodeWeights.set(id, 0)
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
      band: getBandForWeight(nodeWeights.get(n.id) || 0),
    }))
    .sort((a, b) => b.weight - a.weight)
})

// Group nodes by band
const bandGroups = computed(() => {
  return STRENGTH_BANDS.map((band, idx) => {
    const nodes = weightedNodes.value.filter(n => n.bandIndex === idx)
    return { ...band, index: idx, nodes, totalCount: nodes.length }
  })
})

// Only bands that have players
const populatedBands = computed(() =>
  bandGroups.value.filter(b => b.totalCount > 0)
)

// The currently visible band
const activeBand = computed(() => {
  const populated = populatedBands.value
  if (populated.length === 0) return null
  // Clamp activeBandIndex to valid range
  const idx = Math.min(activeBandIndex.value, populated.length - 1)
  return populated[idx]
})

// Nodes for the active band, filtered by search
const activeNodes = computed(() => {
  if (!activeBand.value) return []
  const nodes = activeBand.value.nodes
  if (searchTerms.value.length > 0) {
    return nodes.filter(n => isSearchMatch(n.label))
  }
  return nodes
})

const totalNodes = computed(() => weightedNodes.value.length)

const selectBand = (populatedIndex: number) => {
  activeBandIndex.value = populatedIndex
  resetZoomState()
  nextTick(() => {
    initializeSvg()
    renderVisualization()
  })
}

const fetchNetworkData = async () => {
  loading.value = true
  error.value = null

  try {
    networkData.value = await fetchPlayerNetworkGraph(props.playerName, depth.value, maxNodes.value)
    // Default to first populated band
    activeBandIndex.value = 0
    await nextTick()
    initializeSvg()
    renderVisualization()
  } catch {
    error.value = 'Failed to load network data'
  } finally {
    loading.value = false
  }
}

const formatDate = (dateStr?: string) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString()
}

const resetZoomState = () => {
  if (svg && zoom) {
    svg.call(zoom.transform, d3.zoomIdentity)
  }
}

const initializeSvg = () => {
  if (!svgElement.value) return

  svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 6])
    .on('zoom', (event) => {
      g?.attr('transform', event.transform)
    })

  svg.call(zoom)
  g = svg.append('g')
}

const renderVisualization = () => {
  if (!g || !svg || !activeBand.value) return

  g.selectAll('*').remove()

  const nodes = activeNodes.value
  const band = activeBand.value
  if (nodes.length === 0) return

  const w = width.value
  const h = height.value
  const cx = w / 2
  const cy = h / 2
  const maxRadius = Math.min(cx, cy) - 40

  // Defs
  const defs = g.append('defs')
  const glowFilter = defs.append('filter').attr('id', 'node-glow')
  glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
  const fMerge = glowFilter.append('feMerge')
  fMerge.append('feMergeNode').attr('in', 'blur')
  fMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  const centerGlow = defs.append('radialGradient').attr('id', 'center-glow')
  centerGlow.append('stop').attr('offset', '0%').attr('stop-color', band.color).attr('stop-opacity', 0.15)
  centerGlow.append('stop').attr('offset', '100%').attr('stop-color', band.color).attr('stop-opacity', 0)

  // Center glow
  g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 50)
    .attr('fill', 'url(#center-glow)')

  const centerNodeRadius = 18
  const innerRadius = centerNodeRadius + 35
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  // Weight range within this tier
  const maxWeight = Math.max(1, ...nodes.map(n => n.weight))
  const minWeight = Math.min(...nodes.map(n => n.weight))
  const weightRange = Math.max(1, maxWeight - minWeight)

  // Radius scale: highest weight → closest to center, lowest → edge
  // Use sqrt scale so nodes spread more evenly across area
  const radiusScale = (weight: number) => {
    const t = 1 - (weight - minWeight) / weightRange // 0 = strongest, 1 = weakest
    return innerRadius + Math.sqrt(t) * (maxRadius - innerRadius)
  }

  // Build node positions — sorted by weight desc, golden angle for angular spread
  type RenderedNode = {
    id: string; label: string; x: number; y: number; r: number
    weight: number; color: string; matched: boolean
  }
  const renderedNodes: RenderedNode[] = []

  // Nodes are already sorted by weight desc from weightedNodes computed
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const matched = isSearchMatch(node.label)

    const radius = radiusScale(node.weight)
    const angle = i * goldenAngle - Math.PI / 2

    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)

    // Size proportional to weight
    const minSize = 3
    const maxSize = 13
    const nodeSize = minSize + (maxSize - minSize) * ((node.weight - minWeight) / weightRange)

    renderedNodes.push({
      id: node.id,
      label: node.label,
      x, y,
      r: matched ? nodeSize * 1.3 : nodeSize,
      weight: node.weight,
      color: band.color,
      matched,
    })
  }

  // Subtle range guide rings to show weight scale
  const guideCount = 3
  for (let i = 1; i <= guideCount; i++) {
    const t = i / (guideCount + 1)
    const r = innerRadius + t * (maxRadius - innerRadius)
    g.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', band.color)
      .attr('stroke-width', 0.4)
      .attr('stroke-dasharray', '2,8')
      .attr('opacity', 0.1)
  }

  // Draw edges from center to each node
  g.selectAll('.connection-edge')
    .data(renderedNodes)
    .enter()
    .append('line')
    .attr('class', 'connection-edge')
    .attr('x1', cx).attr('y1', cy)
    .attr('x2', d => d.x).attr('y2', d => d.y)
    .attr('stroke', band.color)
    .attr('stroke-width', d => Math.max(0.3, 2.5 * ((d.weight - minWeight) / weightRange)))
    .attr('opacity', d => d.matched ? 0.4 : 0.07)

  // Draw player nodes
  const nodeGroups = g.selectAll('.player-node')
    .data(renderedNodes)
    .enter()
    .append('g')
    .attr('class', 'player-node')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('mouseenter', (event: MouseEvent, d) => {
      hoveredPlayer.value = d.id
      d3.select(event.currentTarget as SVGGElement).select('circle')
        .transition().duration(150)
        .attr('r', d.r * 1.4)
        .attr('filter', 'url(#node-glow)')

      d3.select(event.currentTarget as SVGGElement).select('.node-label')
        .transition().duration(150)
        .attr('opacity', 1)
        .attr('font-size', '11px')

      g!.selectAll('.connection-edge')
        .filter((ed: any) => ed.id === d.id)
        .transition().duration(150)
        .attr('opacity', 0.6)
        .attr('stroke-width', 3)
    })
    .on('mouseleave', (event: MouseEvent, d) => {
      hoveredPlayer.value = null
      d3.select(event.currentTarget as SVGGElement).select('circle')
        .transition().duration(150)
        .attr('r', d.r)
        .attr('filter', null)

      d3.select(event.currentTarget as SVGGElement).select('.node-label')
        .transition().duration(150)
        .attr('opacity', d.matched ? 1 : 0.8)
        .attr('font-size', d.matched ? '10px' : labelSize)

      g!.selectAll('.connection-edge')
        .filter((ed: any) => ed.id === d.id)
        .transition().duration(150)
        .attr('opacity', d.matched ? 0.4 : 0.07)
        .attr('stroke-width', Math.max(0.3, 2.5 * ((d.weight - minWeight) / weightRange)))
    })
    .on('click', (_event: MouseEvent, d) => {
      window.location.href = `/players/${encodeURIComponent(d.id)}`
    })

  // Node circles
  nodeGroups.append('circle')
    .attr('r', d => d.r)
    .attr('fill', band.color)
    .attr('opacity', d => d.matched ? 1 : 0.85)
    .attr('stroke', d => d.matched ? '#fff' : band.color)
    .attr('stroke-width', d => d.matched ? 2 : 0.5)
    .attr('stroke-opacity', d => d.matched ? 0.9 : 0.3)

  // Labels — always visible, font scales down as node count increases
  const labelSize = renderedNodes.length <= 15 ? '10px'
    : renderedNodes.length <= 40 ? '9px'
    : renderedNodes.length <= 80 ? '8px'
    : '7px'
  const labelTruncate = renderedNodes.length <= 30 ? 16
    : renderedNodes.length <= 80 ? 12
    : 9

  nodeGroups.append('text')
    .attr('class', 'node-label')
    .attr('dy', d => -(d.r) - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', d => d.matched ? '#fff' : band.color)
    .attr('font-size', d => d.matched ? '10px' : labelSize)
    .attr('font-weight', d => d.matched ? '700' : '500')
    .attr('font-family', "'JetBrains Mono', monospace")
    .attr('opacity', d => d.matched ? 1 : 0.8)
    .style('pointer-events', 'none')
    .style('text-shadow', '0 0 5px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8)')
    .text(d => d.label.length > labelTruncate ? d.label.substring(0, labelTruncate - 1) + '\u2026' : d.label)

  // Center node
  g.append('circle')
    .attr('cx', cx).attr('cy', cy).attr('r', centerNodeRadius)
    .attr('fill', '#0d1117')
    .attr('stroke', band.color)
    .attr('stroke-width', 2.5)
    .attr('filter', 'url(#node-glow)')

  const centerName = props.playerName.length > 12
    ? props.playerName.substring(0, 11) + '\u2026'
    : props.playerName
  g.append('text')
    .attr('x', cx).attr('y', cy + 1)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('fill', band.color)
    .attr('font-size', '8px')
    .attr('font-weight', 'bold')
    .attr('font-family', "'JetBrains Mono', monospace")
    .style('pointer-events', 'none')
    .text(centerName)

  // Entrance animation
  nodeGroups.attr('opacity', 0)
    .transition().duration(350)
    .delay((_d: any, i: number) => i * 3)
    .attr('opacity', 1)
}

const resetZoom = () => {
  resetZoomState()
}

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  nextTick(() => handleResize())
}

const handleEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
    nextTick(() => handleResize())
  }
}

const handleResize = () => {
  checkMobile()
  const container = containerRef.value || svgElement.value?.parentElement
  if (!container) return

  if (isFullscreen.value && !isMobile.value) {
    width.value = window.innerWidth - 80
    height.value = window.innerHeight - 60 // leave room for tier tabs
  } else if (isMobile.value) {
    width.value = window.innerWidth
    height.value = window.innerHeight - 160 // nav + tabs + controls
  } else {
    width.value = container.offsetWidth
    height.value = Math.min(container.offsetWidth * 0.8, 650)
  }

  if (svg) {
    svg.attr('width', width.value).attr('height', height.value)
      .attr('viewBox', `0 0 ${width.value} ${height.value}`)
  }

  if (networkData.value) {
    initializeSvg()
    renderVisualization()
  }
}

// Tooltip data
const hoveredItem = computed(() => {
  if (!hoveredPlayer.value) return null
  const node = weightedNodes.value.find(n => n.id === hoveredPlayer.value)
  if (!node) return null
  return {
    name: node.label,
    weight: node.weight,
    band: node.band,
    lastPlayed: node.lastPlayed,
  }
})

onMounted(() => {
  checkMobile()
  handleResize()
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleEscape)
  fetchNetworkData()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleEscape)
})

watch(() => props.playerName, () => {
  fetchNetworkData()
})

watch(searchQuery, () => {
  if (networkData.value) {
    initializeSvg()
    renderVisualization()
  }
})

watch(activeBandIndex, () => {
  if (networkData.value) {
    initializeSvg()
    renderVisualization()
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="player-network-graph"
    :class="{
      'mobile-optimized': isMobile && isFullscreen,
      'desktop-fullscreen': isFullscreen && !isMobile
    }"
  >
    <!-- Loading -->
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center z-10 bg-[var(--portal-bg,#06060a)]/80"
    >
      <div class="loading-spinner" />
    </div>

    <div
      v-if="error"
      class="text-center py-8"
    >
      <p class="text-red-400">
        {{ error }}
      </p>
    </div>

    <!-- Desktop Fullscreen Exit -->
    <div
      v-if="isFullscreen && !isMobile"
      class="fullscreen-exit-hint"
    >
      <button
        class="fullscreen-exit-btn"
        title="Exit fullscreen"
        @click="toggleFullscreen"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
      <span class="fullscreen-exit-text">ESC to exit</span>
    </div>

    <!-- Tier Tabs — the main navigation -->
    <div
      v-if="populatedBands.length > 0 && !loading"
      class="tier-tabs"
      :class="{ 'tier-tabs--fullscreen': isFullscreen }"
    >
      <button
        v-for="(band, idx) in populatedBands"
        :key="band.index"
        class="tier-tab"
        :class="{ 'tier-tab--active': idx === activeBandIndex }"
        :style="{
          '--tab-color': band.color,
          '--tab-bg': band.bg,
        }"
        @click="selectBand(idx)"
      >
        <span
          class="tier-tab-dot"
          :style="{ background: band.color }"
        />
        <span class="tier-tab-label">{{ band.label }}</span>
        <span class="tier-tab-count">{{ band.totalCount }}</span>
      </button>

      <!-- Controls at the end of the tab bar -->
      <div class="tier-tabs-actions">
        <div class="search-wrapper-inline">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search..."
            class="search-input-inline"
          >
          <button
            v-if="searchQuery"
            class="search-clear-inline"
            @click="searchQuery = ''"
          >
            &times;
          </button>
        </div>
        <button
          class="tab-action-btn"
          title="Reset zoom"
          @click="resetZoom"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
            />
          </svg>
        </button>
        <button
          class="tab-action-btn"
          :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="toggleFullscreen"
        >
          <svg
            v-if="!isFullscreen"
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          <svg
            v-else
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 9V5m0 0h4M9 5l-5 5m5 5v4m0 0h4m-4 0l-5-5m11-5l5 5m-5-5v4m0-4h4m-9 10l5 5m0 0v-4m0 4h-4"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Mobile Controls Bar (only in fullscreen) -->
    <div
      v-if="isMobile && isFullscreen"
      class="mobile-controls-bar"
    >
      <button
        class="mobile-control-btn"
        @click="showControls = !showControls"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
          />
        </svg>
      </button>
      <div class="mobile-stats">
        <span :style="{ color: activeBand?.color }">{{ activeBand?.label }}</span>
        <span class="mx-1 text-neutral-600">&middot;</span>
        <span class="text-[var(--portal-accent,#00e5a0)]">{{ activeNodes.length }}</span> players
      </div>
      <button
        class="mobile-control-btn"
        @click="toggleFullscreen"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>

    <!-- Mobile Controls Overlay -->
    <div
      v-if="isMobile && isFullscreen && showControls"
      class="mobile-controls-overlay"
      @click.self="showControls = false"
    >
      <div class="mobile-controls-panel">
        <div class="flex justify-between items-center mb-3">
          <h3 class="text-sm font-semibold text-neutral-200">
            Settings
          </h3>
          <button
            class="text-neutral-400 hover:text-neutral-200"
            @click="showControls = false"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div class="space-y-3">
          <label class="block">
            <span class="text-xs text-neutral-400">Network Depth</span>
            <select
              v-model.number="depth"
              class="mobile-select"
              @change="fetchNetworkData"
            >
              <option :value="1">Direct connections only</option>
              <option :value="2">Friends of friends</option>
              <option :value="3">Extended network</option>
            </select>
          </label>
          <label class="block">
            <span class="text-xs text-neutral-400">Maximum Nodes</span>
            <select
              v-model.number="maxNodes"
              class="mobile-select"
              @change="fetchNetworkData"
            >
              <option :value="50">50 nodes</option>
              <option :value="100">100 nodes</option>
              <option :value="200">200 nodes</option>
              <option :value="500">500 nodes</option>
            </select>
          </label>
          <label class="block">
            <span class="text-xs text-neutral-400">Search players</span>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Name (comma-separated)..."
              class="mobile-select"
            >
          </label>
        </div>
      </div>
    </div>

    <!-- Active band info bar -->
    <div
      v-if="activeBand && !loading && activeNodes.length > 0"
      class="band-info-bar"
    >
      <span
        class="band-info-label"
        :style="{ color: activeBand.color }"
      >
        {{ activeBand.label }}
      </span>
      <span class="band-info-detail">
        {{ activeBand.min }}+ sessions &middot; {{ activeNodes.length }} player{{ activeNodes.length !== 1 ? 's' : '' }}
      </span>
    </div>

    <!-- Empty state for active band -->
    <div
      v-if="activeBand && activeNodes.length === 0 && !loading"
      class="empty-band"
    >
      <p v-if="searchTerms.length > 0">
        No players matching "{{ searchQuery }}" in this tier.
      </p>
      <p v-else>
        No players in this tier.
      </p>
    </div>

    <!-- Hover tooltip -->
    <div
      v-if="hoveredItem"
      class="orbit-tooltip"
      :class="{ 'z-52': isFullscreen }"
    >
      <div
        class="tooltip-name"
        :style="{ color: hoveredItem.band.color }"
      >
        {{ hoveredItem.name }}
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">Sessions</span>
        <span class="tooltip-value">{{ hoveredItem.weight }}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">Tier</span>
        <span
          class="tooltip-value"
          :style="{ color: hoveredItem.band.color }"
        >{{ hoveredItem.band.label }}</span>
      </div>
      <div
        v-if="hoveredItem.lastPlayed"
        class="tooltip-row"
      >
        <span class="tooltip-label">Last played</span>
        <span class="tooltip-value">{{ formatDate(hoveredItem.lastPlayed) }}</span>
      </div>
    </div>

    <!-- SVG -->
    <svg
      ref="svgElement"
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      class="w-full network-main-svg"
      :class="{ 'rounded-b-lg': !isMobile }"
      style="background: var(--portal-bg, #06060a)"
    />

    <!-- Footer -->
    <div
      v-if="!loading && totalNodes > 0"
      class="graph-footer"
    >
      {{ totalNodes }} total connections across {{ populatedBands.length }} tiers
    </div>
  </div>
</template>

<style scoped>
.player-network-graph {
  position: relative;
  transition: all 0.3s ease-out;
}

/* Tier tab bar */
.tier-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0.5rem 0.5rem 0;
  background: var(--portal-surface-elevated, #111118);
  border-bottom: 1px solid var(--portal-border, #1a1a24);
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tier-tabs::-webkit-scrollbar { display: none; }

.tier-tabs--fullscreen {
  position: relative;
  z-index: 41;
}

.tier-tab {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  font-size: 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
  white-space: nowrap;
  color: var(--portal-text, #9ca3af);
  background: transparent;
  flex-shrink: 0;
}

.tier-tab:hover {
  color: var(--tab-color);
  background: var(--tab-bg);
}

.tier-tab--active {
  color: var(--tab-color);
  background: var(--tab-bg);
  border-color: var(--portal-border, #1a1a24);
  font-weight: 600;
  position: relative;
}

/* Active tab covers the border below it */
.tier-tab--active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--portal-bg, #06060a);
}

.tier-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tier-tab-label {
  /* inherits color */
}

.tier-tab-count {
  font-weight: 700;
  font-size: 0.65rem;
  opacity: 0.7;
}

.tier-tabs-actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-left: auto;
  padding-left: 0.5rem;
  flex-shrink: 0;
}

.search-wrapper-inline {
  position: relative;
}

.search-input-inline {
  width: 120px;
  padding: 0.25rem 1.25rem 0.25rem 0.5rem;
  font-size: 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  background: var(--portal-bg, #06060a);
  border: 1px solid var(--portal-border, #1a1a24);
  border-radius: 4px;
  color: var(--portal-text-bright, #e5e7eb);
  outline: none;
  transition: border-color 0.15s;
}

.search-input-inline:focus {
  border-color: var(--portal-accent, #00e5a0);
}

.search-input-inline::placeholder {
  color: var(--portal-text, #9ca3af);
  opacity: 0.4;
}

.search-clear-inline {
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--portal-text, #9ca3af);
  cursor: pointer;
  font-size: 0.875rem;
  line-height: 1;
  padding: 0 0.125rem;
}

.tab-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: 1px solid var(--portal-border, #1a1a24);
  border-radius: 4px;
  color: var(--portal-text, #9ca3af);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.tab-action-btn:hover {
  background: var(--portal-accent-dim, rgba(0, 229, 160, 0.12));
  border-color: var(--portal-accent, #00e5a0);
  color: var(--portal-accent, #00e5a0);
}

/* Band info bar below tabs */
.band-info-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  font-family: 'JetBrains Mono', monospace;
  background: var(--portal-bg, #06060a);
}

.band-info-label {
  font-size: 0.7rem;
  font-weight: 600;
}

.band-info-detail {
  font-size: 0.65rem;
  color: var(--portal-text, #9ca3af);
  opacity: 0.6;
}

.empty-band {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 1rem;
  color: var(--portal-text, #9ca3af);
  font-size: 0.875rem;
  font-family: 'JetBrains Mono', monospace;
  text-align: center;
}

.graph-footer {
  text-align: center;
  padding: 0.375rem;
  font-size: 0.6rem;
  color: var(--portal-text, #9ca3af);
  opacity: 0.5;
  font-family: 'JetBrains Mono', monospace;
}

/* Tooltip */
.orbit-tooltip {
  position: absolute;
  top: 4rem;
  left: 0.75rem;
  background: var(--portal-surface-elevated, #111118);
  border: 1px solid var(--portal-border, #1a1a24);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  pointer-events: none;
  min-width: 8rem;
  z-index: 10;
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

.loading-spinner {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--portal-border, #1a1a24);
  border-top-color: var(--portal-accent, #00e5a0);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Mobile */
.mobile-optimized {
  position: fixed;
  top: 64px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--portal-bg, #06060a);
}

.mobile-controls-bar {
  position: relative;
  height: 40px;
  z-index: 41;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem;
  background: rgba(6, 6, 10, 0.98);
  border-bottom: 1px solid var(--portal-border, #1a1a24);
}

.mobile-control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(17, 17, 24, 0.8);
  border: 1px solid var(--portal-border, #1a1a24);
  border-radius: 6px;
  color: var(--portal-accent, #00e5a0);
  transition: all 0.2s;
}

.mobile-control-btn:active {
  background: var(--portal-accent-dim, rgba(0, 229, 160, 0.12));
  transform: scale(0.95);
}

.mobile-stats {
  font-size: 0.7rem;
  color: var(--portal-text, #9ca3af);
  font-family: 'JetBrains Mono', monospace;
  text-align: center;
  flex: 1;
}

.mobile-controls-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-end;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.mobile-controls-panel {
  width: 100%;
  max-height: 80vh;
  background: var(--portal-surface-elevated, #111118);
  border: 1px solid var(--portal-border, #1a1a24);
  border-radius: 16px 16px 0 0;
  padding: 1.25rem;
  overflow-y: auto;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.mobile-select {
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  background: rgba(12, 12, 18, 0.9);
  border: 1px solid var(--portal-border, #1a1a24);
  border-radius: 6px;
  color: var(--portal-text-bright, #e5e7eb);
  transition: all 0.2s;
}

.mobile-select:focus {
  outline: none;
  border-color: var(--portal-accent, #00e5a0);
  box-shadow: 0 0 0 3px rgba(0, 229, 160, 0.15);
}

@media (max-width: 767px) {
  .player-network-graph { border-radius: 0 !important; }

  .tier-tabs {
    padding: 0.375rem 0.375rem 0;
  }

  .tier-tab {
    padding: 0.3rem 0.5rem;
    font-size: 0.6rem;
  }

  .tier-tabs-actions {
    display: none; /* Use mobile controls bar instead */
  }

  .band-info-bar {
    padding: 0.2rem 0.5rem;
  }
}

/* Desktop fullscreen */
.desktop-fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 80px;
  bottom: 0;
  z-index: 40;
  background: var(--portal-bg, #06060a);
  display: flex;
  flex-direction: column;
  animation: fadeIn 0.3s ease-out;
}

.desktop-fullscreen .network-main-svg {
  flex: 1;
}

.fullscreen-exit-hint {
  position: fixed;
  top: 8px;
  right: 100px;
  z-index: 42;
  display: flex;
  align-items: center;
  background: rgba(17, 17, 24, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid var(--portal-border, #1a1a24);
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  font-size: 0.7rem;
}

.fullscreen-exit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem;
  background: transparent;
  border: none;
  color: var(--portal-accent, #00e5a0);
  cursor: pointer;
  transition: all 0.2s;
  width: 20px;
  height: 20px;
}

.fullscreen-exit-btn:hover {
  color: #F59E0B;
}

.fullscreen-exit-text {
  font-size: 0.6rem;
  color: #6b7280;
  margin-left: 0.375rem;
  font-family: system-ui, -apple-system, sans-serif;
}

.z-52 { z-index: 52; }

@media (hover: none) and (pointer: coarse) {
  .mobile-control-btn { min-width: 44px; min-height: 44px; }
  .mobile-select { min-height: 44px; }
}
</style>
