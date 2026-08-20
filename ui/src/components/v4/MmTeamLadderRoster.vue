<template>
  <div
    class="lb-inline-roster"
    :class="{ 'lb-inline-roster--table': tableEmbed }"
  >
    <div v-if="server.players && server.players.length > 0" class="lb-roster-teams">
      <div
        v-for="teamIdx in [1, 2]"
        :key="teamIdx"
        class="lb-roster-team-card"
        :class="teamIdx === 1 ? 'lb-roster-team--axis' : 'lb-roster-team--allies'"
        :data-testid="teamIdx === 1 ? 'roster-team-axis' : 'roster-team-allies'"
      >
        <div class="lb-team-strip">
          <span class="lb-team-name">{{ getTeamLabel(teamIdx) }}</span>
          <span class="lb-team-tickets-plain">{{ getTeamTickets(teamIdx) }}</span>
        </div>

        <div class="lb-player-list">
          <div class="lb-player-list-head">
            <span class="lb-pcol-name">Playername</span>
            <span class="lb-player-stats">
              <span class="lb-pcol-score"><MmStatColIcon name="score" label="Score" /></span>
              <span class="lb-pcol-kd"><MmStatColIcon name="kills" label="Kills" /></span>
              <span class="lb-pcol-kd"><MmStatColIcon name="deaths" label="Deaths" /></span>
              <span class="lb-pcol-ping"><MmStatColIcon name="ping" label="Ping" /></span>
            </span>
          </div>

          <div
            v-for="player in getSortedTeamPlayers(teamIdx)"
            :key="player.name"
            class="lb-player-item"
            :class="{
              'lb-player-item--axis': teamIdx === 1,
              'lb-player-item--allies': teamIdx === 2
            }"
            @click.stop="navigateToPlayerProfile(player.name)"
          >
            <div class="lb-pcol-name">
              <RouterLink
                :to="`/v4/players/${encodeURIComponent(player.name)}`"
                class="lb-player-link"
                :class="teamIdx === 1 ? 'lb-player-link--axis' : 'lb-player-link--allies'"
                :title="`View ${$pn(player.name)} profile`"
                @click.stop
              >
                {{ $pn(player.name) }}
              </RouterLink>
            </div>

            <div class="lb-player-stats">
              <span class="lb-pcol-score">
                <span class="lb-score-val">{{ formatNumber(player.score) }}</span>
              </span>
              <span class="lb-pcol-kd">
                <span class="lb-num--kill">{{ player.kills }}</span>
              </span>
              <span class="lb-pcol-kd">
                <span class="lb-num--death">{{ player.deaths }}</span>
              </span>
              <span class="lb-pcol-ping">
                <span class="lb-ping-badge" :class="pingClass(player.ping)">
                  {{ player.ping > 0 ? player.ping : '—' }}
                </span>
              </span>
            </div>
          </div>

          <div v-if="getTeamPlayerCount(teamIdx) === 0" class="lb-player-empty">
            <span>No soldiers currently deployed on this side.</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="lb-roster-empty">
      <span>No active combatants currently on this server. Be the first to join!</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { ServerSummary } from '@/types/server'
import MmStatColIcon from '@/components/v4/MmStatColIcon.vue'

const props = withDefaults(defineProps<{
  server: ServerSummary
  tableEmbed?: boolean
}>(), {
  tableEmbed: false,
})

const router = useRouter()

const formatNumber = (n: number) => n.toLocaleString()

const navigateToPlayerProfile = (playerName: string) => {
  router.push(`/v4/players/${encodeURIComponent(playerName)}`)
}

const getSortedTeamPlayers = (teamIndex: number) => {
  const players = (props.server.players ?? []).filter(p => p.team === teamIndex)
  return [...players].sort((a, b) => (b.score || 0) - (a.score || 0))
}

const getTeamLabel = (teamIndex: number) => {
  if (props.server.teams && props.server.teams.length > 0) {
    const t = props.server.teams.find(tm => tm.index === teamIndex)
    if (t?.label) return t.label.toUpperCase()
  }
  return teamIndex === 1 ? 'AXIS' : 'ALLIED'
}

const getTeamTickets = (teamIndex: number) => {
  if (props.server.teams && props.server.teams.length > 0) {
    const t = props.server.teams.find(tm => tm.index === teamIndex)
    if (t?.tickets !== undefined) return t.tickets
  }
  return teamIndex === 1 ? (props.server.tickets1 ?? 0) : (props.server.tickets2 ?? 0)
}

const getTeamPlayerCount = (teamIndex: number) =>
  (props.server.players ?? []).filter(p => p.team === teamIndex).length

const pingClass = (ping: number) => {
  if (ping <= 0) return 'lb-ping--muted'
  if (ping < 60) return 'lb-ping--good'
  if (ping < 120) return 'lb-ping--mid'
  return 'lb-ping--high'
}
</script>

<style scoped>
.lb-inline-roster {
  box-sizing: border-box;
  min-width: 100%;
  padding: 8px 16px 20px;
}

.lb-inline-roster--table {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 100cqi;
  min-width: 0;
  max-width: 100cqi;
}

.lb-inline-roster--table .lb-roster-teams {
  min-width: 0;
  width: 100%;
}

.lb-roster-teams {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  min-width: 100%;
}

.lb-roster-team-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: clip;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg);
}

.lb-roster-team--axis {
  --team: var(--mm-kill);
}

.lb-roster-team--allies {
  --team: #5b8fd6;
}

.lb-team-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mm-rule);
}

.lb-team-name {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--mm-ink);
}

.lb-team-name::before {
  content: '';
  width: 3px;
  height: 14px;
  border-radius: 1px;
  background: var(--team);
}

.lb-team-tickets-plain {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 26px;
  line-height: 1;
  letter-spacing: -0.01em;
  color: var(--mm-ink);
  font-variant-numeric: tabular-nums;
}

.lb-player-list {
  display: flex;
  flex-direction: column;
}

.lb-player-list-head,
.lb-player-item {
  display: flex;
  align-items: center;
}

.lb-player-list-head {
  padding: 8px 14px;
  min-height: 36px;
  box-sizing: border-box;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-highlight-ink);
  font-weight: 600;
  background: var(--mm-highlight);
  overflow: visible;
}

.lb-player-list-head .lb-pcol-score,
.lb-player-list-head .lb-pcol-kd,
.lb-player-list-head .lb-pcol-ping {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.lb-player-list-head :deep(.mm-stat-col-icon) {
  height: 20px;
  width: auto;
  vertical-align: middle;
}

.lb-player-stats {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.lb-player-item {
  cursor: pointer;
  padding: 9px 14px;
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  border-top: 1px solid var(--mm-rule);
  transition: background-color 0.15s ease;
}

.lb-player-list-head + .lb-player-item {
  border-top: 0;
}

.lb-player-item:hover {
  background: var(--mm-bg-soft);
}

.lb-pcol-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.lb-player-link,
.lb-player-link--axis,
.lb-player-link--allies {
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 400;
  color: var(--team);
  transition: color 0.15s ease;
}

.lb-player-link:focus-visible {
  outline: 2px solid var(--mm-accent);
  outline-offset: 2px;
}

.lb-player-link:hover,
.lb-player-link--axis:hover,
.lb-player-link--allies:hover {
  color: var(--mm-accent);
}

.lb-pcol-score,
.lb-pcol-kd,
.lb-pcol-ping {
  flex-shrink: 0;
  text-align: right;
}

.lb-pcol-score {
  width: 64px;
}

.lb-score-val {
  font-weight: 600;
  color: var(--mm-ink);
  font-size: 12.5px;
}

.lb-pcol-kd {
  width: 48px;
  font-size: 12.5px;
}

.lb-num--kill {
  color: var(--mm-kill);
}

.lb-num--death {
  color: var(--mm-death);
}

.lb-pcol-ping {
  width: 56px;
  white-space: nowrap;
}

.lb-ping-badge {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  font-weight: 400;
}

.lb-ping--good,
.lb-ping--mid,
.lb-ping--muted {
  color: var(--mm-ink-muted);
}

.lb-ping--high {
  color: var(--mm-kill);
}

.lb-player-empty {
  padding: 20px 16px;
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  font-style: italic;
  text-align: center;
}

.lb-roster-empty {
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  color: var(--mm-ink-soft);
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

@media (max-width: 860px) {
  .lb-inline-roster {
    padding: 14px 14px 20px;
  }
  .lb-roster-teams {
    gap: 16px;
  }
}

@media (max-width: 720px) {
  .lb-inline-roster {
    padding: 10px 10px 14px;
  }

  .lb-roster-teams {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    min-width: 0;
  }

  .lb-roster-team-card {
    min-width: 0;
  }

  .lb-team-strip {
    padding: 8px 10px;
  }

  .lb-team-tickets-plain {
    font-size: 18px;
  }

  .lb-player-list-head {
    min-height: 32px;
    padding: 6px 10px;
  }

  .lb-player-item {
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    padding: 7px 10px;
    font-size: 12px;
  }

  .lb-pcol-name {
    width: 100%;
  }

  .lb-player-link {
    font-size: 13px;
  }

  .lb-player-stats {
    width: 100%;
    justify-content: space-between;
    gap: 4px;
  }

  .lb-pcol-score,
  .lb-pcol-kd,
  .lb-pcol-ping {
    width: auto;
    flex: 1;
    text-align: left;
    font-size: 11px;
  }

  .lb-pcol-ping {
    text-align: right;
  }

  .lb-score-val {
    font-size: 12px;
  }
}
</style>
