<script setup lang="ts">
import { computed } from 'vue';
import type { BattleHighlight } from '../../utils/battleEventGenerator';

interface Props {
  highlight: BattleHighlight;
  formatTimeOffset: (timestamp: string) => string;
}

const props = defineProps<Props>();

const highlightStyle = computed(() => {
  switch (props.highlight.type) {
    case 'first_blood':
      return {
        bg: 'from-red-500/10 to-transparent',
        border: 'border-red-500/30',
        text: 'text-red-400',
      };
    case 'killing_spree':
      return {
        bg: 'from-orange-500/10 to-transparent',
        border: 'border-orange-500/30',
        text: 'text-orange-400',
      };
    case 'lead_change':
      return {
        bg: 'from-purple-500/10 to-transparent',
        border: 'border-purple-500/30',
        text: 'text-purple-400',
      };
    case 'mvp':
      return {
        bg: 'from-yellow-500/10 to-transparent',
        border: 'border-yellow-500/30',
        text: 'text-yellow-400',
      };
    default:
      return {
        bg: 'from-slate-500/10 to-transparent',
        border: 'border-slate-500/30',
        text: 'text-slate-400',
      };
  }
});

const typeLabel = computed(() => {
  switch (props.highlight.type) {
    case 'first_blood': return 'FIRST BLOOD';
    case 'killing_spree': return 'STREAK';
    case 'lead_change': return 'LEAD CHANGE';
    case 'mvp': return 'MVP';
    default: return 'LOG';
  }
});
</script>

<template>
  <div
    class="group relative flex items-center gap-4 p-3 rounded border transition-all duration-300 hover:bg-white/5 cursor-default bg-gradient-to-r"
    :class="[highlightStyle.bg, highlightStyle.border]"
  >
    <!-- Icon -->
    <div class="flex-shrink-0 text-2xl filter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">
      {{ highlight.icon }}
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-1">
        <span
          class="text-[9px] font-mono font-black uppercase tracking-[0.2em]"
          :class="highlightStyle.text"
        >
          {{ typeLabel }}
        </span>
        <span class="text-[9px] text-slate-500 font-mono">
          T+{{ formatTimeOffset(highlight.timestamp) }}
        </span>
      </div>
      <div class="text-xs font-bold text-white uppercase truncate tracking-tight mb-0.5">
        {{ $pn(highlight.playerName) }}
      </div>
      <div class="text-[10px] text-slate-400 font-mono truncate leading-none">
        {{ highlight.description }}
      </div>
    </div>

    <!-- Value Badge -->
    <div
      v-if="highlight.value"
      class="flex-shrink-0 px-2 py-1 rounded bg-black/40 border border-white/5 text-[10px] font-mono font-bold"
      :class="highlightStyle.text"
    >
      {{ highlight.value }}
    </div>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'JetBrains Mono', monospace;
}
</style>
