<script setup lang="ts">
/**
 * bfstats sidecar early access: what the app does, its downloads and how to
 * install it on Windows, macOS and Linux. Early Adopters and admins only; not
 * linked from anywhere and not in the sitemap: the owner shares the link
 * (features/early-access-sidecar). Laid out like /battleview.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import MmCodeBlock from '@/components/v4/article/MmCodeBlock.vue'
import MmLightbox from '@/components/v4/article/MmLightbox.vue'
import MmMediaFrame from '@/components/v4/article/MmMediaFrame.vue'
import type { ArticleMedia as Media } from '@/components/v4/article/media'
import {
  detectPlatform,
  fetchSidecarRelease,
  formatSize,
  type SidecarAccess,
  type SidecarFile,
  type SidecarPlatform,
} from '@/services/sidecarService'
import panelShot from '@/assets/sidecar/panel.png'

const DISCORD_INVITE = 'https://discord.gg/6saqqTTYEM'

const route = useRoute()
const signInHref = computed(() => `/auth/login?returnTo=${encodeURIComponent(route.fullPath)}`)

const access = ref<SidecarAccess | null>(null)
const release = computed(() => (access.value?.state === 'ok' ? access.value.release : null))
onMounted(async () => {
  access.value = await fetchSidecarRelease()
})

const panel: Media = {
  kind: 'img',
  src: panelShot,
  alt: "The sidecar's panel: not signed in yet, the live BF1942 servers sorted by players, each with its map, mode, country, players and ping",
  width: 768,
  height: 1280,
}
const lightbox = ref<Media | null>(null)

// ---- the downloads, by platform ----------------------------------------------

type Tab = { id: SidecarPlatform; label: string }
const TABS: Tab[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'mac', label: 'macOS' },
  { id: 'linux', label: 'Linux' },
]
const platform = ref<SidecarPlatform>(detectPlatform())
const mine = computed(() => TABS.find((t) => t.id === detectPlatform())!)

const files = computed(() => release.value?.files ?? [])
/** The release's file for a platform, by its extension (and, for a Mac, its chip). */
const fileOf = (p: SidecarPlatform, ext: string, arch?: string): SidecarFile | null =>
  files.value.find((f) => f.platform === p && f.file.endsWith(ext) && (!arch || f.arch === arch)) ?? null
const windowsExe = computed(() => fileOf('windows', '.exe'))
const macArm = computed(() => fileOf('mac', '.dmg', 'arm64'))
const macIntel = computed(() => fileOf('mac', '.dmg', 'x64'))
const appImage = computed(() => fileOf('linux', '.AppImage'))
const deb = computed(() => fileOf('linux', '.deb'))
const pacman = computed(() => fileOf('linux', '.pacman'))

/** The strip's one button: the visitor's own platform (Apple silicon for a Mac). */
const primary = computed(() =>
  ({ windows: windowsExe.value, mac: macArm.value ?? macIntel.value, linux: appImage.value ?? deb.value })[mine.value.id])

const linux = computed(() => ({
  appImage: appImage.value ? `chmod +x ${appImage.value.file}\n./${appImage.value.file}` : '',
  deb: deb.value ? `sudo apt install ./${deb.value.file}` : '',
  pacman: pacman.value ? `sudo pacman -U ${pacman.value.file}` : '',
}))

const released = computed(() => {
  const at = release.value?.releasedAt
  if (!at) return ''
  const d = new Date(`${at}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
})

// ---- Play in Browser on bfstats.io (MmServerConnectAction.vue reads the flag) ---

const JOIN_FLAG = 'bfstats.relayJoin'
const readFlag = () => {
  try { return window.localStorage.getItem(JOIN_FLAG) === '1' } catch { return false }
}
const joinFlag = ref(false)
onMounted(() => { joinFlag.value = readFlag() })
function toggleJoinFlag() {
  try {
    if (joinFlag.value) window.localStorage.removeItem(JOIN_FLAG)
    else window.localStorage.setItem(JOIN_FLAG, '1')
  } catch { /* storage blocked: the button keeps saying what it is */ }
  joinFlag.value = readFlag()
}

const install = ref<HTMLElement | null>(null)
function toInstall() {
  install.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="mm-container mm-section sc">
    <div
      class="mm-eyebrow mm-eyebrow--strong"
      style="margin-bottom: 8px"
    >
      Early access
    </div>
    <h1 class="mm-display">
      bfstats sidecar
    </h1>

    <!-- Checking who this is: nothing to show yet. -->
    <p
      v-if="!access"
      class="sc__lede sc__muted"
      data-testid="sidecar-loading"
    >
      Checking your access...
    </p>

    <section
      v-else-if="access.state === 'signed-out'"
      class="sc-gate"
      data-testid="sidecar-signed-out"
    >
      <i
        class="pi pi-lock"
        aria-hidden="true"
      />
      <div>
        <h2 class="sc-gate__title">
          Sign in to see this page
        </h2>
        <p>This page is for Early Adopters. Sign in with your bfstats.io account to continue.</p>
      </div>
      <a
        :href="signInHref"
        class="mm-download"
      >
        <i
          class="pi pi-sign-in"
          aria-hidden="true"
        />
        <span>Sign in</span>
      </a>
    </section>

    <section
      v-else-if="access.state === 'no-access'"
      class="sc-gate"
      data-testid="sidecar-no-access"
    >
      <i
        class="pi pi-lock"
        aria-hidden="true"
      />
      <div>
        <h2 class="sc-gate__title">
          Early Adopters only
        </h2>
        <p>
          This page is for Early Adopters, and your account isn't one yet. If you were asked to test, say so in
          <a
            :href="DISCORD_INVITE"
            target="_blank"
            rel="noopener noreferrer"
          >our Discord</a> and we'll add you.
        </p>
      </div>
    </section>

    <section
      v-else-if="access.state === 'no-release' || access.state === 'error'"
      class="sc-gate"
      data-testid="sidecar-unavailable"
    >
      <i
        class="pi pi-clock"
        aria-hidden="true"
      />
      <div>
        <h2 class="sc-gate__title">
          No downloads right now
        </h2>
        <p>
          {{ access.state === 'error' ? access.message : 'The next build is on its way.' }} Try again shortly, or ask in
          <a
            :href="DISCORD_INVITE"
            target="_blank"
            rel="noopener noreferrer"
          >our Discord</a>.
        </p>
      </div>
    </section>

    <template v-else-if="release">
      <p class="sc__lede">
        This app lets you join multiplayer from the browser. It runs in your task tray and lets you browse servers.
        Gameplay is through the browser implementation at
        <a
          href="https://play.bfstats.io"
          target="_blank"
          rel="noopener"
        >play.bfstats.io</a>. The game doesn't need to be installed.
      </p>
      <p class="sc__lede sc__lede--more">
        This is an early build, and you're one of the first to try it: tell us what breaks.
      </p>

      <div
        class="sc-get"
        data-testid="sidecar-get"
      >
        <a
          v-if="primary"
          :href="primary.url"
          class="sc-get__btn"
          data-testid="sidecar-download-primary"
          @click="platform = mine.id"
        >
          <span
            class="sc-get__icon"
            aria-hidden="true"
          ><i class="pi pi-download" /></span>
          <span>Download for {{ mine.label }}</span>
        </a>
        <div class="sc-get__what">
          <span class="sc-get__label">Version {{ release.version }}</span>
          <span class="sc-get__title">{{ primary ? `${primary.file} · ${formatSize(primary.size)}` : `No ${mine.label} build in this release` }}</span>
          <span
            v-if="released"
            class="sc-get__meta"
          >Released {{ released }}</span>
        </div>
        <a
          href="#sc-install"
          class="sc-get__install"
          data-testid="sidecar-install-link"
          @click.prevent="toInstall"
        >
          Install steps <i
            class="pi pi-arrow-down"
            aria-hidden="true"
          />
        </a>
        <a
          :href="DISCORD_INVITE"
          class="sc-get__discord"
          target="_blank"
          rel="noopener noreferrer"
        >
          <i
            class="pi pi-discord"
            aria-hidden="true"
          /> Discord
        </a>
      </div>

      <section
        class="sc-hero"
        aria-labelledby="sc-hero-title"
      >
        <figure class="sc-hero__shot">
          <MmMediaFrame
            :media="panel"
            label="The sidecar's panel"
            aspect="natural"
            :lazy="false"
            @open="lightbox = $event"
          />
        </figure>
        <div class="sc-hero__text mm-prose">
          <div
            id="sc-hero-title"
            class="mm-eyebrow"
          >
            What it does
          </div>
          <ul class="sc-points">
            <li>
              <strong>Every live server.</strong> The whole BF1942 server list, vanilla and mods, with players, map,
              mode, country and your ping to each. Sort by players or ping.
            </li>
            <li>
              <strong>Search like bfstats.io.</strong> Type a player, a server, a map or a country. Find a friend and
              join the server they're on.
            </li>
            <li>
              <strong>One click to play.</strong> Pick a server, Join, and the viewer opens with you in the round,
              under your player name.
            </li>
            <li>
              <strong>Or from bfstats.io.</strong> A server's connect menu gets <em>Play in Browser</em>, which hands
              the server to the sidecar.
            </li>
            <li>
              <strong>Lives in the tray.</strong> On the taskbar on Windows, in the menu bar on a Mac. Closing the viewer
              leaves the server.
            </li>
          </ul>
        </div>
      </section>

      <section
        id="sc-install"
        ref="install"
        class="sc-install"
        aria-labelledby="sc-install-title"
      >
        <div
          id="sc-install-title"
          class="mm-eyebrow"
        >
          Install the sidecar
        </div>

        <div class="sc__grid">
          <section
            class="mm-article-card mm-prose"
            aria-labelledby="sc-os-title"
            data-testid="sidecar-install-card"
          >
            <div class="mm-article-card__kicker">
              Step 1
            </div>
            <h2
              id="sc-os-title"
              class="mm-article-card__title"
            >
              Install it
            </h2>

            <div
              class="mm-subtabs sc-os"
              role="tablist"
              aria-label="Your computer"
            >
              <button
                v-for="t in TABS"
                :id="`sc-os-${t.id}`"
                :key="t.id"
                type="button"
                role="tab"
                class="mm-subtab"
                :class="{ 'mm-subtab--active': platform === t.id }"
                :aria-selected="platform === t.id"
                :aria-controls="`sc-os-panel-${t.id}`"
                :data-testid="`sidecar-os-${t.id}`"
                @click="platform = t.id"
              >
                {{ t.label }}
              </button>
            </div>

            <div
              v-if="platform === 'windows'"
              id="sc-os-panel-windows"
              role="tabpanel"
              aria-labelledby="sc-os-windows"
            >
              <div class="sc-dl">
                <a
                  v-if="windowsExe"
                  :href="windowsExe.url"
                  class="mm-download"
                  data-testid="sidecar-download-windows"
                >
                  <i
                    class="pi pi-download"
                    aria-hidden="true"
                  />
                  <span>Download for Windows</span>
                </a>
                <span
                  v-if="windowsExe"
                  class="sc-dl__meta"
                >{{ windowsExe.file }} · {{ formatSize(windowsExe.size) }} · Windows 10 and 11</span>
              </div>
              <ol class="mm-steps">
                <li>
                  <span class="mm-steps__head">Run the installer</span>
                  Open the file you downloaded. Windows SmartScreen says <em>"Windows protected your PC"</em>, because the
                  installer isn't code signed yet: click <strong>More info</strong>, then <strong>Run anyway</strong>.
                </li>
                <li>
                  <span class="mm-steps__head">Install for yourself</span>
                  Choose <strong>Only for me</strong> (no admin rights needed), click <strong>Install</strong>, and leave
                  <strong>Run bfstats Sidecar</strong> ticked on the last page.
                </li>
                <li>
                  <span class="mm-steps__head">Find it in the tray</span>
                  The sidecar lives in the system tray, at first under the <code>^</code> arrow by the clock. Drag its
                  icon onto the taskbar to keep it in view. Click it to open the panel.
                </li>
              </ol>
              <p class="sc-note">
                On your first join, Windows Firewall may ask about bfstats Sidecar: click <strong>Allow</strong> for
                private networks. It's in the Start menu as bfstats Sidecar, and uninstalls from Settings &gt; Apps.
              </p>
            </div>

            <div
              v-else-if="platform === 'mac'"
              id="sc-os-panel-mac"
              role="tabpanel"
              aria-labelledby="sc-os-mac"
            >
              <div class="sc-dl sc-dl--pair">
                <a
                  v-if="macArm"
                  :href="macArm.url"
                  class="mm-download"
                  data-testid="sidecar-download-mac-arm64"
                >
                  <i
                    class="pi pi-download"
                    aria-hidden="true"
                  />
                  <span>Apple silicon (M1 and later)</span>
                </a>
                <a
                  v-if="macIntel"
                  :href="macIntel.url"
                  class="mm-download sc-alt"
                  data-testid="sidecar-download-mac-x64"
                >
                  <i
                    class="pi pi-download"
                    aria-hidden="true"
                  />
                  <span>Intel Mac</span>
                </a>
              </div>
              <p class="sc-dl__hint">
                Not sure which? Apple menu &gt; <strong>About This Mac</strong>: "Chip: Apple M..." is Apple silicon,
                "Processor: Intel" is Intel.
              </p>
              <ol class="mm-steps">
                <li>
                  <span class="mm-steps__head">Copy it to Applications</span>
                  Open the <code>.dmg</code> you downloaded and drag <strong>bfstats Sidecar</strong> into the
                  Applications folder.
                </li>
                <li>
                  <span class="mm-steps__head">Open it once</span>
                  Open bfstats Sidecar from Applications. macOS says it can't verify the app, because it isn't notarised
                  yet: click <strong>Done</strong>, then open <strong>System Settings &gt; Privacy &amp; Security</strong>,
                  scroll down, click <strong>Open Anyway</strong> next to bfstats Sidecar, and then <strong>Open</strong>.
                  On macOS 14 or earlier: right-click the app, choose <strong>Open</strong>, then <strong>Open</strong>
                  again.
                </li>
                <li>
                  <span class="mm-steps__head">Find it in the menu bar</span>
                  Its icon appears in the menu bar, top right; there is no Dock icon until the viewer is open. Click it
                  to open the panel.
                </li>
              </ol>
              <p class="sc-note">
                If macOS asks to let bfstats Sidecar find devices on your local network on your first join, click
                <strong>Allow</strong>. Opening the app once from Applications is also what lets Play in Browser links
                on bfstats.io open it.
              </p>
            </div>

            <div
              v-else
              id="sc-os-panel-linux"
              role="tabpanel"
              aria-labelledby="sc-os-linux"
            >
              <div class="sc-dl sc-dl--pair">
                <a
                  v-if="appImage"
                  :href="appImage.url"
                  class="mm-download"
                  data-testid="sidecar-download-appimage"
                >
                  <i
                    class="pi pi-download"
                    aria-hidden="true"
                  />
                  <span>AppImage (any distro)</span>
                </a>
                <a
                  v-if="deb"
                  :href="deb.url"
                  class="mm-download sc-alt"
                  data-testid="sidecar-download-deb"
                >
                  <i
                    class="pi pi-download"
                    aria-hidden="true"
                  />
                  <span>.deb (Debian, Ubuntu)</span>
                </a>
                <a
                  v-if="pacman"
                  :href="pacman.url"
                  class="mm-download sc-alt"
                  data-testid="sidecar-download-pacman"
                >
                  <i
                    class="pi pi-download"
                    aria-hidden="true"
                  />
                  <span>.pacman (Arch)</span>
                </a>
              </div>
              <ol class="mm-steps">
                <li v-if="appImage">
                  <span class="mm-steps__head">AppImage</span>
                  In the folder you downloaded it to, make it runnable and run it once (that also registers Play in
                  Browser links):
                  <MmCodeBlock :code="linux.appImage" />
                </li>
                <li v-if="deb">
                  <span class="mm-steps__head">Or Debian and Ubuntu</span>
                  Install the package, then start bfstats Sidecar from your app menu:
                  <MmCodeBlock :code="linux.deb" />
                </li>
                <li v-if="pacman">
                  <span class="mm-steps__head">Or Arch</span>
                  <MmCodeBlock :code="linux.pacman" />
                </li>
                <li>
                  <span class="mm-steps__head">Find it in the tray</span>
                  Click its tray icon to open the panel. GNOME shows tray icons only with the
                  <strong>AppIndicator</strong> extension (Ubuntu has it built in); without it, the sidecar opens as a
                  normal window instead.
                </li>
              </ol>
            </div>
          </section>

          <section
            class="mm-article-card mm-prose"
            aria-labelledby="sc-play-title"
            data-testid="sidecar-play-card"
          >
            <div class="mm-article-card__kicker">
              Step 2
            </div>
            <h2
              id="sc-play-title"
              class="mm-article-card__title"
            >
              Play
            </h2>
            <ol class="mm-steps">
              <li>
                <span class="mm-steps__head">Set your player name</span>
                Signing in is optional. To play as your bfstats.io profile, click <strong>Sign in with bfstats.io</strong>
                in the panel, allow the app in your browser, and pick the profile: its join name is the name you play
                under. Or skip it: open <strong>Settings</strong> (the gear, top right), choose
                <strong>Custom name</strong> under Player name, type your name and save. The bottom of the panel shows
                the name you'll join as.
              </li>
              <li>
                <span class="mm-steps__head">Pick a server</span>
                Click a server in the panel's <strong>Live</strong> list (or search for it, with <code>/</code>), then
                <strong>Join</strong>. The viewer opens in its own window with you in the round.
              </li>
              <li>
                <span class="mm-steps__head">Leave</span>
                Close the viewer window (or press <code>Cmd+W</code> on a Mac, <code>Ctrl+Shift+W</code> on Windows and
                Linux) and the sidecar leaves the server. Closing the panel doesn't quit the app:
                <strong>Quit</strong> is at the bottom of the panel.
              </li>
            </ol>

            <div
              class="sc-flag"
              data-testid="sidecar-join-flag"
            >
              <div class="sc-flag__text">
                <h3 class="sc-flag__title">
                  Play in Browser on bfstats.io
                </h3>
                <p>
                  Adds <em>Play in Browser</em> to every server's connect menu on bfstats.io, in this browser. It opens the
                  sidecar and joins that server.
                </p>
              </div>
              <button
                type="button"
                class="sc-flag__btn"
                :class="{ 'sc-flag__btn--on': joinFlag }"
                :aria-pressed="joinFlag"
                data-testid="sidecar-join-flag-toggle"
                @click="toggleJoinFlag"
              >
                <i
                  :class="joinFlag ? 'pi pi-check' : 'pi pi-plus'"
                  aria-hidden="true"
                />
                <span>{{ joinFlag ? 'On in this browser' : 'Turn it on' }}</span>
              </button>
            </div>

            <p class="sc-note">
              Something not right? The panel's <strong>Logs</strong> button (the <code>&gt;_</code> icon, top right) has what happened: copy the
              lines into <a
                :href="DISCORD_INVITE"
                target="_blank"
                rel="noopener noreferrer"
              >our Discord</a> with what
              you did and what you saw.
            </p>
          </section>
        </div>
      </section>

      <details
        class="sc-sums"
        data-testid="sidecar-checksums"
      >
        <summary>Checksums (SHA-256)</summary>
        <ul>
          <li
            v-for="f in release.files"
            :key="f.file"
          >
            <span class="sc-sums__file">{{ f.file }}</span>
            <code class="sc-sums__hash">{{ f.sha256 ?? 'not given' }}</code>
          </li>
        </ul>
      </details>

      <section
        class="sc-community"
        aria-labelledby="sc-community-title"
      >
        <div class="sc-community__text">
          <h2
            id="sc-community-title"
            class="sc-community__title"
          >
            Tell us how it goes
          </h2>
          <p>Bugs, servers that won't join, things that look wrong in the viewer: the Discord is where early builds get fixed.</p>
        </div>
        <a
          :href="DISCORD_INVITE"
          class="mm-download sc-community__btn"
          target="_blank"
          rel="noopener noreferrer"
        >
          <i
            class="pi pi-discord"
            aria-hidden="true"
          />
          <span>Join Discord</span>
        </a>
      </section>

      <p class="sc__disclaimer">
        Early access: please keep this page and its downloads to yourself while we test. A community tool, not affiliated
        with EA or DICE.
      </p>
    </template>

    <MmLightbox
      :media="lightbox"
      @close="lightbox = null"
    />
  </div>
</template>

<style scoped>
.sc__lede {
  margin: 14px 0 0;
  max-width: 62ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
}
.sc__lede--more {
  margin-top: 10px;
  max-width: 72ch;
  font-size: 14.5px;
  color: var(--mm-ink-muted);
}
.sc__muted { color: var(--mm-ink-muted); }

/* ---------- who may see it ---------- */

.sc-gate {
  margin-top: 24px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 20px;
  padding: 18px 20px;
  max-width: 760px;
  border: 1px solid var(--mm-rule);
  border-left: 3px solid var(--mm-highlight);
  background: var(--mm-bg-soft);
}
.sc-gate > .pi { font-size: 20px; color: var(--mm-accent-soft); }
.sc-gate > div { flex: 1 1 320px; min-width: 0; }
.sc-gate__title { margin: 0 0 4px; font-size: 17px; font-weight: 600; color: var(--mm-ink); }
.sc-gate p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--mm-ink-soft); }

/* ---------- download strip (the battleview watch strip) ---------- */

.sc-get {
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
.mm a.sc-get__btn {
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
.mm a.sc-get__btn:hover { color: var(--mm-highlight-ink); filter: brightness(1.12); }
.sc-get__icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--mm-highlight-ink);
  color: var(--mm-highlight);
}
.sc-get__icon .pi { font-size: 12px; }
.sc-get__icon::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px solid var(--mm-highlight-ink);
  opacity: 0;
  animation: sc-pulse 2.4s ease-out infinite;
}
@keyframes sc-pulse {
  0% { transform: scale(0.85); opacity: 0.55; }
  70%, 100% { transform: scale(1.35); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .sc-get__icon::after { animation: none; }
}
.sc-get__what {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 220px;
}
.sc-get__label {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.sc-get__title {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-get__meta { font-size: 12.5px; color: var(--mm-ink-soft); }
.mm a.sc-get__install {
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
.mm a.sc-get__install:hover {
  color: var(--mm-ink);
  background: color-mix(in srgb, var(--mm-highlight) 18%, transparent);
}
.sc-get__install .pi { font-size: 11px; color: var(--mm-accent-soft); }
.mm a.sc-get__discord {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  color: var(--mm-ink-soft);
  font-size: 14px;
  text-decoration: none;
}
.mm a.sc-get__discord:hover { color: var(--mm-ink); }
.sc-get__discord .pi { color: var(--mm-accent-soft); }
@media (max-width: 640px) {
  .mm a.sc-get__btn,
  .mm a.sc-get__install,
  .mm a.sc-get__discord { width: 100%; justify-content: center; }
  .sc-get__title { white-space: normal; }
}

/* ---------- hero: the panel beside what it does ---------- */

.sc-hero {
  margin-top: 32px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  align-items: center;
}
@media (min-width: 881px) {
  .sc-hero { grid-template-columns: minmax(280px, 384px) 1fr; gap: 40px; }
}
.sc-hero__shot {
  margin: 0;
  justify-self: center;
  width: 100%;
  max-width: 384px;
  padding: 18px;
  background:
    radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--mm-highlight) 22%, transparent), transparent 70%),
    var(--mm-bg-mute);
}
.sc-hero__shot :deep(.mm-media-frame) { border: 0; background: transparent; }
.sc-hero__shot :deep(img) { filter: drop-shadow(0 18px 40px rgba(0, 0, 0, 0.45)); }
.sc-points {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 12px;
}
.sc-points li {
  position: relative;
  padding-left: 18px;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
}
.sc-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.62em;
  width: 7px;
  height: 7px;
  background: var(--mm-highlight);
}
.sc-points strong { color: var(--mm-ink); font-weight: 600; }

/* ---------- install ---------- */

.sc-install {
  scroll-margin-top: 80px;
  margin-top: 36px;
}
.sc__grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  align-items: start;
}
@media (min-width: 981px) {
  .sc__grid { grid-template-columns: 1fr 1fr; }
}
.sc-os {
  display: flex;
  width: max-content;
  max-width: 100%;
  margin: 16px 0 16px;
}
.sc-dl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}
/* The other downloads of a platform: outlined beside the main one. */
.mm a.mm-download.sc-alt {
  background: transparent;
  color: var(--mm-ink);
  box-shadow: inset 0 0 0 1px var(--mm-highlight);
}
.mm a.mm-download.sc-alt:hover { color: var(--mm-ink); filter: none; background: color-mix(in srgb, var(--mm-highlight) 18%, transparent); }
.mm a.mm-download.sc-alt .pi { color: var(--mm-accent-soft); }
.sc-dl__meta {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
  overflow-wrap: anywhere;
}
.sc-dl__hint {
  margin: 10px 0 0 !important;
  font-size: 13px;
  color: var(--mm-ink-muted);
}
.sc-note {
  margin: 18px 0 0 !important;
  padding-top: 14px;
  border-top: 1px solid var(--mm-rule);
  font-size: 13px;
  color: var(--mm-ink-muted);
}

/* Play in Browser: the one setting this page can change for the visitor. */
.sc-flag {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  padding: 12px 14px;
  border-left: 2px solid var(--mm-highlight);
  background: var(--mm-bg-mute);
}
.sc-flag__text { flex: 1 1 240px; min-width: 0; }
.sc-flag__title {
  margin: 0 0 4px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-accent-soft);
}
.sc-flag p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--mm-ink-soft); }
.sc-flag__btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 9px 14px;
  border: 1px solid var(--mm-highlight);
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.15s ease, background-color 0.15s ease;
}
.sc-flag__btn:hover { filter: brightness(1.12); }
.sc-flag__btn--on { background: transparent; color: var(--mm-ink); }
.sc-flag__btn--on .pi { color: var(--mm-accent-soft); }
.sc-flag__btn:focus-visible { outline: 2px solid var(--mm-accent-soft); outline-offset: 2px; }

/* ---------- checksums, community, small print ---------- */

.sc-sums {
  margin-top: 20px;
  font-size: 13px;
  color: var(--mm-ink-muted);
}
.sc-sums summary { cursor: pointer; color: var(--mm-ink-soft); }
.sc-sums ul { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.sc-sums li { display: grid; gap: 2px; }
.sc-sums__file { font-family: var(--mm-font-mono); font-size: 12px; color: var(--mm-ink-soft); }
.sc-sums__hash { font-size: 11.5px; word-break: break-all; }

.sc-community {
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
.sc-community__text { flex: 1 1 320px; min-width: 0; }
.sc-community__title { margin: 0 0 4px; font-size: 17px; font-weight: 600; color: var(--mm-ink); }
.sc-community p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--mm-ink-soft); }
.sc-community__btn { flex: none; }

.sc__disclaimer {
  margin: 28px 0 0;
  max-width: 70ch;
  font-size: 13px;
  line-height: 1.6;
  color: var(--mm-ink-muted);
}
</style>
