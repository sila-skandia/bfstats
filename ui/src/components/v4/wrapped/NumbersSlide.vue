<template>
  <div class="wrapped-slide numbers-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">01 — THE YEAR IN NUMBERS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">The front never slept.</h2>
    </div>

    <div class="numbers-content">
      <div class="metrics-row">
        <!-- Column 1: Rounds Fought -->
        <div class="metric-column animate-rise-up" style="animation-delay: 0.15s">
          <div class="metric-val">
            <num-count :data-to="data.yearInNumbers.roundsFought" data-dur="1200" data-delay="120"></num-count>
          </div>
          <div class="mm-eyebrow">ROUNDS FOUGHT</div>
        </div>
        <!-- Column 2: Unique Soldiers -->
        <div class="metric-column animate-rise-up" style="animation-delay: 0.25s">
          <div class="metric-val">
            <num-count :data-to="data.yearInNumbers.uniqueSoldiers" data-dur="1200" data-delay="240"></num-count>
          </div>
          <div class="mm-eyebrow">UNIQUE SOLDIERS</div>
        </div>
        <!-- Column 3: Combat Hours -->
        <div class="metric-column last animate-rise-up" style="animation-delay: 0.35s">
          <div class="metric-val">
            <num-count :data-to="Math.round(data.yearInNumbers.hoursInCombat)" data-dur="1250" data-delay="360"></num-count>
          </div>
          <div class="mm-eyebrow">HOURS IN COMBAT</div>
        </div>
      </div>

      <div class="metrics-footer animate-rise-up" style="animation-delay: 0.45s">
        PEAK POPULATION <span class="text-ink">{{ data.yearInNumbers.peakPopulation }}</span> · {{ formattedPeakDate }} · <span class="text-ink">{{ data.yearInNumbers.totalDecorations.toLocaleString() }}</span> DECORATIONS AWARDED
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ServerWrappedData } from '@/services/wrappedService'

const props = defineProps<{
  data: ServerWrappedData
}>()

const formattedPeakDate = computed(() => {
  if (!props.data.yearInNumbers.peakTimestamp || props.data.yearInNumbers.peakTimestamp.startsWith('-999')) {
    return 'N/A'
  }
  try {
    const d = new Date(props.data.yearInNumbers.peakTimestamp)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).toUpperCase()
  } catch {
    return '2026'
  }
})
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.slide-header {
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.slide-badge {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.slide-title {
  font-family: var(--mm-font-display);
  font-size: 38px;
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 0;
}

.numbers-content {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
}

.metrics-row {
  display: grid;
  grid-template-columns: 1fr;
  border-top: 1px solid var(--mm-ink);
  border-bottom: 1px solid var(--mm-rule);
  width: 100%;
}

@media (min-width: 640px) {
  .metrics-row {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

.metric-column {
  padding: 16px 16px 16px 0;
  border-bottom: 1px solid var(--mm-rule);
}

@media (min-width: 640px) {
  .metric-column {
    border-bottom: none;
    border-right: 1px solid var(--mm-rule);
    padding: 16px;
  }
  .metric-column.last {
    border-right: none;
    padding-right: 0;
  }
}

.metric-val {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 50px;
  line-height: 1;
  color: var(--mm-ink);
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  margin-top: 8px;
}

.metrics-footer {
  margin-top: 16px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  line-height: 1.5;
}

.text-ink {
  color: var(--mm-ink);
  font-weight: 600;
}
</style>
