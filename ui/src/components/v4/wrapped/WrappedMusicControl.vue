<template>
  <button
    type="button"
    class="mute-btn"
    :class="{ 'mute-btn--muted': !enabled }"
    :title="enabled ? `Change wrapped song — ${selectedTrack.mod} · ${selectedTrack.label}` : 'Change wrapped song'"
    aria-label="Change wrapped song"
    @click="openDialog('change')"
  >
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path :d="enabled ? 'M15.5 8.5a5 5 0 0 1 0 7' : 'M16 9L22 15M22 9L16 15'" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { useWrappedMusic } from '@/composables/useWrappedMusic'

const { selectedTrack, enabled, openDialog } = useWrappedMusic()
</script>

<style scoped>
.mute-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  cursor: pointer;
  color: var(--mm-accent);
  transition: color 0.12s ease, border-color 0.12s ease;
}

.mute-btn:hover {
  border-color: var(--mm-rule-strong);
}

.mute-btn--muted {
  color: var(--mm-ink-faint);
}
</style>
