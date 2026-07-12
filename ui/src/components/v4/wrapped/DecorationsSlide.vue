<template>
  <div class="wrapped-slide decorations-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">05 — DECORATIONS</span>
      <div class="slide-title-row">
        <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">
          {{ data.yearInNumbers?.totalDecorations?.toLocaleString() || '12,406' }} medals. Seven made the wall.
        </h2>
        <div class="dot-nav animate-rise-up desktop-only-flex" style="animation-delay: 0.15s">
          <span 
            v-for="(dot, idx) in dDots" 
            :key="idx" 
            class="dot-segment"
            :style="{ background: dot.bg }"
            @click="selectDeco(idx)"
            :title="'View ' + DECO[idx].label"
          ></span>
        </div>
      </div>
      <span class="mm-chip mm-chip--accent animate-rise-up" style="animation-delay: 0.15s">MILESTONES & PODIUMS</span>
    </div>

    <div class="decorations-content">
      <!-- Desktop Layout Wrapper -->
      <div class="desktop-layout-wrapper desktop-only-flex">
        <div class="reel-view">
          <!-- Hero: In Transition -->
          <div 
            v-if="dCur >= 0 && dPhase === 'in'" 
            class="hero-card hero-in"
          >
            <img :src="dHero.img" :alt="dHero.label" class="hero-img" />
            <div class="hero-text">
              <div class="mm-eyebrow hero-label">{{ dHero.label }}</div>
              <div class="hero-player">{{ dHero.player }}</div>
              <div class="hero-stat-row">
                <span class="hero-stat">{{ dHero.stat }}</span>
                <span class="mm-eyebrow hero-unit">{{ dHero.unit }}</span>
              </div>
              <div class="hero-desc">{{ dHero.desc }}</div>
            </div>
          </div>

          <!-- Hero: Out Transition -->
          <div 
            v-if="dCur >= 0 && dPhase === 'out'" 
            class="hero-card hero-out"
          >
            <img :src="dHero.img" :alt="dHero.label" class="hero-img" />
            <div class="hero-text">
              <div class="mm-eyebrow hero-label">{{ dHero.label }}</div>
              <div class="hero-player">{{ dHero.player }}</div>
              <div class="hero-stat-row">
                <span class="hero-stat">{{ dHero.stat }}</span>
                <span class="mm-eyebrow hero-unit">{{ dHero.unit }}</span>
              </div>
              <div class="hero-desc">{{ dHero.desc }}</div>
            </div>
          </div>

          <!-- Finished Screen -->
          <div v-if="dDone" class="replay-card">
            <div class="replay-content">
              <div class="mm-eyebrow replay-label">THE {{ data.year }} WALL</div>
              <div class="replay-title">Seven earned their place.</div>
              <button @click="startDeco" class="mm-btn mm-btn--outline replay-btn">↻ Replay</button>
            </div>
          </div>
        </div>

        <!-- The Shelf below -->
        <div class="shelf-grid">
          <div 
            v-for="(slot, idx) in dSlots" 
            :key="idx" 
            class="shelf-slot"
          >
            <div 
              v-if="slot.filled" 
              class="filled-card" 
              :style="{ animation: slot.anim }"
            >
              <div class="filled-header">
                <img :src="slot.img" :alt="slot.label" class="filled-img" />
                <div class="mm-eyebrow filled-label">{{ slot.label }}</div>
              </div>
              <div class="filled-meta">
                <div class="filled-player">{{ slot.player }}</div>
                <div class="filled-tile">{{ slot.tile }}</div>
              </div>
            </div>
            <div v-else class="empty-card"></div>
          </div>
        </div>
      </div>

      <!-- Mobile Layout Wrapper -->
      <div class="mobile-layout-wrapper mobile-only-flex">
        <!-- Hero section (Elite Warrior · Legend) -->
        <div class="mobile-legend-hero">
          <img :src="DECO[6].img" alt="" class="mobile-hero-img" />
          <div class="mobile-hero-details">
            <div class="mm-eyebrow">Elite Warrior · Legend</div>
            <div class="mobile-hero-player">{{ DECO[6].player }}</div>
            <div class="mobile-hero-rounds">
              <span class="text-danger">{{ DECO[6].stat }}</span> Consecutive Rds
            </div>
          </div>
        </div>
        <p class="mobile-legend-desc">{{ mobileLegendDesc }}</p>

        <!-- 2x3 Grid of remaining 6 decorations -->
        <div class="mobile-medals-grid">
          <div v-for="(md, idx) in mobileMedals" :key="idx" class="mobile-medal-card">
            <div class="mobile-medal-header">
              <img :src="md.img" alt="" class="mobile-medal-img" />
              <span class="mobile-medal-label">{{ md.label }}</span>
            </div>
            <div class="mobile-medal-who">{{ md.who }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ServerWrappedData } from '@/services/wrappedService'
import { getAchievementImage } from '@/utils/achievementImageUtils'

const props = defineProps<{
  data: ServerWrappedData
}>()

const emit = defineEmits<{
  (e: 'pause'): void
  (e: 'next'): void
}>()

// Animation states
const dCur = ref(-1)
const dShelf = ref<number[]>([])
const dPhase = ref<'in' | 'out'>('in')
const dDone = ref(false)

let dtTimeout: ReturnType<typeof setTimeout> | null = null
let nextTimeout: ReturnType<typeof setTimeout> | null = null

// Define the 7 decorations matching the mock
const DECO = computed(() => {
  return [
    {
      img: getAchievementImage('kill_streak_25'),
      label: 'KILL STREAKS · 25+',
      player: props.data.decorations.mostStreaksOf25.playerName || 'None',
      stat: props.data.decorations.mostStreaksOf25.value.toString(),
      unit: 'STREAKS OF 25+',
      tile: `${props.data.decorations.mostStreaksOf25.value} STREAKS`,
      desc: `${props.data.decorations.mostStreaksOf25.playerName || 'No player'} strung 25 kills together ${props.data.decorations.mostStreaksOf25.value} times this season before anyone put them down.`
    },
    {
      img: getAchievementImage('kill_streak_50'),
      label: 'STREAK OF THE YEAR',
      player: props.data.decorations.streakOfTheYear?.playerName || 'None',
      stat: (props.data.decorations.streakOfTheYear?.streak || 0).toString(),
      unit: 'KILLS · ONE LIFE',
      tile: `${props.data.decorations.streakOfTheYear?.streak || 0} · ${props.data.decorations.streakOfTheYear?.mapName || 'Unknown'}`,
      desc: `A massive run of ${props.data.decorations.streakOfTheYear?.streak || 0} kills on a single life at ${props.data.decorations.streakOfTheYear?.mapName || 'Unknown'} — the longest streak logged this year.`
    },
    {
      img: getAchievementImage('round_placement_1'),
      label: 'PODIUM FINISHES',
      player: props.data.decorations.mostPodiumFinishes.playerName || 'None',
      stat: props.data.decorations.mostPodiumFinishes.value.toString(),
      unit: 'FIRST PLACES',
      tile: `${props.data.decorations.mostPodiumFinishes.value} FIRSTS`,
      desc: `Topped the final scoreboard ${props.data.decorations.mostPodiumFinishes.value} times — more first-place finishes than any other soldier.`
    },
    {
      img: getAchievementImage(props.data.decorations.prestigiousMilestone?.achievementId || 'elite_warrior_legend'),
      label: 'PRESTIGIOUS MILESTONE',
      player: props.data.decorations.prestigiousMilestone?.playerName || 'None',
      stat: `${props.data.decorations.milestonesCrossed || 0}`,
      unit: 'TOTAL MILESTONES',
      tile: `${props.data.decorations.prestigiousMilestone?.achievementName || 'Milestone'}`,
      desc: `${props.data.decorations.prestigiousMilestone?.playerName || 'No one'} unlocked the prestigious '${props.data.decorations.prestigiousMilestone?.achievementName || 'Legend'}' milestone (out of ${props.data.decorations.milestonesCrossed} milestones crossed in total).`
    },
    {
      img: getAchievementImage(props.data.decorations.mostLegendAchievements?.achievementId || 'team_victory_legendary'),
      label: props.data.decorations.mostLegendAchievements 
        ? `MOST ${(props.data.decorations.mostLegendAchievements.tier || 'legend').toUpperCase()} MILESTONES` 
        : 'MOST LEGEND MILESTONES',
      player: props.data.decorations.mostLegendAchievements?.playerName || 'None',
      stat: (props.data.decorations.mostLegendAchievements?.value || 0).toString(),
      unit: props.data.decorations.mostLegendAchievements 
        ? `LIFETIME ${(props.data.decorations.mostLegendAchievements.tier || 'legend').toUpperCase()}S` 
        : 'LIFETIME LEGENDS',
      tile: props.data.decorations.mostLegendAchievements 
        ? `${props.data.decorations.mostLegendAchievements.value} ${props.data.decorations.mostLegendAchievements.achievementName || 'LEGENDS'}` 
        : '0 LEGENDS',
      desc: props.data.decorations.mostLegendAchievements?.description || 'Unlocked different achievements on this server.'
    },
    {
      img: getAchievementImage('elite_warrior_gold'),
      label: 'ELITE WARRIOR · GOLD',
      player: props.data.decorations.eliteWarriorGold?.playerName || 'None',
      stat: (props.data.decorations.eliteWarriorGold?.value || 0).toString(),
      unit: 'CONSECUTIVE RDS',
      tile: `GOLD · ${props.data.decorations.eliteWarriorGold?.value || 0} RDS`,
      desc: `Held onto the Gold tier K/D ratio (>= 4.0 over last 100 rounds) for a grueling ${props.data.decorations.eliteWarriorGold?.value || 0} consecutive rounds.`
    },
    {
      img: getAchievementImage('elite_warrior_legend'),
      label: 'ELITE WARRIOR · LEGEND',
      player: props.data.decorations.eliteWarriorLegend?.playerName || 'None',
      stat: (props.data.decorations.eliteWarriorLegend?.value || 0).toString(),
      unit: 'CONSECUTIVE RDS',
      tile: `LEGEND · ${props.data.decorations.eliteWarriorLegend?.value || 0} RDS`,
      desc: `The only soldier to hold onto the Legendary tier K/D ratio (>= 5.0 over last 200 rounds) for ${props.data.decorations.eliteWarriorLegend?.value || 0} consecutive rounds without slipping.`
    }
  ]
})

const dHero = computed(() => {
  const cur = dCur.value
  return cur >= 0 ? DECO.value[cur] : { img: '', label: '', player: '', stat: '', unit: '', tile: '', desc: '' }
})

const dSlots = computed(() => {
  const shelf = dShelf.value
  const newest = shelf.length ? shelf[shelf.length - 1] : -1
  return DECO.value.map((d, i) => {
    const filled = shelf.indexOf(i) >= 0
    return {
      filled,
      emptyFlag: !filled,
      img: d.img,
      label: d.label,
      player: d.player,
      tile: d.tile,
      anim: i === newest ? 'cellIn .5s cubic-bezier(.22,.61,.36,1) both' : 'none'
    }
  })
})

const dDots = computed(() => {
  const shelf = dShelf.value
  const cur = dCur.value
  return DECO.value.map((_, i) => ({
    bg: shelf.indexOf(i) >= 0 ? 'var(--mm-ink)' : i === cur ? 'var(--mm-accent-soft)' : 'var(--mm-rule-strong)'
  }))
})

// Mobile specific computed helpers
const mobileLegendDesc = computed(() => {
  const val = props.data.decorations.eliteWarriorLegend?.value || 0
  if (val > 0) {
    return `${props.data.decorations.eliteWarriorLegend?.playerName} held the Legendary K/D tier (≥ 5.0 over 200 rounds) for ${val} consecutive rounds.`
  } else {
    return 'Nobody held the Legendary K/D tier (≥ 5.0 over 200 rounds) for a single consecutive round. The wall stays honest.'
  }
})

const mobileMedals = computed(() => {
  const d = props.data.decorations
  return [
    {
      img: getAchievementImage('kill_streak_25'),
      label: 'Kill Streak',
      who: `${d.mostStreaksOf25.playerName || 'None'} · ${d.mostStreaksOf25.value}`
    },
    {
      img: getAchievementImage('kill_streak_50'),
      label: 'Streak',
      who: `${d.streakOfTheYear?.playerName || 'None'} · ${d.streakOfTheYear?.streak || 0}`
    },
    {
      img: getAchievementImage('round_placement_1'),
      label: 'Podium',
      who: `${d.mostPodiumFinishes.playerName || 'None'} · ${d.mostPodiumFinishes.value}`
    },
    {
      img: getAchievementImage(d.prestigiousMilestone?.achievementId || 'elite_warrior_legend'),
      label: 'Prestige',
      who: `${d.prestigiousMilestone?.playerName || 'None'} · ${d.prestigiousMilestone?.achievementName || 'Milestone'}`
    },
    {
      img: getAchievementImage(d.mostLegendAchievements?.achievementId || 'team_victory_legendary'),
      label: 'Most Legend',
      who: `${d.mostLegendAchievements?.playerName || 'None'} · ${d.mostLegendAchievements?.value || 0}`
    },
    {
      img: getAchievementImage('elite_warrior_gold'),
      label: 'Elite W.',
      who: `${d.eliteWarriorGold?.playerName || 'None'} · Gold`
    }
  ]
})

// Control functions
function selectDeco(idx: number) {
  dCur.value = idx
  dShelf.value = Array.from({ length: idx }, (_, i) => i)
  dPhase.value = 'in'
  dDone.value = false
  emit('pause')
  
  if (dtTimeout) clearTimeout(dtTimeout)
  if (nextTimeout) clearTimeout(nextTimeout)
}

function startDeco() {
  if (dtTimeout) clearTimeout(dtTimeout)
  if (nextTimeout) clearTimeout(nextTimeout)
  
  // Check prefers-reduced-motion or if viewport is mobile
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches
  const isMobileViewport = window.innerWidth <= 1023
  
  if (reduce || isMobileViewport) {
    dCur.value = -1
    dShelf.value = DECO.value.map((_, i) => i)
    dDone.value = true
    return
  }
  
  dCur.value = 0
  dShelf.value = []
  dPhase.value = 'in'
  dDone.value = false
  
  dtTimeout = setTimeout(() => decoOut(), 2800)
}

function decoOut() {
  dPhase.value = 'out'
  dtTimeout = setTimeout(() => decoCollect(), 600)
}

function decoCollect() {
  const cur = dCur.value
  const next = cur + 1
  const done = next >= DECO.value.length
  
  dShelf.value = [...dShelf.value, cur]
  dCur.value = done ? -1 : next
  dPhase.value = 'in'
  dDone.value = done
  
  if (!done) {
    dtTimeout = setTimeout(() => decoOut(), 2800)
  } else {
    nextTimeout = setTimeout(() => {
      emit('next')
    }, 1000)
  }
}

onMounted(() => {
  emit('pause')
  dtTimeout = setTimeout(() => startDeco(), 500)
})

onUnmounted(() => {
  if (dtTimeout) clearTimeout(dtTimeout)
  if (nextTimeout) clearTimeout(nextTimeout)
})
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.slide-header {
  margin-bottom: 12px;
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

.slide-title-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.slide-title {
  font-family: var(--mm-font-display);
  font-size: clamp(24px, 3.5vw, 38px);
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 0;
  flex: 1;
  text-align: left;
}

.dot-nav {
  display: flex;
  gap: 5px;
  padding-top: 12px;
}

.dot-segment {
  width: 16px;
  height: 3px;
  border-radius: 1px;
  transition: background 0.3s ease;
  cursor: pointer;
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
  margin-top: 4px;
}

.decorations-content {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.desktop-layout-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
}

.mobile-layout-wrapper {
  display: none !important;
}

.reel-view {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  margin-top: 10px;
  margin-bottom: 24px;
}

.hero-card {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 36px;
  width: 100%;
}

.hero-img {
  width: 160px;
  height: 160px;
  border-radius: var(--mm-radius-sm, 2px);
  flex-shrink: 0;
  display: block;
}

.hero-text {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.hero-label {
  color: var(--mm-accent-soft);
  letter-spacing: 0.18em;
  font-size: 10.5px;
  margin-bottom: 6px;
}

.hero-player {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(32px, 5.5vw, 52px);
  line-height: 1.05;
  letter-spacing: -0.03em;
  color: var(--mm-ink);
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hero-stat-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.hero-stat {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(28px, 4.5vw, 42px);
  line-height: 1;
  color: var(--mm-streak);
}

.hero-unit {
  letter-spacing: 0.12em;
  font-size: 9.5px;
}

.hero-desc {
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  line-height: 1.45;
  color: var(--mm-ink-soft);
  max-width: 540px;
}

.replay-card {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.replay-content {
  text-align: center;
}

.replay-label {
  color: var(--mm-accent-soft);
  letter-spacing: 0.2em;
  margin-bottom: 6px;
}

.replay-title {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 32px;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin-bottom: 16px;
}

.replay-btn {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* Shelf Section */
.shelf-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  width: 100%;
}

.shelf-slot {
  height: 105px;
  min-width: 0;
}

.filled-card {
  height: 100%;
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--mm-bg-soft);
  text-align: left;
}

.filled-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.filled-img {
  width: 24px;
  height: 24px;
  border-radius: 1px;
  flex-shrink: 0;
  display: block;
}

.filled-label {
  font-size: 7px;
  line-height: 1.2;
  letter-spacing: 0.05em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.filled-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.filled-player {
  font-size: 8px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filled-tile {
  font-family: var(--mm-font-mono);
  font-size: 7.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-card {
  height: 100%;
  border: 1px dashed var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  opacity: 0.35;
}

/* Animations */
.hero-in {
  animation: decoHeroIn 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

.hero-out {
  transform-origin: left bottom;
  animation: decoHeroOut 0.60s cubic-bezier(0.4, 0, 0.65, 0.5) both;
}

@keyframes decoHeroIn {
  0% {
    opacity: 0;
    transform: translateY(22px);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}

@keyframes decoHeroOut {
  0% {
    opacity: 1;
    transform: none;
  }
  55% {
    opacity: 0.45;
  }
  100% {
    opacity: 0;
    transform: translateY(120px) scale(0.35);
  }
}

@keyframes cellIn {
  0% {
    opacity: 0;
    transform: scale(0.72);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}

/* Mobile CSS overrides */
@media (max-width: 1023px) {
  .desktop-layout-wrapper {
    display: none !important;
  }
  
  .mobile-layout-wrapper {
    display: flex !important;
    flex-direction: column;
    width: 100%;
    margin-top: 10px;
  }
  
  .mobile-legend-hero {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-top: 10px;
    text-align: left;
  }
  
  .mobile-hero-img {
    width: 88px;
    height: 88px;
    object-fit: contain;
    flex-shrink: 0;
  }
  
  .mobile-hero-details {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  
  .mobile-hero-details .mm-eyebrow {
    font-size: 11px !important;
    letter-spacing: 0.13em;
    color: var(--mm-accent);
    text-transform: uppercase;
  }
  
  .mobile-hero-player {
    font-family: var(--mm-font-display);
    font-weight: 300;
    font-size: 40px;
    line-height: 1;
    color: var(--mm-ink);
    margin: 5px 0 0;
  }
  
  .mobile-hero-rounds {
    margin-top: 8px;
    font-family: var(--mm-font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--mm-ink-muted);
  }
  
  .mobile-hero-rounds .text-danger {
    color: var(--mm-danger);
    font-size: 14px;
    font-weight: 600;
  }
  
  .mobile-legend-desc {
    margin: 16px 0 0;
    font-family: var(--mm-font-display);
    font-size: 14px;
    line-height: 1.5;
    color: var(--mm-ink-soft);
    text-align: left;
  }
  
  .mobile-medals-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 24px;
    width: 100%;
  }
  
  .mobile-medal-card {
    border: 1px solid var(--mm-rule);
    border-radius: var(--mm-radius-sm, 2px);
    padding: 11px;
    background: var(--mm-bg);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }
  
  .mobile-medal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }
  
  .mobile-medal-img {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
  }
  
  .mobile-medal-label {
    font-family: var(--mm-font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--mm-ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  
  .mobile-medal-who {
    margin-top: 10px;
    font-family: var(--mm-font-mono);
    font-size: 9.5px;
    letter-spacing: 0.02em;
    color: var(--mm-ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
    text-align: left;
  }
}
</style>
