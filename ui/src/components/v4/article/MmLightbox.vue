<script setup lang="ts">
/**
 * Full-screen view of one image or clip. A click outside it, the close button
 * or Escape closes it. The page scroll is locked while it is open.
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { ArticleMedia } from './media'

const props = defineProps<{ media: ArticleMedia | null }>()
const emit = defineEmits<{ close: [] }>()

const close = () => emit('close')
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && props.media) close() }

watch(() => props.media, m => { document.body.style.overflow = m ? 'hidden' : '' })
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="media"
      class="mm mm-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="media.alt"
      @click.self="close"
    >
      <button type="button" class="mm-lightbox__close" aria-label="Close" @click="close">
        <i class="pi pi-times" aria-hidden="true" />
      </button>
      <video
        v-if="media.kind === 'video'"
        :src="media.src"
        :poster="media.poster"
        :aria-label="media.alt"
        autoplay
        muted
        loop
        playsinline
        controls
      />
      <img v-else :src="media.src" :alt="media.alt">
    </div>
  </Teleport>
</template>

<style scoped>
.mm-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 48px 16px 16px;
  background: color-mix(in srgb, var(--mm-bg) 94%, transparent);
  cursor: zoom-out;
  animation: mm-lightbox-fade 0.18s ease-out;
}
.mm-lightbox img,
.mm-lightbox video {
  max-width: 100%;
  max-height: calc(100vh - 64px);
  border: 1px solid var(--mm-rule-strong);
  cursor: default;
}
.mm-lightbox__close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--mm-ink);
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  cursor: pointer;
}
.mm-lightbox__close:hover { border-color: var(--mm-ink-muted); }
@keyframes mm-lightbox-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .mm-lightbox { animation: none; }
}
</style>
