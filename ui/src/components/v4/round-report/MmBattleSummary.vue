<script setup lang="ts">
import { computed } from 'vue'
import type { RoundSummary } from '@/utils/battleEventGenerator'
import { kdClass } from '@/views/v4/mmTokens'

interface Props {
  summary: RoundSummary
}

const props = defineProps<Props>()

const mvpKd = computed(() => props.summary.mvp?.kd ?? 0)
</script>

<template>
  <div class="mm-summary">
    <div class="mm-stats mm-summary__stats" style="border-top: 0">
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Duration</div>
        <div class="mm-stat__value mm-stat__value--small">{{ summary.duration }}</div>
      </div>
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Total kills</div>
        <div class="mm-stat__value mm-stat__value--small mm-num--kill">{{ summary.totalKills }}</div>
      </div>
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Participants</div>
        <div class="mm-stat__value mm-stat__value--small">{{ summary.participants }}</div>
      </div>
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Avg K/D</div>
        <div class="mm-stat__value mm-stat__value--small" :class="kdClass(summary.avgKD)">{{ summary.avgKD.toFixed(2) }}</div>
      </div>
    </div>

    <div v-if="summary.mvp" class="mm-summary__mvp">
      <div class="mm-summary__mvp-badge">★</div>
      <div class="mm-summary__mvp-body">
        <div class="mm-eyebrow mm-eyebrow--strong">Tactical MVP</div>
        <div class="mm-summary__mvp-name">{{ $pn(summary.mvp.playerName) }}</div>
        <div class="mm-summary__mvp-meta">
          <span class="mm-num--score">{{ summary.mvp.score }} pts</span>
          <span class="mm-meta-row__sep">·</span>
          <span class="mm-num--kill">{{ summary.mvp.kills }}</span>
          <span class="mm-num__sep">/</span>
          <span class="mm-num--death">{{ summary.mvp.deaths }}</span>
          <span class="mm-meta-row__sep">·</span>
          <span :class="kdClass(mvpKd)">{{ mvpKd.toFixed(2) }} K/D</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-summary {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  align-items: stretch;
}

.mm-summary__stats {
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--mm-ink);
}

.mm-summary__mvp {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border: 1px solid var(--mm-accent);
  background: rgba(241, 222, 117, 0.12);
  border-radius: 2px;
}

.mm-summary__mvp-badge {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--mm-accent);
  color: var(--mm-bg);
  font-size: 18px;
  font-weight: 500;
}

.mm-summary__mvp-body {
  min-width: 0;
}

.mm-summary__mvp-name {
  font-family: var(--mm-font-display);
  font-size: 18px;
  font-weight: 500;
  color: var(--mm-ink);
  margin: 2px 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-summary__mvp-meta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex-wrap: wrap;
}

@media (max-width: 880px) {
  .mm-summary { grid-template-columns: 1fr; }
  .mm-summary__stats { grid-template-columns: repeat(2, 1fr); }
}
</style>
