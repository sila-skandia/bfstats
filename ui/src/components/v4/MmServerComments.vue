<script setup lang="ts">
import MmCommentsThread from './MmCommentsThread.vue'

defineProps<{ serverName: string }>()
</script>

<template>
  <MmCommentsThread kind="server" :id="serverName" />
</template>
