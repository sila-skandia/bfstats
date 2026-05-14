<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import MmRoundReportV2 from '@/components/v4/MmRoundReportV2.vue'

const route = useRoute()
const roundId = computed(() => route.params.roundId as string)
const players = computed(() => (route.query.players as string) || '')
</script>

<template>
  <MmRoundReportV2 :round-id="roundId" :players="players" />
</template>
