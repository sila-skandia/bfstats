<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Achievement } from '@/types/playerStatsTypes'
import { getAchievementImageFromObject } from '@/utils/achievementImageUtils'

const props = defineProps<{
  playerName: string
}>()

const router = useRouter()

const heroAchievements = ref<Achievement[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

type BadgeKind = 'recent' | 'milestone'

const headerBadges = computed(() => {
  if (heroAchievements.value.length === 0) return []

  const milestone = heroAchievements.value.find(a =>
    a.achievementType?.toLowerCase() === 'milestone' &&
    a.achievementId?.startsWith('total_kills_'),
  )

  const otherAchievements = heroAchievements.value
    .filter(a => a !== milestone)
    .slice(0, 5)

  const result = otherAchievements.map(achievement => ({
    achievement,
    kind: 'recent' as BadgeKind,
  }))

  if (milestone) {
    result.unshift({ achievement: milestone, kind: 'milestone' as BadgeKind })
  }

  return result
})

const getAchievementImage = (achievementId: string, tier?: string): string =>
  getAchievementImageFromObject({ achievementId, tier })

const fetchHeroAchievements = async () => {
  isLoading.value = true
  error.value = null
  try {
    const response = await fetch(`/stats/gamification/player/${encodeURIComponent(props.playerName)}/hero-achievements`)
    if (!response.ok) throw new Error('Failed to fetch hero achievements')
    heroAchievements.value = await response.json()
  } catch (err: unknown) {
    console.error('Error fetching hero achievements:', err)
    error.value = 'Failed to load achievements.'
    heroAchievements.value = []
  } finally {
    isLoading.value = false
  }
}

const openAchievement = () => {
  router.push(`/v4/players/${encodeURIComponent(props.playerName)}/achievements`)
}

onMounted(fetchHeroAchievements)
watch(() => props.playerName, fetchHeroAchievements)
</script>

<template>
  <div class="mm-hero-badges">
    <div v-if="isLoading" class="mm-hero-badges__row">
      <div v-for="n in 6" :key="n" class="mm-skeleton mm-hero-badges__skel" />
    </div>

    <div v-else-if="error" class="mm-eyebrow" style="color: var(--mm-danger)">{{ error }}</div>

    <div v-else-if="headerBadges.length === 0" class="mm-eyebrow">No achievements yet</div>

    <div v-else class="mm-hero-badges__row">
      <button
        v-for="item in headerBadges"
        :key="`${item.kind}-${item.achievement.achievementId}-${item.achievement.achievedAt}`"
        type="button"
        class="mm-hero-badges__badge"
        :class="{ 'mm-hero-badges__badge--milestone': item.kind === 'milestone' }"
        :title="item.achievement.achievementName"
        @click="openAchievement"
      >
        <img
          :src="getAchievementImage(item.achievement.achievementId, item.achievement.tier)"
          :alt="item.achievement.achievementName"
          loading="lazy"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mm-hero-badges__row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mm-hero-badges__skel {
  width: 36px;
  height: 36px;
}

.mm-hero-badges__badge {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 4px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.12s ease, transform 0.12s ease;
}

.mm-hero-badges__badge:hover {
  border-color: var(--mm-ink);
}

.mm-hero-badges__badge--milestone {
  border-color: var(--mm-accent);
}

.mm-hero-badges__badge--milestone:hover {
  border-color: var(--mm-accent-soft);
}

.mm-hero-badges__badge img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
