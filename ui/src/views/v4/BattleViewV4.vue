<script setup lang="ts">
/**
 * BattleView: how to install the two round recorders, the BF42++ client
 * recorder and the server recorder, and where their recordings go.
 * Linked from the header on every page (features/battleview-install-page).
 */
import { ref } from 'vue'
import { feedHref, recordingWatchHref } from '@/services/recordingsService'
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

const CLIENT_RELEASE = 'https://github.com/sila-skandia/bf42plus/releases/tag/v2.0-round-replay'
// The newest recorder-v* release. Moved with every tag the recorder workflow
// publishes (features/server-replay-recorder/README.md, "Releasing").
const SERVER_VERSION = 'v0.2.1'
const SERVER_RELEASE = `https://github.com/sila-skandia/bfstats/releases/tag/recorder-${SERVER_VERSION}`
const SERVER_GUIDE = 'https://github.com/sila-skandia/bfstats/blob/main/features/server-replay-recorder/INSTALL.md'
const SERVER_GUIDE_WINDOWS = `${SERVER_GUIDE}#windows-server`

// The server recorder's two builds: recorder.so for the Linux server,
// WINMM.dll for the Windows one.
type Os = 'linux' | 'windows'
const OSES: { id: Os; label: string }[] = [
  { id: 'linux', label: 'Linux' },
  { id: 'windows', label: 'Windows' },
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

    <MmArticleHero
      :href="HERO_RECORDING"
      :src="heroShot"
      alt="A Spitfire chasing a Bf 109 over the desert, from a recorded round of Operation Battleaxe"
      title="Operation Battleaxe on MoonGamers.com"
      meta="Recorded with BF42++ · 30 min · Watch the round"
    />

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

    <div class="bv__grid">
      <section class="mm-article-card mm-prose" aria-labelledby="bv-client">
        <div class="mm-article-card__kicker">For players</div>
        <h2 id="bv-client" class="mm-article-card__title">BF42++ gameplay recorder</h2>
        <p>
          Try BF42++ with the gameplay recorder. If you've seen the BF2 recorder and replayer, it's very similar.
        </p>
        <a :href="CLIENT_RELEASE" class="mm-download" target="_blank" rel="noopener">
          <i class="pi pi-download" aria-hidden="true" />
          <span>Download BF42++ v2.0</span>
        </a>

        <ol class="mm-steps">
          <li>
            <span class="mm-steps__head">Install</span>
            Put <code>dsound.dll</code> from the release in your Battlefield 1942 folder, next to <code>BF1942.exe</code>.
          </li>
          <li>
            <span class="mm-steps__head">Turn it on</span>
            Open the console in game and type:
            <MmCodeBlock :code="snippets.client" />
            It stays on until you set it to 0.
          </li>
          <li>
            <span class="mm-steps__head">Share it</span>
            Each round is saved to the <code>replays</code> folder in the game folder. Upload your recordings to
            <a :href="REPLAY_SITE" target="_blank" rel="noopener">replay.bfstats.io</a>, or watch them locally without
            uploading (but where's the fun in that for everyone else).
          </li>
        </ol>
      </section>

      <section class="mm-article-card mm-prose" aria-labelledby="bv-server">
        <div class="mm-article-card__kicker">For server admins</div>
        <h2 id="bv-server" class="mm-article-card__title">Server recorder</h2>
        <p>
          The server recorder records gameplay captured at the server, giving full battlefield coverage. BF42++ only
          records the player's field of view.
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
            vehicles and the game's events, but no shots or hits yet. It is built for <code>BF1942_w32ded.exe</code>
            v1.61 (md5 <code class="bv-note__hash">{{ WINDOWS_EXE_MD5 }}</code>); on any other exe it records nothing
            and the server runs as usual. To remove it, delete <code>WINMM.dll</code>. The
            <a :href="SERVER_GUIDE_WINDOWS" target="_blank" rel="noopener">Windows install guide</a> has the log's
            other messages.
          </p>
        </div>
      </section>
    </div>

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

.bv__grid {
  margin-top: 32px;
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

</style>
