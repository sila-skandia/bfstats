<template>
  <div class="wrapped-slide credits-slide animate-line-in" @click="$emit('next')">
    <div class="credits-left-container">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">09 — CREDITS</div>

      <div class="credits-heading animate-rise-up" style="animation-delay: 0.1s">
        Every alias behind this year.
      </div>

      <div v-if="data.bestAliases" class="best-alias-split animate-rise-up" style="animation-delay: 0.15s">
        <div class="relation-card card-kd">
          <div class="card-icon">🎯</div>
          <div class="card-body">
            <div class="card-role">Best K/D</div>
            <div class="card-name">{{ $pn(data.bestAliases.bestKdAliasName) }}</div>
            <div class="card-desc">
              Posted a <span class="highlight">{{ data.bestAliases.bestKdValue.toFixed(2) }} K/D</span> this year — your sharpest alias.
            </div>
          </div>
        </div>

        <div class="relation-card card-rate">
          <div class="card-icon">⚡</div>
          <div class="card-body">
            <div class="card-role">Best Kill Rate</div>
            <div class="card-name">{{ $pn(data.bestAliases.bestKillRateAliasName) }}</div>
            <div class="card-desc">
              Averaged <span class="highlight">{{ data.bestAliases.bestKillRateValue.toFixed(2) }} kills/min</span> — your fastest trigger.
            </div>
          </div>
        </div>
      </div>

      <div class="credits-container">
        <div class="credits-table-header animate-rise-up" style="animation-delay: 0.2s">
          <span>ALIAS</span>
          <span>ROUNDS</span>
          <span>KILLS</span>
          <span>K/D</span>
        </div>

        <div class="credits-list">
          <div
            v-for="(alias, index) in data.aliasCredits"
            :key="alias.playerName"
            class="credits-row animate-rise-up"
            :style="{ animationDelay: (Math.min(index * 0.04, 0.6) + 0.25) + 's' }"
          >
            <span class="row-name">{{ $pn(alias.playerName) }}</span>
            <span class="row-stat">{{ alias.roundsPlayed.toLocaleString() }}</span>
            <span class="row-stat">{{ alias.totalKills.toLocaleString() }}</span>
            <span class="row-stat kd-accent">{{ alias.kdRatio.toFixed(2) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 09</div>
          <div class="hero-sub">CREDITS<br>DROP: ch7p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch7p" alt="Credits" class="hero-img">
        </div>
        <div class="hero-overlay-smoke"></div>
        <div class="hero-overlay-grad"></div>
        <div class="hero-border-inset"></div>
        <div class="hero-corner hero-corner-tl"></div>
        <div class="hero-corner hero-corner-tr"></div>
        <div class="hero-corner hero-corner-bl"></div>
        <div class="hero-corner hero-corner-br"></div>
        <div class="hero-caption">
          <span class="hero-caption-dot"></span>
          Fig. 09 — Credits
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WrappedViewData } from '@/services/wrappedService'
import ch7p from '@/assets/wrapped/ch7p.webp'

defineProps<{
  data: WrappedViewData
}>()

defineEmits<{
  (e: 'next'): void
}>()
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

.credits-left-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
}

.credits-heading {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(20px, 3vw, 32px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 14px 0 20px 0;
}

.best-alias-split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

@media (min-width: 640px) {
  .best-alias-split {
    grid-template-columns: 1fr 1fr;
  }
}

.relation-card {
  display: flex;
  gap: 12px;
  background-color: var(--surface-sunken);
  border: 1px solid var(--border-hairline);
  border-radius: 2px;
  padding: 12px;
  transition: all 0.25s ease;
}

.relation-card:hover {
  border-color: var(--mm-rule-strong);
}

.card-icon {
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.card-role {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.card-name {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 700;
  color: var(--mm-ink);
  margin: 2px 0 4px 0;
}

.card-desc {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  line-height: 1.45;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.card-desc .highlight {
  font-weight: 700;
  color: var(--mm-accent);
}

.card-kd {
  border-left: 3px solid var(--mm-kd-elite);
}

.card-rate {
  border-left: 3px solid var(--mm-success);
}

.credits-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.credits-table-header {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 16px;
  background-color: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  border-radius: 2px;
  padding: 5px 12px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-align: right;
}

.credits-table-header span:first-child {
  text-align: left;
}

.credits-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.credits-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 16px;
  align-items: baseline;
  padding: 9px 12px;
  border-bottom: 1px solid var(--mm-rule);
}

.row-name {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-ink);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-stat {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  text-align: right;
}

.row-stat.kd-accent {
  color: var(--mm-accent);
  font-weight: 700;
}
</style>
