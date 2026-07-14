<template>
  <div class="wrapped-slide squad-slide animate-line-in" @click="$emit('next')">
    <div class="squad-left-container">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">06 — SQUAD</div>
      
      <div v-if="data.squad && data.squad.length > 0" class="squad-layout-active">
        <div class="squad-heading animate-rise-up" style="animation-delay: 0.1s">
          Rode with these soldiers all year.
        </div>

        <div class="squad-container">
          <div class="squad-table-header animate-rise-up" style="animation-delay: 0.15s">
            <span>BUDDY</span>
          </div>

          <div class="squad-list">
            <div 
              v-for="(buddy, index) in data.squad.slice(0, 5)" 
              :key="buddy.name" 
              class="squad-row animate-rise-up"
              :style="{ animationDelay: ((index * 0.08) + 0.2) + 's' }"
            >
              <span class="row-num">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="row-name">{{ buddy.name }}</span>
            </div>
          </div>
        </div>

        <div v-if="data.relations && (data.relations.luckyCharmName || data.relations.archNemesisName || data.relations.twoFaceName)" class="relations-container animate-rise-up" style="animation-delay: 0.5s">
          <div class="relations-heading">Combat Ties</div>
          
          <!-- Two Face Card -->
          <div v-if="data.relations.twoFaceName" class="relation-card card-twoface animate-rise-up" style="animation-delay: 0.55s">
            <div class="card-icon">🎭</div>
            <div class="card-body">
              <div class="card-role">Two Face</div>
              <div class="card-name">{{ data.relations.twoFaceName }}</div>
              <div class="card-desc">
                Your closest ally and fiercest rival. You shared <span class="highlight">{{ data.relations.twoFaceWins }} victories</span> on the same team, but they were also on the winning side in <span class="highlight">{{ data.relations.twoFaceLosses }} of your losses</span> when they opposed you.
              </div>
            </div>
          </div>

          <!-- Lucky Charm & Arch Nemesis Split Cards -->
          <div v-else class="relations-split">
            <div v-if="data.relations.luckyCharmName" class="relation-card card-charm animate-rise-up" style="animation-delay: 0.55s">
              <div class="card-icon">🍀</div>
              <div class="card-body">
                <div class="card-role">Lucky Charm</div>
                <div class="card-name">{{ data.relations.luckyCharmName }}</div>
                <div class="card-desc">
                  Shared <span class="highlight">{{ data.relations.luckyCharmWins }} victories</span> on your team. Win rate increases in their presence.
                </div>
              </div>
            </div>

            <div v-if="data.relations.archNemesisName" class="relation-card card-nemesis animate-rise-up" style="animation-delay: 0.6s">
              <div class="card-icon">🗡️</div>
              <div class="card-body">
                <div class="card-role">Arch Nemesis</div>
                <div class="card-name">{{ data.relations.archNemesisName }}</div>
                <div class="card-desc">
                  Opposed you and won in <span class="highlight">{{ data.relations.archNemesisLosses }} of your losses</span>. Always on the other winning team.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="lone-wolf-container animate-rise-up" style="animation-delay: 0.15s">
        <div class="squad-heading">
          Fought this war as a lone wolf.
        </div>
        <div class="lone-wolf-body">
          No frequent squad mates or co-players were recorded in your company this year. You relied entirely on your own combat instincts.
        </div>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 07</div>
          <div class="hero-sub">THE SQUAD<br>DROP: ch7p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch7p" alt="The Squad" class="hero-img">
        </div>
        <div class="hero-overlay-smoke"></div>
        <div class="hero-overlay-grad"></div>
        <div class="hero-border-inset"></div>
        <div class="hero-corner hero-corner-tl"></div>
        <div class="hero-corner hero-corner-tr"></div>
        <div class="hero-corner hero-corner-bl"></div>
        <div class="hero-corner hero-corner-br"></div>
        <div class="hero-caption">
          <span class="hero-caption-dot"></span>
          Fig. 07 — The Squad
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlayerWrappedData } from '@/services/wrappedService'
import ch7p from '@/assets/wrapped/ch7p.webp'

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
  padding: 0;
}

@media (min-width: 1024px) {
  .wrapped-slide {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    gap: 46px;
    align-items: stretch;
    padding: 40px;
  }
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
}

.squad-heading {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(20px, 3vw, 32px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 14px 0 20px 0;
}

.squad-layout-active {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.squad-container {
  margin: auto 0;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.squad-table-header {
  display: flex;
  justify-content: space-between;
  background-color: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  border-radius: 2px;
  padding: 5px 12px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.squad-list {
  display: flex;
  flex-direction: column;
}

.squad-row {
  display: flex;
  align-items: baseline;
  padding: 11px 12px;
  border-bottom: 1px solid var(--mm-rule);
}

.row-num {
  width: 28px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.row-name {
  flex: 1;
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mm-ink);
  text-align: left;
}

.row-rounds {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  color: var(--mm-ink-muted);
}

.relations-container {
  margin-top: 24px;
  text-align: left;
  width: 100%;
}

.relations-heading {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  border-bottom: 1px solid var(--mm-rule-strong);
  padding-bottom: 6px;
  margin-bottom: 12px;
}

.relations-split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 640px) {
  .relations-split {
    grid-template-columns: 1fr 1fr;
  }
}

.relation-card {
  display: flex;
  gap: 12px;
  background-color: var(--surface-sunken);
  border: 1px solid var(--border-hairline);
  border-radius: 2px;
  padding: 12px;
  transition: all 0.25s ease;
}

.relation-card:hover {
  border-color: var(--mm-rule-strong);
}

.card-icon {
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.card-role {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.card-name {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 700;
  color: var(--mm-ink);
  margin: 2px 0 4px 0;
}

.card-desc {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  line-height: 1.45;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.card-desc .highlight {
  font-weight: 700;
  color: var(--mm-accent);
}

.card-charm {
  border-left: 3px solid var(--mm-success);
}

.card-nemesis {
  border-left: 3px solid var(--mm-accent);
}

.card-twoface {
  border-left: 3px solid var(--mm-kd-elite);
  width: 100%;
  box-sizing: border-box;
}

.lone-wolf-container {
  margin: auto 0;
  text-align: left;
  max-width: 600px;
}

.lone-wolf-body {
  font-family: var(--mm-font-display);
  font-size: 15px;
  line-height: 1.5;
  color: var(--mm-ink-muted);
  margin-top: 10px;
}
</style>
