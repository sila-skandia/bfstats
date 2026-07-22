<template>
  <div class="wrapped-slide closest-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">07 — CLOSEST BATTLES · 50+ SOLDIERS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Decided by {{ lowestMargin }} {{ lowestMargin === 1 ? 'ticket' : 'tickets' }}.</h2>
    </div>

    <div class="closest-content">
      <div class="battles-flex-container">
        <div 
          v-for="(battle, idx) in data.closestBattles.slice(0, 3)" 
          :key="idx" 
          class="battle-card-item animate-rise-up"
          :style="{ animationDelay: ((idx * 0.08) + 0.15) + 's', cursor: 'pointer' }"
          @click.stop="selectedRoundId = battle.roundId"
        >
          <!-- Desktop Card Layout -->
          <div class="desktop-card-layout desktop-only-flex">
            <div class="battle-date-mono">{{ formatDate(battle.date) }}</div>
            <div class="battle-map-name">{{ battle.mapName }}</div>
            <div class="battle-margin-val">{{ (battle.winningTeam || 'Allies').toUpperCase() }} BY {{ battle.ticketsMargin }}</div>
            <div class="battle-details-row">
              <span><strong class="text-ink">{{ battle.playersCount }}</strong> SOLDIERS</span>
              <span>{{ Math.round(battle.durationMinutes) }} MINS</span>
              <span class="report-link" style="margin-left: auto; color: var(--mm-kd-elite); font-weight: 600;">REPORT &rarr;</span>
            </div>
          </div>

          <!-- Mobile Card Layout -->
          <div class="mobile-card-layout mobile-only-flex">
            <div class="battle-right-details">
              <div class="battle-date-mono">{{ formatDate(battle.date) }}</div>
              <div class="battle-map-name">{{ battle.mapName }}</div>
              <div class="battle-margin-val" style="font-size: 22px !important; margin: 4px 0 8px; font-weight: 500; color: var(--mm-danger);">{{ (battle.winningTeam || 'Allies').toUpperCase() }} BY {{ battle.ticketsMargin }}</div>
              <div class="battle-details-row">
                <span><strong class="text-ink">{{ battle.playersCount }}</strong> soldiers</span>
                <span class="divider">·</span>
                <span>{{ Math.round(battle.durationMinutes) }} mins</span>
                <span class="divider">·</span>
                <span style="color: var(--mm-kd-elite); font-weight: 600;">report &rarr;</span>
              </div>
            </div>
          </div>
        </div>
        <div v-if="data.closestBattles.length === 0" class="empty-state">
          No records of extremely close rounds.
        </div>
      </div>
    </div>

    <!-- Slideover for inline Round Report -->
    <Teleport to="body">
      <div 
        v-if="selectedRoundId" 
        class="mm round-report-slideover"
        @click.self="selectedRoundId = null"
      >
        <div class="slideover-content">
          <div class="slideover-header">
            <button class="close-btn" @click="selectedRoundId = null">
              <span>&larr; CLOSE REPORT</span>
            </button>
          </div>
          <div class="slideover-body">
            <MmRoundReportV2 :round-id="selectedRoundId" />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ServerWrappedData } from '@/services/wrappedService'
import MmRoundReportV2 from '@/components/v4/MmRoundReportV2.vue'

const props = defineProps<{
  data: ServerWrappedData
}>()

const selectedRoundId = ref<string | null>(null)

const lowestMargin = computed(() => {
  if (!props.data.closestBattles || props.data.closestBattles.length === 0) return 3
  return Math.min(...props.data.closestBattles.map(b => b.ticketsMargin))
})

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.startsWith('-999')) return '2026'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  } catch {
    return '2026'
  }
}
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

.closest-content {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
}

.battles-flex-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

@media (min-width: 640px) {
  .battles-flex-container {
    flex-direction: row;
  }
}

.battle-card-item {
  flex: 1;
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 12px 14px;
  background-color: var(--mm-bg);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.battle-card-item:hover {
  border-color: var(--mm-kd-elite);
  transform: translateY(-2px);
}

.battle-date-mono {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
}

.battle-map-name {
  font-family: var(--mm-font-display);
  font-size: 17px;
  color: var(--mm-ink);
  margin: 7px 0 10px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.battle-margin-val {
  font-family: var(--mm-font-display);
  font-weight: 500;
  font-size: 16px;
  line-height: 1.2;
  color: var(--mm-danger);
  margin-top: auto;
  text-transform: uppercase;
}

.battle-details-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  width: 100%;
}

.text-ink {
  color: var(--mm-ink);
}

.empty-state {
  text-align: center;
  padding: 30px;
  color: var(--mm-ink-faint);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  width: 100%;
}

.desktop-only-flex {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.mobile-only-flex {
  display: none !important;
}

@media (max-width: 1023px) {
  .desktop-only-flex {
    display: none !important;
  }
  .mobile-only-flex {
    display: flex !important;
  }
  
  .battle-card-item {
    padding: 18px 20px !important;
  }
  
  .mobile-card-layout {
    display: flex !important;
    align-items: center;
    gap: 18px;
    width: 100%;
    text-align: left;
  }
  
  .battle-right-details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  
  .battle-right-details .battle-map-name {
    margin: 4px 0 6px 0 !important;
    font-size: 19px !important;
  }
  
  .battle-right-details .battle-details-row {
    margin-top: 0 !important;
    padding-top: 0 !important;
    border-top: none !important;
    font-size: 10px !important;
    gap: 6px !important;
  }
  
  .divider {
    color: var(--mm-ink-faint);
  }
}

/* Slideover Styles */
.round-report-slideover {
  position: fixed;
  top: 0;
  right: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  justify-content: flex-end;
  animation: fadeIn 0.3s ease;
}

.slideover-content {
  width: 95vw;
  max-width: 1600px;
  height: 100%;
  background-color: var(--mm-bg);
  border-left: 1px solid var(--mm-rule);
  display: flex;
  flex-direction: column;
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
  animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.slideover-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--mm-rule);
  background-color: var(--mm-bg-soft);
  display: flex;
  align-items: center;
}

.close-btn {
  background: none;
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 8px 16px;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink-soft);
  background-color: var(--mm-bg-mute);
}

.slideover-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
</style>
