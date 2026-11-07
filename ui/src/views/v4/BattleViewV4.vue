<script setup lang="ts">
/**
 * BattleView: how to install the two round recorders, the BF42++ client
 * recorder and the server recorder, and where their recordings go.
 * Linked from the header on every page (features/battleview-install-page).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  feedHref,
  fetchRecordings,
  levelName,
  recordingWatchHref,
  watchHref,
  type RecordingSummary,
} from '@/services/recordingsService'
import { formatLocalTooltip, formatRelativeTime } from '@/utils/timeUtils'
import MmShortsStrip from '@/components/v4/MmShortsStrip.vue'
import MmArticleHero from '@/components/v4/article/MmArticleHero.vue'
import MmCodeBlock from '@/components/v4/article/MmCodeBlock.vue'
import MmLightbox from '@/components/v4/article/MmLightbox.vue'
import MmMediaFrame from '@/components/v4/article/MmMediaFrame.vue'
import type { ArticleMedia as Media } from '@/components/v4/article/media'
import heroShot from '@/assets/battleview/battleaxe-dogfight.jpg'
import bulletChase from '@/assets/battleview/bullet-chase.mp4'
import bulletChasePoster from '@/assets/battleview/bullet-chase-poster.jpg'
import shermanKill from '@/assets/battleview/sherman-kill.mp4'
import shermanKillPoster from '@/assets/battleview/sherman-kill-poster.jpg'
import accuracyBoard from '@/assets/battleview/accuracy-board.jpg'
import cinematic1 from '@/assets/battleview/cinematic-1.jpg'
import cinematic2 from '@/assets/battleview/cinematic-2.jpg'
import cinematic3 from '@/assets/battleview/cinematic-3.jpg'

const chaseClip: Media = {
  kind: 'video',
  src: bulletChase,
  poster: bulletChasePoster,
  alt: 'A rifle round chased in slow motion across the fields of Bocage to the soldier it hits',
}
const accuracyShot: Media = {
  kind: 'img',
  src: accuracyBoard,
  alt: "The Accuracy board mid-round: every player's rounds fired, hits and accuracy, with one player's accuracy graphed through the round",
  width: 1600,
  height: 900,
}
const shermanClip: Media = {
  kind: 'video',
  src: shermanKill,
  poster: shermanKillPoster,
  alt: 'A Sherman round chased down a snowy road on Meuse River Line into a StuH42, which blows apart',
}
const clips = [
  { media: shermanClip, title: 'Tank kill', caption: 'A Sherman 76 mm round chased into a StuH42 on Meuse River Line.' },
  { media: chaseClip, title: 'Bullet chase', caption: 'A 341 m sniper round, followed from the muzzle in bullet time.' },
]
const cinematicShots: Media[] = [
  { kind: 'img', src: cinematic1, width: 1200, height: 502, alt: 'Kill of the round: a rifleman firing from a windmill window, letterboxed' },
  { kind: 'img', src: cinematic2, width: 1200, height: 502, alt: 'The round in flight past the windmill on Bocage' },
  { kind: 'img', src: cinematic3, width: 1200, height: 502, alt: 'The round finding its target by the sandbags' },
]

// Any image or clip opens full screen.
const lightbox = ref<Media | null>(null)
const open = (m: Media) => { lightbox.value = m }

// BF42++ for players is one file: the button downloads dsound.dll itself rather
// than opening the release, whose source archives only muddied which file to take.
// Moves with LATEST in tools/bf1942-models/viewer/recorder-update.js, which tells an
// uploader whose recording came from an older build to update
// (features/recorder-update-notice; test_recorder_update.py holds them together).
const CLIENT_TAG = 'v2.0-round-replay'
const CLIENT_DLL = `https://github.com/sila-skandia/bf42plus/releases/download/${CLIENT_TAG}/dsound.dll`
const CLIENT_RELEASE = `https://github.com/sila-skandia/bf42plus/releases/tag/${CLIENT_TAG}`
const DISCORD_INVITE = 'https://discord.gg/6saqqTTYEM'
// The DLL needs Microsoft's C++ runtime; the 32-bit one, as the game is 32-bit.
const VC_REDIST = 'https://aka.ms/vs/17/release/vc_redist.x86.exe'
// The newest recorder-v* release. Moved with every tag the recorder workflow
// publishes (features/server-replay-recorder/README.md, "Releasing").
const SERVER_VERSION = 'v0.3.0'
const SERVER_RELEASE = `https://github.com/sila-skandia/bfstats/releases/tag/recorder-${SERVER_VERSION}`
const SERVER_GUIDE = 'https://github.com/sila-skandia/bfstats/blob/main/features/server-replay-recorder/INSTALL.md'
const SERVER_GUIDE_WINDOWS = `${SERVER_GUIDE}#windows-server`

// The server recorder's two builds: recorder.so for the Linux server,
// WINMM.dll for the Windows one.
type Os = 'linux' | 'windows'
const OSES: { id: Os; label: string }[] = [
  { id: 'linux', label: 'Linux server' },
  { id: 'windows', label: 'Windows server' },
]
const os = ref<Os>('linux')
// Straight to the feed and the viewer: replay.bfstats.io and its short links are for
// sharing, and each would cost a redirect before anything loads.
const REPLAY_SITE = feedHref({})
const HERO_RECORDING = recordingWatchHref({
  mod: 'bf1942',
  level: 'battleaxe',
  recordingUrl: '/stats/recordings/ymdy248edr.ndjson',
  serverLogUrl: null,
})

// Watch now opens the replays home; beside it, the newest shared round has its own link.
const latest = ref<RecordingSummary | null>(null)
const latestHref = computed(() => (latest.value ? watchHref(latest.value) : null))

// Install BattleView: down to the two recorders' instructions.
const install = ref<HTMLElement | null>(null)
function toInstall() {
  install.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
// The server card's "use BF42++" link: over to the player card.
function toClient() {
  document.getElementById('bv-client')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const abort = new AbortController()
onMounted(async () => {
  try {
    latest.value = (await fetchRecordings({ pageSize: 1 }, abort.signal)).items[0] ?? null
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) console.warn('battleview: latest recording', e)
  }
})
onBeforeUnmount(() => abort.abort())

const SERVER_BUILD_SHA = '18237721d2bd92f7bd01902d127cfcb8771b62eea1813ae67de638462e55b2e6'
const WINDOWS_EXE_MD5 = '1f75eb8b55ab5bb4d6782dd6f3be2e45'

const snippets = {
  client: 'plus.recordReplays 1',
  preload: 'LD_PRELOAD=/path/recorder.so ./bf1942_lnxded +config ServerSettings.con +statusMonitor 0 +dedicated 1',
  recorderCon: 'recordReplays 1\nreplaySampleHz 30',
  windowsLog: 'recorder: recording to replays/replay_1793658720.ndjson',
}
</script>

<template>
  <div class="mm-container mm-section bv">
    <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">Round recorder</div>
    <h1 class="mm-display">Try BattleView</h1>
    <p class="bv__lede">
      Better late than never! Battlefield recording has arrived in Battlefield 1942. Introducing the BattleView
      gameplay recorder.
    </p>
    <p class="bv__lede bv__lede--more">
      With BattleView, you can record your game with a simple command, then view it in your browser. Much more than a
      simple demo-recording system, BattleView lets you see the match from hundreds of different perspectives. With BattleView, you can also create unique movie scenes and view interesting
      statistics like player accuracy and bullet tracing.
    </p>

    <div class="bv-watch" data-testid="battleview-watch">
      <a :href="REPLAY_SITE" class="bv-watch__btn" target="_blank" rel="noopener" data-testid="battleview-watch-now">
        <span class="bv-watch__icon" aria-hidden="true"><i class="pi pi-play" /></span>
        <span>Watch now</span>
      </a>
      <div class="bv-watch__what">
        <template v-if="latest">
          <span class="bv-watch__label">Latest round</span>
          <a
            v-if="latestHref"
            :href="latestHref"
            class="bv-watch__title bv-watch__title--link"
            target="_blank"
            rel="noopener"
            data-testid="battleview-latest"
          >{{ latest.title }} <i class="pi pi-play" aria-hidden="true" /></a>
          <span class="bv-watch__meta">
            {{ levelName(latest.level) }} ·
            <span :title="formatLocalTooltip(latest.createdAt)">{{ formatRelativeTime(latest.createdAt) }}</span>
          </span>
        </template>
        <template v-else>
          <span class="bv-watch__label">In your browser</span>
          <span class="bv-watch__title">No install, no game: a recorded round plays right here</span>
        </template>
      </div>
      <a href="#bv-install" class="bv-watch__install" data-testid="battleview-install-link" @click.prevent="toInstall">
        Install BattleView <i class="pi pi-arrow-down" aria-hidden="true" />
      </a>
      <a
        :href="DISCORD_INVITE"
        class="bv-watch__discord"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="battleview-discord-top"
      >
        <i class="pi pi-discord" aria-hidden="true" /> Discord
      </a>
    </div>

    <MmArticleHero
      :href="HERO_RECORDING"
      :src="heroShot"
      alt="A Spitfire chasing a Bf 109 over the desert, from a recorded round of Operation Battleaxe"
      title="Operation Battleaxe on MoonGamers.com"
      meta="Recorded with BF42++ · 30 min · Watch the round"
    />

    <MmShortsStrip :count="6" :spacing="36" />

    <section class="bv-gallery" aria-labelledby="bv-gallery">
      <div class="mm-eyebrow" id="bv-gallery">Inside a recording</div>

      <div class="bv-gallery__pair">
        <figure v-for="clip in clips" :key="clip.media.src" class="mm-figure">
          <MmMediaFrame :media="clip.media" :label="clip.title" @open="open" />
          <figcaption>
            <span class="mm-figure__label">{{ clip.title }}</span>
            {{ clip.caption }}
          </figcaption>
        </figure>
      </div>

      <figure class="mm-figure bv-shot--spaced">
        <MmMediaFrame :media="accuracyShot" label="Accuracy, mid-round" @open="open" />
        <figcaption>
          <span class="mm-figure__label">Accuracy, mid-round</span>
          Rounds fired, hits, weapons and ranges for every player, as the round plays.
        </figcaption>
      </figure>

      <figure class="mm-figure bv-shot--spaced">
        <div class="bv-cine">
          <MmMediaFrame
            v-for="(shot, i) in cinematicShots"
            :key="shot.src"
            :media="shot"
            :label="`cinematic still ${i + 1}`"
            aspect="wide"
            @open="open"
          />
        </div>
        <figcaption>
          <span class="mm-figure__label">Cinematic</span>
          Cut any kill into a graded, letterboxed clip in the creator studio, then save it as a video.
        </figcaption>
      </figure>
    </section>

    <section id="bv-install" ref="install" class="bv-install" aria-labelledby="bv-install-title">
      <div class="mm-eyebrow" id="bv-install-title">Install BattleView</div>
      <p class="bv-pick" data-testid="battleview-pick">
        <strong>Playing?</strong> You want BF42++: one file in your game folder that records the rounds you play.
        <strong>Running a dedicated server?</strong> The server recorder goes on the server and records everyone on it.
        Players don't need it.
      </p>

      <div class="bv__grid">
        <section class="mm-article-card mm-prose" aria-labelledby="bv-client" data-testid="battleview-client-card">
          <div class="mm-article-card__kicker">For players</div>
          <h2 id="bv-client" class="mm-article-card__title">Record your gameplay</h2>
          <p>
            BF42++ records the rounds you play, from your own game, on any server. If you've seen the BF2 recorder and
            replayer, it's very similar.
          </p>
          <div class="bv-dl">
            <a :href="CLIENT_DLL" class="mm-download" data-testid="battleview-client-download">
              <i class="pi pi-download" aria-hidden="true" />
              <span>Download dsound.dll</span>
            </a>
            <span class="bv-dl__meta">BF42++ 2.0-round-replay · the only file you need</span>
          </div>
          <p class="bv-only bv-update" data-testid="battleview-client-update">
            <i class="pi pi-refresh" aria-hidden="true" />
            <span>
              <strong>Already have BF42++?</strong> If you installed it before 18 October 2026, download it again and
              replace your <code>dsound.dll</code>. Older builds don't record crouching, lying down, firing or reloading on
              Forgotten Hope and other big mods, so soldiers stand upright and slide along the ground in the replay.
              <a :href="CLIENT_RELEASE" target="_blank" rel="noopener">What's new</a>.
            </span>
          </p>

          <ol class="mm-steps">
            <li>
              <span class="mm-steps__head">Install</span>
              Copy <code>dsound.dll</code> into your Battlefield 1942 folder, next to <code>BF1942.exe</code>, and start
              the game as usual. Already have a <code>dsound.dll</code> there, from an audio fix like DSOAL? Rename yours to
              <code>dsound_next.dll</code> first and BF42++ loads it for you.
            </li>
            <li>
              <span class="mm-steps__head">Turn it on</span>
              In game, press <code>~</code> (the key below Esc) to open the console, and type:
              <MmCodeBlock :code="snippets.client" />
              It's saved, so it stays on until you set it to 0.
            </li>
            <li>
              <span class="mm-steps__head">Share it</span>
              Each round is saved to the <code>replays</code> folder in the game folder. Upload your recordings to
              <a :href="REPLAY_SITE" target="_blank" rel="noopener">replay.bfstats.io</a>, or watch them locally without
              uploading (but where's the fun in that for everyone else). Stuck? Ask in
              <a :href="DISCORD_INVITE" target="_blank" rel="noopener noreferrer">our Discord</a>.
            </li>
          </ol>

          <div class="bv-why" data-testid="battleview-client-why">
            <h3 class="bv-why__title">Why dsound.dll?</h3>
            <p>
              <code>dsound.dll</code> is DirectSound, the part of Windows that plays the game's sound.
              <code>BF1942.exe</code> loads it every time it starts, and Windows looks in the game's own folder before
              its system folder. So a file named <code>dsound.dll</code> next to <code>BF1942.exe</code> gets loaded and
              run by the game.
            </p>
            <p>
              BF42++ uses that to hook into the game. It hands every sound call on to the real DirectSound, so your audio
              works as before, and from inside the game it records the round. That's also why an existing
              <code>dsound.dll</code> becomes <code>dsound_next.dll</code>: BF42++ passes the sound to that file
              instead of to Windows'.
            </p>
          </div>

          <p class="bv-note" data-testid="battleview-client-help">
            Game won't start, with an error about <code>MSVCP140.dll</code>? Install Microsoft's
            <a :href="VC_REDIST" rel="noopener">Visual C++ runtime (x86)</a>, the 32-bit one even on 64-bit Windows. On
            Wine, add <code>dsound</code> to the DLL overrides in <code>winecfg</code>. To remove BF42++, delete
            <code>dsound.dll</code>.
          </p>
        </section>

        <section class="mm-article-card mm-prose" aria-labelledby="bv-server" data-testid="battleview-server-card">
          <div class="mm-article-card__kicker">For server admins only</div>
          <h2 id="bv-server" class="mm-article-card__title">Record your server</h2>
          <p>
            The server recorder runs inside a dedicated server and records the whole battlefield. BF42++ records what one
            player sees.
          </p>
          <p class="bv-only" data-testid="battleview-server-only">
            <i class="pi pi-info-circle" aria-hidden="true" />
            <span>
              Not for players. These files go next to the server's own program, not in your game folder, where they record
              nothing. To record your own games, use <a href="#bv-client" @click.prevent="toClient">BF42++</a>.
            </span>
          </p>
          <a :href="SERVER_RELEASE" class="mm-download" target="_blank" rel="noopener">
            <i class="pi pi-download" aria-hidden="true" />
            <span>Download the server recorder {{ SERVER_VERSION }}</span>
          </a>

          <div class="mm-subtabs bv-os" role="tablist" aria-label="Server platform">
            <button
              v-for="o in OSES"
              :id="`bv-os-${o.id}`"
              :key="o.id"
              type="button"
              role="tab"
              class="mm-subtab"
              :class="{ 'mm-subtab--active': os === o.id }"
              :aria-selected="os === o.id"
              :aria-controls="`bv-os-panel-${o.id}`"
              :data-testid="`battleview-os-${o.id}`"
              @click="os = o.id"
            >
              {{ o.label }}
            </button>
          </div>

          <div v-if="os === 'linux'" id="bv-os-panel-linux" role="tabpanel" aria-labelledby="bv-os-linux">
            <ol class="mm-steps">
              <li>
                <span class="mm-steps__head">Preload it</span>
                Run the Linux server with <code>recorder.so</code> preloaded. AI is your best friend here if your server
                starts from systemd or BFSMD, but the server has to run with <code>LD_PRELOAD=/path/recorder.so</code>:
                <MmCodeBlock :code="snippets.preload" />
              </li>
              <li>
                <span class="mm-steps__head">Turn it on</span>
                Drop a new <code>recorder.con</code> file at the root of the server installation with these two lines:
                <MmCodeBlock :code="snippets.recorderCon" />
              </li>
              <li>
                <span class="mm-steps__head">Share it</span>
                Files are stored as ndjson <strong>on your server</strong>, in its <code>replays</code> folder, and don't
                leave the server unless you upload them to
                <a :href="REPLAY_SITE" target="_blank" rel="noopener">replay.bfstats.io</a>.
              </li>
            </ol>

            <p class="bv-note">
              The recorder is built for one server binary, <code>bf1942_lnxded.static</code> with sha256
              <code class="bv-note__hash">{{ SERVER_BUILD_SHA }}</code>. On any other build the recordings are partial.
              The <a :href="SERVER_GUIDE" target="_blank" rel="noopener">full install guide</a> has systemd and BFSMD
              setups, and how to check it's recording.
            </p>
          </div>

          <div v-else id="bv-os-panel-windows" role="tabpanel" aria-labelledby="bv-os-windows">
            <ol class="mm-steps">
              <li>
                <span class="mm-steps__head">Drop it in</span>
                Stop the server and copy <code>WINMM.dll</code> from the release into the folder that holds
                <code>BF1942_w32ded.exe</code>. Windows loads it from there, so however your server starts, nothing else
                changes.
              </li>
              <li>
                <span class="mm-steps__head">Turn it on</span>
                Put a <code>recorder.con</code> file in the same folder with these two lines, then start the server:
                <MmCodeBlock :code="snippets.recorderCon" />
              </li>
              <li>
                <span class="mm-steps__head">Check it</span>
                Once the first map loads, <code>recorder.log</code> beside the exe should end with a line like this:
                <MmCodeBlock :code="snippets.windowsLog" />
              </li>
              <li>
                <span class="mm-steps__head">Share it</span>
                Files are stored as ndjson <strong>on your server</strong>, in the <code>replays</code> folder beside the
                exe, and don't leave the server unless you upload them to
                <a :href="REPLAY_SITE" target="_blank" rel="noopener">replay.bfstats.io</a>.
              </li>
            </ol>

            <p class="bv-note">
              The Windows build is experimental: it has run under Wine, not yet on a Windows host. It records players,
              vehicles, the game's events, every shot, hit and impact, and bullets in flight, but not yet chat, heals,
              repairs or soldiers' animations. It is built for <code>BF1942_w32ded.exe</code>
              v1.61 (md5 <code class="bv-note__hash">{{ WINDOWS_EXE_MD5 }}</code>); on any other exe it records nothing
              and the server runs as usual. To remove it, delete <code>WINMM.dll</code>. The
              <a :href="SERVER_GUIDE_WINDOWS" target="_blank" rel="noopener">Windows install guide</a> has the log's
              other messages.
            </p>
          </div>
        </section>
      </div>
    </section>

    <section class="bv-community" aria-labelledby="bv-community-title" data-testid="battleview-discord">
      <div class="bv-community__text">
        <h2 id="bv-community-title" class="bv-community__title">Join the BattleView Discord</h2>
        <p>
          Help installing, bug reports, new BF42++ builds as they land, and the best rounds people have recorded.
        </p>
      </div>
      <a
        :href="DISCORD_INVITE"
        class="mm-download bv-community__btn"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="battleview-discord-join"
      >
        <i class="pi pi-discord" aria-hidden="true" />
        <span>Join Discord</span>
      </a>
    </section>

    <p class="bv__disclaimer">
      This is a community tool, and is not affiliated with EA or DICE. Not that they'd care, given the game is
      abandonware at this point.
    </p>

    <MmLightbox :media="lightbox" @close="lightbox = null" />
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
.bv__lede--more {
  margin-top: 10px;
  max-width: 72ch;
  font-size: 14.5px;
  color: var(--mm-ink-muted);
}

/* ---------- watch now ---------- */

/* The page's one call to action, above the hero: the olive anchor treatment. */
.bv-watch {
  margin-top: 24px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 20px;
  padding: 14px 16px;
  border: 1px solid var(--mm-rule);
  border-left: 3px solid var(--mm-highlight);
  background: var(--mm-bg-soft);
}

.mm a.bv-watch__btn {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 22px 12px 14px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-decoration: none;
  transition: filter 0.15s ease;
}
.mm a.bv-watch__btn:hover { color: var(--mm-highlight-ink); filter: brightness(1.12); }

.bv-watch__icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--mm-highlight-ink);
  color: var(--mm-highlight);
}
.bv-watch__icon .pi { font-size: 11px; padding-left: 2px; }
.bv-watch__icon::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px solid var(--mm-highlight-ink);
  opacity: 0;
  animation: bv-pulse 2.4s ease-out infinite;
}
@keyframes bv-pulse {
  0% { transform: scale(0.85); opacity: 0.55; }
  70%, 100% { transform: scale(1.35); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bv-watch__icon::after { animation: none; }
}

.bv-watch__what {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 220px;
}
.bv-watch__label {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.bv-watch__title {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bv-watch__meta {
  font-size: 12.5px;
  color: var(--mm-ink-soft);
}

.mm a.bv-watch__title--link { text-decoration: none; }
.mm a.bv-watch__title--link:hover { color: var(--mm-accent-soft); }
.bv-watch__title--link .pi { font-size: 9px; margin-left: 4px; color: var(--mm-accent-soft); }

/* The way to the install steps: a second button, outlined, so the page reads as
   watch first, then install. */
.mm a.bv-watch__install {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid var(--mm-highlight);
  color: var(--mm-ink);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: background-color 0.15s ease;
}
.mm a.bv-watch__install:hover {
  color: var(--mm-ink);
  background: color-mix(in srgb, var(--mm-highlight) 18%, transparent);
}
.bv-watch__install .pi { font-size: 11px; color: var(--mm-accent-soft); }
.mm a.bv-watch__discord {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  color: var(--mm-ink-soft);
  font-size: 14px;
  text-decoration: none;
}
.mm a.bv-watch__discord:hover { color: var(--mm-ink); }
.bv-watch__discord .pi { color: var(--mm-accent-soft); }

@media (max-width: 640px) {
  .mm a.bv-watch__btn { width: 100%; justify-content: center; }
  .bv-watch__title { white-space: normal; }
  .mm a.bv-watch__install { width: 100%; justify-content: center; }
  .mm a.bv-watch__discord { width: 100%; justify-content: center; }
}

/* ---------- gallery ---------- */

.bv-gallery {
  margin-top: 36px;
}
.bv-gallery__pair {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 881px) {
  .bv-gallery__pair { grid-template-columns: 1fr 1fr; }
}

.bv-shot--spaced { margin-top: 16px; }

.bv-cine {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
@media (min-width: 721px) {
  .bv-cine { grid-template-columns: repeat(3, 1fr); }
}

/* ---------- the two recorders ---------- */

.bv-install {
  scroll-margin-top: 80px;
  margin-top: 36px;
}

/* Which recorder to download: players kept taking the server one. */
.bv-pick {
  margin: 10px 0 0;
  max-width: 78ch;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
}
.bv-pick strong { color: var(--mm-ink); font-weight: 600; }

/* The player download: the one file, and what it is. */
.bv-dl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}
.bv-dl__meta {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
}

/* Why the player recorder is called dsound.dll: a short aside under the steps. */
.bv-why {
  margin-top: 18px;
  padding: 12px 14px;
  background: var(--mm-bg-mute);
  font-size: 13.5px;
  line-height: 1.6;
}
.bv-why__title {
  margin: 0 0 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-accent-soft);
}
.bv-why p { margin: 0 0 8px; }
.bv-why p:last-child { margin-bottom: 0; }

.bv__grid > section { scroll-margin-top: 80px; }
.bv__grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 981px) {
  .bv__grid { grid-template-columns: 1fr 1fr; }
}

/* Linux / Windows: the server recorder's two builds, each with its steps. */
.bv-os {
  display: flex;
  width: max-content;
  margin: 20px 0 4px;
}

.bv-only {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border-left: 2px solid var(--mm-highlight);
  background: var(--mm-bg-mute);
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--mm-ink-soft);
}
.bv-only .pi { margin-top: 3px; font-size: 13px; color: var(--mm-accent-soft); }

.bv-note {
  margin: 18px 0 0 !important;
  padding-top: 14px;
  border-top: 1px solid var(--mm-rule);
  font-size: 13px;
  color: var(--mm-ink-muted);
}
.bv-note__hash { word-break: break-all; }

/* Under the download: a player on an old build is told to take it again. */
.bv-update { margin: 14px 0 0; }
.bv-update strong { color: var(--mm-ink); font-weight: 600; }

/* The Discord: one strip after the install cards, where a stuck player ends up. */
.bv-community {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px 24px;
  margin-top: 28px;
  padding: 18px 20px;
  border-left: 2px solid var(--mm-highlight);
  background: var(--mm-bg-mute);
}
.bv-community__text { flex: 1 1 320px; min-width: 0; }
.bv-community__title {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 600;
  color: var(--mm-ink);
}
.bv-community p {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--mm-ink-soft);
}
.bv-community__btn { flex: none; }

.bv__disclaimer {
  margin: 28px 0 0;
  max-width: 70ch;
  font-size: 13px;
  line-height: 1.6;
  color: var(--mm-ink-muted);
}

</style>
