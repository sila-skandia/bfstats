<template>
  <div>
    <!-- Registration CTA banner -->
    <router-link
      v-if="tournament.status === 'registration'"
      :to="`/t/${tournamentId}/teams`"
      class="t2-reg-banner"
    >
      <div>
        <div class="t2-reg-banner__title">Team registrations are open</div>
        <div class="t2-reg-banner__sub">Create a squad or join one looking for players before rosters lock.</div>
      </div>
      <span class="t2-btn t2-btn--accent">
        Register your team <i
          class="pi pi-arrow-right"
          style="font-size: 11px"
        />
      </span>
    </router-link>

    <div class="t2-overview">
      <!-- Activity feed -->
      <div>
        <div class="t2-section-head">
          <span class="t2-section-head__mark">//</span>
          <h2 class="t2-section-head__title">Activity feed</h2>
          <span class="t2-section-head__meta">Live</span>
        </div>

        <div
          v-if="feedLoading && feedItems.length === 0"
          class="t2-loading"
          style="min-height: 200px"
        >
          <div class="t2-spinner" />
        </div>

        <!-- Fallback: no real activity yet — show the tournament creation event -->
        <ul
          v-else-if="feedItems.length === 0"
          class="t2-feed"
        >
          <li class="t2-feed__item">
            <span class="t2-feed__dot t2-feed__dot--accent" />
            <div class="t2-feed__kicker">
              <span class="t2-feed__kind t2-feed__kind--accent">Tournament created</span>
              <span class="t2-feed__sep">·</span>
              <span
                class="t2-feed__time"
                :title="formatLocalTooltip(tournament.createdAt)"
              >{{ formatRelativeTime(tournament.createdAt) }}</span>
            </div>
            <div class="t2-feed__title">
              {{ tournament.organizer ? `${tournament.organizer} created ${tournament.name}` : `${tournament.name} was created` }}
            </div>
            <div class="t2-feed__body">
              Updates, match results and team registrations will appear here as the tournament unfolds.
            </div>
          </li>
        </ul>

        <template v-else>
          <ul class="t2-feed">
            <li
              v-for="item in feedItems"
              :key="feedKey(item)"
              class="t2-feed__item"
            >
              <span
                class="t2-feed__dot"
                :class="{ 't2-feed__dot--accent': isAccentKind(item) }"
              />
              <div class="t2-feed__kicker">
                <span
                  class="t2-feed__kind"
                  :class="{ 't2-feed__kind--accent': isAccentKind(item) }"
                >{{ kindLabel(item) }}</span>
                <span class="t2-feed__sep">·</span>
                <span
                  class="t2-feed__time"
                  :title="formatLocalTooltip(item.timestamp)"
                >{{ formatRelativeTime(item.timestamp) }}</span>
              </div>

              <!-- Post -->
              <template v-if="item.type === 'post' && isPostData(item.data)">
                <div class="t2-feed__title">{{ item.data.title }}</div>
                <div
                  class="t2-md t2-feed__body"
                  v-html="renderMarkdown(item.data.content)"
                />
              </template>

              <!-- Match result -->
              <template v-else-if="item.type === 'match_result' && isMatchResultData(item.data)">
                <div class="t2-feed__title">
                  {{ resultHeadline(item.data) }}
                </div>
                <div class="t2-feed__result">
                  <span style="color: var(--t-text)">{{ item.data.team1Name }}</span>
                  <span class="t2-feed__result-score">{{ item.data.team1Tickets }} – {{ item.data.team2Tickets }}</span>
                  <span style="color: var(--t-text)">{{ item.data.team2Name }}</span>
                  <span class="t2-feed__sep">·</span>
                  <span class="t2-feed__time">{{ item.data.mapName }}</span>
                </div>
              </template>

              <!-- Team registered -->
              <template v-else-if="item.type === 'team_created' && isTeamCreatedData(item.data)">
                <div class="t2-feed__title">{{ item.data.teamName }} join the tournament</div>
              </template>

              <!-- Match scheduled -->
              <template v-else-if="item.type === 'match_scheduled' && isMatchScheduledData(item.data)">
                <div class="t2-feed__title">{{ item.data.team1Name }} vs {{ item.data.team2Name }} added to schedule</div>
                <div class="t2-feed__body">
                  {{ formatAbsoluteTime(item.data.scheduledDate) }}<template v-if="item.data.week"> · {{ item.data.week }}</template><template v-if="item.data.maps.length"> · {{ item.data.maps.join(' + ') }}</template>
                </div>
              </template>
            </li>
          </ul>

          <div style="display: flex; align-items: center; gap: 14px; margin-top: 6px">
            <button
              v-if="feedHasMore"
              class="t2-load-more"
              :disabled="feedLoading"
              @click="loadFeed()"
            >
              {{ feedLoading ? 'Loading…' : 'Load earlier updates' }}
            </button>
            <span
              v-else
              class="t2-eyebrow"
            >You've reached the beginning</span>
          </div>
        </template>
      </div>

      <!-- Sidebar: discussion rail + standings + promo -->
      <div>
        <T2CommentThread
          :tournament-id="tournamentId"
          title="Discussion"
          variant="rail"
          style="margin-bottom: 32px"
        />

        <template v-if="topTeams.length">
          <div class="t2-section-head">
            <span class="t2-section-head__mark">//</span>
            <h2 class="t2-section-head__title">Standings</h2>
            <router-link
              :to="`/t/${tournamentId}/rankings`"
              class="t2-section-head__meta"
            >
              Top {{ topTeams.length }} ↗
            </router-link>
          </div>
          <ul class="t2-mini-standings">
            <li
              v-for="team in topTeams"
              :key="team.teamId"
              class="t2-mini-standings__row"
            >
              <span
                class="t2-mini-standings__rank"
                :class="rankClass(team.rank)"
              >{{ team.rank }}</span>
              <span class="t2-mini-standings__team">{{ team.teamName }}</span>
              <span class="t2-mini-standings__pts">{{ team.points }}</span>
            </li>
          </ul>
        </template>

        <div
          v-if="promoVideoId"
          class="t2-promo"
        >
          <div class="t2-promo__frame">
            <iframe
              :src="`https://www.youtube.com/embed/${promoVideoId}`"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
              title="Tournament promo video"
            />
          </div>
          <div class="t2-promo__caption">Promo</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Icon font for the `pi pi-*` classes in this component's template. Imported
// here rather than via a <link> in index.html so it ships in this route's CSS
// chunk — it used to be a render-blocking stylesheet fetched from unpkg.com on
// every page load, including the three routes that never use an icon from it.
import 'primeicons/primeicons.css'
import { ref, computed, onMounted, watch } from 'vue'
import { marked } from 'marked'
import type { PublicTournamentDetail } from '@/services/publicTournamentService'
import { publicTournamentService } from '@/services/publicTournamentService'
import T2CommentThread from './T2CommentThread.vue'
import {
  tournamentFeedService,
  isPostData,
  isMatchResultData,
  isTeamCreatedData,
  isMatchScheduledData,
  type FeedItem,
  type FeedMatchResultData,
} from '@/services/tournamentFeedService'
import { formatRelativeTime, formatAbsoluteTime, formatLocalTooltip } from '@/utils/timeUtils'

const props = defineProps<{
  tournament: PublicTournamentDetail
  tournamentId: string
}>()

// ----- Feed (cursor-paginated) -----
const feedItems = ref<FeedItem[]>([])
const feedLoading = ref(false)
const feedHasMore = ref(true)
const feedCursor = ref<string | null>(null)

const loadFeed = async (reset = false) => {
  if (feedLoading.value) return
  feedLoading.value = true
  try {
    const cursor = reset ? undefined : feedCursor.value ?? undefined
    const response = await tournamentFeedService.getFeed(props.tournamentId, cursor, 10)
    feedItems.value = reset ? response.items : [...feedItems.value, ...response.items]
    feedCursor.value = response.nextCursor
    feedHasMore.value = response.hasMore
  } catch (err) {
    console.error('Error loading tournament feed:', err)
  } finally {
    feedLoading.value = false
  }
}

const feedKey = (item: FeedItem): string => {
  const d = item.data as unknown as Record<string, unknown>
  if (item.type === 'post') return `post-${d.id}`
  if (item.type === 'match_result') return `result-${d.resultId}`
  if (item.type === 'team_created') return `team-${d.teamId}`
  if (item.type === 'match_scheduled') return `sched-${d.matchId}`
  return `${item.type}-${item.timestamp}`
}

const KIND_LABELS: Record<FeedItem['type'], string> = {
  post: 'Announcement',
  match_result: 'Match result',
  team_created: 'Team registered',
  match_scheduled: 'Match scheduled',
}
const kindLabel = (item: FeedItem) => KIND_LABELS[item.type] ?? item.type
const isAccentKind = (item: FeedItem) => item.type === 'post' || item.type === 'match_scheduled'

const resultHeadline = (data: FeedMatchResultData): string => {
  if (!data.winningTeamName) return `${data.team1Name} tie ${data.team2Name}`
  const loser = data.winningTeamName === data.team1Name ? data.team2Name : data.team1Name
  return `${data.winningTeamName} defeat ${loser}`
}

const renderMarkdown = (content: string): string => {
  try {
    return marked(content, { breaks: true }) as string
  } catch {
    return ''
  }
}

// ----- Standings sidebar -----
const topTeams = ref<{ teamId: number; teamName: string; rank: number; points: number }[]>([])

const loadStandings = async () => {
  try {
    const data = await publicTournamentService.getLeaderboard(props.tournamentId)
    topTeams.value = (data.rankings ?? []).slice(0, 4)
  } catch (err) {
    console.debug('No leaderboard available:', err)
  }
}

const rankClass = (rank: number) => (rank >= 1 && rank <= 3 ? `t2-rank--${rank}` : undefined)

// ----- Promo video -----
const promoVideoId = computed(() => {
  const url = props.tournament.promoVideoUrl
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
})

onMounted(() => {
  loadFeed(true)
  loadStandings()
})

watch(() => props.tournamentId, () => {
  loadFeed(true)
  loadStandings()
})
</script>
