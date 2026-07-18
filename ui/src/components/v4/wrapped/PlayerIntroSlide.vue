<template>
  <div class="wrapped-slide intro-slide animate-line-in" @click="$emit('next')">
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

      <div class="song-panel animate-rise-up" style="animation-delay: 0.44s" @click.stop>
        <div class="song-panel-title">Select your wrapped tune</div>
        <div class="song-mods">
          <button
            v-for="mod in mods"
            :key="mod.name"
            type="button"
            class="song-mod"
            :class="{ active: mod.name === selectedTrack.mod }"
            :title="mod.name"
            @click="selectMod(mod)"
          >
            <span class="song-mod-img" :style="{ backgroundImage: `url(${mod.icon})` }"></span>
          </button>
        </div>
        <div class="song-mod-name">
          {{ selectedMod.name }}
          <span class="song-mod-count">· {{ selectedMod.tracks.length }} {{ selectedMod.tracks.length === 1 ? 'track' : 'tracks' }}</span>
        </div>
        <div class="song-tracks">
          <button
            v-for="track in selectedMod.tracks"
            :key="track.id"
            type="button"
            class="song-track"
            :class="{ active: track.id === selectedTrackId }"
            @click="selectTrack(track.id)"
          >
            <span v-if="track.id === selectedTrackId" class="song-track-dot"></span>
            {{ track.label }}
          </button>
        </div>
        <div class="song-panel-foot">
          Selected — <span class="song-panel-sel">{{ selectedTrack.mod }} · {{ selectedTrack.label }}</span>
        </div>
      </div>

      <div class="click-prompt animate-rise-up" style="animation-delay: 0.5s">
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
import { computed } from 'vue'
import type { PlayerWrappedData } from '@/services/wrappedService'
import ch1p from '@/assets/wrapped/ch1p.webp'
import { useWrappedMusic, MOD_ICONS, WRAPPED_TRACKS, type WrappedTrack } from '@/composables/useWrappedMusic'

defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()

const { selectedTrackId, selectedTrack, selectTrack } = useWrappedMusic()

interface SongMod {
  name: string
  icon: string
  tracks: WrappedTrack[]
}

const mods: SongMod[] = (() => {
  const byMod = new Map<string, WrappedTrack[]>()
  for (const track of WRAPPED_TRACKS) {
    if (!byMod.has(track.mod)) byMod.set(track.mod, [])
    byMod.get(track.mod)!.push(track)
  }
  return [...byMod.entries()].map(([name, tracks]) => ({ name, icon: MOD_ICONS[name], tracks }))
})()

const selectedMod = computed(() => mods.find(m => m.name === selectedTrack.value.mod) ?? mods[0])

function selectMod(mod: SongMod) {
  const theme = mod.tracks.find(t => t.label === 'Theme') ?? mod.tracks[0]
  selectTrack(theme.id)
}
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

/* ---- Wrapped tune chooser (mobile-first per the mobile mock; tighter on desktop) ---- */
.song-panel {
  cursor: default;
  margin-top: 24px;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: rgba(13, 13, 13, 0.55);
  padding: 14px 14px 13px;
}

@media (min-width: 1024px) {
  .song-panel {
    margin-top: 30px;
    max-width: 470px;
    padding: 16px 18px 15px;
  }
}

.song-panel-title {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.song-mods {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}

.song-mod {
  width: 44px;
  height: 44px;
  padding: 3px;
  cursor: pointer;
  border-radius: 2px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

@media (min-width: 1024px) {
  .song-mod {
    width: 38px;
    height: 38px;
  }
}

.song-mod:hover {
  border-color: var(--mm-ink-muted);
}

.song-mod.active {
  background: var(--mm-bg-soft);
  border-color: var(--mm-accent);
  box-shadow: 0 0 0 1px rgba(125, 136, 73, 0.35);
}

.song-mod-img {
  width: 100%;
  height: 100%;
  border-radius: 1px;
  display: block;
  background-size: cover;
  background-position: center;
  filter: grayscale(0.75) brightness(0.75);
  opacity: 0.75;
  transition: filter 0.12s ease, opacity 0.12s ease;
}

.song-mod.active .song-mod-img {
  filter: none;
  opacity: 1;
}

.song-mod-name {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  margin-top: 14px;
}

.song-mod-count {
  color: var(--mm-ink-faint);
}

.song-tracks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.song-track {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 9px 12px;
  border-radius: 2px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-muted);
  transition: border-color 0.12s ease, color 0.12s ease;
}

@media (min-width: 1024px) {
  .song-track {
    padding: 5px 10px;
  }
}

.song-track:hover {
  border-color: var(--mm-ink-muted);
  color: var(--mm-ink);
}

.song-track.active {
  background: rgba(125, 136, 73, 0.1);
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.song-track-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--mm-accent);
  animation: mm-pulse 1.6s ease-in-out infinite;
}

.song-panel-foot {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
  margin-top: 12px;
  border-top: 1px solid var(--mm-rule);
  padding-top: 10px;
}

.song-panel-sel {
  color: var(--mm-accent);
}

.song-panel-foot {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
  margin-top: 13px;
  border-top: 1px solid var(--mm-rule);
  padding-top: 11px;
}

.song-panel-sel {
  color: var(--mm-accent);
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
