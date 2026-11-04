<script setup lang="ts">
import { ref, watch } from 'vue'
import { useInViewport } from '@/composables/useInViewport'
import { formatClock, levelName } from '@/services/recordingsService'
import { fetchShorts, shortHref, shortKindLabel, SHORTS_FEED, type ReplayShort } from '@/services/shortsService'
import { formatLocalTooltip, formatRelativeTime } from '@/utils/timeUtils'

/**
 * The newest Replay Shorts (features/replay-shorts) as a row of 9:16 posters, each opening
 * the Short in play.bfstats.io's player. A poster plays its clip, muted, while hovered.
 * Stays out of the page until there is a Short to show, and asks for nothing until near
 * the viewport.
 */
const props = withDefaults(defineProps<{
  count?: number
  days?: number
  /** Space above the strip, px; none while there is nothing to show. */
  spacing?: number
}>(), { count: 6, days: 30, spacing: 0 })

const root = ref<HTMLElement | null>(null)
const visible = useInViewport(root)
const items = ref<ReplayShort[]>([])
const total = ref(0)
let asked = false

watch(visible, async isVisible => {
  if (!isVisible || asked) return
  asked = true
  try {
    const page = await fetchShorts({ days: props.days, pageSize: props.count })
    items.value = page.items
    total.value = page.total
  } catch (e) {
    // An extra on the page: a failure leaves it out.
    console.warn('shorts strip: request failed', e)
  }
}, { immediate: true })

/** Hover previews only where there is a pointer to hover with. */
const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

function preview(e: Event, play: boolean) {
  if (!canHover) return
  const video = (e.currentTarget as HTMLElement).querySelector('video')
  if (!video) return
  if (play) {
    video.currentTime = 0
    void video.play().catch(() => {})
  } else {
    video.pause()
  }
}
</script>

<template>
  <div ref="root" class="mm-shorts-slot">
    <section v-if="items.length" class="mm-shorts" :style="{ marginTop: `${spacing}px` }" aria-labelledby="mm-shorts-title" data-testid="shorts-strip">
      <div class="mm-shorts__head">
        <div id="mm-shorts-title" class="mm-eyebrow">Shorts</div>
        <span class="mm-shorts__count">{{ total }} in the last {{ days }} days</span>
        <a class="mm-shorts__more" :href="SHORTS_FEED" target="_blank" rel="noopener">
          All Shorts <i class="pi pi-external-link" aria-hidden="true" />
        </a>
      </div>

      <ul class="mm-shorts__row">
        <li v-for="s in items" :key="s.slug" class="mm-short" data-testid="short-card">
          <a
            class="mm-short__frame"
            :href="shortHref(s.slug)"
            target="_blank"
            rel="noopener"
            :aria-label="`Watch the Short: ${s.title}`"
            @mouseenter="preview($event, true)"
            @mouseleave="preview($event, false)"
            @focus="preview($event, true)"
            @blur="preview($event, false)"
          >
            <img :src="s.posterUrl" alt="" loading="lazy" decoding="async" />
            <video
              v-if="canHover"
              :src="s.videoUrl"
              muted
              loop
              playsinline
              preload="none"
              aria-hidden="true"
              tabindex="-1"
            />
            <span class="mm-short__kind">{{ shortKindLabel(s.kind) }}</span>
            <span class="mm-short__len">{{ formatClock(s.lengthSeconds) }}</span>
            <span class="mm-short__play" aria-hidden="true"><i class="pi pi-play" /></span>
          </a>
          <div class="mm-short__title" :title="s.title">{{ $pn(s.title) }}</div>
          <div class="mm-short__meta">
            <span>{{ levelName(s.level) }}</span>
            <span class="mm-meta-row__sep">·</span>
            <span :title="formatLocalTooltip(s.createdAt)">{{ formatRelativeTime(s.createdAt) }}</span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.mm-shorts-slot { min-height: 1px; }

.mm-shorts__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
  margin-bottom: 12px;
}

.mm-shorts__count,
.mm-shorts__more {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-shorts__more {
  margin-left: auto;
  color: var(--mm-ink-soft);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mm-shorts__more .pi { font-size: 9px; }

/* A swipeable row on a phone; on a wide screen every poster fits. */
.mm-shorts__row {
  list-style: none;
  margin: 0;
  padding: 0 0 6px;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(132px, 40%);
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
}
@media (min-width: 721px) {
  .mm-shorts__row { grid-auto-columns: calc((100% - 36px) / 4); }
}
/* Wide enough for the whole row: one line, no scrolling. */
@media (min-width: 981px) {
  .mm-shorts__row {
    grid-auto-flow: row;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    overflow: visible;
  }
}

.mm-short {
  min-width: 0;
  scroll-snap-align: start;
}

.mm-short__frame {
  position: relative;
  display: block;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg-mute);
  transition: border-color 0.15s ease, transform 0.2s ease;
}
.mm-short__frame:hover,
.mm-short__frame:focus-visible {
  border-color: var(--mm-accent);
  transform: translateY(-2px);
}

.mm-short__frame img,
.mm-short__frame video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mm-short__frame video {
  opacity: 0;
  transition: opacity 0.2s ease;
}
.mm-short__frame:hover video,
.mm-short__frame:focus-visible video { opacity: 1; }

.mm-short__kind,
.mm-short__len {
  position: absolute;
  z-index: 1;
  font-family: var(--mm-font-mono);
  line-height: 1;
  border-radius: 2px;
}
.mm-short__kind {
  left: 6px;
  top: 6px;
  padding: 3px 5px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
}
.mm-short__len {
  right: 6px;
  bottom: 6px;
  padding: 2px 4px;
  font-size: 9.5px;
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  color: var(--mm-ink);
}

.mm-short__play {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
.mm-short__play .pi {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  padding-left: 3px;
  font-size: 12px;
  background: color-mix(in srgb, var(--mm-bg) 60%, transparent);
  color: var(--mm-ink);
  box-shadow: inset 0 0 0 1px var(--mm-rule-strong);
}
.mm-short__frame:hover .mm-short__play,
.mm-short__frame:focus-visible .mm-short__play { opacity: 0; }

.mm-short__title {
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--mm-ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mm-short__meta {
  margin-top: 3px;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 5px;
  font-size: 11.5px;
  color: var(--mm-ink-muted);
}
</style>
