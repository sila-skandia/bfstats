<template>
  <div class="wrapped-slide intro-slide animate-line-in" @click="clickAdvancesSlide() && $emit('next')">
    <div class="intro-content">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.06s">BFSTATS · 2026 WRAPPED</div>
      
      <div class="name-container animate-elegant-reveal" style="animation-delay: 0.16s">
        <h1 class="name-display">
          {{ data.playerName }}<span class="name-dot">.</span>
        </h1>
      </div>

      <div class="spotify-subtitle animate-rise-up" style="animation-delay: 0.26s">
        Player Wrapped <span class="text-italic">2026</span>
      </div>

      <div class="accent-line animate-rise-up" style="animation-delay: 0.32s"></div>
      
      <div class="intro-meta animate-rise-up" style="animation-delay: 0.38s">
        <span>BATTLEFIELD 1942</span>
        <span class="divider">·</span>
        <span>JAN 01 — DEC 31</span>
        <span class="divider">·</span>
        <span class="text-accent" v-if="data.yearInNumbers.serverRank > 0">TOP RANK #{{ data.yearInNumbers.serverRank }}</span>
      </div>

      <div
        class="song-row animate-rise-up"
        style="animation-delay: 0.44s"
        role="button"
        title="Change wrapped song"
        @click.stop="openDialog('change')"
      >
        <span class="song-row-thumb" :class="{ muted: !hasMusic }" :style="{ backgroundImage: `url(${selectedMod.icon})` }"></span>
        <span class="song-row-text">
          <span class="song-row-eyebrow">Wrapped song</span>
          <span class="song-row-label">{{ nowPlayingLabel }}</span>
        </span>
        <span class="song-row-change">Change</span>
      </div>

      <div class="click-prompt animate-rise-up" style="animation-delay: 0.5s" role="button" @click.stop="$emit('next')">
        <span>TAP / CLICK TO BEGIN BRIEFING</span>
        <span class="cursor">_</span>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 01</div>
          <div class="hero-sub">DEPLOYMENT<br>DROP: ch1p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch1p" alt="Deployment" class="hero-img">
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
          Fig. 01 — Deployment
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { clickAdvancesSlide } from './slideTap'
import { computed } from 'vue'
import type { PlayerWrappedData } from '@/services/wrappedService'
import ch1p from '@/assets/wrapped/ch1p.webp'
import { useWrappedMusic } from '@/composables/useWrappedMusic'

defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()

const { selectedTrackId, selectedTrack, selectedMod, enabled, openDialog } = useWrappedMusic()

const hasMusic = computed(() => enabled.value && !!selectedTrackId.value)
const nowPlayingLabel = computed(() =>
  hasMusic.value ? `${selectedTrack.value.mod} · ${selectedTrack.value.label}` : 'No music'
)
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

@media (min-width: 1024px) {
  .wrapped-slide {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    gap: 46px;
    align-items: stretch;
  }
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

/* ---- Now-playing row — opens the song dialog ---- */
.song-row {
  position: relative;
  z-index: 50;
  cursor: pointer;
  margin-top: 24px;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: rgba(13, 13, 13, 0.55);
  padding: 12px 14px;
  transition: border-color 0.12s ease;
}

@media (min-width: 1024px) {
  .song-row {
    margin-top: 30px;
    max-width: 470px;
    gap: 14px;
    padding: 13px 16px;
  }
}

.song-row:hover {
  border-color: var(--mm-ink-muted);
}

.song-row-thumb {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 2px;
  display: block;
  border: 1px solid var(--mm-rule-strong);
  background-size: cover;
  background-position: center;
  transition: filter 0.12s ease;
}

@media (min-width: 1024px) {
  .song-row-thumb {
    width: 36px;
    height: 36px;
  }
}

.song-row-thumb.muted {
  filter: grayscale(1) brightness(0.6);
}

.song-row-text {
  flex: 1 1 auto;
  min-width: 0;
}

.song-row-eyebrow {
  display: block;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.song-row-label {
  display: block;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-row-change {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-accent);
  white-space: nowrap;
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
