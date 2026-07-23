<template>
  <div ref="rootEl" class="server-wrapped">
    <div class="wrapped-grain" aria-hidden="true"></div>
    <div v-if="loading" class="wrapped-loading">
      <div class="spinner"></div>
      <p>Retrieving Wrapped 2026 aggregates...</p>
    </div>

    <div v-else-if="error" class="wrapped-error">
      <span class="error-icon">⚠</span>
      <h3>Failed to Load Wrapped Data</h3>
      <p>{{ error }}</p>
      <router-link :to="`/v4/servers/detail/${encodeURIComponent(serverName)}`" class="back-btn">
        Back to Server Details
      </router-link>
    </div>

    <div v-else-if="data" class="wrapped-layout">
      <!-- Desktop Widescreen Sidebar Layout -->
      <div class="desktop-layout">
        <aside class="wrapped-sidebar">
          <div class="sidebar-header">
            <span class="logo-text">BFStats</span>
            <span class="badge-wrapped">WRAPPED '26</span>
          </div>
          <div class="server-info">
            <h4>{{ data.serverName }}</h4>
            <p>Year in Review</p>
          </div>
          <nav class="sidebar-nav">
            <button
              v-for="(label, idx) in chapters"
              :key="idx"
              class="nav-item"
              :class="{ active: currentSlide === idx }"
              @click="goToSlide(idx)"
            >
              <span class="nav-num">{{ String(idx + 1).padStart(2, '0') }}</span>
              <span class="nav-label">{{ label }}</span>
              <span class="nav-indicator" :style="{ backgroundColor: currentSlide === idx ? activeThemeColor : 'transparent' }"></span>
            </button>
          </nav>
          <div class="sidebar-footer">
            <router-link :to="`/v4/servers/detail/${encodeURIComponent(serverName)}`" class="exit-btn">
              Exit Wrapped
            </router-link>
          </div>
        </aside>

        <main class="wrapped-stage" :style="{ '--theme-color': activeThemeColor }">
          <div class="stage-container">
            <!-- Stage Header -->
            <div class="stage-header">
              <div class="desktop-progress-bars">
                <div
                  v-for="idx in chapters.length"
                  :key="idx"
                  class="progress-segment-bg"
                  @click="goToSlide(idx - 1)"
                >
                  <div
                    class="progress-segment-fill"
                    :style="{
                      width: idx - 1 < currentSlide ? '100%' : idx - 1 === currentSlide ? `${mobileProgress}%` : '0%',
                      transition: idx - 1 === currentSlide ? 'width 100ms linear' : 'none'
                    }"
                  ></div>
                </div>
              </div>

              <div class="stage-toolbar">
                <span class="stage-chapter-info">
                  CHAPTER {{ String(currentSlide + 1).padStart(2, '0') }} / {{ String(chapters.length).padStart(2, '0') }}
                </span>
                <div class="stage-controls">
                  <button class="stage-control-btn stage-song-btn" title="Change wrapped song" @click="music.openDialog('change')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    {{ nowPlayingShort }}
                  </button>
                  <span class="control-divider">·</span>
                  <button
                    class="stage-control-btn stage-mute-btn"
                    :class="{ 'stage-mute-btn--muted': !music.enabled.value }"
                    :title="music.enabled.value ? 'Mute the wrapped song' : 'Unmute the wrapped song'"
                    :aria-pressed="!music.enabled.value"
                    @click="music.setEnabled(!music.enabled.value)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M11 5 6 9H3v6h3l5 4z" />
                      <path :d="music.enabled.value ? 'M15.5 8.5a5 5 0 0 1 0 7' : 'M16 9L22 15M22 9L16 15'" />
                    </svg>
                    {{ music.enabled.value ? 'Sound' : 'Muted' }}
                  </button>
                  <span class="control-divider">·</span>
                  <button class="stage-control-btn" :disabled="currentSlide === 0" @click="prevSlide(true)">
                    ← Prev
                  </button>
                  <span class="control-divider">/</span>
                  <button class="stage-control-btn" :disabled="currentSlide === chapters.length - 1" @click="nextSlide(true)">
                    Next →
                  </button>
                </div>
              </div>
            </div>

            <!-- Stage Card -->
            <div class="slide-card">
              <div class="wrapped-fx" aria-hidden="true">
                <div class="fx-smoke" :style="fxSmokeBg"></div>
                <div class="fx-embers-far" :style="fxEmbersBg"></div>
                <div class="fx-embers-near" :style="fxEmbersBg"></div>
              </div>
              <div class="slide-card-layout">
                <!-- Desktop Hero Image Card Column -->
                <div v-if="activeHero" class="hero-card-col">
                  <div class="hero-image-card">
                    <div class="hero-placeholder">
                      <div class="hero-title">HERO {{ activeHero.no }}</div>
                      <div class="hero-sub">{{ activeHero.drop }}</div>
                    </div>
                    <div class="hero-img-wrapper">
                      <img :src="activeHero.img" :alt="activeHero.drop" class="hero-img" :key="currentSlide" />
                    </div>
                    <div class="hero-overlay-smoke"></div>
                    <div class="hero-overlay-grad"></div>
                    <div class="hero-border-inset"></div>
                    <div class="hero-corner hero-corner-tl"></div>
                    <div class="hero-corner hero-corner-tr"></div>
                    <div class="hero-corner hero-corner-bl"></div>
                    <div class="hero-corner hero-corner-br"></div>
                    <div class="hero-caption">
                      <span class="hero-caption-dot" :style="{ backgroundColor: activeHero.dot }"></span>
                      {{ activeHero.fig }}
                    </div>
                  </div>
                </div>

                <!-- Slide Content Column -->
                <div class="slide-container">
                  <transition name="slide-fade" mode="out-in">
                    <div class="slide-content-wrapper" :key="currentSlide">
                      <component
                        :is="activeSlideComponent"
                        :data="data"
                        :chapter-number="'08'"
                        @next="nextSlide(false)"
                        @prev="prevSlide(false)"
                        @pause="stopPlayback"
                        @restart="goToSlide(0)"
                      />
                    </div>
                  </transition>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <!-- Mobile Portrait Stories Layout -->
      <div class="mobile-layout" :style="{ '--theme-color': activeThemeColor }">
        <div class="wrapped-fx wrapped-fx--mobile" aria-hidden="true">
          <div class="fx-smoke" :style="fxSmokeBg"></div>
          <div class="fx-embers-far" :style="fxEmbersBg"></div>
          <div class="fx-embers-near" :style="fxEmbersBg"></div>
        </div>

        <!-- Top Sticky Header -->
        <div class="mobile-sticky-header">
          <!-- Top Progress Bars -->
          <div class="mobile-progress-bars">
            <div
              v-for="idx in chapters.length"
              :key="idx"
              class="progress-segment-bg"
              @click="goToSlide(idx - 1)"
            >
              <div
                class="progress-segment-fill"
                :style="{
                  width: idx - 1 < currentSlide ? '100%' : idx - 1 === currentSlide ? `${mobileProgress}%` : '0%',
                  transition: idx - 1 === currentSlide && isHolding ? 'none' : 'width 100ms linear'
                }"
              ></div>
            </div>
          </div>

          <!-- Mobile Header -->
          <header class="mobile-header">
            <div class="header-left">
              <span class="logo-small">BFStats</span>
              <span class="badge-small">'26</span>
            </div>
            <div class="header-right">
              <router-link :to="`/v4/servers/detail/${encodeURIComponent(serverName)}`" class="close-mobile">
                ✕
              </router-link>
            </div>
          </header>
        </div>

        <!-- Scrollable slide area (hero + content) -->
        <main
          ref="mobileScrollEl"
          class="swm-scroll"
          @click="onStoryNavTap"
          @touchstart.passive="startHold"
          @touchend.passive="endHold"
          @touchcancel.passive="endHold"
        >
          <!-- Mobile Hero Image Card -->
          <div v-if="activeHero" class="mobile-hero-container animate-fade-in">
            <div class="hero-image-card">
              <div class="hero-placeholder">
                <div class="hero-title">HERO {{ activeHero.no }}</div>
                <div class="hero-sub">{{ activeHero.drop }}</div>
              </div>
              <div class="hero-img-wrapper">
                <img :src="activeHero.img" :alt="activeHero.drop" class="hero-img" :key="currentSlide" />
              </div>
              <div class="hero-overlay-smoke"></div>
              <div class="hero-overlay-grad"></div>
              <div class="hero-border-inset"></div>
              <div class="hero-corner hero-corner-tl"></div>
              <div class="hero-corner hero-corner-tr"></div>
              <div class="hero-corner hero-corner-bl"></div>
              <div class="hero-corner hero-corner-br"></div>
              <div class="hero-caption">
                <span class="hero-caption-dot" :style="{ backgroundColor: activeHero.dot }"></span>
                {{ activeHero.fig }}
              </div>
            </div>
          </div>

          <!-- Mobile Content Container -->
          <div class="mobile-content-container">
            <transition name="slide-fade" mode="out-in">
              <component
                :is="activeSlideComponent"
                :key="currentSlide"
                :data="data"
                :chapter-number="'08'"
                @next="nextSlide(true)"
                @prev="prevSlide(true)"
                @pause="stopPlayback"
                @restart="goToSlide(0)"
              />
            </transition>
          </div>
        </main>

        <!-- Bottom Navigation Bar -->
        <div class="mobile-bottom-nav">
          <button @click="prevSlide(true)" class="nav-btn prev-btn" :disabled="currentSlide === 0" :style="{ color: currentSlide === 0 ? 'var(--mm-ink-faint)' : 'var(--mm-ink-soft)' }">← Prev</button>

          <span class="nav-center">
            <button @click="togglePlayback" class="toggle-play-btn" title="Play / pause">
              <svg width="52" height="52" viewBox="0 0 52 52" style="display:block;">
                <circle cx="26" cy="26" r="22" fill="none" stroke="var(--mm-rule-strong)" stroke-width="2.5"></circle>
                <circle cx="26" cy="26" r="22" fill="none" :stroke="activeThemeColor" stroke-width="3" stroke-linecap="round" :stroke-dasharray="ringCirc" :stroke-dashoffset="ringOffset" transform="rotate(-90 26 26)" style="transition:stroke-dashoffset .12s linear, stroke .4s ease;"></circle>
              </svg>
              <span class="toggle-icon-wrapper">
                <svg v-if="!isPaused" width="13" height="14" viewBox="0 0 13 14" :fill="activeThemeColor"><rect x="1" y="0" width="3.6" height="14" rx="0.6"></rect><rect x="8.4" y="0" width="3.6" height="14" rx="0.6"></rect></svg>
                <svg v-else width="13" height="15" viewBox="0 0 13 15" :fill="activeThemeColor"><path d="M1.5 0.9 L12 7.5 L1.5 14.1 Z"></path></svg>
              </span>
            </button>
            <WrappedMusicControl />
          </span>

          <button @click="currentSlide === chapters.length - 1 ? goToSlide(0) : nextSlide(true)" class="nav-btn next-btn">{{ currentSlide === chapters.length - 1 ? 'Replay' : 'Next' }} →</button>
        </div>
      </div>

      <WrappedSongDialog
        v-if="dialogMode"
        :mode="dialogMode"
        @close="onSongDialogClose"
        @begin="onSongDialogBegin"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchServerDetails } from '@/services/serverDetailsService'
import { fetchServerWrapped, type ServerWrappedData } from '@/services/wrappedService'
import clippyLogo from '@/assets/clippy_my_boi.webp'
import { getAchievementImage } from '@/utils/achievementImageUtils'

// Chapter WebP Images
import ch1 from '@/assets/wrapped/ch1.webp'
import ch2 from '@/assets/wrapped/ch2.webp'
import ch3 from '@/assets/wrapped/ch3.webp'
import ch4 from '@/assets/wrapped/ch4.webp'
import ch5 from '@/assets/wrapped/ch5.webp'
import ch6 from '@/assets/wrapped/ch6.webp'
import ch7 from '@/assets/wrapped/ch7.webp'
import ch8 from '@/assets/wrapped/ch8.webp'

// Animated FX tiles (smoke drift + rising embers)
import fxSmoke from '@/assets/wrapped/fx-smoke.webp'
import fxEmbers from '@/assets/wrapped/fx-embers.webp'

import IntroSlide from '@/components/v4/wrapped/IntroSlide.vue'
import NumbersSlide from '@/components/v4/wrapped/NumbersSlide.vue'
import RotationSlide from '@/components/v4/wrapped/RotationSlide.vue'
import HonoursSlide from '@/components/v4/wrapped/HonoursSlide.vue'
import DecorationsSlide from '@/components/v4/wrapped/DecorationsSlide.vue'
import DishonoursSlide from '@/components/v4/wrapped/DishonoursSlide.vue'
import ClosestSlide from '@/components/v4/wrapped/ClosestSlide.vue'
import ShareSlide from '@/components/v4/wrapped/ShareSlide.vue'
import WrappedMusicControl from '@/components/v4/wrapped/WrappedMusicControl.vue'
import WrappedSongDialog from '@/components/v4/wrapped/WrappedSongDialog.vue'
import { useWrappedMusic } from '@/composables/useWrappedMusic'

// Programmatic Image Preloader helper
function preloadImages(urls: string[]) {
  urls.forEach(url => {
    if (!url) return
    const img = new Image()
    img.src = url
  })
}

// Preload static assets immediately on script evaluation to hit cache early
const staticImagesToPreload = [
  ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8,
  fxSmoke, fxEmbers,
  clippyLogo,
  getAchievementImage('kill_streak_25'),
  getAchievementImage('kill_streak_50'),
  getAchievementImage('round_placement_1'),
  getAchievementImage('elite_warrior_gold'),
  getAchievementImage('elite_warrior_legend')
]
preloadImages(staticImagesToPreload)

const fxSmokeBg = { backgroundImage: `url(${fxSmoke})` }
const fxEmbersBg = { backgroundImage: `url(${fxEmbers})` }

const route = useRoute()
const music = useWrappedMusic()
const { dialogMode } = music

const nowPlayingShort = computed(() =>
  music.enabled.value && music.selectedTrackId.value ? music.selectedTrack.value.label : 'No music'
)

let wasPlayingBeforeDialog = false

function onSongDialogBegin(withMusic: boolean) {
  music.setEnabled(withMusic)
  music.closeDialog()
  music.startSession()
  startPlayback()
}

function onSongDialogClose() {
  music.closeDialog()
  if (wasPlayingBeforeDialog) {
    wasPlayingBeforeDialog = false
    resumePlayback()
  }
}

watch(dialogMode, (mode) => {
  if (mode === 'change') {
    wasPlayingBeforeDialog = isPlaying.value
    stopPlayback()
  }
})

// Mouse parallax — drives --par-x / --par-y CSS vars consumed by the hero layers
const rootEl = ref<HTMLElement | null>(null)
const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
let parallaxRaf = 0

function onParallaxMove(e: MouseEvent) {
  if (parallaxRaf) return
  const x = e.clientX / window.innerWidth - 0.5
  const y = e.clientY / window.innerHeight - 0.5
  parallaxRaf = requestAnimationFrame(() => {
    parallaxRaf = 0
    rootEl.value?.style.setProperty('--par-x', x.toFixed(3))
    rootEl.value?.style.setProperty('--par-y', y.toFixed(3))
  })
}

const serverName = ref(route.params.serverName as string)
const loading = ref(true)
const error = ref<string | null>(null)
const data = ref<ServerWrappedData | null>(null)

const chapters = [
  'INTRO',
  'THE YEAR IN NUMBERS',
  'THE ROTATION',
  'HONOURS',
  'DECORATIONS',
  'DISHONOURS',
  'CLOSEST BATTLES',
  'SHARE CARD'
]

const slideComponents = [
  IntroSlide,
  NumbersSlide,
  RotationSlide,
  HonoursSlide,
  DecorationsSlide,
  DishonoursSlide,
  ClosestSlide,
  ShareSlide
]

const currentSlide = ref(0)
const mobileScrollEl = ref<HTMLElement | null>(null)
watch(currentSlide, () => {
  mobileScrollEl.value?.scrollTo({ top: 0 })
})
const mobileProgress = ref(0)
const isHolding = ref(false)
const isPlaying = ref(false)
const isPaused = computed(() => !isPlaying.value)

const ringCirc = 138.2
const ringOffset = computed(() => {
  return (ringCirc * (1 - mobileProgress.value / 100)).toFixed(1)
})

let autoAdvanceTimer: any = null
let progressTimer: any = null
const SLIDE_DURATION = 7000

const chapterColors = [
  '#7d8849', // INTRO
  '#b4c060', // NUMBERS
  '#c5a23a', // ROTATION
  '#7da34c', // HONOURS
  '#c08a4c', // DECORATIONS
  '#d65a5a', // DISHONOURS
  '#c5a23a', // CLOSEST BATTLES
  '#7d8849'  // SHARE CARD
]

const activeThemeColor = computed(() => chapterColors[currentSlide.value])
const activeSlideComponent = computed(() => slideComponents[currentSlide.value])

const heroes = computed(() => {
  if (!data.value) return []
  return [
    { no: '01', drop: 'SERVER COMMAND', fig: 'Fig. 01 — Server Command', img: ch1, dot: 'var(--mm-accent)' },
    { no: '02', drop: 'SERVER ACTIVITY', fig: 'Fig. 02 — Server Activity', img: ch2, dot: 'var(--mm-accent)' },
    { no: '03', drop: 'THE ROTATION', fig: 'Fig. 03 — The Rotation', img: ch3, dot: 'var(--mm-accent)' },
    { no: '04', drop: 'HONOURS', fig: 'Fig. 04 — Honours', img: ch4, dot: 'var(--mm-accent)' },
    { no: '05', drop: 'DECORATIONS', fig: 'Fig. 05 — Decorations', img: ch5, dot: 'var(--mm-accent)' },
    { no: '06', drop: 'DISHONOURS', fig: 'Fig. 06 — Dishonours', img: ch6, dot: 'var(--mm-danger)' },
    { no: '07', drop: 'CLOSEST BATTLES', fig: 'Fig. 07 — Closest Battles', img: ch7, dot: 'var(--mm-danger)' },
    { no: '08', drop: 'KEEPSAKE', fig: 'Fig. 08 — Keepsake', img: ch8, dot: 'var(--mm-accent)' }
  ]
})

const activeHero = computed(() => {
  if (heroes.value.length === 0) return null
  return heroes.value[currentSlide.value]
})

onMounted(async () => {
  document.documentElement.classList.add('mm-wrapped-lock')
  if (!prefersReducedMotion) {
    window.addEventListener('mousemove', onParallaxMove)
  }

  try {
    const details = await fetchServerDetails(serverName.value)
    if (!details || !details.serverGuid) {
      throw new Error(`Could not resolve Server GUID for: ${serverName.value}`)
    }
    data.value = await fetchServerWrapped(details.serverGuid, 2026)

    // Preload dynamic achievements once data is resolved
    const dynamicImages: string[] = []
    if (data.value?.decorations?.prestigiousMilestone?.achievementId) {
      dynamicImages.push(getAchievementImage(data.value.decorations.prestigiousMilestone.achievementId))
    }
    if (data.value?.decorations?.mostLegendAchievements?.achievementId) {
      dynamicImages.push(getAchievementImage(data.value.decorations.mostLegendAchievements.achievementId))
    }
    if (dynamicImages.length > 0) {
      preloadImages(dynamicImages)
    }

    loading.value = false
    music.openDialog('intro')
  } catch (err: any) {
    loggerError(err)
    error.value = err.message || 'An unexpected error occurred while loading Wrapped statistics.'
    loading.value = false
  }
})

onUnmounted(() => {
  document.documentElement.classList.remove('mm-wrapped-lock')
  stopPlayback()
  music.closeDialog()
  music.endSession()
  window.removeEventListener('mousemove', onParallaxMove)
  if (parallaxRaf) cancelAnimationFrame(parallaxRaf)
})

function loggerError(e: any) {
  console.error('[Wrapped]', e)
}

function resumePlayback() {
  stopPlayback()
  isPlaying.value = true

  const step = 100
  const increment = (step / SLIDE_DURATION) * 100

  progressTimer = setInterval(() => {
    if (isHolding.value) return

    mobileProgress.value += increment
    if (mobileProgress.value >= 100) {
      mobileProgress.value = 0
      nextSlide(false)
    }
  }, step)
}

function startPlayback() {
  mobileProgress.value = 0
  resumePlayback()
}

function stopPlayback() {
  isPlaying.value = false
  if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer)
  if (progressTimer) clearInterval(progressTimer)
}

function togglePlayback() {
  if (currentSlide.value === chapters.length - 1) {
    goToSlide(0)
    startPlayback()
    return
  }
  if (isPlaying.value) {
    stopPlayback()
  } else {
    resumePlayback()
  }
}

function nextSlide(manual = false) {
  if (manual) {
    stopPlayback()
  }
  if (currentSlide.value < chapters.length - 1) {
    currentSlide.value++
    mobileProgress.value = 0
    if (!manual) {
      startPlayback()
    }
  } else {
    mobileProgress.value = 0
  }
}

function prevSlide(manual = false) {
  if (manual) {
    stopPlayback()
  }
  if (currentSlide.value > 0) {
    currentSlide.value--
    mobileProgress.value = 0
  }
}

function goToSlide(idx: number) {
  stopPlayback()
  currentSlide.value = idx
  mobileProgress.value = 0
}

function startHold() {
  isHolding.value = true
}

function endHold() {
  isHolding.value = false
}

// Edge-tap navigation on the mobile scroller.
function onStoryNavTap(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest('a, button, input, select, textarea, [role="button"]')) return
  const x = e.clientX / window.innerWidth
  if (x < 0.2) {
    prevSlide(true)
  } else if (x > 0.8) {
    nextSlide(true)
  }
}
</script>

<style scoped>
.server-wrapped {
  --par-x: 0;
  --par-y: 0;
  background-color: var(--mm-bg);
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  height: calc(100vh - 150px);
  width: 100%;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* Loading/Error states */
.wrapped-loading,
.wrapped-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  z-index: 10;
}

.spinner {
  border: 2px solid var(--mm-rule);
  border-left: 2px solid var(--mm-accent);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.wrapped-error h3 {
  font-size: 20px;
  margin: 16px 0 8px;
  color: var(--mm-danger);
}

.back-btn {
  margin-top: 24px;
  padding: 8px 16px;
  background-color: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink);
  border-radius: var(--mm-radius-sm, 2px);
  text-decoration: none;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  transition: all 0.2s;
}

.back-btn:hover {
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

/* Layout System */
.wrapped-layout {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

/* DESKTOP VIEWPORT */
.desktop-layout {
  display: none;
  width: 100%;
  height: 100%;
}

@media (min-width: 1024px) {
  .desktop-layout {
    display: flex;
  }
}

.wrapped-sidebar {
  width: 270px;
  background-color: var(--mm-bg);
  border-right: 1px solid var(--mm-rule);
  display: flex;
  flex-direction: column;
  padding: 24px 18px;
  height: 100%;
  box-sizing: border-box;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.logo-text {
  font-family: var(--mm-font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.badge-wrapped {
  background-color: var(--mm-accent);
  color: #000;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: var(--mm-radius-sm, 2px);
}

.server-info {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--mm-rule);
}

.server-info h4 {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mm-ink);
}

.server-info p {
  color: var(--mm-ink-muted);
  font-size: 13px;
  margin: 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-grow: 1;
}

.nav-item {
  background: none;
  border: none;
  display: flex;
  align-items: center;
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--mm-radius-sm, 2px);
  cursor: pointer;
  position: relative;
  transition: background-color 0.2s;
  width: 100%;
  color: var(--mm-ink-soft);
}

.nav-item:hover {
  background-color: var(--mm-bg-soft);
  color: var(--mm-ink);
}

.nav-num {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  color: var(--mm-ink-faint);
  margin-right: 12px;
  width: 16px;
}

.nav-label {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  letter-spacing: 0.08em;
}

.nav-item.active {
  background-color: var(--mm-bg-soft);
  color: var(--mm-ink);
}

.nav-item.active .nav-num {
  color: var(--mm-accent-soft);
}

.nav-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 12px;
  border-radius: 0 1px 1px 0;
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.exit-btn {
  background: none;
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-muted);
  text-align: center;
  padding: 10px;
  border-radius: var(--mm-radius-sm, 2px);
  text-decoration: none;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  transition: all 0.2s;
}

.exit-btn:hover {
  border-color: var(--mm-rule-strong);
  color: var(--mm-ink);
}

.wrapped-stage {
  flex-grow: 1;
  background-color: var(--mm-bg);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 20px 32px;
  box-sizing: border-box;
  position: relative;
}

/* Deep selector overrides for inner slide typography */
:deep(.slide-container .mm-eyebrow),
:deep(.mobile-content-container .mm-eyebrow) {
  font-size: 15px !important;
}

:deep(.slide-container .mm-eyebrow-small),
:deep(.mobile-content-container .mm-eyebrow-small),
:deep(.slide-container .slide-badge),
:deep(.mobile-content-container .slide-badge) {
  font-size: 13.5px !important;
}

:deep(.slide-container .intro-meta),
:deep(.mobile-content-container .intro-meta) {
  font-size: 15px !important;
}

:deep(.slide-container .click-prompt),
:deep(.mobile-content-container .click-prompt) {
  font-size: 14px !important;
}

:deep(.slide-container .rounds-text),
:deep(.mobile-content-container .rounds-text) {
  font-size: 15px !important;
}

:deep(.slide-container .numbers-footer),
:deep(.slide-container .map-footer),
:deep(.slide-container .trend-footer),
:deep(.slide-container .rotation-footer),
:deep(.slide-container .hours-footer),
:deep(.slide-container .honours-footer),
:deep(.slide-container .decorations-footer),
:deep(.slide-container .dishonours-footer),
:deep(.slide-container .closest-footer),
:deep(.slide-container .share-footer),
:deep(.mobile-content-container .numbers-footer),
:deep(.mobile-content-container .map-footer),
:deep(.mobile-content-container .trend-footer),
:deep(.mobile-content-container .rotation-footer),
:deep(.mobile-content-container .hours-footer),
:deep(.mobile-content-container .honours-footer),
:deep(.mobile-content-container .decorations-footer),
:deep(.mobile-content-container .dishonours-footer),
:deep(.mobile-content-container .closest-footer),
:deep(.mobile-content-container .share-footer) {
  font-size: 14.5px !important;
  margin-bottom: 24px !important;
}

:deep(.slide-container .card-desc),
:deep(.mobile-content-container .card-desc) {
  font-size: 16px !important;
}

:deep(.slide-container .card-val),
:deep(.mobile-content-container .card-val) {
  font-size: 17px !important;
}

.stage-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1366px;
  height: 100%;
  justify-content: flex-start;
  transition: max-width 0.25s ease;
}

@media (min-width: 1024px) and (max-width: 1920px) {
  .stage-container {
    width: 92%;
  }
}

.stage-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.desktop-progress-bars {
  display: flex;
  gap: 4px;
  width: 100%;
}

.desktop-progress-bars .progress-segment-bg {
  flex-grow: 1;
  height: 3px;
  background-color: var(--mm-bg-mute);
  border-radius: 1px;
  overflow: hidden;
  cursor: pointer;
}

.desktop-progress-bars .progress-segment-fill {
  height: 100%;
  background-color: var(--theme-color, var(--mm-accent));
  width: 0%;
}

.stage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stage-chapter-info {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
}

.stage-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-control-btn {
  background: none;
  border: none;
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: color 0.2s;
  padding: 2px 6px;
}

.stage-control-btn:hover:not(:disabled) {
  color: var(--mm-ink);
}

.stage-control-btn:disabled {
  color: var(--mm-ink-faint);
  cursor: not-allowed;
}

.stage-song-btn,
.stage-mute-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.stage-song-btn svg,
.stage-mute-btn svg {
  display: block;
}

.stage-mute-btn {
  color: var(--mm-accent);
}

.stage-mute-btn--muted {
  color: var(--mm-ink-faint);
}

.control-divider {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.slide-card {
  flex-grow: 1;
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: stretch;
  border: 1px solid var(--mm-rule);
  background-color: var(--mm-bg);
  border-radius: var(--mm-radius-sm, 2px);
  min-height: 400px;
  overflow: hidden;
}

.slide-card-layout {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: stretch;
  gap: 28px;
  padding: 24px 28px;
  box-sizing: border-box;
}

.hero-card-col {
  flex: 1;
  max-width: 420px;
  align-self: stretch;
  min-width: 0;
}

.slide-container {
  flex: 1.35;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow-y: auto;
}

/* Animated smoke + embers behind the slide content */
.wrapped-fx {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}

.wrapped-fx > div {
  position: absolute;
  inset: 0;
  background-repeat: repeat;
  mix-blend-mode: screen;
}

.fx-smoke {
  background-size: 2200px 2200px;
  opacity: 0.5;
}

.fx-embers-far {
  background-size: 1800px 1800px;
  opacity: 0.65;
  animation: fxRiseFar 60s linear infinite, fxSway 47s ease-in-out infinite alternate;
}

.fx-embers-near {
  background-size: 1040px 1040px;
  opacity: 0.35;
  animation: fxRiseNear 39s linear infinite, fxSway 31s ease-in-out infinite alternate, fxBreathe 9s ease-in-out infinite;
}

@keyframes fxRiseFar {
  0% { background-position-y: 0px; }
  100% { background-position-y: -1800px; }
}

@keyframes fxRiseNear {
  0% { background-position-y: 0px; }
  100% { background-position-y: -2080px; }
}

@keyframes fxSway {
  0% { background-position-x: 0px; }
  100% { background-position-x: -70px; }
}

@keyframes fxBreathe {
  0%, 100% { opacity: 0.14; }
  50% { opacity: 0.3; }
}

/* Film grain over the whole wrapped experience */
.wrapped-grain {
  position: absolute;
  inset: -10%;
  z-index: 100;
  pointer-events: none;
  opacity: 0.055;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 180px 180px;
  animation: grainShift 0.9s steps(3) infinite;
}

@keyframes grainShift {
  0% { transform: translate(0, 0); }
  100% { transform: translate(-4%, 3%); }
}

.slide-content-wrapper {
  width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

:deep(.slide-container .wrapped-slide) {
  height: auto !important;
  min-height: 100% !important;
}

/* MOBILE VIEWPORT */
.mobile-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--mm-bg);
  position: relative;
  isolation: isolate;
  overflow: hidden;
}

@media (min-width: 1024px) {
  .mobile-layout {
    display: none;
  }
}

.mobile-sticky-header {
  position: sticky;
  top: 0;
  z-index: 90;
  padding: 14px 16px 12px;
  background: linear-gradient(180deg, var(--mm-bg) 78%, rgba(19,19,19,0));
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
}

.mobile-progress-bars {
  display: flex;
  gap: 4px;
  width: 100%;
}

.progress-segment-bg {
  flex-grow: 1;
  height: 3px;
  background-color: var(--mm-bg-mute);
  border-radius: 1px;
  overflow: hidden;
  cursor: pointer;
}

.progress-segment-fill {
  height: 100%;
  background-color: var(--theme-color, var(--mm-accent));
  width: 0%;
}

.mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.logo-small {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.badge-small {
  background-color: var(--theme-color, var(--mm-accent));
  color: #000;
  font-family: var(--mm-font-mono);
  font-size: 8px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: var(--mm-radius-sm, 2px);
  margin-left: 6px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.close-mobile {
  background: none;
  border: none;
  color: var(--mm-ink-muted);
  font-size: 18px;
  cursor: pointer;
  text-decoration: none;
}

.swm-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  -ms-overflow-style: none;
  scrollbar-width: none;
  overscroll-behavior-y: contain;
  user-select: none;
  -webkit-user-select: none;
}

.swm-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.mobile-hero-container {
  padding: 2px 16px 0;
  width: 100%;
  box-sizing: border-box;
}

.mobile-hero-container .hero-image-card {
  position: relative;
  width: 100%;
  height: auto;
  min-height: auto;
  aspect-ratio: 5 / 4;
}

.mobile-content-container {
  flex-grow: 1;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 22px 18px 48px;
  box-sizing: border-box;
}

.mobile-bottom-nav {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  flex-shrink: 0;
}

.nav-btn {
  background: 0;
  border: 0;
  cursor: pointer;
  padding: 8px 4px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

.nav-btn:disabled {
  cursor: default;
}

.nav-center {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.toggle-play-btn {
  position: relative;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  background: 0;
  border: 0;
  padding: 0;
  cursor: pointer;
}

.toggle-icon-wrapper {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 1023px) {
  .server-wrapped {
    position: fixed !important;
    inset: 0 !important;
    height: 100vh !important;
    height: 100dvh !important;
    overflow: hidden !important;
    z-index: 200;
  }
}

/* Transitions */
.slide-fade-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.7, 0, 0.84, 0);
}

.slide-fade-enter-from {
  opacity: 0;
  transform: scale(0.98) translateY(8px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: scale(1.01) translateY(-8px);
}
</style>

<style>
/* ===== Server Wrapped Global Animations & Hero Image Card Styles ===== */
.server-wrapped .hero-card-col {
  display: none;
}

@media (min-width: 1024px) {
  .server-wrapped .hero-card-col {
    display: block;
    animation: wrapFade 0.8s ease both;
    height: 100%;
    min-height: 100%;
  }
}

.server-wrapped .hero-image-card {
  position: relative;
  height: 100%;
  min-height: 100%;
  border: 1px solid #0a0a0a;
  border-radius: 2px;
  overflow: hidden;
  background: #0d0d0d;
  box-shadow: inset 0 0 0 1px rgba(125,136,73,0.14), 0 18px 40px -18px rgba(0,0,0,0.9);
}

.server-wrapped .hero-placeholder {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 24px;
  background: radial-gradient(circle at 50% 38%, #1b1c14, #0d0d0d 70%);
}

.server-wrapped .hero-title {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--mm-accent);
}

.server-wrapped .hero-sub {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--mm-ink-faint);
  line-height: 1.8;
}

.server-wrapped .hero-img-wrapper {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  transform: translate(calc(var(--par-x, 0) * 22px), calc(var(--par-y, 0) * 22px));
}

.server-wrapped .hero-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.14);
  animation: heroReveal 1.1s ease both, kenBurns 36s ease-in-out 1.1s infinite;
}

.server-wrapped .hero-overlay-smoke {
  position: absolute;
  inset: -15%;
  z-index: 2;
  pointer-events: none;
  background: radial-gradient(ellipse at 28% 22%, rgba(210,200,160,0.10), transparent 55%), radial-gradient(ellipse at 75% 82%, rgba(0,0,0,0.55), transparent 62%);
  mix-blend-mode: screen;
  filter: blur(10px);
  transform: scale(1.4);
  animation: smokeDrift 26s ease-in-out infinite;
}

.server-wrapped .hero-overlay-grad {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(13,13,13,0.35) 0%, transparent 26%, transparent 52%, rgba(8,8,8,0.88) 100%);
}

.server-wrapped .hero-border-inset {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  border-radius: 2px;
  box-shadow: inset 0 0 130px 18px rgba(0,0,0,0.92), inset 0 0 46px rgba(0,0,0,0.6);
}

.server-wrapped .hero-corner {
  position: absolute;
  width: 15px;
  height: 15px;
  z-index: 6;
  pointer-events: none;
  border-color: var(--mm-accent);
  animation: cornerFade 1.4s ease 0.6s both;
}

.server-wrapped .hero-corner-tl {
  top: 9px;
  left: 9px;
  border-top: 1.5px solid;
  border-left: 1.5px solid;
}

.server-wrapped .hero-corner-tr {
  top: 9px;
  right: 9px;
  border-top: 1.5px solid;
  border-right: 1.5px solid;
}

.server-wrapped .hero-corner-bl {
  bottom: 9px;
  left: 9px;
  border-bottom: 1.5px solid;
  border-left: 1.5px solid;
}

.server-wrapped .hero-corner-br {
  bottom: 9px;
  right: 9px;
  border-bottom: 1.5px solid;
  border-right: 1.5px solid;
}

.server-wrapped .hero-caption {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 5;
  transform: translate(calc(var(--par-x, 0) * -9px), calc(var(--par-y, 0) * -9px));
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink);
  background: rgba(10,10,10,0.55);
  border: 1px solid var(--mm-rule-strong);
  padding: 4px 8px;
  border-radius: 2px;
}

.server-wrapped .hero-caption-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--mm-accent);
  display: inline-block;
}

@keyframes wrapUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: none; }
}

@keyframes wrapFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes smokeDrift {
  0%, 100% { transform: scale(1.4) translate(0, 0); }
  50% { transform: scale(1.5) translate(2.5%, -2.5%); }
}

@keyframes kenBurns {
  0% { transform: scale(1.14) translate(0, 0); }
  50% { transform: scale(1.0) translate(0, 0); }
  100% { transform: scale(1.14) translate(0, 0); }
}

@keyframes heroReveal {
  0% { opacity: 0; transform: scale(1.26); filter: brightness(0.4) contrast(1.1); }
  100% { opacity: 1; transform: scale(1.14); filter: none; }
}

@keyframes cornerFade {
  from { opacity: 0; }
  to { opacity: 0.75; }
}

@media (prefers-reduced-motion: reduce) {
  .server-wrapped *,
  .server-wrapped *::before,
  .server-wrapped *::after {
    animation: none !important;
  }
}
</style>
