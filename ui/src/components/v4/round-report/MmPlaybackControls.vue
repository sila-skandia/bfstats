<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  isPlaying: boolean
  playbackSpeed: number
  selectedSnapshotIndex: number
  totalSnapshots: number
  currentElapsedTime: string
  snapshotTimeline: Array<{
    index: number
    label: string
    timestamp: string
  }>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-playback': []
  'reset-playback': []
  'set-playback-speed': [speed: number]
  'start-drag': [event: MouseEvent]
  'handle-dot-click': [index: number]
}>()

const sampledDots = computed(() => {
  const maxDots = 20
  const total = props.snapshotTimeline.length
  if (total <= maxDots) return props.snapshotTimeline
  const step = Math.floor(total / maxDots)
  const dots = []
  for (let i = 0; i < total; i += step) dots.push(props.snapshotTimeline[i])
  if (dots[dots.length - 1].index !== total - 1) dots.push(props.snapshotTimeline[total - 1])
  return dots
})

const handleSpeedChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  emit('set-playback-speed', parseInt(target.value))
}

const fillPercent = computed(() => {
  if (props.snapshotTimeline.length <= 1) return 0
  return (props.selectedSnapshotIndex / (props.snapshotTimeline.length - 1)) * 100
})
</script>

<template>
  <div v-if="snapshotTimeline.length > 1" class="mm-playback">
    <div class="mm-playback__head">
      <span class="mm-playback__hint">Click play to watch the round unfold, or drag the timeline</span>
      <div class="mm-playback__controls">
        <button
          type="button"
          class="mm-btn mm-btn--inline mm-playback__btn"
          title="Reset"
          @click="emit('reset-playback')"
        >⏮</button>
        <button
          type="button"
          class="mm-btn mm-btn--inline mm-playback__btn"
          :class="{ 'mm-playback__btn--playing': isPlaying }"
          title="Play / pause"
          @click="emit('toggle-playback')"
        >{{ isPlaying ? '⏸' : '▶' }}</button>
        <select
          :value="playbackSpeed"
          class="mm-playback__select"
          @change="handleSpeedChange"
        >
          <option :value="500">0.5×</option>
          <option :value="250">1×</option>
          <option :value="150">2×</option>
          <option :value="75">4×</option>
        </select>
        <span v-if="isPlaying" class="mm-chip">
          <span class="mm-chip__dot" />
          Live
        </span>
        <span class="mm-playback__clock">{{ currentElapsedTime }}</span>
      </div>
    </div>

    <div
      class="mm-playback__track"
      @mousedown="emit('start-drag', $event)"
    >
      <div class="mm-playback__fill" :style="{ width: fillPercent + '%' }" />
      <div class="mm-playback__dots">
        <button
          v-for="(dot, idx) in sampledDots"
          :key="idx"
          type="button"
          class="mm-playback__dot"
          :class="{ 'mm-playback__dot--active': dot.index === selectedSnapshotIndex }"
          :title="`${dot.label} elapsed`"
          @click.stop="emit('handle-dot-click', dot.index)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-playback {
  margin: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-playback__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-playback__hint {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-playback__controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-playback__btn {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  padding: 3px 10px;
  line-height: 1;
}

.mm-playback__btn--playing {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

.mm-playback__select {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  padding: 4px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
}

.mm-playback__clock {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  padding: 3px 10px;
  border: 1px solid var(--mm-ink);
  border-radius: 2px;
  color: var(--mm-ink);
  font-variant-numeric: tabular-nums;
}

.mm-playback__track {
  position: relative;
  height: 14px;
  background: var(--mm-bg-mute);
  border-radius: 2px;
  cursor: pointer;
  user-select: none;
}

.mm-playback__fill {
  height: 100%;
  background: var(--mm-ink);
  border-radius: 2px;
  position: relative;
  z-index: 1;
}

.mm-playback__dots {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  pointer-events: none;
  padding: 0 8px;
}

.mm-playback__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  cursor: pointer;
  pointer-events: auto;
  padding: 0;
  z-index: 2;
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.mm-playback__dot:hover,
.mm-playback__dot--active {
  transform: scale(1.3);
  border-color: var(--mm-accent);
  background: var(--mm-accent);
}

@media (max-width: 720px) {
  .mm-playback__head { flex-direction: column; align-items: stretch; }
  .mm-playback__controls { justify-content: center; flex-wrap: wrap; }
}
</style>
