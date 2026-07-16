<template>
  <div class="wrapped-slide credits-slide animate-line-in" @click="$emit('next')">
    <div class="credits-left-container">
      <div class="credits-eyebrow-row animate-rise-up" style="animation-delay: 0.05s">
        <span class="mm-eyebrow">09 — PROFILE WRAPPED</span>
        <span class="new-badge">NEW</span>
      </div>

      <div class="credits-heading animate-rise-up" style="animation-delay: 0.1s">
        Your Squad
      </div>

      <p class="credits-subtext animate-rise-up" style="animation-delay: 0.12s">
        All your player names that contributed to this wrap.
      </p>

      <div class="credits-container">
        <div class="credits-table-header animate-rise-up" style="animation-delay: 0.15s">
          <span>LINKED NAMES</span>
        </div>

        <div class="credits-list">
          <div
            v-for="(alias, index) in data.aliasCredits"
            :key="alias.playerName"
            class="credits-row animate-rise-up"
            :style="{ animationDelay: (Math.min(index * 0.04, 0.6) + 0.2) + 's' }"
          >
            <span class="row-num">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="row-name">{{ $pn(alias.playerName) }}</span>
            <span class="row-stat">
              {{ alias.roundsPlayed.toLocaleString() }} Rounds ·
              <span :class="{ 'kd-accent': index === 0 }">{{ alias.kdRatio.toFixed(2) }} K/D</span>
            </span>
          </div>
        </div>
      </div>

      <div v-if="data.bestAliases" class="best-alias-container animate-rise-up" style="animation-delay: 0.3s">
        <div class="best-alias-heading">Across All Names</div>
        <div class="best-alias-grid">
          <div class="best-alias-stat">
            <div class="best-alias-label">Top Kill Rate</div>
            <div class="best-alias-value">{{ $pn(data.bestAliases.bestKillRateAliasName) }}</div>
            <div class="best-alias-metric">{{ data.bestAliases.bestKillRateValue.toFixed(1) }} Kills/Rd</div>
          </div>
          <div class="best-alias-stat">
            <div class="best-alias-label">Top K/D</div>
            <div class="best-alias-value">{{ $pn(data.bestAliases.bestKdAliasName) }}</div>
            <div class="best-alias-metric kd-accent">{{ data.bestAliases.bestKdValue.toFixed(2) }} K/D</div>
          </div>
          <div class="best-alias-stat">
            <div class="best-alias-label">Best Map K/D</div>
            <div class="best-alias-value">{{ data.bestAliases.bestMapKdMapName }}</div>
            <div class="best-alias-metric">{{ data.bestAliases.bestMapKdValue.toFixed(2) }} K/D</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 08</div>
          <div class="hero-sub">ALL FRONTS<br>DROP: pw_squad.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="pwSquad" alt="All Fronts" class="hero-img">
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
          Fig. 08 — All Fronts
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WrappedViewData } from '@/services/wrappedService'
import pwSquad from '@/assets/wrapped/pw_squad.webp'

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

.credits-eyebrow-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
}

.new-badge {
  background-color: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  font-family: var(--mm-font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: var(--mm-radius-sm, 2px);
}

.credits-heading {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(20px, 3vw, 32px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 14px 0 8px 0;
}

.credits-subtext {
  font-family: var(--mm-font-display);
  font-size: 14px;
  line-height: 1.5;
  color: var(--mm-ink-muted);
  max-width: 46ch;
  margin: 0 0 20px 0;
}

.credits-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.credits-table-header {
  background-color: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  border-radius: 2px;
  padding: 5px 12px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.credits-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.credits-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--mm-rule);
}

.row-num {
  width: 28px;
  flex-shrink: 0;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.row-name {
  flex: 1;
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  font-weight: 700;
  color: var(--mm-ink);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-stat {
  flex-shrink: 0;
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  text-align: right;
  white-space: nowrap;
}

.kd-accent {
  color: var(--mm-accent);
  font-weight: 700;
}

.best-alias-container {
  margin-top: 24px;
  text-align: left;
}

.best-alias-heading {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  border-bottom: 1px solid var(--mm-rule-strong);
  padding-bottom: 6px;
  margin-bottom: 14px;
}

.best-alias-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.best-alias-label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
  margin-bottom: 6px;
}

.best-alias-value {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.best-alias-metric {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  margin-top: 2px;
}
</style>
