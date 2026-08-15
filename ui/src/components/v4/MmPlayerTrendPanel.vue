<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import MmSparkline, { type SparklineBrushRange } from '@/components/v4/MmSparkline.vue'
import MmTrendRoundsSlideover from '@/components/v4/MmTrendRoundsSlideover.vue'
import type { TrendDataPoint } from '@/types/playerStatsTypes'
import { parseUtc } from '@/utils/timeUtils'

const props = defineProps<{
  kdTrend: TrendDataPoint[]
  killRateTrend: TrendDataPoint[]
  granularity: string
  playerName: string
  loading?: boolean
}>()

const router = useRouter()

type Span = { lo: number; hi: number }

const zoomStack = ref<Span[]>([])
const isFullscreen = ref(false)
const roundsOpen = ref(false)
const fsRoot = ref<HTMLElement | null>(null)

const seriesLen = computed(() => Math.max(props.kdTrend.length, props.killRateTrend.length))

const fullSpan = computed<Span>(() => ({
  lo: 0,
  hi: Math.max(0, seriesLen.value - 1),
}))

const span = computed<Span>(() => zoomStack.value.at(-1) ?? fullSpan.value)

const isZoomed = computed(() => zoomStack.value.length > 0)

const sliceSeries = (series: TrendDataPoint[]) => {
  if (series.length === 0) return []
  const { lo, hi } = span.value
  return series.slice(lo, Math.min(series.length, hi + 1))
}

const visibleKd = computed(() => sliceSeries(props.kdTrend))
const visibleKillRate = computed(() => sliceSeries(props.killRateTrend))

const windowTimestamps = computed(() => {
  const src = visibleKd.value.length ? visibleKd.value : visibleKillRate.value
  if (src.length === 0) return { from: '', to: '' }
  return { from: src[0].timestamp, to: src[src.length - 1].timestamp }
})

const formatDay = (raw: string, withYear = true) => {
  const d = parseUtc(raw)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
  })
}

const rangeLabel = computed(() => {
  const { from, to } = windowTimestamps.value
  if (!from || !to) return ''
  const a = parseUtc(from)
  const b = parseUtc(to)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return ''
  const sameYear = a.getFullYear() === b.getFullYear()
  const left = formatDay(from, !sameYear)
  const right = formatDay(to, true)
  return left === right ? right : `${left} – ${right}`
})

const windowRounds = computed(() =>
  visibleKd.value.reduce((sum, p) => sum + (p.sessionCount ?? 0), 0),
)

const trendDelta = (series: TrendDataPoint[]) => {
  if (series.length < 2) return null
  const first = series[0].value
  const last = series[series.length - 1].value
  if (first === 0) return null
  return ((last - first) / Math.abs(first)) * 100
}

const kdDelta = computed(() => trendDelta(visibleKd.value))
const killRateDelta = computed(() => trendDelta(visibleKillRate.value))

const bucketStartIso = (timestamp: string) => {
  const d = parseUtc(timestamp)
  if (isNaN(d.getTime())) return timestamp
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

const bucketEndIso = (timestamp: string) => {
  const d = parseUtc(timestamp)
  if (isNaN(d.getTime())) return timestamp
  d.setUTCHours(23, 59, 59, 999)
  return d.toISOString()
}

const fromIso = computed(() => {
  const t = windowTimestamps.value.from
  return t ? bucketStartIso(t) : ''
})

const toIso = computed(() => {
  const t = windowTimestamps.value.to
  return t ? bucketEndIso(t) : ''
})

const highlightRange = computed<SparklineBrushRange | null>(() => {
  if (!isZoomed.value || seriesLen.value < 2) return null
  return { startIndex: span.value.lo, endIndex: span.value.hi }
})

const applyBrush = (range: SparklineBrushRange, relative: boolean) => {
  const base = relative ? span.value.lo : 0
  const lo = Math.max(0, base + range.startIndex)
  const hi = Math.min(seriesLen.value - 1, base + range.endIndex)
  if (hi <= lo) return
  if (lo <= 0 && hi >= seriesLen.value - 1) {
    zoomStack.value = []
    return
  }
  const current = span.value
  if (lo === current.lo && hi === current.hi) return
  zoomStack.value = [...zoomStack.value, { lo, hi }]
}

const onChartBrush = (range: SparklineBrushRange) => applyBrush(range, true)
const onOverviewBrush = (range: SparklineBrushRange) => {
  const lo = range.startIndex
  const hi = range.endIndex
  if (hi <= lo) return
  if (lo <= 0 && hi >= seriesLen.value - 1) {
    zoomStack.value = []
    return
  }
  zoomStack.value = [{ lo, hi }]
}

const resetZoom = () => {
  zoomStack.value = []
}

const stepBack = () => {
  zoomStack.value = zoomStack.value.slice(0, -1)
}

const openFullscreen = () => {
  isFullscreen.value = true
}

const closeFullscreen = () => {
  isFullscreen.value = false
}

const openRounds = () => {
  roundsOpen.value = true
}

const closeRounds = () => {
  roundsOpen.value = false
}

const openSessionsPage = () => {
  router.push({
    path: `/v4/players/${encodeURIComponent(props.playerName)}/sessions`,
    query: {
      from: fromIso.value.slice(0, 10),
      to: toIso.value.slice(0, 10),
    },
  })
}

const overlayOpen = computed(() => isFullscreen.value || roundsOpen.value)

watch(overlayOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (roundsOpen.value) return
  if (isFullscreen.value) {
    e.preventDefault()
    closeFullscreen()
  }
}

watch(isFullscreen, (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown)
    requestAnimationFrame(() => fsRoot.value?.focus())
  } else {
    window.removeEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => props.playerName,
  () => {
    zoomStack.value = []
    isFullscreen.value = false
    roundsOpen.value = false
  },
)

const lastKd = computed(() => visibleKd.value.at(-1)?.value)
const lastKillRate = computed(() => visibleKillRate.value.at(-1)?.value)

const roundsCta = computed(() => {
  const n = windowRounds.value
  if (n > 0) return `View ${n.toLocaleString()} rounds →`
  return 'View rounds →'
})

const expandIcon = [
  'M8 3H3v5',
  'M16 3h5v5',
  'M8 21H3v-5',
  'M16 21h5v-5',
]
</script>

<template>
  <div class="mm-trend-pair" data-testid="player-trend-panel">
    <div v-if="isZoomed" class="mm-trend-pair__window">
      <span class="mm-trend-pair__range">{{ rangeLabel }}</span>
      <span class="mm-card__hint">
        {{ visibleKd.length }} {{ granularity }} pts
        <template v-if="windowRounds"> · {{ windowRounds.toLocaleString() }} rounds</template>
      </span>
      <div class="mm-trend-pair__window-actions">
        <button v-if="zoomStack.length > 1" type="button" class="mm-btn" @click="stepBack">
          ← Wider
        </button>
        <button type="button" class="mm-btn" @click="resetZoom">Reset</button>
        <button type="button" class="mm-btn mm-btn--strong" @click="openRounds">
          {{ roundsCta }}
        </button>
      </div>
    </div>

    <section class="mm-panel">
      <div class="mm-panel__body">
        <div class="mm-trend-card__head">
          <div>
            <span class="mm-eyebrow mm-eyebrow--strong">K/D trend</span>
            <div class="mm-card__hint">
              {{ granularity }} · {{ visibleKd.length || 0 }} pts
              <template v-if="!isZoomed"> · drag to zoom</template>
            </div>
          </div>
          <button
            type="button"
            class="mm-trend-card__expand"
            aria-label="Expand trend graphs to full screen"
            @click="openFullscreen"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-for="d in expandIcon" :key="d" :d="d" />
            </svg>
            Expand
          </button>
        </div>
        <div v-if="visibleKd.length > 1" class="mm-trend-card__chart">
          <MmSparkline
            :values="visibleKd.map(p => p.value)"
            :timestamps="visibleKd.map(p => p.timestamp)"
            :height="56"
            :show-axis="true"
            :brushable="true"
            unit="K/D"
            @brush="onChartBrush"
          />
        </div>
        <div v-else-if="loading" class="mm-skeleton" style="margin-top: 10px; height: 56px" />
        <div v-else class="mm-card__empty">Not enough rounds yet.</div>
        <div v-if="kdDelta != null && lastKd != null" class="mm-card__foot">
          <span :class="kdDelta >= 0 ? 'mm-stat__delta--up' : 'mm-stat__delta--down'">
            {{ kdDelta >= 0 ? '+' : '' }}{{ kdDelta.toFixed(1) }}%
          </span>
          vs first · last {{ lastKd.toFixed(2) }}
        </div>
      </div>
    </section>

    <section class="mm-panel">
      <div class="mm-panel__body">
        <div class="mm-trend-card__head">
          <div>
            <span class="mm-eyebrow mm-eyebrow--strong">Kill rate</span>
            <div class="mm-card__hint">
              kills / minute · {{ visibleKillRate.length || 0 }} pts
              <template v-if="!isZoomed"> · drag to zoom</template>
            </div>
          </div>
          <button
            type="button"
            class="mm-trend-card__expand"
            aria-label="Expand trend graphs to full screen"
            @click="openFullscreen"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-for="d in expandIcon" :key="d" :d="d" />
            </svg>
            Expand
          </button>
        </div>
        <div v-if="visibleKillRate.length > 1" class="mm-trend-card__chart">
          <MmSparkline
            :values="visibleKillRate.map(p => p.value)"
            :timestamps="visibleKillRate.map(p => p.timestamp)"
            :height="56"
            :accent="true"
            :show-axis="true"
            :brushable="true"
            unit="kills/min"
            @brush="onChartBrush"
          />
        </div>
        <div v-else-if="loading" class="mm-skeleton" style="margin-top: 10px; height: 56px" />
        <div v-else class="mm-card__empty">Not enough rounds yet.</div>
        <div v-if="killRateDelta != null && lastKillRate != null" class="mm-card__foot">
          <span :class="killRateDelta >= 0 ? 'mm-stat__delta--up' : 'mm-stat__delta--down'">
            {{ killRateDelta >= 0 ? '+' : '' }}{{ killRateDelta.toFixed(1) }}%
          </span>
          vs first · last {{ lastKillRate.toFixed(2) }}
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="isFullscreen"
        ref="fsRoot"
        class="mm mm-trend-fs"
        data-testid="trend-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="Trend inspector"
        tabindex="-1"
        @click.self="closeFullscreen"
      >
        <div class="mm-trend-fs__frame">
          <header class="mm-trend-fs__head">
            <div>
              <div class="mm-eyebrow mm-eyebrow--strong">Trend inspector</div>
              <h2 class="mm-h2" style="margin: 4px 0 0">K/D and kill rate</h2>
              <p class="mm-card__hint" style="margin-top: 6px">
                Drag a slice to zoom — both graphs share the window.
                Times in your local time.
              </p>
            </div>
            <div class="mm-trend-fs__head-actions">
              <button v-if="isZoomed && zoomStack.length > 1" type="button" class="mm-btn" @click="stepBack">
                ← Wider
              </button>
              <button v-if="isZoomed" type="button" class="mm-btn" @click="resetZoom">Reset zoom</button>
              <button
                type="button"
                class="mm-trend-so__close"
                aria-label="Exit full screen"
                @click="closeFullscreen"
              >
                ✕ Exit (Esc)
              </button>
            </div>
          </header>

          <div v-if="kdTrend.length > 1" class="mm-trend-fs__overview">
            <div class="mm-eyebrow">Career</div>
            <MmSparkline
              :values="kdTrend.map(p => p.value)"
              :timestamps="kdTrend.map(p => p.timestamp)"
              :height="36"
              :brushable="true"
              :highlight-range="highlightRange"
              unit="K/D"
              @brush="onOverviewBrush"
            />
          </div>

          <div class="mm-trend-fs__charts">
            <section class="mm-trend-fs__chart">
              <div class="mm-trend-card__head">
                <div>
                  <span class="mm-eyebrow mm-eyebrow--strong">K/D trend</span>
                  <div class="mm-card__hint">{{ rangeLabel }} · {{ visibleKd.length }} pts</div>
                </div>
                <span v-if="lastKd != null" class="mm-trend-fs__live">{{ lastKd.toFixed(2) }}</span>
              </div>
              <MmSparkline
                v-if="visibleKd.length > 1"
                :values="visibleKd.map(p => p.value)"
                :timestamps="visibleKd.map(p => p.timestamp)"
                :height="220"
                :show-axis="true"
                :show-value-scale="true"
                :brushable="true"
                unit="K/D"
                @brush="onChartBrush"
              />
            </section>

            <section class="mm-trend-fs__chart">
              <div class="mm-trend-card__head">
                <div>
                  <span class="mm-eyebrow mm-eyebrow--strong">Kill rate</span>
                  <div class="mm-card__hint">kills / minute · {{ visibleKillRate.length }} pts</div>
                </div>
                <span v-if="lastKillRate != null" class="mm-trend-fs__live mm-trend-fs__live--accent">
                  {{ lastKillRate.toFixed(2) }}
                </span>
              </div>
              <MmSparkline
                v-if="visibleKillRate.length > 1"
                :values="visibleKillRate.map(p => p.value)"
                :timestamps="visibleKillRate.map(p => p.timestamp)"
                :height="220"
                :accent="true"
                :show-axis="true"
                :show-value-scale="true"
                :brushable="true"
                unit="kills/min"
                @brush="onChartBrush"
              />
            </section>
          </div>

          <footer class="mm-trend-fs__foot">
            <div>
              <div class="mm-meta-row__strong">{{ rangeLabel || 'Full career' }}</div>
              <div class="mm-card__hint">
                <template v-if="windowRounds">{{ windowRounds.toLocaleString() }} rounds · </template>
                <template v-if="kdDelta != null">
                  K/D {{ kdDelta >= 0 ? '+' : '' }}{{ kdDelta.toFixed(1) }}%
                </template>
              </div>
            </div>
            <div class="mm-btn-row">
              <button type="button" class="mm-btn" @click="openSessionsPage">Open sessions page</button>
              <button type="button" class="mm-btn mm-btn--accent" @click="openRounds">
                {{ roundsCta }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Teleport>

    <MmTrendRoundsSlideover
      :open="roundsOpen"
      :player-name="playerName"
      :from-iso="fromIso"
      :to-iso="toIso"
      :range-label="rangeLabel"
      @close="closeRounds"
    />
  </div>
</template>

<style scoped>
.mm-trend-pair {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.mm-trend-pair__window {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 10px 12px;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
}

.mm-trend-pair__range {
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink);
}

.mm-trend-pair__window-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.mm-trend-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.mm-trend-card__expand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 8px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s ease;
}

.mm-trend-card__expand:hover,
.mm-trend-card__expand:focus-visible {
  color: var(--mm-ink);
  outline: none;
}

.mm-trend-card__chart { margin-top: 10px; }

.mm-trend-fs {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--mm-bg);
  display: flex;
  flex-direction: column;
}

.mm-trend-fs__frame {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 18px 24px 16px;
  gap: 16px;
}

.mm-trend-fs__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-trend-fs__head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mm-trend-fs__overview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-trend-fs__charts {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 18px;
  overflow-y: auto;
}

.mm-trend-fs__chart {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mm-trend-fs__live {
  font-family: var(--mm-font-mono);
  font-size: 22px;
  letter-spacing: 0.02em;
  color: var(--mm-ink);
  line-height: 1;
}

.mm-trend-fs__live--accent { color: var(--mm-accent-soft); }

.mm-trend-fs__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 1px solid var(--mm-rule);
  flex-shrink: 0;
}

.mm-trend-so__close {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: transparent;
  border: 1px solid var(--mm-rule);
  padding: 10px 14px;
  min-height: 44px;
  cursor: pointer;
  border-radius: 2px;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.mm-trend-so__close:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink-soft);
}

@media (max-width: 720px) {
  .mm-trend-fs__frame { padding: 12px 14px 12px; }
  .mm-trend-fs__charts { gap: 14px; }
  .mm-trend-fs__live { font-size: 18px; }
  .mm-trend-fs__chart :deep(.mm-sparkline-wrap) {
    height: 140px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mm-trend-card__expand { transition: none; }
}
</style>
