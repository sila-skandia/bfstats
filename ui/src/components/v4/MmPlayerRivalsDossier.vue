<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchPlayerTeammates, type PlayerRelationship } from '@/services/playerRelationshipsApi'
import { formatLastSeen, formatDate, parseUtc } from '@/utils/timeUtils'

const props = defineProps<{
  playerName: string
}>()

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const teammates = ref<PlayerRelationship[]>([])

const loadRivals = async () => {
  if (!props.playerName) return
  loading.value = true
  error.value = null
  try {
    teammates.value = await fetchPlayerTeammates(props.playerName, 30)
  } catch {
    error.value = 'Rivalry dossier unavailable'
  } finally {
    loading.value = false
  }
}

onMounted(loadRivals)
watch(() => props.playerName, loadRivals)

// 1. Arch-Rival: co-player with the highest shared session count
const archRival = computed<PlayerRelationship | null>(() => {
  if (teammates.value.length === 0) return null
  return [...teammates.value].sort((a, b) => b.sessionCount - a.sessionCount)[0]
})

// 2. Longest Rivalry: earliest firstPlayedTogether among co-players
const oldestRival = computed<PlayerRelationship | null>(() => {
  if (teammates.value.length < 2) return null
  const pool = teammates.value.filter(t => t.player2Name !== archRival.value?.player2Name && t.firstPlayedTogether)
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => parseUtc(a.firstPlayedTogether).getTime() - parseUtc(b.firstPlayedTogether).getTime())[0]
})

// 3. Recent Clash: most recently clashed co-player
const recentRival = computed<PlayerRelationship | null>(() => {
  if (teammates.value.length === 0) return null
  const pool = teammates.value.filter(
    t => t.player2Name !== archRival.value?.player2Name && t.player2Name !== oldestRival.value?.player2Name && t.lastPlayedTogether,
  )
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => parseUtc(b.lastPlayedTogether).getTime() - parseUtc(a.lastPlayedTogether).getTime())[0]
})

// 4. Other notable rivals
const otherRivals = computed(() => {
  const excluded = new Set([
    archRival.value?.player2Name,
    oldestRival.value?.player2Name,
    recentRival.value?.player2Name,
  ].filter(Boolean))
  return teammates.value.filter(t => !excluded.has(t.player2Name)).slice(0, 4)
})

const goCompare = (otherName: string) => {
  router.push({
    path: '/v4/players/compare',
    query: {
      player1: props.playerName,
      player2: otherName,
    },
  })
}

const goPlayer = (otherName: string) => {
  router.push(`/v4/players/${encodeURIComponent(otherName)}`)
}
</script>

<template>
  <section class="mm-panel mm-rivals">
    <div class="mm-pbar">
      <span class="mm-pbar__t"># Rivals & Battle Dossier</span>
      <span class="mm-pbar__m">co-play & head-to-head encounter history</span>
    </div>

    <div v-if="loading" class="mm-panel__body">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px">
        <div v-for="i in 3" :key="i" class="mm-skeleton mm-skeleton--lg" style="height: 110px" />
      </div>
    </div>

    <div v-else-if="error || teammates.length === 0" class="mm-panel__body mm-empty" style="border: 0; padding: 24px 0">
      <span>No recorded head-to-head encounters or co-play history yet.</span>
    </div>

    <div v-else class="mm-panel__body" style="display: flex; flex-direction: column; gap: 16px">
      <!-- 3 Spotlight Cards: Arch-Rival / Longest Rivalry / Recent Clash -->
      <div class="mm-rivals__cards">
        <!-- Arch-Rival Card -->
        <div v-if="archRival" class="mm-rcard mm-rcard--nemesis">
          <div class="mm-rcard__tag mm-rcard__tag--nemesis">
            <span>ARCH-RIVAL</span>
          </div>
          <div class="mm-rcard__name-row">
            <button
              type="button"
              class="mm-rcard__name"
              :title="`View ${$pn(archRival.player2Name)}'s profile`"
              @click="goPlayer(archRival.player2Name)"
            >
              {{ $pn(archRival.player2Name) }}
            </button>
            <span class="mm-rcard__badge">
              {{ archRival.sessionCount }} matches
            </span>
          </div>
          <div class="mm-rcard__desc">
            Your most frequent adversary. Clashed in <strong>{{ archRival.sessionCount }}</strong> battles across {{ archRival.serverGuids?.length || 1 }} servers.
            <span v-if="archRival.lastPlayedTogether" class="mm-rcard__subdate">Last clash {{ formatLastSeen(archRival.lastPlayedTogether) }}.</span>
          </div>
          <button
            type="button"
            class="mm-rcard__btn"
            @click="goCompare(archRival.player2Name)"
          >
            Compare Head-to-Head →
          </button>
        </div>

        <!-- Longest Rivalry Card -->
        <div v-if="oldestRival" class="mm-rcard mm-rcard--veteran">
          <div class="mm-rcard__tag mm-rcard__tag--veteran">
            <span>LONGEST RIVALRY</span>
          </div>
          <div class="mm-rcard__name-row">
            <button
              type="button"
              class="mm-rcard__name"
              :title="`View ${$pn(oldestRival.player2Name)}'s profile`"
              @click="goPlayer(oldestRival.player2Name)"
            >
              {{ $pn(oldestRival.player2Name) }}
            </button>
            <span class="mm-rcard__badge mm-rcard__badge--subtle">
              {{ oldestRival.sessionCount }} matches
            </span>
          </div>
          <div class="mm-rcard__desc">
            First clashed on <strong>{{ formatDate(oldestRival.firstPlayedTogether) }}</strong>. Fought across {{ oldestRival.serverGuids?.length || 1 }} servers.
          </div>
          <button
            type="button"
            class="mm-rcard__btn"
            @click="goCompare(oldestRival.player2Name)"
          >
            Compare Stats →
          </button>
        </div>

        <!-- Recent Clash Card -->
        <div v-if="recentRival" class="mm-rcard mm-rcard--recent">
          <div class="mm-rcard__tag mm-rcard__tag--recent">
            <span>RECENT CONTENDER</span>
          </div>
          <div class="mm-rcard__name-row">
            <button
              type="button"
              class="mm-rcard__name"
              :title="`View ${$pn(recentRival.player2Name)}'s profile`"
              @click="goPlayer(recentRival.player2Name)"
            >
              {{ $pn(recentRival.player2Name) }}
            </button>
            <span class="mm-rcard__badge mm-rcard__badge--recent">
              {{ formatLastSeen(recentRival.lastPlayedTogether) }}
            </span>
          </div>
          <div class="mm-rcard__desc">
            Recent combatant with <strong>{{ recentRival.sessionCount }}</strong> recorded shared matches.
          </div>
          <button
            type="button"
            class="mm-rcard__btn"
            @click="goCompare(recentRival.player2Name)"
          >
            Compare Head-to-Head →
          </button>
        </div>
      </div>

      <!-- Additional Frequent Encounters Table -->
      <div v-if="otherRivals.length > 0" class="mm-rivals__more">
        <span class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 6px">Other Frequent Encounters</span>
        <div class="mm-rivals__list">
          <div
            v-for="r in otherRivals"
            :key="r.player2Name"
            class="mm-rrow mm-rivals__row"
          >
            <button
              type="button"
              class="mm-rivals__player-link"
              @click="goPlayer(r.player2Name)"
            >
              {{ $pn(r.player2Name) }}
            </button>

            <span class="mm-rivals__sessions">
              {{ r.sessionCount }} matches · {{ r.serverGuids?.length || 1 }} servers
            </span>

            <span v-if="r.lastPlayedTogether" class="mm-rivals__date">
              {{ formatLastSeen(r.lastPlayedTogether) }}
            </span>

            <button
              type="button"
              class="mm-btn mm-btn--xs"
              @click="goCompare(r.player2Name)"
            >
              Compare →
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mm-rivals__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}

.mm-rcard {
  background: var(--mm-surface);
  border: 1px solid var(--mm-line);
  border-radius: 4px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  transition: border-color 0.15s ease;
}

.mm-rcard:hover {
  border-color: var(--mm-ink-muted);
}

.mm-rcard--nemesis {
  border-left: 3px solid #d9534f;
}

.mm-rcard--veteran {
  border-left: 3px solid #e27d3c;
}

.mm-rcard--recent {
  border-left: 3px solid #7da34c;
}

.mm-rcard__tag {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  font-weight: 600;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mm-rcard__tag--nemesis {
  color: #d9534f;
}

.mm-rcard__tag--veteran {
  color: #e27d3c;
}

.mm-rcard__tag--recent {
  color: #7da34c;
}

.mm-rcard__name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mm-rcard__name {
  background: transparent;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-ink);
  cursor: pointer;
  padding: 0;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-rcard__name:hover {
  color: var(--mm-accent);
}

.mm-rcard__badge {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 2px;
  color: #d9534f;
  background: rgba(217, 83, 79, 0.12);
}

.mm-rcard__badge--subtle {
  color: #e27d3c;
  background: rgba(226, 125, 60, 0.12);
}

.mm-rcard__badge--recent {
  color: #7da34c;
  background: rgba(125, 163, 76, 0.12);
}

.mm-rcard__desc {
  font-size: 11.5px;
  color: var(--mm-ink-muted);
  line-height: 1.4;
  flex: 1;
}

.mm-rcard__subdate {
  display: block;
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--mm-ink-muted);
}

.mm-rcard__btn {
  margin-top: 4px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-line);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  padding: 5px 10px;
  border-radius: 3px;
  cursor: pointer;
  text-align: center;
  transition: all 0.12s ease;
  width: fit-content;
}

.mm-rcard__btn:hover {
  background: var(--mm-ink);
  color: var(--mm-bg);
}

.mm-rivals__more {
  border-top: 1px solid var(--mm-line-subtle);
  padding-top: 12px;
}

.mm-rivals__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-rivals__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  gap: 8px;
}

.mm-rivals__player-link {
  background: transparent;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--mm-ink);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-align: left;
}

.mm-rivals__player-link:hover {
  color: var(--mm-accent);
}

.mm-rivals__sessions {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
  flex: 1;
  text-align: right;
  padding-right: 12px;
}

.mm-rivals__date {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
  padding-right: 8px;
}

.mm-btn--xs {
  font-size: 9.5px;
  padding: 2px 7px;
}
</style>
