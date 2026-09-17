# Original User Request

## 2026-09-16T01:41:13Z

Implement an authentic Battlefield 1942 and mod map loading screen with progress bar animation in the 3D mesh viewer (`tools/bf1942-models/viewer/map.html`). The screen replaces the current minimal loading card with authentic background artwork, beveled progress bar container, map title, and map-specific loading music (supporting vanilla BF1942 and mods like Eve of Destruction [EoD]), smoothly fading out audio and transitioning directly to the spawn screen / 3D map once assets finish loading.

Working directory: /home/dylan/projects/skandia/bfstats
Integrity mode: development

## Reference Materials & Verification Resources
- Gameplay video recording of authentic loading screen and transition: `/home/dylan/2026-09-16 11-28-09-00.00.14.958-00.00.23.332.mp4`
- Engine reverse-engineering framework & ledger: `features/bf1942-engine-reference/ledger.md`, `features/bf1942-engine-reference/symbols.json`, and `xref.py`
- Mod extraction guidance and conventions: `.agents/skills/bf1942-mod-extraction/SKILL.md` (specifically §10 UI, HUD & Menu Art)
- Existing layout and font readers: `tools/bf1942-models/bf42/` (`meme.py`, `font.py`) and existing HUD extraction pipelines in `tools/bf1942-models/`

## Requirements

### R1. Authentic Loading Screen Visuals & Progress Animation
Replace the minimal progress card with a full-viewport authentic BF1942 loading screen interface:
- Display high-fidelity map loading background artwork matching the requested map.
- Render the authentic metallic beveled loading box containing the map title (`LOADING <MAP NAME>`) and the authentic progress bar.
- The progress bar must animate smoothly from 0% to 100% driven by actual download and scene construction progress (GLB geometry, textures, colliders).
- Support responsive scaling matching the Refractor 800x600 virtual coordinate presentation.

### R2. Map-Specific Loading Music & Audio Pipeline
Investigate and implement map-specific loading music:
- Reverse-engineer and extract loading music assignments from game archives, specifically investigating the Eve of Destruction (EoD) mod alongside vanilla BF1942.
- Stream or play the appropriate map-specific loading music while the map is loading, falling back to default loading theme if a map has no custom track.
- Handle browser autoplay restrictions robustly (e.g., auto-start on user gesture or graceful muted fallback with un-mute indicator).

### R3. Smooth Direct-to-Spawn Transition
When asset loading reaches 100% and the scene is initialized:
- Skip the server rules/briefing dialog displayed by the original game client.
- Smoothly fade out the loading music.
- Transition directly into the interactive spawn screen / 3D map view without visual flicker or unrendered frames.

### R4. Asset Extraction & Manifest Tooling
Provide an extraction workflow that extracts loading screen textures (DDS -> web-ready format) and loading audio tracks from the local BF1942 installation (`/home/dylan/.wine/drive_c/EA Games/Battlefield 1942/` and `/home/dylan/.wine/drive_c/EAGames/Battlefield 1942/` for BF1942 and EoD), outputting a lookup manifest connecting map IDs to their background art and music files.

## Acceptance Criteria

### Visual & Layout Fidelity
- [ ] Loading view displays the authentic map background texture for vanilla maps (e.g. Wake Island) and EoD maps when loaded in `map.html`.
- [ ] The loading box matches the authentic visual structure: map title uppercase text, beveled frame, and progress bar fill.
- [ ] Progress bar advances monotonically with scene loading progress without snapping instantly from 0 to 100%.

### Audio Fidelity & Lifecycle
- [ ] Maps with distinct loading tracks (including verified EoD maps) play their specific music during load.
- [ ] Maps without specific tracks fall back to the standard BF1942 loading theme.
- [ ] Audio fades out cleanly over 500ms-1500ms when scene loading finishes rather than cutting off abruptly.
- [ ] Audio playback does not throw uncaught console errors if browser autoplay policy delays playback.

### Flow & Transition
- [ ] The server rules / briefing screen is bypassed, transitioning directly from loading screen to the spawn screen / 3D scene.
- [ ] Transition reveals the fully rendered scene with no momentary blank or untextured terrain flash.

### Pipeline & Manifest Verification
- [ ] Automated extraction script successfully parses and extracts loading backgrounds and audio for all vanilla BF1942 maps and EoD maps.
- [ ] Generated manifest maps each level to its corresponding background image path and music track path.
