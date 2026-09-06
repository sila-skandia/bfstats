<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export type BfClassType =
  | 'assault'
  | 'medic'
  | 'engineer'
  | 'antitank'
  | 'at'
  | 'anti-tank'
  | 'scout'
  | 'sniper'

export type BfBadgeSize = 'sm' | 'md' | 'lg' | number
export type BfBadgeVariant = 'badge' | 'icon-only' | 'pill' | 'subtle'

const props = withDefaults(
  defineProps<{
    /** BF1942 soldier class */
    classType?: BfClassType | string | null
    /** Optional faction identifier (e.g. 'allies', 'axis', 'us', 'ger', 'jp', 'rus', 'brit', 'can') */
    faction?: string | null
    /** Size of the badge/icon: 'sm' (18px), 'md' (24px), 'lg' (32px) or custom pixel number */
    size?: BfBadgeSize
    /** Whether to display the text label next to the icon */
    showLabel?: boolean
    /** Visual display variant */
    variant?: BfBadgeVariant
    /** Whether to use the 16x16 debriefing icon instead of the 64x64 kit icon */
    useDebriefIcon?: boolean
  }>(),
  {
    classType: 'assault',
    faction: null,
    size: 'md',
    showLabel: false,
    variant: 'badge',
    useDebriefIcon: false,
  },
)

const imageFailed = ref(false)

// Canonical class keys: 'assault', 'medic', 'engineer', 'antitank', 'scout'
const normalizedClass = computed(() => {
  if (!props.classType) return 'assault'
  const c = props.classType.toLowerCase().trim()
  if (c === 'at' || c === 'anti-tank' || c === 'antitank') return 'antitank'
  if (c === 'sniper' || c === 'scout') return 'scout'
  if (c === 'med' || c === 'medic') return 'medic'
  if (c === 'eng' || c === 'engineer') return 'engineer'
  if (c === 'ass' || c === 'assault') return 'assault'
  return c
})

const classMeta = computed(() => {
  switch (normalizedClass.value) {
    case 'medic':
      return {
        label: 'Medic',
        accentColor: '#e05d52',
        bgTint: 'rgba(224, 93, 82, 0.15)',
        borderColor: '#7a2822',
      }
    case 'engineer':
      return {
        label: 'Engineer',
        accentColor: '#d49b38',
        bgTint: 'rgba(212, 155, 56, 0.15)',
        borderColor: '#73521b',
      }
    case 'antitank':
      return {
        label: 'Anti-Tank',
        accentColor: '#4fa0d6',
        bgTint: 'rgba(79, 160, 214, 0.15)',
        borderColor: '#245373',
      }
    case 'scout':
      return {
        label: 'Scout',
        accentColor: '#a17ecc',
        bgTint: 'rgba(161, 126, 204, 0.15)',
        borderColor: '#543b75',
      }
    case 'assault':
    default:
      return {
        label: 'Assault',
        accentColor: '#9aa666',
        bgTint: 'rgba(154, 166, 102, 0.15)',
        borderColor: '#4d5530',
      }
  }
})

// Reset failed status if class or faction changes
watch(
  () => [normalizedClass.value, props.faction, props.useDebriefIcon],
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
  const c = normalizedClass.value

  if (props.useDebriefIcon) {
    const debriefMap: Record<string, string> = {
      assault: 'class_assault_16x16.png',
      medic: 'class_medic_16x16.png',
      engineer: 'class_engineer_16x16.png',
      antitank: 'class_at_16x16.png',
      scout: 'class_scout_16x16.png',
    }
    return `/stats/assets/hud/classes/${debriefMap[c] || `${c}.png`}`
  }

  // Faction kit icon if provided
  if (props.faction) {
    const f = props.faction.toLowerCase().trim()
    const factionKit = `${c}_${f}.png`
    return `/stats/assets/hud/classes/${factionKit}`
  }

  // Canonical class icon
  return `/stats/assets/hud/classes/${c}.png`
})

function onImageError() {
  imageFailed.value = true
}
</script>

<template>
  <span
    class="bf-class-badge"
    :class="[
      `bf-class-badge--${variant}`,
      `bf-class-badge--${size}`,
      `bf-class-badge--${normalizedClass}`,
    ]"
    :style="{
      '--bf-class-accent': classMeta.accentColor,
      '--bf-class-bg': classMeta.bgTint,
      '--bf-class-border': classMeta.borderColor,
    }"
    :title="classMeta.label"
  >
    <span
      class="bf-class-icon-slot"
      :style="{ width: `${pixelSize}px`, height: `${pixelSize}px` }"
    >
      <!-- Authentic extracted HUD icon -->
      <img
        v-if="primarySrc"
        :src="primarySrc"
        :alt="classMeta.label"
        class="bf-class-img"
        :width="pixelSize"
        :height="pixelSize"
        loading="lazy"
        decoding="async"
        @error="onImageError"
      >

      <!-- Styled vector SVG fallback (No Emojis Policy) -->
      <svg
        v-else
        class="bf-class-fallback-svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <!-- Assault: Crossed rifles / military rifle -->
        <g v-if="normalizedClass === 'assault'">
          <path
            d="M4 18l3-1 7-7 2 1-6 6-1 3-5-2z"
            opacity="0.9"
          />
          <path d="M19.5 4.5l-3 3 1.5 1.5 3-3-1.5-1.5z" />
          <path d="M17 7.5L8 16.5l-2-.5 9-9 2 .5z" />
          <path
            d="M20 18l-3-1-7-7-2 1 6 6 1 3 5-2z"
            opacity="0.4"
          />
        </g>

        <!-- Medic: Medical Cross -->
        <g v-else-if="normalizedClass === 'medic'">
          <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" />
        </g>

        <!-- Engineer: Adjustable Wrench & Spanner -->
        <g v-else-if="normalizedClass === 'engineer'">
          <path d="M19.4 6.6c-.6-.6-1.5-.8-2.3-.6l-2.6 2.6 1.4 1.4 2.6-2.6c.2.8.1 1.7-.6 2.3l-7.7 7.7c-.8.8-2 .8-2.8 0l-.7-.7c-.8-.8-.8-2 0-2.8l7.7-7.7c.6-.6 1.5-.7 2.3-.6l2.7-2.6-2-2-4.1 1.7c-1.3-.4-2.8-.2-3.9.8-1.5 1.5-1.8 3.7-1 5.4L2.3 17.5c-1.2 1.2-1.2 3.1 0 4.2 1.2 1.2 3.1 1.2 4.2 0l8.4-8.4c1.7.8 3.9.5 5.4-1 1-1.1 1.2-2.6.8-3.9l1.7-4.1-3.4 2.3z" />
        </g>

        <!-- Anti-Tank: Rocket / Projectile -->
        <g v-else-if="normalizedClass === 'antitank'">
          <path d="M12 2l3 5v7l2 3-1 2-4-2-4 2-1-2 2-3V7l3-5z" />
          <path
            d="M10 9h4v4h-4V9z"
            opacity="0.6"
          />
        </g>

        <!-- Scout: Sniper Crosshair Reticle -->
        <g v-else-if="normalizedClass === 'scout'">
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <circle
            cx="12"
            cy="12"
            r="3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <line
            x1="12"
            y1="2"
            x2="12"
            y2="7"
            stroke="currentColor"
            stroke-width="2"
          />
          <line
            x1="12"
            y1="17"
            x2="12"
            y2="22"
            stroke="currentColor"
            stroke-width="2"
          />
          <line
            x1="2"
            y1="12"
            x2="7"
            y2="12"
            stroke="currentColor"
            stroke-width="2"
          />
          <line
            x1="17"
            y1="12"
            x2="22"
            y2="12"
            stroke="currentColor"
            stroke-width="2"
          />
        </g>
      </svg>
    </span>

    <!-- Optional Label -->
    <span
      v-if="showLabel"
      class="bf-class-label"
    >
      {{ classMeta.label }}
    </span>
  </span>
</template>

<style scoped>
.bf-class-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  line-height: 1;
  font-family: inherit;
  user-select: none;
}

/* Badge frame variant */
.bf-class-badge--badge {
  background: var(--bf-class-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--bf-class-border, rgba(255, 255, 255, 0.15));
  border-radius: 4px;
  padding: 3px 6px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 3px rgba(0, 0, 0, 0.5);
}

/* Pill variant */
.bf-class-badge--pill {
  background: var(--bf-class-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--bf-class-border, rgba(255, 255, 255, 0.15));
  border-radius: 9999px;
  padding: 2px 8px;
}

/* Subtle variant */
.bf-class-badge--subtle {
  background: transparent;
  border: 1px solid transparent;
  padding: 1px 2px;
}

/* Icon only variant */
.bf-class-badge--icon-only {
  background: transparent;
  border: none;
  padding: 0;
}

.bf-class-icon-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bf-class-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}

.bf-class-fallback-svg {
  width: 80%;
  height: 80%;
  color: var(--bf-class-accent, #9aa666);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
}

.bf-class-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #e0e0e0;
}

.bf-class-badge--sm .bf-class-label {
  font-size: 10px;
}

.bf-class-badge--lg .bf-class-label {
  font-size: 13px;
}
</style>
