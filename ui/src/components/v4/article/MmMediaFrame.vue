<script setup lang="ts">
/**
 * One image or clip in a bordered frame that opens full screen on click.
 * Clips loop silently unless the viewer has asked for less motion.
 * Pair with <MmLightbox> on the page.
 */
import { onMounted, ref } from 'vue'
import type { ArticleMedia } from './media'

withDefaults(defineProps<{
  media: ArticleMedia
  /** What the full-screen button says to screen readers, after "Full screen: ". */
  label: string
  /** 'video' is 16:9, 'wide' is the 2.39:1 cinematic letterbox, 'natural' keeps the file's own shape. */
  aspect?: 'video' | 'wide' | 'natural'
  lazy?: boolean
}>(), { aspect: 'video', lazy: true })

const emit = defineEmits<{ open: [media: ArticleMedia] }>()

const reduceMotion = ref(false)
onMounted(() => {
  reduceMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
})
</script>

<template>
  <button
    type="button"
    class="mm-media-frame"
    :class="`mm-media-frame--${aspect}`"
    :aria-label="`Full screen: ${label}`"
    @click="emit('open', media)"
  >
    <video
      v-if="media.kind === 'video'"
      :src="media.src"
      :poster="media.poster"
      :aria-label="media.alt"
      :autoplay="!reduceMotion"
      muted
      loop
      playsinline
      preload="metadata"
    />
    <img
      v-else
      :src="media.src"
      :alt="media.alt"
      :width="media.width"
      :height="media.height"
      :loading="lazy ? 'lazy' : undefined"
    >
    <span class="mm-media-frame__expand" aria-hidden="true"><i class="pi pi-window-maximize" /></span>
  </button>
</template>

<style scoped>
.mm-media-frame {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  cursor: zoom-in;
}
.mm-media-frame--video { aspect-ratio: 16 / 9; }
.mm-media-frame--wide { aspect-ratio: 1200 / 502; }
.mm-media-frame:hover { border-color: var(--mm-rule-strong); }
.mm-media-frame:focus-visible { outline: 2px solid var(--mm-accent); outline-offset: 2px; }
.mm-media-frame img,
.mm-media-frame video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s ease;
}
.mm-media-frame--natural img,
.mm-media-frame--natural video { height: auto; }
.mm-media-frame:hover img,
.mm-media-frame:hover video { transform: scale(1.02); }

.mm-media-frame__expand {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--mm-ink);
  background: color-mix(in srgb, var(--mm-bg) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--mm-ink) 25%, transparent);
  opacity: 0;
  transition: opacity 0.2s ease;
}
.mm-media-frame:hover .mm-media-frame__expand,
.mm-media-frame:focus-visible .mm-media-frame__expand { opacity: 1; }
@media (hover: none) {
  .mm-media-frame__expand { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .mm-media-frame img, .mm-media-frame video { transition: none; }
}
</style>
