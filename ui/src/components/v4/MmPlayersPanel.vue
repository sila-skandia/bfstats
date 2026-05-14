<template>
  <div
    v-if="show"
    class="mm-roster"
    :class="{ 'mm-roster--inline': inline, 'mm-roster--modal': !inline, 'mm-roster--embedded': embedded }"
    :tabindex="!inline ? -1 : undefined"
    :role="!inline ? 'dialog' : undefined"
    aria-label="Player roster"
    @click.self="!inline && $emit('close')"
    @keydown.esc="!inline && $emit('close')"
  >
    <div class="mm-roster__panel" @click.stop>
      <header v-if="!embedded" class="mm-roster__head">
        <div class="mm-roster__head-text">
          <div class="mm-eyebrow">
            <span class="mm-chip">
              <span class="mm-chip__dot" />
              Live roster
            </span>
            <span class="mm-eyebrow" style="margin-left: 10px">{{ totalPlayers }} engaged</span>
          </div>
          <h2 class="mm-h2 mm-roster__name">{{ server?.name || 'Unknown server' }}</h2>
          <div v-if="server?.mapName || hasRoundTime" class="mm-meta-row" style="margin-top: 6px">
            <span v-if="server?.mapName" class="mm-meta-row__strong">{{ server.mapName }}</span>
            <span v-if="server?.mapName && hasRoundTime" class="mm-meta-row__sep">·</span>
            <span v-if="hasRoundTime">{{ formatTimeRemaining(server!.roundTimeRemain!) }} left</span>
          </div>
        </div>
        <button
          v-if="!inline"
          type="button"
          class="mm-roster__close"
          aria-label="Close roster"
          @click.stop="$emit('close')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <hr v-if="!embedded" class="mm-rule" />

      <!-- Compact context strip: map + game type only. The fuller stat strip
           (Engaged / Top score / Kills / Avg ping) used to live here but was
           pulling too much real estate; the same numbers are derivable from
           the team tables below. -->
      <div
        v-if="hasRoster && totalPlayers > 0 && (server?.mapName || server?.gameType)"
        class="mm-roster__context"
      >
        <span v-if="server?.mapName" class="mm-eyebrow mm-eyebrow--strong">{{ server.mapName }}</span>
        <span v-if="server?.mapName && server?.gameType" class="mm-meta-row__sep">·</span>
        <span v-if="server?.gameType" class="mm-eyebrow">{{ server.gameType }}</span>
        <span v-if="hasRoundTime" class="mm-meta-row__sep">·</span>
        <span v-if="hasRoundTime" class="mm-eyebrow">{{ formatTimeRemaining(server!.roundTimeRemain!) }} left</span>
      </div>

      <div v-if="hasRoster && totalPlayers > 0" class="mm-roster__sort">
        <span class="mm-eyebrow">Sort</span>
        <button
          v-for="f in sortFields"
          :key="f.id"
          type="button"
          class="mm-subtab"
          :class="{ 'mm-subtab--active': playerSortField === f.id }"
          @click="sortPlayersBy(f.id)"
        >
          {{ f.label }}
          <span v-if="playerSortField === f.id" class="mm-roster__sort-dir">
            {{ playerSortDirection === 'asc' ? '↑' : '↓' }}
          </span>
        </button>
      </div>

      <div v-if="hasRoster && totalPlayers > 0" class="mm-roster__teams">
        <section
          v-for="team in server!.teams"
          :key="team.index"
          class="mm-roster__team"
        >
          <div class="mm-eyebrow mm-eyebrow--strong mm-roster__team-head">
            <span>{{ team.label || `Team ${team.index}` }}</span>
            <span class="mm-meta-row__sep">·</span>
            <span>{{ getTeamPlayerCount(team.index) }} engaged</span>
            <template v-if="getTeamMvpName(team.index)">
              <span class="mm-meta-row__sep">·</span>
              <span>MVP {{ $pn(getTeamMvpName(team.index)!) }}</span>
            </template>
          </div>

          <table v-if="getTeamPlayerCount(team.index) > 0" class="mm-list mm-list--dense">
            <thead>
              <tr>
                <th class="mm-list__rank">#</th>
                <th>Player</th>
                <th class="is-num">Score</th>
                <th class="is-num">K / D</th>
                <th class="is-num">Ping</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(player, pidx) in getSortedTeamPlayers(team.index)"
                :key="player.name"
                @click="navigateToPlayerProfile(player.name)"
              >
                <td class="mm-list__rank" data-cell-label="#">{{ pidx + 1 }}</td>
                <td class="mm-list__name-cell">
                  <div class="mm-list__name">
                    <span class="mm-list__name-primary">{{ $pn(player.name) }}</span>
                  </div>
                </td>
                <td class="is-num" :class="scoreTint(player.score)" data-cell-label="Score">{{ player.score }}</td>
                <td class="is-num" data-cell-label="K / D">
                  <span class="mm-num--kill">{{ player.kills }}</span>
                  <span class="mm-num__sep">/</span>
                  <span class="mm-num--death">{{ player.deaths }}</span>
                </td>
                <td class="is-num" :class="pingTint(player.ping)" data-cell-label="Ping">{{ player.ping }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="mm-empty">No players on this team</div>
        </section>
      </div>

      <div v-else-if="!hasRoster" class="mm-empty">Roster unavailable</div>
      <div v-else class="mm-empty">No players online</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { ServerSummary } from '@/types/server'
import { formatTimeRemaining } from '@/utils/timeUtils'

interface Props {
  show: boolean
  server: ServerSummary | null
  inline?: boolean
  embedded?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  inline: false,
  embedded: false,
})

defineEmits<{ close: [] }>()

const router = useRouter()

type SortField = 'name' | 'score' | 'kills' | 'deaths' | 'ping'
const playerSortField = ref<SortField>('score')
const playerSortDirection = ref<'asc' | 'desc'>('desc')

const sortFields: { id: SortField; label: string }[] = [
  { id: 'score', label: 'Score' },
  { id: 'kills', label: 'Kills' },
  { id: 'deaths', label: 'Deaths' },
  { id: 'ping', label: 'Ping' },
  { id: 'name', label: 'Name' },
]

const hasRoster = computed(() => !!(props.server?.teams && props.server.teams.length > 0))
const hasRoundTime = computed(() =>
  props.server?.roundTimeRemain !== undefined && props.server.roundTimeRemain !== -1,
)

const totalPlayers = computed(() => props.server?.players?.length ?? 0)

const navigateToPlayerProfile = (playerName: string) => {
  router.push(`/v4/players/${encodeURIComponent(playerName)}`)
}

const scoreTint = (score: number) => {
  if (score >= 100) return 'mm-kd--elite'
  if (score >= 50) return 'mm-kd--good'
  if (score >= 25) return 'mm-kd--mid'
  return 'mm-kd--low'
}

const pingTint = (ping: number) => {
  if (ping === 0) return 'is-muted'
  if (ping <= 60) return 'mm-num--score'
  if (ping <= 120) return 'mm-kd--low'
  if (ping <= 200) return 'mm-num--kill'
  return 'mm-num--load-full'
}

const sortPlayersBy = (field: SortField) => {
  if (playerSortField.value === field) {
    playerSortDirection.value = playerSortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    playerSortField.value = field
    playerSortDirection.value = field === 'name' || field === 'ping' ? 'asc' : 'desc'
  }
}

const getTeamPlayerCount = (teamIndex: number) =>
  (props.server?.players ?? []).filter(p => p.team === teamIndex).length

const getTeamMvpName = (teamIndex: number): string | null => {
  const players = (props.server?.players ?? []).filter(p => p.team === teamIndex)
  if (players.length === 0) return null
  const top = players.reduce((best, p) => (p.score > best.score ? p : best), players[0])
  return top.score > 0 ? top.name : null
}

const getSortedTeamPlayers = (teamIndex: number) => {
  const players = (props.server?.players ?? []).filter(p => p.team === teamIndex)
  const field = playerSortField.value
  const dir = playerSortDirection.value
  return [...players].sort((a, b) => {
    let aVal: string | number
    let bVal: string | number
    switch (field) {
      case 'name':
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
        break
      case 'score':
        aVal = a.score
        bVal = b.score
        break
      case 'kills':
        aVal = a.kills
        bVal = b.kills
        break
      case 'deaths':
        aVal = a.deaths
        bVal = b.deaths
        break
      case 'ping':
        aVal = a.ping
        bVal = b.ping
        break
    }
    if (aVal < bVal) return dir === 'asc' ? -1 : 1
    if (aVal > bVal) return dir === 'asc' ? 1 : -1
    return 0
  })
}
</script>

<style scoped>
.mm-roster--modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(26, 26, 26, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.mm-roster--inline {
  display: block;
}

.mm-roster__panel {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  width: 100%;
  max-width: 1040px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 20px 24px;
  color: var(--mm-ink);
}

.mm-roster--inline .mm-roster__panel {
  border: 0;
  border-radius: 0;
  padding: 0;
  max-width: none;
  max-height: none;
  overflow-y: visible;
}

.mm-roster--embedded .mm-roster__panel {
  border: 0;
  border-radius: 0;
  padding: 0;
  max-width: none;
}

.mm-roster__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
}

.mm-roster__head-text {
  min-width: 0;
}

.mm-roster__name {
  margin: 6px 0 0 0;
}

.mm-roster__close {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 999px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.mm-roster__close:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink);
}

.mm-roster__context {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 0 6px;
}

.mm-roster__sort {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 0 8px;
}

.mm-roster__sort .mm-eyebrow {
  margin-right: 4px;
}

.mm-roster__sort-dir {
  margin-left: 4px;
  font-family: var(--mm-font-mono);
}

.mm-roster__teams {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 24px;
  padding-top: 8px;
}

.mm-roster__team {
  min-width: 0;
}

.mm-roster__team-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 8px;
  font-size: 9.5px;
}

/* Desktop / tablet — condense the player tables so two columns fit
   comfortably. These :deep overrides intentionally only apply above the
   global table-to-card breakpoint (720px). Below that, the global
   .mm-list mobile rules in modern-minimal.css collapse each row into a
   labeled grid card — we MUST NOT override the cell padding/font on
   mobile or the collapse breaks and the roster reads as a cramped
   half-table. */
@media (min-width: 721px) {
  .mm-roster__teams :deep(.mm-list thead th) {
    padding: 6px 8px;
    font-size: 9px;
    letter-spacing: 0.1em;
  }

  .mm-roster__teams :deep(.mm-list tbody td) {
    padding: 8px 8px;
    font-size: 12px;
  }

  .mm-roster__teams :deep(.mm-list td.is-num) {
    font-size: 11px;
  }

  .mm-roster__teams :deep(.mm-list .mm-list__rank) {
    width: 22px;
    font-size: 10px;
  }

  .mm-roster__teams :deep(.mm-list__name-primary) {
    font-size: 12.5px;
  }
}

@media (max-width: 900px) {
  .mm-roster__teams {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
}

@media (max-width: 720px) {
  /* Tighter row cards on mobile — the global .mm-list rule lays them out
     as labeled grids; here we just trim padding and surface a hairline
     between rows so the roster reads as a continuous list, not a
     stack of separated cards. */
  .mm-roster__teams :deep(.mm-list tbody tr) {
    padding: 10px 0;
    border-bottom: 1px solid var(--mm-rule);
  }
  .mm-roster__teams :deep(.mm-list tbody tr:last-child) {
    border-bottom: 0;
  }
  .mm-roster__team-head {
    padding-left: 0;
  }
  .mm-roster__sort {
    overflow-x: auto;
    scrollbar-width: none;
    flex-wrap: nowrap;
  }
  .mm-roster__sort::-webkit-scrollbar { display: none; }
  .mm-roster__sort button { flex-shrink: 0; }
}

@media (max-width: 720px) {
  .mm-roster--modal {
    padding: 0;
    align-items: stretch;
  }
  .mm-roster__panel {
    max-width: 100%;
    max-height: 100vh;
    border: 0;
    border-radius: 0;
    padding: 16px 18px;
  }
  .mm-roster__sort {
    overflow-x: auto;
    flex-wrap: nowrap;
  }
}
</style>
