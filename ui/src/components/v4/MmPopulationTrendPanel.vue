<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import MmPopulationTrendChart, { type TrendChartSeries } from '@/components/v4/MmPopulationTrendChart.vue'
import MmTrendServerPicker, { type TrendPickerServer } from '@/components/v4/MmTrendServerPicker.vue'
import {
  fetchNetworkPlayerTrend,
  fetchServerPlayerTrend,
  type PlayerTrendPoint,
} from '@/services/playerTrendService'
import {
  buildTrendSeries,
  methodNote,
  trendInsights,
  TREND_WEEKDAYS,
  type TrendRange,
} from '@/utils/playerTrend'
import { decodeServerName } from '@/utils/playerName'
import { MM_CHART } from '@/views/v4/mmTokens'

const OVERLAY = [
  MM_CHART.kill,
  MM_CHART.success,
  MM_CHART.accentSoft,
  MM_CHART.elite,
  MM_CHART.highlight,
  MM_CHART.inkSoft,
]

const props = defineProps<{
  servers?: TrendPickerServer[]
  showPicker?: boolean
  serverGuid?: string
  serverLabel?: string
  game?: string
}>()

const emit = defineEmits<{
  summary: [payload: { peak: number; avg: number }]
}>()

const range = ref<TrendRange>('30d')
const weekday = ref(new Date().getDay())
const selectedGuids = ref<string[]>([])
const extras = ref({ peak: true, avg: true, ghost: true })

const loading = ref(false)
const error = ref<string | null>(null)
const networkPoints = ref<PlayerTrendPoint[] | null>(null)
const networkCount = ref(0)
const seriesCache = ref<Record<string, PlayerTrendPoint[]>>({})

const RANGE_TABS: { k: TrendRange; l: string }[] = [
  { k: '30d', l: '30 Days' },
  { k: '7d', l: '7 Days' },
  { k: 'weekday', l: 'Typical Weekday' },
]

const loadNetwork = async () => {
  if (networkPoints.value) return
  loading.value = true
  error.value = null
  try {
    const res = await fetchNetworkPlayerTrend(props.game ?? 'bf1942')
    networkPoints.value = res.points ?? []
    networkCount.value = res.serverCount
  } catch {
    error.value = 'Trend feed temporarily unavailable.'
    networkPoints.value = []
  } finally {
    loading.value = false
  }
}

const loadServer = async (guid: string) => {
  if (seriesCache.value[guid]) return
  try {
    const res = await fetchServerPlayerTrend(guid)
    seriesCache.value = { ...seriesCache.value, [guid]: res.points ?? [] }
  } catch {
    seriesCache.value = { ...seriesCache.value, [guid]: [] }
  }
}

onMounted(async () => {
  if (props.serverGuid) {
    loading.value = true
    error.value = null
    try {
      await loadServer(props.serverGuid)
    } catch {
      error.value = 'Trend feed temporarily unavailable.'
    } finally {
      loading.value = false
    }
    return
  }
  await loadNetwork()
})

watch(selectedGuids, async (guids) => {
  const missing = guids.filter(g => !seriesCache.value[g]).slice(0, 8)
  if (missing.length === 0) return
  await Promise.all(missing.map(loadServer))
})

const overlayKeys = computed(() =>
  props.serverGuid ? [props.serverGuid] : selectedGuids.value.slice(0, 8),
)

const labelFor = (guid: string) => {
  if (props.serverGuid && guid === props.serverGuid) {
    return props.serverLabel || 'This server'
  }
  const s = props.servers?.find(x => x.guid === guid)
  return s ? decodeServerName(s.name) : guid
}

const builtPrimary = computed(() =>
  buildTrendSeries(primaryPoints.value, range.value, weekday.value, extras.value.ghost),
)

const primaryPoints = computed((): PlayerTrendPoint[] => {
  if (props.serverGuid) return seriesCache.value[props.serverGuid] ?? []
  if (overlayKeys.value.length > 0) return seriesCache.value[overlayKeys.value[0]] ?? []
  return networkPoints.value ?? []
})

const chartSeries = computed((): TrendChartSeries[] => {
  if (props.serverGuid) {
    return [{
      key: props.serverGuid,
      label: labelFor(props.serverGuid),
      color: MM_CHART.accent,
      values: builtPrimary.value.values,
    }]
  }
  if (overlayKeys.value.length === 0) {
    return [{
      key: 'network',
      label: 'Live network',
      color: MM_CHART.accent,
      values: builtPrimary.value.values,
    }]
  }
  return overlayKeys.value.map((guid, i) => {
    const built = buildTrendSeries(
      seriesCache.value[guid] ?? [],
      range.value,
      weekday.value,
      false,
    )
    return {
      key: guid,
      label: labelFor(guid),
      color: OVERLAY[i % OVERLAY.length],
      values: built.values,
    }
  })
})

const insights = computed(() => trendInsights(chartSeries.value[0]?.values ?? []))

watch(insights, (ins) => {
  emit('summary', { peak: ins.peak, avg: ins.avg })
}, { immediate: true })

const showBand = computed(() => range.value === 'weekday' && extras.value.ghost)
const showPrev = computed(() => range.value !== 'weekday' && extras.value.ghost)

const legendItems = computed(() => {
  const items = chartSeries.value.map(s => ({ label: s.label, color: s.color, dashed: false, band: false }))
  if (showPrev.value && builtPrimary.value.prev) {
    items.push({ label: 'Prev period', color: MM_CHART.inkFaint, dashed: true, band: false })
  }
  if (showBand.value && builtPrimary.value.band) {
    items.push({
      label: `Busiest–quietest ${TREND_WEEKDAYS[weekday.value]}`,
      color: MM_CHART.ink,
      dashed: false,
      band: true,
    })
  }
  if (extras.value.avg) {
    items.push({ label: 'Average', color: MM_CHART.inkMuted, dashed: true, band: false })
  }
  return items
})

const trendLabel = computed(() => {
  const pct = insights.value.pctChange
  if (pct > 0) return `▲ +${pct}%`
  if (pct < 0) return `▼ ${pct}%`
  return '– 0%'
})
const trendClass = computed(() => {
  const pct = insights.value.pctChange
  if (pct > 2) return 'mm-num--load-busy'
  if (pct < -2) return 'mm-num--kill'
  return ''
})

const ghostLabel = computed(() => range.value === 'weekday' ? 'Range band' : 'Prev period')

const toggleExtra = (k: 'peak' | 'avg' | 'ghost') => {
  extras.value = { ...extras.value, [k]: !extras.value[k] }
}

const empty = computed(() =>
  !loading.value && !error.value && (chartSeries.value[0]?.values.length ?? 0) === 0,
)
</script>

<template>
  <div class="mm-pop-trend">
    <div class="tc-controls" :class="{ 'tc-controls--stack': showPicker }">
      <div class="tc-ctl-group">
        <span class="tc-ctl-label">Range</span>
        <div class="tc-tabs">
          <button
            v-for="t in RANGE_TABS"
            :key="t.k"
            type="button"
            class="tc-tab"
            :class="{ 'tc-tab--on': range === t.k }"
            @click="range = t.k"
          >{{ t.l }}</button>
        </div>
      </div>

      <div v-if="range === 'weekday'" class="tc-ctl-group">
        <span class="tc-ctl-label">Weekday</span>
        <select v-model.number="weekday" class="tc-select" aria-label="Weekday">
          <option v-for="(w, i) in TREND_WEEKDAYS" :key="w" :value="i">{{ w }}</option>
        </select>
      </div>

      <MmTrendServerPicker
        v-if="showPicker"
        v-model="selectedGuids"
        :servers="servers ?? []"
      />

      <div class="tc-ctl-group">
        <span class="tc-ctl-label">Show</span>
        <div class="tc-tabs">
          <button type="button" class="tc-chip" :class="{ 'tc-chip--on': extras.peak }" @click="toggleExtra('peak')">Peak</button>
          <button type="button" class="tc-chip" :class="{ 'tc-chip--on': extras.avg }" @click="toggleExtra('avg')">Average</button>
          <button type="button" class="tc-chip" :class="{ 'tc-chip--on': extras.ghost }" @click="toggleExtra('ghost')">{{ ghostLabel }}</button>
        </div>
      </div>
    </div>

    <div class="tc-insights">
      <div class="tc-insight">
        <span class="tc-insight__k">Peak</span>
        <span class="tc-insight__v mm-num--load-full">{{ Math.round(insights.peak).toLocaleString() }}</span>
        <span class="tc-insight__s">{{ builtPrimary.tsLabel(insights.peakIndex) }}</span>
      </div>
      <div class="tc-insight">
        <span class="tc-insight__k">Average</span>
        <span class="tc-insight__v">{{ Math.round(insights.avg).toLocaleString() }}</span>
        <span class="tc-insight__s">this period</span>
      </div>
      <div class="tc-insight">
        <span class="tc-insight__k">Trend</span>
        <span class="tc-insight__v" :class="trendClass">{{ trendLabel }}</span>
        <span class="tc-insight__s">vs previous</span>
      </div>
    </div>

    <div v-if="loading" class="mm-pop-trend__skel">
      <div class="mm-skeleton" style="height: 280px" />
    </div>
    <div v-else-if="error" class="mm-empty" style="border: 0">{{ error }}</div>
    <div v-else-if="empty" class="mm-empty" style="border: 0">No occupancy history for this window yet.</div>
    <MmPopulationTrendChart
      v-else
      :series="chartSeries"
      :prev="showPrev ? builtPrimary.prev : null"
      :band="showBand ? builtPrimary.band : null"
      :x-ticks="builtPrimary.xTicks"
      :ts-label="builtPrimary.tsLabel"
      :show-avg="extras.avg"
      :show-peak="extras.peak"
      :avg="insights.avg"
      :peak-index="insights.peakIndex"
    />

    <div class="tc-legend">
      <span v-for="l in legendItems" :key="l.label" class="tc-legend__item">
        <span
          class="tc-legend__swatch"
          :class="{ 'tc-legend__swatch--dash': l.dashed, 'tc-legend__swatch--band': l.band }"
          :style="{ background: l.color }"
        />
        {{ l.label }}
      </span>
    </div>
    <div class="tc-legend__note">
      {{ methodNote(range, weekday) }} · Times shown in your local time
      <template v-if="!serverGuid && overlayKeys.length === 0 && networkCount > 0">
        · {{ networkCount }} live {{ networkCount === 1 ? 'host' : 'hosts' }}
      </template>
    </div>
  </div>
</template>

<style scoped>
.tc-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 18px 26px;
  align-items: flex-start;
}
.tc-controls--stack { gap: 14px 22px; }
.tc-ctl-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.tc-ctl-label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.tc-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.tc-tab,
.tc-chip {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding: 6px 12px;
  border-radius: 2px;
  cursor: pointer;
  border: 1px solid var(--mm-rule);
  background: transparent;
  color: var(--mm-ink-muted);
  min-height: 32px;
}
.tc-chip {
  font-size: 10.5px;
  letter-spacing: 0.07em;
  padding: 5px 10px;
}
.tc-tab--on {
  border-color: var(--mm-accent);
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
}
.tc-chip--on {
  border-color: var(--mm-accent-soft);
  background: color-mix(in srgb, var(--mm-accent-soft) 16%, transparent);
  color: var(--mm-accent-soft);
}
.tc-select {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 6px 10px;
  cursor: pointer;
  min-height: 32px;
}
.tc-insights {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--mm-rule);
  border: 1px solid var(--mm-rule);
  margin: 20px 0 18px;
}
.tc-insight {
  background: var(--mm-bg);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tc-insight__k {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.tc-insight__v {
  font-family: var(--mm-font-mono);
  font-size: 22px;
  color: var(--mm-ink);
}
.tc-insight__s {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}
.tc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  align-items: center;
  margin-top: 12px;
}
.tc-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}
.tc-legend__swatch {
  width: 14px;
  height: 3px;
  border-radius: 1px;
  display: inline-block;
}
.tc-legend__swatch--dash { height: 2px; }
.tc-legend__swatch--band { height: 8px; }
.tc-legend__note {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
  margin-top: 8px;
}
.mm-pop-trend__skel { margin: 18px 0; }
@media (max-width: 720px) {
  .tc-insights { grid-template-columns: 1fr; }
  .tc-tab, .tc-chip { min-height: 44px; }
}
</style>
