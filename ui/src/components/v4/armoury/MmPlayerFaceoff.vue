<script setup lang="ts">
// Two players face to face, each in the uniform of the army their record opens
// on (the same one their profile's service record shows), the higher K/D lit.
import { computed, ref, watch } from 'vue'
import MmFaceoffBand, { type FaceoffSide } from './MmFaceoffBand.vue'
import { defaultKit, figureSpec, nationBadge, openingArmy } from './meshAssets'
import { fetchServiceRecord, type ServiceRecord } from '@/services/serviceRecordApi'
import { decodePlayerName } from '@/utils/playerName'

const props = defineProps<{
  player1: string
  player2: string
  /** 1 or 2 for the player ahead, null when level. */
  leader: 1 | 2 | null
}>()

const records = ref<(ServiceRecord | null)[]>([null, null])

watch(() => [props.player1, props.player2], async ([first, second]) => {
  records.value = [null, null]
  const settled = await Promise.allSettled([fetchServiceRecord(first), fetchServiceRecord(second)])
  if (first !== props.player1 || second !== props.player2) return
  records.value = settled.map(result => (result.status === 'fulfilled' ? result.value : null))
}, { immediate: true })

const sides = computed<FaceoffSide[]>(() => [props.player1, props.player2].map((player, index) => {
  const army = openingArmy(records.value[index])
  return {
    figure: figureSpec(defaultKit(army?.figure ?? null)),
    side: army?.side ?? null,
    badge: army ? nationBadge(army.nation, army.nationLabel) : '',
    nationLabel: army?.nationLabel ?? '',
    title: decodePlayerName(player),
    subtitle: army ? `${army.name} · ${Math.round(army.minutes / 60).toLocaleString()} h` : undefined,
  }
}))

const label = computed(() => `${sides.value[0].title} and ${sides.value[1].title}, each in the uniform they served in most`)
</script>

<template>
  <MmFaceoffBand
    data-testid="player-faceoff"
    :sides="sides"
    :winner="leader ? ((leader - 1) as 0 | 1) : null"
    :label="label"
  />
</template>
