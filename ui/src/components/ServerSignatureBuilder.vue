<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';

type BannerStyle = 'grid' | 'hud' | 'scanline' | 'circuit';

interface Props {
  serverName: string;
}

const props = defineProps<Props>();

const styles: { id: BannerStyle; label: string; sub: string }[] = [
  { id: 'grid', label: 'GRID', sub: 'Blueprint schematic' },
  { id: 'hud', label: 'HUD', sub: 'Aircraft instrument readout' },
  { id: 'scanline', label: 'SCANLINE', sub: 'CRT terminal glow' },
  { id: 'circuit', label: 'CIRCUIT', sub: 'PCB trace pathways' }
];

const selectedStyle = ref<BannerStyle>('grid');
const copyState = ref<Record<string, boolean>>({});
const isPreviewLoading = ref(true);
// Cache-buster for the preview img — bumped on style change AND every refresh tick so
// the browser fetches a fresh frame instead of replaying the prior response.
const previewVersion = ref(Date.now());

// Live polling: refresh the preview every 30s so the visible player count keeps
// pace with reality without hammering the server. The shared URL is plain — anyone
// embedding it gets the no-store backend response on every load.
const REFRESH_INTERVAL_MS = 30_000;
const refreshTimer = window.setInterval(() => {
  previewVersion.value = Date.now();
}, REFRESH_INTERVAL_MS);
onUnmounted(() => clearInterval(refreshTimer));

const previewUrl = computed(() => buildUrl(true, previewVersion.value));
const shareUrl = computed(() => buildUrl(false));

watch(previewUrl, () => {
  isPreviewLoading.value = true;
});

const bbCode = computed(() => `[img]${shareUrl.value}[/img]`);
const htmlImg = computed(() => `<img src="${shareUrl.value}" alt="${props.serverName} live server status" />`);
const markdownImg = computed(() => `![${props.serverName}](${shareUrl.value})`);

function buildUrl(relative: boolean, cacheBust?: number): string {
  const params = new URLSearchParams();
  params.set('style', selectedStyle.value);
  // Cache-bust only the in-page preview — the shared URL stays clean for forums.
  if (cacheBust !== undefined) {
    params.set('_t', String(cacheBust));
  }
  const path = `/stats/servers/${encodeURIComponent(props.serverName)}/banner.png?${params.toString()}`;
  if (relative) return path;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${path}`;
}

async function copy(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copyState.value = { ...copyState.value, [key]: true };
    setTimeout(() => {
      copyState.value = { ...copyState.value, [key]: false };
    }, 1800);
  } catch (err) {
    console.error('Clipboard write failed', err);
  }
}
</script>

<template>
  <div class="sig-builder">
    <header class="sig-header">
      <div class="sig-eyebrow">
        <span
          class="sig-dot"
          aria-hidden="true"
        />
        SERVER SIGNATURE //
        <span class="sig-eyebrow-accent">Live status banner</span>
      </div>
      <h2 class="sig-title">
        Mint a live server beacon for your forum sig
      </h2>
      <p class="sig-subtitle">
        Pick a backdrop, then grab the BBCode. The banner regenerates on every load —
        player count, current map, and game mode stay live without caching.
      </p>
    </header>

    <section class="sig-preview-card">
      <div class="sig-preview-frame">
        <img
          :src="previewUrl"
          :alt="`${serverName} live server signature preview`"
          class="sig-preview-img"
          :class="{ 'sig-preview-img--loading': isPreviewLoading }"
          @load="isPreviewLoading = false"
          @error="isPreviewLoading = false"
        >
        <div
          v-if="isPreviewLoading"
          class="sig-preview-loader"
          role="status"
          aria-live="polite"
        >
          <div
            class="sig-spinner"
            aria-hidden="true"
          />
          <span class="sig-loader-label">Rendering banner…</span>
        </div>
      </div>
      <div class="sig-preview-meta">
        <span class="sig-meta-pill">{{ selectedStyle.toUpperCase() }}</span>
        <span class="sig-meta-pill sig-meta-pill--muted">960 × 200 · PNG</span>
        <span class="sig-meta-pill sig-meta-pill--live">LIVE · NO CACHE</span>
      </div>
    </section>

    <section class="sig-controls">
      <div class="sig-control-block">
        <label class="sig-control-label">01 — STYLE</label>
        <div class="sig-style-grid">
          <button
            v-for="style in styles"
            :key="style.id"
            type="button"
            class="sig-style-card"
            :class="{ 'sig-style-card--active': selectedStyle === style.id }"
            @click="selectedStyle = style.id"
          >
            <span class="sig-style-card-label">{{ style.label }}</span>
            <span class="sig-style-card-sub">{{ style.sub }}</span>
          </button>
        </div>
      </div>
    </section>

    <section class="sig-share">
      <div class="sig-control-block">
        <label class="sig-control-label">02 — GRAB IT</label>
        <div class="sig-share-row">
          <div class="sig-share-tag">
            BBCode
          </div>
          <input
            class="sig-share-input"
            readonly
            :value="bbCode"
            @focus="($event.target as HTMLInputElement).select()"
          >
          <button
            type="button"
            class="sig-copy-btn"
            :class="{ 'sig-copy-btn--ok': copyState.bb }"
            @click="copy('bb', bbCode)"
          >
            {{ copyState.bb ? 'COPIED' : 'COPY' }}
          </button>
        </div>
        <div class="sig-share-row">
          <div class="sig-share-tag">
            HTML
          </div>
          <input
            class="sig-share-input"
            readonly
            :value="htmlImg"
            @focus="($event.target as HTMLInputElement).select()"
          >
          <button
            type="button"
            class="sig-copy-btn"
            :class="{ 'sig-copy-btn--ok': copyState.html }"
            @click="copy('html', htmlImg)"
          >
            {{ copyState.html ? 'COPIED' : 'COPY' }}
          </button>
        </div>
        <div class="sig-share-row">
          <div class="sig-share-tag">
            Markdown
          </div>
          <input
            class="sig-share-input"
            readonly
            :value="markdownImg"
            @focus="($event.target as HTMLInputElement).select()"
          >
          <button
            type="button"
            class="sig-copy-btn"
            :class="{ 'sig-copy-btn--ok': copyState.md }"
            @click="copy('md', markdownImg)"
          >
            {{ copyState.md ? 'COPIED' : 'COPY' }}
          </button>
        </div>
        <div class="sig-share-row">
          <div class="sig-share-tag">
            URL
          </div>
          <input
            class="sig-share-input"
            readonly
            :value="shareUrl"
            @focus="($event.target as HTMLInputElement).select()"
          >
          <button
            type="button"
            class="sig-copy-btn"
            :class="{ 'sig-copy-btn--ok': copyState.url }"
            @click="copy('url', shareUrl)"
          >
            {{ copyState.url ? 'COPIED' : 'COPY' }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sig-builder {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  padding: 1.5rem;
  border: 1px solid rgba(255, 196, 0, 0.35);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 196, 0, 0.06) 0%, rgba(22, 27, 34, 0.0) 60%),
    rgba(13, 17, 23, 0.6);
  box-shadow: 0 0 24px rgba(255, 196, 0, 0.08), inset 0 1px 0 rgba(255, 196, 0, 0.18);
  position: relative;
}

.sig-builder::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 12%;
  right: 12%;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(255, 196, 0, 0.7), transparent);
  pointer-events: none;
}

.sig-header {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.sig-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--text-secondary, #8b949e);
  text-transform: uppercase;
}

.sig-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: #3ddc84;
  box-shadow: 0 0 8px rgba(61, 220, 132, 0.7);
  animation: sig-pulse 1.6s ease-in-out infinite;
}

@keyframes sig-pulse {
  0%, 100% { opacity: 0.75; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}

.sig-eyebrow-accent {
  color: #ffc400;
  margin-left: 0.25rem;
}

.sig-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.01em;
  color: var(--text-primary, #e6edf3);
}

.sig-subtitle {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-secondary, #8b949e);
  max-width: 60ch;
}

.sig-preview-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sig-preview-frame {
  position: relative;
  width: 100%;
  min-height: 140px;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 196, 0, 0.25);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
}

.sig-preview-img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 220px;
  object-fit: contain;
  transition: opacity 0.2s ease;
}

.sig-preview-img--loading {
  opacity: 0.25;
}

.sig-preview-loader {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  background: rgba(13, 17, 23, 0.55);
  backdrop-filter: blur(2px);
}

.sig-spinner {
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  border: 2px solid rgba(255, 196, 0, 0.25);
  border-top-color: #ffc400;
  animation: sig-spin 0.85s linear infinite;
}

@keyframes sig-spin {
  to { transform: rotate(360deg); }
}

.sig-loader-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #ffc400;
}

.sig-preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.sig-meta-pill {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: rgba(255, 196, 0, 0.12);
  color: #ffc400;
  border: 1px solid rgba(255, 196, 0, 0.4);
}

.sig-meta-pill--muted {
  background: rgba(139, 148, 158, 0.1);
  color: var(--text-secondary, #8b949e);
  border-color: rgba(139, 148, 158, 0.3);
}

.sig-meta-pill--live {
  background: rgba(61, 220, 132, 0.12);
  color: #3ddc84;
  border-color: rgba(61, 220, 132, 0.45);
}

.sig-controls {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

.sig-control-block {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.sig-control-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #ffc400;
}

.sig-style-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}

@media (min-width: 720px) {
  .sig-style-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.sig-style-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.7rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #30363d);
  background: rgba(22, 27, 34, 0.6);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s, background 0.18s, transform 0.15s;
  color: var(--text-primary, #e6edf3);
}

.sig-style-card:hover {
  border-color: rgba(255, 196, 0, 0.5);
  background: rgba(255, 196, 0, 0.05);
}

.sig-style-card--active {
  border-color: #ffc400;
  background: rgba(255, 196, 0, 0.12);
  box-shadow: 0 0 14px rgba(255, 196, 0, 0.25);
}

.sig-style-card-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.sig-style-card-sub {
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  letter-spacing: 0.02em;
}

.sig-share {
  display: flex;
  flex-direction: column;
}

.sig-share-row {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 0.5rem;
  align-items: stretch;
  margin-top: 0.5rem;
}

.sig-share-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #ffc400;
  border: 1px solid rgba(255, 196, 0, 0.4);
  background: rgba(255, 196, 0, 0.06);
  border-radius: 6px;
  padding: 0 0.6rem;
}

.sig-share-input {
  flex: 1;
  min-width: 0;
  background: rgba(22, 27, 34, 0.85);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  color: var(--text-primary, #e6edf3);
  padding: 0.55rem 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  text-overflow: ellipsis;
}

.sig-share-input:focus {
  outline: none;
  border-color: rgba(255, 196, 0, 0.6);
}

.sig-copy-btn {
  background: #ffc400;
  color: #161b22;
  border: 0;
  border-radius: 6px;
  padding: 0 0.9rem;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: background 0.18s, transform 0.12s;
  min-width: 78px;
}

.sig-copy-btn:hover { background: #ffd84a; }
.sig-copy-btn:active { transform: scale(0.97); }

.sig-copy-btn--ok {
  background: var(--neon-green, #3ddc84);
  color: #0d1117;
}

@media (max-width: 720px) {
  .sig-share-row {
    grid-template-columns: 1fr;
  }
  .sig-share-tag {
    justify-content: flex-start;
    padding: 0.35rem 0.6rem;
  }
  .sig-builder { padding: 1rem; }
}
</style>
