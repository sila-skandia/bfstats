<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { Session } from '@/types/playerStatsTypes';
import { formatDate } from '@/utils/timeUtils';
import { calculateKDR } from '@/utils/statsUtils';

const props = defineProps<{
  sessions: Session[];
  playerName: string;
}>();

const router = useRouter();

const compactSessions = computed(() => (props.sessions ?? []).slice(0, 5));

const formatPlacement = (placement: number | null): string => {
  if (!placement || placement <= 0) return '—';
  return `#${placement}`;
};

const getResultClass = (result: Session['teamResult']): string => {
  if (result === 'win') return 'text-emerald-400';
  if (result === 'loss') return 'text-red-400';
  if (result === 'tie') return 'text-amber-400';
  return 'text-neutral-500';
};

const getResultLabel = (result: Session['teamResult']): string => {
  if (result === 'win') return 'VICTORY';
  if (result === 'loss') return 'DEFEAT';
  if (result === 'tie') return 'DRAW';
  return 'UNKNOWN';
};

const navigateToRoundReport = (session: Session) => {
  router.push({
    name: 'round-report',
    params: { roundId: session.roundId },
    query: { players: props.playerName },
  });
};
</script>

<template>
  <div class="overflow-x-auto">
    <div class="prc-hint" aria-hidden="true">
      <span class="prc-hint__pulse" />
      <span class="prc-hint__text">
        <span class="prc-neon">TAP</span> ANY ROUND FOR FULL
        <span class="prc-neon">DEBRIEFING</span> —
        TIMELINE · PHASE CHARTS · PLAYER BREAKDOWN
      </span>
    </div>

    <table class="w-full border-collapse">
      <thead>
        <tr class="border-b border-neutral-700/30 font-mono text-[9px] text-neutral-500 uppercase">
          <th class="py-2 px-3 font-medium" style="text-align: left">
            RESULT
          </th>
          <th class="py-2 px-3 font-medium" style="text-align: left">
            MAP / CLUSTER
          </th>
          <th class="py-2 px-3 font-medium" style="text-align: right">
            SCORE
          </th>
          <th class="py-2 px-3 font-medium" style="text-align: center">
            RANK
          </th>
          <th class="py-2 px-3 font-medium" style="text-align: right">
            K/D
          </th>
          <th class="py-2 px-3 font-medium" style="text-align: right">
            DATE
          </th>
          <th class="py-2 px-3 font-medium" style="text-align: right">
            DEBRIEF
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-neutral-700/20">
        <tr
          v-for="(session, index) in compactSessions"
          :key="`${session.roundId}-${session.sessionId}-${index}`"
          class="prc-row group hover:bg-white/5 transition-colors cursor-pointer"
          @click="navigateToRoundReport(session)"
        >
          <!-- Result -->
          <td class="py-2.5 px-3" style="text-align: left">
            <div class="flex items-center gap-1.5">
              <div 
                class="w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor]" 
                :class="getResultClass(session.teamResult)" 
              />
              <span
                class="text-[10px] font-black tracking-tight font-mono"
                :class="getResultClass(session.teamResult)"
              >
                {{ getResultLabel(session.teamResult) }}
              </span>
            </div>
          </td>

          <!-- Map / Server -->
          <td class="py-2.5 px-3 min-w-0" style="text-align: left">
            <div class="flex flex-col">
              <span class="text-xs font-bold text-neutral-200 truncate uppercase tracking-tight">{{ session.mapName }}</span>
              <span class="text-[9px] text-neutral-500 truncate font-mono uppercase tracking-tighter">{{ session.serverName }}</span>
            </div>
          </td>

          <!-- Score -->
          <td class="py-2.5 px-3" style="text-align: right">
            <span class="text-xs font-black text-neon-gold font-mono">{{ session.totalScore.toLocaleString() }}</span>
          </td>

          <!-- Rank -->
          <td class="py-2.5 px-3" style="text-align: center">
            <span 
              class="text-[10px] font-bold font-mono"
              :class="session.placement && session.placement <= 3 ? 'text-cyan-400' : 'text-neutral-400'"
            >
              {{ formatPlacement(session.placement) }}
            </span>
          </td>

          <!-- K/D -->
          <td class="py-2.5 px-3" style="text-align: right">
            <span class="text-[10px] font-bold text-neutral-300 font-mono">
              {{ calculateKDR(session.totalKills, session.totalDeaths) }}
            </span>
          </td>

          <!-- Time -->
          <td class="py-2.5 px-3" style="text-align: right">
            <span class="text-[10px] text-neutral-500 font-mono uppercase">
              {{ formatDate(session.startTime) }}
            </span>
          </td>

          <!-- Debrief CTA -->
          <td class="py-2.5 px-3" style="text-align: right">
            <span
              class="prc-briefing"
              :class="{ 'prc-briefing--new': index === 0 }"
              aria-hidden="true"
            >
              <span class="briefing-chart">
                <span /><span /><span />
              </span>
              <span class="prc-briefing__label">Open</span>
              <span class="prc-briefing__arrow">▸</span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
    
    <div class="mt-4 flex justify-end">
      <router-link
        :to="`/players/${encodeURIComponent(playerName)}/sessions`"
        class="text-[10px] font-mono text-cyan-500 hover:text-cyan-400 uppercase tracking-widest flex items-center gap-2 group"
      >
        ACCESS_FULL_LOG 
        <span class="group-hover:translate-x-1 transition-transform">&rarr;</span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.text-neon-gold {
  color: #f59e0b;
  text-shadow: 0 0 10px rgba(245, 158, 11, 0.2);
}

/* ——— Hint line ——— */
.prc-hint {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.35rem;
  border-left: 2px solid rgba(0, 229, 255, 0.45);
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.08), transparent 70%);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8b949e;
}
.prc-hint__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.75);
  animation: prc-hint-blink 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes prc-hint-blink {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1); }
}
.prc-neon { color: #00e5ff; font-weight: 700; }

/* ——— OPEN BRIEFING chip ——— */
.prc-briefing {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.45rem 0.2rem 0.38rem;
  border: 1px dashed rgba(0, 229, 255, 0.5);
  border-radius: 3px;
  background: linear-gradient(
    135deg,
    rgba(0, 229, 255, 0.05) 0%,
    rgba(0, 229, 255, 0.12) 100%
  );
  color: #00e5ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.58rem;
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
.prc-briefing__label { line-height: 1; }
.prc-briefing__arrow {
  font-size: 0.78rem;
  line-height: 1;
  transition: transform 200ms ease;
}

/* mini bar-chart icon */
.briefing-chart {
  display: inline-flex;
  align-items: flex-end;
  justify-content: space-between;
  width: 13px;
  height: 11px;
  padding: 2px 1px 1px;
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

.prc-row:hover .prc-briefing,
.prc-row:focus-visible .prc-briefing {
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
.prc-row:hover .prc-briefing__arrow,
.prc-row:focus-visible .prc-briefing__arrow {
  transform: translateX(3px);
}
.prc-row:hover .briefing-chart > span:nth-child(1),
.prc-row:focus-visible .briefing-chart > span:nth-child(1) { height: 62%; }
.prc-row:hover .briefing-chart > span:nth-child(2),
.prc-row:focus-visible .briefing-chart > span:nth-child(2) { height: 92%; }
.prc-row:hover .briefing-chart > span:nth-child(3),
.prc-row:focus-visible .briefing-chart > span:nth-child(3) { height: 45%; }

.prc-briefing--new {
  animation: prc-briefing-pulse 2.6s ease-in-out infinite;
}
@keyframes prc-briefing-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(0, 229, 255, 0.0);
  }
  50% {
    box-shadow:
      0 0 0 3px rgba(0, 229, 255, 0.18),
      0 0 14px rgba(0, 229, 255, 0.35);
  }
}

@media (prefers-reduced-motion: reduce) {
  .prc-briefing--new,
  .prc-hint__pulse { animation: none; }
}
</style>
