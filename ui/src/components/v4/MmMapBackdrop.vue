<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  isKnownMissing,
  mapImageKey,
  mapImageUrl,
  rememberMissing,
  type MapImageKind,
} from '@/utils/mapImage'

/**
 * A map's art laid dimmed behind a page header: the level's loading screen, under the
 * same 45% opacity and bottom-up scrim as the player map page's hero card. Drop it in as
 * the first child of a `position: relative; overflow: hidden` block; the content after it
 * sits on top. Renders nothing when the map has no art, so the header falls back to its
 * plain ground (features/map-loading-art).
 */
const props = withDefaults(
  defineProps<{
    gameId?: string | null
    mapName?: string | null
    /** Kinds to try in order. The stretched 128px thumbnail is a last resort only. */
    kinds?: MapImageKind[]
  }>(),
  { kinds: () => ['loading'] },
)

const key = computed(() => mapImageKey(props.gameId, props.mapName))
const attempt = ref(0)
watch(key, () => { attempt.value = 0 }, { immediate: true })

// Misses are remembered per kind: a level with no loading screen still has a thumbnail.
const missKey = (kind: MapImageKind) => (key.value ? `${key.value}#${kind}` : null)

const current = computed(() => {
  for (let i = attempt.value; i < props.kinds.length; i++) {
    const kind = props.kinds[i]
    if (isKnownMissing(missKey(kind))) continue
    const url = mapImageUrl(props.gameId, props.mapName, kind)
    if (url) return { index: i, kind, url }
  }
  return null
})

function onError() {
  const c = current.value
  if (!c) return
  rememberMissing(missKey(c.kind))
  attempt.value = c.index + 1
}
</script>

<template>
  <div v-if="current" class="mm-map-backdrop" aria-hidden="true">
    <img
      :key="current.url"
      class="mm-map-backdrop__img"
      :src="current.url"
      alt=""
      decoding="async"
      @error="onError"
    >
    <div class="mm-map-backdrop__scrim" />
  </div>
</template>

<style scoped>
/* The parent lifts its own content above this with position: relative. */
.mm-map-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.mm-map-backdrop__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.45;
  filter: saturate(0.8);
}

.mm-map-backdrop__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--mm-bg, #131313) 0%,
    rgba(19, 19, 19, 0.75) 60%,
    rgba(19, 19, 19, 0.3) 100%
  );
}
</style>
