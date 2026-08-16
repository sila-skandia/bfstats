<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import MmServerMapPopularity from '@/components/v4/MmServerMapPopularity.vue'

const route = useRoute()
const serverGuid = computed(() => route.params.serverGuid as string)
</script>

<template>
  <MmServerMapPopularity
    v-if="serverGuid"
    :server-guid="serverGuid"
    :standalone="true"
  />
</template>
