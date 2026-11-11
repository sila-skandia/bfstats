<script setup lang="ts">
/**
 * A long-form page's lead video, in several qualities. It plays muted and looped
 * behind a "Play with sound" button; that button starts it from the top with sound
 * and the browser's own controls. Under it a Quality switch: Auto picks the
 * smallest rendition that fills the frame (no bigger than 1080p, the smallest on
 * Data Saver); a pick is kept for the next visit. Switching keeps the place and
 * whether it was playing. With reduced motion or Data Saver nothing autoplays.
 */
import { computed, onMounted, ref, watch } from 'vue'

export interface HeroRendition {
  /** "1080p": the switch's label and the stored choice. */
  id: string
  width: number
  height: number
  src: string
  bytes: number
}

const props = defineProps<{
  /** Biggest first. */
  renditions: HeroRendition[]
  poster: string
  /** What the video shows, for screen readers. */
  label: string
  title?: string
  meta?: string
}>()

const STORE_KEY = 'mm-hero-video-quality'
const AUTO_MAX_HEIGHT = 1080

const frame = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const choice = ref<string>('auto')
const autoId = ref<string | null>(null)
const ambient = ref(false)
const started = ref(false)

const activeId = computed(() => (choice.value === 'auto' ? autoId.value : choice.value))
const active = computed(() => props.renditions.find(r => r.id === activeId.value) ?? null)
const ratio = computed(() => {
  const top = props.renditions[0]
  return top ? `${top.width} / ${top.height}` : '16 / 9'
})
const autoLabel = computed(() => (choice.value === 'auto' && autoId.value ? `Auto · ${autoId.value}` : 'Auto'))

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`

/** The smallest rendition at least as wide as the frame's pixels, up to 1080p. */
function pickAuto(): string | null {
  const capped = props.renditions.filter(r => r.height <= AUTO_MAX_HEIGHT)
  const pool = capped.length ? capped : props.renditions
  if (!pool.length) return null
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return pool[pool.length - 1].id
  const px = (frame.value?.clientWidth ?? 1280) * Math.min(window.devicePixelRatio || 1, 2)
  const fits = [...pool].reverse().find(r => r.width >= px * 0.9)
  return (fits ?? pool[0]).id
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORE_KEY)
    if (saved && props.renditions.some(r => r.id === saved)) choice.value = saved
  } catch {
    /* storage blocked: Auto */
  }
  autoId.value = pickAuto()
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ambient.value = !still && !conn?.saveData
  // Vue sets `muted` as a property after the element exists; autoplay needs it first.
  if (video.value) video.value.muted = true
})

function choose(id: string) {
  choice.value = id
  try {
    if (id === 'auto') localStorage.removeItem(STORE_KEY)
    else localStorage.setItem(STORE_KEY, id)
  } catch {
    /* storage blocked: the pick lasts this visit */
  }
}

// Before Vue swaps the src: note the place, then go back to it once the new file
// knows its length.
watch(
  () => active.value?.src,
  (next, prev) => {
    const v = video.value
    if (!v || !prev || !next) return
    const at = v.currentTime
    const playing = !v.paused
    v.addEventListener(
      'loadedmetadata',
      () => {
        v.currentTime = at
        if (playing) v.play().catch(() => {})
      },
      { once: true },
    )
  },
  { flush: 'pre' },
)

function playWithSound() {
  const v = video.value
  if (!v) return
  started.value = true
  v.loop = false
  v.muted = false
  v.currentTime = 0
  v.play().catch(() => {
    // Blocked anyway (an embedded browser): leave it to the controls.
  })
}
</script>

<template>
  <figure class="mm-hero-video" data-testid="hero-video">
    <div ref="frame" class="mm-hero-video__frame" :style="{ aspectRatio: ratio }">
      <video
        ref="video"
        class="mm-hero-video__video"
        :src="active?.src"
        :poster="poster"
        :aria-label="label"
        :autoplay="ambient"
        :loop="!started"
        :controls="started"
        :preload="ambient || started ? 'auto' : 'none'"
        muted
        playsinline
        data-testid="hero-video-player"
      />
      <button
        v-if="!started"
        type="button"
        class="mm-hero-video__play"
        data-testid="hero-video-play"
        @click="playWithSound"
      >
        <span class="mm-hero-video__play-icon" aria-hidden="true"><i class="pi pi-play" /></span>
        <span>Play with sound</span>
      </button>
    </div>

    <figcaption class="mm-hero-video__bar">
      <span v-if="title || meta || $slots.default" class="mm-hero-video__caption">
        <span v-if="title" class="mm-hero-video__title">{{ title }}</span>
        <span v-if="meta || $slots.default" class="mm-hero-video__meta">{{ meta }}<slot /></span>
      </span>
      <span class="mm-hero-video__quality">
        <span id="mm-hero-video-quality" class="mm-hero-video__quality-label">Quality</span>
        <span class="mm-subtabs" role="radiogroup" aria-labelledby="mm-hero-video-quality">
          <button
            type="button"
            role="radio"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': choice === 'auto' }"
            :aria-checked="choice === 'auto'"
            title="The smallest that fills the frame, up to 1080p"
            data-testid="hero-video-quality-auto"
            @click="choose('auto')"
          >{{ autoLabel }}</button>
          <button
            v-for="r in renditions"
            :key="r.id"
            type="button"
            role="radio"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': choice === r.id }"
            :aria-checked="choice === r.id"
            :title="`${r.width}×${r.height} · ${mb(r.bytes)}`"
            :data-testid="`hero-video-quality-${r.id}`"
            @click="choose(r.id)"
          >{{ r.id }}</button>
        </span>
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
.mm-hero-video {
  margin: 28px 0 0;
}

.mm-hero-video__frame {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg);
}

.mm-hero-video__video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--mm-bg);
}

/* The olive anchor treatment of the page's Watch now, over the picture. */
.mm-hero-video__play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 22px 12px 14px;
  border: 0;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  font-family: var(--mm-font-display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 10px 40px color-mix(in srgb, var(--mm-bg) 70%, transparent);
  transition: filter 0.15s ease, transform 0.2s ease;
}
.mm-hero-video__play:hover { filter: brightness(1.12); transform: translate(-50%, -50%) scale(1.03); }
.mm-hero-video__play:focus-visible { outline: 2px solid var(--mm-ink); outline-offset: 3px; }

.mm-hero-video__play-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--mm-highlight-ink);
  color: var(--mm-highlight);
}
.mm-hero-video__play-icon .pi { font-size: 11px; padding-left: 2px; }
.mm-hero-video__play-icon::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px solid var(--mm-highlight-ink);
  opacity: 0;
  animation: mm-hero-video-pulse 2.4s ease-out infinite;
}
@keyframes mm-hero-video-pulse {
  0% { transform: scale(0.85); opacity: 0.55; }
  70%, 100% { transform: scale(1.35); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .mm-hero-video__play-icon::after { animation: none; }
}

.mm-hero-video__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 20px;
  padding: 10px 0 0;
}

.mm-hero-video__caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mm-hero-video__title {
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mm-ink);
}
.mm-hero-video__meta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-hero-video__meta :slotted(a) { color: var(--mm-accent-soft); text-decoration: none; }
.mm-hero-video__meta :slotted(a:hover) { color: var(--mm-ink); }

.mm-hero-video__quality {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.mm-hero-video__quality-label {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

@media (max-width: 640px) {
  .mm-hero-video__play { font-size: 14px; padding: 9px 16px 9px 10px; gap: 9px; }
  .mm-hero-video__play-icon { width: 24px; height: 24px; }
  .mm-hero-video__quality { width: 100%; }
  .mm-hero-video__quality .mm-subtabs { flex: 1; overflow: visible; }
  .mm-hero-video__quality .mm-subtab { flex: 1 1 auto; padding: 6px 4px; letter-spacing: 0.04em; }
}
</style>
