# Ledger ID claims (DC parity round)
Before writing a new ledger row, check this file and append your claim under the lock:
  flock ~/.cache/dc-sweep/ledger.lock sh -c 'cat ~/.cache/dc-sweep/LEDGER_IDS.md; echo "PREFIX-N <package> <one-line topic>" >> ~/.cache/dc-sweep/LEDGER_IDS.md'
Take the next number after BOTH main's ledger and every claim below.

## Claimed (main max at 2026-10-07 01:30: PHY-15 SM-12 COL-14 KNOCK-3 SUP-17 HP-17 SND-16 FA-2)
COL-15 ground-chassis geometry box per vehicle class (renumbered from COL-13)
HP-18 ground-chassis upside-down test
PHY-16 ground-chassis water gives a land hull no impulse
PHY-17 data-words hasMobilePhysics 0 -> static physics node (was PHY-16 on its branch)
PHY-18..PHY-22 rounds rocket motor / box drag (were PHY-16..20 on its branch)
SM-13 con-reader GeometryTemplate.scale
SM-14 rounds inline StandardMesh:<path> geometry (was SM-13 on its branch)
FA-3 rounds FireArms velocity default 200
FA-4 data-words autoFire default
SUP-18..SUP-20 data-words depot repair by vehicle type
CON-15..CON-16 con-reader console set-prefix strip, stream read
KNOCK-4..KNOCK-9 soldier-blast
SND-17..SND-23 sounds
EMT-10 ARM-11 dof-effects
CTF-1..CTF-10 ROUND-1..ROUND-9 round-rules
SPAWN-17..SPAWN-20 SPAWNGRP-10 spawner-pads
COL-16..COL-18 engine-reads hasCollisionPhysics flag 0x200 rules (were COL-15..17 on its branch)
CON-17 engine-reads a bool argument takes only 0 or 1 (was CON-16 on its branch); its CON-15 duplicates con-reader CON-15: merge into that row
GUN-17 engine-reads stabilization stored, never read
BOMB-13 engine-reads blastAmmoCount bool (BOMB-4 corrected)
MLK-14..MLK-18 air-input-2 seat category, slot fill, excess-input backlog, pitch sign, still look axis
PHY-23 review-rounds RELEASED (unused: the lid is COL-8)
HP-19..HP-20 EMT-11 spawned-objects timeToLiveAfterDeath removal (SimpleObject::handleUpdate), round-end clearWorld, a spawned object has no abandon clock
AI-137..AI-144 bots: aiTemplate +0x40, Change plan, path failure, Info pixels, capture timer 0, exitVelocity/useAimerOnly, heat hold
AI-145..AI-146 bots: a bot round lands on one fixed DEV-9 point (input index 617); the bot aimer drag term
GUN-18..GUN-19 CS-8..CS-11 KITDROP-9 IMP-8 hand-weapons-2: refused-pull lockout, grenade charge, fire camera shakes, kit heat on the ground, first sweep start (claimed by its review)
DEV-11..DEV-12 vehicle-deviation: a seat FireArms runs minDev + fire + AI only, ticked by its PCO; the stored total a round and the cross read
OBJ-1..OBJ-6 ROUND-10 SPAWN-21..SPAWN-22 TKT-8 round-gaps ObjectiveMode objectives and tickets, EndGame clearWorld + restart pads, pre-game setTeam, disableWhenLosingControl, end-of-round bleed groups
ROUND-11 rooms GameServer::spawnPlayer refuses a human unless the status is Playing, and a side out of tickets in modes 2/4/5
DEV-13 vehicle-deviation: a bot trigger statement runs its own deviation update every tick (setBotSkill -> +0x128): a bot gun blooms down twice a tick
COL-19 vehicle-part-collision shouldCheckCollision asks collision LOD 1, clamped to LOD 0 on a one-layer mesh; a vehicle part needs only col0
AI-147 review-bots isBailAllowed: a no-pathfinding unit (fixed gun) may bail from a cell the soldier map blocks
PHY-24 review-ground-handling createInvisible withholds only the drawable object flag (BObject::init 0x08195770); physics parts are built
PHY-25..PHY-27 fixed-wing: LandingGear::handleUpdate law (heights x engine revs, gear retracts by sign(acc) x sign(maxSpeed)); a lift regulator integrates its command (GUN-2 servo, no AR); the plane roll-axis throttle and gearbox reproduce the recorded revs (windmill at idle)
SND-24 fixed-wing: Engine::updateSound control 0 is |revs| unclamped, control 1 the nose-down angle (2/pi) asin(-fwd.y)
AI-148..AI-153 bot-gunners: move/fire inclinations and the Change split, BBMoveToFixed refresh rule + SAI fixed orders, unit basicTemp x0.75/x4/3 on change, the fixed gun strategic direction (AI-59), isBailAllowed names (isPrimary, objects below the bot)
