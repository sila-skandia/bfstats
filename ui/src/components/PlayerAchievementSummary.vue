<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import type { PlayerAchievementGroup } from '@/types/playerStatsTypes';
import { getAchievementImageFromObject } from '@/utils/achievementImageUtils';

const props = defineProps<{
  playerName: string;
  achievementGroups?: PlayerAchievementGroup[];
  loading?: boolean;
  error?: string | null;
}>();

const groups = ref<PlayerAchievementGroup[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);

const milestoneTypes = new Set(['milestone']);
const isUsingExternalGroups = computed(() => Array.isArray(props.achievementGroups));

const displayGroups = computed(() => {
  return isUsingExternalGroups.value ? (props.achievementGroups ?? []) : groups.value;
});

const milestoneGroups = computed(() => {
  return displayGroups.value
    .filter(group => milestoneTypes.has(group.achievementType.toLowerCase()))
    .sort((a, b) => new Date(b.latestAchievedAt).getTime() - new Date(a.latestAchievedAt).getTime());
});

const otherGroups = computed(() => {
  return displayGroups.value
    .filter(group => !milestoneTypes.has(group.achievementType.toLowerCase()))
    .sort((a, b) => b.count - a.count || a.achievementName.localeCompare(b.achievementName));
});

const totalEarned = computed(() => {
  return displayGroups.value.reduce((sum, group) => sum + group.count, 0);
});

const getAchievementImage = (achievementId: string, tier?: string): string => {
  return getAchievementImageFromObject({ achievementId, tier });
};

const getTierColor = (tier: string): string => {
  switch (tier?.toLowerCase()) {
    case 'legend':
    case 'legendary': return 'text-orange-400';
    case 'gold': return 'text-yellow-400';
    case 'silver': return 'text-blue-400';
    case 'bronze': return 'text-orange-600';
    default: return 'text-slate-400';
  }
};

const fetchAchievementGroups = async () => {
  if (isUsingExternalGroups.value) return;
  isLoading.value = true;
  error.value = null;
  try {
    const response = await fetch(`/stats/gamification/player/${encodeURIComponent(props.playerName)}/achievement-groups`);
    if (!response.ok) throw new Error('Failed to fetch achievements');
    groups.value = await response.json();
  } catch (err: unknown) {
    console.error('Error fetching achievement groups:', err);
    error.value = err instanceof Error ? err.message : 'Failed to load achievements.';
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => fetchAchievementGroups());
watch(() => props.playerName, (newName, oldName) => { if (newName && newName !== oldName) fetchAchievementGroups(); });
watch(() => props.achievementGroups, (newGroups) => { if (Array.isArray(newGroups)) { groups.value = newGroups; isLoading.value = false; error.value = null; } }, { immediate: true });
watch(() => props.loading, (newLoading) => { if (typeof newLoading === 'boolean') isLoading.value = newLoading; }, { immediate: true });
watch(() => props.error, (newError) => { if (newError !== undefined) error.value = newError ?? null; }, { immediate: true });
</script>

<template>
  <div class="space-y-12">
    <!-- Status Rendering -->
    <div
      v-if="isLoading"
      class="flex flex-col items-center justify-center py-20 opacity-50"
    >
      <div class="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
      <div class="font-mono text-[10px] text-cyan-400 uppercase tracking-[0.3em]">
        Auditing_Trophies...
      </div>
    </div>

    <div
      v-else-if="error"
      class="bg-red-500/5 border border-red-500/20 rounded p-8 text-center"
    >
      <div class="text-3xl mb-4">
        ⚠️
      </div>
      <p class="text-red-400 font-mono text-sm uppercase tracking-widest mb-6">
        {{ error }}
      </p>
      <button
        class="px-6 py-2 bg-red-500/10 border border-red-500/50 text-red-400 text-[10px] font-mono font-black uppercase tracking-widest hover:bg-red-500/20 transition-all"
        @click="fetchAchievementGroups"
      >
        Retry_Audit
      </button>
    </div>

    <div
      v-else-if="groups.length === 0"
      class="bg-white/5 border border-white/5 rounded-xl p-16 text-center opacity-30"
    >
      <div class="text-5xl mb-6">
        ∅
      </div>
      <p class="text-xs font-mono text-slate-400 uppercase tracking-[0.4em]">
        Zero_Honors_Detected
      </p>
    </div>

    <!-- Main Content -->
    <div
      v-else
      class="space-y-12"
    >
      <!-- Milestones: High Impact Cards -->
      <section
        v-if="milestoneGroups.length > 0"
        class="space-y-6"
      >
        <div class="flex items-center gap-4">
          <div class="w-1 h-5 bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]" />
          <h3 class="text-lg font-black text-white uppercase italic tracking-tighter">
            Operational Milestones
          </h3>
          <div class="h-px flex-1 bg-white/5" />
        </div>
        
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          <div
            v-for="m in milestoneGroups"
            :key="m.achievementId"
            class="group relative bg-black/40 border border-yellow-500/20 rounded-xl p-6 flex flex-col items-center text-center transition-all hover:bg-yellow-500/5 hover:border-yellow-500/40 hover:-translate-y-1 shadow-[inset_0_0_20px_rgba(0,0,0,0.4)]"
          >
            <!-- Decorative FX -->
            <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none overflow-hidden rounded-xl">
              <div class="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-yellow-500/5 to-transparent" />
              <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(234,179,8,0.1),transparent_70%)]" />
            </div>

            <img
              :src="getAchievementImage(m.achievementId, m.tier)"
              :alt="m.achievementName"
              class="w-20 h-24 object-contain filter drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] group-hover:scale-110 transition-transform duration-500 mb-4 z-10"
            >
            
            <div class="z-10">
              <div class="text-[9px] font-mono font-black text-yellow-500 uppercase tracking-[0.2em] mb-1">
                MILESTONE_LOGGED
              </div>
              <div class="text-xs font-bold text-white uppercase tracking-tight leading-tight group-hover:text-yellow-400 transition-colors">
                {{ m.achievementName }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Achievement Collection: High Density Grid -->
      <section class="space-y-6">
        <div class="flex items-center gap-4">
          <div class="w-1 h-5 bg-cyan-500 shadow-[0_0_10px_rgba(0,229,255,0.5)]" />
          <h3 class="text-lg font-black text-white uppercase italic tracking-tighter">
            Combat Trophy Collection
          </h3>
          <div class="h-px flex-1 bg-white/5" />
          <div class="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            {{ totalEarned }} TOTAL_UNITS
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          <div
            v-for="a in otherGroups"
            :key="a.achievementId"
            class="group relative bg-white/[0.02] border border-white/5 rounded p-4 transition-all hover:bg-white/5 hover:border-white/20"
          >
            <div class="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 border border-white/10 rounded text-[10px] font-mono font-black text-cyan-400 z-10 shadow-lg">
              ×{{ a.count }}
            </div>
            
            <div class="flex flex-col items-center text-center gap-3">
              <img
                :src="getAchievementImage(a.achievementId, a.tier)"
                :alt="a.achievementName"
                class="w-12 h-14 object-contain opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-300"
              >
              <div>
                <div
                  class="text-[8px] font-mono font-black uppercase tracking-widest mb-0.5"
                  :class="getTierColor(a.tier)"
                >
                  {{ a.tier || 'Standard' }}
                </div>
                <div class="text-[10px] font-bold text-slate-300 uppercase tracking-tighter leading-none group-hover:text-white transition-colors">
                  {{ a.achievementName }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'JetBrains Mono', monospace;
}
</style>
