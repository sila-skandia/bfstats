# Project: Authentic BF1942 & Mod Map Loading Screen

## Architecture
The authentic loading screen system bridges offline Python asset extraction tooling with client-side Three.js / WebGL viewer runtime in `tools/bf1942-models/viewer/`.

```
[Wine BF1942 & EoD Installs]
   │  menu.rfa, levels/*.rfa, Music/*.bik
   ▼
[tools/bf1942-models/extract_loading_assets.py]
   │  extracts backgrounds (DDS/TGA -> WebP), audio (BIK -> MP3), UI chrome (DDS -> PNG)
   ▼
[viewer/maps/]
   ├── _shared/load/ (menu_loading.png, loading_bar.png, theater WebP backgrounds)
   ├── _shared/music/ (vehicle4.mp3, theme2.mp3)
   ├── mods/eod/_shared/ (EoD chrome, vehicle4.mp3)
   ├── <level>/load.webp (level-specific backgrounds)
   └── maps.json (manifest entries with loading: { title, background, music })
         │
         ▼ (HTTP fetch)
[viewer/map.html & viewer/progress.js]
   ├── Audio Controller (Web Audio / HTML5 Audio, looping, autoplay trap, unmute UI, 800ms fadeout)
   ├── Authentic Loading Screen UI (800x600 virtual coords, menu_loading plate at (260, 465), Trebuchet MS 8)
   ├── Progress Pipeline (75% download + 25% scene construction, 60fps monotonic interpolation)
   └── Transition Controller (skips briefing modal, WebGL warm-up render, crossfade to #fullmap.deploy)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | `CLI-EXTRACT-CHROME` | Extract authentic UI chrome (`menu_loading.dds`, `loading_full_256x16.dds`) for vanilla & EoD | M1 | Survey |
| 2 | `CLI-EXTRACT-BG-VANILLA` | Extract vanilla 800x600 theater and level loading backgrounds from `menu.rfa` and level RFAs to WebP | M1 | Survey |
| 3 | `CLI-EXTRACT-BG-EOD` | Extract EoD 800x600 level loading backgrounds (`loader.tga`) across level RFAs to WebP | M1 | Survey |
| 4 | `CLI-EXTRACT-AUDIO` | Extract Bink audio streams (`vehicle4.bik`) for vanilla and EoD, transcode to 192k MP3 via FFmpeg | M1 | Survey |
| 5 | `MANIFEST-GEN` | Generate manifest data mapping level IDs to `{ title, background, music }` in `maps.json` | M1 | Survey |
| 6 | `AUDIO-PLAYBACK` | Stream and play map-specific loading music on load start, seamless loop during load | M2 | Survey |
| 7 | `AUDIO-FALLBACK` | Fall back to default loading theme when custom track is absent | M2 | Survey |
| 8 | `AUDIO-AUTOPLAY-TRAP` | Catch browser autoplay promise rejection without uncaught console errors | M2 | Survey |
| 9 | `AUDIO-GESTURE-UNLOCK` | One-time document interaction gesture unlock for AudioContext / audio playback | M2 | Survey |
| 10 | `AUDIO-UNMUTE-UI` | Visual authentic unmute button/badge when autoplay is blocked | M2 | Survey |
| 11 | `AUDIO-FADEOUT` | Smooth 800ms (500-1500ms) volume ramp down to 0 on 100% load completion | M2 | Survey |
| 12 | `AUDIO-STALE-CANCEL` | Prevent stale loading audio from triggering if user clicks after map load completes | M2 | Survey |
| 13 | `UI-VIRTUAL-COORDS` | 800x600 Refractor virtual coordinate scaling for loading screen with aspect-ratio preserving container | M3 | Survey |
| 14 | `UI-BG-ARTWORK` | Display high-fidelity 800x600 loading artwork matching requested map | M3 | Survey |
| 15 | `UI-BEVELED-BOX` | Authentic metallic beveled container at `(260, 465)` (active 290x64 px) using `menu_loading.png` | M3 | Survey |
| 16 | `UI-TITLE-TYPOGRAPHY` | Uppercase map title `"LOADING " + MAP_NAME` in Trebuchet MS 8 at `(10, 6)` relative to box | M3 | Survey |
| 17 | `UI-MOD-THEME` | Theme support for mod-specific loading chrome/colors (vanilla olive `#847D4A` vs EoD bamboo `#F7E7B5`) | M3 | Survey |
| 18 | `ANIM-MONOTONIC-PROGRESS` | Smooth monotonic 0-100% progress animation without instant 0->100% snapping | M3 | Survey |
| 19 | `ANIM-WEIGHTED-STAGES` | Progress weighting across asset download (75%) and WebGL scene/collider construction (25%) | M3 | Survey |
| 20 | `TRANS-SKIP-BRIEFING` | Bypass original game client's server rules/briefing modal dialog | M3 | Survey |
| 21 | `TRANS-GPU-WARMUP` | Synchronous WebGL render pass before overlay dismiss to prevent blank canvas / untextured flash | M3 | Survey |
| 22 | `TRANS-DIRECT-TO-SPAWN` | Smooth crossfade directly into `#fullmap.deploy` (interactive spawn screen / 3D map) | M3 | Survey |
| 23 | `E2E-TEST-PASS` | Pass 100% of the opaque-box E2E test suite across Tiers 1-4 | M4 | Survey |
| 24 | `E2E-COVERAGE-HARDENING` | Adversarial white-box test hardening (Tier 5) | M4 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Asset Extraction Tooling & Manifest Generation | `tools/bf1942-models/extract_loading_assets.py`, manifest updates in `maps.json`, WebP/MP3/PNG extraction | none | IN_PROGRESS |
| M2 | Audio Pipeline & Autoplay Resilience | Audio controller in `viewer/progress.js` (or `audio.js`), Web Audio fading, autoplay unlock & UI | none | DONE (viewer/audio.js, 64/64 tests pass, clean audit) |
| M3 | Authentic Loading Screen Visuals & Transitions | 800x600 virtual coordinate UI, beveled box, title, progress bar, monotonic animation, direct-to-spawn transition | M1, M2 | PLANNED |
| M4 | Final Milestone: E2E Test Pass & Hardening | Pass 100% of E2E test suite (Tiers 1-4), followed by Tier 5 adversarial coverage hardening | M1, M2, M3, TEST_READY | PLANNED |

## Interface Contracts

### 1. Extraction Tooling ↔ Viewer Manifest (`maps.json`)
The extraction tooling outputs files and updates entries in `viewer/maps/maps.json` (and `viewer/maps/mods/<mod>/maps.json`) with an optional `loading` object:
```json
{
  "name": "Wake",
  "mod": "bf1942",
  "glb": "wake/scene.glb",
  "report": "wake/scene.json",
  "worldSize": 2048.0,
  "loading": {
    "title": "WAKE ISLAND",
    "background": "_shared/load/pacific2.webp",
    "music": "_shared/music/vehicle4.mp3",
    "theme": "vanilla"
  }
}
```
If `loading` is omitted or partially defined, the viewer applies default fallback:
- `title`: `name.toUpperCase().replace(/_/g, ' ')`
- `background`: `_shared/load/western.webp`
- `music`: `_shared/music/vehicle4.mp3`
- `theme`: `mod === 'eod' ? 'eod' : 'vanilla'`

### 2. Audio Controller ↔ Overlay Lifecycle
The audio controller provides an interface instantiated by `createLoadOverlay`:
```typescript
interface LoadingAudioController {
  start(musicUrl: string): void;
  fadeOut(durationMs: number): Promise<void>;
  cancel(): void;
  isAutoplayBlocked(): boolean;
  onAutoplayBlocked(callback: () => void): void;
  onAutoplayResolved(callback: () => void): void;
}
```
- `start(url)`: Begins streaming/looping music immediately. If blocked by browser autoplay policy, flags `isAutoplayBlocked() = true` and invokes `onAutoplayBlocked`.
- `fadeOut(durationMs)`: Attenuates volume linearly or exponentially from current volume to 0 over `durationMs` (default: 800ms). When volume reaches 0, pauses and resets audio.
- `cancel()`: Stops audio immediately with zero fade (e.g. if user cancels loading).

### 3. Loading Overlay ↔ Map Viewer (`map.html`)
The loading overlay extends `viewer/progress.js`:
```typescript
interface LoadOverlay {
  begin(mapName: string, config?: LoadingConfig): LoadSession;
  configureLoading(config: { title?: string; background?: string; music?: string; theme?: string }): void;
}

interface LoadSession {
  bytes(category: string, loaded: number, total: number): void;
  count(category: string, loaded: number, total: number): void;
  setStage(stageName: string, progressFraction: number): void;
  end(): Promise<void>;
  cancel(): void;
}
```
- On `load.end()`, the overlay ensures the WebGL canvas has executed at least one render frame (`warmupRender()`), triggers `openDeploy()` on `viewer/map.html`, smoothly fades the overlay opacity from 1.0 to 0.0 over 400ms, and fades audio out over 800ms.

## Code Layout
- `tools/bf1942-models/extract_loading_assets.py`: Python CLI tool to extract and transcode loading assets.
- `tools/bf1942-models/bf42/`: Existing Python parsing modules (`rfa.py`, `meme.py`, `font.py`).
- `tools/bf1942-models/viewer/progress.js`: Authentic 800x600 loading overlay, progress accumulator, and audio controller.
- `tools/bf1942-models/viewer/map.html`: 3D map viewer, loading session initialization, and direct-to-spawn transition.
- `tools/bf1942-models/viewer/maps/`: Asset directory holding extracted backgrounds, audio, and manifests.
- `tests/e2e/`: E2E test suite created by E2E Testing Track.
