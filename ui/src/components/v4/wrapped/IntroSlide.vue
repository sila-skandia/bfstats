<template>
  <div class="wrapped-slide intro-slide animate-line-in" @click="$emit('next')">
    <div class="intro-content">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.06s">BFSTATS · 2026 WRAPPED</div>
      
      <div class="name-container animate-elegant-reveal" style="animation-delay: 0.16s">
        <h1 class="name-display">
          {{ data.serverName }}<span class="name-dot">.</span>
        </h1>
      </div>

      <div class="spotify-subtitle animate-rise-up" style="animation-delay: 0.26s">
        Server Wrapped <span class="text-italic">2026</span>
      </div>

      <div class="accent-line animate-rise-up" style="animation-delay: 0.32s"></div>
      
      <div class="intro-meta animate-rise-up" style="animation-delay: 0.38s">
        <span>BATTLEFIELD 1942</span>
        <span class="divider">·</span>
        <span>JAN 01 — DEC 31</span>
        <span class="divider">·</span>
        <span class="text-accent">9 CHAPTERS</span>
      </div>

      <div class="click-prompt animate-rise-up" style="animation-delay: 0.5s">
        <span>TAP / CLICK TO BEGIN BRIEFING</span>
        <span class="cursor">_</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ServerWrappedData } from '@/services/wrappedService'

defineProps<{
  data: ServerWrappedData
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
  width: 100%;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.name-container {
  margin: 18px 0 22px 0;
  width: 100%;
}

.name-display {
  font-family: var(--mm-font-display);
  font-size: clamp(38px, 8.5vw, 76px);
  font-weight: 800;
  line-height: 0.92;
  letter-spacing: -0.04em;
  color: var(--mm-ink);
  text-transform: uppercase;
  margin: 0;
  word-break: break-word;
}

.name-dot {
  color: var(--theme-color, var(--mm-accent));
}

.animate-elegant-reveal {
  animation: elegantReveal 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.spotify-subtitle {
  font-family: var(--mm-font-display);
  font-size: clamp(18px, 3.5vw, 24px);
  font-weight: 300;
  color: var(--mm-ink-soft);
  margin-bottom: 12px;
}

.text-italic {
  color: var(--mm-ink-muted);
  font-style: italic;
}

.accent-line {
  width: 56px;
  height: 2px;
  background-color: var(--theme-color, var(--mm-accent));
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
  color: var(--theme-color, var(--mm-accent-soft));
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

@keyframes elegantReveal {
  from {
    opacity: 0;
    transform: translateY(28px);
    letter-spacing: -0.06em;
  }
  to {
    opacity: 1;
    transform: translateY(0);
    letter-spacing: -0.04em;
  }
}
</style>
