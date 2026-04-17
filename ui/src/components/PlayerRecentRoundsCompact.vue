<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { Session } from '@/types/playerStatsTypes';
import { formatRelativeTime } from '@/utils/timeUtils';
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
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="border-b border-neutral-700/30 font-mono text-[9px] text-neutral-500 uppercase tracking-widest">
          <th class="py-2 px-3 font-medium">RESULT</th>
          <th class="py-2 px-3 font-medium">MAP / CLUSTER</th>
          <th class="py-2 px-3 font-medium text-right">SCORE</th>
          <th class="py-2 px-3 font-medium text-center">RANK</th>
          <th class="py-2 px-3 font-medium text-right">K/D</th>
          <th class="py-2 px-3 font-medium text-right">SEEN</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-neutral-700/20">
        <tr
          v-for="(session, index) in compactSessions"
          :key="`${session.roundId}-${session.sessionId}-${index}`"
          class="group hover:bg-white/5 transition-colors cursor-pointer"
          @click="navigateToRoundReport(session)"
        >
          <!-- Result -->
          <td class="py-2.5 px-3">
            <div class="flex items-center gap-1.5">
              <div 
                class="w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor]" 
                :class="getResultClass(session.teamResult)" 
              />
              <span class="text-[10px] font-black tracking-tight font-mono" :class="getResultClass(session.teamResult)">
                {{ getResultLabel(session.teamResult) }}
              </span>
            </div>
          </td>

          <!-- Map / Server -->
          <td class="py-2.5 px-3 min-w-0">
            <div class="flex flex-col">
              <span class="text-xs font-bold text-neutral-200 truncate uppercase tracking-tight">{{ session.mapName }}</span>
              <span class="text-[9px] text-neutral-500 truncate font-mono uppercase tracking-tighter">{{ session.serverName }}</span>
            </div>
          </td>

          <!-- Score -->
          <td class="py-2.5 px-3 text-right">
            <span class="text-xs font-black text-neon-gold font-mono">{{ session.totalScore.toLocaleString() }}</span>
          </td>

          <!-- Rank -->
          <td class="py-2.5 px-3 text-center">
            <span 
              class="text-[10px] font-bold font-mono"
              :class="session.placement && session.placement <= 3 ? 'text-cyan-400' : 'text-neutral-400'"
            >
              {{ formatPlacement(session.placement) }}
            </span>
          </td>

          <!-- K/D -->
          <td class="py-2.5 px-3 text-right">
            <span class="text-[10px] font-bold text-neutral-300 font-mono">
              {{ calculateKDR(session.kills, session.deaths) }}
            </span>
          </td>

          <!-- Time -->
          <td class="py-2.5 px-3 text-right">
            <span class="text-[10px] text-neutral-500 font-mono uppercase">
              {{ formatRelativeTime(session.timestamp) }}
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
</style>
