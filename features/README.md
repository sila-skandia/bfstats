# Feature folders

Each folder holds one piece of work: the design, what was built, how it was
checked and what is open. This page lists every folder in one line, so you can
find the right one without opening forty.

The retail game's behaviour is recorded in
[bf1942-engine-reference](bf1942-engine-reference/README.md), in the ledger and
the subsystem notes. The `bf1942-knowledge` skill,
[`.claude/skills/bf1942-knowledge/SKILL.md`](../.claude/skills/bf1942-knowledge/SKILL.md),
maps each topic to its ledger prefixes, notes and folders, and says which copy
wins when they disagree.

When you add a folder, add its line here.
`tools/bf1942-models/tests/test_features_catalogue.py` fails until you do.

In the BF1942 tables, the kind says what a folder is. *research* reads the
retail game, *build* records what the viewer or pipeline built, *fix* is one
bug found and fixed, *design* is a plan, *tracker* follows many items, and
*pipeline* is extraction or publishing tooling. The question is the one the
folder answers.

## BF1942 in the browser

### The engine corpus and the big picture

| Folder | Kind | The question it answers |
|---|---|---|
| [bf1942-engine-reference](bf1942-engine-reference/README.md) | research | What does the retail engine do? The ledger, subsystem notes, symbols and tools |
| [bf1942-knowledge-map](bf1942-knowledge-map/README.md) | design | Why the docs stay where they are, and how a session finds what the repo knows |
| [bf1942-in-the-browser](bf1942-in-the-browser/README.md) | build | How were the play site's Instant Battle screen, console and Escape menu built? |
| [bf1942-3d-models](bf1942-3d-models/README.md) | research | The first per-topic studies: HUD, kits, seats, game modes, spawns, sounds, formats |
| [bf1942-parity-round-2026-09-19](bf1942-parity-round-2026-09-19/README.md) | tracker | What did each parity wave land, what is still open, and who owns it? |
| [desert-combat-parity](desert-combat-parity/README.md) | tracker | How much of Desert Combat works, what each fix package changed, what the real game confirmed, and what is open? |
| [bf1942-corpus-sweep-2026-09-18](bf1942-corpus-sweep-2026-09-18/README.md) | tracker | Which gaps found by the 09-18 corpus audit are still open, and why? |
| [parity-lab](parity-lab/README.md) | build | How do I record a real bot round and compare it with the viewer? |
| [server-replay-recorder](server-replay-recorder/README.md) | build | How does the lab server record the whole round itself, and what layout does it read? |
| [vehicle-instance-refactor](vehicle-instance-refactor/README.md) | build | Who owns vehicle, seat and page state now, and where did map.html code move? |
| [unreal-reimagining](unreal-reimagining/README.md) | design | How will BF1942 be ported to Unreal Engine 5, and in what order? |

### Extraction, level bakes and publishing

| Folder | Kind | The question it answers |
|---|---|---|
| [fh-mod-extraction](fh-mod-extraction/README.md) | tracker | How does Forgotten Hope get into the viewer, which FH maps change the game rules (push maps, one-way flags), and what did reading them change? |
| [level-bake-layers](level-bake-layers/README.md) | pipeline | Which layer and command ship a given level-data change without a full re-bake? |
| [level-reflection-cube-and-water-depth](level-reflection-cube-and-water-depth/README.md) | fix | Why did most mod levels' water draw flat and unreflecting, and why was the depth map mirrored? |
| [level-archive-mounts](level-archive-mounts/README.md) | fix | How does a level bake find another level's meshes, a level's own textures and templates, and the spawn points buildings carry? |
| [terrain-edge-wrap](terrain-edge-wrap/README.md) | build | What does the engine draw past the heightmap's edge, and how does the viewer repeat the terrain and the sea there without a re-bake? |
| [terrain-tile-grid](terrain-tile-grid/README.md) | fix | How big is the patch each Tx tile covers, which tiles does the engine draw, and why was Medina Ridge's ground scrambled? |
| [mesh-asset-size](mesh-asset-size/README.md) | pipeline | How are mesh assets made smaller losslessly, and how is each phase deployed? |
| [mesh-lod-chains](mesh-lod-chains/README.md) | build | Which LODs does retail draw for a static mesh, and at what distances? |
| [mesh-mod-assets](mesh-mod-assets/README.md) | pipeline | Where do mod extracts live, how are they published, and how is audio compressed? |
| [mod-extraction-pipeline](mod-extraction-pipeline/README.md) | pipeline | How is any mod extracted into the viewer with the recipe as code, and how much confidence does a level's tier carry? |
| [pose-asset-dedup](pose-asset-dedup/README.md) | pipeline | How are soldier poses split into rigs and recipes, and what remains before cutover? |
| [mesh-site](mesh-site/README.md) | pipeline | How is mesh.bfstats.io built, deployed, published to and cached? |
| [bf1942-cockpit-graft-hosts](bf1942-cockpit-graft-hosts/README.md) | fix | Why did some vehicle cockpits render distorted, and how are graft hosts kept? |
| [con-reader-spellings](con-reader-spellings/README.md) | fix | Why did DC's `setGeometry` parts draw nothing and its AC-130 come out small, and how does the con reader take a word and a mesh scale the way the console does? |

### Rendering

| Folder | Kind | The question it answers |
|---|---|---|
| [mesh-viewer-fidelity-defects](mesh-viewer-fidelity-defects/README.md) | research | What does retail do for tree collision, sniper fire/scope and tank driving/HUD? |
| [mesh-viewer-neutral-depth](mesh-viewer-neutral-depth/README.md) | build | What maps each mock element to code, and how do crew stations work? |
| [tree-foliage-billboards](tree-foliage-billboards/README.md) | fix | Why did trees render as bare sticks, and how are far billboards drawn? |

### Soldiers: movement, animation, cameras

| Folder | Kind | The question it answers |
|---|---|---|
| [viewer-swimming](viewer-swimming/README.md) | build | When does a soldier swim, float or drown, and how is it modelled? |
| [ladder-climbing](ladder-climbing/README.md) | build | How does a soldier grab, climb and leave a ladder, retail and viewer? |
| [viewer-parachute](viewer-parachute/README.md) | build | What happens in retail when a soldier bails out and opens his parachute? |
| [viewer-soldier-stance-and-blast](viewer-soldier-stance-and-blast/README.md) | build | What does a blast cost a soldier by stance, and which aim clips play? |
| [playable-map-death-and-prone](playable-map-death-and-prone/README.md) | build | How does a vehicle death reach the spawn screen, and why does prone slide? |
| [soldier-locomotion-animation](soldier-locomotion-animation/README.md) | build | How do soldiers get real walk and run animation from the game's .baf clips? |
| [soldier-death-animations](soldier-death-animations/README.md) | build | Which death animation does a killed soldier play, and how do rounds meet capsules? |
| [viewer-soldier-camera](viewer-soldier-camera/README.md) | research | What does the C key do to a soldier on foot and under a parachute? |
| [viewer-foot-first-person](viewer-foot-first-person/README.md) | build | Why can't a soldier on foot switch to third person anymore? |
| [viewer-third-person-soldier](viewer-third-person-soldier/README.md) | build | How is the third-person soldier body and parachute drawn and animated? |
| [bf1942-mouse-input](bf1942-mouse-input/README.md) | build | How does retail turn mouse movement into soldier look and turret traverse rates? |

### Weapons, projectiles and damage

| Folder | Kind | The question it answers |
|---|---|---|
| [grenade-viewmodel-and-throw](grenade-viewmodel-and-throw/README.md) | fix | Why was the held grenade misplaced and the thrown one invisible? |
| [kit-drops](kit-drops/README.md) | build | What happens to a dead soldier's kit, and who can pick it up? |
| [dc-mortar-and-kit-pads](dc-mortar-and-kit-pads/README.md) | build | How does Desert Combat's mortar deploy, and how do a map's kit pads hand out the M82 and Stinger kits? |
| [fhsw-random-kit-items](fhsw-random-kit-items/README.md) | fix | Which weapon does an FHSW `Random*` kit item hand a spawn, and why did FHSW soldiers wear vanilla uniforms? |
| [muzzle-effects-parity](muzzle-effects-parity/README.md) | build | Where do a gun's muzzle flash and casings come from, and how big are they? |
| [level-effects](level-effects/README.md) | build | How does a level ship its own effects, and what does a spawn effect (a ruined objective, a raft) stand up? |
| [flak-proximity-fuse](flak-proximity-fuse/README.md) | fix | Why did AA shells pass through planes, and how does the proximity fuse work? |
| [bf1942-blast-and-bounce](bf1942-blast-and-bounce/README.md) | build | How much does a blast hurt a soldier, and why do fused rounds bounce? |
| [plane-bombs-and-torpedoes](plane-bombs-and-torpedoes/README.md) | design | How do retail plane bombs and torpedoes behave, and how were they built? |
| [rocket-flight](rocket-flight/README.md) | build | How does a rocket fly: its gravity, its motor, and where does it land? |
| [dc-engine-reads](dc-engine-reads/README.md) | build | What do Desert Combat's `blastAmmoCount`, gun stabilization and `hasCollisionPhysics 0` really do? |
| [damage-parity](damage-parity/README.md) | build | Does a hand-weapon hit cost what retail charges, by body part and range? |
| [hand-weapon-barrels-sight-and-heat](hand-weapon-barrels-sight-and-heat/README.md) | build | Why did a shotgun fire a slug, what does a scope with no picture draw, how does a hand MG overheat, what opens the cone on a swing, and how does a shot shake the view? |
| [vehicle-rounds-hit-soldiers](vehicle-rounds-hit-soldiers/README.md) | fix | Why could AA and vehicle rounds not hit soldiers directly? |
| [vehicle-gun-deviation](vehicle-gun-deviation/README.md) | fix | Why did every vehicle and stationary gun fire with no deviation, and what cone does a seat gun run? |
| [viewer-collision-damage](viewer-collision-damage/README.md) | research | What does retail do when vehicles collide, burn and are destroyed? |
| [viewer-demolitions-and-spawn-safety](viewer-demolitions-and-spawn-safety/README.md) | fix | How do ExpPack and detonator work, and why did soldiers spawn inside buildings? |
| [viewer-healing-packs](viewer-healing-packs/README.md) | fix | How do the medic pack and wrench heal and repair, and how fast? |
| [viewer-combat-playtest-fixes](viewer-combat-playtest-fixes/README.md) | build | Which combat playtest bugs were fixed, and why does the B17 out-accelerate fighters? |

### Vehicles and seats

| Folder | Kind | The question it answers |
|---|---|---|
| [flyable-vehicles](flyable-vehicles/README.md) | research | How do BF1942 aircraft fly, take input and sound, per the shipped data? |
| [pilot-mouse-look](pilot-mouse-look/README.md) | build | Why does a pilot's view move only while the mouse-look key is held? |
| [bf1942-ships-research-2026-09-22](bf1942-ships-research-2026-09-22/README.md) | research | How do retail ships float, sink, steer and carry deck spawns? |
| [viewer-ships](viewer-ships/README.md) | build | How do ships float, steer, sink, beach and spawn soldiers in the viewer? |
| [carrier-destroyer-parity](carrier-destroyer-parity/README.md) | design | How should carrier deck planes, davits, beaching and destroyer turrets be fixed? |
| [maps-viewer-drivable-decks-and-reload-sound](maps-viewer-drivable-decks-and-reload-sound/README.md) | build | How do driven vehicles mount bridges and repair pads instead of hitting them? |
| [bf1942-seat-defects-2026-09-20](bf1942-seat-defects-2026-09-20/README.md) | fix | Why did tanks list, lose their 1P interior, crosshair and sound? |
| [vehicle-entry-team-rule](vehicle-entry-team-rule/README.md) | fix | When may a player or bot get into a vehicle someone else crews? |
| [teamonvehicle-is-a-bool](teamonvehicle-is-a-bool/README.md) | fix | Why did Midway spawn two Japanese fleets, and what does teamOnVehicle mean? |
| [vehicle-camera-toggle-sweep](vehicle-camera-toggle-sweep/README.md) | build | Which seats may cycle camera views, and what is the aircraft nose cam? |
| [artillery-spotting](artillery-spotting/README.md) | build | How does a scout's marker let an artillery gunner watch their shells land, and what of it does the viewer do? |
| [vehicle-radar](vehicle-radar/README.md) | build | What is the radar scope on Desert Combat's jets and anti-air hulls, and what does it show? |
| [bf1942-camera-pivot](bf1942-camera-pivot/README.md) | fix | Where does a vehicle seat's first-person eye sit, and what does setPivotPosition do? |
| [engine-axis-poses-nothing](engine-axis-poses-nothing/README.md) | fix | Why did Desert Combat's Humvee wheels orbit the hull, and does an Engine's axis ever pose it? |
| [vehicle-chase-and-tracks](vehicle-chase-and-tracks/README.md) | fix | Which node frames a seat's chase view, and how do a tank's track belts scroll? |
| [flag-cloth-and-ship-chase](flag-cloth-and-ship-chase/README.md) | fix | Why did a vehicle's flag hang upside down, and why did a PBR's front view sit under the water? |

### Collision

| Folder | Kind | The question it answers |
|---|---|---|
| [vehicle-collision-physics](vehicle-collision-physics/README.md) | research | How was vehicle collision researched and ported, and what evidence backs collision-response.md? |
| [viewer-ground-hull-collision](viewer-ground-hull-collision/README.md) | build | How do ground vehicles hit static buildings, and where does it diverge from the engine? |
| [articulated-hull-collision](articulated-hull-collision/README.md) | fix | Why did a lowered landing-craft ramp leave an invisible wall, and how was it fixed? |
| [sphere-sweep-plate-edges](sphere-sweep-plate-edges/README.md) | fix | Why did soldiers slide under thin plates, and what changed in the sphere sweep? |
| [barbed-wire-parity](barbed-wire-parity/README.md) | build | What does barbed wire do to soldiers and vehicles, and how is it modelled? |

### Bots

| Folder | Kind | The question it answers |
|---|---|---|
| [bf1942-ai-research-2026-09-21](bf1942-ai-research-2026-09-21/README.md) | research | How does retail BF1942's bot AI sense, decide, path, aim and scale difficulty? |
| [bf1942-ai-spec](bf1942-ai-spec/README.md) | design | What does each bot layer do, and where does every AI constant come from? |
| [bot-doctrines](bot-doctrines/README.md) | build | How do bots get orders, and how do I add or compare a doctrine? |
| [bot-garrison](bot-garrison/README.md) | build | Why do bots post one guard per flag, and where is it tuned? |
| [bot-weapons](bot-weapons/README.md) | build | Why did bots never reload or show rockets, and how do bot triggers fire? |
| [bot-gunner-aim](bot-gunner-aim/README.md) | build | How do retail bots aim and fire mounted guns, and why do AA bots miss? |
| [bot-stance-variety](bot-stance-variety/README.md) | build | Which pose does a retail bot take, and when may it change it? |
| [bot-body-animation](bot-body-animation/README.md) | build | Why did bots snap prone, and how do their bodies show stance, fire, reload? |
| [bot-friendly-fire](bot-friendly-fire/README.md) | build | Do retail rounds hit teammates, and how is friendly damage priced? |
| [bot-stalemates](bot-stalemates/README.md) | fix | Why did bot tanks and soldiers stop fighting at Bocage's bridges? |
| [bot-desert-combat](bot-desert-combat/README.md) | fix | Why could bots not board DC's A-10 variants or stood frozen in Change, and which DC hulls have no AI? |
| [instant-battle-bot-settings](instant-battle-bot-settings/README.md) | build | How do the Instant Battle bot controls map onto botCount and botSkill? |

### Game modes, spawns, HUD and menus

| Folder | Kind | The question it answers |
|---|---|---|
| [bf1942-map-player-capture](bf1942-map-player-capture/INVESTIGATION.md) | research | How does retail control-point capture work, and why did Bocage's neutral flags not capture? |
| [mode-script-statics](mode-script-statics/README.md) | build | Which statics do mode scripts place beyond StaticObjects.con, and in which modes? |
| [viewer-score-and-bleed](viewer-score-and-bleed/README.md) | build | How are scores awarded and tickets lost and bled in a retail round? |
| [authentic-spawn-map](authentic-spawn-map/README.md) | build | How are the spawn screen and minimap built from the game's own menu data? |
| [deploy-screen-spawn-points](deploy-screen-spawn-points/README.md) | build | Why were spawn rings missing, and where do ship deck spawns come from? |
| [vehicle-spawner-pads](vehicle-spawner-pads/README.md) | build | Which side's vehicle does a pad spawn, when does it come back, and when does a carried spawn die? |
| [briefing-screen](briefing-screen/README.md) | build | How is the briefing screen drawn from game assets and gated before spawning? |
| [mobile-four-finger-controls](mobile-four-finger-controls/README.md) | research | What should each of the four fingers control on the map page's touch layout? |
| [crosshair-hit-marks](crosshair-hit-marks/README.md) | build | When do crosshair hit marks appear, and why do tank shells land off-cross? |
| [hit-direction-wash](hit-direction-wash/README.md) | build | How does retail draw the red damage wash and hit-direction arc? |
| [minimap-friendly-arrows](minimap-friendly-arrows/README.md) | build | How are teammates and vehicles marked on the minimap and spawn map? |
| [hud-text-baseline-and-minimap-size](hud-text-baseline-and-minimap-size/README.md) | fix | Why was the minimap too wide and HUD text drawn too high? |
| [vehicle-hud-level-art](vehicle-hud-level-art/README.md) | fix | Why did the Flettner's HUD show the flak gun, and how does a level's own menu art and vehicle HUD reach the pack? |
| [scoreboard-row-colour-and-alignment](scoreboard-row-colour-and-alignment/README.md) | fix | What colours and vertical alignment do retail scoreboard rows use, and why? |
| [round-end-winner-screen](round-end-winner-screen/README.md) | build | What does retail do when a round ends: winner, debriefing, medals, cue, delay, reset? |
| [ctf-mode](ctf-mode/README.md) | build | How does retail Capture the Flag play, and how does the page draw, score and replicate it? |
| [viewer-demokit-icon](viewer-demokit-icon/README.md) | fix | Why did the ExpPack and Detonator show the medkit icon? |
| [viewer-map-focus-and-hint-line](viewer-map-focus-and-hint-line/README.md) | fix | Why were controls dead after closing the map, and where did the hint line go? |
| [multiplay-front-end](multiplay-front-end/README.md) | build | How is the MULTIPLAY server browser drawn from the game's own menu files? |
| [menu-background-movie](menu-background-movie/README.md) | fix | Why was there no looping movie behind the front end's tabs, and where does it come from? |
| [radio-and-chat-log](radio-and-chat-log/README.md) | build | How do retail radio commands and the top-left message log behave? |
| [viewer-profile-controls](viewer-profile-controls/README.md) | build | Where do key and joystick bindings come from, and how is a profile imported? |

### Sound

| Folder | Kind | The question it answers |
|---|---|---|
| [vehicle-sound-coverage](vehicle-sound-coverage/README.md) | fix | Why do tank machine guns honk or vehicles go silent, and what guards it? |
| [hand-weapon-sound-edges](hand-weapon-sound-edges/README.md) | build | What does a hand gun play when a burst stops and when its magazine is changed? |
| [world-vehicle-audio](world-vehicle-audio/README.md) | build | How do bot-driven hulls, others' gunfire and footsteps make positional sound? |
| [ambient-sound-parity](ambient-sound-parity/README.md) | fix | Why was Wake's surf audible everywhere, and how does retail attenuate level ambience? |
| [sound-listener-parity](sound-listener-parity/README.md) | build | Where is the retail sound listener, and which vehicle sounds ride on it? |
| [bf109-cockpit-and-vehicle-gun-audio](bf109-cockpit-and-vehicle-gun-audio/README.md) | fix | Why was the bf109 cockpit a smear and second vehicles' guns silent? |

### Netcode, recording and replay

| Folder | Kind | The question it answers |
|---|---|---|
| [netcode-play-multiplayer](netcode-play-multiplayer/README.md) | design | How is browser multiplayer built on the engine's authoritative-server model? |
| [round-replay-capture](round-replay-capture/README.md) | research | What does the server send a client, and what does a recording hold? |
| [round-replay-merge](round-replay-merge/README.md) | build | How are per-side recordings of one round merged, and when is merging refused? |
| [round-replay-fidelity](round-replay-fidelity/README.md) | build | Why does a replayed object look or sound wrong, and what drives it? |
| [round-replay-hud](round-replay-hud/README.md) | build | How faithfully does the replay place the crosshair and HUD in first person? |
| [round-replay-minimap](round-replay-minimap/README.md) | build | How does the replay minimap show both teams, and by which rules? |
| [round-replay-highlights](round-replay-highlights/README.md) | build | How does the replay find battles, streaks and top plays worth watching? |
| [round-replay-ux](round-replay-ux/README.md) | build | How does a viewer watch a replay: cameras, timeline, keys, layout, phones? |
| [round-replay-resilience](round-replay-resilience/README.md) | fix | Why could the replay freeze in first person, and how does it recover now? |
| [intel-gpu-msaa-hang](intel-gpu-msaa-hang/README.md) | fix | Why did replays hang Intel GPUs under Linux and crash Firefox, and why is MSAA off there? |
| [video-options](video-options/README.md) | build | What is on the game's OPTIONS > VIDEO screen, and where is anti-aliasing turned on or off? |
| [replay-creator-view](replay-creator-view/README.md) | build | How does the replay's creator view work, and who can open it? |
| [replay-feed](replay-feed/README.md) | build | How are shared recordings uploaded, listed, grouped into rounds and deployed? |
| [gameplay-recordings](gameplay-recordings/README.md) | pipeline | How do I publish a recording and share a link that opens the replay? |

### Game data on the stats site

| Folder | Kind | The question it answers |
|---|---|---|
| [map-dossier](map-dossier/README.md) | pipeline | How does the stats site turn a server's map name into a briefing? |
| [service-record](service-record/README.md) | build | How are a player's sessions attributed to armies and drawn as a service record? |
| [bf1942-map-thumbnails](bf1942-map-thumbnails/README.md) | pipeline | Where do map thumbnails come from, and how is one addressed and served? |
| [wrapped-music](wrapped-music/README.md) | pipeline | Where does the Wrapped background music come from, and how do I add tracks? |

### Performance

| Folder | Kind | The question it answers |
|---|---|---|
| [mesh-viewer-performance](mesh-viewer-performance/README.md) | build | Why does the map page stutter while firing, and which hot-path rules prevent it? |
| [bot-fight-performance](bot-fight-performance/README.md) | build | Where does frame time go in a 16-bot fight, and what is left? |
| [twelve-bot-performance-sweep](twelve-bot-performance-sweep/README.md) | build | Why did twelve bots on Bocage cut sound, show black squares and stutter? |
| [replay-performance](replay-performance/README.md) | build | Why did long replays stutter, and what rules keep replay code fast? |

## The stats site

### Tournaments

- [public-tournaments-v2](public-tournaments-v2/README.md): Public Tournaments — V2 Redesign
- [tournament-ui-spec](tournament-ui-spec/TOURNAMENT_UI_SPEC.md): Tournament API Specification
- [tournament-ui-backend-features](tournament-ui-backend-features/README.md): Tournament UI Backend Features - Navigation Redesign
- [tournament-leaderboard-implementation](tournament-leaderboard-implementation/TOURNAMENT_LEADERBOARD_IMPLEMENTATION.md): Tournament Leaderboard Implementation Plan
- [tournament-rounds-update](tournament-rounds-update/TOURNAMENT_ROUNDS_UPDATE.md): Tournament Rounds Update - Summary
- [tournament-comments](tournament-comments/README.md): Tournament Comments
- [tournament-rules-xss-prevention](tournament-rules-xss-prevention/TOURNAMENT_RULES_XSS_PREVENTION.md): Tournament Rules XSS Prevention Strategy
- [team-sign-ups](team-sign-ups/TEAM_SIGN_UPS.md): Tournament Team Registration Feature Plan
- [admin-tournament-changes](admin-tournament-changes/ADMIN_TOURNAMENT_CHANGES.md): Admin Tournament Controller Changes
- [api-schema-changes](api-schema-changes/API_SCHEMA_CHANGES.md): Tournament Match Results API Schema Changes
- [api-change-quick-reference](api-change-quick-reference/API_CHANGE_QUICK_REFERENCE.md): API Schema Changes - Quick Reference
- [logging-strategy](logging-strategy/LOGGING_STRATEGY.md): Tournament Leaderboard - Logging Strategy

### Players, servers and rounds

- [player-details-redesign](player-details-redesign/plan.md): Player Details Page Redesign
- [api-testing](api-testing/api-test-example.md): Enhanced Player Details API
- [player-trend-inspector](player-trend-inspector/README.md): Player trend inspector
- [player-relationships](player-relationships/README.md): Player Relationships - Graph Database Integration
- [player-alias-detection](player-alias-detection/DI_CONTAINER_FIX.md): Dependency Injection Container Fix
- [similar-players](similar-players/SIMILAR_PLAYERS_ALGORITHM.md): Similar Players Algorithm (ClickHouse-era)
- [server-population-trend](server-population-trend/README.md): Server population trend
- [servers-search-and-merge-basket](servers-search-and-merge-basket/README.md): Servers search + manual merge basket
- [leaderboard-server-filters](leaderboard-server-filters/README.md): Leaderboard server filters
- [game-trends-api](game-trends-api/GAME_TRENDS_API.md): Game Trends API
- [omnisearch-fts5](omnisearch-fts5/README.md): Omnisearch — FTS5 trigram index
- [round-report-resilience](round-report-resilience/README.md): Round report resilience
- [achievements](achievements/achievements.md): Battlefield 1942 Achievements & Badge Design Prompts
- [test-achievement-response](test-achievement-response/test-achievement-response.md): Testing the Enhanced Achievement Response
- [arcade-trivia-games](arcade-trivia-games/README.md): BFStats Arcade: Operation Intel (Trivia & Guessing Minigames)
- [landing-page-redesign](landing-page-redesign/README.md): Landing Page Redesign — Command Center (V3)
- [landing-live-data-freshness](landing-live-data-freshness/README.md): Landing page: show the last snapshot, chase the next one, say nothing

### Site-wide UI and accounts

- [v4-migration](v4-migration/README.md): V4 Theme Migration — Modern-Minimal Replaces Legacy
- [admin-v4-migration](admin-v4-migration/README.md): Admin V4 Migration — `/admin/data` to Neutral Depth
- [account-deletion-and-legal](account-deletion-and-legal/README.md): Account deletion, data export, and legal pages
- [oauth-implementation](oauth-implementation/OAUTH_IMPLEMENTATION_GUIDE.md): OAuth 2.0 Clean Implementation Guide
- [username-password-auth](username-password-auth/README.md): First-party username + password sign-in next to Discord
- [discord-oauth-backend-setup](discord-oauth-backend-setup/DISCORD_OAUTH_BACKEND_SETUP.md): Discord OAuth Backend Setup Guide
- [discord-oauth-quick-start](discord-oauth-quick-start/DISCORD_OAUTH_QUICK_START.md): Discord OAuth - Quick Start
- [logout-csrf-cors-mismatch](logout-csrf-cors-mismatch/README.md): Logout CSRF vs leftover munyard.dev CORS origin
- [discord-alerts](discord-alerts/discord-alerts-setup.md): Discord Alerts Setup

### Graph analytics (Neo4j)

- [neo4j-analytics](neo4j-analytics/implementation-plan.md): Neo4j Analytics Implementation Plan
- [community-detection-neo4j-lock](community-detection-neo4j-lock/README.md): Community detection vs Neo4j relationship sync

### Performance

- [perf-audit-2026-08](perf-audit-2026-08/FINDINGS.md): Live-site performance audit — landing / player details / server details
- [perf-cold-cache-2026-08-16](perf-cold-cache-2026-08-16/CLOUDFLARE.md): Cloudflare changes — bfstats.io
- [perf-latency-au](perf-latency-au/README.md): Perceived-speed work for distant clients (AU → Finland)
- [arcade-trivia-performance](arcade-trivia-performance/README.md): Arcade trivia performance
- [wrapped-crunch-performance](wrapped-crunch-performance/README.md): Player Wrapped crunch performance
- [slow-api-achievements-instr](slow-api-achievements-instr/README.md): Slow `GET /stats/gamification/achievements` — PlayerName / AchievementId `instr()` scan
- [slow-api-merge-candidates-network-graph](slow-api-merge-candidates-network-graph/README.md): Slow API: merge-candidates + player network-graph
- [slow-api-round-report-observations](slow-api-round-report-observations/README.md): Slow `GET /stats/rounds/{id}/report` — unbounded leftover observations
- [slow-api-rounds-duplicate-name](slow-api-rounds-duplicate-name/README.md): Slow `GET /stats/rounds` — duplicate exact `serverName`
- [slow-api-rounds-mapname](slow-api-rounds-mapname/README.md): Slow `GET /stats/rounds` — MapName `instr()` scan
- [slow-api-rounds-servername](slow-api-rounds-servername/README.md): Slow `GET /stats/rounds` — ServerName `instr()` scan
- [slow-api-server-banner-rounds](slow-api-server-banner-rounds/README.md): Slow API: server banner `Rounds` lookup
- [slow-api-server-proximity](slow-api-server-proximity/README.md): Slow `GET /stats/relationships/servers/{guid}/proximity`
- [slow-api-server-proximity-lookback](slow-api-server-proximity-lookback/README.md): Slow `GET /stats/relationships/servers/{guid}/proximity` — unbounded history

### Production incidents and monitoring

- [seq-dashboards](seq-dashboards/README.md): Seq dashboards — traffic + process health
- [seq-exception-api-recreate-connection-refused](seq-exception-api-recreate-connection-refused/README.md): Seq Exceptions: notifications connection refused during API Recreate
- [seq-exception-bflist-404-banner](seq-exception-bflist-404-banner/README.md): Seq Exceptions page from banner BFList 404s
- [seq-exception-collection-shutdown](seq-exception-collection-shutdown/README.md): Seq Exceptions: stats collection MemoryCache dispose on Recreate
- [seq-exception-ranking-shutdown](seq-exception-ranking-shutdown/README.md): Seq `bfstats/Exceptions` — ranking shutdown cancellation
- [seq-exception-signal-noise](seq-exception-signal-noise/README.md): Seq `bfstats/Exceptions` signal noise
- [seq-exception-signalr-idle-timeout](seq-exception-signalr-idle-timeout/README.md): Seq exception: SignalR idle timeout
- [seq-exception-whitespace-buddy-name](seq-exception-whitespace-buddy-name/README.md): Seq Exceptions: whitespace-only buddy player name
- [seq-liveservers-bflist-timeout](seq-liveservers-bflist-timeout/README.md): Seq: liveservers waits 30s on BFList before using last-known-good
- [seq-liveservers-single-server](seq-liveservers-single-server/README.md): Seq: single-server liveservers waits on BFList then 500s
- [observability-monitoring](observability-monitoring/README-observability.md): Observability Stack Setup
- [production-snippets](production-snippets/PRODUCTION_SNIPPETS.md): Production Snippets

### Engineering and testing

- [worktree-pre-pr-verification](worktree-pre-pr-verification/README.md): Verifying a worktree before it becomes a PR
- [isolated-e2e-worktrees](isolated-e2e-worktrees/README.md): Isolated E2E runs across git worktrees
- [e2e-real-data-fixtures](e2e-real-data-fixtures/README.md): Real-data E2E fixtures, isolated per worktree
- [dotnet-analyzers](dotnet-analyzers/README.md): .NET analyzers and warnings-as-errors
- [code-quality-refactoring](code-quality-refactoring/FINAL_STATUS.md): Code Quality Refactoring - Final Status
- [cursor-pr-auto-review](cursor-pr-auto-review/README.md): Automatic Claude review of Cursor SRE pull requests

### Single files

- [competitive-rankings.md](competitive-rankings.md): Competitive Rankings Feature for Data Explorer
- [grafana-background-job-correlation.md](grafana-background-job-correlation.md): Background Job Correlation Dashboard
- [neo4j-backfill-testing.md](neo4j-backfill-testing.md): Neo4j Back-fill Testing Guide
- [neo4j-daily-sync.md](neo4j-daily-sync.md): Neo4j Daily Relationship Sync
- [neo4j-empty-names-fix.md](neo4j-empty-names-fix.md): Neo4j Empty Player Names Issue
- [neo4j-paging-fix.md](neo4j-paging-fix.md): Neo4j Sync Paging Fix
- [neo4j-testing-summary.md](neo4j-testing-summary.md): Neo4j Back-fill Testing Summary
- [neo4j-whitespace-fix.md](neo4j-whitespace-fix.md): Neo4j Player Name Whitespace Issue
- [player-map-details.md](player-map-details.md): Player Map Details Feature
- [player-server-map-detail-integration.md](player-server-map-detail-integration.md): Player Server Map Detail Integration
