<script setup lang="ts">
import { computed } from 'vue';
import { getBadgeDescription, getTierRequirement } from '@/services/badgeService';
import { getAchievementImageFromObject } from '@/utils/achievementImageUtils';

interface Achievement {
  achievementId: string;
  achievementName: string;
  achievementType?: string;
  tier?: string;
  value?: number;
  achievedAt: string;
  mapName?: string;
  serverGuid?: string;
  roundId?: string;
  metadata?: string;
}

interface Props {
  isVisible: boolean;
  achievement: Achievement | null;
  playerName?: string;
}

const props = withDefaults(defineProps<Props>(), {
  playerName: undefined
});

const emit = defineEmits<{
  close: []
}>();

const closeModal = () => {
  emit('close');
};

const getAchievementImage = (achievementId: string, tier?: string): string => {
  return getAchievementImageFromObject({ achievementId, tier });
};

const badgeDescription = computed(() => {
  if (!props.achievement) return null;
  return getBadgeDescription(props.achievement.achievementId);
});

const tierRequirement = computed(() => {
  if (!props.achievement?.tier) return null;
  return getTierRequirement(props.achievement.achievementId, props.achievement.tier);
});

const parsedMetadata = computed(() => {
  if (!props.achievement?.metadata) return null;
  try {
    return JSON.parse(props.achievement.metadata);
  } catch {
    return null;
  }
});

const isRoundPlacementAchievement = computed(() => {
  return props.achievement?.achievementType === 'round_placement' || 
         props.achievement?.achievementId?.startsWith('round_placement_');
});

const isTeamVictoryAchievement = computed(() => {
  return props.achievement?.achievementId === 'team_victory' || 
         props.achievement?.achievementId === 'team_victory_switched';
});

const getPlacementSuffix = (place: number): string => {
  if (place === 1) return 'st';
  if (place === 2) return 'nd';
  if (place === 3) return 'rd';
  return 'th';
};

const getPlacementColor = (place: number): string => {
  if (place === 1) return 'text-yellow-400';
  if (place === 2) return 'text-slate-300';
  if (place === 3) return 'text-orange-400';
  return 'text-purple-400';
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="isVisible && achievement"
        class="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
        @click="closeModal"
      >
        <!-- Backdrop Blur -->
        <div class="absolute inset-0 bg-[#05050a]/90 backdrop-blur-xl" />

        <div
          class="relative w-full max-w-2xl bg-[#0d1117] border border-white/10 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[95vh] animate-modal-in"
          @click.stop
        >
          <!-- Tactical Header -->
          <div class="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
            <div class="flex items-center gap-4">
              <div class="w-1 h-8 bg-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.5)]" />
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <span class="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/30 text-[9px] font-mono text-yellow-500 uppercase tracking-widest">Honor_Unlocked</span>
                  <span class="text-[10px] text-slate-500 font-mono">{{ new Date(achievement.achievedAt).toLocaleDateString() }}</span>
                </div>
                <h3 class="text-2xl font-black text-white uppercase italic tracking-tighter">
                  {{ achievement.achievementName }}
                </h3>
              </div>
            </div>
            <button
              class="w-10 h-10 flex items-center justify-center rounded-full border border-white/10 hover:border-red-500/50 hover:bg-red-500/5 text-slate-500 hover:text-red-400 transition-all group"
              @click="closeModal"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              /></svg>
            </button>
          </div>

          <!-- Main Scrollable Body -->
          <div class="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8 space-y-8">
            <!-- Hero Layout: Round Placement -->
            <div
              v-if="isRoundPlacementAchievement && parsedMetadata"
              class="space-y-8"
            >
              <div class="flex flex-col md:flex-row items-center gap-8 bg-black/40 border border-white/5 rounded-2xl p-8 relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent pointer-events-none" />
                  
                <div class="relative z-10 flex-shrink-0">
                  <img 
                    :src="getAchievementImage(achievement.achievementId, achievement.tier)" 
                    class="w-32 h-40 object-contain filter drop-shadow-[0_0_20px_rgba(0,0,0,0.5)] transform group-hover:scale-105 transition-transform duration-500"
                  >
                </div>

                <div class="relative z-10 flex-1 text-center md:text-left">
                  <div class="mb-4">
                    <div class="text-[10px] font-mono text-cyan-400 uppercase tracking-[0.4em] mb-1">
                      Final_Position
                    </div>
                    <div
                      class="text-6xl font-black italic tracking-tighter"
                      :class="getPlacementColor(achievement.value || 1)"
                    >
                      {{ achievement.value || 1 }}<span class="text-2xl not-italic opacity-50">{{ getPlacementSuffix(achievement.value || 1) }}</span>
                    </div>
                  </div>

                  <div class="grid grid-cols-3 gap-4 border-t border-white/10 pt-6">
                    <div>
                      <div class="text-[8px] font-mono text-slate-500 uppercase mb-1">
                        Kills
                      </div>
                      <div class="text-xl font-black text-white font-mono">
                        {{ parsedMetadata.Kills }}
                      </div>
                    </div>
                    <div>
                      <div class="text-[8px] font-mono text-slate-500 uppercase mb-1">
                        Score
                      </div>
                      <div class="text-xl font-black text-neon-gold font-mono">
                        {{ parsedMetadata.Score }}
                      </div>
                    </div>
                    <div>
                      <div class="text-[8px] font-mono text-slate-500 uppercase mb-1">
                        E_Rate
                      </div>
                      <div class="text-xl font-black text-emerald-500 font-mono">
                        {{ (parsedMetadata.Kills / Math.max(1, parsedMetadata.Deaths)).toFixed(1) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Hero Layout: Team Victory -->
            <div
              v-else-if="isTeamVictoryAchievement && parsedMetadata"
              class="space-y-8"
            >
              <div class="flex flex-col md:flex-row items-center gap-8 bg-black/40 border border-white/5 rounded-2xl p-8 relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
                <div class="relative z-10 flex-shrink-0">
                  <img 
                    :src="getAchievementImage(achievement.achievementId, achievement.tier)" 
                    class="w-32 h-40 object-contain filter drop-shadow-[0_0_20px_rgba(0,0,0,0.5)] transform group-hover:scale-105 transition-transform duration-500"
                  >
                </div>
                <div class="relative z-10 flex-1 text-center md:text-left">
                  <div class="text-[10px] font-mono text-emerald-400 uppercase tracking-[0.4em] mb-2">
                    Team_Victory_Confirmed
                  </div>
                  <div class="flex items-center justify-center md:justify-start gap-4 mb-6">
                    <div class="text-center">
                      <div class="text-2xl font-black text-emerald-400 uppercase tracking-tighter italic leading-none">
                        {{ parsedMetadata.WinningTeamLabel }}
                      </div>
                      <div class="text-lg font-mono text-white mt-1">
                        {{ parsedMetadata.WinningTeamTickets }}
                      </div>
                    </div>
                    <div class="text-slate-700 font-black italic">
                      VS
                    </div>
                    <div class="text-center opacity-40">
                      <div class="text-lg font-black text-red-400 uppercase tracking-tighter italic leading-none">
                        {{ parsedMetadata.LosingTeamLabel }}
                      </div>
                      <div class="text-sm font-mono text-white mt-1">
                        {{ parsedMetadata.LosingTeamTickets }}
                      </div>
                    </div>
                  </div>
                  <div class="inline-flex px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded text-[9px] font-mono text-emerald-400 uppercase tracking-widest">
                    Contribution: {{ (parsedMetadata.TeamContribution * 100).toFixed(1) }}%
                  </div>
                </div>
              </div>
            </div>

            <!-- Default Hero -->
            <div
              v-else
              class="flex flex-col items-center text-center space-y-6"
            >
              <div class="relative group">
                <div class="absolute inset-0 bg-cyan-500/10 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                <img 
                  :src="getAchievementImage(achievement.achievementId, achievement.tier)" 
                  class="w-40 h-52 object-contain filter drop-shadow-[0_0_30px_rgba(0,0,0,0.6)] relative z-10"
                >
              </div>
            </div>

            <!-- Intelligence Clusters -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Explanation -->
              <div
                v-if="badgeDescription"
                class="col-span-1 md:col-span-2 bg-white/5 border border-white/10 rounded-xl p-5"
              >
                <div class="flex items-center gap-3 mb-3">
                  <i class="pi pi-info-circle text-cyan-400" />
                  <span class="text-[10px] font-mono text-slate-500 uppercase tracking-widest">SITREP / DATA_DECRYPT</span>
                </div>
                <p class="text-sm text-slate-300 leading-relaxed italic border-l-2 border-cyan-500/30 pl-4 font-medium">
                  "{{ badgeDescription }}"
                </p>
              </div>

              <!-- Metadata: Map/Server -->
              <div
                v-if="achievement.mapName"
                class="bg-black/20 border border-white/5 rounded-xl p-4"
              >
                <div class="text-[8px] font-mono text-slate-600 uppercase mb-2">
                  Location_Context
                </div>
                <div class="flex flex-col">
                  <span class="text-xs font-bold text-white uppercase tracking-tight">{{ achievement.mapName }}</span>
                  <span
                    v-if="parsedMetadata?.ServerName"
                    class="text-[9px] font-mono text-slate-500 uppercase truncate mt-0.5"
                  >{{ parsedMetadata.ServerName }}</span>
                </div>
              </div>

              <!-- Metadata: Tier -->
              <div
                v-if="achievement.tier"
                class="bg-black/20 border border-white/5 rounded-xl p-4"
              >
                <div class="text-[8px] font-mono text-slate-600 uppercase mb-2">
                  Technical_Tier
                </div>
                <div class="flex items-center gap-3">
                  <div class="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                    <span class="text-[10px] font-black text-cyan-400">{{ achievement.tier.charAt(0).toUpperCase() }}</span>
                  </div>
                  <span class="text-xs font-bold text-white uppercase tracking-widest">{{ achievement.tier }}</span>
                </div>
              </div>
            </div>

            <!-- Operational Links -->
            <div
              v-if="achievement.roundId && playerName"
              class="flex justify-center"
            >
              <router-link 
                :to="{ name: 'round-report', params: { roundId: achievement.roundId }, query: { players: playerName } }"
                class="group relative inline-flex items-center gap-3 px-8 py-3 bg-white text-black font-black text-[10px] font-mono uppercase tracking-[0.3em] overflow-hidden transition-all hover:bg-cyan-500 hover:text-black"
                @click="closeModal"
              >
                Access_Mission_Logs
                <span class="group-hover:translate-x-1 transition-transform">&rarr;</span>
              </router-link>
            </div>
          </div>

          <!-- Technical Footer -->
          <div class="p-4 border-t border-white/5 bg-black/40 flex justify-between items-center opacity-30">
            <div class="text-[8px] font-mono text-slate-500 uppercase tracking-widest">
              UID: 0x{{ achievement.achievementId.substring(0,8) }}
            </div>
            <div class="text-[8px] font-mono text-slate-500 uppercase tracking-widest">
              Terminal_Status: SECURE
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.font-mono {
  font-family: 'JetBrains Mono', monospace;
}
.text-neon-gold {
  color: #f59e0b;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

/* Animations */
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.95) translateY(20px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.animate-modal-in {
  animation: modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
