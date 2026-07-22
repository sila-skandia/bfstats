<template>
  <div class="server-wrapped">
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
      <!-- Layout 2A: Desktop Widescreen Sidebar Layout -->
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
            <!-- Stage Header: Progress bars & controls moved to the top -->
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

            <div class="slide-container">
              <transition name="slide-fade" mode="out-in">
                <!-- Slide rendering -->
                <div class="slide-content-wrapper" :key="currentSlide">
                  <!-- background splashes and props inside transition container -->
                  <div aria-hidden="true" class="sw-splash-container">
                    <div class="sw-splash sw-splash-1" :style="{ background: `radial-gradient(circle, ${chapterColors[currentSlide]} 0%, transparent 68%)` }"></div>
                    <div class="sw-splash sw-splash-2" :style="{ background: `radial-gradient(circle, ${chapterColors[currentSlide]} 0%, transparent 70%)` }"></div>
                    <img class="sw-prop" :src="chapterImages[currentSlide]" :style="chapterProps[currentSlide]" alt="">
                  </div>
                  <component :is="activeSlideComponent" :data="data" @next="nextSlide(false)" @prev="prevSlide(false)" @pause="stopPlayback" @restart="goToSlide(0)" />
                </div>
              </transition>
            </div>
          </div>
        </main>
      </div>

      <!-- Layout 1B: Mobile Portrait Stories Layout -->
      <div class="mobile-layout" :style="{ '--theme-color': activeThemeColor }">
        <!-- animated colour splash layer (fixed behind content) -->
        <div aria-hidden="true" class="swm-splash-container">
          <div class="swm-splash swm-splash-1" :style="{ background: `radial-gradient(circle, ${activeThemeColor} 0%, transparent 68%)` }"></div>
          <div class="swm-splash swm-splash-2" :style="{ background: `radial-gradient(circle, ${activeThemeColor} 0%, transparent 70%)` }"></div>
          <img class="swm-prop" :src="chapterImages[currentSlide]" :style="chapterPropsMobile[currentSlide]" alt="">
        </div>

        <!-- Top Progress Bars -->
        <div class="mobile-progress-bars">
          <button
            v-for="idx in chapters.length"
            :key="idx"
            @click="goToSlide(idx - 1)"
            class="progress-segment-btn"
          >
            <div
              class="progress-segment-fill"
              :style="{
                width: idx - 1 < currentSlide ? '100%' : idx - 1 === currentSlide ? `${mobileProgress}%` : '0%',
                transition: idx - 1 === currentSlide && isHolding ? 'none' : 'width 100ms linear'
              }"
            ></div>
          </button>
        </div>

        <!-- Mobile Header -->
        <header class="mobile-header">
          <div class="header-left">
            <img :src="clippyLogo" alt="" class="logo-img">
            <div class="logo-text-wrapper">
              <div class="logo-title">Server Wrapped</div>
              <div class="logo-subtitle">bfstats.io · 2026</div>
            </div>
          </div>
          <span class="mm-chip mm-chip--accent">CH {{ String(currentSlide + 1).padStart(2, '0') }}/08</span>
        </header>

        <!-- Mobile Content Container (scrollable). Edge taps navigate, any
             touch pauses the timer while held — handlers live on the scroller
             itself so every swipe scrolls natively (no overlay tap zones). -->
        <main
          ref="mobileScrollEl"
          class="swm-scroll"
          @click="onStoryNavTap"
          @touchstart.passive="startHold"
          @touchend.passive="endHold"
          @touchcancel.passive="endHold"
        >
          <div class="mobile-slide-wrapper">
            <transition name="slide-fade" mode="out-in">
              <component :is="activeSlideComponent" :key="currentSlide" :data="data" @next="nextSlide(true)" @prev="prevSlide(true)" @pause="stopPlayback" @restart="goToSlide(0)" />
            </transition>
          </div>
        </main>

        <!-- Bottom Navigation Bar -->
        <div class="mobile-bottom-nav">
          <button @click="prevSlide(true)" class="nav-btn prev-btn" :style="{ color: currentSlide === 0 ? 'var(--mm-ink-faint)' : 'var(--mm-ink-soft)' }">← Prev</button>

          <button @click="togglePlayback" class="toggle-play-btn" title="Play / pause (P)">
            <svg width="52" height="52" viewBox="0 0 52 52" style="display:block;">
              <circle cx="26" cy="26" r="22" fill="none" stroke="var(--mm-rule-strong)" stroke-width="2.5"></circle>
              <circle cx="26" cy="26" r="22" fill="none" :stroke="activeThemeColor" stroke-width="3" stroke-linecap="round" :stroke-dasharray="ringCirc" :stroke-dashoffset="ringOffset" transform="rotate(-90 26 26)" style="transition:stroke-dashoffset .12s linear, stroke .4s ease;"></circle>
            </svg>
            <span class="toggle-icon-wrapper">
              <svg v-if="!isPaused" width="13" height="14" viewBox="0 0 13 14" :fill="activeThemeColor"><rect x="1" y="0" width="3.6" height="14" rx="0.6"></rect><rect x="8.4" y="0" width="3.6" height="14" rx="0.6"></rect></svg>
              <svg v-else width="13" height="15" viewBox="0 0 13 15" :fill="activeThemeColor"><path d="M1.5 0.9 L12 7.5 L1.5 14.1 Z"></path></svg>
            </span>
          </button>

          <button @click="nextSlide(true)" class="nav-btn next-btn">{{ currentSlide === chapters.length - 1 ? 'Replay' : 'Next' }} →</button>
        </div>
      </div>
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

const chapterImages = [ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8]

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
  ...chapterImages,
  clippyLogo,
  getAchievementImage('kill_streak_25'),
  getAchievementImage('kill_streak_50'),
  getAchievementImage('round_placement_1'),
  getAchievementImage('elite_warrior_gold'),
  getAchievementImage('elite_warrior_legend')
]
preloadImages(staticImagesToPreload)

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

const chapterProps = [
  'width:clamp(220px,26vw,360px); right:-20px; bottom:-28px;',   // 1 helmet
  'width:clamp(150px,17vw,230px); right:-6px; top:-6px;',         // 2 counter
  'width:clamp(150px,17vw,215px); right:-30px; bottom:-24px;',    // 3 map
  'width:clamp(180px,21vw,290px); right:-12px; top:-4px;',        // 4 rifles
  'width:clamp(175px,20vw,275px); right:-6px; top:-4px;',         // 5 medal case
  'width:clamp(150px,17vw,215px); right:-14px; top:-8px;',        // 6 dented helmet
  'width:clamp(150px,17vw,210px); right:-8px; top:-8px;',         // 7 shell & watch
  'width:clamp(200px,23vw,320px); right:-18px; bottom:-16px;',    // 8 scroll
]

const chapterPropsMobile = [
  'width:180px; right:-30px; bottom:20px;',    // 1 helmet
  'width:110px; right:-14px; top:0;',          // 2 counter
  'width:120px; right:-30px; bottom:24px;',    // 3 map
  'width:130px; right:-18px; top:-4px;',       // 4 rifles
  'width:120px; right:-14px; top:-4px;',       // 5 medal case
  'width:110px; right:-16px; top:-6px;',       // 6 dented helmet
  'width:110px; right:-14px; bottom:30px;',    // 7 shell & watch
  'width:150px; right:-24px; bottom:8px;',     // 8 scroll
]

// Slide Sub-components declared inline to keep file clean
import IntroSlide from '@/components/v4/wrapped/IntroSlide.vue'
import NumbersSlide from '@/components/v4/wrapped/NumbersSlide.vue'
import RotationSlide from '@/components/v4/wrapped/RotationSlide.vue'
import HonoursSlide from '@/components/v4/wrapped/HonoursSlide.vue'
import DecorationsSlide from '@/components/v4/wrapped/DecorationsSlide.vue'
import DishonoursSlide from '@/components/v4/wrapped/DishonoursSlide.vue'
import ClosestSlide from '@/components/v4/wrapped/ClosestSlide.vue'
import ShareSlide from '@/components/v4/wrapped/ShareSlide.vue'

// Import components registry
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

const route = useRoute()

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
const SLIDE_DURATION = 7000 // 7 seconds per slide

const activeThemeColor = computed(() => chapterColors[currentSlide.value])
const activeSlideComponent = computed(() => slideComponents[currentSlide.value])

onMounted(async () => {
  document.documentElement.classList.add('mm-wrapped-lock')
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
    startPlayback()
  } catch (err: any) {
    loggerError(err)
    error.value = err.message || 'An unexpected error occurred while loading Wrapped statistics.'
    loading.value = false
  }
})

onUnmounted(() => {
  document.documentElement.classList.remove('mm-wrapped-lock')
  stopPlayback()
})

function loggerError(e: any) {
  console.error('[Wrapped]', e)
}

function resumePlayback() {
  stopPlayback()
  isPlaying.value = true

  const step = 100 // update every 100ms
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
  if (currentSlide.value === 0) {
    isPlaying.value = true
    goToSlide(1)
    startPlayback()
    return
  }
  if (currentSlide.value === chapters.length - 1) {
    isPlaying.value = true
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
    // Loop back to share slide or stop
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

// Edge-tap navigation on the mobile scroller. The browser only fires click
// when the gesture wasn't a scroll, so drags always scroll the content and
// only true taps in the outer 20% bands change slides.
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
:deep(.wrapped-slide) {
  margin-top: auto;
  margin-bottom: auto;
}

:deep(.slide-container .mm-eyebrow),
:deep(.mobile-content-container .mm-eyebrow) {
  font-size: 13.5px !important;
}

:deep(.slide-container .mm-eyebrow-small),
:deep(.mobile-content-container .mm-eyebrow-small),
:deep(.slide-container .slide-badge),
:deep(.mobile-content-container .slide-badge) {
  font-size: 11.5px !important;
}

:deep(.slide-container .intro-meta),
:deep(.mobile-content-container .intro-meta) {
  font-size: 13.5px !important;
}

:deep(.slide-container .click-prompt),
:deep(.mobile-content-container .click-prompt) {
  font-size: 12.5px !important;
}

:deep(.slide-container .rounds-text),
:deep(.mobile-content-container .rounds-text) {
  font-size: 13.5px !important;
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
  font-size: 13px !important;
}

:deep(.slide-container .card-desc),
:deep(.mobile-content-container .card-desc) {
  font-size: 14.5px !important;
}

:deep(.slide-container .card-val),
:deep(.mobile-content-container .card-val) {
  font-size: 15px !important;
}

:deep(.slide-container .map-rounds),
:deep(.mobile-content-container .map-rounds) {
  font-size: 12.5px !important;
}

:deep(.slide-container .map-label),
:deep(.mobile-content-container .map-label) {
  font-size: 16.5px !important;
}

:deep(.slide-container .item-header),
:deep(.mobile-content-container .item-header) {
  font-size: 17px !important;
}

:deep(.slide-container .stat-label),
:deep(.mobile-content-container .stat-label) {
  font-size: 12.5px !important;
}

:deep(.slide-container .mm-chip-love),
:deep(.mobile-content-container .mm-chip-love) {
  font-size: 11px !important;
}

.stage-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 980px;
  height: 100%;
  justify-content: flex-start;
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
}

.desktop-progress-bars .progress-segment-fill {
  height: 100%;
  background-color: var(--mm-accent);
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

.control-divider {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.slide-container {
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mm-rule);
  background-color: var(--mm-bg);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 24px 32px;
  box-sizing: border-box;
  min-height: 400px;
  position: relative;
  overflow: hidden;
}

.slide-content-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

/* MOBILE VIEWPORT */
.mobile-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--mm-bg);
  position: relative;
  overflow: hidden;
}

@media (min-width: 1024px) {
  .mobile-layout {
    display: none;
  }
}

.swm-scroll::-webkit-scrollbar { width: 0; height: 0; }
.swm-scroll { -ms-overflow-style: none; scrollbar-width: none; }

.swm-splash-container {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

.swm-splash {
  position: absolute;
  border-radius: 50%;
  filter: blur(46px);
  transition: background .5s ease;
  will-change: transform, opacity;
}

.swm-prop {
  position: absolute;
  height: auto;
  opacity: .4;
  pointer-events: none;
  animation: sw-float-mobile 9s ease-in-out infinite;
  filter: drop-shadow(0 20px 44px rgba(0,0,0,.55));
  transition: all 0.5s ease-in-out;
}

.mobile-progress-bars {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 4px;
  padding: 12px 16px 0;
  flex-shrink: 0;
}

.progress-segment-btn {
  flex: 1;
  height: 3px;
  border: 0;
  padding: 0;
  cursor: pointer;
  background: var(--mm-rule-strong);
  border-radius: 2px;
  overflow: hidden;
}

.progress-segment-fill {
  height: 100%;
  background-color: var(--theme-color, var(--mm-accent));
  border-radius: 2px;
  transition: width .12s linear, background .4s ease;
}

.mobile-header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 12px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.logo-img {
  width: 26px;
  height: 26px;
  object-fit: contain;
  flex-shrink: 0;
}

.logo-text-wrapper {
  min-width: 0;
  text-align: left;
}

.logo-title {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logo-subtitle {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-chip--accent {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-accent-soft);
  border: 1px solid var(--mm-rule);
  padding: 2px 6px;
  border-radius: var(--mm-radius-sm, 2px);
  text-transform: uppercase;
}

.swm-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* Reaching the top of the slide must never chain into the document /
     pull-to-refresh — the scroller owns every vertical gesture. */
  overscroll-behavior-y: contain;
  /* Hold-anywhere pauses the story; without this iOS long-press pops the
     text-selection callout instead. */
  user-select: none;
  -webkit-user-select: none;
}

.mobile-slide-wrapper {
  min-height: 100%;
  box-sizing: border-box;
  padding: 8px 20px 28px;
  display: flex;
  flex-direction: column;
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

@keyframes sw-blink-mobile {
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0; }
}

@keyframes sw-grow-mobile {
  from { transform: scaleY(0.15); }
  to { transform: scaleY(1); }
}

@keyframes sw-splash-mobile {
  0%, 100% { transform: scale(0.92); opacity: .14; }
  50% { transform: scale(1.12); opacity: .30; }
}

@keyframes sw-float-mobile {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.swm-splash-1 {
  width: 380px;
  height: 380px;
  right: -120px;
  top: -90px;
  animation: sw-splash-mobile 6.5s ease-in-out infinite;
}

.swm-splash-2 {
  width: 300px;
  height: 300px;
  left: -120px;
  bottom: 60px;
  animation: sw-splash-mobile 7.8s ease-in-out infinite reverse;
}

@media (max-width: 1023px) {
  /* Fullscreen fixed overlay with an internal scroller (.swm-scroll).
     In-flow 100dvh left the shell topbar above us, so the document kept
     ~100px of scroll slack and edge swipes moved the page instead of the
     slides; fixed + the html.mm-wrapped-lock scroll lock means the slide
     scroller is the only thing that can scroll. */
  .server-wrapped {
    position: fixed !important;
    inset: 0 !important;
    height: 100vh !important;
    height: 100dvh !important;
    overflow: hidden !important;
    z-index: 200;
  }

  :deep(.wrapped-slide) {
    padding: 0 !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .swm-splash, .swm-prop {
    animation: none !important;
  }
  .swm-splash {
    opacity: .14 !important;
  }
}
</style>
