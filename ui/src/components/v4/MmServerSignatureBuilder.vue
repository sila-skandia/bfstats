<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'

type BannerStyle = 'reticle' | 'hologram' | 'waveform' | 'console'

interface Props {
  serverName: string
}

const props = defineProps<Props>()

const styles: { id: BannerStyle; label: string; sub: string }[] = [
  { id: 'reticle', label: 'Reticle', sub: 'Targeting HUD overlay' },
  { id: 'hologram', label: 'Hologram', sub: 'Projected terrain grid' },
  { id: 'waveform', label: 'Waveform', sub: '24h population signal' },
  { id: 'console', label: 'Console', sub: 'Command ops readout' },
]

// Output sizes (aspect locked to the renderer's 960×200). Width is what forums key off —
// smaller fits sites that cap signature dimensions, larger reads big and stays crisp on 4K.
const sizes: { width: number; height: number; label: string; sub: string }[] = [
  { width: 640, height: 133, label: 'Small', sub: '640×133' },
  { width: 960, height: 200, label: 'Medium', sub: '960×200' },
  { width: 1280, height: 267, label: 'Large', sub: '1280×267' },
]

const selectedStyle = ref<BannerStyle>('reticle')
const selectedWidth = ref(960)
const showTickets = ref(true)

const selectedSize = computed(() => sizes.find((s) => s.width === selectedWidth.value) ?? sizes[1])
const copyState = ref<Record<string, boolean>>({})
const isPreviewLoading = ref(true)
const previewVersion = ref(Date.now())

const REFRESH_INTERVAL_MS = 30_000
const refreshTimer = window.setInterval(() => {
  previewVersion.value = Date.now()
}, REFRESH_INTERVAL_MS)
onUnmounted(() => clearInterval(refreshTimer))

const previewUrl = computed(() => buildUrl(true, previewVersion.value))
const shareUrl = computed(() => buildUrl(false))

watch(previewUrl, () => { isPreviewLoading.value = true })

const bbCode = computed(() => `[img]${shareUrl.value}[/img]`)
const htmlImg = computed(() => `<img src="${shareUrl.value}" alt="${props.serverName} live server status" width="${selectedSize.value.width}" height="${selectedSize.value.height}" />`)
const markdownImg = computed(() => `![${props.serverName}](${shareUrl.value})`)

function buildUrl(relative: boolean, cacheBust?: number): string {
  const params = new URLSearchParams()
  params.set('style', selectedStyle.value)
  params.set('w', String(selectedWidth.value))
  if (!showTickets.value) params.set('tickets', 'false')
  if (cacheBust !== undefined) params.set('_t', String(cacheBust))
  const path = `/stats/servers/${encodeURIComponent(props.serverName)}/banner.png?${params.toString()}`
  if (relative) return path
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${path}`
}

async function copy(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copyState.value = { ...copyState.value, [key]: true }
    setTimeout(() => {
      copyState.value = { ...copyState.value, [key]: false }
    }, 1800)
  } catch (err) {
    console.error('Clipboard write failed', err)
  }
}

const shareRows = computed(() => [
  { key: 'bb', label: 'BBCode', value: bbCode.value },
  { key: 'html', label: 'HTML', value: htmlImg.value },
  { key: 'md', label: 'Markdown', value: markdownImg.value },
  { key: 'url', label: 'URL', value: shareUrl.value },
])
</script>

<template>
  <section class="mm-sig">
    <header class="mm-sig__head">
      <div class="mm-eyebrow mm-eyebrow--strong">Server signature</div>
      <h2 class="mm-h2 mm-sig__title">Mint a live status banner</h2>
      <p class="mm-sig__sub">
        A self-updating PNG for forum signatures and embeds — shows current player
        count, map, server IP, and the live team ticket score. Refreshes on every load.
      </p>
    </header>

    <hr class="mm-rule" />

    <div class="mm-sig__preview">
      <div class="mm-sig__frame">
        <img
          :src="previewUrl"
          :alt="`${serverName} signature preview`"
          class="mm-sig__img"
          :class="{ 'is-loading': isPreviewLoading }"
          @load="isPreviewLoading = false"
          @error="isPreviewLoading = false"
        />
        <div v-if="isPreviewLoading" class="mm-sig__loader" role="status" aria-live="polite">
          <span class="mm-eyebrow">Rendering banner…</span>
        </div>
      </div>
      <div class="mm-sig__preview-meta">
        <span class="mm-chip">{{ selectedStyle }}</span>
        <span class="mm-eyebrow">Auto-refreshes every 30s · PNG</span>
      </div>
    </div>

    <div class="mm-sig__controls">
      <div class="mm-sig__block">
        <div class="mm-eyebrow">01 · Style</div>
        <div class="mm-sig__styles">
          <button
            v-for="style in styles"
            :key="style.id"
            type="button"
            class="mm-sig__style"
            :class="{ 'is-active': selectedStyle === style.id }"
            @click="selectedStyle = style.id"
          >
            <span class="mm-sig__style-label">{{ style.label }}</span>
            <span class="mm-sig__style-sub">{{ style.sub }}</span>
          </button>
        </div>
        <button
          type="button"
          class="mm-sig__toggle"
          role="switch"
          :aria-checked="showTickets"
          @click="showTickets = !showTickets"
        >
          <span class="mm-sig__toggle-track" :class="{ 'is-on': showTickets }">
            <span class="mm-sig__toggle-thumb" />
          </span>
          <span class="mm-sig__toggle-label">Show live team tickets</span>
        </button>

        <div class="mm-sig__res">
          <span class="mm-sig__res-label">Size</span>
          <div class="mm-sig__res-opts">
            <button
              v-for="size in sizes"
              :key="size.width"
              type="button"
              class="mm-sig__res-opt"
              :class="{ 'is-active': selectedWidth === size.width }"
              :title="`${size.sub} px`"
              @click="selectedWidth = size.width"
            >
              <span class="mm-sig__res-opt-label">{{ size.label }}</span>
              <span class="mm-sig__res-opt-sub">{{ size.sub }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="mm-sig__block">
        <div class="mm-eyebrow">02 · Grab it</div>
        <div
          v-for="row in shareRows"
          :key="row.key"
          class="mm-sig__share-row"
        >
          <span class="mm-sig__share-tag">{{ row.label }}</span>
          <input
            class="mm-sig__share-input"
            readonly
            :value="row.value"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <button
            type="button"
            class="mm-btn mm-btn--inline"
            :class="{ 'mm-sig__copy--ok': copyState[row.key] }"
            @click="copy(row.key, row.value)"
          >
            {{ copyState[row.key] ? 'Copied' : 'Copy' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mm-sig { padding: 24px 0 0; }

.mm-sig__head { padding-bottom: 8px; }
.mm-sig__title { margin: 6px 0 8px; }

.mm-sig__sub {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
  margin: 0;
  max-width: 580px;
}

.mm-sig__preview { margin-top: 18px; }

.mm-sig__frame {
  position: relative;
  border: 1px solid var(--mm-rule-strong);
  background: var(--mm-bg-soft);
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.mm-sig__img {
  display: block;
  max-width: 100%;
  height: auto;
  transition: opacity 0.2s ease;
}

.mm-sig__img.is-loading { opacity: 0; }

.mm-sig__loader {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--mm-bg-soft);
}

.mm-sig__preview-meta {
  margin-top: 10px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.mm-sig__controls {
  margin-top: 24px;
  display: grid;
  gap: 24px;
}

.mm-sig__block { display: flex; flex-direction: column; gap: 10px; }

.mm-sig__styles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.mm-sig__style {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 12px 14px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.mm-sig__style:hover {
  border-color: var(--mm-ink);
  background: var(--mm-bg-soft);
}

.mm-sig__style.is-active {
  border-color: var(--mm-ink);
  background: var(--mm-ink);
  color: var(--mm-bg);
}

.mm-sig__style-label {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
}

.mm-sig__style-sub {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sig__style.is-active .mm-sig__style-sub { color: var(--mm-bg-mute); }

.mm-sig__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.mm-sig__toggle-track {
  position: relative;
  width: 34px;
  height: 18px;
  border-radius: 9px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  transition: background-color 0.14s ease, border-color 0.14s ease;
  flex-shrink: 0;
}

.mm-sig__toggle-track.is-on {
  background: var(--mm-accent);
  border-color: var(--mm-accent);
}

.mm-sig__toggle-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--mm-ink);
  transition: transform 0.14s ease;
}

.mm-sig__toggle-track.is-on .mm-sig__toggle-thumb { transform: translateX(16px); }

.mm-sig__toggle-label {
  font-family: var(--mm-font-display);
  font-size: 13px;
  color: var(--mm-ink-soft);
}

.mm-sig__res {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}

.mm-sig__res-label {
  font-family: var(--mm-font-display);
  font-size: 13px;
  color: var(--mm-ink-soft);
}

.mm-sig__res-opts { display: flex; gap: 8px; }

.mm-sig__res-opt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 6px 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.mm-sig__res-opt:hover {
  border-color: var(--mm-ink);
  background: var(--mm-bg-soft);
}

.mm-sig__res-opt.is-active {
  border-color: var(--mm-ink);
  background: var(--mm-ink);
  color: var(--mm-bg);
}

.mm-sig__res-opt-label {
  font-family: var(--mm-font-display);
  font-size: 13px;
  font-weight: 500;
}

.mm-sig__res-opt-sub {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sig__res-opt.is-active .mm-sig__res-opt-sub { color: var(--mm-bg-mute); }

.mm-sig__share-row {
  display: grid;
  grid-template-columns: 88px 1fr auto;
  align-items: center;
  gap: 10px;
}

.mm-sig__share-tag {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sig__share-input {
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  padding: 7px 10px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-sig__share-input:focus { outline: 0; border-color: var(--mm-ink); }

.mm-sig__copy--ok {
  border-color: var(--mm-success) !important;
  color: var(--mm-success) !important;
}

@media (max-width: 720px) {
  .mm-sig__styles { grid-template-columns: repeat(2, 1fr); }
  .mm-sig__share-row { grid-template-columns: 1fr auto; }
  .mm-sig__share-tag { grid-column: 1 / -1; }
}
</style>
