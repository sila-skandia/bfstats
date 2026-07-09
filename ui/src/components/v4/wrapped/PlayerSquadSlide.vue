<template>
  <div class="wrapped-slide squad-slide animate-line-in" @click="$emit('next')">
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
            v-for="(buddy, index) in data.squad" 
            :key="buddy.name" 
            class="squad-row animate-rise-up"
            :style="{ animationDelay: ((index * 0.08) + 0.2) + 's' }"
          >
            <span class="row-num">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="row-name">{{ buddy.name }}</span>
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
</template>

<script setup lang="ts">
import type { PlayerWrappedData } from '@/services/wrappedService'

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
