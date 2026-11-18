<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { levelName, modLabel, serverNameFromRecording } from '@/services/recordingsService'
import { mapImageUrl } from '@/utils/mapImage'
import { decodePlayerName } from '@/utils/playerName'
import {
  endingShort,
  fetchDogfights,
  fightLength,
  fightReplayHref,
  fightTitle,
  planeName,
  schoolHref,
  type Dogfight,
  type DogfightSide,
  type DogfightsQuery,
} from '@/services/dogfightsService'

/**
 * Recorded dogfights (features/dogfights-on-stats-pages) in the replays panel on a server's or a
 * player's page, under the Shorts and above the rounds: the air fights the dogfight school found
 * in the rounds recorded there, or the ones the player flew in. Each card gives the whole fight:
 * both pilots and their planes, who shot at whom and how often it hit, how it ended, and the way
 * into the dogfight school's theatre and, where the slice was kept, the 3D replay. Draws nothing
 * without a fight; asks for nothing until the panel is near the viewport (`load`).
 */
const props = defineProps<{
  server?: string
  player?: string
  load: boolean
}>()

const emit = defineEmits<{ total: [count: number] }>()

const PAGE_SIZE = 6

type KindFilter = '' | 'dogfight' | 'bounce'
const KINDS: { id: KindFilter; label: string; hint: string }[] = [
  { id: '', label: 'All', hint: 'Every fight found' },
  { id: 'dogfight', label: 'Dogfights', hint: 'Both pilots fought: both shot, or both turned through 180 degrees' },
  { id: 'bounce', label: 'Bounces', hint: 'One pilot attacked, the other did not answer' },
]

const items = ref<Dogfight[]>([])
const total = ref(0)
/** Every fight, whatever the filter: whether the row shows at all. */
const anyTotal = ref(0)
const dogfightCount = ref(0)
const killCount = ref(0)
const page = ref(1)
const kind = ref<KindFilter>('')
const loading = ref(false)
const error = ref(false)
let generation = 0
let abort: AbortController | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const query = computed<DogfightsQuery>(() => ({
  ...(props.server ? { server: props.server } : { player: props.player }),
  ...(kind.value ? { kind: kind.value } : {}),
}))

watch(anyTotal, n => emit('total', n), { immediate: true })

async function fetchPage(to: number) {
  if (!props.server && !props.player) return
  abort?.abort()
  abort = new AbortController()
  const run = ++generation
  loading.value = true
  error.value = false
  try {
    const result = await fetchDogfights({ ...query.value, page: to, pageSize: PAGE_SIZE }, abort.signal)
    if (run !== generation) return
    items.value = result.items
    total.value = result.total
    page.value = result.page
    dogfightCount.value = result.dogfights
    killCount.value = result.kills
    if (!kind.value) anyTotal.value = result.total
  } catch (e) {
    if (run !== generation || (e instanceof DOMException && e.name === 'AbortError')) return
    // An extra row: a failure leaves it out rather than breaking the panel.
    console.warn('dogfights row: request failed', e)
    error.value = true
  } finally {
    if (run === generation) loading.value = false
  }
}

watch([() => props.load, () => props.server, () => props.player], ([go], old) => {
  const moved = old && (old[1] !== props.server || old[2] !== props.player)
  if (moved) {
    items.value = []
    total.value = 0
    anyTotal.value = 0
    kind.value = ''
  }
  if (go && (moved || (!items.value.length && !error.value))) void fetchPage(1)
}, { immediate: true })

function goPage(to: number) {
  if (to < 1 || to > totalPages.value || to === page.value || loading.value) return
  void fetchPage(to)
}

function setKind(id: KindFilter) {
  if (kind.value === id) return
  kind.value = id
  void fetchPage(1)
}

const failed = ref(new Set<string>())
function coverOf(f: Dogfight): string | null {
  const art = mapImageUrl(f.mod, f.level)
  return art && !failed.value.has(art) ? art : null
}
function onCoverError(src: string | null) {
  if (src) failed.value = new Set([...failed.value, src])
}

/** The pilot this player page is about, if one of the two. */
function isMe(s: DogfightSide): boolean {
  return Boolean(props.player) && decodePlayerName(s.name) === decodePlayerName(props.player)
}

/** On a player's page, how the fight went for them. */
function outcomeOf(f: Dogfight): string | null {
  if (!props.player) return null
  const me = f.sides.findIndex(isMe)
  if (me < 0) return null
  if (f.kill) return f.kill.side === me ? 'Won' : 'Shot down'
  if (f.end?.why === 'downed by another') return f.end.side === me ? 'Downed by a third' : 'Survived'
  return 'No kill'
}

/** Team-aware, as the rest of the site: Axis (team 1) red, Allies (team 2) olive. */
function teamClass(s: DogfightSide): string {
  return s.team === 1 ? 'mm-df--axis' : 'mm-df--allies'
}

function hitRate(s: DogfightSide): string {
  return s.aimed > 0 ? `${Math.round((s.hits / s.aimed) * 100)}%` : '-'
}

/** Two flight paths over the level's art: a picture of the fight's shape, not its data.
 *  Seeded by the fight's id so a card keeps its own. */
function pathsOf(f: Dogfight): [string, string] {
  let h = 0
  for (const c of f.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const r = (n: number) => ((h >>> n) & 0xff) / 255
  const mid = 30 + r(0) * 40
  const a = `M 8 ${70 - r(8) * 30} C ${40 + r(16) * 20} ${10 + r(4) * 20}, ${100 + r(12) * 30} ${mid + 40}, ${150 + r(20) * 20} ${20 + r(24) * 20}`
  const b = `M 12 ${30 + r(2) * 30} C ${50 + r(10) * 30} ${70 + r(6) * 15}, ${90 + r(18) * 20} ${mid - 20}, ${145 + r(14) * 20} ${45 + r(22) * 30}`
  return [a, b]
}
</script>

<template>
  <div v-if="anyTotal > 0" class="mm-dfs" data-testid="dogfights-row">
    <div class="mm-dfs__head">
      <span class="mm-dfs__t">Dogfights</span>
      <span class="mm-dfs__tally" data-testid="dogfights-tally">
        {{ dogfightCount }} {{ dogfightCount === 1 ? 'dogfight' : 'dogfights' }} · {{ killCount }} {{ killCount === 1 ? 'kill' : 'kills' }}
      </span>
      <div class="mm-subtabs" role="group" aria-label="Kind of fight">
        <button
          v-for="k in KINDS"
          :key="k.id || 'all'"
          type="button"
          class="mm-subtab"
          :class="{ 'mm-subtab--active': k.id === kind }"
          :aria-pressed="k.id === kind"
          :title="k.hint"
          :data-testid="`dogfights-kind-${k.id || 'all'}`"
          @click="setKind(k.id)"
        >{{ k.label }}</button>
      </div>
      <p class="mm-dfs__range">
        <template v-if="total > 0">{{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, total) }} of {{ total.toLocaleString() }}</template>
        <template v-else-if="!loading">None of these</template>
      </p>
      <div v-if="totalPages > 1" class="mm-dfs__arrows">
        <button
          type="button"
          class="mm-btn mm-btn--inline"
          :disabled="page <= 1 || loading"
          aria-label="Previous dogfights"
          data-testid="dogfights-prev"
          @click="goPage(page - 1)"
        >‹</button>
        <button
          type="button"
          class="mm-btn mm-btn--inline"
          :disabled="page >= totalPages || loading"
          aria-label="More dogfights"
          data-testid="dogfights-next"
          @click="goPage(page + 1)"
        >›</button>
      </div>
      <a
        class="mm-dfs__feed"
        href="https://play.bfstats.io/dogfight.html"
        target="_blank"
        rel="noopener"
      >In the dogfight school <i class="pi pi-external-link" aria-hidden="true" /></a>
    </div>

    <div v-if="error" class="mm-dfs__error">
      Dogfights didn't load.
      <button type="button" class="mm-btn mm-btn--strong" @click="fetchPage(page)">Retry</button>
    </div>

    <ul class="mm-dfs__grid" :class="{ 'mm-dfs__grid--loading': loading }">
      <li
        v-for="f in items"
        :key="f.id"
        class="mm-df"
        :class="{ 'mm-df--kill': f.kill }"
        data-testid="dogfight-card"
      >
        <a
          class="mm-df__cover"
          :href="schoolHref(f.id)"
          target="_blank"
          rel="noopener"
          :aria-label="`Watch ${fightTitle(f)} in the dogfight school`"
        >
          <img
            v-if="coverOf(f)"
            :src="coverOf(f)!"
            alt=""
            loading="lazy"
            decoding="async"
            @error="onCoverError(coverOf(f))"
          />
          <svg class="mm-df__paths" viewBox="0 0 180 100" preserveAspectRatio="none" aria-hidden="true">
            <path :d="pathsOf(f)[0]" class="mm-df__path" :class="teamClass(f.sides[0])" />
            <path :d="pathsOf(f)[1]" class="mm-df__path" :class="teamClass(f.sides[1])" />
          </svg>
          <span class="mm-df__kind" :class="`mm-df__kind--${f.kind}`">{{ f.kind === 'dogfight' ? 'Dogfight' : 'Bounce' }}</span>
          <span v-if="f.kill" class="mm-df__killtag">Kill</span>
          <span class="mm-df__len">{{ fightLength(f.duration) }}</span>
          <span class="mm-df__play" aria-hidden="true"><i class="pi pi-play" /></span>
        </a>

        <div class="mm-df__body">
          <a
            class="mm-df__title"
            :href="schoolHref(f.id)"
            target="_blank"
            rel="noopener"
            :title="fightTitle(f)"
          >{{ fightTitle(f) }}</a>

          <table class="mm-df__pilots">
            <thead>
              <tr>
                <th scope="col">Pilot</th>
                <th scope="col">Plane</th>
                <th scope="col" title="Rounds that would have passed within 25 m of the other plane">Aimed</th>
                <th scope="col" title="Rounds that hit the other plane">Hits</th>
                <th scope="col">Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(s, i) in f.sides"
                :key="i"
                :class="{ 'mm-df__pilot--me': isMe(s), 'mm-df__pilot--won': f.kill?.side === i }"
                data-testid="dogfight-pilot"
              >
                <td class="mm-df__name">
                  <span class="mm-df__team" :class="teamClass(s)" aria-hidden="true" />
                  <router-link
                    :to="`/v4/players/${encodeURIComponent(serverNameFromRecording(s.name))}`"
                    :title="$pn(s.name)"
                  >{{ $pn(s.name) }}</router-link>
                </td>
                <td>{{ planeName(s.tmpl) }}<span v-if="s.gunner" class="mm-df__gunner" :title="`Its gunners fired ${s.gunner} rounds`"> +gunner</span></td>
                <td class="mm-df__num">{{ s.aimed }}</td>
                <td class="mm-df__num">{{ s.hits }}</td>
                <td class="mm-df__num">{{ hitRate(s) }}</td>
              </tr>
            </tbody>
          </table>

          <p v-if="endingShort(f)" class="mm-df__end" data-testid="dogfight-end">{{ endingShort(f) }}</p>

          <div class="mm-meta-row mm-df__meta">
            <span class="mm-df__level">{{ levelName(f.level) }}</span>
            <template v-if="f.mod.toLowerCase() !== 'bf1942'">
              <span class="mm-meta-row__sep">·</span>
              <span>{{ modLabel(f.mod) }}</span>
            </template>
            <template v-if="f.closest != null">
              <span class="mm-meta-row__sep">·</span>
              <span title="The closest the two came">{{ f.closest }} m closest</span>
            </template>
            <template v-if="f.recorded">
              <span class="mm-meta-row__sep">·</span>
              <span>{{ f.recorded }}</span>
            </template>
            <span v-if="outcomeOf(f)" class="mm-df__outcome" data-testid="dogfight-outcome">{{ outcomeOf(f) }}</span>
          </div>

          <router-link
            v-if="!server && f.serverName"
            class="mm-df__server"
            :to="`/v4/servers/detail/${encodeURIComponent(serverNameFromRecording(f.serverName))}`"
            :title="$pn(serverNameFromRecording(f.serverName))"
          >{{ $pn(serverNameFromRecording(f.serverName)) }}</router-link>

          <div class="mm-df__links">
            <a :href="schoolHref(f.id)" target="_blank" rel="noopener" data-testid="dogfight-school">
              <i class="pi pi-send" aria-hidden="true" />Dogfight school
            </a>
            <a v-if="f.clip" :href="fightReplayHref(f)" target="_blank" rel="noopener" data-testid="dogfight-replay">
              <i class="pi pi-video" aria-hidden="true" />3D replay
            </a>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mm-dfs {
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-dfs__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  margin-bottom: 14px;
}

.mm-dfs__t {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink);
}

.mm-dfs__tally,
.mm-dfs__range,
.mm-dfs__error,
.mm-dfs__feed {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-dfs__range { margin: 0; }
.mm-dfs__arrows { display: flex; gap: 6px; }

.mm-dfs__feed {
  margin-left: auto;
  color: var(--mm-ink-soft);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mm-dfs__feed:hover { color: var(--mm-ink); }
.mm-dfs__feed .pi { font-size: 9px; }

.mm-dfs__error {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.mm-dfs__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 0 24px;
  transition: opacity 0.15s ease;
}
.mm-dfs__grid--loading { opacity: 0.5; }

/* The panel's last row needs no rule under it. */
.mm-dfs:last-child {
  padding-bottom: 0;
  margin-bottom: 0;
  border-bottom: 0;
}

.mm-df {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-rule);
  min-width: 0;
}

.mm-df__cover {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg-mute);
}
.mm-df--kill .mm-df__cover { border-color: var(--mm-accent); }
.mm-df__cover:hover { border-color: var(--mm-rule-strong); }

.mm-df__cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.6) brightness(0.75);
}

.mm-df__paths {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.mm-df__path {
  fill: none;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-dasharray: 220;
  stroke-dashoffset: 0;
  vector-effect: non-scaling-stroke;
}
.mm-df__path.mm-df--axis { stroke: var(--mm-kill); }
.mm-df__path.mm-df--allies { stroke: var(--mm-accent-soft); }

.mm-df__cover:hover .mm-df__path { animation: mm-df-draw 1.4s ease-out; }

@keyframes mm-df-draw {
  from { stroke-dashoffset: 220; }
  to { stroke-dashoffset: 0; }
}

.mm-df__kind,
.mm-df__killtag,
.mm-df__len {
  position: absolute;
  z-index: 1;
  padding: 2px 5px;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  color: var(--mm-ink);
}

.mm-df__kind { left: 3px; top: 3px; }
.mm-df__kind--dogfight { color: var(--mm-highlight-ink); background: var(--mm-accent-soft); }
.mm-df__killtag { right: 3px; top: 3px; box-shadow: inset 0 0 0 1px var(--mm-kill); color: var(--mm-kill); }
.mm-df__len { right: 3px; bottom: 3px; letter-spacing: 0.04em; }

.mm-df__play {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  opacity: 0;
  background: color-mix(in srgb, var(--mm-bg) 35%, transparent);
  transition: opacity 0.15s ease;
}
.mm-df__play .pi {
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
.mm-df__cover:hover .mm-df__play,
.mm-df__cover:focus-visible .mm-df__play { opacity: 1; }

.mm-df__body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.mm-df__title {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--mm-ink);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-df__title:hover { text-decoration: underline; text-underline-offset: 2px; }

.mm-df__pilots {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 11.5px;
}

.mm-df__pilots th {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  text-align: left;
  padding: 0 4px 2px 0;
}

.mm-df__pilots th:nth-child(1) { width: 40%; }
.mm-df__pilots th:nth-child(2) { width: 24%; }
.mm-df__pilots th:nth-child(n + 3) { width: 12%; text-align: right; }

.mm-df__pilots td {
  padding: 2px 4px 2px 0;
  color: var(--mm-ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-df__num {
  text-align: right;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
}

.mm-df__name a { color: var(--mm-ink); text-decoration: none; }
.mm-df__name a:hover { text-decoration: underline; text-underline-offset: 2px; }
.mm-df__pilot--won .mm-df__name a { font-weight: 600; }
.mm-df__pilot--me td { background: color-mix(in srgb, var(--mm-highlight) 18%, transparent); }

.mm-df__team {
  display: inline-block;
  width: 8px;
  height: 2px;
  margin-right: 5px;
  vertical-align: middle;
  border-radius: 1px;
}
.mm-df__team.mm-df--axis { background: var(--mm-kill); }
.mm-df__team.mm-df--allies { background: var(--mm-accent-soft); }

.mm-df__gunner {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-ink-muted);
}

.mm-df__end {
  margin: 0;
  font-size: 11.5px;
  color: var(--mm-ink-soft);
  overflow-wrap: anywhere;
}

.mm-df__meta {
  gap: 2px 5px;
  flex-wrap: wrap;
  font-size: 9.5px;
}
.mm-df__meta > span { flex: none; }
.mm-df__level { color: var(--mm-ink-soft); }

.mm-df__outcome {
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
}

.mm-df__server {
  font-size: 12px;
  color: var(--mm-ink-soft);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-df__links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.mm-df__links a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  text-decoration: none;
}
.mm-df__links a:hover { color: var(--mm-ink); }
.mm-df__links .pi { font-size: 9px; }

@media (max-width: 640px) {
  .mm-dfs__grid { grid-template-columns: minmax(0, 1fr); }
  .mm-dfs__feed { margin-left: 0; }
  .mm-df { grid-template-columns: minmax(0, 1fr); }
  .mm-df__cover { aspect-ratio: auto; height: 84px; }
  .mm-df__title { white-space: normal; }
  .mm-df__gunner { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .mm-df__play { transition: none; }
  .mm-df__cover:hover .mm-df__path { animation: none; }
}
</style>
