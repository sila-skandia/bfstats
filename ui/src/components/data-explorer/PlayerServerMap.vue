<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import { fetchPlayerServerMap, fetchCommunityServerMap, type CommunityServerMap } from '@/services/playerRelationshipsApi'

const SERVER_COLOR = '#8b5cf6'
const PLAYER_COLOR = '#22d3ee'

const props = defineProps<{
  playerName?: string
  communityId?: string
}>()

const emit = defineEmits<{
  (e: 'player-click', name: string): void
}>()

const svgElement = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const width = ref(600)
const height = ref(600)
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref('')
const zoomTransform = ref<d3.ZoomTransform>(d3.zoomIdentity)
const isFullscreen = ref(false)
const rawData = ref<CommunityServerMap | null>(null)
const hoveredNode = ref<GraphNode | null>(null)
let simulation: d3.Simulation<GraphNode, GraphEdge> | null = null

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  type: 'player' | 'server'
  weight: number // total session weight across all edges
  edgeCount: number
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  weight: number
}

const graphNodes = ref<GraphNode[]>([])
const graphEdges = ref<GraphEdge[]>([])

const searchTerms = computed(() => {
  const raw = searchQuery.value.trim().toLowerCase()
  if (!raw) return []
  return raw.split(',').map(t => t.trim()).filter(t => t.length > 0)
})

const isSearchMatch = (label: string) => {
  if (searchTerms.value.length === 0) return false
  const lower = label.toLowerCase()
  return searchTerms.value.some(t => lower.includes(t))
}

const serverCount = computed(() => graphNodes.value.filter(n => n.type === 'server').length)
const playerCount = computed(() => graphNodes.value.filter(n => n.type === 'player').length)

const fetchData = async () => {
  loading.value = true
  error.value = null
  try {
    if (props.communityId) {
      rawData.value = await fetchCommunityServerMap(props.communityId)
    } else if (props.playerName) {
      rawData.value = await fetchPlayerServerMap(props.playerName)
    } else {
      error.value = 'No player or community specified'
      loading.value = false
      return
    }

    buildGraph()
    await nextTick()
    renderGraph()
  } catch {
    error.value = 'Failed to load server map'
  } finally {
    loading.value = false
  }
}

const buildGraph = () => {
  if (!rawData.value) return

  const data = rawData.value
  const nodeMap = new Map<string, GraphNode>()

  // Build server nodes
  for (const s of data.servers) {
    nodeMap.set(s.id, {
      id: s.id,
      label: s.label,
      type: 'server',
      weight: 0,
      edgeCount: 0,
    })
  }

  // Build player nodes
  for (const p of data.players) {
    nodeMap.set(p.id, {
      id: p.id,
      label: p.label,
      type: 'player',
      weight: 0,
      edgeCount: 0,
    })
  }

  // Accumulate weights from edges
  const edges: GraphEdge[] = []
  for (const edge of data.edges) {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (!sourceNode || !targetNode) continue

    sourceNode.weight += edge.weight
    sourceNode.edgeCount++
    targetNode.weight += edge.weight
    targetNode.edgeCount++

    edges.push({
      source: sourceNode,
      target: targetNode,
      weight: edge.weight,
    })
  }

  graphNodes.value = Array.from(nodeMap.values())
  graphEdges.value = edges
}

const resetZoom = () => {
  if (!svgElement.value) return
  const svg = d3.select(svgElement.value)
  const zoomBeh = (svg.node() as any).__zoom_behavior
  if (zoomBeh) {
    svg.transition().duration(300).call(zoomBeh.transform, d3.zoomIdentity)
  }
}

const renderGraph = () => {
  if (!svgElement.value) return
  if (simulation) { simulation.stop(); simulation = null }

  const nodes = graphNodes.value
  const edges = graphEdges.value
  if (nodes.length === 0) {
    d3.select(svgElement.value).selectAll('*').remove()
    return
  }

  const w = width.value
  const h = height.value
  const cx = w / 2
  const cy = h / 2

  const maxWeight = Math.max(...nodes.map(n => n.weight), 1)

  const serverSizeScale = d3.scaleSqrt().domain([1, maxWeight]).range([8, 28])
  const playerSizeScale = d3.scaleSqrt().domain([1, maxWeight]).range([3, 12])

  const svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  const defs = svg.append('defs')
  const filter = defs.append('filter').attr('id', 'glow')
  filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
  const fMerge = filter.append('feMerge')
  fMerge.append('feMergeNode').attr('in', 'blur')
  fMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  const g = svg.append('g')

  // Zoom
  const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 6])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
      zoomTransform.value = event.transform
    })
  svg.call(zoomBehavior);
  (svg.node() as any).__zoom_behavior = zoomBehavior
  if (zoomTransform.value !== d3.zoomIdentity) {
    svg.call(zoomBehavior.transform, zoomTransform.value)
  }

  // Edge weight scale for line opacity/width
  const edgeMaxWeight = Math.max(...edges.map(e => e.weight), 1)
  const edgeOpacityScale = d3.scaleLinear().domain([1, edgeMaxWeight]).range([0.05, 0.4])
  const edgeWidthScale = d3.scaleLinear().domain([1, edgeMaxWeight]).range([0.5, 2.5])

  // Draw edges
  const linkElements = g.selectAll('.edge')
    .data(edges)
    .enter()
    .append('line')
    .attr('class', 'edge')
    .attr('stroke', '#555')
    .attr('stroke-width', d => edgeWidthScale(d.weight))
    .attr('opacity', d => edgeOpacityScale(d.weight))

  // Draw nodes
  const nodeElements = g.selectAll('.graph-node')
    .data(nodes)
    .enter()
    .append('g')
    .attr('class', 'graph-node')
    .style('cursor', 'pointer')
    .on('mouseenter', (_event: MouseEvent, d: GraphNode) => {
      hoveredNode.value = d
      // Highlight connected edges
      linkElements
        .attr('opacity', (ld: GraphEdge) => {
          const s = ld.source as GraphNode
          const t = ld.target as GraphNode
          return (s.id === d.id || t.id === d.id) ? 0.7 : 0.02
        })
        .attr('stroke', (ld: GraphEdge) => {
          const s = ld.source as GraphNode
          const t = ld.target as GraphNode
          return (s.id === d.id || t.id === d.id) ? (d.type === 'server' ? SERVER_COLOR : PLAYER_COLOR) : '#555'
        })
        .attr('stroke-width', (ld: GraphEdge) => {
          const s = ld.source as GraphNode
          const t = ld.target as GraphNode
          return (s.id === d.id || t.id === d.id) ? edgeWidthScale(ld.weight) * 2 : edgeWidthScale(ld.weight)
        })
      // Dim non-connected nodes
      nodeElements.attr('opacity', (nd: GraphNode) => {
        if (nd.id === d.id) return 1
        const connected = edges.some(e => {
          const s = (e.source as GraphNode).id
          const t = (e.target as GraphNode).id
          return (s === d.id && t === nd.id) || (t === d.id && s === nd.id)
        })
        return connected ? 1 : 0.15
      })
    })
    .on('mouseleave', () => {
      hoveredNode.value = null
      linkElements
        .attr('opacity', (d: GraphEdge) => edgeOpacityScale(d.weight))
        .attr('stroke', '#555')
        .attr('stroke-width', (d: GraphEdge) => edgeWidthScale(d.weight))
      nodeElements.attr('opacity', 1)
    })
    .on('click', (_event: MouseEvent, d: GraphNode) => {
      if (d.type === 'server') {
        window.location.href = `/servers/${encodeURIComponent(d.label)}`
      } else {
        emit('player-click', d.label)
      }
    })
    .call(d3.drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
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
    )

  // Server nodes: rounded rectangles
  nodeElements.filter((d: GraphNode) => d.type === 'server')
    .append('rect')
    .attr('width', (d: GraphNode) => serverSizeScale(d.weight) * 2.2)
    .attr('height', (d: GraphNode) => serverSizeScale(d.weight) * 1.2)
    .attr('x', (d: GraphNode) => -serverSizeScale(d.weight) * 1.1)
    .attr('y', (d: GraphNode) => -serverSizeScale(d.weight) * 0.6)
    .attr('rx', 4)
    .attr('fill', SERVER_COLOR)
    .attr('opacity', (d: GraphNode) => isSearchMatch(d.label) ? 1 : 0.8)
    .attr('stroke', (d: GraphNode) => isSearchMatch(d.label) ? '#fff' : SERVER_COLOR)
    .attr('stroke-width', (d: GraphNode) => isSearchMatch(d.label) ? 2 : 1)
    .attr('stroke-opacity', (d: GraphNode) => isSearchMatch(d.label) ? 0.9 : 0.3)

  // Player nodes: circles
  nodeElements.filter((d: GraphNode) => d.type === 'player')
    .append('circle')
    .attr('r', (d: GraphNode) => playerSizeScale(d.weight))
    .attr('fill', PLAYER_COLOR)
    .attr('opacity', (d: GraphNode) => isSearchMatch(d.label) ? 1 : 0.7)
    .attr('stroke', (d: GraphNode) => isSearchMatch(d.label) ? '#fff' : PLAYER_COLOR)
    .attr('stroke-width', (d: GraphNode) => isSearchMatch(d.label) ? 2 : 0.5)
    .attr('stroke-opacity', 0.5)

  // Labels for servers (always visible)
  nodeElements.filter((d: GraphNode) => d.type === 'server')
    .append('text')
    .attr('dy', (d: GraphNode) => -serverSizeScale(d.weight) * 0.6 - 5)
    .attr('text-anchor', 'middle')
    .attr('fill', (d: GraphNode) => isSearchMatch(d.label) ? '#fff' : SERVER_COLOR)
    .attr('font-size', (d: GraphNode) => serverSizeScale(d.weight) > 16 ? '10px' : '8px')
    .attr('font-weight', (d: GraphNode) => isSearchMatch(d.label) ? 'bold' : 'normal')
    .attr('font-family', 'monospace')
    .attr('opacity', 0.9)
    .style('pointer-events', 'none')
    .style('text-shadow', '0 0 4px rgba(0,0,0,0.9)')
    .text((d: GraphNode) => d.label.length > 22 ? d.label.substring(0, 21) + '\u2026' : d.label)

  // Labels for players (only on larger nodes or search matches)
  nodeElements.filter((d: GraphNode) => d.type === 'player')
    .append('text')
    .attr('dy', (d: GraphNode) => -playerSizeScale(d.weight) - 3)
    .attr('text-anchor', 'middle')
    .attr('fill', (d: GraphNode) => isSearchMatch(d.label) ? '#fff' : PLAYER_COLOR)
    .attr('font-size', '7px')
    .attr('font-weight', (d: GraphNode) => isSearchMatch(d.label) ? 'bold' : 'normal')
    .attr('font-family', 'monospace')
    .attr('opacity', (d: GraphNode) => isSearchMatch(d.label) ? 1 : (d.weight > maxWeight * 0.15 ? 0.7 : 0.35))
    .style('pointer-events', 'none')
    .style('text-shadow', '0 0 4px rgba(0,0,0,0.9)')
    .text((d: GraphNode) => d.label.length > 14 ? d.label.substring(0, 13) + '\u2026' : d.label)

  // Force simulation
  const serverNodes = nodes.filter(n => n.type === 'server')
  const playerNodes = nodes.filter(n => n.type === 'player')

  // Give servers initial spread positions to avoid initial cluster
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  serverNodes.sort((a, b) => b.weight - a.weight)
  const serverSpread = Math.min(w, h) * 0.3
  for (let i = 0; i < serverNodes.length; i++) {
    const angle = i * goldenAngle
    const r = serverSpread * Math.sqrt((i + 1) / serverNodes.length)
    serverNodes[i].x = cx + r * Math.cos(angle)
    serverNodes[i].y = cy + r * Math.sin(angle)
  }

  // Players get random positions initially
  for (const p of playerNodes) {
    p.x = cx + (Math.random() - 0.5) * w * 0.6
    p.y = cy + (Math.random() - 0.5) * h * 0.6
  }

  simulation = d3.forceSimulation<GraphNode>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
      .id(d => d.id)
      .distance(d => {
        // Shorter links for stronger connections
        const maxDist = 180
        const minDist = 40
        return minDist + (maxDist - minDist) * (1 - d.weight / edgeMaxWeight)
      })
      .strength(d => 0.3 + 0.7 * (d.weight / edgeMaxWeight))
    )
    .force('charge', d3.forceManyBody<GraphNode>()
      .strength(d => d.type === 'server' ? -300 : -30)
    )
    .force('center', d3.forceCenter(cx, cy).strength(0.05))
    .force('collision', d3.forceCollide<GraphNode>()
      .radius(d => d.type === 'server' ? serverSizeScale(d.weight) * 1.5 : playerSizeScale(d.weight) * 1.8)
    )
    .force('x', d3.forceX(cx).strength(0.03))
    .force('y', d3.forceY(cy).strength(0.03))
    .on('tick', () => {
      linkElements
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!)

      nodeElements.attr('transform', d => `translate(${d.x},${d.y})`)
    })

  // Run simulation for a bit then cool down
  simulation.alpha(1).restart()
}

const handleResize = () => {
  if (!containerRef.value) return
  if (isFullscreen.value) {
    width.value = window.innerWidth - 80 - 40
    height.value = window.innerHeight - 40
  } else {
    const rect = containerRef.value.getBoundingClientRect()
    width.value = rect.width
    height.value = Math.min(rect.width, 900)
  }
  renderGraph()
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

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  handleResize()
  fetchData()
  resizeObserver = new ResizeObserver(handleResize)
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  if (simulation) simulation.stop()
  resizeObserver?.disconnect()
  document.removeEventListener('keydown', handleEscape)
})

watch(() => props.playerName, () => fetchData())
watch(() => props.communityId, () => fetchData())
watch(searchQuery, () => renderGraph())

</script>

<template>
  <div ref="containerRef" class="server-orbit-container" :class="{ 'server-orbit--fullscreen': isFullscreen }">
    <div class="orbit-header">
      <h3 class="orbit-title">SERVER-PLAYER NETWORK</h3>
      <p class="orbit-subtitle">
        <template v-if="communityId">How community players connect through servers</template>
        <template v-else>Your server and player connections</template>
      </p>
    </div>

    <!-- Controls -->
    <div class="orbit-controls">
      <div class="control-row">
        <div class="search-wrapper">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search players or servers..."
            class="search-input"
          />
          <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">&times;</button>
        </div>
      </div>
      <div class="control-row control-row--between">
        <div class="legend">
          <span class="legend-item"><span class="legend-rect" style="background: #8b5cf6;"></span>Servers</span>
          <span class="legend-item"><span class="legend-circle" style="background: #22d3ee;"></span>Players</span>
        </div>
        <div class="control-actions">
          <button class="zoom-reset-btn" title="Reset zoom" @click="resetZoom">Reset zoom</button>
          <button class="zoom-reset-btn" :title="isFullscreen ? 'Exit fullscreen (ESC)' : 'Fullscreen'" @click="toggleFullscreen">
            {{ isFullscreen ? 'Exit' : 'Fullscreen' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="orbit-loading">
      <div class="loading-spinner"></div>
      <span>Mapping network...</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="orbit-error">{{ error }}</div>

    <!-- Empty -->
    <div v-else-if="graphNodes.length === 0 && !loading" class="orbit-empty">
      <p>No network data available yet.</p>
      <p class="orbit-empty-hint">Data populates after the daily sync runs.</p>
    </div>

    <!-- Visualization -->
    <div v-show="graphNodes.length > 0 && !loading" class="orbit-viz">
      <svg
        ref="svgElement"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
      ></svg>

      <!-- Hover tooltip -->
      <div v-if="hoveredNode" class="orbit-tooltip">
        <div class="tooltip-name" :style="{ color: hoveredNode.type === 'server' ? '#8b5cf6' : '#22d3ee' }">
          {{ hoveredNode.label }}
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Type</span>
          <span class="tooltip-value">{{ hoveredNode.type === 'server' ? 'Server' : 'Player' }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Total sessions</span>
          <span class="tooltip-value">{{ hoveredNode.weight }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Connections</span>
          <span class="tooltip-value">{{ hoveredNode.edgeCount }}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div v-if="graphNodes.length > 0 && !loading" class="orbit-footer">
      {{ serverCount }} server{{ serverCount !== 1 ? 's' : '' }} · {{ playerCount }} player{{ playerCount !== 1 ? 's' : '' }} · {{ graphEdges.length }} connections
      <template v-if="zoomTransform.k !== 1"> · {{ Math.round(zoomTransform.k * 100) }}%</template>
    </div>
  </div>
</template>

<style scoped>
.server-orbit-container {
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
  color: #8b5cf6;
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
.control-row--between { justify-content: space-between; }

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

.search-input:focus { border-color: #8b5cf6; }
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

.legend {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary, #8b949e);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.legend-rect {
  display: inline-block;
  width: 10px;
  height: 7px;
  border-radius: 2px;
}

.legend-circle {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
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
  border-color: #8b5cf6;
  color: #8b5cf6;
}

.control-actions {
  display: flex;
  gap: 0.375rem;
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
  border-top-color: #8b5cf6;
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
.server-orbit--fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 80px;
  bottom: 0;
  z-index: 50;
  background: var(--bg-panel, #0d1117);
  padding: 1.25rem;
  border: none;
  border-radius: 0;
  overflow-y: auto;
  animation: orbit-fade-in 0.2s ease-out;
}

@keyframes orbit-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 1023px) {
  .server-orbit--fullscreen {
    right: 0;
  }
}

.server-orbit--fullscreen .orbit-viz svg {
  max-width: 100%;
  max-height: calc(100vh - 200px);
}
</style>
