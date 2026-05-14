<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import MmSessionsPage from '@/components/v4/MmSessionsPage.vue'

const route = useRoute()
const rawName = computed(() => decodeURIComponent(route.params.playerName as string))
</script>

<template>
  <MmSessionsPage :player-name="rawName" />
</template>
