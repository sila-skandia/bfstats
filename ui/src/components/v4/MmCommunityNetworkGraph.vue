<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as d3 from 'd3'
import {
  fetchCommunityServerMap,
  type CommunityServerMap,
} from '@/services/playerRelationshipsApi'
import { decodePlayerName } from '@/utils/playerName'

interface BipartiteNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  displayName: string
  type: 'player' | 'server'
  isCore: boolean
  radius: number
  color: string
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface BipartiteLink extends d3.SimulationLinkDatum<BipartiteNode> {
  source: string | BipartiteNode
  target: string | BipartiteNode
  weight: number
  isMemberLink: boolean
}

const props = withDefaults(defineProps<{
  communityId: string
  height?: number
  seamless?: boolean
}>(), {
  height: 600,
  seamless: false,
})

const router = useRouter()

const svgElement = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const wrapperRef = ref<HTMLDivElement | null>(null)
const width = ref(960)
const height = ref(props.height)
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref('')
const hoveredNodeId = ref<string | null>(null)
const mapData = ref<CommunityServerMap | null>(null)
const isFullscreen = ref(false)
const zoomLevel = ref(1)

let simulation: d3.Simulation<BipartiteNode, BipartiteLink> | null = null
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null
let userHasPannedOrZoomed = false
let resizeObserver: ResizeObserver | null = null

const tooltip = ref<{
  visible: boolean
  x: number
  y: number
  node: BipartiteNode | null
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

const playerCount = computed(() => mapData.value?.players.length ?? 0)
const coreCount = computed(() => mapData.value?.players.filter(p => p.isCore).length ?? 0)
const serverCount = computed(() => mapData.value?.servers.length ?? 0)

const connectedNodeIds = computed(() => {
  if (!hoveredNodeId.value) return null
  const focusId = hoveredNodeId.value
  const set = new Set<string>([focusId])
  if (!mapData.value) return set

  const allEdges = [...(mapData.value.edges || []), ...(mapData.value.memberEdges || [])]
  for (const e of allEdges) {
    const s = typeof e.source === 'object' ? (e.source as any).id : e.source
    const t = typeof e.target === 'object' ? (e.target as any).id : e.target
    if (s === focusId) set.add(t)
    if (t === focusId) set.add(s)
  }
  return set
})

const fetchData = async () => {
  if (!props.communityId) return
  loading.value = true
  error.value = null
  userHasPannedOrZoomed = false
  try {
    const data = await fetchCommunityServerMap(props.communityId)
    mapData.value = data
  } catch {
    error.value = 'Failed to load community network map'
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
  if (!svgElement.value || !mapData.value) return
  const { players, servers, edges, memberEdges } = mapData.value
  if (players.length === 0 && servers.length === 0) return

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

  const aspect = Math.min(2.4, Math.max(1.0, w / Math.max(h, 1)))

  const sAngleStep = (2 * Math.PI) / Math.max(1, servers.length)
  const pAngleStep = (2 * Math.PI) / Math.max(1, players.length)

  const nodes: BipartiteNode[] = [
    ...players.map((p, idx) => {
      const angle = idx * pAngleStep
      const dist = Math.min(w, h) * 0.38 + 40
      return {
        id: p.id,
        label: p.label,
        displayName: decodePlayerName(p.label),
        type: 'player' as const,
        isCore: p.isCore,
        radius: p.isCore ? 14 : 9.5,
        color: p.isCore ? '#7da34c' : '#8a8a8a',
        x: cx + Math.cos(angle) * (dist * aspect),
        y: cy + Math.sin(angle) * dist,
      }
    }),
    ...servers.map((s, idx) => {
      const angle = idx * sAngleStep + 0.4
      const dist = Math.min(w, h) * 0.22 + 20
      return {
        id: s.id,
        label: s.label,
        displayName: s.label,
        type: 'server' as const,
        isCore: false,
        radius: 17,
        color: '#5b9bd5',
        x: cx + Math.cos(angle) * (dist * aspect),
        y: cy + Math.sin(angle) * dist,
      }
    })
  ]

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const links: BipartiteLink[] = [
    ...edges
      .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map(e => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        isMemberLink: false,
      })),
    ...(memberEdges || [])
      .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map(e => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        isMemberLink: true,
      }))
  ]

  const svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  const g = svg.append('g').attr('class', 'mm-comm-graph-viewport')

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

  // Links
  const linkG = g.append('g').attr('class', 'mm-comm-graph-links')
  const linkSel = linkG.selectAll('line.mm-comm-link')
    .data(links)
    .enter()
    .append('line')
    .attr('class', 'mm-comm-link')
    .attr('stroke', d => d.isMemberLink ? '#4d6138' : '#384d63')
    .attr('stroke-width', d => d.isMemberLink ? 1 : Math.min(3.5, Math.max(1.2, Math.log2(d.weight + 1) * 0.8)))
    .attr('stroke-opacity', d => d.isMemberLink ? 0 : 0.6) // Member-to-member links hidden by default, reveal on hover
    .attr('stroke-dasharray', d => d.isMemberLink ? '3 3' : 'none')

  // Nodes
  const nodeG = g.append('g').attr('class', 'mm-comm-graph-nodes')
  const nodeSel = nodeG.selectAll('g.mm-comm-node')
    .data(nodes, d => (d as BipartiteNode).id)
    .enter()
    .append('g')
    .attr('class', d => `mm-comm-node mm-comm-node--${d.type}`)
    .style('cursor', 'pointer')

  // Server nodes: distinct rounded square shape
  nodeSel.filter(d => d.type === 'server')
    .append('rect')
    .attr('x', -14)
    .attr('y', -14)
    .attr('width', 28)
    .attr('height', 28)
    .attr('rx', 4)
    .attr('fill', '#192838')
    .attr('stroke', '#5b9bd5')
    .attr('stroke-width', 1.75)

  // Server node icon text (SRV)
  nodeSel.filter(d => d.type === 'server')
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .attr('font-family', 'var(--mm-font-mono)')
    .attr('font-size', 9)
    .attr('font-weight', '700')
    .attr('fill', '#5b9bd5')
    .text('SRV')

  // Player nodes: circle shape
  nodeSel.filter(d => d.type === 'player')
    .append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => d.isCore ? '#273822' : '#222222')
    .attr('stroke', d => d.color)
    .attr('stroke-width', d => d.isCore ? 1.75 : 1.2)

  // Text labels below nodes
  nodeSel.append('text')
    .attr('dy', d => d.radius + 13)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--mm-font-display)')
    .attr('font-size', d => d.type === 'server' ? 10.5 : 8.5)
    .attr('font-weight', d => d.isCore || d.type === 'server' ? '600' : '400')
    .attr('fill', d => d.type === 'server' ? '#a5c9ea' : d.isCore ? '#d2e8b0' : '#8a8a8a')
    .attr('letter-spacing', '0.04em')
    .text(d => {
      const name = d.displayName
      return name.length > 16 ? name.slice(0, 15) + '…' : name
    })

  // Hover highlighting & tooltip
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
      if (d.type === 'server') {
        router.push(`/v4/servers/detail/${encodeURIComponent(d.label)}`)
      } else {
        router.push(`/v4/players/${encodeURIComponent(d.id)}`)
      }
    })

  // Drag interaction
  const drag = d3.drag<SVGGElement, BipartiteNode>()
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
      d.fx = null
      d.fy = null
    })

  nodeSel.call(drag as any)

  const updateHighlighting = () => {
    const activeIds = connectedNodeIds.value
    const searchActive = searchTerms.value.length > 0
    const isHovering = Boolean(hoveredNodeId.value)

    nodeSel.each(function(d) {
      const isMatched = !searchActive || isSearchMatch(d.label)
      const isConnected = !activeIds || activeIds.has(d.id)
      const opacity = isMatched && isConnected ? 1 : (isHovering ? 0.15 : 1)
      d3.select(this)
        .transition()
        .duration(120)
        .attr('opacity', opacity)
    })

    linkSel.each(function(d) {
      const sId = typeof d.source === 'object' ? (d.source as BipartiteNode).id : d.source
      const tId = typeof d.target === 'object' ? (d.target as BipartiteNode).id : d.target
      const isConnected = activeIds && activeIds.has(sId) && activeIds.has(tId)
      const isIncident = hoveredNodeId.value === sId || hoveredNodeId.value === tId

      let opacity = 0
      let strokeColor = d.isMemberLink ? '#4d6138' : '#384d63'

      if (isHovering) {
        if (isConnected) {
          opacity = isIncident ? 0.85 : 0.55
          strokeColor = isIncident ? '#7da34c' : (d.isMemberLink ? '#627c47' : '#5b9bd5')
        } else {
          opacity = 0.04
        }
      } else {
        opacity = d.isMemberLink ? 0 : 0.6
      }

      d3.select(this)
        .transition()
        .duration(120)
        .attr('stroke-opacity', opacity)
        .attr('stroke', strokeColor)
    })
  }

  // Generous force simulation
  simulation = d3.forceSimulation<BipartiteNode, BipartiteLink>(nodes)
    .force('link', d3.forceLink<BipartiteNode, BipartiteLink>(links)
      .id(d => d.id)
      .distance(d => d.isMemberLink ? 120 : 170)
      .strength(d => d.isMemberLink ? 0.35 : 0.6)
    )
    .force('charge', d3.forceManyBody<BipartiteNode>().strength(d => d.type === 'server' ? -700 : -320))
    .force('x', d3.forceX(cx).strength(0.025 / aspect))
    .force('y', d3.forceY(cy).strength(0.04))
    .force('collide', d3.forceCollide<BipartiteNode>(d => d.radius + 26).strength(0.9))
    .alpha(0.8)
    .alphaDecay(0.028)
    .on('tick', () => {
      linkSel
        .attr('x1', d => (d.source as BipartiteNode).x!)
        .attr('y1', d => (d.source as BipartiteNode).y!)
        .attr('x2', d => (d.target as BipartiteNode).x!)
        .attr('y2', d => (d.target as BipartiteNode).y!)

      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
    })

  for (let i = 0; i < 40; ++i) {
    simulation.tick()
  }

  fitView(false)

  simulation.on('end', () => {
    if (!userHasPannedOrZoomed) {
      fitView(true)
    }
  })
}

// HUD Controls
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
    if (mapData.value) renderGraph()
  } else {
    requestAnimationFrame(() => {
      if (wrapperRef.value) {
        const r = wrapperRef.value.getBoundingClientRect()
        if (r.width > 0) {
          width.value = Math.round(r.width)
          height.value = isFullscreen.value ? Math.round(r.height || window.innerHeight - 80) : Math.max(props.height, 480)
          if (mapData.value) renderGraph()
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

watch(wrapperRef, (newEl) => {
  if (newEl) {
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => ensureDimensionsAndRender())
    }
    resizeObserver.observe(newEl)
    ensureDimensionsAndRender()
  }
})

watch(() => props.communityId, () => {
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
    class="mm-comm-net"
    :class="{
      'mm-comm-net--seamless': seamless,
      'mm-comm-net--fullscreen': isFullscreen,
    }"
  >
    <header class="mm-comm-net__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">
          {{ isFullscreen ? 'Fullscreen Community Network Map' : 'Community Network & Server Map' }}
        </div>
        <div class="mm-card__hint">
          Discovers where community members play together · Hover nodes to trace connections · Click to open
        </div>
      </div>

      <div class="mm-comm-net__controls">
        <button
          type="button"
          class="mm-btn mm-btn--inline mm-comm-net__fs-btn"
          @click="toggleFullscreen"
        >
          <span v-if="isFullscreen">✕ Exit Fullscreen (Esc)</span>
          <span v-else>⤢ Fullscreen Canvas</span>
        </button>
      </div>
    </header>

    <div class="mm-comm-net__toolbar">
      <label class="mm-search mm-comm-net__search">
        <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          class="mm-search__input"
          placeholder="Search players or servers…"
        />
      </label>

      <div class="mm-comm-net__legend">
        <span class="mm-chip mm-chip--core">
          <span class="mm-chip__dot" style="background: #7da34c" />
          Core ({{ coreCount }})
        </span>
        <span class="mm-chip mm-chip--member">
          <span class="mm-chip__dot" style="background: #8a8a8a" />
          Members ({{ playerCount }})
        </span>
        <span class="mm-chip mm-chip--server">
          <span class="mm-chip__dot" style="background: #5b9bd5" />
          Servers ({{ serverCount }})
        </span>
      </div>
    </div>

    <div v-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchData">Retry</button>
    </div>

    <div v-else-if="!loading && playerCount === 0" class="mm-empty">
      No server network data available for this community yet.
    </div>

    <div
      ref="wrapperRef"
      class="mm-comm-net__canvas-wrapper"
      :style="{ height: isFullscreen ? '100%' : `${height}px` }"
    >
      <!-- Loading Skeleton Overlay -->
      <div v-if="loading" class="mm-comm-net__loading-overlay">
        <div class="mm-comm-net__spinner" />
        <span class="mm-eyebrow">Mapping community servers…</span>
      </div>

      <div class="mm-comm-net__hint">
        <span>💡 Drag background to pan · Scroll to zoom · Drag nodes to reposition · Hover node to trace links · Click to view details</span>
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

      <svg
        ref="svgElement"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        class="mm-comm-net__svg"
      />

      <!-- High-End Styled Community Tooltip -->
      <transition name="mm-tip-fade">
        <div
          v-if="tooltip.visible && tooltip.node"
          class="mm-comm-tooltip"
          :style="{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            borderTopColor: tooltip.node.color,
          }"
        >
          <div class="mm-comm-tooltip__head">
            <div class="mm-comm-tooltip__name">
              {{ tooltip.node.displayName }}
            </div>
            <span
              class="mm-chip"
              :style="{ borderColor: tooltip.node.color, color: tooltip.node.color, padding: '1px 6px', fontSize: '9.5px' }"
            >
              <span class="mm-chip__dot" :style="{ background: tooltip.node.color, animation: 'none' }" />
              {{ tooltip.node.type === 'server' ? 'Server Node' : tooltip.node.isCore ? 'Core Member' : 'Member' }}
            </span>
          </div>

          <div class="mm-comm-tooltip__stats">
            <div class="mm-comm-tooltip__stat">
              <span class="mm-comm-tooltip__label">Type</span>
              <strong class="mm-comm-tooltip__val">{{ tooltip.node.type === 'server' ? 'Game Server' : 'Community Player' }}</strong>
            </div>
            <div v-if="tooltip.node.type === 'server'" class="mm-comm-tooltip__stat">
              <span class="mm-comm-tooltip__label">GUID</span>
              <span class="mm-comm-tooltip__val is-muted" style="font-family: var(--mm-font-mono); font-size: 9.5px">
                {{ tooltip.node.id.slice(0, 12) }}…
              </span>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <div v-if="playerCount > 0 && !isFullscreen" class="mm-card__foot">
      Showing {{ playerCount }} community members across {{ serverCount }} connected servers
    </div>
  </div>
</template>

<style scoped>
.mm-comm-net {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Fullscreen Overlay Mode */
.mm-comm-net--fullscreen {
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

.mm-comm-net--fullscreen .mm-comm-net__canvas-wrapper {
  flex: 1 1 0 !important;
  height: 100% !important;
  min-height: 0 !important;
}

.mm-comm-net__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-comm-net__controls {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mm-comm-net__fs-btn {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 5px 10px;
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.mm-comm-net__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-comm-net__search {
  max-width: 320px;
  flex: 1 1 220px;
}

.mm-comm-net__legend {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mm-chip--core {
  border-color: #7da34c;
  color: #7da34c;
}

.mm-chip--member {
  border-color: #8a8a8a;
  color: #8a8a8a;
}

.mm-chip--server {
  border-color: #5b9bd5;
  color: #5b9bd5;
}

/* Infinite Canvas */
.mm-comm-net__canvas-wrapper {
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

.mm-comm-net__loading-overlay {
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

.mm-comm-net__spinner {
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

.mm-comm-net__hint {
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

.mm-comm-net__svg {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.mm-comm-net__svg:active {
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

/* Custom Styled Community Tooltip */
.mm-comm-tooltip {
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

.mm-comm-tooltip__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mm-comm-tooltip__name {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.02em;
  word-break: break-word;
}

.mm-comm-tooltip__stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--mm-rule);
  padding-top: 6px;
}

.mm-comm-tooltip__stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
}

.mm-comm-tooltip__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.mm-comm-tooltip__val {
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
  .mm-comm-net--fullscreen {
    padding: 12px 14px !important;
  }
}
</style>
