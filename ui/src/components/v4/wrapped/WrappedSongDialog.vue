<template>
  <div class="song-dialog-backdrop" @click="onBackdrop">
    <div
      class="song-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your wrapped song"
      @click.stop
    >
      <div class="sheet-handle" aria-hidden="true"></div>

      <template v-if="mode === 'intro'">
        <div class="dialog-eyebrow">Before you deploy</div>
        <div class="dialog-title">Choose your wrapped song</div>
        <div class="dialog-note">Mod themes from the '42 era — change it anytime from the player bar.</div>
      </template>
      <template v-else>
        <div class="change-header">
          <span class="change-header-label">Wrapped song</span>
          <span class="change-header-hint">Mod themes</span>
        </div>
      </template>

      <div class="song-mods">
        <button
          v-for="mod in mods"
          :key="mod.name"
          type="button"
          class="song-mod"
          :class="{ active: mod.name === selectedMod.name }"
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

      <div v-if="mode === 'intro'" class="dialog-footer dialog-footer--intro">
        <div v-if="!selectedTrackId" class="select-prompt-msg" aria-live="polite">
          <span>Choose a song to play music</span>
        </div>
        <button
          type="button"
          class="begin-btn"
          :disabled="!selectedTrackId"
          :class="{ disabled: !selectedTrackId }"
          @click="$emit('begin', true)"
        >
          Begin the briefing →
        </button>
        <button type="button" class="no-music-btn" @click="$emit('begin', false)">Proceed without music</button>
      </div>
      <div v-else class="dialog-footer dialog-footer--change">
        <button
          type="button"
          class="mute-chip"
          :class="{ muted: !enabled }"
          @click="setEnabled(!enabled)"
        >
          {{ enabled ? 'Music On' : 'Music Off' }}
        </button>
        <button type="button" class="done-btn" @click="$emit('close')">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWrappedMusic } from '@/composables/useWrappedMusic'

const props = defineProps<{
  mode: 'intro' | 'change'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'begin', withMusic: boolean): void
}>()

const { mods, selectedMod, selectedTrackId, enabled, selectTrack, selectMod, setEnabled } = useWrappedMusic()

function onBackdrop() {
  if (props.mode === 'change') emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.mode === 'change') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.song-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(5, 5, 5, 0.74);
  animation: songFade 0.25s ease both;
}

/* Bottom sheet on mobile, centered modal on desktop */
.song-dialog {
  width: 100%;
  max-width: 440px;
  box-sizing: border-box;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-bottom: none;
  padding: 14px 18px calc(20px + env(safe-area-inset-bottom));
  box-shadow: 0 -28px 60px rgba(0, 0, 0, 0.75);
  animation: songUp 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.sheet-handle {
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: var(--mm-rule-strong);
  margin: 0 auto 16px;
}

@media (min-width: 1024px) {
  .song-dialog-backdrop {
    align-items: center;
    padding: 24px;
  }

  .song-dialog {
    max-width: 500px;
    border-bottom: 1px solid var(--mm-rule-strong);
    border-radius: 2px;
    padding: 24px 26px 22px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.8);
    animation: songPop 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .sheet-handle {
    display: none;
  }
}

.dialog-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--mm-accent);
}

.dialog-title {
  font-family: var(--mm-font-display);
  font-size: 24px;
  font-weight: 300;
  letter-spacing: -0.01em;
  color: var(--mm-ink);
  margin-top: 7px;
}

@media (min-width: 1024px) {
  .dialog-title {
    font-size: 26px;
    margin-top: 8px;
  }
}

.dialog-note {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  margin-top: 8px;
  line-height: 1.8;
}

.change-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.change-header-label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.change-header-hint {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}

.song-mods {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 16px;
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
  .song-mods {
    margin-top: 18px;
  }

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
  margin-top: 13px;
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

.dialog-footer {
  margin-top: 18px;
}

.dialog-footer--intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-footer--change {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

@media (min-width: 1024px) {
  .dialog-footer {
    margin-top: 22px;
    border-top: 1px solid var(--mm-rule);
    padding-top: 18px;
  }

  .dialog-footer--intro {
    flex-direction: row;
    align-items: center;
    gap: 14px;
  }
}

.begin-btn {
  font-family: var(--mm-font-display);
  font-size: 13px;
  font-weight: 500;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  border: 0;
  border-radius: 2px;
  padding: 11px 18px;
  cursor: pointer;
  transition: filter 0.12s ease;
}

.begin-btn:hover {
  filter: brightness(1.12);
}

.begin-btn.disabled {
  background: var(--mm-rule-strong);
  color: var(--mm-ink-faint);
  cursor: not-allowed;
  filter: none;
}

.begin-btn.disabled:hover {
  filter: none;
}

.select-prompt-msg {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-accent);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  animation: pulseOpacity 2s infinite ease-in-out;
}

@keyframes pulseOpacity {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

.no-music-btn {
  background: transparent;
  border: 0;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
  cursor: pointer;
  padding: 12px;
  transition: color 0.12s ease;
}

@media (min-width: 1024px) {
  .no-music-btn {
    padding: 10px 4px;
  }
}

.no-music-btn:hover {
  color: var(--mm-ink);
}

.mute-chip {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 9px 14px;
  border-radius: 2px;
  cursor: pointer;
  background: rgba(125, 136, 73, 0.1);
  border: 1px solid var(--mm-accent);
  color: var(--mm-accent);
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.mute-chip.muted {
  background: transparent;
  border-color: var(--mm-rule);
  color: var(--mm-ink-muted);
}

.done-btn {
  flex: 1;
  font-family: var(--mm-font-display);
  font-size: 13px;
  font-weight: 500;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  border: 0;
  border-radius: 2px;
  padding: 11px 18px;
  cursor: pointer;
  transition: filter 0.12s ease;
}

@media (min-width: 1024px) {
  .done-btn {
    flex: 0 0 auto;
  }
}

.done-btn:hover {
  filter: brightness(1.12);
}

@keyframes songFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes songUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: none; }
}

@keyframes songPop {
  0% { opacity: 0; transform: translateY(22px) scale(0.94); }
  55% { opacity: 1; transform: translateY(-3px) scale(1.02); }
  100% { opacity: 1; transform: none; }
}
</style>
