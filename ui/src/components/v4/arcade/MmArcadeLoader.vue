<script setup lang="ts">
/**
 * The arcade games' loading state: one of the game's loading scenes (BfGameLoader)
 * in the frame the question, matchup or dossier lands in.
 *
 * Each game loads only when a round starts (Higher/Lower's next matchup arrives with
 * the answer), so a scene never flashes up between questions. The loader carries its
 * own role="status" line, which screen readers announce.
 */
import { BfGameLoader } from '@/components/common'

defineProps<{
  /** The words under the scene. */
  label: string
}>()
</script>

<template>
  <div
    class="mm-arcade-loader"
    data-testid="arcade-loading"
  >
    <BfGameLoader :status-text="label" />
  </div>
</template>

<style scoped>
.mm-arcade-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 40px 16px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

@media (max-width: 768px) {
  .mm-arcade-loader {
    min-height: 260px;
    padding: 28px 12px;
  }
}
</style>
