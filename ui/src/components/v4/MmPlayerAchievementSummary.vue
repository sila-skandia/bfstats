<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import type { Achievement, PlayerAchievementGroup } from '@/types/playerStatsTypes'
import { getAchievementImageFromObject } from '@/utils/achievementImageUtils'
import { getBadgeDescription } from '@/services/badgeService'

const props = defineProps<{
  playerName: string
  achievementGroups?: PlayerAchievementGroup[]
  loading?: boolean
  error?: string | null
}>()

const router = useRouter()

const groups = ref<PlayerAchievementGroup[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

const selectedGroup = ref<PlayerAchievementGroup | null>(null)
const occurrences = ref<Achievement[]>([])
const occurrencesLoading = ref(false)
const occurrencesError = ref<string | null>(null)
const drillRef = ref<HTMLElement | null>(null)

const OCCURRENCES_PAGE_SIZE = 25
const occurrencesPage = ref(1)
const occurrencesTotalItems = ref(0)
const occurrencesTotalPages = ref(0)

// "By type" (the original grouped-tile grid + per-type drill-in) vs
// "By round" (chronological feed where every round that produced any
// achievement collapses to one card showing every badge it spawned).
type ViewMode = 'by-type' | 'by-round'
const viewMode = ref<ViewMode>('by-type')

const BY_ROUND_PAGE_SIZE = 50
const byRoundPage = ref(1)
const byRoundTotalItems = ref(0)
const byRoundTotalPages = ref(0)
const byRoundLoading = ref(false)
const byRoundError = ref<string | null>(null)
const byRoundFeedRef = ref<HTMLElement | null>(null)

interface RoundAchievementGroup {
  roundId: string
  achievedAt: string
  mapName: string
  serverName: string
  achievements: Achievement[]
}

const roundGroups = ref<RoundAchievementGroup[]>([])

const milestoneTypes = new Set(['milestone'])
const isUsingExternalGroups = computed(() => Array.isArray(props.achievementGroups))

const displayGroups = computed(() =>
  isUsingExternalGroups.value ? (props.achievementGroups ?? []) : groups.value,
)

const milestoneGroups = computed(() =>
  displayGroups.value
    .filter(g => milestoneTypes.has(g.achievementType.toLowerCase()))
    .sort((a, b) => new Date(b.latestAchievedAt).getTime() - new Date(a.latestAchievedAt).getTime()),
)

const otherGroups = computed(() =>
  displayGroups.value
    .filter(g => !milestoneTypes.has(g.achievementType.toLowerCase()))
    .sort((a, b) => b.count - a.count || a.achievementName.localeCompare(b.achievementName)),
)

const totalEarned = computed(() =>
  displayGroups.value.reduce((sum, g) => sum + g.count, 0),
)

const getAchievementImage = (achievementId: string, tier?: string): string =>
  getAchievementImageFromObject({ achievementId, tier })

const tierClass = (tier: string): string => {
  switch (tier?.toLowerCase()) {
    case 'legend':
    case 'legendary':
    case 'gold':
      return 'mm-kd--elite'
    case 'silver':
      return 'mm-kd--good'
    case 'bronze':
      return 'mm-kd--low'
    default:
      return ''
  }
}

const formatDate = (iso: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const formatDateTime = (iso: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatRelative = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`
  if (diff < 365 * 86_400_000) return `${Math.round(diff / (30 * 86_400_000))}mo ago`
  return `${Math.round(diff / (365 * 86_400_000))}y ago`
}

const placementSuffix = (n: number): string => {
  if (n === 1) return 'st'
  if (n === 2) return 'nd'
  if (n === 3) return 'rd'
  return 'th'
}

interface ParsedOccurrence {
  metadata: any
  serverName: string
  summary: string
  highlight?: { label: string; value: string; tone: 'kill' | 'gold' | 'accent' | 'success' | 'ink' }
  stats?: { label: string; value: string }[]
}

const parseOccurrence = (o: Achievement): ParsedOccurrence => {
  let metadata: any = null
  if (o.metadata) {
    try { metadata = JSON.parse(o.metadata) } catch { metadata = null }
  }
  const serverName: string = metadata?.ServerName ?? metadata?.serverName ?? ''
  const type = (o.achievementType || '').toLowerCase()
  const id = o.achievementId || ''

  if (type === 'round_placement' || id.startsWith('round_placement_')) {
    const place = o.value || metadata?.Place || 1
    const kills = metadata?.Kills ?? 0
    const deaths = metadata?.Deaths ?? 0
    const score = metadata?.Score ?? 0
    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : String(kills)
    return {
      metadata,
      serverName,
      summary: `Finished ${place}${placementSuffix(place)} · ${kills}/${deaths} K/D ${kd} · ${score} pts`,
      highlight: {
        label: 'Place',
        value: `${place}${placementSuffix(place)}`,
        tone: place === 1 ? 'gold' : place <= 3 ? 'accent' : 'ink',
      },
      stats: [
        { label: 'Kills', value: String(kills) },
        { label: 'Deaths', value: String(deaths) },
        { label: 'Score', value: String(score) },
        { label: 'K/D', value: kd },
      ],
    }
  }

  if (id === 'team_victory' || id === 'team_victory_switched') {
    const winLabel = metadata?.WinningTeamLabel ?? 'Team'
    const winTickets = metadata?.WinningTeamTickets ?? 0
    const loseLabel = metadata?.LosingTeamLabel ?? 'Team'
    const loseTickets = metadata?.LosingTeamTickets ?? 0
    const contribution = metadata?.TeamContribution != null ? `${(metadata.TeamContribution * 100).toFixed(0)}%` : ''
    return {
      metadata,
      serverName,
      summary: `${winLabel} ${winTickets} – ${loseTickets} ${loseLabel}${contribution ? ` · ${contribution} contribution` : ''}`,
      highlight: { label: 'Won as', value: winLabel, tone: 'success' },
      stats: contribution ? [{ label: 'Contribution', value: contribution }] : [],
    }
  }

  if (type === 'kill_streak' || id.startsWith('kill_streak')) {
    const streak = o.value || metadata?.Streak || 0
    return {
      metadata,
      serverName,
      summary: `${streak}-kill streak`,
      highlight: { label: 'Streak', value: String(streak), tone: 'kill' },
    }
  }

  if (type === 'milestone') {
    return {
      metadata,
      serverName,
      summary: `Reached ${o.value?.toLocaleString?.() ?? o.value}`,
      highlight: { label: 'Total', value: o.value?.toLocaleString?.() ?? String(o.value ?? '—'), tone: 'accent' },
    }
  }

  // Default: badge / ranking / unknown
  return {
    metadata,
    serverName,
    summary: o.value ? `Value ${o.value.toLocaleString()}` : '',
    highlight: o.value ? { label: 'Value', value: o.value.toLocaleString(), tone: 'ink' } : undefined,
  }
}

const selectedDescription = computed(() => {
  if (!selectedGroup.value) return null
  return getBadgeDescription(selectedGroup.value.achievementId)
})

const fetchByRoundPage = async () => {
  byRoundLoading.value = true
  byRoundError.value = null
  try {
    const params = new URLSearchParams({
      playerName: props.playerName,
      page: String(byRoundPage.value),
      pageSize: String(BY_ROUND_PAGE_SIZE),
      sortBy: 'AchievedAt',
      sortOrder: 'desc',
    })
    const response = await fetch(`/stats/gamification/achievements?${params}`)
    if (!response.ok) throw new Error('Failed to fetch round achievement feed')
    const data = await response.json()
    const items = (data?.items ?? []) as Achievement[]
    byRoundTotalItems.value = data?.totalItems ?? items.length
    byRoundTotalPages.value = data?.totalPages ?? 1

    // Group within the page by roundId — preserve API order (newest first).
    const groupMap = new Map<string, RoundAchievementGroup>()
    for (const a of items) {
      const key = a.roundId || `__noround__${a.achievedAt}`
      const existing = groupMap.get(key)
      if (existing) {
        existing.achievements.push(a)
        // keep earliest achievedAt on the card (round start-ish)
        if (new Date(a.achievedAt).getTime() < new Date(existing.achievedAt).getTime()) {
          existing.achievedAt = a.achievedAt
        }
      } else {
        let serverName = ''
        if (a.metadata) {
          try { serverName = JSON.parse(a.metadata)?.ServerName ?? '' } catch { /* ignore */ }
        }
        groupMap.set(key, {
          roundId: a.roundId,
          achievedAt: a.achievedAt,
          mapName: a.mapName ?? '',
          serverName,
          achievements: [a],
        })
      }
    }
    roundGroups.value = Array.from(groupMap.values())
  } catch (err: unknown) {
    byRoundError.value = err instanceof Error ? err.message : 'Failed to load round feed.'
    roundGroups.value = []
  } finally {
    byRoundLoading.value = false
  }
}

const switchView = async (mode: ViewMode) => {
  if (viewMode.value === mode) return
  closeAchievement()
  viewMode.value = mode
  if (mode === 'by-round' && roundGroups.value.length === 0 && !byRoundError.value) {
    byRoundPage.value = 1
    await fetchByRoundPage()
  }
}

const goByRoundPage = async (page: number) => {
  if (page < 1 || page > byRoundTotalPages.value || page === byRoundPage.value) return
  byRoundPage.value = page
  await fetchByRoundPage()
  byRoundFeedRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const byRoundPaginationRange = computed(() => {
  const range: number[] = []
  const maxVisible = 5
  const total = byRoundTotalPages.value
  if (total <= 1) return range
  let start = Math.max(1, byRoundPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(total, start + maxVisible - 1)
  if (end === total) start = Math.max(1, end - maxVisible + 1)
  for (let i = start; i <= end; i++) range.push(i)
  return range
})

const fetchOccurrencesPage = async () => {
  if (!selectedGroup.value) return
  occurrencesLoading.value = true
  occurrencesError.value = null
  try {
    const params = new URLSearchParams({
      playerName: props.playerName,
      achievementId: selectedGroup.value.achievementId,
      page: String(occurrencesPage.value),
      pageSize: String(OCCURRENCES_PAGE_SIZE),
      sortBy: 'AchievedAt',
      sortOrder: 'desc',
    })
    const response = await fetch(`/stats/gamification/achievements?${params}`)
    if (!response.ok) throw new Error('Failed to fetch achievement history')
    const data = await response.json()
    occurrences.value = (data?.items ?? []) as Achievement[]
    occurrencesTotalItems.value = data?.totalItems ?? occurrences.value.length
    occurrencesTotalPages.value = data?.totalPages ?? 1
  } catch (err: unknown) {
    occurrencesError.value = err instanceof Error ? err.message : 'Failed to load achievement history.'
  } finally {
    occurrencesLoading.value = false
  }
}

const openAchievement = async (group: PlayerAchievementGroup) => {
  selectedGroup.value = group
  occurrences.value = []
  occurrencesPage.value = 1
  occurrencesTotalItems.value = 0
  occurrencesTotalPages.value = 0
  await nextTick()
  drillRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  await fetchOccurrencesPage()
}

const closeAchievement = () => {
  selectedGroup.value = null
  occurrences.value = []
  occurrencesError.value = null
  occurrencesPage.value = 1
  occurrencesTotalItems.value = 0
  occurrencesTotalPages.value = 0
}

const goOccurrencesPage = async (page: number) => {
  if (page < 1 || page > occurrencesTotalPages.value || page === occurrencesPage.value) return
  occurrencesPage.value = page
  await fetchOccurrencesPage()
  drillRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const occurrencesPaginationRange = computed(() => {
  const range: number[] = []
  const maxVisible = 5
  const total = occurrencesTotalPages.value
  if (total <= 1) return range
  let start = Math.max(1, occurrencesPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(total, start + maxVisible - 1)
  if (end === total) start = Math.max(1, end - maxVisible + 1)
  for (let i = start; i <= end; i++) range.push(i)
  return range
})

const goRound = (roundId: string) => {
  if (!roundId) return
  router.push({
    path: `/v4/rounds/${encodeURIComponent(roundId)}/report`,
    query: { players: props.playerName },
  })
}

const fetchAchievementGroups = async () => {
  if (isUsingExternalGroups.value) return
  isLoading.value = true
  error.value = null
  try {
    const response = await fetch(`/stats/gamification/player/${encodeURIComponent(props.playerName)}/achievement-groups`)
    if (!response.ok) throw new Error('Failed to fetch achievements')
    groups.value = await response.json()
  } catch (err: unknown) {
    console.error('Error fetching achievement groups:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load achievements.'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => fetchAchievementGroups())
watch(() => props.playerName, (n, o) => { if (n && n !== o) fetchAchievementGroups() })
watch(() => props.achievementGroups, (n) => {
  if (Array.isArray(n)) { groups.value = n; isLoading.value = false; error.value = null }
}, { immediate: true })
watch(() => props.loading, (n) => { if (typeof n === 'boolean') isLoading.value = n }, { immediate: true })
watch(() => props.error, (n) => { if (n !== undefined) error.value = n ?? null }, { immediate: true })
</script>

<template>
  <section class="mm-ach">
    <div v-if="isLoading" class="mm-ach__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton mm-skeleton--lg" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchAchievementGroups">Retry</button>
    </div>

    <div v-else-if="displayGroups.length === 0" class="mm-empty">
      No achievements yet.
    </div>

    <template v-else>
      <!-- View mode toggle (hidden once a single achievement is open) -->
      <div v-if="!selectedGroup" class="mm-ach__view-toggle">
        <button
          type="button"
          class="mm-tab"
          :class="{ 'mm-tab--active': viewMode === 'by-type' }"
          @click="switchView('by-type')"
        >Categories</button>
        <button
          type="button"
          class="mm-tab"
          :class="{ 'mm-tab--active': viewMode === 'by-round' }"
          @click="switchView('by-round')"
        >By round</button>
      </div>

      <!-- BY-ROUND feed: every round that produced any achievement collapses
           to one card containing all of that round's badges. -->
      <section v-if="viewMode === 'by-round' && !selectedGroup" ref="byRoundFeedRef" class="mm-ach__section">
        <div v-if="byRoundLoading" style="padding: 14px 0">
          <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
        </div>

        <div v-else-if="byRoundError" class="mm-empty">
          {{ byRoundError }}
          <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchByRoundPage">Retry</button>
        </div>

        <div v-else-if="roundGroups.length === 0" class="mm-empty">No achievement-bearing rounds yet.</div>

        <template v-else>
          <p class="mm-card__hint" style="margin: 4px 0 8px">
            {{ roundGroups.length }} {{ roundGroups.length === 1 ? 'round' : 'rounds' }} on this page ·
            {{ ((byRoundPage - 1) * BY_ROUND_PAGE_SIZE) + 1 }}–{{ Math.min(byRoundPage * BY_ROUND_PAGE_SIZE, byRoundTotalItems) }}
            of {{ byRoundTotalItems.toLocaleString() }} achievements total
          </p>

          <ol class="mm-ach__timeline">
            <li v-for="group in roundGroups" :key="`${group.roundId}-${group.achievedAt}`">
              <article
                class="mm-ach__card"
                :class="{ 'mm-ach__card--clickable': group.roundId }"
                @click="goRound(group.roundId)"
              >
                <div class="mm-ach__card-rail">
                  <span class="mm-ach__card-index">×{{ group.achievements.length }}</span>
                </div>
                <div class="mm-ach__card-body">
                  <div class="mm-ach__card-row">
                    <div class="mm-ach__card-when">
                      <span class="mm-ach__card-date">{{ formatDateTime(group.achievedAt) }}</span>
                      <span class="mm-ach__card-rel">{{ formatRelative(group.achievedAt) }}</span>
                    </div>
                  </div>
                  <div class="mm-ach__badges">
                    <div
                      v-for="(a, idx) in group.achievements"
                      :key="`${a.achievementId}-${idx}`"
                      class="mm-ach__badge"
                      :title="`${a.achievementName} (${a.tier || 'Standard'})`"
                    >
                      <img
                        :src="getAchievementImage(a.achievementId, a.tier)"
                        :alt="a.achievementName"
                        loading="lazy"
                        class="mm-ach__badge-img"
                      />
                      <div class="mm-ach__badge-text">
                        <span class="mm-ach__badge-name">{{ a.achievementName }}</span>
                        <span class="mm-eyebrow mm-ach__badge-tier" :class="tierClass(a.tier)">
                          {{ a.tier || 'Standard' }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="mm-ach__card-foot">
                    <span v-if="group.serverName" class="mm-ach__card-foot-item">{{ group.serverName }}</span>
                    <span v-if="group.serverName && group.mapName" class="mm-meta-row__sep">·</span>
                    <span v-if="group.mapName" class="mm-ach__card-foot-item">{{ group.mapName }}</span>
                    <span v-if="group.roundId" class="mm-eyebrow" style="margin-left: auto">Round report →</span>
                  </div>
                </div>
              </article>
            </li>
          </ol>

          <div v-if="byRoundTotalPages > 1" class="mm-ach__pagination">
            <button
              type="button"
              class="mm-btn mm-btn--inline"
              :disabled="byRoundPage <= 1"
              @click="goByRoundPage(byRoundPage - 1)"
            >‹</button>
            <button
              v-for="page in byRoundPaginationRange"
              :key="page"
              type="button"
              class="mm-btn mm-btn--inline"
              :class="{ 'mm-ach__page--active': page === byRoundPage }"
              @click="goByRoundPage(page)"
            >{{ page }}</button>
            <button
              type="button"
              class="mm-btn mm-btn--inline"
              :disabled="byRoundPage >= byRoundTotalPages"
              @click="goByRoundPage(byRoundPage + 1)"
            >›</button>
          </div>
        </template>
      </section>

      <!-- Drill-in: occurrence list for the selected achievement -->
      <section v-if="selectedGroup" ref="drillRef" class="mm-ach__section">
        <button type="button" class="mm-btn mm-btn--inline" style="align-self: flex-start" @click="closeAchievement">← Back to achievements</button>
        <div class="mm-ach__drill-head">
          <img
            :src="getAchievementImage(selectedGroup.achievementId, selectedGroup.tier)"
            :alt="selectedGroup.achievementName"
            class="mm-ach__img"
          />
          <div style="flex: 1; min-width: 0">
            <div class="mm-eyebrow" :class="tierClass(selectedGroup.tier)">
              {{ selectedGroup.tier || 'Standard' }} · {{ selectedGroup.achievementType }}
            </div>
            <h2 class="mm-display" style="font-size: clamp(22px, 2vw, 28px); margin: 4px 0 0">{{ selectedGroup.achievementName }}</h2>
            <p class="mm-card__hint" style="margin-top: 6px">
              Earned {{ selectedGroup.count }}{{ selectedGroup.count === 1 ? ' time' : ' times' }} · latest {{ formatDate(selectedGroup.latestAchievedAt) }}
            </p>
            <p v-if="selectedDescription" class="mm-ach__desc">{{ selectedDescription }}</p>
          </div>
        </div>

        <div v-if="occurrencesLoading" style="padding: 14px 0">
          <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
        </div>

        <div v-else-if="occurrencesError" class="mm-empty">
          {{ occurrencesError }}
          <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchOccurrencesPage">Retry</button>
        </div>

        <div v-else-if="occurrences.length === 0" class="mm-empty">No earn history recorded.</div>

        <template v-else>
          <p class="mm-card__hint" style="margin: 4px 0 8px">
            Showing {{ ((occurrencesPage - 1) * OCCURRENCES_PAGE_SIZE) + 1 }}–{{ Math.min(occurrencesPage * OCCURRENCES_PAGE_SIZE, occurrencesTotalItems) }}
            of {{ occurrencesTotalItems.toLocaleString() }}
          </p>

        <ol class="mm-ach__timeline">
          <li
            v-for="(o, i) in occurrences"
            :key="`${o.roundId}-${o.achievedAt}-${i}`"
          >
            <article
              class="mm-ach__card"
              :class="{ 'mm-ach__card--clickable': o.roundId }"
              @click="goRound(o.roundId)"
            >
              <div class="mm-ach__card-rail">
                <span class="mm-ach__card-index">#{{ occurrences.length - i }}</span>
              </div>
              <div class="mm-ach__card-body">
                <div class="mm-ach__card-row">
                  <div class="mm-ach__card-when">
                    <span class="mm-ach__card-date">{{ formatDateTime(o.achievedAt) }}</span>
                    <span class="mm-ach__card-rel">{{ formatRelative(o.achievedAt) }}</span>
                  </div>
                  <div
                    v-if="parseOccurrence(o).highlight"
                    class="mm-ach__card-highlight"
                    :class="`mm-ach__card-highlight--${parseOccurrence(o).highlight!.tone}`"
                  >
                    <span class="mm-ach__card-highlight-label">{{ parseOccurrence(o).highlight!.label }}</span>
                    <span class="mm-ach__card-highlight-value">{{ parseOccurrence(o).highlight!.value }}</span>
                  </div>
                </div>
                <p v-if="parseOccurrence(o).summary" class="mm-ach__card-summary">
                  {{ parseOccurrence(o).summary }}
                </p>
                <div v-if="parseOccurrence(o).stats && parseOccurrence(o).stats!.length" class="mm-ach__card-stats">
                  <div v-for="s in parseOccurrence(o).stats" :key="s.label" class="mm-ach__card-stat">
                    <span class="mm-ach__card-stat-label">{{ s.label }}</span>
                    <span class="mm-ach__card-stat-value">{{ s.value }}</span>
                  </div>
                </div>
                <div class="mm-ach__card-foot">
                  <span v-if="parseOccurrence(o).serverName" class="mm-ach__card-foot-item">{{ parseOccurrence(o).serverName }}</span>
                  <span v-if="o.mapName" class="mm-meta-row__sep">·</span>
                  <span v-if="o.mapName" class="mm-ach__card-foot-item">{{ o.mapName }}</span>
                  <span v-if="o.roundId" class="mm-meta-row__sep">·</span>
                  <span v-if="o.roundId" class="mm-eyebrow" style="margin-left: auto">Round report →</span>
                </div>
              </div>
            </article>
          </li>
        </ol>

          <div v-if="occurrencesTotalPages > 1" class="mm-ach__pagination">
            <button
              type="button"
              class="mm-btn mm-btn--inline"
              :disabled="occurrencesPage <= 1"
              @click="goOccurrencesPage(occurrencesPage - 1)"
            >‹</button>
            <button
              v-for="page in occurrencesPaginationRange"
              :key="page"
              type="button"
              class="mm-btn mm-btn--inline"
              :class="{ 'mm-ach__page--active': page === occurrencesPage }"
              @click="goOccurrencesPage(page)"
            >{{ page }}</button>
            <button
              type="button"
              class="mm-btn mm-btn--inline"
              :disabled="occurrencesPage >= occurrencesTotalPages"
              @click="goOccurrencesPage(occurrencesPage + 1)"
            >›</button>
          </div>
        </template>
      </section>

      <template v-else-if="viewMode === 'by-type'">
        <section v-if="milestoneGroups.length > 0" class="mm-ach__section">
          <div class="mm-eyebrow mm-eyebrow--strong">Operational milestones</div>
          <div class="mm-ach__grid mm-ach__grid--milestones">
            <button
              v-for="m in milestoneGroups"
              :key="m.achievementId"
              type="button"
              class="mm-ach__tile mm-ach__tile--milestone"
              :title="m.achievementName"
              @click="openAchievement(m)"
            >
              <img
                :src="getAchievementImage(m.achievementId, m.tier)"
                :alt="m.achievementName"
                loading="lazy"
                class="mm-ach__img"
              />
              <div class="mm-eyebrow" style="font-size: 9px">Milestone</div>
              <div class="mm-ach__tile-name">{{ m.achievementName }}</div>
              <div class="mm-ach__tile-date">{{ formatDate(m.latestAchievedAt) }}</div>
            </button>
          </div>
        </section>

        <section class="mm-ach__section">
          <div class="mm-ach__head-row">
            <div class="mm-eyebrow mm-eyebrow--strong">Trophy collection</div>
            <div class="mm-eyebrow">{{ totalEarned }} total</div>
          </div>
          <div class="mm-ach__grid">
            <button
              v-for="a in otherGroups"
              :key="a.achievementId"
              type="button"
              class="mm-ach__tile"
              :title="a.achievementName"
              @click="openAchievement(a)"
            >
              <span v-if="a.count > 1" class="mm-ach__count">×{{ a.count }}</span>
              <img
                :src="getAchievementImage(a.achievementId, a.tier)"
                :alt="a.achievementName"
                loading="lazy"
                class="mm-ach__img"
              />
              <div class="mm-eyebrow mm-ach__tile-tier" :class="tierClass(a.tier)">
                {{ a.tier || 'Standard' }}
              </div>
              <div class="mm-ach__tile-name">{{ a.achievementName }}</div>
              <div class="mm-ach__tile-date">{{ formatDate(a.latestAchievedAt) }}</div>
            </button>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.mm-ach {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.mm-ach__state { padding: 14px 0; }

.mm-ach__section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-ach__head-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mm-ach__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 14px;
}

.mm-ach__grid--milestones {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.mm-ach__tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 14px 10px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  transition: border-color 0.12s ease, background-color 0.12s ease;
  /* button reset */
  width: 100%;
  font: inherit;
  color: inherit;
  cursor: pointer;
  appearance: none;
}

.mm-ach__tile:hover {
  border-color: var(--mm-ink);
  background: var(--mm-bg-soft);
}

.mm-ach__tile-date {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-ach__drill-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--mm-rule);
  border-bottom: 1px solid var(--mm-rule);
}

.mm-ach__drill-head .mm-ach__img {
  width: 72px;
  height: 72px;
}

.mm-ach__row--clickable { cursor: pointer; }

.mm-ach__desc {
  margin-top: 10px;
  padding: 8px 12px;
  border-left: 2px solid var(--mm-accent);
  font-style: italic;
  color: var(--mm-ink-soft);
  font-size: 13px;
  line-height: 1.5;
  background: var(--mm-bg-soft);
}

.mm-ach__timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mm-ach__card {
  display: grid;
  grid-template-columns: 56px 1fr;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  transition: border-color 0.12s ease, background-color 0.12s ease;
  overflow: hidden;
}

.mm-ach__card--clickable { cursor: pointer; }
.mm-ach__card--clickable:hover {
  border-color: var(--mm-ink);
  background: var(--mm-bg-soft);
}

.mm-ach__card-rail {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 14px 6px;
  background: var(--mm-bg-soft);
  border-right: 1px solid var(--mm-rule);
}

.mm-ach__card-index {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--mm-ink-muted);
}

.mm-ach__card-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.mm-ach__card-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-ach__card-when {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-ach__card-date {
  font-family: var(--mm-font-display);
  font-size: 14px;
  color: var(--mm-ink);
  font-weight: 500;
}

.mm-ach__card-rel {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.mm-ach__card-highlight {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
  padding: 4px 10px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg);
  min-width: 70px;
}

.mm-ach__card-highlight-label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.mm-ach__card-highlight-value {
  font-family: var(--mm-font-display);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.1;
  margin-top: 2px;
}

.mm-ach__card-highlight--gold {
  border-color: var(--mm-kd-elite);
  background: rgba(138, 90, 24, 0.08);
}
.mm-ach__card-highlight--gold .mm-ach__card-highlight-value { color: var(--mm-kd-elite); }

.mm-ach__card-highlight--accent {
  border-color: var(--mm-accent-soft);
  background: rgba(200, 119, 43, 0.06);
}
.mm-ach__card-highlight--accent .mm-ach__card-highlight-value { color: var(--mm-accent); }

.mm-ach__card-highlight--success {
  border-color: var(--mm-success);
  background: rgba(90, 125, 58, 0.08);
}
.mm-ach__card-highlight--success .mm-ach__card-highlight-value { color: var(--mm-success); }

.mm-ach__card-highlight--kill {
  border-color: var(--mm-kill);
  background: rgba(168, 56, 56, 0.06);
}
.mm-ach__card-highlight--kill .mm-ach__card-highlight-value { color: var(--mm-kill); }

.mm-ach__card-summary {
  margin: 0;
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
  line-height: 1.4;
}

.mm-ach__card-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding-top: 4px;
}

.mm-ach__card-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-ach__card-stat-label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.mm-ach__card-stat-value {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  color: var(--mm-ink);
}

.mm-ach__card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px dashed var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  flex-wrap: wrap;
}

.mm-ach__card-foot-item { color: var(--mm-ink-soft); }

@media (max-width: 540px) {
  .mm-ach__card {
    grid-template-columns: 1fr;
  }
  .mm-ach__card-rail {
    border-right: 0;
    border-bottom: 1px solid var(--mm-rule);
    padding: 6px 12px;
    justify-content: flex-start;
  }
}

.mm-ach__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 16px;
}

.mm-ach__page--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

.mm-ach__view-toggle {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.mm-ach__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding-top: 4px;
}

.mm-ach__badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg);
  max-width: 100%;
}

.mm-ach__badge-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.mm-ach__badge-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mm-ach__badge-name {
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  color: var(--mm-ink);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-ach__badge-tier {
  font-size: 9px;
}

.mm-ach__tile--milestone {
  border-color: var(--mm-rule-strong);
}

.mm-ach__tile--milestone:hover {
  border-color: var(--mm-accent);
}

.mm-ach__img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  display: block;
}

.mm-ach__tile--milestone .mm-ach__img {
  width: 72px;
  height: 72px;
}

.mm-ach__tile-name {
  font-family: var(--mm-font-display);
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--mm-ink);
}

.mm-ach__tile-tier {
  font-size: 9px;
}

.mm-ach__count {
  position: absolute;
  top: 6px;
  right: 6px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-radius: 2px;
}

@media (max-width: 720px) {
  .mm-ach__grid,
  .mm-ach__grid--milestones {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  }
  .mm-ach__img { width: 44px; height: 44px; }
  .mm-ach__tile--milestone .mm-ach__img { width: 56px; height: 56px; }
}
</style>
