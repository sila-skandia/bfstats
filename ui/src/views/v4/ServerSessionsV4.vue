<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import MmSessionsPage from '@/components/v4/MmSessionsPage.vue'

const route = useRoute()
const serverName = computed(() => decodeURIComponent(route.params.serverName as string))
</script>

<template>
  <MmSessionsPage :server-name="serverName" />
</template>
