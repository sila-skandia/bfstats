<template>
  <div class="wrapped-slide decorations-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">05 — DECORATIONS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Four stood out.</h2>
      <span class="mm-chip animate-rise-up" style="animation-delay: 0.15s">MILESTONES & PODIUMS</span>
    </div>

    <div class="decorations-content">
      <div class="decorations-grid">
        <!-- Card 1: 25+ Streaks -->
        <div class="deco-card animate-rise-up" style="animation-delay: 0.15s">
          <img 
            :src="getAchievementImage('kill_streak_25')" 
            alt="Kill streak 25 medal" 
            class="deco-img"
          />
          <div class="mm-eyebrow">KILL STREAKS · 25+</div>
          <div class="deco-name">{{ data.decorations.mostStreaksOf25.playerName || 'None' }}</div>
          <div class="deco-desc-mono">
            <span class="text-accent">{{ data.decorations.mostStreaksOf25.value }} STREAKS</span> OF 25+
          </div>
        </div>

        <!-- Card 2: Streak of the Year -->
        <div class="deco-card animate-rise-up" style="animation-delay: 0.23s">
          <img 
            :src="getAchievementImage('kill_streak_50')" 
            alt="Kill streak 50 medal" 
            class="deco-img"
          />
          <div class="mm-eyebrow">STREAK OF THE YEAR</div>
          <div class="deco-name">{{ data.decorations.streakOfTheYear?.playerName || 'None' }}</div>
          <div class="deco-desc-mono">
            <span class="text-accent">{{ data.decorations.streakOfTheYear?.streak || 0 }} KILLS</span>, ONE LIFE · {{ data.decorations.streakOfTheYear?.mapName || 'Unknown' }}
          </div>
        </div>

        <!-- Card 3: Podium Finishes -->
        <div class="deco-card animate-rise-up" style="animation-delay: 0.31s">
          <img 
            :src="getAchievementImage('round_placement_1')" 
            alt="First place medal" 
            class="deco-img"
          />
          <div class="mm-eyebrow">PODIUM FINISHES</div>
          <div class="deco-name">{{ data.decorations.mostPodiumFinishes.playerName || 'None' }}</div>
          <div class="deco-desc-mono">
            <span class="text-ink">{{ data.decorations.mostPodiumFinishes.value }}</span> FIRST PLACES
          </div>
        </div>

        <!-- Card 4: Prestigious Milestones -->
        <div class="deco-card animate-rise-up" style="animation-delay: 0.39s">
          <img 
            :src="getAchievementImage(data.decorations.prestigiousMilestone?.achievementId || 'elite_warrior_legend')" 
            :alt="data.decorations.prestigiousMilestone?.achievementName || 'Milestone medal'" 
            class="deco-img"
          />
          <div class="mm-eyebrow">PRESTIGIOUS MILESTONE</div>
          <template v-if="data.decorations.prestigiousMilestone">
            <div class="deco-name" :title="data.decorations.prestigiousMilestone.playerName">
              {{ data.decorations.prestigiousMilestone.playerName }}
            </div>
            <div class="deco-desc-mono">
              <span class="text-accent">{{ data.decorations.prestigiousMilestone.achievementName }}</span>
              <br/>
              <span class="total-count-label">(of {{ data.decorations.milestonesCrossed }} in total)</span>
            </div>
          </template>
          <template v-else>
            <div class="deco-name">All Players</div>
            <div class="deco-desc-mono">
              <span class="text-accent">{{ data.decorations.milestonesCrossed }}</span> MILESTONES UNLOCKED
            </div>
          </template>
        </div>
      </div>

      <div class="decorations-footer animate-rise-up" style="animation-delay: 0.5s">
        MILESTONES CROSSED IN 2026: TOTAL LIFETIME ACHIEVEMENTS EARNED ON THIS SERVER.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ServerWrappedData } from '@/services/wrappedService'
import { getAchievementImage } from '@/utils/achievementImageUtils'

defineProps<{
  data: ServerWrappedData
}>()
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.slide-header {
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.slide-badge {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.slide-title {
  font-family: var(--mm-font-display);
  font-size: 38px;
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 0;
}

.mm-chip {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-accent-soft);
  border: 1px solid var(--mm-rule);
  padding: 2px 6px;
  border-radius: var(--mm-radius-sm, 2px);
  text-transform: uppercase;
  display: inline-block;
}

.decorations-content {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.decorations-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

@media (min-width: 640px) {
  .decorations-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .decorations-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.deco-card {
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 12px 12px;
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
  margin-bottom: 8px;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  margin-bottom: 4px;
}

.deco-name {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-ink);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.deco-desc-mono {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  line-height: 1.4;
}

.total-count-label {
  font-size: 8.5px;
  color: var(--mm-ink-faint);
}

.text-accent {
  color: var(--mm-accent-soft);
  font-weight: 600;
}

.text-ink {
  color: var(--mm-ink);
  font-weight: 600;
}

.decorations-footer {
  margin-top: 12px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-faint);
}
</style>
