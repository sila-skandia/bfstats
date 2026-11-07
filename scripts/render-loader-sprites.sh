#!/usr/bin/env bash
# Redraws every loading animation's sprite (skill `game-loading-animations`,
# features/replay-shorts/README.md "The loaders") from the viewer's model trees
# with scripts/render-game-sprite.mjs. Each line is the exact command a sprite
# was drawn with; the anchors it prints are the constants in the scene module.
#
#   scripts/render-loader-sprites.sh            # all of them
#   scripts/render-loader-sprites.sh duel       # the sprites whose name starts with "duel"
set -euo pipefail
cd "$(dirname "$0")/.."
only="${1:-}"
draw() { local out="$1"; shift; [[ -z "$only" || "$(basename "$out")" == "$only"* ]] || return 0; node scripts/render-game-sprite.mjs --out "play/loaders/$out" "$@"; }

# --- the duel (play/loaders/duel.js): one strip per duellist, stand | crouch | lie
# on one camera, so the poses line up on his feet. Left faces right, right faces left.
L=(--yaw=-1.5708 --pitch 0.08 --scale 74 --centre 0,0.8,0 --size 340x180 --clips stand,crouch,lie --tween 4 --mark feet=0,0,0)
R=(--yaw 1.5708 --pitch 0.08 --scale 74 --centre 0,0.8,0 --size 340x180 --clips stand,crouch,lie --tween 4 --mark feet=0,0,0)
draw duel-us.webp --glb models/poses/USSoldier__Thompson.pose.glb "${L[@]}"
draw duel-de.webp --glb models/mods/fh/poses/GermanSoldier__Mp40.pose.glb "${R[@]}"
draw duel-red.webp --glb models/mods/pirates/poses/RedPirate__Blunderbuss.pose.glb "${L[@]}"
draw duel-blue.webp --glb models/mods/pirates/poses/BluePirate__Pistol.pose.glb "${R[@]}"
draw duel-rebel.webp --glb models/mods/gcmod/poses/MonTrooper__DL44.pose.glb "${L[@]}"
draw duel-trooper.webp --glb models/mods/gcmod/poses/GermanSoldier__E-11.pose.glb "${R[@]}"
draw duel-tommy.webp --glb models/mods/bf1918/poses/EngSoldier__SMLE.pose.glb "${L[@]}"
draw duel-fritz.webp --glb models/mods/bf1918/poses/GerSoldier__M98.pose.glb "${R[@]}"
# The sandbags the right-hand man drops behind: a static out of the Battle of the Bulge bake.
draw duel-sandbags.webp --glb maps/battle_of_the_bulge/scene.glb --clip none --only sandbag_2m_m1 --pick 0 \
  --yaw 1.2 --pitch 0.08 --scale 74 --centre 0,0.45,0 --size 260x120 --mark base=0,0,0

# --- brass (play/loaders/brass.js): the Short loader's first soldier, prone with a BAR.
# The script's defaults are this sprite; it must come out byte for byte the same.
draw brass-soldier.webp

# --- hull down (play/loaders/hulldown.js): FHSW's Tiger facing right, and FH's
# M4A1 Shermans far off facing left. Marks: the muzzle, the mantlet (the kill
# rings go between them), the hull deck and the cupola top (hull down and turret
# down are the crest at those heights), and the track's bottom.
draw hulldown-tiger.webp --glb models/mods/fhsw/Tiger.glb --clip none --yaw 1.5708 --pitch 0.06 --scale 30 \
  --centre 0,0.3,-1 --size 420x180 --mark muzzle=0,1.0,-5.33 --mark mantlet=0,1.0,-2.35 --mark deck=0,0.89,0 \
  --mark cupola=0,1.79,0 --mark turret=0,1.58,-1.4 --mark hullfront=0,0.89,-3.12 --mark hullrear=0,0.89,3.15 \
  --mark ground=0,-1.14,0 --mark rear=0,0,3.1 --mark front=0,-1.14,-3.1 --mark back=0,-1.14,3.1
draw hulldown-sherman.webp --glb models/mods/fh/M4A1Sherman.glb --clip none --yaw=-1.5708 --pitch 0.1 --scale 15 \
  --centre 0,0.4,0 --size 200x110 --mark ground=0,-1.0,0 --mark centre=0,0.6,0 --mark muzzle=0,1.25,-2.65

# --- fire and movement (play/loaders/rush.js): Secret Weapons' British
# commandos facing right. Each man is a pose strip (stand | 4 blends | crouch |
# 4 blends | lie) and a run strip (eight frames of the run gait, one cycle); the
# German MG 42 team behind their sandbags faces left; and the two flags.
C=(--yaw=-1.5708 --pitch 0.08 --scale 50 --centre 0,0.8,0 --size 300x150 --mark feet=0,0,0)
draw rush-bren.webp --glb models/mods/xpack2/poses/BritishCommandoSoldier__BrenLMG.pose.glb "${C[@]}" --clips stand,crouch,lie --tween 4
draw rush-bren-run.webp --glb models/mods/xpack2/poses/BritishCommandoSoldier__BrenLMG.pose.glb "${C[@]}" --gait run --frames 8
draw rush-rifle.webp --glb models/mods/xpack2/poses/BritishCommandoSoldier__No4.pose.glb "${C[@]}" --clips stand,crouch,lie --tween 4
draw rush-rifle-run.webp --glb models/mods/xpack2/poses/BritishCommandoSoldier__No4.pose.glb "${C[@]}" --gait run --frames 8
draw rush-mg42.webp --glb models/mods/fh/poses/GermanSoldier__Mg42.pose.glb --clip lie --yaw 1.5708 --pitch 0.08 --scale 50 \
  --centre 0,0.8,0 --size 300x150 --mark feet=0,0,0
draw rush-flag-uk.webp --glb models/AnimatedUkFlag.glb --clip none --yaw 0 --pitch 0 --scale 18 --centre 1,-0.8,0 --size 80x60 --mark hoist=0,0,0
draw rush-flag-de.webp --glb models/AnimatedGeFlag.glb --clip none --yaw 0 --pitch 0 --scale 18 --centre 1,-0.8,0 --size 80x60 --mark hoist=0,0,0

# --- the hedgerow ambush (play/loaders/ambush.js): Forgotten Hope's Panzerschreck
# gunner and his loader seen from behind and to the left, aiming into the picture
# (stand | blends | crouch | blends | lie), and FH's M4A1 Sherman side-on facing
# right, smaller, on the lane beyond the bank.
A=(--yaw=-0.45 --pitch 0.15 --scale 60 --centre 0,0.8,0 --size 260x180 --clips stand,crouch,lie --tween 4 --mark feet=0,0,0)
draw ambush-gunner.webp --glb models/mods/fh/poses/GermanSoldier__Panzershreck.pose.glb "${A[@]}"
draw ambush-loader.webp --glb models/mods/fh/poses/GermanSoldier__K98.pose.glb "${A[@]}"
draw ambush-sherman.webp --glb models/mods/fh/M4A1Sherman.glb --clip none --yaw 1.5708 --pitch 0.12 --scale 28 \
  --centre 0,0.4,0 --size 300x150 --mark ground=0,-1.0,0 --mark rear=0,0.5,2.9 --mark deck=0,0.9,2.2 --mark front=0,0.3,-2.8

# --- the dogfight (play/loaders/dogfight.js): vanilla's Spitfire and BF109 in
# flight, gear and static propellers left out (the scene draws the prop discs),
# side-on from a little behind, nose right. Marks: the prop hub, the two gun
# groups, the tail; the 109's middle (its hits) and tail (its smoke).
draw dogfight-spitfire.webp --glb models/Spitfire.glb --clip none --skip SpitfireLandingGear,SpitfireWheel,SpitfirePropellerStatic \
  --centre 0,0.8,1 --scale 27 --size 420x220 --yaw 1.25 --pitch 0.22 --mark prop=0,0.75,-3.2 --mark gunL=-2.3,0.3,-0.2 \
  --mark gunR=2.3,0.3,-0.2 --mark tail=0,1.2,6
draw dogfight-bf109.webp --glb models/BF109.glb --clip none --skip BF109LandingGear,BF109wheel,BF109Wheel,BF109PropellerStatic \
  --centre 0,0.8,1 --scale 22 --size 360x200 --yaw 1.4 --pitch 0.18 --mark prop=0,0.95,-2.7 --mark centre=0,0.8,1 \
  --mark tail=0,1.1,5.4
