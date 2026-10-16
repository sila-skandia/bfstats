<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useInViewport } from '@/composables/useInViewport'
import { mapImageUrl } from '@/utils/mapImage'
import { formatLocalTooltip, formatRelativeTime } from '@/utils/timeUtils'
import {
  feedHref,
  fetchRecordings,
  formatClock,
  levelName,
  modLabel,
  recordingPageHref,
  serverNameFromRecording,
  watchHref,
  type RecordingSummary,
  type RecordingsQuery,
} from '@/services/recordingsService'

/**
 * Shared replays (play.bfstats.io's REPLAY feed) on a server's or a player's page
 * (features/replay-on-stats-pages). On a server: the rounds recorded there. On a
 * player: the rounds they played in, and the ones they shared. A round several
 * players recorded is one card. The panel stays out of the page until there is a
 * recording to show, and asks for nothing until it is near the viewport.
 */
const props = withDefaults(defineProps<{
  server?: string
  player?: string
  /** Space above the panel, px; none while there is nothing to show. */
  spacing?: number
}>(), { spacing: 20 })

type SourceId = 'server' | 'played' | 'shared'

interface Source {
  id: SourceId
  label: string
  query: RecordingsQuery
  feed: string | null
}

interface SourceState {
  items: RecordingSummary[]
  total: number
  page: number
  totalPages: number
  loading: boolean
  error: boolean
}

const PAGE_SIZE = 6

const sources = computed<Source[]>(() => {
  if (props.server) {
    return [{ id: 'server', label: 'Recorded here', query: { server: props.server }, feed: feedHref({ server: props.server }) }]
  }
  if (props.player) {
    return [
      { id: 'played', label: 'Played in', query: { player: props.player }, feed: null },
      { id: 'shared', label: 'Shared', query: { uploader: props.player }, feed: feedHref({ uploader: props.player }) },
    ]
  }
  return []
})

const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const visible = useInViewport(root)
const states = ref<Partial<Record<SourceId, SourceState>>>({})
const active = ref<SourceId | null>(null)
let generation = 0
let abort: AbortController | null = null

const shown = computed(() => sources.value.filter(s => (states.value[s.id]?.total ?? 0) > 0))
const current = computed(() => shown.value.find(s => s.id === active.value) ?? shown.value[0] ?? null)
const state = computed(() => (current.value ? states.value[current.value.id] ?? null : null))

const rangeStart = computed(() => (state.value ? (state.value.page - 1) * PAGE_SIZE + 1 : 0))
const rangeEnd = computed(() => (state.value ? Math.min(state.value.page * PAGE_SIZE, state.value.total) : 0))
const pageRange = computed(() => {
  const s = state.value
  if (!s || s.totalPages <= 1) return []
  const from = Math.max(1, Math.min(s.page - 2, s.totalPages - 4))
  const to = Math.min(s.totalPages, from + 4)
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
})

const summary = computed(() =>
  shown.value
    .map(s => `${states.value[s.id]!.total} ${s.id === 'server' ? 'rounds' : s.label.toLowerCase()}`)
    .join(' · '),
)

async function load(source: Source, page: number, run: number) {
  const previous = states.value[source.id]
  states.value[source.id] = {
    items: previous?.items ?? [],
    total: previous?.total ?? 0,
    page,
    totalPages: previous?.totalPages ?? 1,
    loading: true,
    error: false,
  }
  try {
    const result = await fetchRecordings({ ...source.query, page, pageSize: PAGE_SIZE }, abort?.signal)
    if (run !== generation) return
    states.value[source.id] = {
      items: result.items,
      total: result.totalCount,
      page: result.page,
      totalPages: result.totalPages,
      loading: false,
      error: false,
    }
  } catch (e) {
    if (run !== generation || (e instanceof DOMException && e.name === 'AbortError')) return
    // A page's extra section: a failure leaves it out rather than breaking the page.
    console.warn('recordings panel: request failed', e)
    states.value[source.id] = { ...states.value[source.id]!, loading: false, error: true }
  }
}

function loadAll() {
  abort?.abort()
  abort = new AbortController()
  const run = ++generation
  states.value = {}
  active.value = null
  for (const source of sources.value) void load(source, 1, run)
}

watch([visible, () => props.server, () => props.player], ([isVisible]) => {
  if (isVisible) loadAll()
}, { immediate: true })

function retry() {
  if (current.value && state.value) void load(current.value, state.value.page, generation)
}

function goPage(page: number) {
  const source = current.value
  const s = state.value
  if (!source || !s || page < 1 || page > s.totalPages || page === s.page) return
  void load(source, page, generation)
  panel.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

// --- a card -----------------------------------------------------------------

/** Covers that failed to load: the card falls back to the level's art, then to none. */
const failedCovers = ref(new Set<string>())

function coverOf(r: RecordingSummary): string | null {
  const own = r.thumbnailUrl ?? r.roundCard?.thumbnailUrl ?? null
  if (own && !failedCovers.value.has(own)) return own
  const art = mapImageUrl(r.mod, r.level)
  return art && !failedCovers.value.has(art) ? art : null
}

function onCoverError(src: string | null) {
  if (!src) return
  failedCovers.value = new Set([...failedCovers.value, src])
}

const durationOf = (r: RecordingSummary) => r.roundCard?.durationSeconds ?? r.durationSeconds
const viewsOf = (r: RecordingSummary) => r.roundCard?.viewCount ?? r.viewCount
const sharedAt = (r: RecordingSummary) => r.roundCard?.createdAt ?? r.createdAt
const uploadersOf = (r: RecordingSummary) => r.roundCard?.uploaders ?? [r.uploaderName]

function gameMode(mode: string): string {
  return mode.replace(/[_-]+/g, ' ')
}
</script>

<template>
  <div ref="root" class="mm-recs-slot">
    <section
      v-if="current && state"
      ref="panel"
      class="mm-panel mm-recs"
      :style="{ marginTop: `${spacing}px` }"
      data-testid="recordings-panel"
    >
      <div class="mm-pbar">
        <span class="mm-pbar__t"># Replays</span>
        <span class="mm-pbar__m">{{ summary }}</span>
      </div>

      <div class="mm-panel__body">
        <div class="mm-recs__head">
          <div v-if="shown.length > 1" class="mm-subtabs" role="tablist">
            <button
              v-for="s in shown"
              :key="s.id"
              type="button"
              role="tab"
              class="mm-subtab"
              :class="{ 'mm-subtab--active': s.id === current.id }"
              :aria-selected="s.id === current.id"
              :data-testid="`recordings-tab-${s.id}`"
              @click="active = s.id"
            >
              {{ s.label }} · {{ states[s.id]!.total }}
            </button>
          </div>
          <p class="mm-recs__range">
            Showing {{ rangeStart }}–{{ rangeEnd }} of {{ state.total.toLocaleString() }}
          </p>
          <a
            v-if="current.feed"
            class="mm-recs__feed"
            :href="current.feed"
            target="_blank"
            rel="noopener"
          >In the replay feed <i class="pi pi-external-link" aria-hidden="true" /></a>
        </div>

        <div v-if="state.error" class="mm-recs__error">
          Replays didn't load.
          <button type="button" class="mm-btn mm-btn--strong" @click="retry">Retry</button>
        </div>

        <ul class="mm-recs__grid" :class="{ 'mm-recs__grid--loading': state.loading }">
          <li v-for="r in state.items" :key="r.slug" class="mm-rec" data-testid="recording-card">
            <a
              class="mm-rec__cover"
              :href="watchHref(r)"
              target="_blank"
              rel="noopener"
              :aria-label="`Watch ${r.title}`"
            >
              <img
                v-if="coverOf(r)"
                :src="coverOf(r)!"
                alt=""
                loading="lazy"
                decoding="async"
                @error="onCoverError(coverOf(r))"
              />
              <span class="mm-rec__level">{{ levelName(r.level) }}</span>
              <span class="mm-rec__mod">{{ modLabel(r.mod) }}</span>
              <span v-if="r.roundCard" class="mm-rec__povs">{{ r.roundCard.recordings }} recordings</span>
              <span class="mm-rec__len">{{ formatClock(durationOf(r)) }}</span>
              <span class="mm-rec__play" aria-hidden="true"><i class="pi pi-play" /></span>
            </a>
            <div class="mm-rec__body">
              <a
                class="mm-rec__title"
                :href="recordingPageHref(r.slug)"
                target="_blank"
                rel="noopener"
                :title="r.title"
              >{{ r.title }}</a>
              <div class="mm-meta-row mm-rec__meta">
                <span>{{ gameMode(r.gameMode) }}</span>
                <span class="mm-meta-row__sep">·</span>
                <span>{{ r.playerCount }} players</span>
                <template v-if="!server && r.serverName">
                  <span class="mm-meta-row__sep">·</span>
                  <router-link
                    class="mm-rec__server"
                    :to="`/v4/servers/detail/${encodeURIComponent(serverNameFromRecording(r.serverName))}`"
                    :title="$pn(serverNameFromRecording(r.serverName))"
                  >{{ $pn(serverNameFromRecording(r.serverName)) }}</router-link>
                </template>
              </div>
              <div class="mm-rec__foot">
                <span class="mm-rec__by">
                  by
                  <template v-for="(name, i) in uploadersOf(r)" :key="name">
                    <span v-if="i > 0">, </span>
                    <router-link
                      v-if="name === r.uploaderName && r.uploaderPlayer"
                      :to="`/v4/players/${encodeURIComponent(r.uploaderPlayer)}`"
                    >{{ $pn(r.uploaderPlayer) }}</router-link>
                    <span v-else>{{ $pn(name) }}</span>
                  </template>
                </span>
                <span class="mm-rec__stats">
                  <span :title="formatLocalTooltip(sharedAt(r))">{{ formatRelativeTime(sharedAt(r)) }}</span>
                  <span class="mm-meta-row__sep">·</span>
                  <span>{{ viewsOf(r).toLocaleString() }} {{ viewsOf(r) === 1 ? 'view' : 'views' }}</span>
                </span>
              </div>
            </div>
          </li>
        </ul>

        <div v-if="state.totalPages > 1" class="mm-recs__pagination">
          <button
            type="button"
            class="mm-btn mm-btn--inline"
            :disabled="state.page <= 1"
            aria-label="Previous page"
            @click="goPage(state.page - 1)"
          >‹</button>
          <button
            v-for="p in pageRange"
            :key="p"
            type="button"
            class="mm-btn mm-btn--inline"
            :class="{ 'mm-recs__page--active': p === state.page }"
            @click="goPage(p)"
          >{{ p }}</button>
          <button
            type="button"
            class="mm-btn mm-btn--inline"
            :disabled="state.page >= state.totalPages"
            aria-label="Next page"
            @click="goPage(state.page + 1)"
          >›</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mm-recs-slot {
  /* An empty slot is the normal case (most servers and players have no replays):
     it holds no space, and the observer still sees it. */
  min-height: 1px;
}

.mm-recs__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  margin-bottom: 14px;
}

.mm-recs__range {
  margin: 0;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-recs__feed {
  margin-left: auto;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mm-recs__feed .pi { font-size: 9px; }

.mm-recs__error {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-recs__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px 16px;
  transition: opacity 0.15s ease;
}

.mm-recs__grid--loading { opacity: 0.5; }

.mm-rec {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.mm-rec__cover {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg-mute);
  isolation: isolate;
}

.mm-rec__cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.25s ease;
}

/* A shade over the art, so the labels read on any picture. */
.mm-rec__cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 45%, color-mix(in srgb, var(--mm-bg) 85%, transparent));
  z-index: 0;
}

.mm-rec__cover:hover { border-color: var(--mm-rule-strong); }
.mm-rec__cover:hover img { transform: scale(1.03); }

.mm-rec__level {
  position: absolute;
  left: 10px;
  right: 64px;
  bottom: 8px;
  z-index: 1;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-rec__mod,
.mm-rec__povs,
.mm-rec__len {
  position: absolute;
  z-index: 1;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 3px 6px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  color: var(--mm-ink);
}

.mm-rec__mod { top: 7px; left: 7px; }
.mm-rec__povs { top: 7px; right: 7px; background: var(--mm-highlight); color: var(--mm-highlight-ink); }
.mm-rec__len { bottom: 7px; right: 7px; }

.mm-rec__play {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.mm-rec__play .pi {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  font-size: 15px;
  padding-left: 3px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
}

.mm-rec__cover:hover .mm-rec__play,
.mm-rec__cover:focus-visible .mm-rec__play { opacity: 1; }

.mm-rec__body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.mm-rec__title {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--mm-ink);
  text-decoration: none;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mm-rec__meta { gap: 6px; flex-wrap: nowrap; min-width: 0; }
.mm-rec__meta > span { flex: none; }

/* A name keeps its own casing inside the uppercase meta row. */
.mm-rec__server {
  font-family: var(--mm-font-display);
  font-size: 12px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--mm-ink-soft);
  text-decoration: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-rec__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 10px;
  font-size: 12px;
  color: var(--mm-ink-muted);
}

.mm-rec__by { min-width: 0; }
.mm-rec__by a { color: var(--mm-ink-soft); text-decoration: none; }

.mm-rec__stats {
  display: inline-flex;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.mm-recs__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 16px;
}

.mm-recs__page--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

@media (max-width: 1100px) {
  .mm-recs__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 640px) {
  .mm-recs__grid { grid-template-columns: minmax(0, 1fr); }
  .mm-recs__feed { margin-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .mm-rec__cover img,
  .mm-rec__play { transition: none; }
}
</style>
