# E2E Test Infrastructure Specification (`TEST_INFRA.md`)

## 1. Executive Summary & Principles
The E2E Testing Track provides a 100% opaque-box, requirement-driven verification harness for the Battlefield 1942 Authentic Loading Screen system. It verifies all 22 functional features cataloged in `PROJECT.md` across both offline Python extraction tooling (`extract_loading_assets.py`) and browser runtime components (`viewer/progress.js`, `viewer/map.html`).

### Core Principles
1. **Opaque-Box Verification**: Tests interact strictly with public CLI commands, file system artifacts, DOM states, audio controller methods, and event transitions. Zero access to private implementation internals.
2. **Zero External Dependencies**: The test runner and harnesses run entirely with standard Python 3 (`unittest`, `subprocess`, `argparse`) and Node.js (`node:test`, `node:assert`). No `pip install`, no `npm install`, no external network access, and no mock servers required.
3. **Sub-Second Synthetic Testing**: High-fidelity synthetic fixture generators produce minimal valid RFA archives, DDS/TGA textures, and dummy BIK media in memory/tempdirs, enabling comprehensive testing of all 244 test cases in < 3 seconds.
4. **Real-Asset Verification Support**: Optional `--real-wine` flag verifies extractions and playback against authentic local Wine game installations (`/home/dylan/.wine/drive_c/EA Games/Battlefield 1942/`).
5. **Unified Standalone Runner**: Single entrypoint `python3 -m tests.e2e.runner` orchestrates all 4 test tiers, outputs structured console reports, and returns deterministic exit codes (0 = pass, 1 = test failure, 2 = runner error).

---

## 2. Directory Layout & Architecture

```
tests/e2e/
├── __init__.py
├── __main__.py                   # Allows execution via `python3 -m tests.e2e`
├── runner.py                     # Unified standalone CLI runner entrypoint
├── fixtures/                     # High-speed synthetic Refractor asset generators
│   ├── __init__.py
│   ├── synthetic_rfa.py          # Microsecond uncompressed RFA archive builder
│   ├── synthetic_images.py       # Deterministic 800x600 TGA & DXT1 DDS generators
│   ├── synthetic_audio.py        # Sliced BIK audio fixture & mock generator
│   └── synthetic_tree.py         # Full isolated mock BF1942 & EoD game directory tree
├── harnesses/                    # Execution harnesses and environment bridges
│   ├── __init__.py
│   ├── mock_dom.mjs              # Zero-dependency Mock DOM, AudioContext, Canvas & VirtualClock
│   └── test_web_runtime.py       # Python bridge executing node:test suites and reporting to runner
├── tier1/                        # Tier 1: Feature Coverage (5 tests/feat = 110 tests)
│   ├── __init__.py
│   ├── test_tier1_cli.py         # Features 1-5 (25 tests)
│   ├── test_tier1_audio.mjs      # Features 6-12 (35 tests)
│   ├── test_tier1_ui.mjs         # Features 13-17 (25 tests)
│   ├── test_tier1_animation.mjs  # Features 18-19 (10 tests)
│   └── test_tier1_transitions.mjs# Features 20-22 (15 tests)
├── tier2/                        # Tier 2: Boundary & Corner Cases (5 tests/feat = 110 tests)
│   ├── __init__.py
│   ├── test_tier2_cli.py         # Features 1-5 boundary cases (25 tests)
│   ├── test_tier2_audio.mjs      # Features 6-12 boundary cases (35 tests)
│   ├── test_tier2_ui.mjs         # Features 13-17 boundary cases (25 tests)
│   ├── test_tier2_animation.mjs  # Features 18-19 boundary cases (10 tests)
│   └── test_tier2_transitions.mjs# Features 20-22 boundary cases (15 tests)
├── tier3/                        # Tier 3: Cross-Feature Combinations (Pairwise = 18 tests)
│   ├── __init__.py
│   └── test_tier3_pairwise.py    # Combinations 1-18 (CLI, Audio, UI, Anim, Trans)
└── tier4/                        # Tier 4: Real-World Application Scenarios (6 scenarios)
    ├── __init__.py
    └── test_tier4_scenarios.py   # End-to-end workflows (Wake, Bocage, EoD, Cache, etc.)
```

---

## 3. Standalone Runner Specification (`tests/e2e/runner.py`)

### 3.1 Invocation Contract
The test runner must be executable directly from the repository root:
```bash
python3 -m tests.e2e.runner [OPTIONS]
# or
python3 tests/e2e/runner.py [OPTIONS]
```

### 3.2 Command-Line Options
| Option | Argument | Description | Default |
|---|---|---|---|
| `--tier` | `1`, `2`, `3`, `4`, `all` | Filter test execution to specified tier | `all` |
| `--filter` | `<pattern>` | Filter test IDs or names by regex/substring | None (run all in tier) |
| `--verbose`, `-v` | flag | Print detailed per-test execution traces and timings | False |
| `--fast` | flag | Skip slower disk scans or simulated network delays | False |
| `--real-wine` | flag | Run tests requiring authentic Wine install on disk | False (skip if missing) |
| `--json` | `<path>` | Export structured test execution results to JSON file | None |
| `--tap` | flag | Emit results in Test Anything Protocol format | False |
| `--help`, `-h` | flag | Display usage information and exit | N/A |

### 3.3 Exit Codes
- `0`: All executed tests passed cleanly.
- `1`: One or more tests failed or produced assertion errors.
- `2`: Runner error (e.g. invalid CLI arguments, environment failure, missing Python/Node interpreter).

### 3.4 Terminal Reporting Format
```
======================================================================
REFRACTOR E2E TEST SUITE RUNNER v1.0
Target: Authentic BF1942 & Mod Map Loading Screen
======================================================================
[TIER 1: FEATURE COVERAGE]
  PASS  T1-FEAT01-01: Extract vanilla menu_loading.dds -> PNG (12ms)
  PASS  T1-FEAT01-02: Extract vanilla loading_full_256x16.dds -> PNG (9ms)
  ...
  PASS  T1-FEAT22-05: Direct crossfade into #fullmap.deploy (14ms)
  Tier 1 Result: 110/110 passed (0 failed, 0 skipped) in 0.42s

[TIER 2: BOUNDARY & CORNER CASES]
  PASS  T2-FEAT01-01: Corrupted DDS header handling (8ms)
  ...
  PASS  T2-FEAT22-05: Spawn screen unmounted recovery (11ms)
  Tier 2 Result: 110/110 passed (0 failed, 0 skipped) in 0.49s

[TIER 3: CROSS-FEATURE PAIRWISE COMBINATIONS]
  PASS  T3-COMB-01: CLI Chrome Extraction <-> UI Beveled Box (15ms)
  ...
  PASS  T3-COMB-18: Manifest Lookup Fallback <-> UI Artwork Fallback (12ms)
  Tier 3 Result: 18/18 passed (0 failed, 0 skipped) in 0.28s

[TIER 4: REAL-WORLD APPLICATION SCENARIOS]
  PASS  T4-SCEN-01: Wake Island Vanilla End-to-End Workflow (85ms)
  PASS  T4-SCEN-02: Bocage Vanilla End-to-End Workflow (78ms)
  PASS  T4-SCEN-03: EoD Operation Hastings Workflow (92ms)
  PASS  T4-SCEN-04: Instant Cache Hit & Smooth Ramp Workflow (45ms)
  PASS  T4-SCEN-05: Blocked Autoplay Recovery & Interaction Workflow (62ms)
  PASS  T4-SCEN-06: Rapid Mod & Map Switching Workflow (58ms)
  Tier 4 Result: 6/6 passed (0 failed, 0 skipped) in 0.42s

======================================================================
E2E TEST SUITE EXECUTION SUMMARY
======================================================================
Tier           Total    Passed    Failed    Skipped    Duration
----------------------------------------------------------------------
Tier 1           110       110         0          0       0.42s
Tier 2           110       110         0          0       0.49s
Tier 3            18        18         0          0       0.28s
Tier 4             6         6         0          0       0.42s
----------------------------------------------------------------------
TOTAL            244       244         0          0       1.61s
======================================================================
STATUS: ALL 244 TESTS PASSED (Exit Code: 0)
```

---

## 4. Test Harnesses & Tooling

### 4.1 CLI Execution Subsystem
Executes `tools/bf1942-models/extract_loading_assets.py` as an external process:
- Tests interface arguments: `--game-dir`, `--dest`, `--mod`, `--extract-all`, `--manifest-only`, `--force`, `--levels`, `--no-audio`, `--no-chrome`, `--format`, `--audio-bitrate`, `--dry-run`.
- Asserts exit codes: 0 (Success), 1 (Execution Error), 2 (Syntax Error), 3 (Missing Archive/Game Directory), 4 (Missing Dependency).
- Verifies output artifacts: WebP backgrounds, PNG chrome, MP3 audio, and `maps.json` metadata.

### 4.2 Synthetic Test Fixture Generator (`tests/e2e/fixtures/`)
Generates valid in-memory Refractor assets without requiring 20GB of retail game files:
- **`synthetic_rfa.py`**: Builds minimal Refractor archive header (156 bytes) and valid index table with uncompressed file blobs.
- **`synthetic_images.py`**: Minimal 128-byte DDS header (`DDS `, `DXT1` fourCC) + block payload; minimal 18-byte TGA header (width, height, 24-bit BGR true-color) + scanlines.
- **`synthetic_audio.py`**: Sliced 16KB header and frames from authentic `Vehicle4.bik` demuxing cleanly with FFmpeg into valid MP3 in ~15ms.
- **`synthetic_tree.py`**: Constructs an isolated, temporary BF1942 and EoD game directory structure for sub-second, side-effect-free test execution.

### 4.3 Web Runtime JS Test Harness (`tests/e2e/harnesses/`)
Bridges Node.js `node:test` execution into the Python runner:
- `mock_dom.mjs`: Complete zero-dependency browser runtime mock in Node.js ES Modules:
  - `VirtualClock`: Deterministic step-by-step time advancement (`clock.tick(dt)`), controlling `setTimeout`, `clearTimeout`, `requestAnimationFrame`, and Web Audio timeline without wall-clock sleep.
  - `MockElement`, `MockClassList`: DOM tree hierarchy, class attributes, event dispatching, and query selector parsing (`#id`, `.class`, `[attr]`, tag).
  - `MockAudioContext`, `MockGainNode`, `MockAudioParam`: Gain curve evaluation (`linearRampToValueAtTime`), state tracking (`running`, `suspended`), volume attenuation.
  - `MockHTMLAudioElement`: Loop flag, playback promise simulation (resolving or rejecting with `NotAllowedError`), state tracking (`paused`, `currentTime`).
- `test_web_runtime.py`: Python bridge discovering `.mjs` suites, spawning `node --test`, parsing output, and reporting results into the unified runner.

---

## 5. Complete 4-Tier Test Case Inventory

### Summary Table
| Tier | Description | Target Features | Test Count |
|---|---|---|---|
| **Tier 1** | Feature Coverage (Happy Path) | Features 1 - 22 | 110 tests (5 per feature) |
| **Tier 2** | Boundary & Corner Cases | Features 1 - 22 | 110 tests (5 per feature) |
| **Tier 3** | Cross-Feature Combinations | Pairwise Interactions | 18 tests |
| **Tier 4** | Real-World Application Scenarios | End-to-End User Workflows | 6 tests |
| **TOTAL** | | | **244 tests** |

---

### 5.1 Tier 1: Feature Coverage Catalog (110 Tests)

#### Feature 1: `CLI-EXTRACT-CHROME`
- `T1-FEAT01-01`: Vanilla `menu_loading.dds` extracted and converted to PNG.
- `T1-FEAT01-02`: Vanilla `loading_full_256x16.dds` extracted and converted to PNG.
- `T1-FEAT01-03`: EoD `menu_loading.dds` extracted to mod directory.
- `T1-FEAT01-04`: EoD `loading_full_256x16.dds` extracted to mod directory.
- `T1-FEAT01-05`: Non-zero alpha bounding box cropping for `menu_loading` (512x64 with active 290x64).

#### Feature 2: `CLI-EXTRACT-BG-VANILLA`
- `T1-FEAT02-01`: Extract vanilla Pacific theater backgrounds (`Pacific.tga`, `Pacific2.tga`) to WebP.
- `T1-FEAT02-02`: Extract vanilla Western theater backgrounds (`Western.tga`, `Western2.tga`) to WebP.
- `T1-FEAT02-03`: Extract vanilla Eastern theater backgrounds (`Eastern.tga`, `Eastern2.tga`) to WebP.
- `T1-FEAT02-04`: Extract vanilla Desert theater background (`Desert.tga`) to WebP.
- `T1-FEAT02-05`: Extract level-specific override background (Battle of Britain `Britain_Load.tga`) to level destination.

#### Feature 3: `CLI-EXTRACT-BG-EOD`
- `T1-FEAT03-01`: Extract EoD level loading background (`loader.tga`) for Operation Hastings to WebP.
- `T1-FEAT03-02`: Extract EoD level loading background for Charlie Don't Surf to WebP.
- `T1-FEAT03-03`: Extract EoD level loading background for Drang Valley to WebP.
- `T1-FEAT03-04`: Batch extraction across multiple EoD level RFAs.
- `T1-FEAT03-05`: Verify WebP dimension preservation (800x600 px) for extracted EoD art.

#### Feature 4: `CLI-EXTRACT-AUDIO`
- `T1-FEAT04-01`: Extract vanilla `Vehicle4.bik` audio stream and transcode to MP3.
- `T1-FEAT04-02`: Extract EoD `vehicle4.bik` audio stream and transcode to MP3.
- `T1-FEAT04-03`: Verify MP3 encoding bitrate is 192 kbps and sample rate is 44.1 kHz.
- `T1-FEAT04-04`: Extract fallback theme `Theme2.bik` to MP3.
- `T1-FEAT04-05`: Verify CLI `--no-audio` or audio format flags behavior.

#### Feature 5: `MANIFEST-GEN`
- `T1-FEAT05-01`: Generate manifest entry for vanilla map with theater background (`Wake` -> `pacific2.webp`).
- `T1-FEAT05-02`: Generate manifest entry for vanilla map with custom override (`Battle_of_Britain` -> `britain_load.webp`).
- `T1-FEAT05-03`: Generate manifest entry for EoD map (`Operation_Hastings` -> `mods/eod/operation_hastings/load.webp`).
- `T1-FEAT05-04`: Populate audio track paths in manifest (`music`: `_shared/music/vehicle4.mp3`).
- `T1-FEAT05-05`: Validate generated JSON conforms to schema in `PROJECT.md § Interface Contracts`.

#### Feature 6: `AUDIO-PLAYBACK`
- `T1-FEAT06-01`: Instantiates audio stream on `overlay.begin()`.
- `T1-FEAT06-02`: Plays correct map-specific music URL from manifest configuration.
- `T1-FEAT06-03`: Loops playback continuously during extended load session (`audio.loop === true`).
- `T1-FEAT06-04`: Sets initial volume according to configuration (default 1.0).
- `T1-FEAT06-05`: Audio element / AudioNode properly attached to audio graph.

#### Feature 7: `AUDIO-FALLBACK`
- `T1-FEAT07-01`: Fallback to mod default loading track when map manifest omits `music`.
- `T1-FEAT07-02`: Fallback to vanilla default loading theme when mod has no music file.
- `T1-FEAT07-03`: Graceful fallback on audio network error (404/500) without crashing overlay.
- `T1-FEAT07-04`: Fallback audio loop behaves identically to primary track.
- `T1-FEAT07-05`: Audio controller flags fallback state in session diagnostics.

#### Feature 8: `AUDIO-AUTOPLAY-TRAP`
- `T1-FEAT08-01`: Traps `NotAllowedError` rejection from `audio.play()` without throwing uncaught console error.
- `T1-FEAT08-02`: Sets `isAutoplayBlocked() === true` when browser rejects unmuted playback.
- `T1-FEAT08-03`: Fires `onAutoplayBlocked` callback listener.
- `T1-FEAT08-04`: Loading progress animation continues uninterrupted when autoplay is blocked.
- `T1-FEAT08-05`: Scene lifecycle (`load.end()`) functions normally without audio.

#### Feature 9: `AUDIO-GESTURE-UNLOCK`
- `T1-FEAT09-01`: Registers one-time listener for user gesture (`pointerdown`).
- `T1-FEAT09-02`: Unlocks audio playback when user clicks during load.
- `T1-FEAT09-03`: Resumes `AudioContext` on user interaction.
- `T1-FEAT09-04`: Removes event listener once unlocked to prevent duplicate trigger.
- `T1-FEAT09-05`: Fires `onAutoplayResolved` callback upon successful unlock.

#### Feature 10: `AUDIO-UNMUTE-UI`
- `T1-FEAT10-01`: Displays authentic unmute button/badge when autoplay is blocked.
- `T1-FEAT10-02`: Unmute button renders with authentic styling (`[🔊 UNMUTE]` / Refractor styling).
- `T1-FEAT10-03`: Clicking unmute button unlocks audio immediately.
- `T1-FEAT10-04`: Unmute button automatically hides when user unblocks audio.
- `T1-FEAT10-05`: Unmute button remains hidden if autoplay succeeds initially.

#### Feature 11: `AUDIO-FADEOUT`
- `T1-FEAT11-01`: Initiates volume attenuation when `load.end()` is invoked.
- `T1-FEAT11-02`: Volume attenuates smoothly to 0 over 800ms duration.
- `T1-FEAT11-03`: Configurable fade duration within 500ms - 1500ms range.
- `T1-FEAT11-04`: Audio playback pauses and resets (`currentTime = 0`) when volume reaches 0.
- `T1-FEAT11-05`: Audio nodes disconnected and resources disposed after fadeout.

#### Feature 12: `AUDIO-STALE-CANCEL`
- `T1-FEAT12-01`: Disables delayed loading music unlock if load completes before user clicks.
- `T1-FEAT12-02`: User click in spawn screen after load does NOT play loading march theme.
- `T1-FEAT12-03`: Cancels active audio immediately if user navigates away or cancels load.
- `T1-FEAT12-04`: Prevents multiple overlapping loading tracks on quick map switches.
- `T1-FEAT12-05`: Ensures ambient game audio can start cleanly without collision from loading audio.

#### Feature 13: `UI-VIRTUAL-COORDS`
- `T1-FEAT13-01`: Computes 800x600 virtual coordinate scale factor for standard 1920x1080 display.
- `T1-FEAT13-02`: Computes scale factor for 1280x720 display matching reference video.
- `T1-FEAT13-03`: Preserves aspect ratio scaling in portrait viewports (`W < H`).
- `T1-FEAT13-04`: Center-aligns 800x600 virtual stage within non-4:3 viewports.
- `T1-FEAT13-05`: Updates layout metrics dynamically on window resize event.

#### Feature 14: `UI-BG-ARTWORK`
- `T1-FEAT14-01`: Renders full-viewport background image matching configured map art.
- `T1-FEAT14-02`: Renders Pacific theater artwork for Wake Island.
- `T1-FEAT14-03`: Renders Western theater artwork for Bocage.
- `T1-FEAT14-04`: Renders custom EoD artwork for Operation Hastings.
- `T1-FEAT14-05`: Applies `object-fit: cover` or virtual stretch without border artifacts.

#### Feature 15: `UI-BEVELED-BOX`
- `T1-FEAT15-01`: Renders metallic beveled container at virtual position `(260, 465)`.
- `T1-FEAT15-02`: Container dimensions match active plate size `290 x 64 px`.
- `T1-FEAT15-03`: Uses extracted `menu_loading.png` as container background.
- `T1-FEAT15-04`: Inner progress outer bevel positioned at `(17, 33)` relative to box with size `260 x 18`.
- `T1-FEAT15-05`: Inner progress fill positioned at `(2, 2)` relative to outer bevel with size `256 x 14`.

#### Feature 16: `UI-TITLE-TYPOGRAPHY`
- `T1-FEAT16-01`: Renders uppercase title `"LOADING <MAP_NAME>"` (e.g. `"LOADING WAKE ISLAND"`).
- `T1-FEAT16-02`: Text color is solid black (`#000000`).
- `T1-FEAT16-03`: Text position offset is `(10, 6)` relative to loading container.
- `T1-FEAT16-04`: Uses Trebuchet MS 8 styling / font face.
- `T1-FEAT16-05`: Replaces underscores with spaces in map names (e.g. `OPERATION_HASTINGS` -> `OPERATION HASTINGS`).

#### Feature 17: `UI-MOD-THEME`
- `T1-FEAT17-01`: Applies vanilla olive color `#847D4A` to progress fill for vanilla maps.
- `T1-FEAT17-02`: Applies vanilla charcoal tone `#292829` to loading container trough.
- `T1-FEAT17-03`: Applies EoD bamboo cream `#F7E7B5` to progress fill for EoD maps.
- `T1-FEAT17-04`: Applies EoD khaki header `#B59B70` and parchment `#E7D7B5` to container for EoD maps.
- `T1-FEAT17-05`: Dynamically switches theme styles when alternating between vanilla and EoD maps.

#### Feature 18: `ANIM-MONOTONIC-PROGRESS`
- `T1-FEAT18-01`: Progress bar starts at 0% on `overlay.begin()`.
- `T1-FEAT18-02`: Progress value advances monotonically ($P(t_2) \ge P(t_1)$) across all frame updates.
- `T1-FEAT18-03`: Interpolates smoothly toward target percentage at 60 fps.
- `T1-FEAT18-04`: Clamps maximum advance speed (prevents instant snap from 0% to 100%).
- `T1-FEAT18-05`: Reaches exactly 100% when load finishes.

#### Feature 19: `ANIM-WEIGHTED-STAGES`
- `T1-FEAT19-01`: Weights network downloads at 75% of overall progress.
- `T1-FEAT19-02`: Weights scene and collider construction at 25% of overall progress.
- `T1-FEAT19-03`: Updates progress smoothly as GLB bytes arrive via `session.bytes()`.
- `T1-FEAT19-04`: Advances progress as scene stages complete via `session.setStage()`.
- `T1-FEAT19-05`: Overall percentage calculation accurately aggregates weighted sub-stages.

#### Feature 20: `TRANS-SKIP-BRIEFING`
- `T1-FEAT20-01`: Verifies original game briefing modal is NOT displayed when loading completes.
- `T1-FEAT20-02`: Reaching 100% triggers direct transition without requiring user "READY" click.
- `T1-FEAT20-03`: Briefing dialog element remains absent or hidden throughout lifecycle.
- `T1-FEAT20-04`: Auto-advances immediately into post-load sequence.
- `T1-FEAT20-05`: No lingering modal overlay traps keyboard or mouse input.

#### Feature 21: `TRANS-GPU-WARMUP`
- `T1-FEAT21-01`: Executes synchronous WebGL render pass (`renderer.render()`) before overlay dismiss.
- `T1-FEAT21-02`: Loading overlay remains 100% opaque during GPU warmup pass.
- `T1-FEAT21-03`: Compiles shaders and uploads textures before making 3D scene visible.
- `T1-FEAT21-04`: Verifies no black/white unrendered frames are presented to user.
- `T1-FEAT21-05`: Handles WebGL rendering errors during warmup gracefully.

#### Feature 22: `TRANS-DIRECT-TO-SPAWN`
- `T1-FEAT22-01`: Invokes `openDeploy()` upon load completion to initialize spawn screen.
- `T1-FEAT22-02`: Adds `.deploy` class to `#fullmap` element.
- `T1-FEAT22-03`: Fades loading overlay opacity from 1.0 to 0.0 over 350-500ms.
- `T1-FEAT22-04`: Marks loading overlay `hidden = true` once fade animation completes.
- `T1-FEAT22-05`: Spawn screen controls and interactive map are fully responsive immediately after fade.

---

### 5.2 Tier 2: Boundary & Corner Cases Catalog (110 Tests)

#### Feature 1: `CLI-EXTRACT-CHROME`
- `T2-FEAT01-01`: Corrupted DDS header in `menu_loading.dds` (CLI logs error and exits cleanly with code 1).
- `T2-FEAT01-02`: Missing `loading_full_256x16.dds` in archive (CLI falls back to programmatic solid color).
- `T2-FEAT01-03`: Destination directory is read-only / unwritable (graceful I/O permission error, exit 1).
- `T2-FEAT01-04`: Zero-byte `menu_loading.dds` file in archive (rejects cleanly without unhandled crash).
- `T2-FEAT01-05`: Case mismatch in archive path (`Menu/texture/briefing/Menu_Loading.DDS` handled case-insensitively).

#### Feature 2: `CLI-EXTRACT-BG-VANILLA`
- `T2-FEAT02-01`: Vanilla map without `Menu/init.con` (falls back to theater background based on map name).
- `T2-FEAT02-02`: Level RFA contains non-standard TGA format (e.g. RLE compressed or 16-bit TGA decoded cleanly).
- `T2-FEAT02-03`: Level override background path has relative `../../` escaping root (resolves safely).
- `T2-FEAT02-04`: Missing theater background TGA in `menu.rfa` (falls back to default `Western.tga`).
- `T2-FEAT02-05`: Level RFA contains truncated/corrupted TGA image data (reports corrupted asset error).

#### Feature 3: `CLI-EXTRACT-BG-EOD`
- `T2-FEAT03-01`: EoD level RFA missing `loader.tga` (falls back to EoD mod default background).
- `T2-FEAT03-02`: EoD level name contains special characters/apostrophes (`charlie_don't_surf` handled cleanly).
- `T2-FEAT03-03`: EoD `loader.tga` is non-standard dimensions (1024x768 resized or cropped to 800x600).
- `T2-FEAT03-04`: EoD mod directory path has lowercase `archives/` vs uppercase `Archives/` (case-insensitive).
- `T2-FEAT03-05`: Level archive is encrypted or invalid LZO stream (logs warning and skips level safely).

#### Feature 4: `CLI-EXTRACT-AUDIO`
- `T2-FEAT04-01`: Missing FFmpeg executable in environment (reports clear error message without Python traceback).
- `T2-FEAT04-02`: Input BIK file has no audio stream (silent dummy BIK - logs warning, skips audio).
- `T2-FEAT04-03`: BIK file uses unsupported audio compression codec (handles demux error cleanly).
- `T2-FEAT04-04`: Transcoded MP3 destination already exists without `--overwrite` (skips or safe overwrite).
- `T2-FEAT04-05`: Linux filesystem directory casing (`Music/` vs `music/` resolved case-insensitively).

#### Feature 5: `MANIFEST-GEN`
- `T2-FEAT05-01`: Existing `maps.json` has custom user fields (preserves custom fields during merge).
- `T2-FEAT05-02`: Existing `maps.json` is malformed JSON (creates backup and raises clean validation error).
- `T2-FEAT05-03`: Level name contains trailing spaces or unicode characters (sanitized in manifest).
- `T2-FEAT05-04`: Empty level catalog in `maps.json` (`[]` handled without indexing errors).
- `T2-FEAT05-05`: Concurrent manifest writes handled atomically (writes to temp file, then atomic replace).

#### Feature 6: `AUDIO-PLAYBACK`
- `T2-FEAT06-01`: Extremely short audio file (<1s) loops cleanly without buffer underrun.
- `T2-FEAT06-02`: Music URL returns HTTP 404 (audio controller fails silently without breaking visual UI).
- `T2-FEAT06-03`: Music stream stalls mid-load (network disconnect - playback recovers or stays silent).
- `T2-FEAT06-04`: Audio volume initialized to 0 (user has sound muted in viewer settings - stays silent).
- `T2-FEAT06-05`: Multiple rapid calls to `audioController.start()` with different URLs (cancels previous).

#### Feature 7: `AUDIO-FALLBACK`
- `T2-FEAT07-01`: Both primary and fallback music files return 404 (silent graceful operation).
- `T2-FEAT07-02`: Fallback audio URL is an invalid URI scheme (safely rejected).
- `T2-FEAT07-03`: Audio file format is unsupported by browser media engine (fails gracefully).
- `T2-FEAT07-04`: Switching fallback track while previous fallback is buffering (no memory leak).
- `T2-FEAT07-05`: Null/undefined manifest `music` field (defaults to standard fallback theme).

#### Feature 8: `AUDIO-AUTOPLAY-TRAP`
- `T2-FEAT08-01`: Browser throws synchronous exception instead of returning rejected promise.
- `T2-FEAT08-02`: Browser resolves promise but pauses audio immediately afterwards.
- `T2-FEAT08-03`: AudioContext starts in `suspended` state without calling `play()`.
- `T2-FEAT08-04`: Web Audio API unavailable in environment (headless or legacy browser fallback).
- `T2-FEAT08-05`: Autoplay allowed for muted audio but blocked for unmuted audio (auto-mute trap).

#### Feature 9: `AUDIO-GESTURE-UNLOCK`
- `T2-FEAT09-01`: User presses modifier key (Shift/Ctrl/Alt) instead of pointer click.
- `T2-FEAT09-02`: Gesture unlock occurs when audio is already playing (no-op, no glitch).
- `T2-FEAT09-03`: User clicks on document while `AudioContext.resume()` promise is pending (no race).
- `T2-FEAT09-04`: Touchstart event followed immediately by simulated mousedown (prevents double trigger).
- `T2-FEAT09-05`: Gesture unlock attempted in iframe with restricted permissions policy.

#### Feature 10: `AUDIO-UNMUTE-UI`
- `T2-FEAT10-01`: Viewport is very small (320x240 mobile) - unmute button does not overlap loading box.
- `T2-FEAT10-02`: Rapid clicking on unmute button (debounce click handler).
- `T2-FEAT10-03`: Unmute button keyboard accessibility (Enter/Space key triggers unmute).
- `T2-FEAT10-04`: High contrast mode or custom theme CSS does not make button invisible.
- `T2-FEAT10-05`: Unmute button DOM element removed cleanly if overlay is destroyed.

#### Feature 11: `AUDIO-FADEOUT`
- `T2-FEAT11-01`: Map loads in under 100ms (instant cache hit) - fadeout initiates while volume is low.
- `T2-FEAT11-02`: Fadeout called when audio is already paused or muted (no NaN/infinite gain errors).
- `T2-FEAT11-03`: Fade duration set to 0ms (instant cut without audio pop/click).
- `T2-FEAT11-04`: Cancel called during active fadeout (aborts fadeout immediately).
- `T2-FEAT11-05`: Page visibility changes (`document.hidden = true`) during fadeout (clamps volume).

#### Feature 12: `AUDIO-STALE-CANCEL`
- `T2-FEAT12-01`: User clicks exactly at the moment `load.end()` is resolving.
- `T2-FEAT12-02`: Rapid map switching: Map A load completes, Map B starts loading immediately.
- `T2-FEAT12-03`: Pending autoplay promise resolves AFTER map has completed loading.
- `T2-FEAT12-04`: AudioController instance re-used across multiple consecutive load sessions.
- `T2-FEAT12-05`: User triggers browser back/forward navigation during load.

#### Feature 13: `UI-VIRTUAL-COORDS`
- `T2-FEAT13-01`: Ultrawide viewport (3440x1440, 21:9) - verify centering and scaling bounds.
- `T2-FEAT13-02`: Super-tall portrait viewport (1080x1920, 9:16) - verify uniform letterbox.
- `T2-FEAT13-03`: Viewport dimensions zero or negative (`width = 0, height = 0`).
- `T2-FEAT13-04`: Device pixel ratio > 2.0 (Retina/HiDPI display scaling).
- `T2-FEAT13-05`: Zoom level changed dynamically (50% to 200%).

#### Feature 14: `UI-BG-ARTWORK`
- `T2-FEAT14-01`: Background image fails to load (HTTP 404) - displays authentic dark fallback canvas.
- `T2-FEAT14-02`: Extremely slow background image download - loading box renders immediately without waiting.
- `T2-FEAT14-03`: Background image URL is empty or null (renders default theater background).
- `T2-FEAT14-04`: Aspect ratio mode toggled dynamically between authentic stretch and modern cover.
- `T2-FEAT14-05`: Background image crossfade when switching maps.

#### Feature 15: `UI-BEVELED-BOX`
- `T2-FEAT15-01`: `menu_loading.png` asset fails to load (CSS-only fallback bevel renders cleanly).
- `T2-FEAT15-02`: Container placed in RTL (Right-to-Left) document direction (retains authentic alignment).
- `T2-FEAT15-03`: Sub-pixel rasterization alignment prevents blurry border edges.
- `T2-FEAT15-04`: DOM element re-attached to new parent container.
- `T2-FEAT15-05`: Extreme container scaling ($s < 0.25$ or $s > 4.0$).

#### Feature 16: `UI-TITLE-TYPOGRAPHY`
- `T2-FEAT16-01`: Extremely long map name (`INVASION_OF_THE_PHILIPPINES_HISTORICAL_EDITION` truncated/scaled).
- `T2-FEAT16-02`: Empty map name string (renders `"LOADING MAP"` default).
- `T2-FEAT16-03`: Map name containing special symbols/punctuation (`CHARLIE DON'T SURF` sanitized).
- `T2-FEAT16-04`: Map name with numbers and non-Latin characters.
- `T2-FEAT16-05`: Custom bitmap font texture missing (falls back to system Trebuchet MS).

#### Feature 17: `UI-MOD-THEME`
- `T2-FEAT17-01`: Unknown mod identifier in manifest (falls back to vanilla theme).
- `T2-FEAT17-02`: Mod theme specifies custom hex color overrides in manifest.
- `T2-FEAT17-03`: Mod theme switching during active load session.
- `T2-FEAT17-04`: Mod theme missing custom chrome sprite (falls back to vanilla sprite).
- `T2-FEAT17-05`: Dark mode / light mode OS preference does not alter game theme colors.

#### Feature 18: `ANIM-MONOTONIC-PROGRESS`
- `T2-FEAT18-01`: Out-of-order progress events received (50% then 30% - bar never steps backwards).
- `T2-FEAT18-02`: Instant progress jump from 0% to 100% (cache hit - enforces >=300ms smooth ramp).
- `T2-FEAT18-03`: Network download completely stalls for 10 seconds - bar holds steady without jitter.
- `T2-FEAT18-04`: Progress percentage clamped strictly between 0% and 100% (rejects negative or >100%).
- `T2-FEAT18-05`: `requestAnimationFrame` throttled by browser background tab.

#### Feature 19: `ANIM-WEIGHTED-STAGES`
- `T2-FEAT19-01`: Content-Length header missing on GLB download (indeterminate byte mode during download).
- `T2-FEAT19-02`: Zero-byte asset loaded (total bytes = 0 handled safely).
- `T2-FEAT19-03`: Skip intermediate stage (e.g. map has no terrain heightfield - smooth progress skip).
- `T2-FEAT19-04`: Download phase finishes before scene graph phase starts.
- `T2-FEAT19-05`: Scene construction takes significantly longer than download (heavy collider geometry).

#### Feature 20: `TRANS-SKIP-BRIEFING`
- `T2-FEAT20-01`: Escape key pressed during transition sequence (aborts or fast-forwards cleanly).
- `T2-FEAT20-02`: User clicks repeatedly during transition sequence (no re-entrant calls).
- `T2-FEAT20-03`: Briefing data present in level metadata but suppressed by transition controller.
- `T2-FEAT20-04`: Fast double-load triggered while transition in progress.
- `T2-FEAT20-05`: Map without briefing text or description.

#### Feature 21: `TRANS-GPU-WARMUP`
- `T2-FEAT21-01`: WebGL context lost during warmup render pass (`webglcontextlost` caught).
- `T2-FEAT21-02`: Scene has 0 meshes or lights (empty scene renders without error).
- `T2-FEAT21-03`: Shaders take >1000ms to compile (slow GPU fallback).
- `T2-FEAT21-04`: Renderer canvas resized during warmup pass.
- `T2-FEAT21-05`: Multi-material meshes with textures still decoding.

#### Feature 22: `TRANS-DIRECT-TO-SPAWN`
- `T2-FEAT22-01`: Level has 0 spawn points / control points (overview camera fallback).
- `T2-FEAT22-02`: `openDeploy()` throws exception (overlay dismisses safely without locking screen).
- `T2-FEAT22-03`: CSS transitions disabled (`prefers-reduced-motion: reduce` instant hide).
- `T2-FEAT22-04`: Transition interrupted by loading a new map.
- `T2-FEAT22-05`: Spawn screen DOM elements missing or unmounted.

---

### 5.3 Tier 3: Cross-Feature Combinations (18 Pairwise Tests)

- `T3-COMB-01`: **CLI Chrome Extraction ↔ UI Beveled Box**
  - Verifies extracted `menu_loading.png` dimensions (290x64) integrate directly into the UI container styling without pixel distortion or clipping.
- `T3-COMB-02`: **Vanilla Background Extraction ↔ UI Background Rendering**
  - Verifies extracted `pacific2.webp` loads into the loading overlay `<img>` tag and maintains 800x600 virtual proportions on 1920x1080 viewport.
- `T3-COMB-03`: **EoD Background Extraction ↔ UI Mod Theme**
  - Verifies extracted EoD `loader.webp` displays with EoD bamboo header `#B59B70` and cream progress bar `#F7E7B5`.
- `T3-COMB-04`: **Audio Extraction ↔ Audio Playback**
  - Verifies transcoded `vehicle4.mp3` from extraction pipeline streams and plays through the Web Audio playback controller.
- `T3-COMB-05`: **Manifest Generation ↔ Title Typography**
  - Verifies generated manifest title `"OPERATION HASTINGS"` is consumed by UI and rendered at `(10, 6)` in uppercase Trebuchet MS 8.
- `T3-COMB-06`: **Audio Autoplay Trap ↔ Unmute UI Button**
  - Verifies browser autoplay rejection immediately triggers the display of the authentic unmute badge.
- `T3-COMB-07`: **Audio Gesture Unlock ↔ Audio Looping Playback**
  - Verifies document click gesture unlocks playback and starts continuous looping track.
- `T3-COMB-08`: **Monotonic Progress Animation ↔ Weighted Stages**
  - Verifies weighted byte progress events (75%) and stage completions (25%) feed the monotonic 60fps smoothing filter without stepping backwards.
- `T3-COMB-09`: **Weighted Progress 100% ↔ GPU Warmup Render**
  - Verifies reaching 100% progress directly triggers the synchronous `renderer.render()` warmup pass before hiding the overlay.
- `T3-COMB-10`: **GPU Warmup Render ↔ Direct-to-Spawn Crossfade**
  - Verifies overlay opacity crossfade starts immediately after warmup render frame is presented, preventing blank flash.
- `T3-COMB-11`: **Audio Fadeout ↔ Direct-to-Spawn Crossfade**
  - Verifies audio gain ramp (800ms) runs synchronously with visual crossfade (400ms).
- `T3-COMB-12`: **Audio Stale Click Cancel ↔ Direct-to-Spawn Activation**
  - Verifies user interaction in the spawn screen post-transition does not trigger stale loading march music.
- `T3-COMB-13`: **UI Virtual Coordinate Scaling ↔ Beveled Box Placement**
  - Verifies box at (260, 465) scales and centers accurately when stage scale changes on window resize.
- `T3-COMB-14`: **UI Virtual Coordinate Scaling ↔ Unmute UI Positioning**
  - Verifies unmute badge scales proportionally with virtual coordinates and does not overlap box.
- `T3-COMB-15`: **Audio Fallback ↔ Autoplay Policy Trap**
  - Verifies fallback theme (`theme2.mp3`) is subjected to the same autoplay rejection trap when active.
- `T3-COMB-16`: **Skip Briefing Dialog ↔ Audio Fadeout Lifecycle**
  - Verifies skipping briefing allows audio fadeout to complete without pause or reset during briefing window.
- `T3-COMB-17`: **Mod Theme Switching ↔ Audio Mod Track Switching**
  - Verifies switching map from vanilla to EoD switches both theme color palette and audio track simultaneously.
- `T3-COMB-18`: **Manifest Lookup Fallback ↔ UI Artwork Fallback**
  - Verifies unmanifested level falls back to default theater background art and default audio track seamlessly.

---

### 5.4 Tier 4: Real-World Application Scenarios (6 Tests)

- `T4-SCEN-01`: **Wake Island Vanilla End-to-End Workflow**
  - Complete flow: CLI extracts Wake Island art (`pacific2.webp`), UI loads 800x600 layout with Pacific art and olive bar, plays `vehicle4.mp3`, streams 70MB GLB geometry, smoothly animates 0->100%, performs GPU warmup, fades audio over 800ms, skips briefing, and transitions directly into `#fullmap.deploy`.
- `T4-SCEN-02`: **Bocage Vanilla End-to-End Workflow**
  - Complete flow: Bocage level with Western2 art (`western2.webp`), `LOADING BOCAGE` title in Trebuchet MS 8, audio playback, monotonic progress through download, GPU warmup, and transition to spawn screen.
- `T4-SCEN-03`: **Eve of Destruction (EoD) Operation Hastings Workflow**
  - Complete flow: EoD mod level with custom `loader.webp`, EoD bamboo/khaki theme (`#F7E7B5`), EoD `vehicle4.mp3` audio track, progress bar animation, GPU warmup, and transition into Vietnam jungle spawn screen.
- `T4-SCEN-04`: **Instant Cache Hit & Smooth Ramp Workflow**
  - Complete flow: User visits previously loaded map (all assets cached in browser memory/disk). Progress accumulator avoids instant 0ms snap; smoothly ramps over enforced minimum animation duration (300-400ms) with gentle audio fadeout.
- `T4-SCEN-05`: **Blocked Autoplay Recovery & Interaction Workflow**
  - Complete flow: User opens map via direct URL in a fresh browser tab with strict autoplay blocking. Autoplay promise rejects; `[🔊 UNMUTE]` badge appears without console error; user clicks unmute button at 45% progress; audio starts smoothly; load completes; audio fades out over 800ms.
- `T4-SCEN-06`: **Rapid Mod & Map Switching Workflow**
  - Complete flow: User starts loading Wake Island (vanilla), then cancels at 40% and switches to EoD Operation Hastings. Audio stops immediately without lingering; theme switches from olive to bamboo; background updates; new load runs cleanly to completion.

---

## 6. Verification & Forensic Audit Protocol

### 6.1 Runner Verification Command
To verify that the runner and test suite infrastructure function correctly:
```bash
python3 -m tests.e2e.runner --tier all
```

### 6.2 Target Invalidation & Challenge Checks
1. **Assertion Completeness**: Ensure tests perform explicit assertions (`assertEqual`, `assertTrue`, `assertIn`) on outputs, not mere execution without exception.
2. **Deterministic Execution**: Tests must not rely on wall-clock `sleep()` timings; use mock timers or monotonic clock deltas.
3. **Clean Teardown**: Tempdirs and test artifacts created in `/tmp` must be cleaned up automatically in test teardown.
4. **Zero Network Calls**: Verify all network requests (`fetch`, `XMLHttpRequest`) are intercepted or resolved via local file protocol.
