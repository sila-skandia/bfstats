<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchRoundReport, type RoundReport } from '@/services/serverDetailsService'
import {
  generateBattleReport,
  filterBattleEvents,
  type BattleEvent,
  type BattleHighlight,
  type RoundSummary,
} from '@/utils/battleEventGenerator'
import MmBattleSummary from './round-report/MmBattleSummary.vue'
import MmBattleHighlight from './round-report/MmBattleHighlight.vue'
import MmBattleVisualizer from './round-report/MmBattleVisualizer.vue'
import MmPlaybackControls from './round-report/MmPlaybackControls.vue'
import { kdClass } from '@/views/v4/mmTokens'

const router = useRouter()

interface Props {
  roundId: string
  players?: string
}

const props = defineProps<Props>()

const roundReport = ref<RoundReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const isPlaying = ref(false)
const playbackInterval = ref<NodeJS.Timeout | null>(null)
const playbackSpeed = ref(250)
const battleEvents = ref<BattleEvent[]>([])
const battleHighlights = ref<BattleHighlight[]>([])
const roundSummary = ref<RoundSummary | null>(null)
const visibleEventIndex = ref(0)
const autoScrollEnabled = ref(true)
const showLiveLadder = ref(true)
const showGraphicalView = ref(false)
const trackedPlayer = ref('')
const newEventIds = ref(new Set<number>())
const batchUpdateEvents = ref<Array<{ timestamp: string; events: BattleEvent[] }>>([])
const consoleElement = ref<HTMLElement | null>(null)

const displayFilters = ref({
  showJoinEvents: false,
  showDeathEvents: true,
  highlightsOnly: false,
})

const processBattleReport = () => {
  if (!roundReport.value) return
  const report = generateBattleReport(roundReport.value)
  battleEvents.value = report.events
  battleHighlights.value = report.highlights
  roundSummary.value = report.summary

  const groups = report.events.reduce((acc, event) => {
    if (!acc[event.timestamp]) acc[event.timestamp] = []
    acc[event.timestamp].push(event)
    return acc
  }, {} as Record<string, BattleEvent[]>)

  batchUpdateEvents.value = Object.entries(groups)
    .map(([timestamp, events]) => ({ timestamp, events }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

const filteredBattleEvents = computed(() =>
  filterBattleEvents(battleEvents.value, {
    showJoinEvents: displayFilters.value.showJoinEvents,
    showDeathEvents: displayFilters.value.showDeathEvents,
    highlightsOnly: displayFilters.value.highlightsOnly,
  }),
)

const fetchData = async () => {
  if (!props.roundId) return
  loading.value = true
  error.value = null
  try {
    const data = await fetchRoundReport(props.roundId)
    roundReport.value = data

    if (!data.leaderboardSnapshots || data.leaderboardSnapshots.length === 0 ||
        (data.leaderboardSnapshots.length === 1 && data.leaderboardSnapshots[0].entries.length === 0)) {
      error.value = 'This round was empty — no players participated.'
      return
    }

    processBattleReport()
    visibleEventIndex.value = batchUpdateEvents.value.length - 1
    updatePageTitle()
    if (props.players) trackedPlayer.value = props.players
  } catch (err) {
    console.error('Error fetching round report:', err)
    error.value = 'Failed to fetch round report'
  } finally {
    loading.value = false
  }
}

const startPlayback = () => {
  if (!batchUpdateEvents.value.length) return
  if (visibleEventIndex.value >= batchUpdateEvents.value.length - 1) {
    visibleEventIndex.value = 0
  }
  isPlaying.value = true
  newEventIds.value.clear()
  autoScrollEnabled.value = true

  playbackInterval.value = setInterval(() => {
    if (visibleEventIndex.value < batchUpdateEvents.value.length - 1) {
      visibleEventIndex.value++
      const currentBatch = batchUpdateEvents.value[visibleEventIndex.value]
      const startIndex = battleEvents.value.findIndex(e => e.timestamp === currentBatch.timestamp)
      if (startIndex >= 0) {
        for (let i = 0; i < currentBatch.events.length; i++) newEventIds.value.add(startIndex + i)
        setTimeout(() => {
          for (let i = 0; i < currentBatch.events.length; i++) newEventIds.value.delete(startIndex + i)
        }, 1000)
      }
      if (autoScrollEnabled.value) scrollToTop()
    } else {
      stopPlayback()
    }
  }, playbackSpeed.value)
}

const stopPlayback = () => {
  isPlaying.value = false
  if (playbackInterval.value) {
    clearInterval(playbackInterval.value)
    playbackInterval.value = null
  }
}

const resetPlayback = () => {
  stopPlayback()
  visibleEventIndex.value = 0
  newEventIds.value.clear()
  autoScrollEnabled.value = true
}

const togglePlayback = () => {
  if (isPlaying.value) stopPlayback()
  else startPlayback()
}

const setPlaybackSpeed = (speed: number) => {
  playbackSpeed.value = speed
  if (isPlaying.value) {
    stopPlayback()
    startPlayback()
  }
}

const scrollToTop = () => {
  if (consoleElement.value) consoleElement.value.scrollTop = 0
}

const handleDotClick = (index: number) => {
  stopPlayback()
  visibleEventIndex.value = index
  newEventIds.value.clear()
  scrollToTop()
}

const isDragging = ref(false)
const startDrag = (event: MouseEvent) => {
  isDragging.value = true
  updateFromDrag(event)
  document.addEventListener('mousemove', updateFromDrag)
  document.addEventListener('mouseup', endDrag)
}
const updateFromDrag = (event: MouseEvent) => {
  if (!isDragging.value || batchUpdateEvents.value.length === 0) return
  const target = event.currentTarget as HTMLElement
  if (!target) return
  const rect = target.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const ratio = x / rect.width
  visibleEventIndex.value = Math.round(ratio * (batchUpdateEvents.value.length - 1))
}
const endDrag = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', updateFromDrag)
  document.removeEventListener('mouseup', endDrag)
}

const snapshotTimeline = computed(() =>
  batchUpdateEvents.value.map((batch, idx) => ({
    index: idx,
    label: formatTimeOffset(batch.timestamp),
    timestamp: batch.timestamp,
  })),
)

const currentElapsedTime = computed(() => {
  if (!batchUpdateEvents.value.length) return '00:00'
  const idx = Math.min(visibleEventIndex.value, batchUpdateEvents.value.length - 1)
  return formatTimeOffset(batchUpdateEvents.value[idx].timestamp)
})

const visibleEvents = computed(() => {
  const filtered = filteredBattleEvents.value
  if (visibleEventIndex.value >= batchUpdateEvents.value.length) return filtered
  const currentBatch = batchUpdateEvents.value[visibleEventIndex.value]
  if (!currentBatch) return []
  const cutoffTime = new Date(currentBatch.timestamp).getTime()
  return filtered.filter(e => new Date(e.timestamp).getTime() <= cutoffTime)
})

const visibleEventsReversed = computed(() => [...visibleEvents.value].reverse())

const currentLeaderboard = computed(() => {
  if (!roundReport.value || !roundReport.value.leaderboardSnapshots.length) return []
  if (showLiveLadder.value) {
    let currentTime: string
    if (visibleEventIndex.value > 0 && visibleEventIndex.value < batchUpdateEvents.value.length) {
      currentTime = batchUpdateEvents.value[visibleEventIndex.value].timestamp
    } else if (visibleEventIndex.value === 0) {
      currentTime = roundReport.value.round.startTime
    } else {
      currentTime = batchUpdateEvents.value[batchUpdateEvents.value.length - 1]?.timestamp || roundReport.value.round.startTime
    }
    let target = roundReport.value.leaderboardSnapshots[0]
    for (const snap of roundReport.value.leaderboardSnapshots) {
      if (new Date(snap.timestamp).getTime() <= new Date(currentTime).getTime()) target = snap
      else break
    }
    return target.entries
  }
  return roundReport.value.leaderboardSnapshots[roundReport.value.leaderboardSnapshots.length - 1].entries
})

const teamGroups = computed(() => {
  if (!currentLeaderboard.value.length) return []
  const groups = currentLeaderboard.value.reduce((acc, entry) => {
    if (!acc[entry.teamLabel]) acc[entry.teamLabel] = []
    acc[entry.teamLabel].push(entry)
    return acc
  }, {} as Record<string, typeof currentLeaderboard.value>)
  return Object.entries(groups)
    .map(([teamName, players]) => ({
      teamName,
      players: players.sort((a, b) => a.rank - b.rank),
      totalScore: players.reduce((s, p) => s + p.score, 0),
      totalKills: players.reduce((s, p) => s + p.kills, 0),
      totalDeaths: players.reduce((s, p) => s + p.deaths, 0),
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
})

const formatDate = (s: string | null): string => {
  if (!s) return 'N/A'
  const d = new Date(s.endsWith('Z') ? s : s + 'Z')
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatTimeOffset = (ts: string) => {
  if (!roundReport.value) return '00:00'
  const start = new Date(roundReport.value.round.startTime).getTime()
  const t = new Date(ts).getTime()
  const offsetMs = t - start
  if (offsetMs < 0) return '00:00'
  const totalSeconds = Math.floor(offsetMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

const isTrackedPlayerEvent = (event: BattleEvent) => {
  if (!trackedPlayer.value.trim()) return false
  return event.player.toLowerCase().includes(trackedPlayer.value.toLowerCase()) ||
         event.message.toLowerCase().includes(trackedPlayer.value.toLowerCase())
}

const eventRowClass = (event: BattleEvent, eventIndex: number) => {
  const cls = ['mm-rr__line']
  if (newEventIds.value.has(eventIndex)) cls.push('mm-rr__line--new')
  if (isTrackedPlayerEvent(event)) cls.push('mm-rr__line--tracked')
  if (event.isHighlight) cls.push('mm-rr__line--highlight')
  return cls
}

const goBack = () => {
  if (window.history.length > 1) window.history.back()
  else router.push('/v4/servers/bf1942')
}

const navigateToPlayerProfile = (playerName: string) => {
  router.push(`/v4/players/${encodeURIComponent(playerName)}`)
}

const navigateToServer = (serverName?: string) => {
  if (!serverName) return
  router.push(`/v4/servers/detail/${encodeURIComponent(serverName)}`)
}

const shouldShowTickets = computed(() => {
  if (!roundReport.value?.round) return false
  const { tickets1 } = roundReport.value.round
  return tickets1 !== null && tickets1 !== undefined && tickets1 >= 0
})

const visibleHighlights = computed(() => {
  if (!battleHighlights.value.length || !batchUpdateEvents.value.length) return []
  const currentBatch = batchUpdateEvents.value[visibleEventIndex.value]
  if (!currentBatch) return []
  const cutoff = new Date(currentBatch.timestamp).getTime()
  return battleHighlights.value.filter(h => new Date(h.timestamp).getTime() <= cutoff)
})

const updatePageTitle = () => {
  if (!roundReport.value?.round) return
  const { round } = roundReport.value
  document.title = `${round.mapName} · ${round.serverName} · Round report`
}

const handleKeydown = (event: KeyboardEvent) => {
  const el = document.activeElement
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
  if (event.key === ' ') {
    event.preventDefault()
    togglePlayback()
  }
}

watch(() => props.roundId, (id) => { if (id) fetchData() }, { immediate: true })

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => {
  stopPlayback()
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousemove', updateFromDrag)
  document.removeEventListener('mouseup', endDrag)
})
</script>

<template>
  <div class="mm-container mm-section mm-rr">
    <div v-if="loading" class="mm-rr__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="goBack">← Back</button>
    </div>

    <template v-else-if="roundReport">
      <!-- Meta + back -->
      <div class="mm-meta-row" style="margin-bottom: 12px">
        <button type="button" class="mm-meta-row__strong mm-rr__back" @click="goBack">← Back</button>
        <span class="mm-meta-row__sep">·</span>
        <span class="mm-chip">
          <span class="mm-chip__dot" />
          Round report
        </span>
        <span class="mm-meta-row__sep">·</span>
        <span>{{ formatDate(roundReport.round.startTime) }}</span>
      </div>

      <!-- Header: map name + server + scoreboard -->
      <header class="mm-rr__head">
        <div class="mm-rr__head-text">
          <div class="mm-eyebrow mm-eyebrow--strong">{{ roundReport.round.gameType }}</div>
          <h1 class="mm-display mm-rr__title">{{ roundReport.round.mapName }}</h1>
          <div class="mm-meta-row" style="margin-top: 8px">
            <a class="mm-meta-row__strong mm-rr__server-link" @click="navigateToServer(roundReport.round.serverName)">
              {{ roundReport.round.serverName }}
            </a>
            <span class="mm-meta-row__sep">·</span>
            <span>{{ roundReport.round.totalParticipants }} players</span>
            <span v-if="roundReport.round.isActive" class="mm-meta-row__sep">·</span>
            <span v-if="roundReport.round.isActive" class="mm-chip" style="margin-left: 4px">
              <span class="mm-chip__dot" />
              Live
            </span>
          </div>
        </div>

        <div v-if="shouldShowTickets" class="mm-rr__tickets">
          <div class="mm-rr__ticket-team">
            <div class="mm-eyebrow">{{ roundReport.round.team1Label || 'Team 1' }}</div>
            <div class="mm-stat__value">{{ roundReport.round.tickets1 }}</div>
          </div>
          <div class="mm-rr__ticket-sep">vs</div>
          <div class="mm-rr__ticket-team">
            <div class="mm-eyebrow">{{ roundReport.round.team2Label || 'Team 2' }}</div>
            <div class="mm-stat__value">{{ roundReport.round.tickets2 }}</div>
          </div>
        </div>
      </header>

      <hr class="mm-rule" style="margin: 24px 0" />

      <!-- Round summary stats + MVP -->
      <section v-if="roundSummary" class="mm-rr__section">
        <MmBattleSummary :summary="roundSummary" />
      </section>

      <!-- Playback controls -->
      <MmPlaybackControls
        :is-playing="isPlaying"
        :playback-speed="playbackSpeed"
        :selected-snapshot-index="visibleEventIndex"
        :total-snapshots="batchUpdateEvents.length"
        :current-elapsed-time="currentElapsedTime"
        :snapshot-timeline="snapshotTimeline"
        @toggle-playback="togglePlayback"
        @reset-playback="resetPlayback"
        @set-playback-speed="setPlaybackSpeed"
        @start-drag="startDrag"
        @handle-dot-click="handleDotClick"
      />

      <!-- Main dashboard: console + ladder -->
      <div class="mm-rr__dashboard">
        <!-- Left: console / visualizer -->
        <section class="mm-rr__panel mm-rr__panel--console">
          <header class="mm-rr__panel-head">
            <div class="mm-eyebrow mm-eyebrow--strong">Battle feed</div>
            <div class="mm-rr__panel-controls">
              <input
                v-model="trackedPlayer"
                type="text"
                placeholder="Pin a player…"
                class="mm-rr__pin-input"
              />
              <div class="mm-subtabs">
                <button
                  type="button"
                  class="mm-subtab"
                  :class="{ 'mm-subtab--active': !showGraphicalView }"
                  @click="showGraphicalView = false"
                >Console</button>
                <button
                  type="button"
                  class="mm-subtab"
                  :class="{ 'mm-subtab--active': showGraphicalView }"
                  @click="showGraphicalView = true"
                >Visualizer</button>
              </div>
            </div>
          </header>

          <div class="mm-rr__panel-filters">
            <label>
              <input v-model="displayFilters.showJoinEvents" type="checkbox" />
              <span>Joins</span>
            </label>
            <label>
              <input v-model="displayFilters.showDeathEvents" type="checkbox" />
              <span>Deaths</span>
            </label>
            <label>
              <input v-model="displayFilters.highlightsOnly" type="checkbox" />
              <span>Highlights only</span>
            </label>
          </div>

          <MmBattleVisualizer
            v-if="showGraphicalView"
            :round-report="roundReport"
            :battle-events="battleEvents"
            :current-time-index="visibleEventIndex"
            :batch-update-events="batchUpdateEvents"
            :tracked-player="trackedPlayer"
            :round-summary="roundSummary"
          />

          <div v-else ref="consoleElement" class="mm-rr__console">
            <div
              v-for="(event, idx) in visibleEventsReversed"
              :key="`${event.timestamp}-${idx}`"
              :class="eventRowClass(event, idx)"
            >
              <span class="mm-rr__line-time">{{ formatTimeOffset(event.timestamp) }}</span>
              <span class="mm-rr__line-msg">{{ event.message }}</span>
            </div>
            <div v-if="visibleEventsReversed.length === 0" class="mm-empty" style="border: 0">
              No events at this moment.
            </div>
          </div>
        </section>

        <!-- Right: live ladder -->
        <section class="mm-rr__panel mm-rr__panel--ladder">
          <header class="mm-rr__panel-head">
            <div class="mm-eyebrow mm-eyebrow--strong">Ladder</div>
            <div class="mm-subtabs">
              <button
                type="button"
                class="mm-subtab"
                :class="{ 'mm-subtab--active': showLiveLadder }"
                @click="showLiveLadder = true"
              >Live</button>
              <button
                type="button"
                class="mm-subtab"
                :class="{ 'mm-subtab--active': !showLiveLadder }"
                @click="showLiveLadder = false"
              >Final</button>
            </div>
          </header>

          <div class="mm-rr__ladder">
            <div
              v-for="team in teamGroups"
              :key="team.teamName"
              class="mm-rr__team"
            >
              <div class="mm-eyebrow mm-eyebrow--strong mm-rr__team-head">
                <span>{{ team.teamName }}</span>
                <span class="mm-meta-row__sep">·</span>
                <span>{{ team.totalScore }} pts</span>
              </div>
              <table class="mm-list mm-list--dense">
                <thead>
                  <tr>
                    <th class="mm-list__rank">#</th>
                    <th>Player</th>
                    <th class="is-num">Score</th>
                    <th class="is-num">K / D</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="p in team.players"
                    :key="p.playerName"
                    @click="navigateToPlayerProfile(p.playerName)"
                  >
                    <td class="mm-list__rank">{{ p.rank }}</td>
                    <td class="mm-list__name-cell">
                      <div class="mm-list__name">
                        <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                      </div>
                    </td>
                    <td class="is-num" data-cell-label="Score">{{ p.score }}</td>
                    <td class="is-num" :class="kdClass(p.deaths > 0 ? p.kills / p.deaths : p.kills)" data-cell-label="K / D">
                      <span class="mm-num--kill">{{ p.kills }}</span>
                      <span class="mm-num__sep">/</span>
                      <span class="mm-num--death">{{ p.deaths }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <!-- Key events highlights row -->
      <section v-if="visibleHighlights.length > 0" class="mm-rr__highlights">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Tactical intelligence</div>
        <div class="mm-rr__highlights-grid">
          <MmBattleHighlight
            v-for="(h, i) in visibleHighlights"
            :key="`${h.timestamp}-${i}`"
            :highlight="h"
            :format-time-offset="formatTimeOffset"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mm-rr__state { padding: 24px 0; }

.mm-rr__back {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.mm-rr__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.mm-rr__head-text { min-width: 0; }
.mm-rr__title { margin: 4px 0 0; }

.mm-rr__server-link {
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.mm-rr__tickets {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
}

.mm-rr__ticket-team { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mm-rr__ticket-sep {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.mm-rr__section { padding: 6px 0 14px; }

.mm-rr__dashboard {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  margin-top: 16px;
}

.mm-rr__panel {
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mm-rr__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mm-rule);
  flex-wrap: wrap;
}

.mm-rr__panel-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mm-rr__pin-input {
  font-family: var(--mm-font-display);
  font-size: 12px;
  padding: 4px 10px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 999px;
  color: var(--mm-ink);
  min-width: 140px;
}

.mm-rr__pin-input:focus {
  outline: 0;
  border-color: var(--mm-ink);
}

.mm-rr__panel-filters {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.mm-rr__panel-filters label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.mm-rr__console {
  flex: 1;
  max-height: 540px;
  overflow-y: auto;
  padding: 4px 0;
}

.mm-rr__line {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 12px;
  padding: 5px 16px;
  border-bottom: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  color: var(--mm-ink);
  align-items: baseline;
  transition: background-color 0.4s ease;
}

.mm-rr__line:last-child { border-bottom: 0; }

.mm-rr__line-time {
  color: var(--mm-ink-muted);
  font-variant-numeric: tabular-nums;
}

.mm-rr__line-msg { line-height: 1.45; }

.mm-rr__line--new { background: rgba(125, 136, 73, 0.18); }
.mm-rr__line--tracked {
  background: rgba(125, 136, 73, 0.08);
  border-left: 2px solid var(--mm-accent);
  padding-left: 14px;
}
.mm-rr__line--highlight { background: rgba(125, 136, 73, 0.10); }

.mm-rr__ladder {
  flex: 1;
  max-height: 580px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 0;
}

.mm-rr__team-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 16px 8px;
}

.mm-rr__highlights { padding: 24px 0; }

.mm-rr__highlights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

@media (max-width: 880px) {
  .mm-rr__dashboard { grid-template-columns: 1fr; }
  .mm-rr__head { flex-direction: column; }
}
</style>
