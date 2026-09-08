<script setup lang="ts">
import { computed } from 'vue'
import MmBaseModal from '@/components/v4/MmBaseModal.vue'
import MmMapDossier, { type DossierLiveTickets } from '@/components/v4/MmMapDossier.vue'

/**
 * The level briefing for a map, opened from wherever a map is named — a row on the
 * landing page, the now-playing cell on a server.
 *
 * Placeholders are on here: the reader opened this deliberately, so a map with no
 * briefing has to say so rather than present an empty dialog.
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** bflist gameId — the mod folder, e.g. "bf1942", "dc_final", "fhsw". */
    gameId?: string | null
    mapName?: string | null
    /** Live tickets from the server currently running this map. */
    liveTickets?: DossierLiveTickets | null
    /** Whether this briefing is opened for a live server round. */
    isLive?: boolean
  }>(),
  { gameId: null, mapName: null, liveTickets: null, isLive: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

/** bflist reports "omaha beach"; a dialog title should read "Omaha Beach". */
const title = computed(() =>
  (props.mapName || 'Map').replace(/\b[a-z]/g, (c) => c.toUpperCase()),
)
const subtitle = computed(() =>
  props.gameId ? `${props.gameId.toUpperCase()} · level briefing` : 'Level briefing',
)
</script>

<template>
  <MmBaseModal
    :model-value="modelValue"
    :title="title"
    :subtitle="subtitle"
    size="xl"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- Keyed so reopening on a different map refetches instead of showing the last one. -->
    <MmMapDossier
      v-if="modelValue"
      :key="`${gameId}/${mapName}`"
      :game-id="gameId"
      :map-name="mapName"
      :live-tickets="liveTickets"
      :is-live="isLive"
      show-placeholders
      hide-heading
    />
  </MmBaseModal>
</template>
