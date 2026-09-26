<script setup lang="ts">
// A WebGL stage for extracted BF1942 soldiers and vehicles. The three.js chunk
// is imported the first time the stage scrolls into view, so a page that never
// reaches it never downloads it. Off screen or in a hidden tab the loop stops.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FigureSpec, Side, Stage, VehicleSpec } from './stage'
import { MESH_BASE } from './meshAssets'

export interface FaceoffFigure {
  figure: FigureSpec | null
  side: Side
}

const props = withDefaults(defineProps<{
  label: string
  layout?: 'turntable' | 'faceoff'
  /** Turntable: the soldier. */
  figure?: FigureSpec | null
  /** Turntable: a vehicle, shown in place of the soldier while set. */
  vehicle?: VehicleSpec | null
  side?: Side
  /** Faceoff: left and right. */
  figures?: FaceoffFigure[]
  winner?: 0 | 1 | null
  /** Shown when there is no WebGL or the subject fails to load. */
  fallback?: string | null
}>(), {
  layout: 'turntable',
  figure: null,
  vehicle: null,
  side: null,
  figures: () => [],
  winner: null,
  fallback: null,
})

const emit = defineEmits<{ state: [state: 'loading' | 'ready' | 'failed'] }>()

const host = ref<HTMLElement | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')

let stage: Stage | null = null
let booting = false
let unmounted = false
let onScreen = false
let visibilityObserver: IntersectionObserver | null = null
let sizeObserver: ResizeObserver | null = null

function setStatus(next: 'loading' | 'ready' | 'failed') {
  status.value = next
  emit('state', next)
}

function syncActive() {
  stage?.setActive(onScreen && document.visibilityState === 'visible')
}

let presentSequence = 0

async function present() {
  if (!stage) return
  const current = stage
  const sequence = ++presentSequence
  const latest = () => current === stage && sequence === presentSequence
  setStatus('loading')
  try {
    if (props.layout === 'faceoff') {
      await Promise.all(props.figures.slice(0, 2).map((entry, index) =>
        entry.figure ? current.showFigure(entry.figure, entry.side, index as 0 | 1) : Promise.resolve()))
      current.setWinner(props.winner)
    } else if (props.vehicle) {
      await current.showVehicle(props.vehicle, props.side)
    } else if (props.figure) {
      await current.showFigure(props.figure, props.side)
    } else {
      current.clear()
    }
    if (latest()) setStatus('ready')
  } catch {
    if (latest()) setStatus('failed')
  }
}

async function boot() {
  if (booting || stage || !host.value) return
  booting = true
  try {
    const { createStage } = await import('./stage')
    if (unmounted || !host.value) return
    stage = createStage(host.value, {
      base: MESH_BASE,
      layout: props.layout,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    })
    syncActive()
    sizeObserver = new ResizeObserver(() => stage?.resize())
    sizeObserver.observe(host.value)
    await present()
  } catch {
    // No WebGL (or the chunk failed): the fallback image takes the stage.
    setStatus('failed')
  } finally {
    booting = false
  }
}

function onVisibility() {
  syncActive()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  if (!host.value) return
  visibilityObserver = new IntersectionObserver(entries => {
    onScreen = entries.some(entry => entry.isIntersecting)
    if (onScreen && !stage) void boot()
    syncActive()
  }, { rootMargin: '200px 0px' })
  visibilityObserver.observe(host.value)
})

onBeforeUnmount(() => {
  unmounted = true
  document.removeEventListener('visibilitychange', onVisibility)
  visibilityObserver?.disconnect()
  sizeObserver?.disconnect()
  stage?.dispose()
  stage = null
})

watch(() => [props.figure, props.vehicle, props.side, props.figures], () => {
  if (stage) void present()
})

watch(() => props.winner, winner => stage?.setWinner(winner))
</script>

<template>
  <div
    class="mm-armoury-stage"
    :class="[`mm-armoury-stage--${layout}`, `mm-armoury-stage--${status}`]"
  >
    <div
      class="mm-armoury-stage__backdrop"
      aria-hidden="true"
    >
      <slot name="backdrop" />
    </div>
    <div
      ref="host"
      class="mm-armoury-stage__canvas"
      role="img"
      :aria-label="label"
      :aria-busy="status === 'loading'"
      :hidden="status === 'failed'"
    />
    <img
      v-if="status === 'failed' && fallback"
      class="mm-armoury-stage__fallback"
      :src="fallback"
      alt=""
    >
    <div
      v-if="status === 'loading' || status === 'idle'"
      class="mm-armoury-stage__loading"
      aria-hidden="true"
    >
      <span class="mm-armoury-stage__scan" />
    </div>
    <div class="mm-armoury-stage__overlay">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mm-armoury-stage {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(ellipse 70% 55% at 50% 42%, color-mix(in srgb, var(--mm-accent-soft) 7%, transparent), transparent 70%),
    linear-gradient(180deg, var(--mm-bg-soft) 0%, var(--mm-bg) 100%);
  isolation: isolate;
}

.mm-armoury-stage__backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.mm-armoury-stage__canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: grab;
}

.mm-armoury-stage--faceoff .mm-armoury-stage__canvas { cursor: default; }
.mm-armoury-stage__canvas:active { cursor: grabbing; }

/* The mesh site's browse render: its own stage colour lightened away, its corner chrome cropped. */
.mm-armoury-stage__fallback {
  position: absolute;
  inset: 12% 18%;
  z-index: 1;
  width: 64%;
  height: 76%;
  object-fit: contain;
  transform: scale(1.35);
  mix-blend-mode: lighten;
  opacity: 0.85;
}

.mm-armoury-stage__overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

/* Only the controls catch the pointer; everywhere else a drag reaches the canvas. */
.mm-armoury-stage__overlay :deep(:is(button, a)) { pointer-events: auto; }

/* A scan line sweeping the floor while the kit is issued. */
.mm-armoury-stage__loading {
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 22%;
  height: 1px;
  z-index: 1;
  background: var(--mm-rule-strong);
  overflow: hidden;
}

.mm-armoury-stage__scan {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 30%;
  background: linear-gradient(90deg, transparent, var(--mm-accent-soft), transparent);
  animation: mm-armoury-scan 1.3s ease-in-out infinite;
}

@keyframes mm-armoury-scan {
  from { transform: translateX(-100%); }
  to { transform: translateX(340%); }
}

@media (prefers-reduced-motion: reduce) {
  .mm-armoury-stage__scan { animation: none; left: 35%; }
}
</style>
