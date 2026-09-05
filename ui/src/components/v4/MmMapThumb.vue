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
 * The map's preview image, pulled from the game archives. Renders nothing when the
 * map has no art — a good chunk of live servers run community maps that ship none,
 * so an empty slot is the normal case rather than an error worth surfacing.
 */
const props = withDefaults(
  defineProps<{
    gameId?: string | null
    mapName?: string | null
    kind?: MapImageKind
    /** Rendered width in px. Height follows the 4:3 artwork. */
    width?: number
    /** Rounded corners and a hairline rule. Off for flush/inline placements. */
    framed?: boolean
  }>(),
  { kind: 'thumbnail', width: 64, framed: true },
)

const key = computed(() => mapImageKey(props.gameId, props.mapName))
const failed = ref(false)

// A miss is stable for the session, so re-mounting (list re-sort, the 30s live
// refresh, pagination) should not re-request an image already known to 404.
watch(key, () => { failed.value = false }, { immediate: true })

const src = computed(() => {
  if (failed.value || isKnownMissing(key.value)) return null
  return mapImageUrl(props.gameId, props.mapName, props.kind)
})

const height = computed(() =>
  props.kind === 'minimap' ? props.width : Math.round((props.width * 3) / 4),
)

function onError() {
  rememberMissing(key.value)
  failed.value = true
}
</script>

<template>
  <img
    v-if="src"
    class="mm-map-thumb"
    :class="{ 'mm-map-thumb--framed': framed }"
    :src="src"
    :width="width"
    :height="height"
    :style="{ width: `${width}px`, height: `${height}px` }"
    :alt="`${mapName} map preview`"
    loading="lazy"
    decoding="async"
    @error="onError"
  />
</template>

<style scoped>
.mm-map-thumb {
  display: block;
  flex: none;
  object-fit: cover;
  background: var(--mm-bg-mute);
}

.mm-map-thumb--framed {
  border: 1px solid var(--mm-rule);
  border-radius: 3px;
}
</style>
