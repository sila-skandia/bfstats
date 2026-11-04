<script setup lang="ts">
// A loading scene drawn from the game's own models, in place of a loading bar:
// one of the viewer's loaders (a synced copy in ./game-loaders, see
// scripts/sync-ui-loaders.sh), picked at random each time it shows. A nicety:
// if a scene fails to start, the plain loading bar shows instead.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import BfLoadingBar from './BfLoadingBar.vue'
import { createGameLoader, type GameLoader } from './game-loaders'

const props = withDefaults(
  defineProps<{
    /** The words under the scene (shown in caps, with dots). */
    statusText?: string
    /** A scene id to play instead of a random one (brass, duel, hulldown, rush, ambush). */
    scene?: string
  }>(),
  { statusText: 'Loading', scene: undefined },
)

const host = ref<HTMLElement | null>(null)
const failed = ref(false)
let loader: GameLoader | null = null

onMounted(() => {
  try {
    if (!host.value) return
    loader = createGameLoader(props.statusText, props.scene)
    host.value.append(loader.element)
    loader.start(props.scene)
  } catch (error) {
    console.warn('BfGameLoader:', error)
    failed.value = true
  }
})

onBeforeUnmount(() => {
  try {
    loader?.stop()
    loader?.element.remove()
  } catch (error) {
    console.warn('BfGameLoader:', error)
  }
  loader = null
})
</script>

<template>
  <div class="bf-game-loader">
    <BfLoadingBar
      v-if="failed"
      indeterminate
      :status-text="statusText"
    />
    <div
      v-else
      ref="host"
      class="bf-game-loader__host"
      data-testid="game-loader"
    />
  </div>
</template>

<style scoped>
.bf-game-loader {
  width: 100%;
  display: flex;
  justify-content: center;
}

.bf-game-loader__host {
  width: 100%;
}

.bf-game-loader__host :deep(.sl-words) {
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  text-shadow: none;
}

.bf-game-loader__host :deep(.sl-sub) {
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-display);
  text-shadow: none;
  text-align: center;
}
</style>
