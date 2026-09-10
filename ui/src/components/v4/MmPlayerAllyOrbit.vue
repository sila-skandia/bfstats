<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import {
  fetchPlayerTeammates,
  type PlayerRelationship,
} from '@/services/playerRelationshipsApi'
import { decodePlayerName } from '@/utils/playerName'
import { formatLastSeen } from '@/utils/timeUtils'
export interface OrbitTier {
  id: string
  label: string
  min: number
  max?: number | null
  color: string
  sub: string
  subShort: string
}

const DEFAULT_TIERS: OrbitTier[] = [
  { id: 'trenches', label: 'Trenches', min: 50, max: null, color: '#f59e0b', sub: '50+ co-rounds', subShort: '50+' },
  { id: 'core', label: 'Core', min: 25, max: 49, color: '#22c55e', sub: '25–49 co-rounds', subShort: '25–49' },
  { id: 'regulars', label: 'Regulars', min: 10, max: 24, color: '#38bdf8', sub: '10–24 co-rounds', subShort: '10–24' },
  { id: 'familiar', label: 'Familiar', min: 5, max: 9, color: '#a78bfa', sub: '5–9 co-rounds', subShort: '5–9' },
  { id: 'passing', label: 'Passing', min: 1, max: 4, color: '#94a3b8', sub: '1–4 co-rounds', subShort: '1–4' },
]

const activeTierFilter = ref<string | null>(null)
const toggleTierFilter = (label: string) => {
  activeTierFilter.value = activeTierFilter.value === label ? null : label
  resetZoom()
}

// Nice rounding helper for adaptive thresholds
function niceRound(val: number): number {
  if (val <= 10) return Math.max(1, Math.round(val))
  if (val <= 30) return Math.round(val / 5) * 5
  if (val <= 100) return Math.round(val / 10) * 10
  if (val <= 250) return Math.round(val / 25) * 25
  if (val <= 500) return Math.round(val / 50) * 50
  return Math.round(val / 100) * 100
}

const activeTiers = computed<OrbitTier[]>(() => {
  const allies = rawAllies.value
  if (!allies.length) return DEFAULT_TIERS

  const counts = allies.map(a => a.sessionCount)
  const maxS = Math.max(1, ...counts)
  const minS = Math.min(...counts)

  // Adaptive mode: generate 5 smooth, distinct cohorts based on player's co-play range
  if (maxS - minS <= 4) {
    const colors = ['#f59e0b', '#22c55e', '#38bdf8', '#a78bfa', '#94a3b8']
    const names = ['Trenches', 'Core', 'Regulars', 'Familiar', 'Passing']
    const res: OrbitTier[] = []
    let cIdx = 0
    for (let v = maxS; v >= minS; v--) {
      res.push({
        id: `tier_${v}`,
        label: names[cIdx] || `Tier ${cIdx + 1}`,
        min: v,
        max: v,
        color: colors[cIdx] || '#94a3b8',
        sub: `${v} co-rounds`,
        subShort: `${v}`,
      })
      cIdx++
    }
    return res
  }

  // Calculate 4 cutoffs in logarithmic space between minS and maxS
  const logMin = Math.log(Math.max(1, minS))
  const logMax = Math.log(Math.max(2, maxS))

  let cutoffs: number[] = []
  for (let i = 4; i >= 1; i--) {
    const norm = i / 5.0
    const rawVal = Math.exp(logMin + norm * (logMax - logMin))
    const rounded = niceRound(rawVal)
    if (!cutoffs.includes(rounded) && rounded > minS && rounded < maxS) {
      cutoffs.push(rounded)
    }
  }

  cutoffs.sort((a, b) => b - a)

  if (cutoffs.length < 3) {
    cutoffs = []
    const step = (maxS - minS) / 5.0
    for (let i = 4; i >= 1; i--) {
      const rounded = niceRound(minS + i * step)
      if (!cutoffs.includes(rounded) && rounded > minS && rounded < maxS) {
        cutoffs.push(rounded)
      }
    }
    cutoffs.sort((a, b) => b - a)
  }

  const colors = ['#f59e0b', '#22c55e', '#38bdf8', '#a78bfa', '#94a3b8']
  const names = ['Trenches', 'Core', 'Regulars', 'Familiar', 'Passing']
  const res: OrbitTier[] = []

  // Top tier
  const topC = cutoffs[0] || maxS
  res.push({
    id: 'trenches',
    label: names[0],
    min: topC,
    max: null,
    color: colors[0],
    sub: `${topC}+ co-rounds`,
    subShort: `${topC}+`,
  })

  // Intermediate tiers
  for (let i = 0; i < cutoffs.length - 1; i++) {
    const higher = cutoffs[i]
    const lower = cutoffs[i + 1]
    res.push({
      id: `tier_${i + 1}`,
      label: names[i + 1] || `Tier ${i + 2}`,
      min: lower,
      max: higher - 1,
      color: colors[i + 1] || '#94a3b8',
      sub: `${lower}–${higher - 1} co-rounds`,
      subShort: `${lower}–${higher - 1}`,
    })
  }

  // Lowest tier
  const lowestC = cutoffs[cutoffs.length - 1] || minS
  res.push({
    id: 'passing',
    label: names[names.length - 1],
    min: minS,
    max: lowestC - 1,
    color: colors[colors.length - 1],
    sub: minS < lowestC - 1 ? `${minS}–${lowestC - 1} co-rounds` : `${minS} co-rounds`,
    subShort: minS < lowestC - 1 ? `${minS}–${lowestC - 1}` : `${minS}`,
  })

  return res
})

const getTier = (rounds: number): OrbitTier => {
  const tiers = activeTiers.value
  const found = tiers.find(t => rounds >= t.min)
  return found || tiers[tiers.length - 1]
}

const getTierIndex = (rounds: number): number => {
  const tiers = activeTiers.value
  const idx = tiers.findIndex(t => rounds >= t.min)
  return idx >= 0 ? idx : tiers.length - 1
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
const showLabels = ref(false)
const rawAllies = ref<PlayerRelationship[]>([])
let simulation: d3.Simulation<AllyNode, undefined> | null = null

const rawSessionCounts = computed(() => rawAllies.value.map(a => a.sessionCount))
const maxAlliesSessions = computed(() => rawSessionCounts.value.length ? Math.max(...rawSessionCounts.value) : 30)

const sliderMin = computed(() => 1)
const sliderMax = computed(() => Math.max(10, Math.floor(maxAlliesSessions.value * 0.85)))
const sliderStep = computed(() => maxAlliesSessions.value > 100 ? 5 : 1)

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
  const tiers = activeTiers.value
  const counts = tiers.map(t => ({
    id: t.id,
    label: t.label,
    color: t.color,
    sub: t.sub,
    subShort: t.subShort,
    count: 0,
  }))
  for (const a of filteredAllies.value) {
    const idx = getTierIndex(a.sessionCount)
    if (idx >= 0 && idx < counts.length) counts[idx].count++
  }
  return counts
})

const currentTierObj = computed(() => {
  if (!activeTierFilter.value) return null
  return activeTiers.value.find(t => t.label === activeTierFilter.value) || null
})

const alliesInRender = computed(() => {
  if (activeTierFilter.value) {
    return filteredAllies.value.filter(a => getTier(a.sessionCount).label === activeTierFilter.value)
  }
  return filteredAllies.value
})

let currentZoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

const zoomIn = () => {
  if (!svgElement.value || !currentZoom) return
  const sel = d3.select<SVGSVGElement, unknown>(svgElement.value)
  currentZoom.scaleBy(sel.transition().duration(250) as any, 1.3)
}
const zoomOut = () => {
  if (!svgElement.value || !currentZoom) return
  const sel = d3.select<SVGSVGElement, unknown>(svgElement.value)
  currentZoom.scaleBy(sel.transition().duration(250) as any, 0.77)
}
const resetZoom = () => {
  if (!svgElement.value || !currentZoom) return
  const sel = d3.select<SVGSVGElement, unknown>(svgElement.value)
  currentZoom.transform(sel.transition().duration(250) as any, d3.zoomIdentity)
}

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
  if (!svgElement.value) return

  simulation?.stop()
  simulation = null

  const allies = alliesInRender.value
  if (allies.length === 0) {
    const svg = d3.select(svgElement.value)
    svg.selectAll('*').remove()
    return
  }

  const w = width.value
  const h = height.value
  const cx = w / 2
  const cy = h / 2
  const rMax = Math.max(90, Math.min(cx, cy) - 40)
  const innerR = 56

  const isSoloTier = !!activeTierFilter.value
  const currentTier = currentTierObj.value

  const maxSessions = Math.max(1, ...allies.map(a => a.sessionCount))
  const minSessions = Math.min(...allies.map(a => a.sessionCount))
  const sizeScale = d3.scaleSqrt().domain([Math.max(1, minSessions), maxSessions]).range(isSoloTier ? [6.5, 14] : [4.5, 13])

  // Radial mapping:
  // In solo tier mode: map between tier's session span or maxSessions/minSessions across innerR to rMax
  // In all-tiers mode: logarithmic mapping from maxSessions (innerR) to minSessions (rMax)
  const radiusForSessions = (sessions: number) => {
    if (isSoloTier) {
      if (maxSessions === minSessions) {
        return innerR + (rMax - innerR) * 0.5
      }
      const norm = (sessions - minSessions) / (maxSessions - minSessions)
      return (innerR + 24) + (1 - norm) * (rMax - innerR - 48)
    }

    if (maxSessions === minSessions) return innerR + (rMax - innerR) * 0.4
    const logMin = Math.log(Math.max(1, minSessions))
    const logMax = Math.log(Math.max(2, maxSessions))
    const logVal = Math.log(Math.max(1, sessions))
    const norm = Math.max(0, Math.min(1, (logVal - logMin) / (logMax - logMin)))
    return innerR + (1 - norm) * (rMax - innerR)
  }

  const nodes: AllyNode[] = allies.map((a, idx) => {
    const allyName = a.player2Name || a.player1Name
    const tier = getTier(a.sessionCount)
    // In solo tier mode, spread evenly around full 360 degrees to maximize spacing
    const baseAngle = (idx / allies.length) * 2 * Math.PI - Math.PI / 2
    const jitter = isSoloTier ? 0 : hashSigned(allyName) * 0.15
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

  const svg = d3.select<SVGSVGElement, unknown>(svgElement.value)
  svg.selectAll('*').remove()

  // Setup D3 Zoom on the SVG
  const g = svg.append('g').attr('class', 'mm-orbit-content')

  currentZoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.6, 5])
    .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      g.attr('transform', event.transform.toString())
    })

  svg.call(currentZoom)
    .call(currentZoom.transform, d3.zoomIdentity)
    .on('dblclick.zoom', null)

  const ringG = g.append('g').attr('class', 'mm-orbit-rings')

  if (isSoloTier) {
    // In solo mode, draw sub-rings if there is spread in session counts
    const distinctSessions = Array.from(new Set(allies.map(a => a.sessionCount))).sort((a, b) => b - a)
    let ringVals: number[] = []
    if (distinctSessions.length <= 4) {
      ringVals = distinctSessions
    } else {
      ringVals = d3.ticks(minSessions, maxSessions, 3).filter(t => t >= minSessions && t <= maxSessions)
      if (!ringVals.includes(maxSessions)) ringVals.push(maxSessions)
      if (!ringVals.includes(minSessions)) ringVals.push(minSessions)
      ringVals.sort((a, b) => b - a)
    }

    for (const t of ringVals) {
      const r = radiusForSessions(t)
      ringG.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', currentTier?.color || '#2d2d2d')
        .attr('stroke-width', 0.6)
        .attr('stroke-dasharray', '2 4')
        .attr('opacity', 0.35)

      ringG.append('text')
        .attr('x', cx + 6)
        .attr('y', cy - r - 3)
        .attr('font-family', 'var(--mm-font-mono)')
        .attr('font-size', 8.5)
        .attr('letter-spacing', '0.06em')
        .attr('fill', currentTier?.color || '#888888')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#111312')
        .attr('stroke-width', 2.5)
        .attr('stroke-linejoin', 'round')
        .attr('opacity', 0.85)
        .text(`${t} co-rounds`)
    }
  } else {
    // All-tiers mode concentric tier guide rings
    const ringThresholds = Array.from(
      new Set(
        activeTiers.value
          .map(t => t.min)
          .filter(t => t > minSessions && t < maxSessions)
      )
    ).sort((a, b) => b - a)

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
        .attr('x', cx + 6)
        .attr('y', cy - r - 3)
        .attr('font-family', 'var(--mm-font-mono)')
        .attr('font-size', 8.5)
        .attr('letter-spacing', '0.06em')
        .attr('fill', '#888888')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#111312')
        .attr('stroke-width', 2.5)
        .attr('stroke-linejoin', 'round')
        .text(`${t}+ co-rounds`)
    }
  }

  // Outer boundary ring
  ringG.append('circle')
    .attr('cx', cx).attr('cy', cy)
    .attr('r', rMax)
    .attr('fill', 'none')
    .attr('stroke', isSoloTier && currentTier ? currentTier.color : '#222222')
    .attr('stroke-width', isSoloTier ? 0.8 : 0.5)
    .attr('opacity', isSoloTier ? 0.35 : 1)

  // Inner center player marker (THE PLAYER)
  const centerG = g.append('g').attr('class', 'mm-orbit-center')
  centerG.append('circle')
    .attr('cx', cx).attr('cy', cy).attr('r', 24)
    .attr('fill', '#1a1a1a')
    .attr('stroke', isSoloTier && currentTier ? currentTier.color : '#ffffff')
    .attr('stroke-width', 1.2)

  centerG.append('text')
    .attr('x', cx).attr('y', cy - 2)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--mm-font-mono)')
    .attr('font-size', 8.5)
    .attr('letter-spacing', '0.08em')
    .attr('fill', isSoloTier && currentTier ? currentTier.color : '#7da34c')
    .attr('font-weight', '600')
    .text(isSoloTier && currentTier ? currentTier.label.toUpperCase() : 'PLAYER')

  const centerLabel = decodePlayerName(props.playerName)
  const shortLabel = centerLabel.length > 9 ? centerLabel.slice(0, 8) + '…' : centerLabel
  centerG.append('text')
    .attr('x', cx).attr('y', cy + 9)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'var(--mm-font-mono)')
    .attr('font-size', 8)
    .attr('fill', '#e0e0e0')
    .text(shortLabel)

  const isDimmed = (d: AllyNode) => {
    if (searchTerms.value.length > 0 && !d.matched) return true
    return false
  }

  // Ally dots
  const dotG = g.append('g').attr('class', 'mm-orbit-dots')
  const sel = dotG.selectAll<SVGCircleElement, AllyNode>('circle.mm-orbit-dot')
    .data(nodes, d => d.playerName)
    .enter()
    .append('circle')
    .attr('class', 'mm-orbit-dot')
    .attr('r', d => (isSoloTier ? d.radius * 1.15 : d.radius))
    .attr('fill', d => d.color)
    .attr('opacity', d => isDimmed(d) ? 0.12 : 0.95)
    .attr('stroke', d => (isSoloTier || d.matched) ? '#ffffff' : 'none')
    .attr('stroke-width', d => (isSoloTier || d.matched) ? 1.2 : 0)
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
          node: d,
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
    .on('click', (_event, d) => emit('player-click', d.playerName))

  // Ally text labels:
  // In solo tier mode OR when showLabels is toggled on, show labels
  const shouldShowLabels = showLabels.value || isSoloTier
  let labelSel: d3.Selection<SVGTextElement, AllyNode, SVGGElement, unknown> | null = null
  if (shouldShowLabels) {
    const labelNodes = searchTerms.value.length > 0 ? nodes.filter(d => !isDimmed(d)) : nodes
    const labelG = g.append('g').attr('class', 'mm-orbit-labels')
    labelSel = labelG.selectAll<SVGTextElement, AllyNode>('text.mm-orbit-label')
      .data(labelNodes, d => d.playerName)
      .enter()
      .append('text')
      .attr('class', 'mm-orbit-label')
      .attr('font-family', 'var(--mm-font-mono)')
      .attr('font-size', isSoloTier ? '9.5px' : '9px')
      .attr('font-weight', isSoloTier ? '600' : '400')
      .attr('fill', d => (isSoloTier ? d.color : '#e5e5e5'))
      .attr('pointer-events', 'none')
      .text(d => d.displayName.length > 13 ? d.displayName.slice(0, 12) + '…' : d.displayName)
  }

  // Force simulation: allies gently orbit around their target distance with collision avoidance
  const collisionPadding = isSoloTier ? 22 : (shouldShowLabels ? 14 : 2)

  simulation = d3.forceSimulation<AllyNode>(nodes)
    .force('x', d3.forceX<AllyNode>(d => d.targetX).strength(isSoloTier ? 0.45 : 0.35))
    .force('y', d3.forceY<AllyNode>(d => d.targetY).strength(isSoloTier ? 0.45 : 0.35))
    .force('collide', d3.forceCollide<AllyNode>(d => d.radius + collisionPadding).strength(0.85))
    .alpha(0.4)
    .alphaDecay(0.05)
    .on('tick', () => {
      sel
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
      if (labelSel) {
        labelSel
          .attr('text-anchor', d => d.x >= cx ? 'start' : 'end')
          .attr('x', d => d.x >= cx ? d.x + d.radius + 4 : d.x - d.radius - 4)
          .attr('y', d => d.y + 3.5)
      }
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
  updateDimensions()
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateDimensions())
    resizeObserver.observe(containerRef.value)
  }
})

watch(() => props.playerName, () => {
  activeTierFilter.value = null
  minRounds.value = 1
  fetchData()
})

watch([minRounds, searchQuery, showLabels, activeTierFilter], () => {
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
          Ally Proximity Orbit
        </div>
        <div class="mm-card__hint">
          Closest squadmates mapped radially by time &amp; rounds most played together
        </div>
      </div>

      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <button
          type="button"
          class="mm-btn mm-btn--inline"
          :class="{ 'mm-btn--active': showLabels }"
          @click="showLabels = !showLabels"
        >Labels: {{ showLabels ? 'ON' : 'OFF' }}</button>

        <button
          type="button"
          class="mm-btn mm-btn--inline"
          @click="showHelp = !showHelp"
        >{{ showHelp ? 'Close' : 'How to read this' }}</button>
      </div>
    </header>

    <div v-if="showHelp" class="mm-orbit__help">
      <ul>
        <li><strong>Center node</strong> = {{ decodePlayerName(playerName) }} (focal player).</li>
        <li><strong>Distance from center</strong> = co-play frequency (<strong>closest</strong> = most shared rounds, <strong>further out</strong> = fewer rounds).</li>
        <li><strong>Dot size</strong> = relative co-play volume. <strong>Color</strong> = ally strength tier.</li>
        <li>Hover over any ally dot to see rounds played together &amp; last seen · Click to open their profile.</li>
        <li>Click any tier in the legend below to filter the orbit by relationship tier.</li>
      </ul>
    </div>

    <div class="mm-orbit__controls">
      <div class="mm-orbit__row">
        <label class="mm-orbit__control">
          <span class="mm-eyebrow">Min co-rounds</span>
          <input
            v-model.number="minRounds"
            type="range"
            :min="sliderMin"
            :max="sliderMax"
            :step="sliderStep"
            class="mm-orbit__range"
          />
          <span class="mm-orbit__value">{{ minRounds }}+</span>
        </label>

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
    </div>

    <!-- Clickable color-coded tier legend -->
    <div class="mm-orbit__bands">
      <button
        v-for="tier in tierCounts"
        :key="tier.id"
        type="button"
        class="mm-chip mm-chip--clickable"
        :class="{
          'mm-chip--active': activeTierFilter === tier.label,
          'mm-chip--dimmed': activeTierFilter && activeTierFilter !== tier.label,
        }"
        :style="{
          borderColor: tier.color,
          color: tier.color,
          background: activeTierFilter === tier.label ? tier.color + '22' : 'transparent',
          boxShadow: activeTierFilter === tier.label ? `0 0 8px ${tier.color}44` : 'none',
        }"
        :title="tier.sub"
        @click="toggleTierFilter(tier.label)"
      >
        <span class="mm-chip__dot" :style="{ background: tier.color, animation: 'none' }" />
        <span class="mm-chip__label">{{ tier.label }}</span>
        <span class="mm-chip__sub">({{ tier.subShort }})</span>
        <span class="mm-chip__count">{{ tier.count }}</span>
      </button>

      <button
        v-if="activeTierFilter"
        type="button"
        class="mm-btn mm-btn--inline"
        style="padding: 2px 8px; font-size: 10px"
        @click="activeTierFilter = null; resetZoom()"
      >
        Reset filter
      </button>
    </div>

    <!-- Solo-tier focus banner -->
    <div
      v-if="activeTierFilter && currentTierObj"
      class="mm-orbit__solo-banner"
      :style="{ borderLeftColor: currentTierObj.color }"
    >
      <div class="mm-orbit__solo-info">
        <span class="mm-chip__dot" :style="{ background: currentTierObj.color, animation: 'none' }" />
        <span class="mm-orbit__solo-text">
          Focusing on <strong>{{ currentTierObj.label }}</strong>
          <span class="mm-orbit__solo-meta">({{ alliesInRender.length }} squadmates · {{ currentTierObj.sub }})</span>
        </span>
      </div>
      <button
        type="button"
        class="mm-btn mm-btn--inline mm-orbit__solo-reset"
        @click="activeTierFilter = null; resetZoom()"
      >
        Show all tiers →
      </button>
    </div>

    <div v-if="loading" class="mm-orbit__state">
      <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="totalAllies === 0" class="mm-empty">
      No co-play relationship history recorded for {{ decodePlayerName(playerName) }} yet.
    </div>

    <div v-else-if="alliesInRender.length === 0" class="mm-empty">
      <span v-if="activeTierFilter">
        No allies in {{ activeTierFilter }} with at least {{ minRounds }} co-rounds.
      </span>
      <span v-else>
        No allies with at least {{ minRounds }} co-rounds. Try lowering the threshold.
      </span>
      <button
        v-if="activeTierFilter"
        type="button"
        class="mm-btn mm-btn--inline"
        style="margin-left: 8px"
        @click="activeTierFilter = null; resetZoom()"
      >
        Show all tiers →
      </button>
    </div>

    <div v-else ref="vizRef" class="mm-orbit__viz">
      <!-- Floating Zoom Controls -->
      <div class="mm-orbit__zoom-bar">
        <button
          type="button"
          class="mm-orbit__zoom-btn"
          title="Zoom in"
          aria-label="Zoom in"
          @click="zoomIn"
        >+</button>
        <button
          type="button"
          class="mm-orbit__zoom-btn"
          title="Zoom out"
          aria-label="Zoom out"
          @click="zoomOut"
        >−</button>
        <button
          type="button"
          class="mm-orbit__zoom-btn mm-orbit__zoom-btn--reset"
          title="Reset zoom"
          aria-label="Reset zoom"
          @click="resetZoom"
        >1:1</button>
      </div>

      <svg
        ref="svgElement"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        style="display: block; margin: 0 auto; cursor: grab"
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

    <div v-if="alliesInRender.length > 0" class="mm-card__foot">
      <span v-if="activeTierFilter">
        Showing {{ alliesInRender.length }} {{ activeTierFilter }} allies mapped across full orbit · Scroll or click +/- to zoom · Drag to pan
      </span>
      <span v-else>
        Showing {{ totalVisible }} of {{ totalAllies }} closest allies plotted by co-play proximity (closest = most played together) · Click any tier to isolate
      </span>
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

.mm-orbit__search {
  width: 100%;
  max-width: 360px;
}

.mm-orbit__solo-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  background: rgba(18, 20, 19, 0.9);
  border: 1px solid var(--mm-rule);
  border-left: 3px solid var(--mm-accent);
  border-radius: 2px;
  font-family: var(--mm-font-display);
  font-size: 12px;
}

.mm-orbit__solo-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-orbit__solo-text {
  color: var(--mm-ink);
}

.mm-orbit__solo-meta {
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  margin-left: 6px;
}

.mm-orbit__solo-reset {
  padding: 3px 10px;
  font-size: 10.5px;
  white-space: nowrap;
}

.mm-orbit__zoom-bar {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(18, 20, 19, 0.88);
  border: 1px solid var(--mm-rule);
  backdrop-filter: blur(6px);
  border-radius: 2px;
  padding: 3px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.mm-orbit__zoom-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: var(--mm-ink-muted, #999);
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.15s ease;
  user-select: none;
}

.mm-orbit__zoom-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--mm-ink, #fff);
  border-color: var(--mm-rule);
}

.mm-orbit__zoom-btn--reset {
  font-size: 9.5px;
  letter-spacing: 0.05em;
}

.mm-orbit__bands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mm-chip--clickable {
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  font-family: var(--mm-font-mono);
}

.mm-chip__sub {
  margin-left: 4px;
  font-size: 9px;
  opacity: 0.75;
  font-family: var(--mm-font-mono);
}

.mm-chip__count {
  margin-left: 5px;
  font-weight: 700;
  font-family: var(--mm-font-mono);
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 2px;
}

.mm-chip--clickable:hover {
  transform: translateY(-1px);
  filter: brightness(1.25);
}

.mm-chip--dimmed {
  opacity: 0.35;
  filter: grayscale(0.4);
}

.mm-orbit__state {
  padding: 14px 0;
}

.mm-orbit__viz {
  position: relative;
  display: flex;
  justify-content: center;
}

.mm-orbit-label {
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
  user-select: none;
}

.mm-btn--inline {
  transition: all 0.15s ease;
}

.mm-btn--inline.mm-btn--active {
  background: var(--mm-accent);
  color: #000;
  border-color: var(--mm-accent);
  font-weight: 600;
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
