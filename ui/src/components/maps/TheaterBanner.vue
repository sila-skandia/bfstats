<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getMapTheater, getTheaterByKey, type MapTheaterInfo } from '@/composables/useMapTheater'

interface Props {
  /** Map name, slug, or bflist identifier (e.g. "Wake Island", "wake", "El Alamein") */
  mapName?: string | null
  /** Mod identifier (e.g. "bf1942", "dc_final", "desertcombat") */
  gameId?: string | null
  /** Direct theater key override (e.g. "pacific", "eastern", "desert") */
  theaterKey?: string | null
  /** Explicit banner height in px or CSS string (e.g. 200, "240px", "auto") */
  height?: number | string
  /** Minimum banner height */
  minHeight?: number | string
  /** Gradient overlay intensity and flavor */
  overlay?: 'dramatic' | 'subtle' | 'card' | 'none'
  /** Show theater title badge */
  showBadge?: boolean
  /** Show map display name header */
  showTitle?: boolean
  /** Hairline border around the banner */
  framed?: boolean
  /** Rounded corners */
  rounded?: boolean
  /** Aspect ratio constraint (e.g. "16/9", "4/3", "21/9", "auto") */
  aspectRatio?: string
}

const props = withDefaults(defineProps<Props>(), {
  mapName: null,
  gameId: null,
  theaterKey: null,
  height: 'auto',
  minHeight: '160px',
  overlay: 'dramatic',
  showBadge: true,
  showTitle: false,
  framed: true,
  rounded: true,
  aspectRatio: 'auto',
})

const imageFailed = ref(false)
const imageLoaded = ref(false)

// Resolve theater information
const theater = computed<MapTheaterInfo | null>(() => {
  if (props.theaterKey) {
    const t = getTheaterByKey(props.theaterKey)
    if (t) {
      return {
        slug: props.mapName ? props.mapName.toLowerCase() : t.key,
        mapName: props.mapName || t.title,
        theaterKey: t.key,
        theaterCategory: t.category,
        theaterTitle: t.title,
        image: t.image,
        imageUrl: t.imageUrl,
        pngUrl: t.pngUrl,
        isDesertCombat: props.gameId?.toLowerCase().startsWith('dc') || false,
        backgroundStyle: {
          backgroundImage: `url(${t.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        },
      }
    }
  }
  return getMapTheater(props.mapName, props.gameId)
})

// Reset error state on map / theater changes
watch(
  () => [props.mapName, props.gameId, props.theaterKey],
  () => {
    imageFailed.value = false
    imageLoaded.value = false
  },
)

function onImageError() {
  imageFailed.value = true
}

function onImageLoad() {
  imageLoaded.value = true
}

const containerStyle = computed(() => {
  const style: Record<string, string> = {}

  if (typeof props.height === 'number') {
    style.height = `${props.height}px`
  } else if (props.height && props.height !== 'auto') {
    style.height = props.height
  }

  if (typeof props.minHeight === 'number') {
    style.minHeight = `${props.minHeight}px`
  } else if (props.minHeight) {
    style.minHeight = props.minHeight
  }

  if (props.aspectRatio && props.aspectRatio !== 'auto') {
    style.aspectRatio = props.aspectRatio
  }

  return style
})

const artworkBackground = computed(() => {
  if (imageFailed.value || !theater.value?.imageUrl) {
    return 'none'
  }
  return `url("${theater.value.imageUrl}")`
})
</script>

<template>
  <div
    class="mm-theater-banner"
    :class="[
      `mm-theater-banner--overlay-${overlay}`,
      {
        'mm-theater-banner--framed': framed,
        'mm-theater-banner--rounded': rounded,
        'mm-theater-banner--loaded': imageLoaded,
        'mm-theater-banner--fallback': imageFailed || !theater,
      },
    ]"
    :style="containerStyle"
  >
    <!-- Hidden probe img to handle graceful load / error transitions -->
    <img
      v-if="theater?.imageUrl && !imageFailed"
      :src="theater.imageUrl"
      alt=""
      aria-hidden="true"
      class="mm-theater-banner__probe"
      @error="onImageError"
      @load="onImageLoad"
    />

    <!-- Painted artwork background layer -->
    <div
      class="mm-theater-banner__artwork"
      :style="{ backgroundImage: artworkBackground }"
      aria-hidden="true"
    />

    <!-- Atmospheric lighting & vignette overlays -->
    <div class="mm-theater-banner__vignette-lateral" aria-hidden="true" />
    <div class="mm-theater-banner__vignette-vertical" aria-hidden="true" />
    <div class="mm-theater-banner__tint" aria-hidden="true" />

    <!-- Foreground content container -->
    <div class="mm-theater-banner__content">
      <!-- Header row: Theater badge + actions -->
      <div v-if="showBadge || $slots.badge || $slots.actions" class="mm-theater-banner__top">
        <slot name="badge">
          <div v-if="showBadge && theater" class="mm-theater-banner__badge">
            <span class="mm-theater-banner__badge-pip" aria-hidden="true" />
            <span class="mm-theater-banner__badge-category">{{ theater.theaterCategory }}</span>
            <span class="mm-theater-banner__badge-divider" aria-hidden="true">/</span>
            <span class="mm-theater-banner__badge-title">{{ theater.theaterTitle }}</span>
          </div>
        </slot>

        <div v-if="$slots.actions" class="mm-theater-banner__actions">
          <slot name="actions" />
        </div>
      </div>

      <!-- Main body content slot (e.g. server title, live player counter, round stats) -->
      <div class="mm-theater-banner__body">
        <slot name="title">
          <div v-if="showTitle && theater" class="mm-theater-banner__headline">
            <h2 class="mm-theater-banner__title">{{ theater.mapName }}</h2>
            <div class="mm-theater-banner__subhead">{{ theater.theaterTitle }}</div>
          </div>
        </slot>

        <slot :theater="theater" />
      </div>

      <!-- Optional footer slot -->
      <div v-if="$slots.footer" class="mm-theater-banner__footer">
        <slot name="footer" :theater="theater" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-theater-banner {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--mm-bg-soft, #1a1a1a);
  color: var(--mm-ink, #ffffff);
  box-sizing: border-box;
}

.mm-theater-banner--framed {
  border: 1px solid var(--mm-rule, #2d2d2d);
}

.mm-theater-banner--rounded {
  border-radius: 4px;
}

/* Hidden probe img */
.mm-theater-banner__probe {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* Artwork background layer */
.mm-theater-banner__artwork {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  transform: scale(1.01);
  opacity: 0.85;
}

.mm-theater-banner--loaded .mm-theater-banner__artwork {
  opacity: 0.95;
}

.mm-theater-banner--fallback .mm-theater-banner__artwork {
  background-image: radial-gradient(circle at 50% 20%, #2a2a22 0%, #171714 60%, #111110 100%) !important;
  opacity: 1;
}

/* Vignette overlays */
.mm-theater-banner__vignette-lateral {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    rgba(19, 19, 19, 0.75) 0%,
    rgba(19, 19, 19, 0.25) 20%,
    rgba(19, 19, 19, 0) 50%,
    rgba(19, 19, 19, 0.25) 80%,
    rgba(19, 19, 19, 0.75) 100%
  );
}

.mm-theater-banner__vignette-vertical {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(19, 19, 19, 0.65) 0%,
    rgba(19, 19, 19, 0.15) 30%,
    rgba(19, 19, 19, 0.45) 70%,
    rgba(19, 19, 19, 0.95) 100%
  );
}

.mm-theater-banner__tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: rgba(19, 19, 19, 0.2);
}

/* Overlay flavors */
.mm-theater-banner--overlay-dramatic .mm-theater-banner__vignette-vertical {
  background: linear-gradient(
    180deg,
    rgba(19, 19, 19, 0.75) 0%,
    rgba(19, 19, 19, 0.2) 25%,
    rgba(19, 19, 19, 0.55) 60%,
    rgba(19, 19, 19, 0.98) 100%
  );
}

.mm-theater-banner--overlay-subtle .mm-theater-banner__vignette-vertical {
  background: linear-gradient(
    180deg,
    rgba(19, 19, 19, 0.4) 0%,
    rgba(19, 19, 19, 0.1) 40%,
    rgba(19, 19, 19, 0.7) 100%
  );
}

.mm-theater-banner--overlay-card .mm-theater-banner__vignette-vertical {
  background: linear-gradient(
    180deg,
    rgba(19, 19, 19, 0.85) 0%,
    rgba(19, 19, 19, 0.65) 40%,
    rgba(19, 19, 19, 0.92) 100%
  );
}

.mm-theater-banner--overlay-none .mm-theater-banner__vignette-lateral,
.mm-theater-banner--overlay-none .mm-theater-banner__vignette-vertical,
.mm-theater-banner--overlay-none .mm-theater-banner__tint {
  display: none;
}

/* Foreground Content */
.mm-theater-banner__content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  padding: 16px 20px;
  box-sizing: border-box;
}

/* Top bar: Badge & actions */
.mm-theater-banner__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.mm-theater-banner__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 2px;
  background: rgba(19, 19, 19, 0.85);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(125, 136, 73, 0.35);
  font-family: var(--mm-font-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink, #ffffff);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}

.mm-theater-banner__badge-pip {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background-color: var(--mm-accent, #7d8849);
  box-shadow: 0 0 6px var(--mm-accent, #7d8849);
}

.mm-theater-banner__badge-category {
  color: var(--mm-accent, #7d8849);
  font-weight: 600;
}

.mm-theater-banner__badge-divider {
  color: var(--mm-ink-faint, #555555);
}

.mm-theater-banner__badge-title {
  color: var(--mm-ink-soft, #c8c8c8);
}

.mm-theater-banner__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Body */
.mm-theater-banner__body {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  flex: 1 1 auto;
}

.mm-theater-banner__headline {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-theater-banner__title {
  margin: 0;
  font-family: var(--mm-font-display, sans-serif);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--mm-ink, #ffffff);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
}

.mm-theater-banner__subhead {
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-accent-soft, #9aa666);
}

/* Footer */
.mm-theater-banner__footer {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

@media (max-width: 640px) {
  .mm-theater-banner__content {
    padding: 12px 14px;
  }

  .mm-theater-banner__title {
    font-size: 17px;
  }
}
</style>
