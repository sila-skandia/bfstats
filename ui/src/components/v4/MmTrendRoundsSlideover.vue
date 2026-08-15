<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchSessions } from '@/services/playerStatsService'
import MmRoundReportV2 from '@/components/v4/MmRoundReportV2.vue'
import { kdClass } from '@/views/v4/mmTokens'
import { formatDate, parseUtc } from '@/utils/timeUtils'

interface RoundRow {
  roundId: string
  mapName: string
  serverName: string
  startTime: string
  durationMinutes: number
  score: number
  kills: number
  deaths: number
}

const props = defineProps<{
  open: boolean
  playerName: string
  fromIso: string
  toIso: string
  rangeLabel: string
}>()

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()

const loading = ref(false)
const error = ref<string | null>(null)
const rounds = ref<RoundRow[]>([])
const page = ref(1)
const pageSize = 25
const totalItems = ref(0)
const totalPages = ref(0)
const selectedRoundId = ref<string | null>(null)

const kdValue = (r: RoundRow) => (r.deaths === 0 ? r.kills : r.kills / r.deaths)

const sessionsHref = computed(() => {
  const from = props.fromIso.slice(0, 10)
  const to = props.toIso.slice(0, 10)
  return {
    path: `/v4/players/${encodeURIComponent(props.playerName)}/sessions`,
    query: { from, to },
  }
})

const load = async () => {
  if (!props.open || !props.playerName) return
  loading.value = true
  error.value = null
  try {
    const response = await fetchSessions(
      page.value,
      pageSize,
      {
        playerNames: props.playerName,
        startTimeFrom: props.fromIso,
        startTimeTo: props.toIso,
      },
      'startTime',
      'desc',
      true,
    )
    totalItems.value = response.totalItems
    totalPages.value = response.totalPages
    rounds.value = (response.items ?? []).map((round) => {
      const mine = round.topPlayers?.[0] ?? round.players?.[0]
      return {
        roundId: round.roundId,
        mapName: round.mapName,
        serverName: round.serverName,
        startTime: round.startTime,
        durationMinutes: round.durationMinutes,
        score: mine?.score ?? 0,
        kills: mine?.kills ?? 0,
        deaths: mine?.deaths ?? 0,
      }
    })
  } catch {
    error.value = 'Could not load rounds for this window.'
    rounds.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.playerName, props.fromIso, props.toIso] as const,
  ([open]) => {
    if (!open) {
      selectedRoundId.value = null
      return
    }
    page.value = 1
    void load()
  },
)

watch(page, () => {
  if (props.open) void load()
})

onMounted(() => {
  if (props.open) void load()
})

const closeReport = () => {
  selectedRoundId.value = null
}

const closeAll = () => {
  selectedRoundId.value = null
  emit('close')
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (selectedRoundId.value) {
    e.preventDefault()
    closeReport()
    return
  }
  if (props.open) {
    e.preventDefault()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
)

onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const openFullSessions = () => {
  router.push(sessionsHref.value)
}

const formatWhen = (iso: string) => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return formatDate(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="mm mm-trend-so"
      data-testid="trend-rounds-slideover"
      role="dialog"
      aria-modal="true"
      aria-label="Rounds in selected period"
      @click.self="closeAll"
    >
      <div class="mm-trend-so__panel">
        <header class="mm-trend-so__head">
          <div>
            <div class="mm-eyebrow mm-eyebrow--strong">Rounds in window</div>
            <h2 class="mm-h2" style="margin: 4px 0 0">{{ rangeLabel }}</h2>
            <p class="mm-card__hint" style="margin-top: 4px">
              {{ totalItems.toLocaleString() }}
              {{ totalItems === 1 ? 'round' : 'rounds' }}
              · times in your local time
            </p>
          </div>
          <div class="mm-trend-so__head-actions">
            <button type="button" class="mm-btn" @click="openFullSessions">
              Open sessions page →
            </button>
            <button
              type="button"
              class="mm-trend-so__close"
              aria-label="Close rounds listing"
              @click="closeAll"
            >
              ← Close
            </button>
          </div>
        </header>

        <div class="mm-trend-so__body">
          <div v-if="loading" class="mm-trend-so__pad">
            <div v-for="i in 6" :key="i" class="mm-skeleton" style="margin-bottom: 12px; height: 44px" />
          </div>
          <div v-else-if="error" class="mm-empty" style="border: 0; padding: 32px 18px">{{ error }}</div>
          <div v-else-if="rounds.length === 0" class="mm-empty" style="border: 0; padding: 32px 18px">
            No rounds in this window.
          </div>
          <ol v-else class="mm-trend-so__list">
            <li
              v-for="round in rounds"
              :key="round.roundId"
              class="mm-session-row mm-trend-so__row"
              @click="selectedRoundId = round.roundId"
            >
              <span class="mm-session-row__chip">Report</span>
              <span class="mm-session-row__map">{{ round.mapName || 'Unknown' }}</span>
              <span class="mm-session-row__date">{{ formatWhen(round.startTime) }}</span>
              <span class="mm-session-row__server">{{ $pn(round.serverName) }}</span>
              <span class="mm-session-row__stats">
                {{ round.score.toLocaleString() }}
                <span class="mm-num__sep">·</span>
                <span class="mm-num--kill">{{ round.kills }}</span><span class="mm-num__sep">/</span><span class="mm-num--death">{{ round.deaths }}</span>
                <span class="mm-num__sep">·</span>
                <span :class="kdClass(kdValue(round))">{{ kdValue(round).toFixed(2) }}</span>
              </span>
            </li>
          </ol>

          <nav v-if="totalPages > 1" class="mm-trend-so__pager" aria-label="Rounds pages">
            <button type="button" class="mm-btn" :disabled="page <= 1" @click="page -= 1">← Prev</button>
            <span class="mm-card__hint">{{ page }} / {{ totalPages }}</span>
            <button type="button" class="mm-btn" :disabled="page >= totalPages" @click="page += 1">Next →</button>
          </nav>
        </div>
      </div>

      <div
        v-if="selectedRoundId"
        class="mm-trend-so mm-trend-so--report"
        @click.self="closeReport"
      >
        <div class="mm-trend-so__panel mm-trend-so__panel--report">
          <header class="mm-trend-so__head">
            <button type="button" class="mm-trend-so__close" aria-label="Close round report" @click="closeReport">
              ← Close report
            </button>
          </header>
          <div class="mm-trend-so__body mm-trend-so__body--report">
            <MmRoundReportV2 :round-id="selectedRoundId" :players="playerName" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mm-trend-so {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: color-mix(in srgb, var(--mm-bg) 50%, transparent);
  display: flex;
  justify-content: flex-end;
  animation: mm-trend-fade 0.2s ease;
}

.mm-trend-so--report {
  z-index: 10001;
}

.mm-trend-so__panel {
  width: min(720px, 100vw);
  height: 100%;
  background: var(--mm-bg);
  border-left: 1px solid var(--mm-rule-strong);
  display: flex;
  flex-direction: column;
  animation: mm-trend-slide 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.mm-trend-so__panel--report {
  width: min(1600px, 95vw);
}

.mm-trend-so__head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.mm-trend-so__head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.mm-trend-so__close {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: transparent;
  border: 1px solid var(--mm-rule);
  padding: 10px 14px;
  min-height: 44px;
  cursor: pointer;
  border-radius: 2px;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.mm-trend-so__close:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink-soft);
}

.mm-trend-so__body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  overscroll-behavior: contain;
}

.mm-trend-so__body--report { padding: 0; }

.mm-trend-so__pad { padding: 16px 20px; }

.mm-trend-so__list {
  list-style: none;
  margin: 0;
  padding: 4px 20px 24px;
}

.mm-trend-so__row { cursor: pointer; }

.mm-trend-so__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 12px 20px 28px;
}

@keyframes mm-trend-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes mm-trend-slide {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@media (max-width: 720px) {
  .mm-trend-so__panel,
  .mm-trend-so__panel--report {
    width: 100vw;
    max-width: 100vw;
  }
  .mm-trend-so__head {
    flex-direction: column;
    align-items: stretch;
  }
  .mm-trend-so__head-actions {
    justify-content: space-between;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mm-trend-so,
  .mm-trend-so__panel {
    animation: none;
  }
}
</style>
