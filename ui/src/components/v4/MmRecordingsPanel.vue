<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useInViewport } from '@/composables/useInViewport'
import MmShortsRow from '@/components/v4/MmShortsRow.vue'
import { mapImageUrl } from '@/utils/mapImage'
import { formatLocalTooltip, formatRelativeTime } from '@/utils/timeUtils'
import {
  feedHref,
  fetchRecordings,
  formatClock,
  hasServerRecording,
  levelName,
  modLabel,
  recordingPageHref,
  serverNameFromRecording,
  watchHref,
  type RecordingSource,
  type RecordingSummary,
  type RecordingsQuery,
} from '@/services/recordingsService'

/**
 * Shared replays (play.bfstats.io's REPLAY feed) on a server's or a player's page
 * (features/replay-on-stats-pages). On a server: the rounds recorded there. On a
 * player: the rounds they played in, and the ones they shared. A round several
 * players recorded is one card. The panel stays out of the page until there is a
 * recording to show, and asks for nothing until it is near the viewport. Each card says
 * which recorder wrote it (features/recording-source): SERVER, the whole battlefield, lit;
 * PLAYER, one client's view, quiet. All / Server / Player narrows every tab.
 * The Shorts cut from those rounds come first, above the rounds, as on the REPLAY feed
 * (features/replay-shorts, "On the stats pages"): the panel shows when either has some.
 */
const props = withDefaults(defineProps<{
  server?: string
  player?: string
  /** Space above and below the panel, px; none while there is nothing to show. */
  spacing?: number
  spacingAfter?: number
}>(), { spacing: 20, spacingAfter: 0 })

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
  /** The tab's count with no recorder filter: whether the tab is shown at all. */
  anyTotal: number
  page: number
  totalPages: number
  loading: boolean
  error: boolean
}

const PAGE_SIZE = 6

type RecorderFilter = '' | RecordingSource

/** All / Server / Player (features/recording-source). */
const RECORDERS: { id: RecorderFilter; label: string; hint: string }[] = [
  { id: '', label: 'All', hint: 'Every recording' },
  { id: 'server', label: 'Server', hint: 'Server recordings: the whole battlefield, every player' },
  { id: 'client', label: 'Player', hint: "Player recordings: one player's view" },
]

const recorder = ref<RecorderFilter>('')

const sources = computed<Source[]>(() => {
  const source = recorder.value || undefined
  if (props.server) {
    return [{ id: 'server', label: 'Recorded here', query: { server: props.server, source }, feed: feedHref({ server: props.server, source }) }]
  }
  if (props.player) {
    return [
      { id: 'played', label: 'Played in', query: { player: props.player, source }, feed: null },
      { id: 'shared', label: 'Shared', query: { uploader: props.player, source }, feed: feedHref({ uploader: props.player, source }) },
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

const shown = computed(() => sources.value.filter(s => (states.value[s.id]?.anyTotal ?? 0) > 0))
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

/** The Shorts row's count, once it has asked. */
const shorts = ref(0)

const summary = computed(() =>
  [
    ...(shorts.value > 0 ? [`${shorts.value} ${shorts.value === 1 ? 'short' : 'shorts'}`] : []),
    ...shown.value.map(s => `${states.value[s.id]!.total} ${s.id === 'server' ? 'rounds' : s.label.toLowerCase()}`),
  ].join(' · '),
)

async function load(source: Source, page: number, run: number) {
  const previous = states.value[source.id]
  const filtered = Boolean(source.query.source)
  states.value[source.id] = {
    items: previous?.items ?? [],
    total: previous?.total ?? 0,
    anyTotal: previous?.anyTotal ?? 0,
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
      // Narrowed to a recorder, the tab keeps the count it had unnarrowed.
      anyTotal: filtered ? Math.max(previous?.anyTotal ?? 0, result.totalCount) : result.totalCount,
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
  recorder.value = ''
  for (const source of sources.value) void load(source, 1, run)
}

/** Narrows every tab to one kind of recorder, keeping the tabs and the one picked. */
function setRecorder(id: RecorderFilter) {
  if (recorder.value === id) return
  recorder.value = id
  abort?.abort()
  abort = new AbortController()
  const run = ++generation
  for (const source of sources.value) {
    if ((states.value[source.id]?.anyTotal ?? 0) > 0) void load(source, 1, run)
  }
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
    <!-- v-show, not v-if: the Shorts row inside has to be there to ask for its count. -->
    <section
      v-show="(current && state) || shorts > 0"
      ref="panel"
      class="mm-panel mm-recs"
      :style="{ marginTop: `${spacing}px`, marginBottom: `${spacingAfter}px` }"
      data-testid="recordings-panel"
    >
      <div class="mm-pbar">
        <span class="mm-pbar__t"># Replays</span>
        <span class="mm-pbar__m">{{ summary }}</span>
      </div>

      <div class="mm-panel__body">
        <MmShortsRow :server="server" :player="player" :load="visible" @total="shorts = $event" />

        <template v-if="current && state">
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
          <div class="mm-subtabs mm-recs__recorder" role="group" aria-label="Recorded by" data-testid="recordings-recorder">
            <button
              v-for="f in RECORDERS"
              :key="f.id || 'all'"
              type="button"
              class="mm-subtab"
              :class="{ 'mm-subtab--active': f.id === recorder }"
              :aria-pressed="f.id === recorder"
              :title="f.hint"
              :data-testid="`recordings-recorder-${f.id || 'all'}`"
              @click="setRecorder(f.id)"
            >{{ f.label }}</button>
          </div>
          <p class="mm-recs__range">
            <template v-if="state.total > 0">Showing {{ rangeStart }}–{{ rangeEnd }} of {{ state.total.toLocaleString() }}</template>
            <template v-else-if="!state.loading">No {{ recorder === 'server' ? 'server' : 'player' }} recordings</template>
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
          <li
            v-for="r in state.items"
            :key="r.slug"
            class="mm-rec"
            :class="{ 'mm-rec--server': hasServerRecording(r) }"
            data-testid="recording-card"
          >
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
              <span class="mm-rec__len">{{ formatClock(durationOf(r)) }}</span>
              <span
                v-if="hasServerRecording(r)"
                class="mm-rec__src mm-rec__src--server"
                title="Server recording: the whole battlefield, every player"
                data-testid="recording-source-server"
              ><i class="pi pi-server" aria-hidden="true" />Server</span>
              <span
                v-else-if="r.source === 'client'"
                class="mm-rec__src mm-rec__src--client"
                title="Player recording: one player's view, from their bf42plus"
                data-testid="recording-source-client"
              ><i class="pi pi-user" aria-hidden="true" />Player</span>
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
                <span class="mm-rec__level">{{ levelName(r.level) }}</span>
                <template v-if="r.mod.toLowerCase() !== 'bf1942'">
                  <span class="mm-meta-row__sep">·</span>
                  <span>{{ modLabel(r.mod) }}</span>
                </template>
                <span class="mm-meta-row__sep">·</span>
                <span>{{ gameMode(r.gameMode) }}</span>
                <span class="mm-meta-row__sep">·</span>
                <span>{{ r.playerCount }}p</span>
                <span v-if="r.roundCard" class="mm-rec__povs" :title="`${r.roundCard.recordings} players recorded this round`">{{ r.roundCard.recordings }} recordings</span>
              </div>
              <router-link
                v-if="!server && r.serverName"
                class="mm-rec__server"
                :to="`/v4/servers/detail/${encodeURIComponent(serverNameFromRecording(r.serverName))}`"
                :title="$pn(serverNameFromRecording(r.serverName))"
              >{{ $pn(serverNameFromRecording(r.serverName)) }}</router-link>
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
                <span class="mm-meta-row__sep">·</span>
                <span class="mm-rec__stats">
                  <span :title="formatLocalTooltip(sharedAt(r))">{{ formatRelativeTime(sharedAt(r)) }}</span>
                  <span class="mm-meta-row__sep">·</span>
                  <span>{{ viewsOf(r).toLocaleString() }} {{ viewsOf(r) === 1 ? 'view' : 'views' }}</span>
                </span>
                <template v-if="r.statsRoundId">
                  <span class="mm-meta-row__sep">·</span>
                  <router-link
                    class="mm-rec__report"
                    :to="`/v4/rounds/${encodeURIComponent(r.statsRoundId)}/report`"
                    title="The round's scoreboard and battle feed on bfstats.io"
                    data-testid="recording-round-report"
                  >Round stats</router-link>
                </template>
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
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mm-rec__report {
  color: var(--mm-ink-soft);
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
}
.mm-rec__report:hover { color: var(--mm-ink); }
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

/* Compact rows: a small frame beside the details, two or three to a line. */
.mm-recs__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 0 24px;
  transition: opacity 0.15s ease;
}

.mm-recs__grid--loading { opacity: 0.5; }

.mm-rec {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--mm-rule);
  min-width: 0;
}

.mm-rec__cover {
  position: relative;
  display: block;
  width: 112px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg-mute);
}

.mm-rec__cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mm-rec__cover:hover { border-color: var(--mm-rule-strong); }

/* Which recorder wrote it (features/recording-source). A server recording covers the
   whole battlefield and is the panel's best: a lit olive tag and an olive edge. A player's
   is a quiet tag. */
.mm-rec__src {
  position: absolute;
  left: 3px;
  top: 3px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.mm-rec__src .pi { font-size: 7.5px; }

.mm-rec__src--server {
  background: var(--mm-accent-soft);
  color: var(--mm-highlight-ink);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--mm-accent-soft) 60%, white), 0 0 8px color-mix(in srgb, var(--mm-accent-soft) 55%, transparent);
}

.mm-rec__src--client {
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  color: var(--mm-ink-soft);
  box-shadow: inset 0 0 0 1px var(--mm-rule-strong);
}

.mm-rec--server .mm-rec__cover { border-color: var(--mm-accent); }
.mm-rec--server .mm-rec__cover:hover { border-color: var(--mm-accent-soft); }

.mm-rec__len {
  position: absolute;
  right: 3px;
  bottom: 3px;
  z-index: 1;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  padding: 1px 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  color: var(--mm-ink);
}

.mm-rec__play {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  opacity: 0;
  background: color-mix(in srgb, var(--mm-bg) 35%, transparent);
  transition: opacity 0.15s ease;
}

.mm-rec__play .pi {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 10px;
  padding-left: 2px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
}

.mm-rec__cover:hover .mm-rec__play,
.mm-rec__cover:focus-visible .mm-rec__play { opacity: 1; }

.mm-rec__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.mm-rec__title {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--mm-ink);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Short lines wrap rather than clip, so a narrow column keeps every fact. */
.mm-rec__meta {
  gap: 2px 5px;
  flex-wrap: wrap;
  min-width: 0;
  font-size: 9.5px;
}

.mm-rec__meta > span { flex: none; }
.mm-rec__level { color: var(--mm-ink-soft); }

.mm-rec__povs {
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
}

/* A name keeps its own casing. */
.mm-rec__server {
  font-size: 12px;
  color: var(--mm-ink-soft);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-rec__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 5px;
  min-width: 0;
  font-size: 11.5px;
  color: var(--mm-ink-muted);
}

.mm-rec__by {
  min-width: 0;
  overflow-wrap: anywhere;
}

.mm-rec__by a { color: var(--mm-ink-soft); text-decoration: none; }

.mm-rec__stats {
  display: inline-flex;
  flex: none;
  gap: 5px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
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

@media (max-width: 640px) {
  .mm-recs__grid { grid-template-columns: minmax(0, 1fr); }
  .mm-recs__feed { margin-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .mm-rec__play { transition: none; }
}
</style>
