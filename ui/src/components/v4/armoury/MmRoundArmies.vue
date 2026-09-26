<script setup lang="ts">
// The two armies of a round's map, face to face: the level's own uniforms for
// Axis and Allied, the winner lit and the loser in shadow.
import { computed } from 'vue'
import MmFaceoffBand, { type FaceoffSide } from './MmFaceoffBand.vue'
import { defaultKit, figureSpec, modLabel, nationBadge } from './meshAssets'
import type { MapArmies } from '@/services/serviceRecordApi'

const props = defineProps<{
  armies: MapArmies
  /** Team index (1 or 2) once the round has a winner; null while live or level. */
  winner: 1 | 2 | null
  isActive: boolean
}>()

const sides = computed<FaceoffSide[]>(() => [1, 2].map(index => {
  const team = props.armies.teams.find(entry => entry.index === index)
  let outcome = 'Level'
  if (props.isActive) outcome = 'In the field'
  else if (props.winner) outcome = props.winner === index ? 'Victory' : 'Defeat'
  return {
    figure: figureSpec(defaultKit(team?.figure ?? null)),
    side: team?.side ?? (index === 1 ? 'axis' : 'allied'),
    badge: team ? nationBadge(team.nation, team.nationLabel) : '',
    nationLabel: team?.nationLabel ?? '',
    title: team?.name ?? (index === 1 ? 'Axis' : 'Allied'),
    outcome,
  }
}))

const label = computed(() => `${sides.value[0].title} facing ${sides.value[1].title} on ${props.armies.displayName}`)
</script>

<template>
  <MmFaceoffBand
    data-testid="round-armies"
    :sides="sides"
    :winner="winner ? ((winner - 1) as 0 | 1) : null"
    :label="label"
    :footnote="modLabel(armies.mod)"
  />
</template>
