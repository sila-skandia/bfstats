<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import {
  fetchPlayerNetworkGraph,
  type PlayerNetworkGraph,
} from '@/services/playerRelationshipsApi'
import { decodePlayerName } from '@/utils/playerName'

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  displayName: string
  degree: number // 0 = center, 1 = direct, 2 = 2nd degree
  weight: number
  radius: number
  color: string
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
  weight: number
  lastInteraction: string
  isDirect: boolean
}

const props = withDefaults(defineProps<{
  playerName: string
  height?: number
  seamless?: boolean
}>(), {
  height: 600,
  seamless: false,
})

const emit = defineEmits<{
  (e: 'player-click', playerName: string): void
}>()

const svgElement = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const wrapperRef = ref<HTMLDivElement | null>(null)
const width = ref(960)
const height = ref(props.height)
const loading = ref(false)
const error = ref<string | null>(null)
const depth = ref(2)
const searchQuery = ref('')
const hoveredNodeId = ref<string | null>(null)
const selectedNodeId = ref<string | null>(null)
const graphData = ref<PlayerNetworkGraph | null>(null)
const isFullscreen = ref(false)
const zoomLevel = ref(1)

let simulation: d3.Simulation<GraphNode, GraphLink> | null = null
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null
let userHasPannedOrZoomed = false
let resizeObserver: ResizeObserver | null = null

const tooltip = ref<{
  visible: boolean
  x: number
  y: number
  node: GraphNode | null
}>({
  visible: false,
  x: 0,
  y: 0,
  node: null,
})

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

const directAlliesCount = computed(() => {
  return graphData.value?.nodes.filter(n => n.degree === 1).length ?? 0
})

const extendedAlliesCount = computed(() => {
  return graphData.value?.nodes.filter(n => n.degree === 2).length ?? 0
})

const totalConnectionsCount = computed(() => {
  return (graphData.value?.nodes.length ?? 1) - 1
})

const connectedNodeIds = computed(() => {
  if (!hoveredNodeId.value && !selectedNodeId.value) return null
  const focusId = hoveredNodeId.value || selectedNodeId.value
  const set = new Set<string>([focusId!])
  if (!graphData.value) return set

  for (const e of graphData.value.edges) {
    const s = typeof e.source === 'object' ? (e.source as GraphNode).id : e.source
    const t = typeof e.target === 'object' ? (e.target as GraphNode).id : e.target
    if (s === focusId) set.add(t)
    if (t === focusId) set.add(s)
  }
  return set
})

const fetchData = async () => {
  if (!props.playerName) return
  loading.value = true
  error.value = null
  userHasPannedOrZoomed = false
  try {
    const data = await fetchPlayerNetworkGraph(props.playerName, depth.value, 120)
    graphData.value = data
  } catch {
    error.value = 'Failed to load network graph data'
  } finally {
    loading.value = false
    await nextTick()
    ensureDimensionsAndRender()
  }
}

/**
 * Computes exact bounding box of all nodes and fits the whole graph inside
 * available width & height with comfortable padding.
 */
const fitView = (animate = true) => {
  if (!svgElement.value || !zoomBehavior || !simulation) return
  const nodes = simulation.nodes()
  if (nodes.length === 0) return

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of nodes) {
    const r = (n.radius || 15) + 20
    const x = n.x ?? width.value / 2
    const y = n.y ?? height.value / 2
    if (x - r < minX) minX = x - r
    if (x + r > maxX) maxX = x + r
    if (y - r < minY) minY = y - r
    if (y + r > maxY) maxY = y + r
  }

  const graphW = Math.max(maxX - minX, 100)
  const graphH = Math.max(maxY - minY, 100)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  const w = width.value || 960
  const h = height.value || 600
  const padding = Math.min(w, h) * 0.07 + 28

  const scaleX = (w - padding * 2) / graphW
  const scaleY = (h - padding * 2) / graphH
  const k = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 2.2)

  const tx = w / 2 - midX * k
  const ty = h / 2 - midY * k

  const transform = d3.zoomIdentity.translate(tx, ty).scale(k)
  const sel = d3.select(svgElement.value)
  if (animate) {
    sel.transition().duration(450).ease(d3.easeCubicOut).call(zoomBehavior.transform, transform)
  } else {
    sel.call(zoomBehavior.transform, transform)
  }
  zoomLevel.value = k
}

const renderGraph = () => {
  if (!svgElement.value || !graphData.value || graphData.value.nodes.length === 0) return

  simulation?.stop()
  simulation = null

  if (wrapperRef.value) {
    const rect = wrapperRef.value.getBoundingClientRect()
    if (rect.width > 0) width.value = Math.round(rect.width)
    if (rect.height > 0) height.value = isFullscreen.value ? Math.round(rect.height) : Math.max(props.height, 480)
  }

  const w = width.value
  const h = height.value
  const cx = w / 2
  const cy = h / 2

  // Aspect ratio awareness for widescreen displays (1920x1080)
  const aspect = Math.min(2.4, Math.max(1.0, w / Math.max(h, 1)))

  const rawNodes = graphData.value.nodes
  const rawEdges = graphData.value.edges
  const maxWeight = Math.max(1, ...rawEdges.map(e => e.weight))

  const sizeScale = d3.scaleSqrt().domain([1, maxWeight]).range([7, 18])

  // Wide elliptical spread initial placement
  const directNodes = rawNodes.filter(n => n.degree === 1)
  const extNodes = rawNodes.filter(n => n.degree === 2)
  const dAngleStep = (2 * Math.PI) / Math.max(1, directNodes.length)
  const eAngleStep = (2 * Math.PI) / Math.max(1, extNodes.length)

  const nodes: GraphNode[] = rawNodes.map(n => {
    const isCenter = n.id === props.playerName || n.degree === 0
    const isDirect = n.degree === 1
    const radius = isCenter ? 22 : isDirect ? Math.max(10, sizeScale(n.weight || 1)) : 7.5
    const color = isCenter ? '#7da34c' : isDirect ? '#9ab85c' : '#8a8a8a'

    let initX = cx
    let initY = cy

    if (isDirect) {
      const idx = directNodes.findIndex(d => d.id === n.id)
      const angle = idx * dAngleStep
      const dist = Math.min(w, h) * 0.32 + 40
      initX = cx + Math.cos(angle) * (dist * aspect)
      initY = cy + Math.sin(angle) * dist
    } else if (!isCenter) {
      const idx = extNodes.findIndex(e => e.id === n.id)
      const angle = idx * eAngleStep + 0.35
      const dist = Math.min(w, h) * 0.48 + 60
      initX = cx + Math.cos(angle) * (dist * aspect)
      initY = cy + Math.sin(angle) * dist
    }

    return {
      id: n.id,
      label: n.label,
      displayName: decodePlayerName(n.label),
      degree: isCenter ? 0 : isDirect ? 1 : 2,
      weight: n.weight || 0,
      radius,
      color,
      x: initX,
      y: initY,
      fx: isCenter ? cx : null,
      fy: isCenter ? cy : null,
    }
  })

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const links: GraphLink[] = rawEdges
    .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map(e => {
      const isDirect = e.source === props.playerName || e.target === props.playerName
      return {
        source: e.source,
        target: e.target,
        weight: e.weight,
        lastInteraction: e.lastInteraction,
        isDirect,
      }
    })

  const svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  const g = svg.append('g').attr('class', 'mm-graph-viewport')

  zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 4.5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
      zoomLevel.value = event.transform.k
    })
    .on('start', (event) => {
      if (event.sourceEvent) userHasPannedOrZoomed = true
    })

  svg.call(zoomBehavior)
    .on('dblclick.zoom', null)

  // Links group
  // Noise Reduction: Non-direct dashed links have opacity 0 by default so the graph is crystal clear.
  // They only light up smoothly when you hover over a connected player!
  const linkG = g.append('g').attr('class', 'mm-graph-links')
  const linkSel = linkG.selectAll('line.mm-graph-link')
    .data(links)
    .enter()
    .append('line')
    .attr('class', 'mm-graph-link')
    .attr('stroke', d => d.isDirect ? '#7da34c' : '#777777')
    .attr('stroke-width', d => d.isDirect ? Math.min(4.5, Math.max(1.2, Math.log2(d.weight + 1) * 0.9)) : 1)
    .attr('stroke-opacity', d => d.isDirect ? 0.65 : 0) // Hidden by default if non-direct!
    .attr('stroke-dasharray', d => d.isDirect ? 'none' : '3 3')

  // Nodes group
  const nodeG = g.append('g').attr('class', 'mm-graph-nodes')
  const nodeSel = nodeG.selectAll('g.mm-graph-node')
    .data(nodes, d => (d as GraphNode).id)
    .enter()
    .append('g')
    .attr('class', d => `mm-graph-node mm-graph-node--d${d.degree}`)
    .style('cursor', 'pointer')

  // Node circle disc
  nodeSel.append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => d.degree === 0 ? '#1b2a18' : d.degree === 1 ? '#273822' : '#222222')
    .attr('stroke', d => d.color)
    .attr('stroke-width', d => d.degree === 0 ? 2.5 : d.degree === 1 ? 1.75 : 1.2)

  // Center focal badge inner ring
  nodeSel.filter(d => d.degree === 0)
    .append('circle')
    .attr('r', 12)
    .attr('fill', '#7da34c')
    .attr('opacity', 0.85)

  // Text labels
  nodeSel.append('text')
    .attr('dy', d => d.radius + 13)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--mm-font-display)')
    .attr('font-size', d => d.degree === 0 ? 12 : d.degree === 1 ? 10 : 8.5)
    .attr('font-weight', d => d.degree === 0 ? '700' : d.degree === 1 ? '600' : '400')
    .attr('fill', d => d.degree === 0 ? '#ffffff' : d.degree === 1 ? '#dddddd' : '#8a8a8a')
    .attr('letter-spacing', '0.04em')
    .text(d => {
      const name = d.displayName
      return name.length > 16 ? name.slice(0, 15) + '…' : name
    })

  // Hover and Click events
  nodeSel
    .on('mouseenter', (event: MouseEvent, d) => {
      hoveredNodeId.value = d.id
      const rect = wrapperRef.value?.getBoundingClientRect()
      if (rect) {
        const mouseX = event.clientX - rect.left
        const mouseY = event.clientY - rect.top
        const tipX = mouseX + 240 > rect.width ? mouseX - 230 : mouseX + 14
        const tipY = mouseY + 110 > rect.height ? mouseY - 85 : mouseY + 14
        tooltip.value = {
          visible: true,
          x: Math.max(8, tipX),
          y: Math.max(8, tipY),
          node: d,
        }
      }
      updateHighlighting()
    })
    .on('mousemove', (event: MouseEvent) => {
      const rect = wrapperRef.value?.getBoundingClientRect()
      if (rect && tooltip.value.visible) {
        const mouseX = event.clientX - rect.left
        const mouseY = event.clientY - rect.top
        const tipX = mouseX + 240 > rect.width ? mouseX - 230 : mouseX + 14
        const tipY = mouseY + 110 > rect.height ? mouseY - 85 : mouseY + 14
        tooltip.value.x = Math.max(8, tipX)
        tooltip.value.y = Math.max(8, tipY)
      }
    })
    .on('mouseleave', () => {
      hoveredNodeId.value = null
      tooltip.value.visible = false
      updateHighlighting()
    })
    .on('click', (_event, d) => {
      emit('player-click', d.id)
    })

  // Drag interaction with D3 force
  const drag = d3.drag<SVGGElement, GraphNode>()
    .on('start', (event, d) => {
      userHasPannedOrZoomed = true
      if (!event.active) simulation?.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    })
    .on('drag', (event, d) => {
      d.fx = event.x
      d.fy = event.y
    })
    .on('end', (event, d) => {
      if (!event.active) simulation?.alphaTarget(0)
      if (d.degree !== 0) {
        d.fx = null
        d.fy = null
      }
    })

  nodeSel.call(drag as any)

  const updateHighlighting = () => {
    const activeIds = connectedNodeIds.value
    const searchActive = searchTerms.value.length > 0
    const isHovering = Boolean(hoveredNodeId.value || selectedNodeId.value)

    nodeSel.each(function(d) {
      const isMatched = !searchActive || isSearchMatch(d.label)
      const isConnected = !activeIds || activeIds.has(d.id)
      const opacity = isMatched && isConnected ? 1 : (isHovering ? 0.12 : 1)
      d3.select(this)
        .transition()
        .duration(120)
        .attr('opacity', opacity)
    })

    linkSel.each(function(d) {
      const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source
      const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target
      const isConnected = activeIds && activeIds.has(sId) && activeIds.has(tId)
      const isIncident = hoveredNodeId.value === sId || hoveredNodeId.value === tId

      let opacity = 0
      let strokeColor = d.isDirect ? '#7da34c' : '#777777'

      if (isHovering) {
        if (isConnected) {
          opacity = isIncident ? 0.9 : 0.65
          strokeColor = isIncident ? '#9ab85c' : (d.isDirect ? '#7da34c' : '#8a8a8a')
        } else {
          opacity = 0.04
        }
      } else {
        // Clean default: ONLY solid direct links shown!
        opacity = d.isDirect ? 0.6 : 0
      }

      d3.select(this)
        .transition()
        .duration(120)
        .attr('stroke-opacity', opacity)
        .attr('stroke', strokeColor)
    })
  }

  // Generous widescreen force simulation layout
  const linkDistDirect = Math.max(160, Math.min(w * 0.36, h * 0.44))
  const linkDistExt = Math.max(105, Math.min(w * 0.24, h * 0.32))

  simulation = d3.forceSimulation<GraphNode, GraphLink>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphLink>(links)
      .id(d => d.id)
      .distance(d => d.isDirect ? linkDistDirect : linkDistExt)
      .strength(d => d.isDirect ? 0.6 : 0.35)
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength(d => d.degree === 0 ? -900 : d.degree === 1 ? -450 : -200))
    .force('x', d3.forceX(cx).strength(0.025 / aspect))
    .force('y', d3.forceY(cy).strength(0.04))
    .force('collide', d3.forceCollide<GraphNode>(d => d.radius + 26).strength(0.9))
    .alpha(0.8)
    .alphaDecay(0.028)
    .on('tick', () => {
      linkSel
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!)

      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
    })

  // Synchronous warm-up ticks for instant expansive layout
  for (let i = 0; i < 40; ++i) {
    simulation.tick()
  }

  // Initial auto-fit
  fitView(false)

  simulation.on('end', () => {
    if (!userHasPannedOrZoomed) {
      fitView(true)
    }
  })
}

// HUD controls
const handleZoomIn = () => {
  if (!svgElement.value || !zoomBehavior) return
  userHasPannedOrZoomed = true
  d3.select(svgElement.value).transition().duration(250).call(zoomBehavior.scaleBy, 1.3)
}

const handleZoomOut = () => {
  if (!svgElement.value || !zoomBehavior) return
  userHasPannedOrZoomed = true
  d3.select(svgElement.value).transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.3)
}

const handleFitView = () => {
  fitView(true)
}

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  if (isFullscreen.value) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
  userHasPannedOrZoomed = false
  nextTick(() => {
    ensureDimensionsAndRender()
  })
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isFullscreen.value) {
    toggleFullscreen()
  }
}

const ensureDimensionsAndRender = () => {
  if (!wrapperRef.value) return
  const rect = wrapperRef.value.getBoundingClientRect()
  if (rect.width > 0) {
    width.value = Math.round(rect.width)
    height.value = isFullscreen.value ? Math.round(rect.height || window.innerHeight - 80) : Math.max(props.height, 480)
    if (graphData.value) {
      renderGraph()
    }
  } else {
    requestAnimationFrame(() => {
      if (wrapperRef.value) {
        const r = wrapperRef.value.getBoundingClientRect()
        if (r.width > 0) {
          width.value = Math.round(r.width)
          height.value = isFullscreen.value ? Math.round(r.height || window.innerHeight - 80) : Math.max(props.height, 480)
          if (graphData.value) renderGraph()
        }
      }
    })
  }
}

onMounted(() => {
  fetchData()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', ensureDimensionsAndRender)
  if (wrapperRef.value) {
    resizeObserver = new ResizeObserver(() => ensureDimensionsAndRender())
    resizeObserver.observe(wrapperRef.value)
  }
})

// Observe wrapperRef whenever it enters or leaves DOM
watch(wrapperRef, (newEl) => {
  if (newEl) {
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => ensureDimensionsAndRender())
    }
    resizeObserver.observe(newEl)
    ensureDimensionsAndRender()
  }
})

watch(() => props.playerName, () => {
  fetchData()
})

watch(depth, () => {
  fetchData()
})

watch(searchQuery, () => {
  renderGraph()
})

onUnmounted(() => {
  if (isFullscreen.value) {
    document.body.style.overflow = ''
  }
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', ensureDimensionsAndRender)
  simulation?.stop()
  simulation = null
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    ref="containerRef"
    class="mm-net-viz"
    :class="{
      'mm-net-viz--seamless': seamless,
      'mm-net-viz--fullscreen': isFullscreen,
    }"
  >
    <!-- Fullscreen Top Bar / Normal Header -->
    <header class="mm-net-viz__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">
          {{ isFullscreen ? 'Fullscreen Network Canvas' : 'Ally Network Graph' }}
          <span v-if="isFullscreen" class="mm-display__muted" style="margin-left: 6px">· {{ decodePlayerName(playerName) }}</span>
        </div>
        <div class="mm-card__hint">
          Interactive 2-hop social map · Hover any player to reveal their extended network · Click node to open profile
        </div>
      </div>

      <div class="mm-net-viz__controls">
        <label class="mm-net-viz__control">
          <span class="mm-eyebrow">Reach</span>
          <select v-model.number="depth" class="mm-net-viz__select">
            <option :value="1">Direct Squad (1-hop)</option>
            <option :value="2">+ Friends of Friends (2-hop)</option>
          </select>
        </label>

        <button
          type="button"
          class="mm-btn mm-btn--inline mm-net-viz__fs-btn"
          @click="toggleFullscreen"
        >
          <span v-if="isFullscreen">✕ Exit Fullscreen (Esc)</span>
          <span v-else>⤢ Fullscreen Canvas</span>
        </button>
      </div>
    </header>

    <!-- Toolbar / Search / Legend -->
    <div class="mm-net-viz__toolbar">
      <label class="mm-search mm-net-viz__search">
        <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          class="mm-search__input"
          placeholder="Filter network players (comma-separated)…"
        />
      </label>

      <div class="mm-net-viz__legend">
        <span class="mm-chip mm-chip--center">
          <span class="mm-chip__dot" style="background: #ffffff" />
          {{ decodePlayerName(playerName) }}
        </span>
        <span class="mm-chip mm-chip--direct">
          <span class="mm-chip__dot" style="background: #7da34c" />
          Direct Allies ({{ directAlliesCount }})
        </span>
        <span v-if="depth >= 2" class="mm-chip mm-chip--fof">
          <span class="mm-chip__dot" style="background: #8a8a8a" />
          Extended Squad ({{ extendedAlliesCount }})
        </span>
      </div>
    </div>

    <div v-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchData">Retry</button>
    </div>

    <div v-else-if="!loading && totalConnectionsCount === 0" class="mm-empty">
      No co-play network history recorded for {{ decodePlayerName(playerName) }} yet.
    </div>

    <!-- Canvas Wrapper (always in DOM so dimensions and ResizeObserver initialize on first frame) -->
    <div
      ref="wrapperRef"
      class="mm-net-viz__canvas-wrapper"
      :style="{ height: isFullscreen ? '100%' : `${height}px` }"
    >
      <!-- Loading Skeleton Overlay -->
      <div v-if="loading" class="mm-net-viz__loading-overlay">
        <div class="mm-net-viz__spinner" />
        <span class="mm-eyebrow">Mapping social network…</span>
      </div>

      <div class="mm-net-viz__hint">
        <span>💡 Drag background to pan · Scroll to zoom · Drag nodes to reposition · Hover node to reveal connections · Click node to view profile</span>
      </div>

      <!-- Floating HUD Controls -->
      <div class="mm-canvas-hud">
        <button
          type="button"
          class="mm-canvas-hud__btn"
          title="Zoom out"
          @click="handleZoomOut"
        >
          −
        </button>
        <button
          type="button"
          class="mm-canvas-hud__label"
          title="Fit graph to canvas"
          @click="handleFitView"
        >
          {{ Math.round(zoomLevel * 100) }}%
        </button>
        <button
          type="button"
          class="mm-canvas-hud__btn"
          title="Zoom in"
          @click="handleZoomIn"
        >
          +
        </button>
        <div class="mm-canvas-hud__divider" />
        <button
          type="button"
          class="mm-canvas-hud__btn mm-canvas-hud__btn--wide"
          title="Fit view / Recenter and fill canvas"
          @click="handleFitView"
        >
          ⛶ Fit
        </button>
        <button
          type="button"
          class="mm-canvas-hud__btn mm-canvas-hud__btn--wide"
          :title="isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'"
          @click="toggleFullscreen"
        >
          {{ isFullscreen ? '✕ Exit' : '⤢ Fullscreen' }}
        </button>
      </div>

      <!-- SVG Canvas -->
      <svg
        ref="svgElement"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        class="mm-net-viz__svg"
      />

      <!-- High-End Styled Custom Tooltip -->
      <transition name="mm-tip-fade">
        <div
          v-if="tooltip.visible && tooltip.node"
          class="mm-net-tooltip"
          :style="{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            borderTopColor: tooltip.node.color,
          }"
        >
          <div class="mm-net-tooltip__head">
            <div class="mm-net-tooltip__name">
              {{ tooltip.node.displayName }}
            </div>
            <span
              class="mm-chip"
              :style="{ borderColor: tooltip.node.color, color: tooltip.node.color, padding: '1px 6px', fontSize: '9.5px' }"
            >
              <span class="mm-chip__dot" :style="{ background: tooltip.node.color, animation: 'none' }" />
              {{ tooltip.node.degree === 0 ? 'Focal Player' : tooltip.node.degree === 1 ? 'Direct Squadmate' : 'Connected Ally' }}
            </span>
          </div>

          <div class="mm-net-tooltip__stats">
            <div v-if="tooltip.node.weight > 0" class="mm-net-tooltip__stat">
              <span class="mm-net-tooltip__label">Co-rounds</span>
              <strong class="mm-net-tooltip__val">{{ tooltip.node.weight }}</strong>
            </div>
            <div class="mm-net-tooltip__stat">
              <span class="mm-net-tooltip__label">Network Reach</span>
              <span class="mm-net-tooltip__val is-muted">
                {{ tooltip.node.degree === 0 ? 'Center Anchor' : tooltip.node.degree === 1 ? '1st Degree (Direct Ally)' : '2nd Degree (Top 5 of Ally)' }}
              </span>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <div v-if="totalConnectionsCount > 0 && !isFullscreen" class="mm-card__foot">
      Graphing {{ totalConnectionsCount }} network connections across {{ directAlliesCount }} direct squadmates & their top co-players
    </div>
  </div>
</template>

<style scoped>
.mm-net-viz {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Fullscreen Overlay Mode */
.mm-net-viz--fullscreen {
  position: fixed !important;
  inset: 0 !important;
  z-index: 99999 !important;
  width: 100vw !important;
  height: 100vh !important;
  background: var(--mm-bg) !important;
  padding: 18px 24px !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
  gap: 12px !important;
}

.mm-net-viz--fullscreen .mm-net-viz__canvas-wrapper {
  flex: 1 1 0 !important;
  height: 100% !important;
  min-height: 0 !important;
}

.mm-net-viz__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-net-viz__controls {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mm-net-viz__control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-net-viz__select {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 5px 8px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink);
  border-radius: 2px;
}

.mm-net-viz__fs-btn {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 5px 10px;
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.mm-net-viz__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-net-viz__search {
  max-width: 340px;
  flex: 1 1 240px;
}

.mm-net-viz__legend {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mm-chip--center {
  border-color: #ffffff;
  color: #ffffff;
}

.mm-chip--direct {
  border-color: #7da34c;
  color: #7da34c;
}

.mm-chip--fof {
  border-color: #8a8a8a;
  color: #8a8a8a;
}

/* Infinite Canvas */
.mm-net-viz__canvas-wrapper {
  position: relative;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 3px;
  background-color: var(--mm-bg-soft);
  background-image: radial-gradient(var(--mm-rule-strong) 1.2px, transparent 1.2px);
  background-size: 28px 28px;
  background-position: 0 0;
  overflow: hidden;
  user-select: none;
  min-height: 440px;
}

.mm-net-viz__loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(18, 20, 19, 0.85);
  backdrop-filter: blur(6px);
}

.mm-net-viz__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--mm-rule);
  border-top-color: var(--mm-accent);
  border-radius: 50%;
  animation: mm-spin 0.8s linear infinite;
}

@keyframes mm-spin {
  to { transform: rotate(360deg); }
}

.mm-net-viz__hint {
  position: absolute;
  top: 10px;
  left: 14px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: var(--mm-ink-muted);
  letter-spacing: 0.04em;
  pointer-events: none;
  z-index: 5;
  background: rgba(18, 20, 19, 0.7);
  padding: 3px 8px;
  border-radius: 2px;
  backdrop-filter: blur(4px);
}

.mm-net-viz__svg {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.mm-net-viz__svg:active {
  cursor: grabbing;
}

/* Floating HUD Widget */
.mm-canvas-hud {
  position: absolute;
  bottom: 14px;
  right: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  background: rgba(18, 20, 19, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 4px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  padding: 3px 4px;
  gap: 2px;
}

.mm-canvas-hud__btn {
  background: none;
  border: 0;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 600;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.mm-canvas-hud__btn:hover {
  background: var(--mm-bg-mute);
  color: var(--mm-accent);
}

.mm-canvas-hud__btn--wide {
  width: auto;
  padding: 0 8px;
  font-size: 11px;
}

.mm-canvas-hud__label {
  background: none;
  border: 0;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  padding: 0 6px;
  height: 28px;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.mm-canvas-hud__label:hover {
  color: var(--mm-ink);
}

.mm-canvas-hud__divider {
  width: 1px;
  height: 16px;
  background: var(--mm-rule);
  margin: 0 2px;
}

/* Custom Styled Network Tooltip */
.mm-net-tooltip {
  position: absolute;
  z-index: 100;
  pointer-events: none;
  min-width: 210px;
  max-width: 290px;
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

.mm-net-tooltip__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mm-net-tooltip__name {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.02em;
  word-break: break-word;
}

.mm-net-tooltip__stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--mm-rule);
  padding-top: 6px;
}

.mm-net-tooltip__stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
}

.mm-net-tooltip__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.mm-net-tooltip__val {
  font-family: var(--mm-font-display);
  color: var(--mm-ink);
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

@media (max-width: 640px) {
  .mm-net-viz--fullscreen {
    padding: 12px 14px !important;
  }
}
</style>
