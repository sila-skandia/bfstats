<template>
  <div class="wrapped-slide intro-slide" @click="$emit('next')">
    <div class="intro-content">
      <div class="mm-eyebrow">BFSTATS · PLAYER AFTER-ACTION REPORT</div>
      <h1 class="intro-title">
        Player Wrapped <span class="text-italic">2026</span>
      </h1>
      <div class="accent-line"></div>
      
      <div class="intro-meta">
        <span class="text-accent">{{ data.playerName }}</span>
        <span class="divider">·</span>
        <span>BATTLEFIELD 1942</span>
        <span class="divider">·</span>
        <span>JAN 01 — DEC 31</span>
        <span class="divider">·</span>
        <span v-if="data.yearInNumbers.serverRank > 0" class="text-accent">TOP RANK #{{ data.yearInNumbers.serverRank }}</span>
      </div>

      <div class="click-prompt">
        <span>TAP / CLICK TO BEGIN BRIEFING</span>
        <span class="cursor">_</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlayerWrappedData } from '@/services/wrappedService'

defineProps<{
  data: PlayerWrappedData
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
  justify-content: center;
  align-items: flex-start;
  box-sizing: border-box;
  cursor: pointer;
}

.intro-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  max-width: 800px;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.intro-title {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(36px, 6.5vw, 66px);
  line-height: 1.02;
  letter-spacing: -0.03em;
  color: var(--mm-ink);
  margin: 14px 0 18px 0;
}

.text-italic {
  color: var(--mm-ink-muted);
  font-style: italic;
}

.accent-line {
  width: 56px;
  height: 2px;
  background-color: var(--mm-accent);
  margin-bottom: 18px;
}

.intro-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  line-height: 1.5;
}

.divider {
  color: var(--mm-ink-faint);
}

.text-accent {
  color: var(--mm-accent-soft);
  font-weight: 600;
}

.click-prompt {
  margin-top: 32px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--mm-ink-faint);
  display: flex;
  align-items: center;
  gap: 4px;
}

.cursor {
  animation: blink 1s infinite alternate;
}

@keyframes blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
</style>
