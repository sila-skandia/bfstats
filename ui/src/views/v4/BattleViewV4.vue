<script setup lang="ts">
/**
 * BattleView: how to install the two round recorders, the BF42++ client
 * recorder and the server recorder, and where their recordings go.
 * Linked from the header on every page (features/battleview-install-page).
 */
import { ref } from 'vue'
import heroShot from '@/assets/battleview/battleaxe-dogfight.jpg'

const CLIENT_RELEASE = 'https://github.com/sila-skandia/bf42plus/releases/tag/v2.0-round-replay'
const SERVER_RELEASE = 'https://github.com/sila-skandia/bfstats/releases/tag/recorder-v0.1.0'
const SERVER_GUIDE = 'https://github.com/sila-skandia/bfstats/blob/main/features/server-replay-recorder/INSTALL.md'
const REPLAY_SITE = 'https://replay.bfstats.io'
const HERO_RECORDING = 'https://replay.bfstats.io/ymdy248edr'

const SERVER_BUILD_SHA = '18237721d2bd92f7bd01902d127cfcb8771b62eea1813ae67de638462e55b2e6'

const snippets = {
  client: 'plus.recordReplays 1',
  preload: 'LD_PRELOAD=/path/recorder.so ./bf1942_lnxded +config ServerSettings.con +statusMonitor 0 +dedicated 1',
  recorderCon: 'recordReplays 1\nreplaySampleHz 30',
}
type SnippetKey = keyof typeof snippets

const copied = ref<SnippetKey | null>(null)
let copiedTimer: number | undefined

const copy = async (key: SnippetKey) => {
  try {
    await navigator.clipboard.writeText(snippets[key])
    copied.value = key
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copied.value = null }, 1600)
  } catch {
    /* clipboard blocked: the text is still selectable */
  }
}
</script>

<template>
  <div class="mm-container mm-section bv">
    <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">Round recorder</div>
    <h1 class="mm-display">Try BattleView</h1>
    <p class="bv__lede">
      The Battlefield 1942 3D recorder. Record a round, then watch it back from any angle in your browser.
    </p>

    <a :href="HERO_RECORDING" class="bv-hero" target="_blank" rel="noopener">
      <img
        :src="heroShot"
        alt="A Spitfire chasing a Bf 109 over the desert, from a recorded round of Operation Battleaxe"
        class="bv-hero__img"
        width="640"
        height="360"
      >
      <span class="bv-hero__play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      </span>
      <span class="bv-hero__caption">
        <span class="bv-hero__title">Operation Battleaxe on MoonGamers.com</span>
        <span class="bv-hero__meta">Recorded with BF42++ · 30 min · Watch the round</span>
      </span>
    </a>

    <div class="bv__grid">
      <section class="bv-card" aria-labelledby="bv-client">
        <div class="bv-card__kicker">For players</div>
        <h2 id="bv-client" class="bv-card__title">BF42++ gameplay recorder</h2>
        <p>
          Try BF42++ with the gameplay recorder. If you've seen the BF2 recorder and replayer, it's very similar.
        </p>
        <a :href="CLIENT_RELEASE" class="bv-download" target="_blank" rel="noopener">
          <i class="pi pi-download" aria-hidden="true" />
          <span>Download BF42++ v2.0</span>
        </a>

        <ol class="bv-steps">
          <li>
            <span class="bv-steps__head">Install</span>
            Put <code>dsound.dll</code> from the release in your Battlefield 1942 folder, next to <code>BF1942.exe</code>.
          </li>
          <li>
            <span class="bv-steps__head">Turn it on</span>
            Open the console in game and type:
            <div class="bv-code">
              <pre><code>{{ snippets.client }}</code></pre>
              <button type="button" class="bv-code__copy" @click="copy('client')">
                {{ copied === 'client' ? 'Copied' : 'Copy' }}
              </button>
            </div>
            It stays on until you set it to 0.
          </li>
          <li>
            <span class="bv-steps__head">Share it</span>
            Each round is saved to the <code>replays</code> folder in the game folder. Upload your recordings to
            <a :href="REPLAY_SITE" target="_blank" rel="noopener">replay.bfstats.io</a>, or watch them locally without
            uploading (but where's the fun in that for everyone else).
          </li>
        </ol>
      </section>

      <section class="bv-card" aria-labelledby="bv-server">
        <div class="bv-card__kicker">For server admins</div>
        <h2 id="bv-server" class="bv-card__title">Server recorder</h2>
        <p>
          The server recorder records gameplay captured at the server, giving full battlefield coverage. BF42++ only
          records the player's field of view.
        </p>
        <a :href="SERVER_RELEASE" class="bv-download" target="_blank" rel="noopener">
          <i class="pi pi-download" aria-hidden="true" />
          <span>Download the server recorder v0.1.0</span>
        </a>

        <ol class="bv-steps">
          <li>
            <span class="bv-steps__head">Preload it</span>
            Run the Linux server with <code>recorder.so</code> preloaded. AI is your best friend here if your server
            starts from systemd or BFSMD, but the server has to run with <code>LD_PRELOAD=/path/recorder.so</code>:
            <div class="bv-code">
              <pre><code>{{ snippets.preload }}</code></pre>
              <button type="button" class="bv-code__copy" @click="copy('preload')">
                {{ copied === 'preload' ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </li>
          <li>
            <span class="bv-steps__head">Turn it on</span>
            Drop a new <code>recorder.con</code> file at the root of the server installation with these two lines:
            <div class="bv-code">
              <pre><code>{{ snippets.recorderCon }}</code></pre>
              <button type="button" class="bv-code__copy" @click="copy('recorderCon')">
                {{ copied === 'recorderCon' ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </li>
          <li>
            <span class="bv-steps__head">Share it</span>
            Files are stored as ndjson <strong>on your server</strong>, in its <code>replays</code> folder, and don't
            leave the server unless you upload them to
            <a :href="REPLAY_SITE" target="_blank" rel="noopener">replay.bfstats.io</a>.
          </li>
        </ol>

        <p class="bv-note">
          The recorder is built for one server binary, <code>bf1942_lnxded.static</code> with sha256
          <code class="bv-note__hash">{{ SERVER_BUILD_SHA }}</code>. On any other build the recordings are partial.
          The <a :href="SERVER_GUIDE" target="_blank" rel="noopener">full install guide</a> has systemd and BFSMD setups,
          and how to check it's recording.
        </p>
      </section>
    </div>

    <p class="bv__disclaimer">
      This is a community tool, and is not affiliated with EA or DICE. Not that they'd care, given the game is
      abandonware at this point.
    </p>
  </div>
</template>

<style scoped>
.bv__lede {
  margin: 14px 0 0;
  max-width: 60ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
}

/* ---------- hero recording ---------- */

.bv-hero {
  position: relative;
  display: block;
  margin-top: 28px;
  max-width: 880px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
}
.bv-hero:hover { color: var(--mm-ink); border-color: var(--mm-rule-strong); }

.bv-hero__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s ease, filter 0.3s ease;
}
.bv-hero:hover .bv-hero__img { transform: scale(1.02); filter: brightness(1.06); }

.bv-hero__play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 60px;
  height: 60px;
  margin: -30px 0 0 -30px;
  display: grid;
  place-items: center;
  padding-left: 3px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mm-bg) 62%, transparent);
  border: 1px solid color-mix(in srgb, var(--mm-ink) 35%, transparent);
  backdrop-filter: blur(4px);
  transition: background 0.2s ease, transform 0.2s ease;
}
.bv-hero:hover .bv-hero__play {
  background: var(--mm-accent);
  transform: scale(1.06);
}

.bv-hero__caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 36px 18px 14px;
  background: linear-gradient(to top, color-mix(in srgb, var(--mm-bg) 88%, transparent), transparent);
}
.bv-hero__title {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
}
.bv-hero__meta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

/* ---------- the two recorders ---------- */

.bv__grid {
  margin-top: 32px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 981px) {
  .bv__grid { grid-template-columns: 1fr 1fr; }
}

.bv-card {
  min-width: 0;
  padding: 22px 22px 18px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-top: 2px solid var(--mm-accent);
  color: var(--mm-ink-soft);
  font-size: 14.5px;
  line-height: 1.65;
}
.bv-card p { margin: 0 0 14px; }

.bv-card__kicker {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-accent-soft);
}
.bv-card__title {
  margin: 6px 0 12px;
  font-family: var(--mm-font-display);
  font-size: 22px;
  font-weight: 400;
  letter-spacing: -0.01em;
  color: var(--mm-ink);
}

.bv-card code {
  font-family: var(--mm-font-mono);
  font-size: 0.88em;
  color: var(--mm-ink);
  background: var(--mm-bg-mute);
  padding: 1px 5px;
  border-radius: 2px;
}
.bv-card strong { color: var(--mm-ink); font-weight: 500; }
.bv-card a:not(.bv-download) {
  color: var(--mm-accent-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.bv-card a:not(.bv-download):hover { color: var(--mm-ink); }

.bv-download {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 9px 14px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  font-weight: 500;
  transition: filter 0.15s ease;
}
.bv-download:hover { color: var(--mm-highlight-ink); filter: brightness(1.12); }

.bv-steps {
  list-style: none;
  counter-reset: bv-step;
  margin: 20px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.bv-steps > li {
  counter-increment: bv-step;
  position: relative;
  padding-left: 36px;
}
.bv-steps > li::before {
  content: counter(bv-step, decimal-leading-zero);
  position: absolute;
  left: 0;
  top: 1px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  color: var(--mm-accent-soft);
}
.bv-steps__head {
  display: block;
  font-family: var(--mm-font-display);
  font-weight: 500;
  color: var(--mm-ink);
}

.bv-code {
  position: relative;
  margin: 8px 0;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
}
.bv-code pre {
  margin: 0;
  padding: 10px 70px 10px 12px;
  overflow-x: auto;
}
.bv-code pre code {
  background: none;
  padding: 0;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre;
}
.bv-code__copy {
  position: absolute;
  top: 6px;
  right: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  padding: 3px 8px;
  cursor: pointer;
}
.bv-code__copy:hover { color: var(--mm-ink); border-color: var(--mm-ink-muted); }

.bv-note {
  margin: 18px 0 0 !important;
  padding-top: 14px;
  border-top: 1px solid var(--mm-rule);
  font-size: 13px;
  color: var(--mm-ink-muted);
}
.bv-note__hash { word-break: break-all; }

.bv__disclaimer {
  margin: 28px 0 0;
  max-width: 70ch;
  font-size: 13px;
  line-height: 1.6;
  color: var(--mm-ink-muted);
}

@media (max-width: 640px) {
  .bv-card { padding: 18px 16px 16px; }
  .bv-hero__play { width: 48px; height: 48px; margin: -24px 0 0 -24px; }
}
</style>
