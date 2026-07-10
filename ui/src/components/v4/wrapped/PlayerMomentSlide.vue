<template>
  <div class="wrapped-slide moment-slide animate-line-in" @click="$emit('next')">
    <div class="moment-left-container">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">05 — BEST MOMENT</div>
      <div class="moment-heading animate-rise-up" style="animation-delay: 0.1s">
        {{ data.bestMoment.streak }}-kill streak on {{ data.bestMoment.mapName }}.
      </div>

      <div class="moment-content">
        <div class="moment-stat animate-rise-up" style="animation-delay: 0.15s">
          <num-count :data-to="data.bestMoment.streak" data-dur="1200" data-delay="200"></num-count>
        </div>
        <div class="moment-details animate-rise-up" style="animation-delay: 0.25s">
          <div class="mm-eyebrow-small">KILL STREAK · PERSONAL BEST</div>
          <div class="details-title">{{ data.bestMoment.mapName }} · {{ formattedDate }}</div>
          <div class="details-desc">
            {{ data.bestMoment.streak }} kills without a death, over {{ data.bestMoment.estimatedDurationMinutes }} minutes.
          </div>
        </div>
      </div>

      <div class="moment-footer animate-rise-up" style="animation-delay: 0.45s">
        RANKS <span class="text-strong">#{{ data.bestMoment.serverStreakRank }}</span> AMONG ALL STREAKS RECORDED ON THIS SERVER IN {{ data.year }}
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 06</div>
          <div class="hero-sub">MARKET GARDEN<br>DROP: ch6p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch6p" alt="Market Garden" class="hero-img">
        </div>
        <div class="hero-overlay-smoke" style="background: radial-gradient(ellipse at 28% 22%, rgba(214,90,90,0.10), transparent 55%), radial-gradient(ellipse at 75% 82%, rgba(0,0,0,0.55), transparent 62%);"></div>
        <div class="hero-overlay-grad"></div>
        <div class="hero-border-inset"></div>
        <div class="hero-corner hero-corner-tl"></div>
        <div class="hero-corner hero-corner-tr"></div>
        <div class="hero-corner hero-corner-bl"></div>
        <div class="hero-corner hero-corner-br"></div>
        <div class="hero-caption">
          <span class="hero-caption-dot"></span>
          Fig. 06 — Market Garden
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerWrappedData } from '@/services/wrappedService'
import ch6p from '@/assets/wrapped/ch6p.webp'

const props = defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()

const formattedDate = computed(() => {
  if (!props.data.bestMoment.date) return 'Unknown Date'
  try {
    const d = new Date(props.data.bestMoment.date)
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
    const day = d.getDate()
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    return `${month} ${day}, ${time}`
  } catch (e) {
    return 'Unknown Date'
  }
})
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  cursor: pointer;
  padding: 40px;
}

@media (min-width: 1024px) {
  .wrapped-slide {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    gap: 46px;
    align-items: stretch;
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

.moment-content {
  display: flex;
  align-items: center;
  gap: 24px;
  margin: auto 0;
}

.moment-stat {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(64px, 12vw, 108px);
  line-height: 0.85;
  color: var(--mm-streak);
  letter-spacing: -0.05em;
}

.moment-details {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.mm-eyebrow-small {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.details-title {
  font-family: var(--mm-font-display);
  font-size: 15px;
  color: var(--mm-ink);
  margin-top: 6px;
}

.details-desc {
  font-family: var(--mm-font-display);
  font-size: 13px;
  color: var(--mm-ink-muted);
  margin-top: 5px;
  line-height: 1.4;
}

.moment-footer {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  margin-top: 20px;
  line-height: 1.5;
}

.text-strong {
  color: var(--mm-ink);
}
</style>
