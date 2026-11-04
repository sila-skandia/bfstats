<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useInViewport } from '@/composables/useInViewport'
import { formatLocalTooltip, formatRelativeTime } from '@/utils/timeUtils'
import { decodeMojibake, decodePlayerName } from '@/utils/playerName'
import { formatClock, levelName } from '@/services/recordingsService'
import {
  ALL_DAYS,
  fetchShorts,
  shortHref,
  shortKindLabel,
  shortsByHref,
  type ReplayShort,
  type ShortsQuery,
} from '@/services/shortsService'

/**
 * Replay Shorts (features/replay-shorts, "On the stats pages") on a server's or a player's
 * page: the 9:16 kill clips cut from that server's recordings, or the ones the player is in
 * (as the killer, a victim or the creator). Like the replays panel it stays out of the page
 * until there is a Short to show, and asks for nothing until it is near the viewport.
 */
const props = withDefaults(defineProps<{
  server?: string
  player?: string
  /** Space above and below the panel, px; none while there is nothing to show. */
  spacing?: number
  spacingAfter?: number
}>(), { spacing: 20, spacingAfter: 0 })

const PAGE_SIZE = 8

const root = ref<HTMLElement | null>(null)
const visible = useInViewport(root)

const items = ref<ReplayShort[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref(false)
let generation = 0
let abort: AbortController | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const query = computed<ShortsQuery>(() => (props.server ? { server: props.server } : { player: props.player }))
const feed = computed(() => (props.player ? shortsByHref(props.player) : null))

async function load(to: number) {
  if (!props.server && !props.player) return
  abort?.abort()
  abort = new AbortController()
  const run = ++generation
  loading.value = true
  error.value = false
  try {
    const result = await fetchShorts({ ...query.value, days: ALL_DAYS, page: to, pageSize: PAGE_SIZE }, abort.signal)
    if (run !== generation) return
    items.value = result.items
    total.value = result.total
    page.value = result.page
  } catch (e) {
    if (run !== generation || (e instanceof DOMException && e.name === 'AbortError')) return
    // A page's extra section: a failure leaves it out rather than breaking the page.
    console.warn('shorts panel: request failed', e)
    error.value = true
  } finally {
    if (run === generation) loading.value = false
  }
}

watch([visible, () => props.server, () => props.player], ([isVisible], old) => {
  const moved = old && (old[1] !== props.server || old[2] !== props.player)
  if (moved) {
    items.value = []
    total.value = 0
  }
  if (isVisible && (moved || (!items.value.length && !error.value))) void load(1)
}, { immediate: true })

function goPage(to: number) {
  if (to < 1 || to > totalPages.value || to === page.value || loading.value) return
  void load(to)
}

/** Posters that failed to load: the card keeps its dark frame. */
const failed = ref(new Set<string>())
function onPosterError(src: string) {
  failed.value = new Set([...failed.value, src])
}

/** Hover previews (as MmShortsStrip): only where there is a pointer to hover with. */
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

/** On a player's page, what the Short is to him. */
function roleOf(s: ReplayShort): string | null {
  if (!props.player) return null
  // A Short keeps the recording's bytes; the page has the site's form of the name.
  const me = decodePlayerName(props.player)
  if (decodePlayerName(s.killer) === me) return null
  if (s.creatorName && decodePlayerName(s.creatorName) === me) return 'Clipped by them'
  return 'Killed in it'
}
</script>

<template>
  <div ref="root" class="mm-shorts-slot">
    <section
      v-if="total > 0"
      class="mm-panel mm-shorts"
      :style="{ marginTop: `${spacing}px`, marginBottom: `${spacingAfter}px` }"
      data-testid="shorts-panel"
    >
      <div class="mm-pbar">
        <span class="mm-pbar__t"># Shorts</span>
        <span class="mm-pbar__m">{{ total.toLocaleString() }} {{ total === 1 ? 'clip' : 'clips' }}{{ server ? ' filmed here' : '' }}</span>
      </div>

      <div class="mm-panel__body">
        <div class="mm-shorts__head">
          <p class="mm-shorts__range">
            {{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, total) }} of {{ total.toLocaleString() }}
          </p>
          <div v-if="totalPages > 1" class="mm-shorts__arrows">
            <button
              type="button"
              class="mm-btn mm-btn--inline"
              :disabled="page <= 1 || loading"
              aria-label="Previous Shorts"
              data-testid="shorts-prev"
              @click="goPage(page - 1)"
            >‹</button>
            <button
              type="button"
              class="mm-btn mm-btn--inline"
              :disabled="page >= totalPages || loading"
              aria-label="More Shorts"
              data-testid="shorts-next"
              @click="goPage(page + 1)"
            >›</button>
          </div>
          <a
            v-if="feed"
            class="mm-shorts__feed"
            :href="feed"
            target="_blank"
            rel="noopener"
          >In the Shorts feed <i class="pi pi-external-link" aria-hidden="true" /></a>
        </div>

        <div v-if="error" class="mm-shorts__error">
          Shorts didn't load.
          <button type="button" class="mm-btn mm-btn--strong" @click="load(page)">Retry</button>
        </div>

        <ul class="mm-shorts__row" :class="{ 'mm-shorts__row--loading': loading }">
          <li v-for="s in items" :key="s.slug" class="mm-short" data-testid="short-card">
            <a
              class="mm-short__poster"
              :href="shortHref(s.slug)"
              target="_blank"
              rel="noopener"
              :aria-label="`Watch ${decodeMojibake(s.title)}`"
              @mouseenter="preview($event, true)"
              @mouseleave="preview($event, false)"
              @focus="preview($event, true)"
              @blur="preview($event, false)"
            >
              <img
                v-if="!failed.has(s.posterUrl)"
                :src="s.posterUrl"
                alt=""
                loading="lazy"
                decoding="async"
                @error="onPosterError(s.posterUrl)"
              />
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
            <a
              class="mm-short__title"
              :href="shortHref(s.slug)"
              target="_blank"
              rel="noopener"
              :title="decodeMojibake(s.title)"
            >{{ decodeMojibake(s.title) }}</a>
            <div class="mm-short__meta">
              <span>{{ levelName(s.level) }}</span>
              <span class="mm-meta-row__sep">·</span>
              <span :title="formatLocalTooltip(s.createdAt)">{{ formatRelativeTime(s.createdAt) }}</span>
              <span class="mm-meta-row__sep">·</span>
              <span>{{ s.views.toLocaleString() }} {{ s.views === 1 ? 'view' : 'views' }}</span>
            </div>
            <span v-if="roleOf(s)" class="mm-short__role">{{ roleOf(s) }}</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mm-shorts-slot {
  /* Most servers and players have no Shorts: the slot holds no space, and the
     observer still sees it. */
  min-height: 1px;
}

.mm-shorts__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  margin-bottom: 14px;
}

.mm-shorts__range,
.mm-shorts__error,
.mm-shorts__feed {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-shorts__range { margin: 0; }

.mm-shorts__arrows {
  display: flex;
  gap: 6px;
}

.mm-shorts__feed {
  margin-left: auto;
  color: var(--mm-ink-soft);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mm-shorts__feed:hover { color: var(--mm-ink); }
.mm-shorts__feed .pi { font-size: 9px; }

.mm-shorts__error {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

/* A row of 9:16 posters. Wide screens show the page's eight; narrow ones scroll
   the row sideways, the way the feed's own strip does. */
.mm-shorts__row {
  list-style: none;
  margin: 0;
  padding: 0 0 4px;
  display: grid;
  grid-auto-flow: column;
  /* A fixed card width: two Shorts stay two posters, not two banners. */
  grid-auto-columns: 148px;
  justify-content: start;
  gap: 14px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  transition: opacity 0.15s ease;
}

.mm-shorts__row--loading { opacity: 0.5; }

.mm-short {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  scroll-snap-align: start;
}

.mm-short__poster {
  position: relative;
  display: block;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  border-radius: 3px;
  background: var(--mm-bg-mute);
}

.mm-short__poster img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.25s ease;
}

.mm-short__poster video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.mm-short__poster:hover video,
.mm-short__poster:focus-visible video { opacity: 1; }

.mm-short__poster:hover { border-color: var(--mm-accent); }
.mm-short__poster:hover img { transform: scale(1.04); }

.mm-short__kind,
.mm-short__len {
  position: absolute;
  z-index: 1;
  padding: 2px 5px;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  color: var(--mm-ink);
}

.mm-short__kind { left: 4px; top: 4px; }
.mm-short__len { right: 4px; bottom: 4px; letter-spacing: 0.04em; }

.mm-short__play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 0.15s ease;
  background: color-mix(in srgb, var(--mm-bg) 30%, transparent);
  color: var(--mm-ink);
  font-size: 22px;
}

.mm-short__poster:focus-visible .mm-short__play { opacity: 1; }

.mm-short__title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12.5px;
  line-height: 1.3;
  color: var(--mm-ink);
  text-decoration: none;
}
.mm-short__title:hover { text-decoration: underline; text-underline-offset: 2px; }

.mm-short__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.mm-short__role {
  align-self: flex-start;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 1px 4px;
}

@media (max-width: 720px) {
  .mm-shorts__row { grid-auto-columns: 40%; }
}
</style>
