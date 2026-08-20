<template>
  <img
    class="mm-stat-col-icon"
    :src="src"
    :alt="label"
    :title="label"
    :width="nativeWidth"
    :height="nativeHeight"
    decoding="async"
    draggable="false"
  />
</template>

<script setup lang="ts">
import kills from '@/assets/leaderboard/kills.webp'
import deaths from '@/assets/leaderboard/deaths.webp'
import score from '@/assets/leaderboard/score.webp'
import ping from '@/assets/leaderboard/ping.webp'
import position from '@/assets/leaderboard/position.webp'

const ICONS = {
  kills: { src: kills, w: 38, h: 26 },
  deaths: { src: deaths, w: 34, h: 27 },
  score: { src: score, w: 23, h: 25 },
  ping: { src: ping, w: 34, h: 20 },
  position: { src: position, w: 32, h: 22 },
} as const

export type StatColIconName = keyof typeof ICONS

const props = defineProps<{
  name: StatColIconName
  label: string
}>()

const src = ICONS[props.name].src
const nativeWidth = ICONS[props.name].w
const nativeHeight = ICONS[props.name].h
</script>

<style scoped>
.mm-stat-col-icon {
  display: inline-block;
  height: 20px;
  width: auto;
  object-fit: contain;
  image-rendering: pixelated;
  vertical-align: middle;
  flex-shrink: 0;
  pointer-events: none;
}
</style>
