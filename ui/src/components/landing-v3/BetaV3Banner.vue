<template>
  <div
    v-if="!dismissed"
    class="v3-banner"
    role="status"
  >
    <div class="v3-banner__left">
      <span class="v3-banner__dot" aria-hidden="true" />
      <span class="v3-banner__text">
        <strong>Command Center (beta)</strong>
        <span class="v3-banner__sub">— live rounds, recent wins, network pulse</span>
      </span>
    </div>
    <div class="v3-banner__actions">
      <router-link
        :to="v3Path"
        class="v3-banner__try"
      >Try it →</router-link>
      <button
        type="button"
        class="v3-banner__dismiss"
        aria-label="Dismiss"
        @click="dismiss"
      >×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ game: 'bf1942' | 'fh2' | 'bfvietnam' }>()

const STORAGE_KEY = 'bfstats_v3_banner_dismissed'
const dismissed = ref<boolean>(readStorage())

function readStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const v3Path = computed(() => {
  const g = props.game === 'bfvietnam' ? 'bfv' : props.game
  return `/servers/${g}/v3`
})

const dismiss = (): void => {
  dismissed.value = true
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // ignore
  }
}
</script>

<style scoped>
.v3-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.85rem;
  margin: 0 0 0.75rem;
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.12), rgba(168, 85, 247, 0.12));
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 6px;
  color: var(--portal-text-bright, #f5f0eb);
  font-size: 0.82rem;
}
.v3-banner__left {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}
.v3-banner__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--portal-accent, #f59e0b);
  box-shadow: 0 0 8px var(--portal-accent-glow, rgba(245, 158, 11, 0.35));
  flex-shrink: 0;
}
.v3-banner__text {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  overflow: hidden;
}
.v3-banner__sub {
  color: var(--portal-text, #a8998c);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v3-banner__actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}
.v3-banner__try {
  color: var(--portal-accent, #f59e0b);
  text-decoration: none;
  font-weight: 600;
  padding: 0.25rem 0.55rem;
  border: 1px solid rgba(245, 158, 11, 0.45);
  border-radius: 4px;
  transition: background 0.15s ease;
  white-space: nowrap;
}
.v3-banner__try:hover {
  background: rgba(245, 158, 11, 0.18);
}
.v3-banner__dismiss {
  background: transparent;
  border: 0;
  color: var(--portal-text, #a8998c);
  font-size: 1rem;
  cursor: pointer;
  padding: 0.1rem 0.35rem;
  line-height: 1;
}
.v3-banner__dismiss:hover { color: var(--portal-danger, #ef4444); }

@media (max-width: 640px) {
  .v3-banner__sub { display: none; }
}
</style>
