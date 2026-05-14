<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchSessions } from '@/services/playerStatsApi'
import { formatRelativeTimeShort as formatRelativeTime } from '@/utils/timeUtils'

interface ServerMapSession {
  roundId: string
  serverName: string
  serverGuid: string
  mapName: string
  gameType: string
  startTime: string
  endTime: string
  durationMinutes: number
  participantCount: number
  totalSessions: number
  isActive: boolean
  team1Label?: string
  team2Label?: string
  team1Points?: number
  team2Points?: number
  roundTimeRemain?: number
  topPlayers?: Array<{
    playerName: string
    score: number
    kills: number
    deaths: number
  }>
}

const props = defineProps<{
  serverGuid?: string
  serverName?: string
  mapName?: string
  limit?: number
  emptyMessage?: string
  initialVisibleCount?: number
  filters?: Record<string, string>
}>()

const router = useRouter()
const sessions = ref<ServerMapSession[]>([])
const isLoadingSessions = ref(false)
const sessionsError = ref<string | null>(null)
const isExpanded = ref(false)

const filtersKey = computed(() => {
  if (!props.filters) return ''
  const entries = Object.entries(props.filters)
    .map(([k, v]) => [k, v])
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries)
})

const visibleSessions = computed(() => {
  if (props.initialVisibleCount && !isExpanded.value) {
    return sessions.value.slice(0, props.initialVisibleCount)
  }
  return sessions.value
})

const hasMoreSessions = computed(() => {
  return props.initialVisibleCount && sessions.value.length > props.initialVisibleCount
})

const toggleExpand = () => { isExpanded.value = !isExpanded.value }

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
}

const navigateToRoundReport = (session: ServerMapSession) => {
  router.push(`/v4/rounds/${encodeURIComponent(session.roundId)}/report`)
}

const goSessions = () => {
  if (!props.serverName) return
  const query: Record<string, string> = {}
  if (props.mapName) query.mapName = props.mapName
  router.push({
    path: `/v4/servers/${encodeURIComponent(props.serverName)}/sessions`,
    query,
  })
}

const loadSessions = async () => {
  if (!props.serverGuid) return
  isLoadingSessions.value = true
  sessionsError.value = null
  try {
    const filters: Record<string, string> = { serverGuid: props.serverGuid }
    if (props.mapName) filters.mapName = props.mapName
    if (props.filters) {
      Object.entries(props.filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') filters[k] = v
      })
    }
    const response = await fetchSessions(1, props.limit || 5, filters, 'startTime', 'desc')
    sessions.value = response.items as unknown as ServerMapSession[]
  } catch (err) {
    console.error('Error loading sessions:', err)
    sessionsError.value = 'Failed to load sessions'
  } finally {
    isLoadingSessions.value = false
  }
}

onMounted(loadSessions)
watch(() => props.serverGuid, loadSessions)
watch(() => props.mapName, loadSessions)
watch(filtersKey, loadSessions)
</script>

<template>
  <section class="mm-rsl">
    <div v-if="isLoadingSessions" class="mm-rsl__state">
      <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 8px" />
    </div>

    <div v-else-if="sessionsError" class="mm-empty">
      {{ sessionsError }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadSessions">Retry</button>
    </div>

    <div v-else-if="sessions.length === 0" class="mm-empty">
      {{ emptyMessage || 'No recent sessions.' }}
    </div>

    <template v-else>
      <table class="mm-list">
        <thead>
          <tr>
            <th>Map · server</th>
            <th>Team matchup</th>
            <th>Top players</th>
            <th class="is-num">Players</th>
            <th class="is-num">Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(session, index) in visibleSessions"
            :key="session.roundId"
            @click="navigateToRoundReport(session)"
          >
            <td class="mm-list__name-cell">
              <div class="mm-list__name">
                <span class="mm-list__name-primary">
                  {{ session.mapName }}
                  <span
                    v-if="session.isActive && index === 0"
                    class="mm-chip"
                    style="margin-left: 6px"
                  >
                    <span class="mm-chip__dot" />Live
                  </span>
                </span>
                <span class="mm-list__name-sub">{{ session.serverName }} · {{ formatRelativeTime(session.startTime) }} ago</span>
              </div>
            </td>
            <td data-cell-label="Matchup">
              <template v-if="session.team1Label && session.team2Label && session.team1Points !== undefined && session.team2Points !== undefined">
                <div>
                  <span class="mm-list__name-sub" style="text-transform: none">{{ session.team1Label }}</span>
                  <span class="mm-num--score" style="margin-left: 6px; font-family: var(--mm-font-mono)">{{ session.team1Points }}</span>
                </div>
                <div>
                  <span class="mm-list__name-sub" style="text-transform: none">{{ session.team2Label }}</span>
                  <span class="mm-num--score" style="margin-left: 6px; font-family: var(--mm-font-mono)">{{ session.team2Points }}</span>
                </div>
              </template>
              <span v-else class="is-muted">—</span>
            </td>
            <td data-cell-label="Top players">
              <template v-if="session.topPlayers && session.topPlayers.length > 0">
                <div
                  v-for="p in session.topPlayers.slice(0, 2)"
                  :key="p.playerName"
                  class="mm-list__name-sub"
                  style="text-transform: none"
                >
                  <span style="color: var(--mm-ink)">{{ $pn(p.playerName) }}</span>
                  <span class="mm-meta-row__sep">·</span>
                  <span class="mm-num--kill">{{ p.kills }}</span>
                  <span class="mm-num__sep">/</span>
                  <span class="mm-num--death">{{ p.deaths }}</span>
                </div>
              </template>
              <span v-else class="is-muted">—</span>
            </td>
            <td class="is-num" data-cell-label="Players">{{ session.participantCount }}</td>
            <td class="is-num is-muted" data-cell-label="Duration">{{ formatDuration(session.durationMinutes) }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="hasMoreSessions || serverName" class="mm-rsl__foot">
        <button v-if="hasMoreSessions" type="button" class="mm-btn mm-btn--inline" @click="toggleExpand">
          {{ isExpanded ? 'Collapse' : `Show all ${sessions.length}` }}
        </button>
        <button v-if="serverName" type="button" class="mm-btn mm-btn--inline" @click="goSessions">
          Full session history →
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.mm-rsl__state { padding: 14px 0; }

.mm-rsl__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 0 0;
}
</style>
