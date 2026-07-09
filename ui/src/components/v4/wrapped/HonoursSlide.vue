<template>
  <div class="wrapped-slide honours-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">04 — HONOURS · QUALIFIED BOARDS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Skill, not hours.</h2>
      <span class="mm-chip animate-rise-up" style="animation-delay: 0.15s">MIN 100 ROUNDS</span>
    </div>

    <!-- Toggles: visible only on mobile/tablet viewports -->
    <div class="tabs-container mobile-only">
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'kd' }"
        @click="selectTab('kd')"
      >
        K/D Ratio
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'killrate' }"
        @click="selectTab('killrate')"
      >
        Kill Rate
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'volume' }"
        @click="selectTab('volume')"
      >
        Volume
      </button>
    </div>

    <div class="honours-content">
      <!-- Widescreen side-by-side grid (or stacked on mobile based on activeTab) -->
      <div class="boards-grid">
        <!-- 1. K/D Ratio Board -->
        <div v-if="activeTab === 'kd' || isDesktop" class="board-card">
          <div class="board-header-row animate-rise-up" style="animation-delay: 0.15s">
            <span>K/D RATIO</span>
            <span>RDS</span>
          </div>
          <div 
            v-for="(p, i) in data.honours.topKDRatios.slice(0, 3)" 
            :key="p.playerName" 
            class="board-row animate-rise-up"
            :style="{ animationDelay: ((i * 0.08) + 0.2) + 's' }"
          >
            <span class="col-rank">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="col-name">{{ p.playerName }}</span>
            <span class="col-stat text-elite">{{ p.kdRatio.toFixed(2) }}</span>
            <span class="col-rounds">{{ p.rounds }}</span>
          </div>
          <div v-if="data.honours.topKDRatios.length === 0" class="empty-state">
            No qualified combatants.
          </div>
        </div>

        <!-- 2. Kill Rate Board -->
        <div v-if="activeTab === 'killrate' || isDesktop" class="board-card">
          <div class="board-header-row animate-rise-up" style="animation-delay: 0.25s">
            <span>KILL RATE · KILLS/MIN</span>
            <span>RDS</span>
          </div>
          <div 
            v-for="(p, i) in data.honours.topKillRates.slice(0, 3)" 
            :key="p.playerName" 
            class="board-row animate-rise-up"
            :style="{ animationDelay: ((i * 0.08) + 0.3) + 's' }"
          >
            <span class="col-rank">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="col-name">{{ p.playerName }}</span>
            <span class="col-stat text-elite">{{ p.killRate.toFixed(2) }}</span>
            <span class="col-rounds">{{ p.rounds }}</span>
          </div>
          <div v-if="data.honours.topKillRates.length === 0" class="empty-state">
            No qualified combatants.
          </div>
        </div>
      </div>

      <!-- Volume Board Footer -->
      <div v-if="activeTab === 'volume' || isDesktop" class="volume-footer animate-rise-up" style="animation-delay: 0.5s">
        <span class="volume-title">VOLUME BOARDS (THEY TRACK HOURS, NOT SKILL) — </span>
        <span class="volume-item">
          SCORE <strong class="text-highlight">{{ data.honours.volumeBoards.topScore.playerName || 'None' }} {{ data.honours.volumeBoards.topScore.value.toLocaleString() }}</strong>
        </span>
        <span class="divider">·</span>
        <span class="volume-item">
          KILLS <strong class="text-highlight">{{ data.honours.volumeBoards.topKills.playerName || 'None' }} {{ data.honours.volumeBoards.topKills.value.toLocaleString() }}</strong>
        </span>
        <span class="divider">·</span>
        <span class="volume-item">
          HOURS <strong class="text-highlight">{{ data.honours.volumeBoards.topHours.playerName || 'None' }} {{ data.honours.volumeBoards.topHours.value.toLocaleString() }}h</strong>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { ServerWrappedData } from '@/services/wrappedService'

defineProps<{
  data: ServerWrappedData
}>()

const emit = defineEmits<{
  (e: 'pause'): void
}>()

const activeTab = ref<'kd' | 'killrate' | 'volume'>('kd')
const isDesktop = ref(true)

function checkViewport() {
  isDesktop.value = window.innerWidth > 768
}

function selectTab(tab: 'kd' | 'killrate' | 'volume') {
  activeTab.value = tab
  emit('pause')
}

onMounted(() => {
  checkViewport()
  window.addEventListener('resize', checkViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkViewport)
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

.tabs-container {
  display: none;
  background-color: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  padding: 3px;
  border-radius: var(--mm-radius-sm, 2px);
  margin-bottom: 20px;
  gap: 4px;
}

@media (max-width: 768px) {
  .tabs-container.mobile-only {
    display: flex;
  }
}

.tab-btn {
  flex: 1;
  background: none;
  border: none;
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  padding: 6px 12px;
  border-radius: var(--mm-radius-sm, 2px);
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
}

.tab-btn:hover {
  color: var(--mm-ink);
}

.tab-btn.active {
  background-color: var(--mm-highlight);
  color: #000;
}

.honours-content {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.boards-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

@media (min-width: 769px) {
  .boards-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.board-card {
  display: flex;
  flex-direction: column;
}

.board-header-row {
  display: flex;
  justify-content: space-between;
  background-color: var(--mm-highlight);
  color: #000;
  border-radius: var(--mm-radius-sm, 2px);
  padding: 5px 12px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
}

.board-row {
  display: flex;
  align-items: baseline;
  padding: 7px 12px;
  border-bottom: 1px solid var(--mm-rule);
}

.col-rank {
  width: 28px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.col-name {
  flex: 1;
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 12px;
}

.col-stat {
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-weight: 600;
}

.text-elite {
  color: var(--mm-accent-soft);
}

.col-rounds {
  width: 60px;
  text-align: right;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.empty-state {
  text-align: center;
  padding: 20px;
  color: var(--mm-ink-faint);
  font-family: var(--mm-font-mono);
  font-size: 11px;
}

.volume-footer {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  line-height: 1.6;
}

.volume-title {
  color: var(--mm-ink-faint);
}

.text-highlight {
  color: var(--mm-ink);
  font-weight: 600;
}

.divider {
  margin: 0 8px;
  color: var(--mm-ink-faint);
}
</style>
