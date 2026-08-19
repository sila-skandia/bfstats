<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ServerSummary } from '@/types/server'
import {
  ALL_COLUMNS,
  COLUMN_GROUPS,
  columnFilterStep,
  columnNumericExtent,
  formatColFilterValue,
  formatFilterNumber,
  formatNumberRangeQuery,
  getCol,
  parseNumberRangeQuery,
  uniqueColumnValues,
  type FilterKind,
} from './landingServerTable'

const props = defineProps<{
  open: boolean
  columnKey: string | null
  servers: ServerSummary[]
  filters: Record<string, string>
  isNarrow: boolean
}>()

const emit = defineEmits<{
  close: []
  'update:columnKey': [key: string | null]
  setFilter: [key: string, value: string]
  clearFilter: [key: string]
  clearAll: []
}>()

const boolOptions = [
  { value: '' as const, label: 'Any' },
  { value: 'yes' as const, label: 'Yes' },
  { value: 'no' as const, label: 'No' },
]

const colQuery = ref('')
const textDraft = ref('')
const textInputEl = ref<HTMLInputElement | null>(null)
const rangeLo = ref(0)
const rangeHi = ref(0)

const activeCol = computed(() => (props.columnKey ? getCol(props.columnKey) : undefined))
const activeKind = computed<FilterKind>(() => activeCol.value?.filter ?? 'none')
const activeLabel = computed(() => activeCol.value?.label ?? 'Filters')
const activeQuery = computed(() => {
  if (!props.columnKey) return ''
  return props.filters[props.columnKey]?.trim() ?? ''
})

const groupedColumns = computed(() => {
  const q = colQuery.value.trim().toLowerCase()
  return COLUMN_GROUPS.map(group => ({
    ...group,
    cols: ALL_COLUMNS.filter(c => {
      if (c.filter === 'none' || c.group !== group.id) return false
      if (!q) return true
      return c.label.toLowerCase().includes(q) || c.key.includes(q)
    }),
  })).filter(g => g.cols.length > 0)
})

const uniqueValues = computed(() => {
  if (!props.columnKey || activeKind.value === 'number') return []
  const q = textDraft.value.trim().toLowerCase()
  return uniqueColumnValues(props.servers, props.columnKey).filter(row =>
    !q || row.value.toLowerCase().includes(q),
  )
})

const numericExtent = computed(() => {
  if (!props.columnKey || activeKind.value !== 'number') return null
  return columnNumericExtent(props.servers, props.columnKey)
})

const rangeStep = computed(() => {
  if (!props.columnKey || !numericExtent.value) return 1
  return columnFilterStep(props.columnKey, numericExtent.value)
})

const rangeFill = computed(() => {
  const extent = numericExtent.value
  if (!extent) return { left: '0%', width: '100%' }
  const span = extent.max - extent.min || 1
  const lo = Math.min(rangeLo.value, rangeHi.value)
  const hi = Math.max(rangeLo.value, rangeHi.value)
  return {
    left: `${((lo - extent.min) / span) * 100}%`,
    width: `${((hi - lo) / span) * 100}%`,
  }
})

const activeFilterCount = computed(() =>
  Object.values(props.filters).filter(v => v.trim()).length,
)

const syncRangeFromFilter = () => {
  const extent = numericExtent.value
  if (!extent || !props.columnKey) return
  const parsed = parseNumberRangeQuery(activeQuery.value)
  const lo = parsed?.min ?? extent.min
  const hi = parsed?.max ?? extent.max
  rangeLo.value = Math.min(Math.max(lo, extent.min), extent.max)
  rangeHi.value = Math.min(Math.max(hi, extent.min), extent.max)
  if (rangeLo.value > rangeHi.value) {
    const swap = rangeLo.value
    rangeLo.value = rangeHi.value
    rangeHi.value = swap
  }
}

const commitRange = () => {
  if (!props.columnKey || !numericExtent.value) return
  let lo = Math.min(rangeLo.value, rangeHi.value)
  let hi = Math.max(rangeLo.value, rangeHi.value)
  const { min, max } = numericExtent.value
  lo = Math.min(Math.max(lo, min), max)
  hi = Math.min(Math.max(hi, min), max)
  rangeLo.value = lo
  rangeHi.value = hi
  if (lo <= min && hi >= max) {
    emit('clearFilter', props.columnKey)
    return
  }
  emit('setFilter', props.columnKey, formatNumberRangeQuery(lo, hi))
}

const onLoInput = (e: Event) => {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  rangeLo.value = Number(target.value)
  if (rangeLo.value > rangeHi.value) rangeHi.value = rangeLo.value
  commitRange()
}

const onHiInput = (e: Event) => {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  rangeHi.value = Number(target.value)
  if (rangeHi.value < rangeLo.value) rangeLo.value = rangeHi.value
  commitRange()
}

const setTextFilter = (value: string) => {
  if (!props.columnKey) return
  textDraft.value = value
  if (value.trim()) emit('setFilter', props.columnKey, value)
  else emit('clearFilter', props.columnKey)
}

const pickValue = (value: string) => {
  setTextFilter(value)
}

const setBoolFilter = (value: '' | 'yes' | 'no') => {
  if (!props.columnKey) return
  if (!value) emit('clearFilter', props.columnKey)
  else emit('setFilter', props.columnKey, value)
}

const openCol = async (key: string) => {
  emit('update:columnKey', key)
  await nextTick()
}

const goBack = () => {
  emit('update:columnKey', null)
  colQuery.value = ''
}

const close = () => emit('close')

const clearCurrent = () => {
  if (props.columnKey) {
    emit('clearFilter', props.columnKey)
    textDraft.value = ''
    if (numericExtent.value) {
      rangeLo.value = numericExtent.value.min
      rangeHi.value = numericExtent.value.max
    }
    return
  }
  emit('clearAll')
}

const colSummary = (key: string) => formatColFilterValue(key, props.filters[key] || '')

watch(
  () => [props.open, props.columnKey] as const,
  async ([open, key]) => {
    if (!open) return
    colQuery.value = ''
    textDraft.value = key ? (props.filters[key] || '') : ''
    await nextTick()
    if (key && getCol(key)?.filter === 'number') syncRangeFromFilter()
    if (key && getCol(key)?.filter === 'text') textInputEl.value?.focus()
  },
)

watch(
  () => [props.columnKey, props.servers, activeQuery.value] as const,
  () => {
    if (!props.open || activeKind.value !== 'number') return
    syncRangeFromFilter()
  },
)

watch(
  () => props.filters[props.columnKey ?? ''] ?? '',
  (value) => {
    if (activeKind.value === 'text' || activeKind.value === 'bool') {
      textDraft.value = value
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="mm lb-filter-back"
      data-lbmenu="filters"
      @click.self="close"
    >
      <div
        class="lb-filter-panel"
        :class="{ 'lb-filter-panel--sheet': isNarrow }"
        data-testid="landing-filter-panel"
        data-lbmenu="filters"
        role="dialog"
        aria-modal="true"
        :aria-label="columnKey ? activeLabel : 'Column filters'"
        @click.stop
      >
        <div class="lb-sheet-head">
          <div class="lb-sheet-head-copy">
            <button
              v-if="columnKey"
              type="button"
              class="lb-sheet-back"
              aria-label="Back to all filters"
              @click="goBack"
            >
              <i class="pi pi-arrow-left" aria-hidden="true"></i>
            </button>
            <div>
              <div class="mm-eyebrow">FILTER</div>
              <h2 class="lb-sheet-title">{{ columnKey ? activeLabel : 'Filters' }}</h2>
            </div>
          </div>
          <div class="lb-sheet-actions">
            <button
              v-if="columnKey ? Boolean(activeQuery) : activeFilterCount > 0"
              type="button"
              class="lb-sheet-clear"
              @click="clearCurrent"
            >Clear</button>
            <button type="button" class="lb-sheet-done" @click="close">Done</button>
          </div>
        </div>

        <!-- Column list -->
        <template v-if="!columnKey">
          <div class="lb-server-search-box">
            <i class="pi pi-search lb-server-search-icon" aria-hidden="true"></i>
            <input
              v-model="colQuery"
              type="text"
              class="lb-server-search-input"
              placeholder="Find a column…"
              aria-label="Find a column"
            />
            <button
              v-if="colQuery"
              type="button"
              class="lb-server-search-clear"
              title="Clear search"
              @click="colQuery = ''"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>
          <div class="lb-server-list">
            <template v-for="group in groupedColumns" :key="group.id">
              <div class="lb-col-group__label">{{ group.label }}</div>
              <button
                v-for="col in group.cols"
                :key="col.key"
                type="button"
                class="lb-server-item"
                :class="{ 'lb-server-item--active': Boolean(filters[col.key]?.trim()) }"
                :data-testid="`filter-col-${col.key}`"
                @click="openCol(col.key)"
              >
                <span class="lb-server-item-name">{{ col.label }}</span>
                <span v-if="colSummary(col.key)" class="lb-col-summary">{{ colSummary(col.key) }}</span>
                <span v-else class="lb-col-kind">{{ col.filter === 'number' ? 'Range' : col.filter === 'bool' ? 'Yes / No' : 'Search' }}</span>
                <i class="pi pi-chevron-right lb-col-chevron" aria-hidden="true"></i>
              </button>
            </template>
            <div v-if="groupedColumns.length === 0" class="lb-server-empty">
              No columns match “{{ colQuery }}”
            </div>
          </div>
        </template>

        <!-- Text editor -->
        <template v-else-if="activeKind === 'text'">
          <div class="lb-server-search-box">
            <i class="pi pi-search lb-server-search-icon" aria-hidden="true"></i>
            <input
              ref="textInputEl"
              :value="textDraft"
              type="text"
              class="lb-server-search-input"
              :placeholder="`Search ${activeLabel.toLowerCase()}…`"
              :aria-label="`Filter ${activeLabel}`"
              :data-testid="`col-filter-${columnKey}`"
              @input="setTextFilter(($event.target as HTMLInputElement).value)"
            />
            <button
              v-if="textDraft"
              type="button"
              class="lb-server-search-clear"
              title="Clear search"
              @click="setTextFilter('')"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>
          <div class="lb-server-list">
            <button
              type="button"
              class="lb-server-item"
              :class="{ 'lb-server-item--active': !activeQuery }"
              :aria-pressed="!activeQuery"
              @click="setTextFilter('')"
            >
              <span class="lb-pick-mark" :class="{ 'is-on': !activeQuery }" aria-hidden="true"></span>
              <span class="lb-server-item-name">Any {{ activeLabel.toLowerCase() }}</span>
              <span v-if="!activeQuery" class="lb-pick-state">ON</span>
            </button>
            <button
              v-for="row in uniqueValues"
              :key="row.value"
              type="button"
              class="lb-server-item"
              :class="{ 'lb-server-item--active': textDraft.toLowerCase() === row.value.toLowerCase() }"
              :aria-pressed="textDraft.toLowerCase() === row.value.toLowerCase()"
              @click="pickValue(row.value)"
            >
              <span
                class="lb-pick-mark"
                :class="{ 'is-on': textDraft.toLowerCase() === row.value.toLowerCase() }"
                aria-hidden="true"
              ></span>
              <span class="lb-server-item-name">{{ row.value }}</span>
              <span class="lb-server-count">{{ row.count }}</span>
              <span
                v-if="textDraft.toLowerCase() === row.value.toLowerCase()"
                class="lb-pick-state"
              >ON</span>
            </button>
            <div v-if="uniqueValues.length === 0" class="lb-server-empty">
              No matching values
            </div>
          </div>
        </template>

        <!-- Number range editor -->
        <template v-else-if="activeKind === 'number'">
          <div v-if="numericExtent" class="lb-range-body">
            <div class="lb-range-labels">
              <span>{{ formatFilterNumber(columnKey || '', rangeLo) }}</span>
              <span class="lb-range-sep">to</span>
              <span>{{ formatFilterNumber(columnKey || '', rangeHi) }}</span>
            </div>
            <div class="lb-range-track">
              <div class="lb-range-rail"></div>
              <div class="lb-range-fill" :style="rangeFill"></div>
              <input
                type="range"
                class="lb-range-thumb lb-range-thumb--lo"
                :min="numericExtent.min"
                :max="numericExtent.max"
                :step="rangeStep"
                :value="rangeLo"
                :aria-label="`${activeLabel} minimum`"
                @input="onLoInput"
              />
              <input
                type="range"
                class="lb-range-thumb lb-range-thumb--hi"
                :min="numericExtent.min"
                :max="numericExtent.max"
                :step="rangeStep"
                :value="rangeHi"
                :aria-label="`${activeLabel} maximum`"
                @input="onHiInput"
              />
            </div>
            <div class="lb-range-inputs">
              <label class="lb-range-field">
                <span>Min</span>
                <input
                  type="number"
                  :min="numericExtent.min"
                  :max="numericExtent.max"
                  :step="rangeStep"
                  :value="rangeLo"
                  :data-testid="`col-filter-${columnKey}-min`"
                  @input="onLoInput"
                />
              </label>
              <label class="lb-range-field">
                <span>Max</span>
                <input
                  type="number"
                  :min="numericExtent.min"
                  :max="numericExtent.max"
                  :step="rangeStep"
                  :value="rangeHi"
                  :data-testid="`col-filter-${columnKey}-max`"
                  @input="onHiInput"
                />
              </label>
            </div>
            <p class="lb-range-hint">
              Data range {{ formatFilterNumber(columnKey || '', numericExtent.min) }}
              – {{ formatFilterNumber(columnKey || '', numericExtent.max) }}
            </p>
          </div>
          <div v-else class="lb-server-empty">No numeric values in this column yet.</div>
        </template>

        <!-- Bool editor -->
        <template v-else-if="activeKind === 'bool'">
          <div class="lb-server-list">
            <button
              v-for="opt in boolOptions"
              :key="opt.label"
              type="button"
              class="lb-server-item"
              :class="{ 'lb-server-item--active': (activeQuery.toLowerCase() || '') === opt.value }"
              :aria-pressed="(activeQuery.toLowerCase() || '') === opt.value"
              :data-testid="opt.value ? `col-filter-${columnKey}-${opt.value}` : `col-filter-${columnKey}-any`"
              @click="setBoolFilter(opt.value)"
            >
              <span
                class="lb-pick-mark"
                :class="{ 'is-on': (activeQuery.toLowerCase() || '') === opt.value }"
                aria-hidden="true"
              ></span>
              <span class="lb-server-item-name">{{ opt.label }}</span>
              <span
                v-if="(activeQuery.toLowerCase() || '') === opt.value"
                class="lb-pick-state"
              >ON</span>
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lb-filter-back {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: color-mix(in srgb, var(--mm-bg) 55%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 10vh 16px 24px;
  box-sizing: border-box;
}

.lb-filter-panel {
  width: min(440px, 100%);
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 3px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  padding: 0 0 12px;
  overflow: hidden;
}

.lb-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--mm-rule);
}

.lb-sheet-head-copy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.lb-sheet-title {
  margin: 4px 0 0;
  font-family: var(--mm-font-display);
  font-size: 28px;
  font-weight: 500;
  color: var(--mm-ink);
  line-height: 1.1;
}

.lb-sheet-back {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  cursor: pointer;
}

.lb-sheet-back:hover {
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.lb-sheet-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.lb-sheet-done,
.lb-sheet-clear {
  flex-shrink: 0;
  min-height: 44px;
  min-width: 44px;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.lb-sheet-clear {
  border: 0;
  color: var(--mm-ink-muted);
}

.lb-sheet-done:hover {
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.lb-sheet-clear:hover {
  color: var(--mm-accent);
}

.lb-server-search-box {
  position: relative;
  display: flex;
  align-items: center;
  margin: 0 16px;
}

.lb-server-search-icon {
  position: absolute;
  left: 10px;
  font-size: 11px;
  color: var(--mm-ink-muted);
  pointer-events: none;
}

.lb-server-search-input {
  width: 100%;
  min-height: 40px;
  padding: 8px 32px 8px 30px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  color: var(--mm-ink);
  outline: none;
  box-sizing: border-box;
}

.lb-server-search-input:focus {
  border-color: var(--mm-accent);
}

.lb-server-search-clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--mm-ink-muted);
  cursor: pointer;
  padding: 4px;
  font-size: 11px;
}

.lb-server-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px 8px;
}

.lb-col-group__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  padding: 10px 10px 4px;
}

.lb-server-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px;
  border-radius: 2px;
  border: none;
  background: transparent;
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.lb-server-item:hover {
  background: var(--mm-bg-mute);
  color: var(--mm-accent);
}

.lb-server-item--active {
  background: color-mix(in srgb, var(--mm-accent) 18%, var(--mm-bg-mute));
  color: var(--mm-ink);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--mm-accent);
}

.lb-server-item-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-col-summary {
  margin-left: auto;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-accent-soft);
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-col-kind {
  margin-left: auto;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}

.lb-col-chevron {
  font-size: 10px;
  color: var(--mm-ink-faint);
  flex-shrink: 0;
}

.lb-server-count {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
  margin-left: auto;
  flex-shrink: 0;
}

.lb-pick-mark {
  width: 15px;
  height: 15px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  flex-shrink: 0;
  background: var(--mm-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.lb-pick-mark.is-on {
  background: var(--mm-accent);
  border-color: var(--mm-accent);
}

.lb-pick-mark.is-on::after {
  content: '';
  width: 7px;
  height: 4px;
  margin-top: -1px;
  border-left: 1.5px solid var(--mm-highlight-ink);
  border-bottom: 1.5px solid var(--mm-highlight-ink);
  transform: rotate(-45deg);
}

.lb-pick-state {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  font-weight: 700;
  color: var(--mm-highlight-ink);
  background: var(--mm-accent);
  padding: 2px 5px;
  border-radius: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.lb-server-empty {
  padding: 18px 12px;
  text-align: center;
  color: var(--mm-ink-muted);
  font-size: 13px;
}

.lb-range-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 20px 16px;
}

.lb-range-labels {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  font-family: var(--mm-font-mono);
  font-size: 22px;
  color: var(--mm-ink);
}

.lb-range-sep {
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.lb-range-track {
  position: relative;
  height: 28px;
}

.lb-range-rail,
.lb-range-fill {
  position: absolute;
  left: 0;
  right: 0;
  top: 12px;
  height: 4px;
  border-radius: 2px;
  background: var(--mm-rule-strong);
  pointer-events: none;
}

.lb-range-fill {
  right: auto;
  background: var(--mm-accent);
}

.lb-range-thumb {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 28px;
  margin: 0;
  background: transparent;
  pointer-events: none;
  appearance: none;
  -webkit-appearance: none;
}

.lb-range-thumb--lo {
  z-index: 3;
}

.lb-range-thumb--hi {
  z-index: 2;
}

.lb-range-thumb::-webkit-slider-runnable-track {
  background: transparent;
  height: 4px;
  border: none;
}

.lb-range-thumb::-moz-range-track {
  background: transparent;
  height: 4px;
  border: none;
}

.lb-range-thumb::-moz-range-progress {
  background: transparent;
}

.lb-range-thumb::-webkit-slider-thumb {
  pointer-events: auto;
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--mm-accent);
  background: var(--mm-bg);
  cursor: grab;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--mm-accent) 18%, transparent);
}

.lb-range-thumb::-moz-range-thumb {
  pointer-events: auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--mm-accent);
  background: var(--mm-bg);
  cursor: grab;
}

.lb-range-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.lb-range-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.lb-range-field input {
  min-height: 40px;
  padding: 8px 10px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 14px;
  outline: none;
}

.lb-range-field input:focus {
  border-color: var(--mm-accent);
}

.lb-range-hint {
  margin: 0;
  text-align: center;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
}

.lb-filter-panel--sheet {
  position: fixed;
  inset: 0;
  top: 0;
  left: 0;
  width: 100%;
  height: 100dvh;
  max-height: none;
  border: 0;
  border-radius: 0;
  padding: 0 0 env(safe-area-inset-bottom);
  box-shadow: none;
  background: var(--mm-bg);
}

.lb-filter-panel--sheet .lb-sheet-head {
  padding-top: max(16px, env(safe-area-inset-top));
}

.lb-filter-panel--sheet .lb-server-search-input {
  min-height: 44px;
  font-size: 16px;
}

.lb-filter-panel--sheet .lb-server-item {
  min-height: 48px;
  font-size: 15px;
}

@media (max-width: 720px) {
  .lb-filter-back {
    padding: 0;
    background: var(--mm-bg);
    align-items: stretch;
  }
}
</style>
