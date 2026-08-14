<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useInViewport } from '@/composables/useInViewport'

// The thread pulls TipTap + DOMPurify into its own chunk. It sits below the
// fold on player details, so mounting it eagerly cost every visitor a 131KB
// (brotli) download and parse before they'd scrolled anywhere near it.
const MmCommentsThread = defineAsyncComponent(() => import('./MmCommentsThread.vue'))

defineProps<{ playerName: string }>()

const root = ref<HTMLElement | null>(null)
const visible = useInViewport(root)
</script>

<template>
  <div ref="root" class="mm-comments-slot">
    <MmCommentsThread v-if="visible" kind="player" :id="playerName" />
  </div>
</template>

<style scoped>
/* Reserve height so revealing the thread doesn't yank the scroll position. */
.mm-comments-slot {
  min-height: 220px;
}
</style>
