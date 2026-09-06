<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export type BfFactionType =
  | 'us'
  | 'usa'
  | 'ger'
  | 'germany'
  | 'axis'
  | 'allies'
  | 'jp'
  | 'japan'
  | 'rus'
  | 'russia'
  | 'soviet'
  | 'brit'
  | 'britain'
  | 'uk'
  | 'can'
  | 'canada'

export type BfBadgeSize = 'sm' | 'md' | 'lg' | number
export type BfFactionVariant = 'roundel' | 'badge' | 'icon-only' | 'pill'
export type BfFlagType = 'roundel' | 'flag' | 'auto'

const props = withDefaults(
  defineProps<{
    /** BF1942 faction name or code */
    faction?: BfFactionType | string | null
    /** Size of the badge: 'sm' (18px), 'md' (24px), 'lg' (32px) or custom pixel number */
    size?: BfBadgeSize
    /** Whether to display the text label next to the flag */
    showLabel?: boolean
    /** Visual display variant */
    variant?: BfFactionVariant
    /** Flag display style: 'roundel' (circular baseflag), 'flag' (rectangular), or 'auto' */
    flagType?: BfFlagType
  }>(),
  {
    faction: 'us',
    size: 'md',
    showLabel: false,
    variant: 'roundel',
    flagType: 'auto',
  },
)

const imageFailed = ref(false)

const normalizedFaction = computed<string>(() => {
  if (!props.faction) return 'us'
  const f = props.faction.toLowerCase().trim()
  if (f === 'usa' || f === 'allies' || f === 'allied' || f === 'american' || f === 'us') return 'us'
  if (f === 'germany' || f === 'german' || f === 'axis' || f === 'de' || f === 'ger') return 'ger'
  if (f === 'japan' || f === 'japanese' || f === 'ja' || f === 'jp') return 'jp'
  if (f === 'russia' || f === 'russian' || f === 'soviet' || f === 'ussr' || f === 'ru' || f === 'rus') return 'rus'
  if (f === 'britain' || f === 'british' || f === 'uk' || f === 'gb' || f === 'england' || f === 'brit') return 'brit'
  if (f === 'canada' || f === 'canadian' || f === 'ca' || f === 'can') return 'can'
  return f
})

const factionMeta = computed(() => {
  switch (normalizedFaction.value) {
    case 'ger':
      return {
        code: 'GER',
        label: 'Germany',
        accentColor: '#9c4444',
        bgTint: 'rgba(156, 68, 68, 0.15)',
        borderColor: '#542828',
      }
    case 'jp':
      return {
        code: 'JPN',
        label: 'Japan',
        accentColor: '#c23b3b',
        bgTint: 'rgba(194, 59, 59, 0.15)',
        borderColor: '#632020',
      }
    case 'rus':
      return {
        code: 'USSR',
        label: 'Soviet Union',
        accentColor: '#b83232',
        bgTint: 'rgba(184, 50, 50, 0.15)',
        borderColor: '#5c1b1b',
      }
    case 'brit':
      return {
        code: 'GBR',
        label: 'Great Britain',
        accentColor: '#456ca6',
        bgTint: 'rgba(69, 108, 166, 0.15)',
        borderColor: '#263e61',
      }
    case 'can':
      return {
        code: 'CAN',
        label: 'Canada',
        accentColor: '#b53535',
        bgTint: 'rgba(181, 53, 53, 0.15)',
        borderColor: '#5e1e1e',
      }
    case 'us':
    default:
      return {
        code: 'USA',
        label: 'United States',
        accentColor: '#4a7bb0',
        bgTint: 'rgba(74, 123, 176, 0.15)',
        borderColor: '#284666',
      }
  }
})

watch(
  () => [normalizedFaction.value, props.flagType],
  () => {
    imageFailed.value = false
  },
)

const pixelSize = computed(() => {
  if (typeof props.size === 'number') return props.size
  switch (props.size) {
    case 'sm':
      return 18
    case 'lg':
      return 32
    case 'md':
    default:
      return 24
  }
})

const primarySrc = computed(() => {
  if (imageFailed.value) return null
  const f = normalizedFaction.value
  if (props.flagType === 'flag') {
    return `/stats/assets/hud/flags/flag_${f}.png`
  }
  if (props.flagType === 'roundel') {
    return `/stats/assets/hud/flags/baseflag_conp_${f}.png`
  }
  // Auto defaults to canonical roundel flag
  return `/stats/assets/hud/flags/${f}.png`
})

function onImageError() {
  imageFailed.value = true
}
</script>

<template>
  <span
    class="bf-faction-badge"
    :class="[
      `bf-faction-badge--${variant}`,
      `bf-faction-badge--${size}`,
      `bf-faction-badge--${normalizedFaction}`,
    ]"
    :style="{
      '--bf-faction-accent': factionMeta.accentColor,
      '--bf-faction-bg': factionMeta.bgTint,
      '--bf-faction-border': factionMeta.borderColor,
    }"
    :title="factionMeta.label"
  >
    <span
      class="bf-faction-icon-slot"
      :style="{ width: `${pixelSize}px`, height: `${pixelSize}px` }"
    >
      <!-- Extracted HUD Flag Icon -->
      <img
        v-if="primarySrc"
        :src="primarySrc"
        :alt="factionMeta.label"
        class="bf-faction-img"
        :width="pixelSize"
        :height="pixelSize"
        loading="lazy"
        decoding="async"
        @error="onImageError"
      >

      <!-- Styled vector SVG military fallback (No Emojis Policy) -->
      <svg
        v-else
        class="bf-faction-fallback-svg"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <!-- US Army Star Roundel -->
        <g v-if="normalizedFaction === 'us'">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="#203a5e"
            stroke="#ffffff"
            stroke-width="1.5"
          />
          <polygon
            points="16,6 18.9,13.5 26.5,13.5 20.3,18 22.7,25.5 16,21 9.3,25.5 11.7,18 5.5,13.5 13.1,13.5"
            fill="#ffffff"
          />
        </g>

        <!-- German Balkenkreuz -->
        <g v-else-if="normalizedFaction === 'ger'">
          <rect
            x="2"
            y="2"
            width="28"
            height="28"
            rx="2"
            fill="#292929"
            stroke="#505050"
            stroke-width="1.5"
          />
          <path
            d="M13 5h6v7h7v6h-7v7h-6v-7H6v-6h7V5z"
            fill="#111111"
            stroke="#ffffff"
            stroke-width="1.5"
          />
        </g>

        <!-- Imperial Japanese Rising Sun / Red Disc -->
        <g v-else-if="normalizedFaction === 'jp'">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="#f5f5f0"
            stroke="#d4d4cb"
            stroke-width="1.5"
          />
          <circle
            cx="16"
            cy="16"
            r="8"
            fill="#bc002d"
          />
        </g>

        <!-- Soviet Red Star -->
        <g v-else-if="normalizedFaction === 'rus'">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="#801818"
            stroke="#d4a337"
            stroke-width="1.5"
          />
          <polygon
            points="16,6 19,13.8 26.8,13.8 20.5,18.5 23,26 16,21.5 9,26 11.5,18.5 5.2,13.8 13,13.8"
            fill="#d4a337"
          />
        </g>

        <!-- RAF / British Roundel -->
        <g v-else-if="normalizedFaction === 'brit'">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="#1b3f73"
            stroke="#ffffff"
            stroke-width="1"
          />
          <circle
            cx="16"
            cy="16"
            r="9.5"
            fill="#f5f5f5"
          />
          <circle
            cx="16"
            cy="16"
            r="5"
            fill="#c41e3a"
          />
        </g>

        <!-- Canadian Maple Leaf Roundel -->
        <g v-else-if="normalizedFaction === 'can'">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="#1b3f73"
            stroke="#ffffff"
            stroke-width="1"
          />
          <circle
            cx="16"
            cy="16"
            r="10"
            fill="#f5f5f5"
          />
          <path
            d="M16 8l1.5 3 2.5-.5-1 2.5 3 1-2.5 2 1 3-3-1-1 3-1-3-3 1 1-3-2.5-2 3-1-1-2.5 2.5.5z"
            fill="#c41e3a"
          />
        </g>
      </svg>
    </span>

    <!-- Optional Label -->
    <span
      v-if="showLabel"
      class="bf-faction-label"
    >
      {{ factionMeta.label }}
    </span>
  </span>
</template>

<style scoped>
.bf-faction-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  line-height: 1;
  font-family: inherit;
  user-select: none;
}

/* Roundel variant */
.bf-faction-badge--roundel {
  background: transparent;
  border: none;
  padding: 1px;
}

/* Badge variant */
.bf-faction-badge--badge {
  background: var(--bf-faction-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--bf-faction-border, rgba(255, 255, 255, 0.15));
  border-radius: 4px;
  padding: 3px 6px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 3px rgba(0, 0, 0, 0.5);
}

/* Pill variant */
.bf-faction-badge--pill {
  background: var(--bf-faction-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--bf-faction-border, rgba(255, 255, 255, 0.15));
  border-radius: 9999px;
  padding: 2px 8px;
}

/* Icon only variant */
.bf-faction-badge--icon-only {
  background: transparent;
  border: none;
  padding: 0;
}

.bf-faction-icon-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bf-faction-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.bf-faction-fallback-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}

.bf-faction-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #e0e0e0;
}

.bf-faction-badge--sm .bf-faction-label {
  font-size: 10px;
}

.bf-faction-badge--lg .bf-faction-label {
  font-size: 13px;
}
</style>
