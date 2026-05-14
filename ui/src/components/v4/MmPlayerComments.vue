<script setup lang="ts">
import MmCommentsThread from './MmCommentsThread.vue'

defineProps<{ playerName: string }>()
</script>

<template>
  <MmCommentsThread kind="player" :id="playerName" />
</template>
