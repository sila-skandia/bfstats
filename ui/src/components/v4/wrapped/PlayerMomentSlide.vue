<template>
  <div class="wrapped-slide moment-slide animate-line-in" @click="$emit('next')">
    <div class="moment-left-container">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">05 — BEST MOMENTS</div>
      <div class="moment-heading animate-rise-up" style="animation-delay: 0.1s">
        Your finest round performances.
      </div>

      <div class="moments-list">
        <div v-for="(moment, index) in data.bestMoments" :key="index"
             class="moment-item animate-rise-up"
             :style="{ 'animation-delay': (0.15 + index * 0.1) + 's' }">
          
          <!-- Rank Badge -->
          <div class="moment-rank" :class="getMomentProps(moment).colorClass">
            {{ index + 1 }}
          </div>

          <!-- Stat -->
          <div class="moment-stat-small" :class="getMomentProps(moment).colorClass">
            <num-count :data-to="moment.value" data-dur="1000" :data-delay="200 + index * 100"></num-count>
            <span class="stat-label">{{ getMomentProps(moment).label }}</span>
          </div>

          <!-- Details -->
          <div class="moment-details-small">
            <div class="details-title-small">
              {{ getMomentProps(moment).title }}
            </div>
            <div class="details-desc-small">
              {{ moment.mapName }} · <span class="details-date">{{ formatDate(moment.date) }}</span>
            </div>
            <div class="details-meta">
              {{ getMomentProps(moment).desc }} · {{ moment.estimatedDurationMinutes }} mins
            </div>
          </div>
        </div>
        
        <div v-if="!data.bestMoments || data.bestMoments.length === 0" class="no-moments animate-rise-up" style="animation-delay: 0.15s">
          No records found this year.
        </div>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 06</div>
          <div class="hero-sub">{{ topMomentMapName.toUpperCase() }}<br>DROP: ch6p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch6p" :alt="topMomentMapName" class="hero-img">
        </div>
        <div class="hero-overlay-smoke" style="background: radial-gradient(ellipse at 28% 22%, rgba(214,90,90,0.10), transparent 55%), radial-gradient(ellipse at 75% 82%, rgba(0,0,0,0.55), transparent 62%);"></div>
        <div class="hero-overlay-grad"></div>
        <div class="hero-border-inset"></div>
        <div class="hero-corner hero-corner-tl"></div>
        <div class="hero-corner hero-corner-tr"></div>
        <div class="hero-corner hero-corner-bl"></div>
        <div class="hero-corner hero-corner-br"></div>
        <div class="hero-caption">
          <span class="hero-caption-dot rank-1"></span>
          Fig. 06 — {{ topMomentMapName }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerWrappedData, PlayerBestMoment } from '@/services/wrappedService'
import ch6p from '@/assets/wrapped/ch6p.webp'

const props = defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()

const topMomentMapName = computed(() => {
  return props.data.bestMoments && props.data.bestMoments.length > 0
    ? props.data.bestMoments[0].mapName
    : 'No Moments'
})

function getMomentProps(moment: PlayerBestMoment) {
  if (moment.type === 'streak') {
    return {
      title: 'Best Kill Streak',
      label: 'kills',
      desc: `Ranked #${moment.serverStreakRank.toLocaleString()} among all server streaks`,
      colorClass: 'rank-1'
    }
  } else if (moment.type === 'score') {
    return {
      title: 'Highest Score',
      label: 'score',
      desc: 'Most points accumulated in a single round',
      colorClass: 'rank-2'
    }
  } else {
    return {
      title: 'Round with Most Kills',
      label: 'kills',
      desc: 'Most kills recorded in a single round',
      colorClass: 'rank-3'
    }
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return 'Unknown Date'
  try {
    const d = new Date(dateStr)
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
    const day = d.getDate()
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    return `${month} ${day}, ${time}`
  } catch (e) {
    return 'Unknown Date'
  }
}
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  cursor: pointer;
  padding: 0;
}

@media (min-width: 1024px) {
  .wrapped-slide {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    gap: 46px;
    align-items: stretch;
    padding: 40px;
  }
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
}

.moment-heading {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(20px, 3vw, 32px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 14px 0 20px 0;
}

.moments-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: auto 0;
  padding: 10px 0;
}

.moment-item {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--mm-rule);
  border-radius: 4px;
  transition: all 0.2s ease;
}

.moment-item:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--mm-rule-strong);
}

.moment-rank {
  font-family: var(--mm-font-mono);
  font-size: 15px;
  font-weight: 700;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px solid currentColor;
}

.moment-stat-small {
  font-family: var(--mm-font-display);
  font-size: 34px;
  font-weight: 300;
  line-height: 1;
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 85px;
}

.stat-label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.rank-1 {
  color: var(--mm-streak);
}

.rank-2 {
  color: var(--mm-kd-elite);
}

.rank-3 {
  color: var(--mm-bronze);
}

.moment-details-small {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.details-title-small {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--mm-ink);
}

.details-desc-small {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
  text-transform: capitalize;
}

.details-date {
  color: var(--mm-ink-muted);
  font-size: 12.5px;
}

.details-meta {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.no-moments {
  font-family: var(--mm-font-display);
  font-size: 16px;
  color: var(--mm-ink-muted);
  padding: 24px;
  text-align: center;
  border: 1px dashed var(--mm-rule);
  border-radius: 4px;
}
</style>
