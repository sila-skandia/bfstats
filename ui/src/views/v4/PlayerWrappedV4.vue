<template>
  <div class="player-wrapped">
    <div v-if="loading" class="wrapped-loading">
      <div class="spinner"></div>
      <p>Retrieving Wrapped 2026 aggregates...</p>
    </div>

    <div v-else-if="error" class="wrapped-error">
      <span class="error-icon">⚠</span>
      <h3>Failed to Load Wrapped Data</h3>
      <p>{{ error }}</p>
      <router-link v-if="serverGuid !== 'global'" :to="`/v4/servers/detail/${encodeURIComponent(serverGuid)}`" class="back-btn">
        Back to Server Details
      </router-link>
      <router-link v-else to="/v4/" class="back-btn">
        Back to Home
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
            <h4>{{ data.playerName }}</h4>
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
            <router-link v-if="serverGuid !== 'global'" :to="`/v4/servers/detail/${encodeURIComponent(serverGuid)}`" class="exit-btn">
              Exit Wrapped
            </router-link>
            <router-link v-else to="/v4/" class="exit-btn">
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

            <div class="slide-container" :key="currentSlide">
              <transition name="slide-fade" mode="out-in">
                <div class="slide-content-wrapper">
                  <component :is="activeSlideComponent" :data="data" @next="nextSlide(false)" @prev="prevSlide(false)" @pause="stopPlayback" />
                </div>
              </transition>
            </div>
          </div>
        </main>
      </div>

      <!-- Mobile Portrait Stories Layout -->
      <div class="mobile-layout" :style="{ '--theme-color': activeThemeColor }">
        <!-- Top Progress Bars -->
        <div class="mobile-progress-bars">
          <div
            v-for="idx in chapters.length"
            :key="idx"
            class="progress-segment-bg"
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
          <router-link v-if="serverGuid !== 'global'" :to="`/v4/servers/detail/${encodeURIComponent(serverGuid)}`" class="close-mobile">
            ✕
          </router-link>
          <router-link v-else to="/v4/" class="close-mobile">
            ✕
          </router-link>
        </header>

        <!-- Tap Zones -->
        <div class="mobile-tap-zones">
          <div class="tap-zone tap-left" @click="prevSlide(true)"></div>
          <div 
            class="tap-zone tap-right" 
            @click="nextSlide(true)" 
            @mousedown="startHold"
            @mouseup="endHold"
            @touchstart="startHold"
            @touchend="endHold"
          ></div>
        </div>

        <!-- Mobile Content Container -->
        <div class="mobile-content-container" :key="currentSlide">
          <component :is="activeSlideComponent" :data="data" @next="nextSlide(true)" @prev="prevSlide(true)" @pause="stopPlayback" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPlayerWrapped, type PlayerWrappedData } from '@/services/wrappedService'
import { useAuth } from '@/composables/useAuth'

import PlayerIntroSlide from '@/components/v4/wrapped/PlayerIntroSlide.vue'
import PlayerNumbersSlide from '@/components/v4/wrapped/PlayerNumbersSlide.vue'
import PlayerTrendSlide from '@/components/v4/wrapped/PlayerTrendSlide.vue'
import PlayerMapSlide from '@/components/v4/wrapped/PlayerMapSlide.vue'
import PlayerMedalsSlide from '@/components/v4/wrapped/PlayerMedalsSlide.vue'
import PlayerMomentSlide from '@/components/v4/wrapped/PlayerMomentSlide.vue'
import PlayerSquadSlide from '@/components/v4/wrapped/PlayerSquadSlide.vue'
import PlayerShareSlide from '@/components/v4/wrapped/PlayerShareSlide.vue'

const slideComponents = [
  PlayerIntroSlide,
  PlayerNumbersSlide,
  PlayerTrendSlide,
  PlayerMapSlide,
  PlayerMedalsSlide,
  PlayerMomentSlide,
  PlayerSquadSlide,
  PlayerShareSlide
]

const { isSupport } = useAuth()
const route = useRoute()
const router = useRouter()

const playerName = ref(route.params.playerName as string)
const serverGuid = ref((route.params.serverGuid as string) || 'global')

const loading = ref(true)
const error = ref<string | null>(null)
const data = ref<PlayerWrappedData | null>(null)

const chapters = [
  'INTRO',
  'THE YEAR IN NUMBERS',
  'RANK & K/D TREND',
  'FAVOURITE MAP',
  'MEDALS & DECORATIONS',
  'BEST MOMENT',
  'SQUAD',
  'SHARE CARD'
]

const currentSlide = ref(0)
const mobileProgress = ref(0)
const isHolding = ref(false)
let autoAdvanceTimer: any = null
let progressTimer: any = null
const SLIDE_DURATION = 7000 

const activeThemeColor = 'var(--mm-accent)'
const activeSlideComponent = computed(() => slideComponents[currentSlide.value])

onMounted(async () => {
  // Redirection guard if not Support
  if (!isSupport.value) {
    router.replace({ name: 'v4-player-details', params: { playerName: playerName.value } })
    return
  }

  try {
    data.value = await fetchPlayerWrapped(playerName.value, serverGuid.value, 2026)
    loading.value = false
    startPlayback()
  } catch (err: any) {
    console.error('[PlayerWrapped]', err)
    error.value = err.response?.data?.error || err.message || 'An unexpected error occurred while loading Wrapped statistics.'
    loading.value = false
  }
})

onUnmounted(() => {
  stopPlayback()
})

function startPlayback() {
  stopPlayback()
  mobileProgress.value = 0
  
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

function stopPlayback() {
  if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer)
  if (progressTimer) clearInterval(progressTimer)
}

function nextSlide(manual = false) {
  if (manual) {
    stopPlayback()
  }
  if (currentSlide.value < chapters.length - 1) {
    currentSlide.value++
    mobileProgress.value = 0
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
</script>

<style scoped>
.player-wrapped {
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
  width: 240px;
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
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.badge-wrapped {
  background-color: var(--mm-accent);
  color: #000;
  font-family: var(--mm-font-mono);
  font-size: 8px;
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
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mm-ink);
}

.server-info p {
  color: var(--mm-ink-muted);
  font-size: 11px;
  margin: 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-grow: 1;
}

.nav-item {
  background: none;
  border: none;
  display: flex;
  align-items: center;
  text-align: left;
  padding: 6px 8px;
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
  font-size: 9.5px;
  color: var(--mm-ink-faint);
  margin-right: 12px;
  width: 16px;
}

.nav-label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
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
  font-size: 11px;
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
}

.slide-content-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* MOBILE VIEWPORT */
.mobile-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--mm-bg);
  position: relative;
}

@media (min-width: 1024px) {
  .mobile-layout {
    display: none;
  }
}

.mobile-progress-bars {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  display: flex;
  gap: 4px;
  z-index: 100;
}

.progress-segment-bg {
  flex-grow: 1;
  height: 3px;
  background-color: var(--mm-bg-mute);
  border-radius: 1px;
  overflow: hidden;
}

.progress-segment-fill {
  height: 100%;
  background-color: var(--theme-color, var(--mm-accent));
  width: 0%;
}

.mobile-header {
  position: absolute;
  top: 28px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 90;
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

.close-mobile {
  background: none;
  border: none;
  color: var(--mm-ink-muted);
  font-size: 18px;
  cursor: pointer;
  text-decoration: none;
}

.mobile-tap-zones {
  position: absolute;
  inset: 0;
  display: flex;
  z-index: 40;
}

.tap-zone {
  width: 50%;
  height: 100%;
}

.mobile-content-container {
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
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
