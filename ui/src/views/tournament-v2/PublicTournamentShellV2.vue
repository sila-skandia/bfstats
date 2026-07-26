<template>
  <div
    class="t2"
    :style="themeStyle"
  >
    <!-- Organiser strip — the tournament owns this bar; bfstats is a small credit -->
    <div class="t2-strip">
      <div class="t2-container t2-strip__inner">
        <router-link
          :to="`/t/${tournamentId}`"
          class="t2-strip__brand"
        >
          <img
            v-if="logoImageUrl"
            :src="logoImageUrl"
            alt=""
            class="t2-strip__logo"
          >
          <span
            v-else
            class="t2-strip__dot"
          />
          <span class="t2-strip__name">{{ tournament.name }}</span>
        </router-link>
        <router-link
          to="/"
          class="t2-strip__credit"
        >
          Hosted on bfstats <i
            class="pi pi-external-link"
            style="font-size: 9px"
          />
        </router-link>
      </div>
    </div>

    <!-- Draft / Coming Soon Banner -->
    <div
      v-if="tournament.status === 'draft'"
      class="t2-draft-banner"
    >
      <div class="t2-container t2-draft-banner__inner">
        <i class="pi pi-clock" style="font-size: 14px; margin-right: 8px" />
        <span><strong>Tournament Coming Soon</strong> — This competition is currently in draft mode. Schedules, team sign-ups, and rules will be published shortly.</span>
      </div>
    </div>

    <!-- Hero cover band -->
    <section
      class="t2-hero"
      :style="heroImageUrl ? { backgroundImage: `url(${heroImageUrl})` } : undefined"
    >
      <div class="t2-hero__scrim-x" />
      <div class="t2-hero__scrim-y" />
      <div class="t2-container t2-hero__inner">
        <div class="t2-hero__id">
          <div class="t2-hero__eyebrow">
            <span class="t2-status">
              <span class="t2-status__dot" />{{ statusLabel }}
            </span>
            <span
              v-if="tournament.organizer"
              class="t2-hero__presented"
            >Presented by {{ $pn(tournament.organizer) }}</span>
          </div>
          <h1 class="t2-hero__title">
            {{ titleParts.tail ? titleParts.head + ' ' : titleParts.head }}<span
              v-if="titleParts.tail"
              style="color: var(--t-accent)"
            >{{ titleParts.tail }}</span>
          </h1>
          <div class="t2-hero__meta">
            <strong>{{ gameLabel }}</strong>
            <template v-if="tournament.gameMode">
              <span class="t2-hero__meta-sep">/</span><span>{{ tournament.gameMode }}</span>
            </template>
            <template v-if="teamCount > 0">
              <span class="t2-hero__meta-sep">/</span><span>{{ teamCount }} {{ teamCount === 1 ? 'team' : 'teams' }}</span>
            </template>
            <span class="t2-hero__meta-sep">/</span><span>Since {{ sinceLabel }}</span>
          </div>
        </div>
        <div class="t2-hero__side">
          <div
            v-if="progress"
            class="t2-hero__progress"
          >
            <span class="t2-hero__progress-label"><strong>{{ progress.played }}</strong> of {{ progress.total }} matches</span>
            <div class="t2-hero__progress-track">
              <div
                class="t2-hero__progress-fill"
                :style="{ width: progress.pct }"
              />
            </div>
          </div>
          <div
            v-if="tournament.twitchUrl || socialLinks.length"
            class="t2-hero__actions"
          >
            <a
              v-if="tournament.twitchUrl"
              :href="tournament.twitchUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="t2-btn t2-btn--accent"
            >
              Watch live <i
                class="pi pi-play"
                style="font-size: 11px"
              />
            </a>
            <a
              v-for="link in socialLinks"
              :key="link.icon"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="t2-btn t2-btn--hero-icon"
              :aria-label="link.label"
              :title="link.label"
            >
              <i :class="`pi ${link.icon}`" />
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Sticky league nav -->
    <nav class="t2-nav">
      <div class="t2-container t2-nav__inner">
        <router-link
          v-for="tab in tabs"
          :key="tab.id"
          v-slot="{ navigate }"
          :to="tab.to"
          custom
        >
          <button
            class="t2-nav__tab"
            :class="{ 't2-nav__tab--active': section === tab.id }"
            @click="navigate()"
          >
            {{ tab.label }}
            <span
              v-if="tab.badge"
              class="t2-nav__badge"
            >{{ tab.badge }}</span>
          </button>
        </router-link>
      </div>
    </nav>

    <!-- Section body -->
    <main class="t2-main">
      <div class="t2-container">
        <T2Overview
          v-if="section === 'overview'"
          :tournament="tournament"
          :tournament-id="tournamentId"
        />
        <T2Rankings
          v-else-if="section === 'rankings'"
          :tournament="tournament"
          :tournament-id="tournamentId"
        />
        <T2Matches
          v-else-if="section === 'matches'"
          :tournament="tournament"
          :tournament-id="tournamentId"
        />
        <T2Rules
          v-else-if="section === 'rules'"
          :tournament="tournament"
        />
        <T2Teams
          v-else-if="section === 'teams'"
          :tournament="tournament"
          :tournament-id="tournamentId"
          @refresh="emit('refresh')"
        />
        <T2Files
          v-else-if="section === 'files'"
          :tournament="tournament"
        />
        <div
          v-else
          class="t2-empty"
        >
          Nothing tracked for this page.
        </div>
      </div>
    </main>

    <!-- Footer — organiser first, bfstats credit -->
    <footer class="t2-footer">
      <div class="t2-container t2-footer__inner">
        <span class="t2-footer__brand"><span class="t2-footer__dot" />{{ tournament.name }}</span>
        <span>Powered by <router-link to="/">bfstats.io</router-link></span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { PublicTournamentDetail } from '@/services/publicTournamentService'
import { formatDate } from '@/utils/timeUtils'
import T2Overview from '@/components/tournament-v2/T2Overview.vue'
import T2Rankings from '@/components/tournament-v2/T2Rankings.vue'
import T2Matches from '@/components/tournament-v2/T2Matches.vue'
import T2Rules from '@/components/tournament-v2/T2Rules.vue'
import T2Teams from '@/components/tournament-v2/T2Teams.vue'
import T2Files from '@/components/tournament-v2/T2Files.vue'

export type T2Section = 'overview' | 'rankings' | 'matches' | 'rules' | 'teams' | 'files' | 'stats'

const props = defineProps<{
  tournament: PublicTournamentDetail
  tournamentId: string
  section: T2Section
  heroImageUrl: string | null
  logoImageUrl: string | null
}>()

const emit = defineEmits<{ refresh: [] }>()

// The three theme inputs; everything else derives in tournament-v2.css.
const V2_DEFAULTS = { bg: '#14100c', text: '#f2ece0', accent: '#c8a24a' }

const isValidHex = (v: string | undefined | null): v is string =>
  !!v && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())

const themeStyle = computed(() => {
  const theme = props.tournament.theme
  return {
    '--t-bg': isValidHex(theme?.backgroundColour) ? theme!.backgroundColour!.trim() : V2_DEFAULTS.bg,
    '--t-text': isValidHex(theme?.textColour) ? theme!.textColour!.trim() : V2_DEFAULTS.text,
    '--t-accent': isValidHex(theme?.accentColour) ? theme!.accentColour!.trim() : V2_DEFAULTS.accent,
  }
})

// Last word of the title carries the accent (the mock's "Silver Bullet <accent>League</accent>")
const titleParts = computed(() => {
  const words = props.tournament.name.trim().split(/\s+/)
  if (words.length < 2) return { head: props.tournament.name, tail: '' }
  return { head: words.slice(0, -1).join(' '), tail: words[words.length - 1] }
})

const statusLabel = computed(() => {
  switch (props.tournament.status) {
    case 'draft': return 'Draft · Coming Soon'
    case 'registration': return 'Registration Open'
    case 'open': return 'Active · Open'
    case 'closed': return 'Closed'
    default: return 'Active'
  }
})

const gameLabel = computed(() => {
  switch (props.tournament.game) {
    case 'bf1942': return 'BF1942'
    case 'fh2': return 'FH2'
    case 'bfvietnam': return 'BF Vietnam'
    default: return String(props.tournament.game ?? '').toUpperCase()
  }
})

const teamCount = computed(() => props.tournament.teams?.length ?? 0)
const sinceLabel = computed(() => formatDate(props.tournament.createdAt))

const completedMatchCount = computed(() => {
  const groups = props.tournament.matchesByWeek ?? []
  let played = 0
  for (const group of groups) {
    for (const match of group.matches) {
      if (match.maps?.some(m => m.matchResults?.length > 0)) played++
    }
  }
  return played
})

const totalMatchCount = computed(() =>
  (props.tournament.matchesByWeek ?? []).reduce((n, g) => n + g.matches.length, 0))

const progress = computed(() => {
  const total = props.tournament.anticipatedRoundCount
  if (!total || total <= 0) return null
  const played = Math.min(completedMatchCount.value, total)
  return { played, total, pct: `${Math.round((played / total) * 100)}%` }
})

const socialLinks = computed(() => {
  const links: { icon: string; url: string; label: string }[] = []
  if (props.tournament.discordUrl) links.push({ icon: 'pi-discord', url: props.tournament.discordUrl, label: 'Discord' })
  if (props.tournament.youTubeUrl) links.push({ icon: 'pi-youtube', url: props.tournament.youTubeUrl, label: 'YouTube' })
  if (props.tournament.twitchUrl) links.push({ icon: 'pi-twitch', url: props.tournament.twitchUrl, label: 'Twitch' })
  if (props.tournament.forumUrl) links.push({ icon: 'pi-comments', url: props.tournament.forumUrl, label: 'Forum' })
  return links
})

const fileCount = computed(() => props.tournament.files?.length ?? 0)

// No Stats tab: there is no public player-stats aggregation endpoint yet.
const tabs = computed(() => [
  { id: 'overview', label: 'Overview', to: `/t/${props.tournamentId}`, badge: '' },
  { id: 'rankings', label: 'Rankings', to: `/t/${props.tournamentId}/rankings`, badge: teamCount.value ? String(teamCount.value) : '' },
  { id: 'matches', label: 'Matches', to: `/t/${props.tournamentId}/matches`, badge: totalMatchCount.value ? String(totalMatchCount.value) : '' },
  { id: 'rules', label: 'Rules', to: `/t/${props.tournamentId}/rules`, badge: '' },
  { id: 'teams', label: 'Teams', to: `/t/${props.tournamentId}/teams`, badge: teamCount.value ? String(teamCount.value) : '' },
  { id: 'files', label: 'Files', to: `/t/${props.tournamentId}/files`, badge: fileCount.value ? String(fileCount.value) : '' },
])

// Load the league display fonts once (Oswald + Barlow); Geist Mono ships with the app.
const FONT_LINK_ID = 't2-league-fonts'
onMounted(() => {
  if (document.getElementById(FONT_LINK_ID)) return
  const link = document.createElement('link')
  link.id = FONT_LINK_ID
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Barlow:wght@400;500;600;700&display=swap'
  document.head.appendChild(link)
})
</script>

<style src="@/styles/tournament-v2.css"></style>
