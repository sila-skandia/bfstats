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
import MmBattleVisualizer from './round-report/MmBattleVisualizer.vue'
import MmPlaybackControls from './round-report/MmPlaybackControls.vue'
import MmMapThumb from './MmMapThumb.vue'
import MmMapDossier from './MmMapDossier.vue'
import { BfLoadingBar } from '@/components/common'
import { kdClass } from '@/views/v4/mmTokens'

const router = useRouter()

interface Props {
  roundId: string
  players?: string
  openInNewTab?: boolean
}

const props = defineProps<Props>()

const roundReport = ref<RoundReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const showBriefing = ref(false)
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

const isEmptyRound = computed(() => {
  if (!roundReport.value) return false
  if (roundReport.value.round?.totalParticipants === 0) return true
  const snaps = roundReport.value.leaderboardSnapshots
  if (!snaps || snaps.length === 0) return true
  return snaps.every(s => !s.entries || s.entries.length === 0)
})

const fetchData = async () => {
  if (!props.roundId) return
  loading.value = true
  error.value = null
  try {
    const data = await fetchRoundReport(props.roundId)
    roundReport.value = data
    updatePageTitle()

    // Show briefing by default for empty rounds; collapse by default when there are players to get straight to match replay
    showBriefing.value = isEmptyRound.value

    if (!isEmptyRound.value) {
      processBattleReport()
      visibleEventIndex.value = batchUpdateEvents.value.length - 1
      if (props.players) trackedPlayer.value = props.players
    }
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
  if (props.openInNewTab && typeof window !== 'undefined') {
    window.open(`/v4/players/${encodeURIComponent(playerName)}`, '_blank', 'noopener,noreferrer')
    return
  }
  router.push(`/v4/players/${encodeURIComponent(playerName)}`)
}

const navigateToServer = (serverName?: string) => {
  if (!serverName) return
  if (props.openInNewTab && typeof window !== 'undefined') {
    window.open(`/v4/servers/detail/${encodeURIComponent(serverName)}`, '_blank', 'noopener,noreferrer')
    return
  }
  router.push(`/v4/servers/detail/${encodeURIComponent(serverName)}`)
}

const shouldShowTickets = computed(() => {
  if (!roundReport.value?.round) return false
  const { tickets1 } = roundReport.value.round
  return tickets1 !== null && tickets1 !== undefined && tickets1 >= 0
})

const visibleHighlights = computed(() => {
  if (!battleHighlights.value.length || !batchUpdateEvents.value.length) return []
  if (visibleEventIndex.value >= batchUpdateEvents.value.length - 1) {
    return battleHighlights.value
  }
  const currentBatch = batchUpdateEvents.value[visibleEventIndex.value]
  if (!currentBatch) return []
  const cutoff = new Date(currentBatch.timestamp).getTime()
  return battleHighlights.value.filter(h => new Date(h.timestamp).getTime() <= cutoff)
})

interface PlayerBadge {
  id: string
  icon: string
  label: string
  title: string
}

const playerBadgesMap = computed(() => {
  const map = new Map<string, PlayerBadge[]>()
  if (!roundReport.value) return map

  const sourceHighlights = showLiveLadder.value ? visibleHighlights.value : battleHighlights.value

  // 1. MVP
  const mvpHighlight = sourceHighlights.find(h => h.type === 'mvp')
  const mvpPlayer = mvpHighlight?.playerName || (!showLiveLadder.value ? roundSummary.value?.mvp?.playerName : null)
  if (mvpPlayer) {
    if (!map.has(mvpPlayer)) map.set(mvpPlayer, [])
    map.get(mvpPlayer)!.push({
      id: 'mvp',
      icon: '🏆',
      label: 'MVP',
      title: 'Round MVP',
    })
  }

  // 2. First Blood
  const fb = sourceHighlights.find(h => h.type === 'first_blood')
  if (fb && fb.playerName) {
    if (!map.has(fb.playerName)) map.set(fb.playerName, [])
    map.get(fb.playerName)!.push({
      id: 'first_blood',
      icon: '🩸',
      label: 'First Blood',
      title: `${fb.playerName} drew first blood`,
    })
  }

  // 3. Best Killing Spree
  const sprees = new Map<string, { maxStreak: number; icon: string }>()
  for (const h of sourceHighlights) {
    if (h.type === 'killing_spree' && typeof h.value === 'number') {
      const current = sprees.get(h.playerName)
      if (!current || h.value > current.maxStreak) {
        sprees.set(h.playerName, { maxStreak: h.value, icon: h.icon || '🔥' })
      }
    }
  }
  for (const [pName, spree] of sprees.entries()) {
    if (!map.has(pName)) map.set(pName, [])
    map.get(pName)!.push({
      id: 'spree',
      icon: spree.icon,
      label: `${spree.maxStreak} Streak`,
      title: `${spree.maxStreak} kill streak`,
    })
  }

  return map
})

const getPlayerBadges = (playerName: string): PlayerBadge[] => {
  return playerBadgesMap.value.get(playerName) || []
}

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
    <div v-if="loading" class="mm-rr__state" style="padding: 48px 0; text-align: center;">
      <BfLoadingBar
        indeterminate
        style="max-width: 500px; margin: 0 auto 24px;"
      />
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
        <div class="mm-rr__head-main">
          <button
            type="button"
            class="mm-rr__map-btn"
            :title="showBriefing ? 'Hide level briefing' : 'Show level briefing'"
            @click="showBriefing = !showBriefing"
          >
            <MmMapThumb
              class="mm-rr__map"
              :game-id="roundReport.round.gameId"
              :map-name="roundReport.round.mapName"
              kind="minimap"
              :width="112"
            />
          </button>
          <div class="mm-rr__head-text">
            <div class="mm-eyebrow mm-eyebrow--strong">{{ roundReport.round.gameType }}</div>
            <h1 class="mm-display mm-rr__title">{{ roundReport.round.mapName }}</h1>
            <div class="mm-meta-row" style="margin-top: 8px">
              <a class="mm-meta-row__strong mm-rr__server-link" @click="navigateToServer(roundReport.round.serverName)">
                {{ $pn(roundReport.round.serverName) }}
              </a>
              <span class="mm-meta-row__sep">·</span>
              <span>{{ roundReport.round.totalParticipants }} players</span>
              <span v-if="roundReport.round.isActive" class="mm-meta-row__sep">·</span>
              <span v-if="roundReport.round.isActive" class="mm-chip" style="margin-left: 4px">
                <span class="mm-chip__dot" />
                Live
              </span>
              <span class="mm-meta-row__sep">·</span>
              <button
                type="button"
                class="mm-rr__briefing-toggle-btn"
                @click="showBriefing = !showBriefing"
              >
                {{ showBriefing ? 'Hide briefing ↑' : 'Map briefing ↓' }}
              </button>
            </div>
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

      <!-- Level Briefing & Tactical Intelligence Section -->
      <section class="mm-card mm-map-briefing-panel">
        <header class="mm-map-briefing-panel__head">
          <div>
            <div class="mm-eyebrow mm-eyebrow--strong">Level Briefing &amp; Spawn Points</div>
            <p class="mm-card__hint">
              Control points, order of battle, and vehicle arsenal from level archives
            </p>
          </div>

          <button
            type="button"
            class="mm-btn mm-btn--inline"
            @click="showBriefing = !showBriefing"
          >
            {{ showBriefing ? '[HIDE BRIEFING ↑]' : '[SHOW BRIEFING ↓]' }}
          </button>
        </header>

        <div
          v-if="showBriefing"
          class="mm-map-briefing-panel__body"
        >
          <MmMapDossier
            :key="`${roundReport.round.gameId || 'bf1942'}/${roundReport.round.mapName}`"
            :game-id="roundReport.round.gameId || 'bf1942'"
            :map-name="roundReport.round.mapName"
            :live-tickets="shouldShowTickets ? { tickets1: roundReport.round.tickets1, tickets2: roundReport.round.tickets2 } : null"
            :is-live="roundReport.round.isActive"
            show-placeholders
            hide-heading
          />
        </div>
      </section>

      <!-- Empty round message (replaces interactive round controls & console) -->
      <div v-if="isEmptyRound" class="mm-empty" style="margin: 24px 0">
        This round was empty — no players participated.
      </div>

      <template v-else>
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

            <!-- Visualizer canvas mode -->
            <div v-if="showGraphicalView" class="mm-rr__visualizer">
              <MmBattleVisualizer
                :round-report="roundReport"
                :battle-events="battleEvents"
                :current-time-index="visibleEventIndex"
                :batch-update-events="batchUpdateEvents"
                :tracked-player="trackedPlayer"
                :round-summary="roundSummary"
              />
            </div>

            <!-- Console mode -->
            <div v-else ref="consoleElement" class="mm-rr__console">
              <div
                v-for="(event, i) in visibleEventsReversed"
                :key="`${event.timestamp}-${i}`"
                :class="eventRowClass(event, visibleEventsReversed.length - 1 - i)"
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
                          <span class="mm-list__name-primary mm-rr__player-name">
                            <span class="mm-rr__player-name-text">{{ $pn(p.playerName) }}</span>
                            <span
                              v-for="badge in getPlayerBadges(p.playerName)"
                              :key="badge.id"
                              class="mm-player-badge"
                              :class="`mm-player-badge--${badge.id}`"
                              :title="badge.title"
                            >
                              <span class="mm-player-badge__icon">{{ badge.icon }}</span>
                              <span class="mm-player-badge__label">{{ badge.label }}</span>
                            </span>
                          </span>
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
      </template>
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
}

.mm-rr__head-main {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  min-width: 0;
  flex: 1 1 auto;
}

.mm-rr__head-text { min-width: 0; flex: 1 1 auto; }
.mm-rr__title { margin: 4px 0 0; }

/* The minimap sits ahead of the title, not in the ticket group, so the header
   still reads title-first when the map has no art and nothing renders. */
.mm-rr__map { margin-top: 2px; }

.mm-rr__map-btn {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  display: block;
  line-height: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.mm-rr__map-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.mm-rr__briefing-toggle-btn {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: var(--mm-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.mm-rr__briefing-toggle-btn:hover {
  color: var(--mm-accent-hover, var(--mm-accent));
}

.mm-map-briefing-panel {
  background: var(--mm-surface);
  border: 1px solid var(--mm-border);
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.mm-map-briefing-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-map-briefing-panel__body {
  padding-top: 8px;
}

@media (max-width: 720px) {
  .mm-map-briefing-panel {
    padding: 16px;
  }
}

@media (max-width: 640px) {
  .mm-rr__head-main { gap: 14px; }
  .mm-rr__map { width: 72px !important; height: 72px !important; }
}

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

.mm-rr__player-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mm-rr__player-name-text {
  white-space: nowrap;
}

.mm-player-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule-strong);
  background: var(--mm-surface-2, rgba(255, 255, 255, 0.05));
  color: var(--mm-ink);
  line-height: 1.35;
  white-space: nowrap;
  vertical-align: middle;
}

.mm-player-badge--mvp {
  border-color: rgba(234, 179, 8, 0.45);
  background: rgba(234, 179, 8, 0.12);
  color: #fbbf24;
}

.mm-player-badge--first_blood {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.mm-player-badge--spree {
  border-color: rgba(249, 115, 22, 0.45);
  background: rgba(249, 115, 22, 0.12);
  color: #fb923c;
}

.mm-player-badge__icon {
  font-size: 10px;
  line-height: 1;
}

.mm-player-badge__label {
  text-transform: uppercase;
}

@media (max-width: 880px) {
  .mm-rr__dashboard { grid-template-columns: 1fr; }
  .mm-rr__head {
    flex-direction: column;
    gap: 16px;
  }
}
</style>
