<template>
  <div class="wrapped-slide medals-slide" @click="$emit('next')">
    <div class="mm-eyebrow">04 — MEDALS &amp; DECORATIONS</div>
    <div class="medals-heading">
      {{ data.medals.killStreaks25 }} kill streaks. One {{ data.medals.eliteWarriorTier.toLowerCase() }}.
    </div>
    
    <div class="medals-grid">
      <!-- Card 1: Total Kill Streaks -->
      <div class="deco-card">
        <img 
          :src="getAchievementImage('kill_streak_25')" 
          alt="Kill streak medal" 
          class="deco-img"
        />
        <div class="mm-eyebrow-small">KILL STREAKS</div>
        <div class="deco-value">{{ data.medals.killStreaks25 }} EARNED</div>
      </div>

      <!-- Card 2: Podium Finishes -->
      <div class="deco-card">
        <img 
          :src="getAchievementImage('round_placement_1')" 
          alt="First place medal" 
          class="deco-img"
        />
        <div class="mm-eyebrow-small">PODIUM FINISHES</div>
        <div class="deco-value">{{ data.medals.podiumFinishes }} FIRSTS</div>
      </div>

      <!-- Card 3: Elite Warrior Tier -->
      <div class="deco-card">
        <img 
          :src="getAchievementImage('elite_warrior_legend')" 
          alt="Elite warrior legend medal" 
          class="deco-img"
        />
        <div class="mm-eyebrow-small">{{ data.medals.eliteWarriorBadgeName }}</div>
        <div class="deco-value">{{ data.medals.eliteWarriorTier }}</div>
      </div>

      <!-- Card 4: Best Streak -->
      <div class="deco-card">
        <img 
          :src="getAchievementImage('kill_streak_50')" 
          alt="Best streak medal" 
          class="deco-img"
        />
        <div class="mm-eyebrow-small">BEST STREAK</div>
        <div class="deco-value">{{ data.medals.bestStreak }} KILLS</div>
      </div>
    </div>

    <!-- Achievement Breakdowns Section -->
    <div class="breakdown-section" v-if="data.medals.achievementTypes && data.medals.achievementTypes.length > 0">
      <div class="breakdown-title">ACHIEVEMENT BREAKDOWN</div>
      <div class="breakdown-grid">
        <div v-for="t in data.medals.achievementTypes" :key="t.type" class="breakdown-pill">
          <span class="pill-label">{{ t.type.toUpperCase() }}</span>
          <span class="pill-value">{{ t.count }}</span>
        </div>
      </div>
    </div>

    <div class="breakdown-section" v-if="data.medals.achievementsBreakdown && data.medals.achievementsBreakdown.length > 0" style="margin-top: 14px;">
      <div class="breakdown-title">UNIQUE EARNED HONOURS</div>
      <div class="achievements-scroll">
        <div v-for="ach in data.medals.achievementsBreakdown" :key="ach.achievementId" class="ach-card">
          <span class="ach-card-name" :class="'tier-' + ach.tier.toLowerCase()">{{ ach.name.toUpperCase() }}</span>
          <span class="ach-card-count">×{{ ach.count }}</span>
        </div>
      </div>
    </div>

    <div class="medals-footer">
      {{ data.medals.lifetimeMilestoneText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlayerWrappedData } from '@/services/wrappedService'
import { getAchievementImage } from '@/utils/achievementImageUtils'

defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  cursor: pointer;
  padding: 40px;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
}

.medals-heading {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(20px, 3vw, 32px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 14px 0 20px 0;
}

.medals-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  margin: auto 0;
}

@media (min-width: 1024px) {
  .medals-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.deco-card {
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  background-color: var(--mm-bg);
}

.deco-img {
  width: 52px;
  height: 52px;
  border-radius: var(--mm-radius-sm, 2px);
  display: block;
  margin-bottom: 12px;
}

.mm-eyebrow-small {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  margin-bottom: 4px;
}

.deco-value {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-ink);
}

.breakdown-section {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}

.breakdown-title {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.breakdown-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.breakdown-pill {
  background-color: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
}

.pill-label {
  color: var(--mm-ink-muted);
}

.pill-value {
  color: var(--mm-ink);
  font-weight: 700;
}

.achievements-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: thin;
}

.ach-card {
  flex-shrink: 0;
  background-color: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ach-card-name {
  font-family: var(--mm-font-display);
  font-size: 11px;
  font-weight: 500;
}

.ach-card-count {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  background-color: var(--mm-bg-soft);
  border-radius: 2px;
  padding: 1px 4px;
}

.tier-bronze { color: #cd7f32; }
.tier-silver { color: #c0c0c0; }
.tier-gold { color: #ffd700; }
.tier-legend { color: var(--mm-kd-elite); font-weight: 700; }

.medals-footer {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  margin-top: 20px;
  line-height: 1.5;
  text-transform: uppercase;
}
</style>
