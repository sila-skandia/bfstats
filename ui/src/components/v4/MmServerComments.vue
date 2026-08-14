<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useInViewport } from '@/composables/useInViewport'

// See MmPlayerComments — same reasoning, the thread's TipTap chunk is deferred
// until the section approaches the viewport.
const MmCommentsThread = defineAsyncComponent(() => import('./MmCommentsThread.vue'))

defineProps<{ serverName: string }>()

const root = ref<HTMLElement | null>(null)
const visible = useInViewport(root)
</script>

<template>
  <div ref="root" class="mm-comments-slot">
    <MmCommentsThread v-if="visible" kind="server" :id="serverName" />
  </div>
</template>

<style scoped>
/* Reserve height so revealing the thread doesn't yank the scroll position. */
.mm-comments-slot {
  min-height: 220px;
}
</style>
