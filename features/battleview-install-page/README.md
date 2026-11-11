# BattleView install page

`/battleview` tells players how to install the BF42++ client recorder and
server admins how to install the server recorder, and where the recordings go
(replay.bfstats.io). Built 2026-11-01. The page is
`ui/src/views/v4/BattleViewV4.vue`.

## What it links to

- BF42++ release `v2.0-round-replay` (sila-skandia/bf42plus, `CLIENT_TAG`):
  the download button is that release's `dsound.dll` itself, which goes next to
  `BF1942.exe`; `plus.recordReplays 1` in the console turns it on and is saved
  to `bf42++.ini`.
- Server recorder release `recorder-v0.3.0` (this repo, `SERVER_VERSION`),
  under a Linux / Windows toggle (2026-11-03). Linux: `recorder.so` loaded with
  `LD_PRELOAD`, and `recorder.con` in the server root. Windows (experimental):
  `WINMM.dll` and `recorder.con` next to `BF1942_w32ded.exe`, checked through
  `recorder.log`. The full guide is
  [server-replay-recorder/INSTALL.md](../server-replay-recorder/INSTALL.md);
  the page links to it on GitHub (the Windows tab to its `#windows-server`
  section) rather than repeating the systemd and BFSMD setups.
- The hero is the BattleView trailer (below, "Hero video"). Until 2026-11-11
  it was the cover of recording `ymdy248edr` (Operation Battleaxe on
  MoonGamers.com), linking to that round.

When a release moves, change the constants at the top of the page; every
`recorder-v*` release moves `SERVER_VERSION`
([server-replay-recorder/README.md](../server-replay-recorder/README.md#releasing)).

## Watch now, latest round and Shorts (2026-11-04)

The owner asked for the page to show recent rounds and Shorts in place of the
single replay link, with a prominent Watch now up front. A list of recordings
was tried and dropped the same day: the page exists to get people installing,
and a long list pushed the instructions out of sight.

- **The strip** under the lede, above the hero: Watch now (olive) opens the
  replays home (`feedHref({})`); beside it the newest shared round
  (`/stats/recordings?pageSize=1`) links straight to its replay, with its level
  and age; Install BattleView (outlined) scrolls down to the two recorders'
  steps (`#bv-install`). With nothing shared the round's slot says the replay
  plays in the browser.
- **Shorts**: `MmShortsStrip.vue`, the six newest of the last 30 days from
  `/stats/shorts` (`shortsService.ts`), 9:16 posters that play muted on hover
  and open `play.bfstats.io/play/?tab=replay&short=<slug>`. One row of six from
  981px, a swipeable row below. Loads near the viewport; stays out while empty.

E2E: `ui/e2e/battleview-replays.spec.ts`.

## Which recorder (2026-11-05)

Players were downloading the server recorder. The card headed "For players"
did not say what it did, and the server card's Linux / Windows tabs read like
a choice of the player's own OS, so a Windows player took `WINMM.dll`.

- An "Install BattleView" eyebrow over the cards, with one line on which to
  pick: playing means BF42++; the server recorder is for dedicated servers.
- Player card: "Record your gameplay". Server card: "For server admins only",
  "Record your server", and a note that its files record nothing in a game
  folder, linking back to the player card.
- The tabs read "Linux server" / "Windows server".

## One file for players (2026-11-05)

The BF42++ release carried two installs of the same DLL: `dsound.dll`, which
the game loads from its own folder, and `bf42++.zip` (`bf42++.dll` plus the
`bf42++.exe` loader, which injects it). The page said to use `dsound.dll` but
linked to the release page, where the zip came first, and the zip was the more
downloaded of the two.

- The zip is off the release, and the bf42plus workflow
  (`.github/workflows/windows-build-msvc.yml`) now attaches `dsound.dll` alone,
  so a new release does not bring it back. The loader build is still in the
  Actions artifact.
- The button reads "Download dsound.dll" and downloads it directly.
- The install step covers an existing `dsound.dll` (an audio fix like DSOAL):
  rename it to `dsound_next.dll`, which BF42++ chains to (`src/dllmain.cpp`).
- "Why dsound.dll?" under the steps, at the owner's request: `dsound.dll` is
  DirectSound, which `BF1942.exe` loads at start and Windows finds in the game
  folder before the system one, so the game loads BF42++ and BF42++ hooks in.
  It forwards `DirectSoundCreate8` to `dsound_next.dll` or the system
  DirectSound (`src/dllmain.cpp`), which is why an existing one is renamed.
- A note under that: the x86 Visual C++ runtime for a `MSVCP140.dll` error,
  the `winecfg` override on Wine, and how to remove it.

## The header link

`ModernShell.vue` renders "Try BattleView" twice. From 1200px it is a pill in
the top bar (with "1942 3D recorder" beside it from 1340px). Narrower, the top
bar has no room (the nav squeezes until the Trivia icon collapses), so the
link sits in the breadcrumb strip instead of the UTC clock.

## Search

- `/battleview` is in `ui/public/sitemap.xml`; robots.txt allows it.
- `index.html` shipped one canonical, the homepage, for every route. The
  router's meta handler now points `link[rel=canonical]` at
  `https://bfstats.io<path>` on each navigation, so this page (and every other)
  is no longer declared a duplicate of the homepage.

## Thanks page (2026-11-09)

`/battleview/thanks` (`ui/src/views/v4/BattleViewThanksV4.vue`) thanks the
players who helped make the replay system. The text is the owner's own words,
kept exactly as written, spelling included: do not edit, tidy or "fix" it
unless the owner asks. It is linked from the BattleView page (under the
Discord strip) and from a Thanks pill in the REPLAY feed's header on
play.bfstats.io (`tools/bf1942-models/viewer/play/recordings-feed.js`).

## Hero video (2026-11-11)

The owner cut a 55 s BattleView trailer on Bocage (a P-51 strafing the village,
timed to its music) with an end card: "BattleView | 3D recorder for BF1942",
"A project by and for the community · bfstats.io" and the logo, the music
running under the card and fading out. It replaces the Battleaxe still as the
hero, captioned "BattleView trailer" (the owner: it is a trailer, no
sub-text) with the credit "Thanks Black Mamba for the trailer" under it, in
several qualities, and the page's link plays it in Discord.

**The files.** Four H.264 High + AAC renditions, `+faststart`, 60 fps, 2 s
keyframes (a switch or seek lands quickly), from the 3454x1446 master:

| id | size | bytes |
|---|---|---|
| 1440p | 3454x1446 | 68.8 MB |
| 1080p | 2580x1080 | 31.1 MB |
| 720p | 1720x720 | 13.2 MB |
| 540p | 1290x540 | 7.0 MB |

and a 1920x804 poster (the strafing run at 0:30). They live on the assets
volume under `mesh/media/battleview/` and mesh.bfstats.io serves them from
`/media/` (`mesh/nginx.conf`, mounted in `deploy/app/mesh-deployment.yaml`).
Each name ends in the first ten hex of its sha256, so a file never changes:
`immutable`, a year at the edge, nothing to purge. A new cut is new files and
new names in `ui/src/seo/battleViewHero.ts`, never an overwrite. Not in git:
about 120 MB, and the UI image would carry it on every deploy.

**The player** (`ui/src/components/v4/article/MmHeroVideo.vue`). It plays
muted and looped behind "Play with sound", which starts it from the top with
sound and the browser's controls. Under it a Quality switch: Auto takes the
smallest rendition at least as wide as the frame's pixels (devicePixelRatio
up to 2), never above 1080p, and the smallest on Data Saver; 540p on a phone,
720p or 1080p on a desktop. A pick is kept in localStorage
(`mm-hero-video-quality`); a switch goes back to the same second and keeps
playing if it was. With reduced motion or Data Saver nothing autoplays and
nothing loads until Play.

**Discord.** Pasting `bfstats.io/battleview` plays the trailer in the chat. The
page is client-rendered, so `/battleview` is now prerendered like the featured
server pages (`ui/build/seoPrerender.js`, served by `location = /battleview`
in `ui/nginx.conf`) with the tags the Shorts' share links use
(`api/Shorts/ShortLink.cs`): `og:type video.other`, `og:video`,
`og:video:secure_url`, `og:video:type video/mp4`, its size, and the poster as
`og:image`. The 720p is the one Discord gets, 13 MB, about a Short's size;
the 1440p would be a long wait in a chat. A rendition's own URL pasted alone
plays too. Discord caches an unfurl per URL, so a new cut shows in links
posted after it. JSON-LD is a `VideoObject`.

E2E: `ui/e2e/battleview-hero.spec.ts` (Auto, a pick kept over a reload, Play
with sound, the caption and credit, and the prerendered tags).
