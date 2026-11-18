<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatClock, levelName, recordingPageHref } from '@/services/recordingsService'
import { shortHref } from '@/services/shortsService'
import { schoolHref, type ServerMedia, type ServerMediaItem } from '@/services/dogfightsService'
import { mapImageUrl } from '@/utils/mapImage'
import { decodeMojibake } from '@/utils/playerName'

/**
 * A server's Shorts, replays and dogfights as a few small thumbnails beside its name in the
 * landing page's list (features/dogfights-on-stats-pages). The list is for finding a server, so
 * this stays a fanned stack of small frames at the end of the address line, the width of a short word, that spreads apart on
 * hover; each frame opens its clip, round or fight on play.bfstats.io. The server page has the
 * rest, linked from the count.
 */
const props = withDefaults(defineProps<{
  media: ServerMedia
  /** Server page link for the "+N" count. */
  serverHref: string
  /** Most frames shown. */
  max?: number
}>(), { max: 3 })

const shown = computed(() => props.media.items.slice(0, props.max))
const more = computed(() => props.media.shorts + props.media.replays + props.media.dogfights - shown.value.length)

const KIND_LABEL: Record<ServerMediaItem['kind'], string> = { short: 'Short', replay: 'Replay', dogfight: 'Dogfight' }
const KIND_ICON: Record<ServerMediaItem['kind'], string> = { short: 'pi-mobile', replay: 'pi-video', dogfight: 'pi-send' }

function hrefOf(item: ServerMediaItem): string {
  if (item.kind === 'short') return shortHref(item.id)
  if (item.kind === 'dogfight') return schoolHref(item.id)
  return recordingPageHref(item.id)
}

/** Pictures that failed: the frame falls back to the level's art, then to its dark fill. */
const failed = ref(new Set<string>())
function imageOf(item: ServerMediaItem): string | null {
  for (const src of [item.imageUrl, mapImageUrl(item.mod, item.level)]) {
    if (src && !failed.value.has(src)) return src
  }
  return null
}
function onError(src: string | null) {
  if (src) failed.value = new Set([...failed.value, src])
}

function labelOf(item: ServerMediaItem): string {
  return `${KIND_LABEL[item.kind]}: ${decodeMojibake(item.title)} (${levelName(item.level)}, ${formatClock(item.seconds)})`
}

const summary = computed(() => [
  props.media.shorts ? `${props.media.shorts} ${props.media.shorts === 1 ? 'Short' : 'Shorts'}` : '',
  props.media.replays ? `${props.media.replays} ${props.media.replays === 1 ? 'replay' : 'replays'}` : '',
  props.media.dogfights ? `${props.media.dogfights} air ${props.media.dogfights === 1 ? 'fight' : 'fights'}` : '',
].filter(Boolean).join(', '))
</script>

<template>
  <div class="lb-media" data-testid="server-media" :aria-label="`Media from this server: ${summary}`" role="group" @click.stop>
    <a
      v-for="(item, i) in shown"
      :key="`${item.kind}:${item.id}`"
      class="lb-media__frame"
      :class="`lb-media__frame--${item.kind}`"
      :style="{ zIndex: shown.length - i }"
      :href="hrefOf(item)"
      target="_blank"
      rel="noopener"
      :title="labelOf(item)"
      :aria-label="labelOf(item)"
      :data-testid="`server-media-${item.kind}`"
    >
      <img
        v-if="imageOf(item)"
        :src="imageOf(item)!"
        alt=""
        loading="lazy"
        decoding="async"
        @error="onError(imageOf(item))"
      />
      <i class="pi lb-media__kind" :class="KIND_ICON[item.kind]" aria-hidden="true" />
    </a>
    <RouterLink
      v-if="more > 0"
      class="lb-media__more"
      :to="serverHref"
      :title="`${summary}: all of them on the server's page`"
      data-testid="server-media-more"
    >+{{ more }}</RouterLink>
  </div>
</template>

<style scoped>
.lb-media {
  display: inline-flex;
  align-items: center;
  flex: none;
  padding-left: 2px;
}

/* A fanned stack: each frame tucked under the one before, spread on hover or focus. */
.lb-media__frame {
  position: relative;
  display: block;
  width: 32px;
  height: 18px;
  overflow: hidden;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  background: var(--mm-bg-mute);
  box-shadow: 0 0 0 1px var(--mm-bg);
  transition: margin 0.18s ease, border-color 0.15s ease, transform 0.18s ease;
}

.lb-media__frame + .lb-media__frame { margin-left: -16px; }

.lb-media:hover .lb-media__frame + .lb-media__frame,
.lb-media:focus-within .lb-media__frame + .lb-media__frame { margin-left: 3px; }

.lb-media__frame:hover,
.lb-media__frame:focus-visible {
  border-color: var(--mm-accent);
  transform: translateY(-1px);
}

.lb-media__frame img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lb-media__frame--dogfight img { filter: saturate(0.6) brightness(0.7); }

.lb-media__kind {
  position: absolute;
  left: 2px;
  bottom: 2px;
  font-size: 7px;
  line-height: 1;
  padding: 1px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--mm-bg) 80%, transparent);
  color: var(--mm-ink);
}

.lb-media__frame--dogfight .lb-media__kind { color: var(--mm-accent-soft); }

.lb-media__more {
  margin-left: 5px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  text-decoration: none;
}
.lb-media__more:hover { color: var(--mm-ink); }

@media (prefers-reduced-motion: reduce) {
  .lb-media__frame { transition: none; }
}
</style>
