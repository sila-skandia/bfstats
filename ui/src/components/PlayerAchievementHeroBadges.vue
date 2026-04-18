<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Achievement } from '@/types/playerStatsTypes';
import { getAchievementImageFromObject } from '@/utils/achievementImageUtils';
import AchievementModal from './AchievementModal.vue';

const props = defineProps<{
  playerName: string;
}>();

const selectedAchievement = ref<Achievement | null>(null);
const showModal = ref(false);
const heroAchievements = ref<Achievement[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

type BadgeKind = 'recent' | 'milestone';

const headerBadges = computed(() => {
  if (heroAchievements.value.length === 0) {
    return [];
  }

  const milestone = heroAchievements.value.find(a =>
    a.achievementType?.toLowerCase() === 'milestone' &&
    a.achievementId?.startsWith('total_kills_')
  );

  const otherAchievements = heroAchievements.value
    .filter(a => a !== milestone)
    .slice(0, 5);

  const result = otherAchievements.map(achievement => ({
    achievement,
    kind: 'recent' as BadgeKind
  }));

  if (milestone) {
    result.unshift({
      achievement: milestone,
      kind: 'milestone' as BadgeKind
    });
  }

  return result;
});

const getAchievementImage = (achievementId: string, tier?: string): string => {
  return getAchievementImageFromObject({ achievementId, tier });
};

const fetchHeroAchievements = async () => {
  isLoading.value = true;
  error.value = null;
  try {
    const response = await fetch(`/stats/gamification/player/${encodeURIComponent(props.playerName)}/hero-achievements`);
    if (!response.ok) throw new Error('Failed to fetch hero achievements');
    heroAchievements.value = await response.json();
  } catch (err: unknown) {
    console.error('Error fetching hero achievements:', err);
    error.value = 'Failed to load achievements.';
    heroAchievements.value = [];
  } finally {
    isLoading.value = false;
  }
};

const openAchievementModal = (achievement: Achievement) => {
  selectedAchievement.value = achievement;
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  selectedAchievement.value = null;
};

onMounted(() => {
  fetchHeroAchievements();
});

</script>

<template>
  <!-- Loading State -->
  <div
    v-if="isLoading"
    class="flex items-center gap-2"
  >
    <div
      v-for="n in 6"
      :key="n"
      class="w-9 h-9 bg-neutral-800/40 rounded border border-neutral-700/30 animate-pulse"
    />
  </div>

  <!-- Error State -->
  <div
    v-else-if="error"
    class="text-[10px] font-mono text-red-400 opacity-60 uppercase tracking-widest"
  >
    DATA_UNAVAILABLE
  </div>

  <!-- Achievement Badges -->
  <div
    v-else-if="headerBadges.length > 0"
    class="flex items-center gap-1.5 flex-wrap"
  >
    <button
      v-for="item in headerBadges"
      :key="`${item.kind}-${item.achievement.achievementId}-${item.achievement.achievedAt}`"
      class="badge-frame group"
      :class="item.kind === 'milestone' ? 'badge-frame--milestone' : ''"
      @click="openAchievementModal(item.achievement)"
    >
      <div class="badge-inner">
        <img
          :src="getAchievementImage(item.achievement.achievementId, item.achievement.tier)"
          :alt="item.achievement.achievementName"
          class="w-6 h-6 object-contain group-hover:scale-110 transition-transform duration-300"
        >
      </div>
      
      <!-- Tooltip -->
      <div class="badge-tooltip">
        <div class="text-[9px] font-black uppercase text-neutral-400 tracking-tighter mb-0.5">
          {{ item.kind === 'milestone' ? 'MAJOR MILESTONE' : 'RECENT HONOR' }}
        </div>
        <div class="text-xs font-bold text-white whitespace-nowrap">
          {{ item.achievement.achievementName }}
        </div>
      </div>
    </button>
  </div>

  <!-- No Achievements -->
  <div
    v-else
    class="text-[10px] font-mono text-neutral-600 uppercase tracking-widest"
  >
    ZERO_HONORS_LOGGED
  </div>

  <AchievementModal
    :is-visible="showModal"
    :achievement="selectedAchievement"
    :player-name="playerName"
    @close="closeModal"
  />
</template>

<style scoped>
.badge-frame {
  position: relative;
  width: 2.25rem;
  height: 2.25rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.badge-frame:hover {
  background: rgba(0, 229, 255, 0.1);
  border-color: rgba(0, 229, 255, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 10px rgba(0, 229, 255, 0.1);
}

.badge-frame--milestone {
  border-color: rgba(245, 158, 11, 0.3);
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), transparent);
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.1);
}

.badge-frame--milestone:hover {
  border-color: rgba(245, 158, 11, 0.6);
  background: rgba(245, 158, 11, 0.15);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4), 0 0 15px rgba(245, 158, 11, 0.2);
}

.badge-inner {
  position: relative;
  z-index: 1;
}

.badge-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: rgba(13, 13, 24, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  pointer-events: none;
  opacity: 0;
  transition: all 0.2s ease;
  z-index: 50;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.badge-frame:hover .badge-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.badge-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(13, 13, 24, 0.95);
}
</style>
