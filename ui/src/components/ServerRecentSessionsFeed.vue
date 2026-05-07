<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { fetchSessions } from '@/services/playerStatsApi';
import { formatRelativeTimeShort as formatRelativeTime } from '@/utils/timeUtils';
import { getMapAccentColor } from '@/utils/statsUtils';

interface TopPlayer {
  playerName: string;
  score: number;
  kills: number;
  deaths: number;
}
interface FeedSession {
  roundId: string;
  serverName: string;
  serverGuid: string;
  mapName: string;
  gameType: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  participantCount: number;
  totalSessions: number;
  isActive: boolean;
  team1Label?: string;
  team2Label?: string;
  team1Points?: number;
  team2Points?: number;
  topPlayers?: TopPlayer[];
}

const props = defineProps<{
  serverGuid?: string;
  serverName?: string;
  limit?: number;
  initialVisibleCount?: number;
  filters?: Record<string, string>;
  emptyMessage?: string;
}>();

const router = useRouter();
const sessions = ref<FeedSession[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
const isExpanded = ref(false);

const filtersKey = computed(() => {
  if (!props.filters) return '';
  return JSON.stringify(
    Object.entries(props.filters).sort(([a], [b]) => a.localeCompare(b))
  );
});

const visibleSessions = computed(() => {
  if (props.initialVisibleCount && !isExpanded.value) {
    return sessions.value.slice(0, props.initialVisibleCount);
  }
  return sessions.value;
});
const hasMore = computed(() =>
  !!props.initialVisibleCount && sessions.value.length > (props.initialVisibleCount || 0)
);

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return r > 0 ? `${d}d ${r}h` : `${d}d`;
};

const getWinner = (s: FeedSession): 'team1' | 'team2' | 'draw' | null => {
  if (s.team1Points === undefined || s.team2Points === undefined) return null;
  if (s.team1Points === s.team2Points) return 'draw';
  return s.team1Points > s.team2Points ? 'team1' : 'team2';
};

const toRoundReport = (s: FeedSession) => {
  router.push({ name: 'round-report', params: { roundId: s.roundId } });
};

const goPlayer = (name: string, e?: Event) => {
  e?.stopPropagation();
  router.push({ name: 'player-details', params: { playerName: name } });
};

const load = async () => {
  if (!props.serverGuid) return;
  isLoading.value = true;
  error.value = null;
  try {
    const filters: Record<string, string> = { serverGuid: props.serverGuid };
    if (props.filters) {
      for (const [k, v] of Object.entries(props.filters)) {
        if (v !== undefined && v !== null && v !== '') filters[k] = v;
      }
    }
    const res = await fetchSessions(1, props.limit || 5, filters, 'startTime', 'desc');
    sessions.value = res.items as unknown as FeedSession[];
  } catch (e) {
    console.error(e);
    error.value = 'Failed to load sessions';
  } finally {
    isLoading.value = false;
  }
};

onMounted(load);
watch(() => [props.serverGuid, filtersKey.value], load);
</script>

<template>
  <div class="rsf-root">
    <div
      v-if="isLoading"
      class="rsf-state"
    >
      <div class="explorer-spinner" />
    </div>

    <div
      v-else-if="error"
      class="rsf-state"
    >
      <div class="rsf-error">
        {{ error }}
      </div>
      <button
        class="rsf-retry"
        @click="load"
      >
        Try again
      </button>
    </div>

    <div
      v-else-if="sessions.length === 0"
      class="rsf-state rsf-empty"
    >
      {{ emptyMessage || 'No recent sessions found' }}
    </div>

    <div
      v-else
      class="rsf-feed"
    >
      <div
        class="rsf-hint"
        aria-hidden="true"
      >
        <span class="rsf-hint__pulse" />
        <span class="rsf-hint__text">
          <span class="text-neon-cyan">TAP</span> ANY ROUND FOR FULL
          <span class="text-neon-cyan">DEBRIEFING</span> —
          TIMELINE · PHASE CHARTS · PLAYER BREAKDOWN
        </span>
      </div>

      <article
        v-for="(s, idx) in visibleSessions"
        :key="s.roundId"
        class="rsf-card"
        :class="{ 'rsf-card--live': s.isActive && idx === 0 }"
        role="button"
        tabindex="0"
        @click="toRoundReport(s)"
        @keydown.enter="toRoundReport(s)"
      >
        <span
          class="rsf-card__accent"
          aria-hidden="true"
        />
        <span
          class="rsf-card__timeline-dot"
          aria-hidden="true"
        />

        <header class="rsf-card__head">
          <div class="rsf-card__map-wrap">
            <h4
              class="rsf-card__map"
              :class="getMapAccentColor(s.mapName)"
            >
              {{ s.mapName }}
            </h4>
            <span
              v-if="s.gameType"
              class="rsf-card__mode"
            >{{ s.gameType }}</span>
            <span
              v-if="s.isActive && idx === 0"
              class="rsf-card__live-pill"
            >
              <span
                class="rsf-card__live-dot"
                aria-hidden="true"
              />
              LIVE
            </span>
          </div>
          <div class="rsf-card__time">
            <span class="rsf-card__time-value">{{ formatRelativeTime(s.startTime) }}</span>
            <span class="rsf-card__time-label">ago</span>
          </div>
        </header>

        <div
          v-if="getWinner(s)"
          class="rsf-card__duel"
        >
          <div
            class="rsf-duel-side"
            :class="{ 'rsf-duel-side--winner': getWinner(s) === 'team1' }"
          >
            <span class="rsf-duel-side__label">{{ s.team1Label || 'TEAM 1' }}</span>
            <span class="rsf-duel-side__pts">{{ s.team1Points }}</span>
          </div>
          <span
            class="rsf-duel-vs"
            aria-hidden="true"
          >VS</span>
          <div
            class="rsf-duel-side rsf-duel-side--right"
            :class="{ 'rsf-duel-side--winner': getWinner(s) === 'team2' }"
          >
            <span class="rsf-duel-side__pts">{{ s.team2Points }}</span>
            <span class="rsf-duel-side__label">{{ s.team2Label || 'TEAM 2' }}</span>
          </div>
          <span
            v-if="getWinner(s) === 'draw'"
            class="rsf-duel-tag rsf-duel-tag--draw"
          >DEADLOCK</span>
          <span
            v-else
            class="rsf-duel-tag rsf-duel-tag--victor"
          >VICTOR → {{ getWinner(s) === 'team1' ? (s.team1Label || 'TEAM 1') : (s.team2Label || 'TEAM 2') }}</span>
        </div>

        <div
          v-if="s.topPlayers && s.topPlayers.length > 0"
          class="rsf-card__top"
        >
          <span class="rsf-card__top-tag">MVP</span>
          <span
            class="rsf-card__top-chev"
            aria-hidden="true"
          >▸</span>
          <button
            type="button"
            class="rsf-card__top-name"
            :title="`View ${$pn(s.topPlayers[0].playerName)}`"
            @click="goPlayer(s.topPlayers[0].playerName, $event)"
          >
            {{ $pn(s.topPlayers[0].playerName) }}
          </button>
          <span class="rsf-card__top-stat">
            <span class="rsf-card__top-num">{{ s.topPlayers[0].score.toLocaleString() }}</span>
            <span class="rsf-card__top-unit">pts</span>
          </span>
          <span class="rsf-card__top-stat">
            <span class="rsf-card__top-num rsf-card__top-num--k">{{ s.topPlayers[0].kills }}</span>
            <span class="rsf-card__top-unit">K</span>
            <span class="rsf-card__top-slash">/</span>
            <span class="rsf-card__top-num rsf-card__top-num--d">{{ s.topPlayers[0].deaths }}</span>
            <span class="rsf-card__top-unit">D</span>
          </span>
          <span
            v-if="s.topPlayers.length > 1"
            class="rsf-card__top-plus"
            :title="s.topPlayers.slice(1, 3).map(p => $pn(p.playerName)).join(', ')"
          >+{{ Math.min(s.topPlayers.length - 1, 2) }} more</span>
        </div>

        <footer class="rsf-card__foot">
          <span class="rsf-card__meta">
            <span
              class="rsf-card__meta-icon"
              aria-hidden="true"
            >◴</span>
            {{ formatDuration(s.durationMinutes) }}
          </span>
          <span class="rsf-card__meta-dot" />
          <span class="rsf-card__meta">
            <span
              class="rsf-card__meta-icon"
              aria-hidden="true"
            >◉</span>
            {{ s.participantCount }} operatives
          </span>
          <span
            class="rsf-briefing"
            :class="{ 'rsf-briefing--new': idx === 0 }"
            aria-hidden="true"
          >
            <span class="briefing-chart">
              <span /><span /><span />
            </span>
            <span class="rsf-briefing__label">Open Briefing</span>
            <span class="rsf-briefing__arrow">▸</span>
          </span>
        </footer>
      </article>

      <div
        v-if="hasMore"
        class="rsf-more"
      >
        <button
          v-if="!isExpanded"
          class="rsf-more__btn"
          @click="isExpanded = true"
        >
          Show {{ sessions.length - (initialVisibleCount || 0) }} more
          <span aria-hidden="true">▼</span>
        </button>
        <button
          v-else
          class="rsf-more__btn"
          @click="isExpanded = false"
        >
          Show less
          <span aria-hidden="true">▲</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rsf-root { padding: 0.75rem 1rem 1rem; }
.rsf-state {
  padding: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-secondary, #8b949e);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}
.rsf-error { color: #ff4d6d; }
.rsf-retry {
  background: none;
  border: 1px solid rgba(0, 229, 255, 0.35);
  color: #00e5ff;
  padding: 0.3rem 0.7rem;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}
.rsf-retry:hover { background: rgba(0, 229, 255, 0.08); }

.rsf-feed {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.rsf-feed::before {
  content: '';
  position: absolute;
  top: 1.1rem;
  bottom: 1.1rem;
  left: 13px;
  width: 1px;
  background: linear-gradient(180deg,
    transparent,
    rgba(0, 229, 255, 0.25) 10%,
    rgba(0, 229, 255, 0.25) 90%,
    transparent);
  pointer-events: none;
}

.rsf-card {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.45rem;
  padding: 0.75rem 0.9rem 0.75rem 1.75rem;
  margin-left: 0.6rem;
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.03), transparent 40%),
    rgba(13, 13, 24, 0.55);
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 5px;
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
  outline: none;
}
.rsf-card:hover,
.rsf-card:focus-visible {
  border-color: rgba(0, 229, 255, 0.5);
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.06), transparent 40%),
    rgba(13, 13, 24, 0.75);
  transform: translateY(-1px);
}
.rsf-card--live {
  border-color: rgba(52, 211, 153, 0.45);
  background:
    linear-gradient(90deg, rgba(52, 211, 153, 0.06), transparent 40%),
    rgba(13, 13, 24, 0.6);
}

.rsf-card__accent {
  position: absolute;
  left: 0;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 3px;
  background: linear-gradient(180deg, #00e5ff, rgba(0, 229, 255, 0.1));
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.35);
}
.rsf-card--live .rsf-card__accent {
  background: linear-gradient(180deg, #34d399, rgba(52, 211, 153, 0.1));
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.5);
}
.rsf-card__timeline-dot {
  position: absolute;
  left: -0.3rem;
  top: 1rem;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #0a0a0f;
  border: 2px solid #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.5);
}
.rsf-card--live .rsf-card__timeline-dot {
  border-color: #34d399;
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.6);
  animation: rsf-live-pulse 1.6s ease-in-out infinite;
}
@keyframes rsf-live-pulse {
  0%, 100% { box-shadow: 0 0 10px rgba(52, 211, 153, 0.4); }
  50%      { box-shadow: 0 0 14px rgba(52, 211, 153, 0.9); }
}

.rsf-card__head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.rsf-card__map-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.rsf-card__map {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  margin: 0;
}
.rsf-card__mode {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary, #8b949e);
  padding: 0.15rem 0.4rem;
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 2px;
}
.rsf-card__live-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  color: #34d399;
  padding: 0.15rem 0.45rem;
  background: rgba(52, 211, 153, 0.08);
  border: 1px solid rgba(52, 211, 153, 0.35);
  border-radius: 999px;
  text-transform: uppercase;
}
.rsf-card__live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
  animation: rsf-live-pulse 1.4s ease-in-out infinite;
}
.rsf-card__time {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary, #8b949e);
  margin-left: auto;
}
.rsf-card__time-value { color: var(--text-primary, #e6edf3); font-weight: 600; }

.rsf-card__duel {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  flex-wrap: wrap;
}
.rsf-duel-side {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 3px;
  color: var(--text-secondary, #8b949e);
  letter-spacing: 0.08em;
}
.rsf-duel-side--right { flex-direction: row-reverse; }
.rsf-duel-side__label {
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.rsf-duel-side__pts {
  color: var(--text-primary, #e6edf3);
  font-weight: 700;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.rsf-duel-side--winner {
  color: #00e5ff;
  border-color: rgba(0, 229, 255, 0.45);
  background: rgba(0, 229, 255, 0.06);
}
.rsf-duel-side--winner .rsf-duel-side__pts { color: #00e5ff; text-shadow: 0 0 6px rgba(0, 229, 255, 0.35); }
.rsf-duel-vs {
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  color: rgba(139, 148, 158, 0.55);
  font-weight: 700;
}
.rsf-duel-tag {
  margin-left: auto;
  padding: 0.15rem 0.45rem;
  border: 1px solid rgba(0, 229, 255, 0.3);
  border-radius: 2px;
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.06);
}
.rsf-duel-tag--draw {
  color: var(--text-secondary, #8b949e);
  border-color: rgba(139, 148, 158, 0.35);
  background: rgba(139, 148, 158, 0.06);
}

.rsf-card__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.4rem 0.55rem;
  border: 1px dashed rgba(168, 139, 250, 0.25);
  border-radius: 3px;
  background: rgba(168, 139, 250, 0.04);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem;
}
.rsf-card__top-tag {
  font-size: 0.55rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #a78bfa;
  font-weight: 700;
}
.rsf-card__top-chev { color: #a78bfa; }
.rsf-card__top-name {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--text-primary, #e6edf3);
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  border-bottom: 1px dotted rgba(168, 139, 250, 0.45);
}
.rsf-card__top-name:hover { color: #a78bfa; }
.rsf-card__top-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  color: var(--text-secondary, #8b949e);
  text-transform: uppercase;
  font-size: 0.55rem;
  letter-spacing: 0.14em;
}
.rsf-card__top-num {
  color: var(--text-primary, #e6edf3);
  font-weight: 700;
  font-size: 0.8rem;
}
.rsf-card__top-num--k { color: #00e5ff; }
.rsf-card__top-num--d { color: #ff4d6d; }
.rsf-card__top-slash { color: rgba(139, 148, 158, 0.45); }
.rsf-card__top-unit { font-size: 0.55rem; }
.rsf-card__top-plus {
  margin-left: auto;
  font-size: 0.55rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary, #8b949e);
}

.rsf-card__foot {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary, #8b949e);
}
.rsf-card__meta {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.rsf-card__meta-icon { color: #00e5ff; font-size: 0.75rem; }
.rsf-card__meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(139, 148, 158, 0.4);
}
.rsf-card__cta {
  margin-left: auto;
  color: #00e5ff;
  letter-spacing: 0.18em;
  font-weight: 600;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 180ms ease, transform 180ms ease;
}
.rsf-card:hover .rsf-card__cta,
.rsf-card:focus-visible .rsf-card__cta {
  opacity: 1;
  transform: translateX(0);
}

/* ——— OPEN BRIEFING chip (always-visible click affordance) ——— */
.rsf-briefing {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.28rem 0.6rem 0.28rem 0.5rem;
  border: 1px dashed rgba(0, 229, 255, 0.5);
  border-radius: 3px;
  background: linear-gradient(
    135deg,
    rgba(0, 229, 255, 0.05) 0%,
    rgba(0, 229, 255, 0.12) 100%
  );
  color: #00e5ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  font-weight: 700;
  text-transform: uppercase;
  transition:
    background 200ms ease,
    border-color 200ms ease,
    box-shadow 200ms ease,
    transform 200ms ease,
    color 200ms ease;
}
.rsf-briefing__label { line-height: 1; }
.rsf-briefing__arrow {
  font-size: 0.85rem;
  line-height: 1;
  transition: transform 200ms ease;
}

/* mini bar-chart icon carved from CSS — evokes "report with charts" */
.briefing-chart {
  display: inline-flex;
  align-items: flex-end;
  justify-content: space-between;
  width: 15px;
  height: 13px;
  padding: 2px 2px 1px;
  border: 1px solid currentColor;
  border-radius: 2px;
  box-sizing: border-box;
}
.briefing-chart > span {
  width: 2px;
  background: currentColor;
  display: block;
  transition: height 320ms ease;
}
.briefing-chart > span:nth-child(1) { height: 38%; }
.briefing-chart > span:nth-child(2) { height: 72%; }
.briefing-chart > span:nth-child(3) { height: 52%; }

.rsf-card:hover .rsf-briefing,
.rsf-card:focus-visible .rsf-briefing {
  background: linear-gradient(
    135deg,
    rgba(0, 229, 255, 0.18) 0%,
    rgba(0, 229, 255, 0.28) 100%
  );
  border-style: solid;
  border-color: #00e5ff;
  box-shadow:
    0 0 0 1px rgba(0, 229, 255, 0.25),
    0 6px 18px -6px rgba(0, 229, 255, 0.55);
  transform: translateX(2px);
  color: #e0fbff;
}
.rsf-card:hover .rsf-briefing__arrow,
.rsf-card:focus-visible .rsf-briefing__arrow {
  transform: translateX(3px);
}
.rsf-card:hover .briefing-chart > span:nth-child(1),
.rsf-card:focus-visible .briefing-chart > span:nth-child(1) { height: 62%; }
.rsf-card:hover .briefing-chart > span:nth-child(2),
.rsf-card:focus-visible .briefing-chart > span:nth-child(2) { height: 92%; }
.rsf-card:hover .briefing-chart > span:nth-child(3),
.rsf-card:focus-visible .briefing-chart > span:nth-child(3) { height: 45%; }

/* subtle attention-pull on the newest card's chip */
.rsf-briefing--new {
  animation: briefing-pulse 2.6s ease-in-out infinite;
}
@keyframes briefing-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(0, 229, 255, 0.0);
  }
  50% {
    box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.18),
                0 0 14px rgba(0, 229, 255, 0.35);
  }
}

/* ——— top-of-feed hint line ——— */
.rsf-hint {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.25rem;
  border-left: 2px solid rgba(0, 229, 255, 0.45);
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.08), transparent 70%);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-secondary, #8b949e);
}
.rsf-hint__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.75);
  animation: rsf-hint-blink 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes rsf-hint-blink {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1); }
}
.text-neon-cyan { color: #00e5ff; font-weight: 700; }

@media (prefers-reduced-motion: reduce) {
  .rsf-briefing--new,
  .rsf-hint__pulse { animation: none; }
}

.rsf-more {
  display: flex;
  justify-content: center;
  margin-top: 0.4rem;
}
.rsf-more__btn {
  background: rgba(13, 13, 24, 0.6);
  border: 1px solid rgba(48, 54, 61, 0.55);
  color: var(--text-secondary, #8b949e);
  padding: 0.45rem 0.95rem;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: border-color 180ms ease, color 180ms ease;
}
.rsf-more__btn:hover {
  border-color: rgba(0, 229, 255, 0.45);
  color: #00e5ff;
}
</style>
