<script setup lang="ts">
import { computed } from 'vue'
import { roundWatchHref, type RoundRecording } from '@/services/recordingsService'

/**
 * A round in a list that someone shared a recording of (features/recording-stats-round):
 * a chip that opens the replay on play.bfstats.io. Clicks stay off the row, which opens
 * the round's report.
 */
const props = defineProps<{ recordings: RoundRecording[] }>()

const title = computed(() =>
  props.recordings.length === 1
    ? 'Recorded in game: watch the replay'
    : `Recorded in game by ${props.recordings.length} players: watch the replay`)
</script>

<template>
  <a
    class="mm-replay-chip"
    :href="roundWatchHref(recordings)"
    target="_blank"
    rel="noopener"
    :title="title"
    data-testid="round-replay-chip"
    @click.stop
  ><i class="pi pi-play" aria-hidden="true" />Replay<span v-if="recordings.length > 1" class="mm-replay-chip__n">{{ recordings.length }}</span></a>
</template>

<style scoped>
.mm-replay-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 7px 1px 6px;
  border: 1px solid color-mix(in srgb, var(--mm-highlight) 70%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--mm-highlight) 16%, transparent);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-decoration: none;
  white-space: nowrap;
  vertical-align: middle;
  transition: background 0.15s ease, color 0.15s ease;
}
.mm-replay-chip .pi { font-size: 7px; }
.mm-replay-chip:hover,
.mm-replay-chip:focus-visible {
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
}
.mm-replay-chip__n {
  padding-left: 5px;
  border-left: 1px solid currentColor;
  opacity: 0.8;
}
</style>
