# Agent registry (lead's notes)
wave 1 fix agents (worktree, background), launched 2026-10-06:
- air-flight      a3ebbf5bd5063a80b  port 5611
- air-input       a09e4ba761602b48f  port 5612
- ground-chassis  a96391e7374829f6b  port 5613
- rounds          aa72863a5642df6db  port 5614
- hand-weapons    a08365fc0de41111f  port 5615
- kit-pickups     a84ec8081a9098a6d  port 5616
- spawner-pads    a779345840402c239  port 5617
- bots            a28699fc8f9384781  (sim only)
census reports: ~/.cache/dc-sweep/reports/{air,ground,weapons,levels,soldier}.md
extract a finished agent's report: python3 ~/.cache/dc-sweep/extract_report.py <tasks/ID.output> <dst>
landing: cherry-pick onto a branch at origin/main in a throwaway worktree, test, ff local main safely (replay session dirty files in main checkout), push.
wave 2 queue: ctf, round-end, sound, artillery-spotting, static-nimitz+small words+depot types, terrain grid (Medina), knockback+soldier numbers, player-flown missiles, DC scripted objectives, polish
asset jobs for lead: DC/DCF aircraft --cockpit re-extract (+UH-60 none?), Pacific tree billboards DC, weapon sounds re-extract (release tails), stale DC scene bakes vs 73426358 seat-gun deviation
owner decision: fixed-wing throttle held axis (vanilla too)
owner directive 2026-10-06: run fix + adversarial agents recursively until exhausted; verify against real game via server recorder; never hand gaps back as "next". memory: feedback_orchestrate_until_exhausted.md
- dc-lab           a143677afe141e2ca  port 5620 (worktree) - DC on lab server, rec rounds, ground truth extractor
- adv-modsystem    ade3fa87a57c4f246  (read-only) - conventions vs vanilla, tree freshness, fallbacks, mod path
- adv-conwords     af67e20a7c1f57e0e  (read-only) - every con command DC uses vs parsed/delivered/read
LOOP per fix agent completion: spawn adversarial reviewer on its branch (break it + vanilla unchanged) -> land -> new findings -> new fix agents
after wave 1 lands: adv-play-vehicles (drive/fly every DC vehicle, all controls), adv-fire-weapons (fire every kit + vehicle weapon), then wave 2 fix agents
wave 2 early (no wave-1 file overlap):
- terrain-grid     ac77c8d942574873d  port 5621
- round-rules      ae41727e97787bba1  port 5622 (CTF + round end)
- sounds           a20481fc1ba4e03dc  port 5623 (release tails, vehicle gun release, reload foley, part sounds)
- data-words       aeee2813062b96bbd  port 5624 (hasMobilePhysics, depot vehicleTypes, CIWS, random geoms, OSA beach)
queued: artillery-spotting (after hand-weapons lands), knockback+soldier numbers, player-flown missiles (after rounds), projectile flight sounds (after rounds), fixed-wing engine law (after air-flight+air-input), DC scripted objectives (after spawner-pads), polish (kill-feed case, 6 slots rooms, random heads, credits), adv-play-vehicles + adv-fire-weapons (after wave 1)
- soldier-blast    afe34b28b14293bcc  port 5625 (knockback, soldier numbers, random heads)
reviews:
- review kit-pickups  a29f53faf3e2d3bec  port 5631   (fix done: commits 360b5582 b2604f5f f4f12c23; asset cmds in reports/fix-kit-pickups.md)
- review air-input    a429fafeb8a010f85  port 5632   (fix done: 9b715702 870beea7)
follow-ups from air-input: rememberExcessInput in vehicle-base.js advanceSurfaces (fixed-wing pkg); stale spring comments flight_harness.mjs ~1665, seat-camera.js:463, test-hooks.js; ship pitch spring vs 0.001s key law
follow-ups from kit-pickups: FHSW telemark ObjectSpawns.con parse error (Object.absolutePosition no arg); extract_pose --kit-poses lacks pads (service record); team switch destroys carried pad kit?; symbols.json for new addresses
- review air-flight (fix done 18bd2bf1..6e653382)
adversarial round 1 results: reports/adv-conwords.md, reports/adv-modsystem.md
- con-reader      afeb6e4077bf05be1  port 5626 (set-prefix spellings CW1/16, GeometryTemplate.scale CW5, toggleMouseLook export CW13)
- engine-reads    a3c87e7c8f9ebab90  port 5627 (blastAmmoCount CW6, stabilization CW7, hasCollisionPhysics CW14)
- ai-scripts      ae1becce9668d79aa  URGENT (load_order drops /ai/ -> loadouts aiWeapons + coverValues; vanilla live already regressed 10-03) BLOCKS all asset re-extracts
- dof-effects     a7806745e960f1d75  port 5628 (fireInCameraDof export MS-4, level effects MS-5)
scope added by message: ground-chassis +CW2 upside-down, CW10 steer dir, CW11 Ural ramp; rounds +CW4 hasOnTimeEffect; hand-weapons +CW3 turnDev (MLK-7); spawner-pads +Forklift VCSea; bots +CW9 timeToGetControl 0, CW12 exitVelocity; sounds: item2 is data-only (no 2nd trigger)
queued: CW8 vehicle death explosion; CW15 fire camera shakes (after hand-weapons); MS-7 poses/index.json (asset, lead); WP-B sounds re-patch DC/DCF (asset, lead, after sounds agent confirms); MS-9 Medina landslide run graph; MS-10 mod chain fallbacks; Nimitz Lcvp_h basename texture fallback (engine read)
ASSET ORDER: ai-scripts lands -> kit-pickups extracts -> sounds re-patch -> full DC/DCF model re-extract (cockpit, setGeometry, scale, dof, deviation) -> full scene re-bake -> optimise -> publish
- review hand-weapons a8e8c9753821617b4 port 5634 (fix done a738343f..f95b72c8; ee962a9e heat law changes vanilla MGs - verify vs lab recordings; asset cmds in report)
added: rounds +DEV-9 square cone; bots +shotgun pellets via hand-aim.js (depends on hand-weapons landing)
lab progress: DC runs recorded: dc-el_alamein, dc-guadalcanal, dc-bocage_day2, dc-bocage (2026-10-06 21:23-22:12)
LANDED (local main + origin): 9fc672db ai-scripts; e46d53b4 43035c70 9c417cec air-input(+review fixes). PUBLISHED: vanilla/xpack1/xpack2 loadouts.json (24/28/32 aiWeapons live)
- air-input-2      ae291f922d2df9512  port 5629 (non-pilot air seats Air profile, slot max rule, cockpit look limits, netcode analogue rudder, ship pitch spring, rememberExcessInput)
2026-10-07: session limit killed all agents ~00:20; resumed all via SendMessage; air-input-2 restarted as a378e38d6be9db02d
ground-chassis DONE (73673098..bdb6e385). LEDGER CLASH: ground COL-13 (geometry box per vehicle class) vs air-flight COL-13 (inertiaModifier axis order) + COL-14 (AC-130 geometry box) -> reconcile at landing
queued: hull-vs-terrain collision (steep face launches vehicles 716 m/s; on main) after ground-chassis lands
batch2 in dc-land: kit-pickups(7) + air-flight(8, need 9cb76c6c too) + terrain-grid(5); full suite running (b58603v6v)
queued: geometry-box pkg (exporter: .sm header bounds + LOD selector class in extras; hullGeometry full COL-14 search w/ header box; aircraft+ships; fixes Mi-24 climb 12->24, AC-130) AFTER ground-chassis lands
queued: ground follow-up: hull-vs-terrain steep launch, undrawn patch sea floor, critical damage stops ground engines (PHY-14), helicopter nose rises on ground after landing
queued: team switch should kill soldier (kit drops), EoD _CHUTE (out of scope)
LANDED batch2 6318bfe9: kit-pickups, air-flight, terrain-grid. ASSETS RUN: DC loadouts/kits/vm (47 aiWeapons, 52 kits), DCF kits; poses-only kits running (assets-kits-poses.log); NOT YET PUBLISHED
hand-weapons in dc-land, suite running (bafeeo0zh)
dof-effects DONE -> review. queued: MS-9 NFZ day1 objective objects missing; ledger ARM-8..10 + EMT-9 cited but missing; level bundle sounds; ruin collider/damage
queued hand-weapons-2: refused-pull lockout restart, CW15 fire camera shakes, grenade hold-to-charge, kit pickup heat (KITDROP-7), projectile first sweep start (engine read), RPG prone slope spawn
LANDED 1597cff6: hand-weapons (+loadouts test helper pads fix). rounds DONE -> review
round-rules DONE -> review. queued: rooms load only default layer (no CTF in rooms); hulls back to pads on restart; ticket blink; ghidra_label.py 0x006E4290 mislabel
con-reader DONE -> review (needs full model re-extract all 5 trees + level bakes vanilla 6, x1 7, x2 7, DC 35, DCF 47). DISK 96% 25G free. I wiped dc-sweep/tmp at 01:05 by mistake; notified agents
spawner-pads DONE -> review. queued: TKT-5 bleed when side has no spawns (round-state.js after round-rules); AC-130 spawn point riding; kit pad neutral switch in deployables-page.js
soldier-blast DONE -> review. queued: remote players thrown (room server splash + wire), vehicles pushed by blasts, fire while flying (hand-weapon.js), prone toggle after landing, random heads (roll order unread)
data-words DONE -> review a197fb731a7374d9b (renumber PHY-16->17). LEDGER_IDS.md registry created + FIX_BRIEF rule.
queued for bots: Nimitz_Static bare-seat skip; sim/stage.mjs no depots
open decision: stamp stationary guns hasMobilePhysics (every level re-bake)
reviews in flight: ground-chassis ac1abbf752798ce7a, sounds a864af60bd19ec1ed, dof-effects a83d507e4514ffc2d, rounds aa98d996165d2f922, round-rules a5353de6870305ab3, con-reader aa367e4c4d7697d12, spawner-pads ae7192160c94b7c52, soldier-blast a940b252b375b484a, data-words a197fb731a7374d9b
fix agents in flight: engine-reads a3c87e7c8f9ebab90, bots a28699fc8f9384781, air-input-2 a378e38d6be9db02d, hand-weapons-2 a10adb9500e8e7c21, dc-lab a143677afe141e2ca
engine-reads DONE -> review. MERGE ORDER: con-reader before engine-reads. follow-ups: hand-fire.js multi-barrel charge w/o blastAmmoCount (hand-weapons-2); vehicle collision rule pkg (48/55 vanilla vehicles ship untested hulls); con.py truthy() bool>=2
dof-effects cherry-picked into dc-land (8 commits), suite running -> land-batch4.log. queued pkg: spawned objects get bodies (raft float, ruin collider/damage, NFZ ruin frame); hold _shared effects re-bake until then; publish level effects glbs before maps.json; replay spawn emitters (replay session); netcode object damage not sent
LANDED dbbf7f11: dof-effects. spawned-objects a7ae19bac47017fc1 port 5647
air-input-2 DONE (10 commits on 9c417cec) -> review after ground-chassis lands; CONFLICT: world-vehicle-tick ship-pitch if (keep ship||bindsPitch with setInput body), forklift test to step law. queued: ramps without automaticReset hold position (clipAngleStep) - ships/ground pkg; console key slot (MLK-15)
LANDED e39fc803: ground-chassis (merge commit; symbols merged by address)
- review air-input-2 aa880aabdca8f9309 port 5648 (merge main into branch first)
- ground-handling   af7d6517bf2b42c8d port 5649 (DPV/BRDM yaw vs lab, tank top speed T-72 springs, XPack2 bikes reverse, KettenKrad, critical stops ground engines, Krupp drag)
- terrain-contact   a40116b8a798088be port 5650 (steep face launch, raw heightmap floor, rooms G2, heli nose rising on ground)
FHSW kit re-extract KILLED at 36GB RSS / 57 min (pad scan memory blowup; reviewer saw 27GB unfixed). FHSW kits.json untouched. Queue: extract_kits memory on FHSW (pad scan per-level library builds)
PUBLISHED: textures+models (DC/DCF kits+vm incl heat, FH/bf1918/GCMOD/interstate kits + re-optimised poses), DC loadouts (47 aiW live)
dc-land: merged rounds (74dc9b4d) + sounds; suite running bvw4njuwm
queued after landing: vehicle-gun deviation pkg (vehicle guns launch with no cone; Sherman Browning minDev 0.5); fixed-wing engine law pkg (throttle AR + reverse, /3 inertia + no gyro + COL-13 order for fixed wing, header box AC-130 vs retail 36.7, autoGear gearUpEngineInput, gear thresholds, afterburner rpm) verify vs lab vanilla plane numbers; audio budget perf (HRTF panners per jet); netcode reloads; AC-130 howitzer sound DCF
asset jobs pending after code lands: weapon sounds re-extract x5 trees + sounds layer patch x5; damage layer x5 (hasOnTimeEffect, tracer gravity, forceOnExplosion); spawns layer x5; game layer x5 (debriefing); flag models + hud pack + radio layout (CTF); gaits soldierBody x trees; effects _shared hold until spawned-objects; DC/DCF full model re-extract (cockpit, setGeometry, scale, dof, deviation, box, hasMobilePhysics) + full level re-bake; Medina
con-reader REVIEW: LAND WITH FIXES (5 commits). land after batch6 suite. BLOCKER for air-input-2: seatLookSigns sign(accel)*sign(maxSpeed) - sent to its reviewer. follow-ups: geometryScale divide-out in physics measurements (aircraft wheel contact, measureWheelRadius, chase radius, repair reach); keep invisible physics parts collision (Flettner, Elco, KettenKrad)
engine-reads REVIEW: LAND WITH FIXES after con-reader; conflicts ledger, manned-guns, symbols (join findLodGeometry notes), con.py keep both; add setHasCollisionPhysics 1 to Hull bundle in test_assemble GeometryScaleExportTests.LIBRARY. lab check: static wrecks passable?
spawner-pads REVIEW: LAND WITH FIXES (4 commits; SPAWN-13 conflict keep main's). follow-ups: rooms run no pads/respawn (server); disableWhenLosingControl; spawnDelayAtStart vs pregame setTeam (DCF Cornered); TKT-5 bleed; AC-130 spawn riding
LANDED a8bbe93e: con-reader, engine-reads, spawner-pads, data-words (+con.py set-twin fix). PUBLISHED sounds+damage layers all 5 trees + weapon sounds.
2nd usage limit ~03:00; resumed 8 agents. ground-handling worktree recreated: .claude/worktrees/agent-ground-handling (branch worktree-agent-ground-handling)
round-rules merged in dc-land + seam patch; suite b30htqjws. DC/DCF model re-extract into ~/.cache/dc-sweep/rex running (rex-models.log)
OWNER REAL-PLAY LIST: (1) human drive: DPV 12-15 m/s full throttle+lock 4s x3 each way; BRDM-2 15-18; DPV from standstill; T-72/M1A1 20s full throttle level (lab, bf42plus client). (2) Harrier hover attitude (bots fly it as a plane). (3) land vehicle driving into deep water. (4) one browser pixel = one mouse count? (5) static wreck passable?
LANDED 16b7a740 air-input-2, 622acee6 soldier-blast, 3cc3ff27 dc-lab + desert-combat-parity README (tracker). 
ASSETS: DC + DCF models re-extracted (rex/), installed in place (install-models.py) + optimised; level-local templates too. NOT published yet. DC level bake running (bake-dc.log), snapshot ~/.cache/dc-sweep/snap-maps-desertcombat (hard links)
- review hand-weapons-2 a8abbd1173ed3c82f port 5651
- review bots         ac2480ca47d5bcc51
- fixed-wing          af900aeea9f96ae0a port 5652
- vehicle-deviation   a152080cc0137af71 port 5653
- rooms               a1ec44a982eed3867 port 5654
- round-gaps          a88565c3a21ee7c89 port 5655
in flight still: terrain-contact a40116b8a798088be, ground-handling af7d6517bf2b42c8d (worktree agent-ground-handling), spawned-objects a7ae19bac47017fc1
after DC+DCF bake+publish: adversarial play-everything sweep (read-only), DC Final audit; thumbs for changed models; build_mods_manifest; level effects (extract_effects --levels) publish level glbs before maps.json; vanilla/xpack bakes for con-reader levels (6/7/7) + data-words (BoB, Caen) + engine-reads roof lamps; viewmodels re-extract (hand-weapons-2 after landing); vehicle-ai.json re-extract x5 (bots after landing); spawns/game/damage layers vanilla+xpack (spawner-pads, round-rules, soldier-blast); gaits soldierBody (extract_pose --die) all trees; flag models + hud pack + radio layout (round-rules)
REGRESSION (lead): re-extracted DC/DCF helicopters (con-reader setGeometry parts w/ collision) broke test_flight (AH64 climbs 0.5m). Stopgap: old exporter worktree ~/.cache/dc-sweep/oldexp @b85016b5 re-extracted helis -> installed; test_flight OK. Fix agent: vehicle-part-collision ae397085bc667ec4a (COL-17 for vehicles). New heli glbs in rex/ for its testing.
- review spawned-objects aefbb979bbbbbad77 port 5657
NOTE: DC level bake (running) bakes placed vehicles with new exporter -> scene.glb helicopters will carry new parts too (level bake doesn't use models tree for placed vehicles? check) 
status sent to owner ~07:00
killed stale FHSW wait loops (pgrep self-match) 691077 1212628 1231976
terrain-contact DONE -> review. assets: patch_scene --layer heightmap x5 trees. found: rooms land vehicles never moved (wheel meshes not decoded on server) - fixed
- review terrain-contact a64cc4dd5dd04419e port 5658
ground-handling DONE (branch worktree-agent-ground-handling) -> review. assets: KettenKrad/Elco80 vanilla, R75/HD_XA42/LVT4 xpack2 models + bakes listed
- review ground-handling a68fafe959523cd3d port 5659
LANDED 1cf7d440: hand-weapons-2 (+ blastAmmoCount always written; legacy export -> 1 round/pull) + test fixes (BoB Conquest factory carrier group 99 legit; A-10 false)
viewmodels re-extract running (assets-vm.log) -> publish viewmodels only via staging root
HOLD publish of re-extracted DC/DCF vehicle models + DC level bake until vehicle-part-collision lands; then full re-extract + re-bake DC/DCF once (also picks up spawned-objects, ground-handling hidden wheels, terrain heightmap layer)
PUBLISHED viewmodels (vanilla/DC/DCF: cameraShake, heat, blastAmmoCount). 7f5b1346 tracked MP40/Thompson fixtures committed.
spawned-objects merged in dc-land, suite b4ifj3qeu
follow-ups from reviews: replay skip spawn emitters (replay session); restartMap destroys SimpleObject wrecks (round-gaps); placed effect bundles (child bundles of placed objects not drawn/sounded); addOwner repack 10-25ms; spawned object ids over wire (rooms)
bots REVIEW: LAND WITH FIXES. queued after spawned-objects suite. new pkg: seated gunners bail (Bocage 37% vs retail 4-7%)
- bot-gunners ab6c80a912c4768e8 (seated gunners bail; retail Bocage LOD0 recording 20261007-060803)
vehicle-part-collision DONE: cause = hullGeometry counted Bundle/LodObject mesh children (ship-spec.js 9 lines); COL-19; COL-17-for-vehicles measured not built (own pkg); DC/DCF collision-meshes.json rebuild
- review vehicle-part-collision a4bbd07eaa8284a85 port 5660
terrain-contact REVIEW: LAND WITH FIXES. new pkg: load-settle vs statics (replace standsOverTheSea; Wasserfall, SA-342G, BMP1, Stryker drops) + aircraft rest on wheel contacts; Sea Rigs bot boat maps
ground-handling REVIEW: LAND WITH FIXES; merge after batch12 suite. assets: vanilla KettenKrad Elco80 Type38 (+Truk), xpack2 R75 HD_XA42 LVT4; bakes v3 x1 3 x2 12
