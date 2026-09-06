<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Progress value from 0 to 100 */
    progress?: number
    /** Whether the loading state is indeterminate (sweeping animation across segments) */
    indeterminate?: boolean
    /** Retro status text (e.g. 'RECEIVING DATA...', 'VERIFYING ASSETS...') */
    statusText?: string
    /** Height of the progress track in px or CSS units */
    height?: number | string
    /** Whether to display percentage value */
    showPercentage?: boolean
  }>(),
  {
    progress: 0,
    indeterminate: false,
    statusText: '',
    height: 18,
    showPercentage: false,
  },
)

const clampedProgress = computed(() => {
  if (props.indeterminate) return 100
  const p = Number(props.progress)
  if (Number.isNaN(p)) return 0
  return Math.min(100, Math.max(0, Math.round(p)))
})

const trackHeight = computed(() => {
  if (typeof props.height === 'number') {
    return `${props.height}px`
  }
  return props.height
})
</script>

<template>
  <div
    class="bf-loading-bar-wrapper"
    role="progressbar"
    :aria-valuenow="indeterminate ? undefined : clampedProgress"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="statusText || 'Loading'"
  >
    <!-- Optional retro status header -->
    <div
      v-if="statusText || showPercentage"
      class="bf-loading-header"
    >
      <span
        v-if="statusText"
        class="bf-status-text"
      >{{ statusText }}</span>
      <span
        v-if="showPercentage && !indeterminate"
        class="bf-percentage-text"
      >
        {{ clampedProgress }}%
      </span>
    </div>

    <!-- Outer metallic chassis / frame -->
    <div class="bf-loading-chassis">
      <!-- Corner rivet accents -->
      <div
        class="bf-rivet bf-rivet--tl"
        aria-hidden="true"
      />
      <div
        class="bf-rivet bf-rivet--tr"
        aria-hidden="true"
      />
      <div
        class="bf-rivet bf-rivet--bl"
        aria-hidden="true"
      />
      <div
        class="bf-rivet bf-rivet--br"
        aria-hidden="true"
      />

      <!-- Recessed track -->
      <div
        class="bf-loading-track"
        :style="{ height: trackHeight }"
      >
        <!-- Segmented green tick fill -->
        <div
          v-if="!indeterminate"
          class="bf-loading-fill"
          :style="{ width: `${clampedProgress}%` }"
        >
          <div class="bf-segments-pattern" />
        </div>

        <!-- Indeterminate sweeping pulse across segments -->
        <div
          v-else
          class="bf-loading-indeterminate"
        >
          <div class="bf-segments-pattern bf-segments-pattern--full" />
          <div class="bf-sweep-beam" />
        </div>

        <!-- CRT scanline overlay -->
        <div
          class="bf-scanlines"
          aria-hidden="true"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.bf-loading-bar-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  user-select: none;
}

/* Retro monospace status text header */
.bf-loading-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'Geist Mono', 'Courier New', Courier, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9aa666;
  text-shadow: 0 0 6px rgba(154, 166, 102, 0.4);
  line-height: 1;
}

.bf-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bf-percentage-text {
  font-feature-settings: 'tnum' on;
  color: #b4c060;
  margin-left: auto;
}

/* Outer chassis: dark olive-steel bevelled plate */
.bf-loading-chassis {
  position: relative;
  background: linear-gradient(180deg, #2b3023 0%, #1a1e16 50%, #12150f 100%);
  border: 1px solid #3c4430;
  border-top-color: #4a543b;
  border-bottom-color: #1a1e15;
  border-radius: 2px;
  padding: 3px;
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

/* Rivets on chassis corners */
.bf-rivet {
  position: absolute;
  width: 2px;
  height: 2px;
  background: #606d4e;
  border-radius: 50%;
  box-shadow:
    0 1px 0 rgba(0, 0, 0, 0.8),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  pointer-events: none;
}
.bf-rivet--tl { top: 1px; left: 1px; }
.bf-rivet--tr { top: 1px; right: 1px; }
.bf-rivet--bl { bottom: 1px; left: 1px; }
.bf-rivet--br { bottom: 1px; right: 1px; }

/* Recessed track groove */
.bf-loading-track {
  position: relative;
  width: 100%;
  background: #0b0d09;
  border: 1px solid #14170f;
  border-top-color: #060805;
  border-bottom-color: #272d20;
  border-radius: 1px;
  overflow: hidden;
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.9);
}

/* Determinate progress fill container */
.bf-loading-fill {
  height: 100%;
  position: relative;
  overflow: hidden;
  transition: width 160ms cubic-bezier(0.4, 0, 0.2, 1);
  background-color: #1f2515;
}

/* Distinctive BF1942 segmented ticks: 4px olive tick + 2px dark separator */
.bf-segments-pattern {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    90deg,
    #9aa666 0px,
    #838e4a 3px,
    #58622c 4px,
    #0b0d09 4px,
    #0b0d09 6px
  );
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(0, 0, 0, 0.5);
}

.bf-segments-pattern--full {
  width: 100%;
  opacity: 0.25;
}

/* Indeterminate sweeping state */
.bf-loading-indeterminate {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.bf-sweep-beam {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 38%;
  background: repeating-linear-gradient(
    90deg,
    #b4c060 0px,
    #9aa666 3px,
    #6d7a36 4px,
    #0b0d09 4px,
    #0b0d09 6px
  );
  box-shadow:
    0 0 12px rgba(180, 192, 96, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  animation: bf-sweep-anim 1.4s ease-in-out infinite alternate;
}

@keyframes bf-sweep-anim {
  0% {
    left: -5%;
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
  100% {
    left: 67%;
    opacity: 0.85;
  }
}

/* Subtle CRT scanline effect */
.bf-scanlines {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.15) 0px,
    rgba(0, 0, 0, 0.15) 1px,
    transparent 1px,
    transparent 2px
  );
  pointer-events: none;
  opacity: 0.7;
}
</style>
