<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type BannerStyle = 'tank' | 'plane' | 'island' | 'map'

interface BannerServer {
  serverGuid: string
  serverName: string
  totalMinutes: number
}

interface Props {
  playerName: string
  servers: BannerServer[]
}

const props = defineProps<Props>()

const styles: { id: BannerStyle; label: string; sub: string }[] = [
  { id: 'tank', label: 'Panzer', sub: 'Eastern Front snowfields' },
  { id: 'plane', label: 'Spitfire', sub: 'Battle of Britain skies' },
  { id: 'island', label: 'Pacific', sub: 'Sunset naval theater' },
  { id: 'map', label: 'Strategy', sub: 'D-Day tactical map' },
]

const selectedStyle = ref<BannerStyle>('tank')
const selectedServerGuid = ref<string>('')
const copyState = ref<Record<string, boolean>>({})
const isPreviewLoading = ref(true)

const sortedServers = computed(() =>
  [...props.servers].sort((a, b) => b.totalMinutes - a.totalMinutes),
)

const previewUrl = computed(() => buildUrl(true))
const shareUrl = computed(() => buildUrl(false))

watch(previewUrl, () => { isPreviewLoading.value = true })

const bbCode = computed(() => `[img]${shareUrl.value}[/img]`)
const htmlImg = computed(() => `<img src="${shareUrl.value}" alt="${props.playerName} stats banner" />`)
const markdownImg = computed(() => `![${props.playerName}](${shareUrl.value})`)

function buildUrl(relative: boolean): string {
  const params = new URLSearchParams()
  params.set('style', selectedStyle.value)
  if (selectedServerGuid.value) params.set('server', selectedServerGuid.value)
  const path = `/stats/players/${encodeURIComponent(props.playerName)}/banner.png?${params.toString()}`
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

const selectedServerLabel = computed(() => {
  if (!selectedServerGuid.value) return 'Lifetime profile · all servers'
  const match = sortedServers.value.find(s => s.serverGuid === selectedServerGuid.value)
  return match?.serverName ?? 'Server'
})

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
      <div class="mm-eyebrow mm-eyebrow--strong">Forum signature</div>
      <h2 class="mm-h2 mm-sig__title">Mint a banner for your forum sig</h2>
      <p class="mm-sig__sub">
        Pick a backdrop, choose a server (or your lifetime profile), and grab the markup.
        Your banner regenerates as your stats climb.
      </p>
    </header>

    <hr class="mm-rule" />

    <div class="mm-sig__preview">
      <div class="mm-sig__frame">
        <img
          :src="previewUrl"
          :alt="`${$pn(playerName)} signature preview`"
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
        <span class="mm-eyebrow">720 × auto · PNG · cached 1h</span>
        <span class="mm-eyebrow">{{ selectedServerLabel }}</span>
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
      </div>

      <div class="mm-sig__block">
        <label for="mm-sig-server" class="mm-eyebrow">02 · Server filter</label>
        <select
          id="mm-sig-server"
          v-model="selectedServerGuid"
          class="mm-sig__select"
        >
          <option value="">Lifetime profile · all servers</option>
          <option v-for="server in sortedServers" :key="server.serverGuid" :value="server.serverGuid">
            {{ server.serverName }}
          </option>
        </select>
        <p class="mm-card__hint" style="margin-top: 4px">
          Stats reflect kills, score, K/D and play hours scoped to your selection.
        </p>
      </div>

      <div class="mm-sig__block">
        <div class="mm-eyebrow">03 · Grab it</div>
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
.mm-sig {
  padding: 24px 0 0;
}

.mm-sig__head {
  padding-bottom: 8px;
}

.mm-sig__title {
  margin: 6px 0 8px;
}

.mm-sig__sub {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
  margin: 0;
  max-width: 580px;
}

.mm-sig__preview {
  margin-top: 18px;
}

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

.mm-sig__img.is-loading {
  opacity: 0;
}

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

.mm-sig__block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

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

.mm-sig__style.is-active .mm-sig__style-sub {
  color: var(--mm-bg-mute);
}

.mm-sig__select {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  padding: 8px 10px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  width: 100%;
  max-width: 480px;
}

.mm-sig__select:focus {
  outline: 0;
  border-color: var(--mm-ink);
}

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

.mm-sig__share-input:focus {
  outline: 0;
  border-color: var(--mm-ink);
}

.mm-sig__copy--ok {
  border-color: var(--mm-success) !important;
  color: var(--mm-success) !important;
}

@media (max-width: 720px) {
  .mm-sig__styles {
    grid-template-columns: repeat(2, 1fr);
  }
  .mm-sig__share-row {
    grid-template-columns: 1fr auto;
  }
  .mm-sig__share-tag {
    grid-column: 1 / -1;
  }
}
</style>
