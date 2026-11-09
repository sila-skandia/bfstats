# Tank school: research notes

Background reading for a tank school built on the dogfight school's pattern
(`features/dogfight-school/research.md` and its README): bot crews that fight
named tank moves on the game's own physics and damage tables, lessons where
the player learns the counter to each one, a theatre that replays the fight,
and a scoring rule as hard as Dip, Flip and Ninja. The tone to aim for is the
documentary series *Greatest Tank Battles* (2010-2013): show the fight from
above, say plainly who saw whom first and which face of the tank the shell
struck, and point at the one decision that settled it.

Everything here is in our own words. Sources are linked at the end of each
section. Where a claim is a BF1942 player's, it says so; where it is our
inference, it says **(inference)**; where it is read from the game's own data,
it names the file or ledger row.

**A caveat that runs through the whole document.** Many lessons below turn on
which collision face of each tank carries which armour material (rear, side,
front, running gear). The repo has the Sherman's mapping (section 5); a
separate agent is surveying the other vanilla tanks. Every place a lesson
depends on that survey is marked **[faces]**.

---

## 0. The owner's intuition, tested

> "In a dogfight it's about manoeuvring; with a tank it's about
> pre-positioning and then being a good shot."

**For real WWII armour, it holds, almost word for word.** The doctrine, the
operational research and the aces all say the same thing: the crew that sees
first, from a position chosen in advance, and lands the first aimed round
usually wins, and most kills happened from ambush or from a flank rather than
in a manoeuvring duel. A US Ballistic Research Laboratories study of Third and
Fourth Armored Division engagements found a great advantage for whichever side
opened aimed fire first. Wittmann, Carius, Barkmann, Pool and Ekins are all
"chose the spot, fired first" stories, not "out-drove them" stories.

**For BF1942, it holds with three corrections**, and the corrections are the
interesting part of a school:

1. **Being a good shot is harder than it sounds, and it is a skill you can
   teach.** Vanilla tank shells leave at 100 m/s with full gravity, so a round
   drops about 5 m over 100 m and 20 m over 200 m. Ranging the first shot is
   the real gunnery problem. (Section 5.)
2. **Which face you hit matters more than how often you hit.** One square hit
   on a rear plate kills a 100 HP tank from any tank gun; the same tank can
   take three or more to the front. The duel is decided by geometry, so
   manoeuvre comes back in, not as turning for the six, but as *getting off
   their gun's axis and onto a weak face*. (Section 5.)
3. **Close in, the game rewards a manoeuvre the real war did not: circling.**
   A Tiger's turret traverses at 20 degrees a second. A medium tank circling it
   at 15 m only needs about 5 m/s to stay ahead of the gun, and the circler's
   own turret barely has to move. This is the one real "dogfight" in tank
   combat, and it is the move BF1942 players are most likely to remember.

So the honest summary for a pilot: **tank combat is ambush and gunnery at
range, and a knife fight up close.** Pre-position for the first, manoeuvre for
the second, and never drift into the middle distance in the open, where the
heavier gun and thicker front plate win.

---

## 1. The core ideas, in plain words

### See first, shoot first

The single most repeated idea in armour doctrine. A tank sees badly (narrow
vision blocks, a periscope, a commander who has to unbutton to look around),
so the crew that is already stopped, already looking the right way, and
already has the gun roughly laid on the place an enemy will appear, gets the
first round off while the other crew is still finding them. Studies of WWII
engagements found the side that opened aimed fire first had a large
advantage, and most fights ended with neither side wiped out: one side lost a
tank or two and the other withdrew.

In a game, "see first" is mostly **know where they will come from**: roads,
bridges, gaps between buildings, the crest they have to cross.

### Exposure time

Every second your tank can be seen *and* hit by an enemy gun that is loaded
and pointing roughly at you is a second of risk. Good tank play is budgeting
that time. You expose yourself to shoot, and you do not stay exposed after
the shot. This is the closest tank analogue to a pilot's energy: a resource
you spend for position and must not waste.

### Hull-down and turret-down

- **Turret-down:** the whole tank is behind a crest or wall; only the
  commander's head or the top of the cupola could look over. You can watch,
  you cannot shoot, and you cannot be shot.
- **Hull-down:** you have moved forward just far enough that the gun clears
  the crest. Only the turret shows. The hull, the biggest and usually weakest
  target, is behind the ground.

The doctrine is: wait turret-down, roll forward to hull-down to fire, roll
back to turret-down. The gun has to be able to depress enough to shoot over
the crest; a tank that cannot depress has to show more hull. Nicholas Moran
(The Chieftain) also notes "keyhole" positions, where a gap in cover lets you
see one narrow lane and nothing outside that lane can see you.

### The frontal arc and angling the hull

Real tanks carry their thickest armour on the front. Turning the hull so the
front plate meets a shot at an angle makes the shell travel through more steel
and makes it likelier to bounce. German Tiger crews were taught to sit with
the enemy at their 10:30 or 1:30 o'clock (the *Mahlzeit*, or "mealtime",
position; the Tigerfibel used meal names for the clock positions), roughly
30 to 45 degrees off square. Too much angle, and the thin side plate becomes
the easy shot. In modern tank games, **sidescraping** is the same idea with
the front hidden: park the side of the hull along a wall and show only a
sliver of steep-angled side.

**In BF1942 the angle effect is weak, and the face effect is strong.** See
section 5: the engine's angle factor barely moves until about 45 degrees,
while the face you show changes damage by a factor of two or more. Angling
here means "never show more side than you must", not "make the front bounce".

### Range and first-round hit probability

Real crews had to estimate range, set it on the sight, and fire. A wrong
estimate meant a miss that told the target where you were. The Tigerfibel's
methods were all about the first shot: sight triangles to judge range by the
target's apparent size, three crew members estimating and averaging, and a
"battle sight" setting so any target inside about 900 m could be engaged
without measuring. The second round was the correction; the first round, if
it missed, was a warning.

### The flank shot

The side and rear are thinner than the front everywhere, in reality and in
the game. Almost every famous kill in this document is a flank or rear shot:
Ekins' Firefly on Wittmann's Tiger, the Shermans at Arracourt that used fog to
get onto the Panthers' sides, the two Shermans that crept onto Barkmann's
flank under cover of the noise of an air attack. **Getting onto a weak face
while the enemy's gun points elsewhere is the tank's version of getting on
the six.**

### Mobility, firepower, protection

Every tank design trades these three. The Tiger had the gun and the armour
and paid for it in speed, turret traverse, fuel and breakdowns. The Sherman
and T-34 had mobility and numbers. The tank destroyer (the M10) had a big gun
and thin armour. The lesson the Pacific pilots learned about the Zero applies
here too: **fight the fight your vehicle is good at.** A Sherman does not trade
frontal shots with a Tiger at 300 m; it closes, flanks, or waits.

### Shoot and scoot

Fire, then move before the reply lands. In reality, a muzzle flash and dust
cloud gave your position away; by the time the enemy laid on it, you were
somewhere else. In BF1942 the clock that matters is the **reload**: after a
tank fires, it cannot fire again for 2.9 s (4.0 s for the Tiger and M10). A
crew that knows the enemy's reload can peek, fire and duck inside the
enemy's empty window.

### Overwatch and bounding

One tank (or section) moves while another sits in a good position covering
it. When the moving tank is shot at, the overwatch tank sees the shooter's
flash and kills them. Then they swap roles. It is the tank equivalent of the
fighter pair: one tank is a target, two tanks are a team.

### Dead ground and the reverse slope

**Dead ground** is ground the enemy cannot see because a fold, a ditch or a
building blocks the view. A tank in dead ground can move freely. The
**reverse slope** is the far side of a hill from the enemy: tanks sit back
from the crest, so an enemy coming over the top is silhouetted on the skyline
at short range, belly-up, while the defenders were never visible from far
away.

### Reading terrain: terrain is the third player

In a dogfight, the sky is empty and the fight is between two aircraft. In a
tank fight, the ground is a participant: it gives cover, blocks sight, tilts
your hull (and so your gun), and decides where the enemy can and cannot go. A
tank school's map view should treat every crest, wall and building as a piece
on the board.

### The tank duel versus combined arms

Hollywood's tank duel is rare. Real tanks were killed most often by
anti-tank guns, by infantry with rockets and mines, by aircraft and by
artillery, not by other tanks. The tank's greatest dangers were the ones it
could not see: the gun in the hedge, the soldier in the ditch. In BF1942,
the threat list is the same: bazookas and Panzerschrecks, engineers with
mines and explosive packs, defence guns, aircraft with bombs, and jeeps used
as rams. A tank school that only teaches tank against tank teaches half the
job.

### Infantry and anti-tank threats

What kills tanks from outside the tank fight: an infantry rocket into the
rear or side; a mine on a road, a bridge end, or the far side of a crest where
a tank cannot see it until it is on it; an explosive pack placed on a tank
that stopped near cover; a bomb. The tank's defences are to keep moving, to
keep infantry in front where the machine gun and the hull face them, to stay
away from buildings and hedgerows, and to have friends.

**Sources:**
[Hull down (Wikipedia)](https://en.wikipedia.com/wiki/Hull_down),
[Enfilade and defilade (Wikipedia)](https://en.wikipedia.org/wiki/Enfilade_and_defilade),
[The Chieftain's Guide: Use of Cover (World of Tanks)](https://worldoftanks.com/en/news/history/The_Chieftains_Guide_Use_of_Cover/),
[Armor: Hull Down and Turret Positioning (CombatSim)](https://www.combatsim.com/review.php?id=38),
[Overwatch and bounding, FM 7-7 ch. 4 (GlobalSecurity)](https://www.globalsecurity.org/military/library/policy/army/fm/7-7/Ch4.htm),
[Mahlzeit: how your armor survives a little longer (Battlefront forum)](https://community.battlefront.com/topic/4565-mahlzeit-how-your-armor-survives-a-little-longer),
[How to angle in a Tiger I (War Thunder forum)](https://forum.warthunder.com/t/how-to-angle-perfectly-in-a-tiger-1/30200),
[Tiger Fibel notes on Tiger accuracy (Battlefront forum)](https://community.battlefront.com/topic/39464-tiger-fibel-notes-on-tiger-accuracy/),
[What Tiger vets say about range estimation (Battlefront forum)](https://community.battlefront.com/topic/43810-what-tiger-vets-say-about-range-estimation/),
[Battlesight aim by Tiger 88 L/56 (Battlefront forum)](https://community.battlefront.com/topic/41238-battlesight-aim-by-tiger-88l56),
[Survey of Allied Tank Casualties, ORO-T-117 (tankdestroyer.net)](https://tankdestroyer.net/things/articles/1293-survey-of-allied-tank-casualties-by-operations-research-office-march-1-1951/),
[Data on WWII tank engagements, BRL (DTIC)](https://apps.dtic.mil/sti/pdfs/ADA284377.pdf),
[Peterson 1967 on 1-vs-n tank engagements (IDEAS/RePEc)](https://ideas.repec.org/a/inm/oropre/v15y1967i3p557-558.html).
The forum sources on the Tigerfibel are hobbyist readings of the manual; check
a facsimile before quoting it.

---

## 2. The move catalogue

Each entry: what it is, when it works, its counter, and how it would show up
in a recorded fight (path and timing), which is what a replay miner would
look for. Damage numbers are the vanilla 1.6 tables of section 5.

### Hull-down ambush

- **What:** Sit behind a crest, wall or bank with only the turret showing (or
  turret-down, rolling up to fire), covering a lane the enemy must use.
- **Works when:** the enemy has to cross a known lane in the open, and you
  can see the lane before they can see you. Best with the ambusher's front
  turret toward the enemy and the hull's lower faces (and in BF1942 the
  running gear) behind the ground.
- **Counter:** do not cross the lane where they expect you. Use dead ground
  to approach from an angle the crest does not cover, so the "hull-down" tank
  is now side-on to you. Call in artillery or a plane on a tank that is not
  moving. Smoke would be the real-world answer; vanilla BF1942 has none.
- **In the recording:** one tank stationary (speed near 0) for many seconds
  before the first shot; its first shot is the first shot of the fight; the
  victim is moving and first sees the ambusher after it is hit (LOS opens the
  same tick the round lands, or the ambusher's LOS opened first by seconds).
- **History:** Barkmann's Corner (27 July 1944); Carius at Malinava
  (22 July 1944); Rommel's anti-tank screens.

### Pop-up shot and reverse (the peek)

- **What:** From turret-down, roll forward, fire one round, roll back before
  the reply. Repeat from a different spot if you can.
- **Works when:** you know the enemy's reload. In BF1942 a tank that has just
  fired cannot fire again for 2.9 s (Tiger and M10: 4.0 s), so the ideal peek
  is: wait for their shot, then show yourself, fire, and be gone before their
  next round is ready. Exposure per peek: under 2 s.
- **Counter:** hold the corner. Keep the gun laid on the spot they will
  appear and **do not fire** at the first glimpse unless it is a sure hit;
  fire the instant they stop to shoot. Or relocate during their hidden time,
  so they peek into empty space. Or bring a second tank to a different angle.
- **In the recording:** short exposure windows (LOS open 1-3 s) alternating
  with longer hidden ones, with a shot inside each window; the shooter's
  speed goes forward-stop-reverse each cycle; their exposure windows start
  just after the enemy's shot.
- **History:** standard Commonwealth and US doctrine in Normandy and Italy;
  the hull-down Shermans of the Western Desert once the Grant and Sherman had
  turrets that could fire over a crest.

### Angling the hull (the Mahlzeit)

- **What:** Turn the hull so the enemy is off the nose by a modest angle,
  turret still on them.
- **Works when (real):** against a gun that needs a square hit to penetrate.
- **Works when (BF1942):** only mildly, and only at the right angle. Against
  the light guns (Sherman, Panzer IV, Chi-Ha, T-34-85), up to about 35
  degrees costs you nothing and trims a few points; against the heavy guns
  (Tiger, T-34, M10), anything past about 20 degrees lets them hit your side
  for more than a square front hit. **[faces]**
- **Counter:** move to widen the angle until their side is the bigger target,
  or aim for the running gear, which is low and stays visible.
- **In the recording:** the defender's hull yaw relative to the line to the
  attacker sits steady at 15-35 degrees while their turret tracks.

### Circling to the rear (circle-strafing)

- **What:** Close to very short range on a slow-turreted tank and drive a
  tight circle around it, faster than its turret can follow, shooting its
  side and rear.
- **Works when:** you are close and moving, they are slow to traverse, and
  you have the faster turret or simply do not need to traverse. In BF1942 a
  Tiger's (and T-34's and M10's) turret turns at 20 degrees a second; a
  circler at 15 m radius needs only 5.2 m/s to outrun it, at 30 m 10.5 m/s.
  Better still: when you circle a target, its bearing in your own hull frame
  hardly changes, so **your turret stays laid on them while theirs has to
  swing**. **(inference from the turret speeds; not yet flown in the page)**
- **Counter:** do not let a medium tank get close. If it does, move: reverse
  or drive straight away to open the range, which slows the circler's
  angular rate as the circle grows. Turn the hull with the turret, not the
  turret alone (hull yaw adds to turret yaw). Keep a friendly tank or
  infantry near you so the circler has to expose its own rear to someone.
- **In the recording:** the attacker's bearing from the victim changes at
  more than the victim's turret speed for several seconds; range under about
  30 m; the victim's turret error grows while the attacker's stays small;
  hits land on the side and rear faces.
- **History:** rare in reality (tanks seldom got that close, and firing on the
  move without a stabiliser missed), but it is the classic answer to the
  Tiger in every game that models turret traverse.

### The flank

- **What:** Keep the enemy's attention to the front (a second tank, infantry,
  or your own earlier position) while you move through dead ground to a
  position off their gun's axis, then shoot a side or rear face.
- **Works when:** there is dead ground, and they are fixed (stationary,
  shooting at something else, or committed to a road).
- **Counter:** keep turning to face; do not sit still while engaged; listen
  for engines; and have a partner covering your flank.
- **In the recording:** the attacker's aspect angle (where they sit off the
  victim's nose) goes from under 30 degrees to over 90 degrees while LOS is
  closed; LOS reopens with the attacker off the victim's gun axis; first hit
  on a side or rear face.
- **History:** Arracourt (September 1944), where Shermans used fog and
  ground they knew to get onto the sides of Panthers; the Fireflies'
  flank shot on Wittmann's Tiger near Saint-Aignan-de-Cramesnil
  (8 August 1944).

### The bait and flank (two tanks)

- **What:** One tank shows itself, takes the enemy's attention, and pulls
  back (the bait); the second, already off to one side, shoots the pursuer's
  flank.
- **Works when:** the enemy is aggressive and chases. Rommel's desert version
  was armour retreating onto a screen of hidden 88s.
- **Counter:** never chase a tank that retreats in front of you over a crest
  or round a building. Kill the bait if you can do it in one shot; otherwise
  stop, look, and wait for it to come back.
- **In the recording:** two tanks of one team; one is seen first and its
  speed reverses within seconds; the enemy's speed rises toward it; the
  second tank's first shot lands on the pursuer's side from a position it
  held for several seconds.
- **History:** Rommel at Halfaya Pass (Operation Battleaxe, June 1941) and in
  the Gazala battles (1942); Operation Bolo is the air version in the
  dogfight notes. BF1942 has a vanilla *Battleaxe* and *Gazala* map.

### Shoot and scoot

- **What:** Fire, then move to a new firing position before the reply.
- **Works when:** the enemy can locate you by your shot (they see the flash
  or the trail), and there is a second position close by.
- **Counter:** pre-aim the likely next positions; or close the range fast
  while they are moving and not shooting.
- **In the recording:** each shot is followed by movement over 5 m; shots
  from three or more distinct positions in a minute.
- **History:** a staple of tank destroyer doctrine (the M10 crews were told to
  fire from cover and displace).

### The fighting withdrawal

- **What:** Back away from a superior enemy while keeping your front toward
  them, shooting as you go, toward cover, friends or a repair pad.
- **Works when:** you have somewhere to go and they have to cross ground to
  follow.
- **Counter:** do not follow straight down their gun line; follow in dead
  ground, or swing wide to their flank, so the withdrawal has to turn.
- **In the recording:** negative speed (reversing) while the turret tracks;
  the gap opens; hits on the withdrawing tank's front faces only.

### Peek from a corner or building

- **What:** Use a building's corner as a wall: edge the gun out so the
  smallest slice of the tank is visible, fire, back off.
- **Works when:** in towns (Berlin, Stalingrad, Caen, Market Garden). In
  BF1942 the gun is offset to the right of the view (a player tip), so peek
  round a right-hand corner and the gun clears before most of the hull does.
  **(inference from the tip; check the rigs)**
- **Counter:** watch the corner with your gun laid on it; or go round the
  block (the tank tutorial suggests re-emerging behind the enemy); or let an
  engineer or rocket soldier walk up the other side of the building.
- **In the recording:** like the pop-up, but with the hull near a building
  edge and the LOS opening on a narrow angle.

### The charge (closing to kill range)

- **What:** Drive straight at a better-gunned enemy to reach a range where
  your gun can kill.
- **Works when (real):** almost never in the open; it was the Soviet
  Prokhorovka story, and the modern reading of that day (Zamulin) is that the
  charging tank corps took very heavy losses.
- **Works when (BF1942):** when it ends in a circle (above) and you have more
  hit points than they have time. A Sherman charging a Tiger across 200 m at
  about 10 m/s spends 20 s in the open: five Tiger reloads. **Do not charge
  across open ground; charge from the last cover.** **(inference)**
- **Counter:** back up and keep shooting; if it is a pair of tanks, kill the
  closer one first.
- **In the recording:** closing speed high and steady, range falling under
  50 m, ending in either a circle or a wreck.

### Pinning with HE, and blinding

- **What (real):** Hit the target or the ground near it with high explosive
  so the crew buttons up, loses sight, and cannot respond while your partner
  manoeuvres.
- **What (BF1942):** tank shell splash does **no** damage to armour (ledger
  DMG-2: no splash cell for any vehicle material), so pinning is purely about
  vision. The BF1942 tank tutorial notes that a short round throws up earth
  that blinds the target, and that a near miss on a concrete wall can hurt a
  tank behind it through fragments (both player claims).
- **Counter:** move out of your own dust; let a partner watch.

### First shot at the tracks

- **What (real):** Immobilise first, then kill: a track hit stops the tank,
  which can then be flanked at leisure.
- **What (BF1942):** vanilla has no track-break that we know of; what it has
  is the running-gear material (46), which for the heavy guns is a *weak
  spot*: a Tiger, T-34 or M10 shell does 88-104 points to the running gear,
  against 44-52 to a Sherman's front. A player tip lists the Tiger's and M10's
  treads as weak, and the 2003 tank tutorial gives the Tiger's side
  suspension extra damage. The real "mobility kill" in BF1942 is the
  **critical state** below 12 HP: the tank burns 1.5 HP a second and its
  turret turns at a fifth of its speed (ledger HP-15). A Tiger in the burn
  traverses at 4 degrees a second. **[faces]**
- **Counter:** keep the running gear behind the ground (hull-down); repair
  out of the burn before re-engaging.

### Smoke

Not in vanilla BF1942 as a tank weapon. The burning tank's own smoke (from
50 HP down) is visual only, and tells the enemy "one more hit". The school
should mention smoke in the history and leave it out of the lessons.

### Engineer mid-fight repair

- **What (BF1942 specific):** A crew playing the engineer kit hops out
  between shots, or after breaking contact, and repairs. The 2003 tutorial
  recommends it over the anti-tank kit for tank crews: repair while the enemy
  reloads, lay mines to steer the enemy, finish a disabled tank with an
  explosive pack. A tips page credits an engineer with restoring 100 hit
  points before a recharge of about 80 s.
- **Counter:** push the tank that has just broken contact; shoot the
  engineer (a soldier has 30 HP and no armour).

### Mines

- **What:** An engineer's landmine (vanilla `Landmine`, splash material 232)
  does 30 damage times a modifier of 100 against every tank material, inside
  a 4 m radius with linear falloff: 3000 at the centre and still over 100 at
  3.8 m. **One mine kills any vanilla tank.** Players put them on bridge ends,
  in front of a parked tank, on the far side of a crest where a tank cannot
  see them, and on repair pads.
- **Counter:** drive where friends have driven; look before cresting; an
  engineer can pick mines up.

**Sources:**
[Panzaman's BF1942 tank tutorial (realtimerendering.com)](https://www.realtimerendering.com/erich/bf1942/tankvstank.html),
[Battlefield 1942 tips and tactics (realtimerendering.com)](https://realtimerendering.com/erich/bf1942/tips.html),
[Rommel's 88 screens (worldwar2database.com)](https://www.worldwar2database.com/?p=19613),
[88mm in Libya, contemporary US reports (Lone Sentry)](https://lonesentry.com/articles/ttt08/88mm-in-libya.html),
[The Battle of Gazala (bukowo.com)](https://bukowo.com/2017/06/14/the-battle-of-gazala-black-saturday/),
[Battle of Arracourt (Wikipedia)](https://en.wikipedia.org/wiki/Battle_of_Arracourt),
[A new deconstruction of Prokhorovka (HistoryNet)](https://historynet.com/a-new-deconstruction-of-prokhorovka/),
[Zamulin, Demolishing the Myth (Helion)](https://www.helion.co.uk/military-history-books/demolishing-the-myth-the-tank-battle-at-prokhorovka-kursk-july-1943-an-operational-narrative.php);
repo: ledger DMG-2, DMG-4, HP-12, HP-15; `damage.json` (vanilla
`materialManagerSettings.con`).

---

## 3. Aces, engagements and the *Greatest Tank Battles* episodes

### Who is associated with what

| Move or idea | WWII story to hang it on |
|---|---|
| Ambush from a chosen spot; fire first | **Michael Wittmann, Villers-Bocage, 13 June 1944.** His Tiger came out of cover onto the road and shot up a strung-out British column of 7th Armoured Division, starting at the rear on Point 213 and then driving into the town; most of the 13-14 tanks lost that morning were credited to him. Historians praise the effect and question the judgement: driving into the town alone cost him the Tiger. Kill credits are inflated by propaganda; treat the counts with care. |
| Hull-down defence and the long-range first shot | **Otto Carius** (Tiger, Eastern Front). At **Malinava** (22 July 1944) his two Tigers surprised a Soviet column in a village and then ambushed its follow-on force. Several accounts credit his wingman Kerscher with the first shots; Carius' own claims are disputed. His memoir *Tiger in the Mud* is the primary source. |
| The single tank holding a crossroads | **Ernst Barkmann, "Barkmann's Corner", near Le Lorey, 27 July 1944.** A lone Panther in the shade of an oak at a crossroads stopped a US armoured column, knocking out Shermans that tried to pass; after fighter-bombers hit him, two Shermans used the noise to work onto his flank. Claims (about nine Shermans) are German and contested by a 2017 study by Deprun. |
| The flank shot from cover | **Joe Ekins**, gunner in a Sherman Firefly of the 1st Northamptonshire Yeomanry, credited with the Tigers of Wittmann's group on 8 August 1944, firing from a wood on their flank at roughly 800 m. Attribution is disputed (a Canadian Sherman is also claimed). |
| Fire first, lead from the front | **Lafayette "War Daddy" Pool**, 3rd Armored Division, Sherman *In the Mood*, spearhead tank for weeks in 1944. The best-known anecdote: he found himself facing a German gun in the gloom and his gunner fired before the gun crew recognised the Sherman. Totals (12 tanks, 258 vehicles) vary by source. |
| Using fog and known ground to flank a better tank | **Arracourt, 18-29 September 1944.** US 4th Armored Division Shermans and tank destroyers (Abrams' 37th Tank Battalion among them) against Panther brigades. Poor German deployment showed the Panthers' sides; the Americans, who knew the ground, used fog to flank them. Loss figures differ by source; Zaloga's *Patton Versus the Panzers* is the detailed account. |
| The charge to close range | **Prokhorovka, 12 July 1943.** Soviet 5th Guards Tank Army tanks charged across open ground into II SS Panzer Corps. The legend says they closed to kill the Tigers' sides; the modern reading (Zamulin) is that they took very heavy losses, and the battle was neither as large nor as decisive as the legend. A lesson in what not to do in the open. |
| Bait and the gun screen | **Rommel in North Africa:** Halfaya Pass during Operation Battleaxe (June 1941), and the Gazala battles (May-June 1942), where British armour attacked into concealed anti-tank screens and was destroyed. The tactic was to show armour, pull it back, and let the pursuers run onto hidden 88s. |
| Mobility and numbers against a better tank | **T-34 crews of 1941-43**, and the Shermans everywhere: they won by being where the heavy tanks were not, rather than by beating them face to face. |

### *Greatest Tank Battles* (2010-2013): the WWII-relevant episodes

Three seasons, 26 episodes (10, 10, 6), CGI reconstructions narrated by
veterans and historians. Episode numbers and titles differ between listings
(epguides, TVMaze, TheTVDB, Tubi); the list below follows the titles and
should be checked against one guide before the school cites an episode
number. One-liners are ours.

| Episode | Fight | Why it suits the school |
|---|---|---|
| S1, "The Battles of El Alamein" | Eighth Army against the Afrika Korps, 1942. | Desert gunnery at range; anti-tank screens; a vanilla BF1942 map. |
| S1, "The Battle of the Bulge: Race to Bastogne" | US armour and the German Ardennes offensive, December 1944. | Fighting in towns and forests; a vanilla map. |
| S1, "The Battle of the Bulge: SS Panzer Attack!" | The SS panzer spearheads in the Ardennes. | Columns on roads; ambush from the woods. |
| S1, "The Battle of Arracourt" | 4th Armored Division against Panther brigades, September 1944. | The flank in fog; terrain knowledge beats a better tank. The best single episode for the school. |
| S1, "The Battle of Kursk: Northern Front" | Model's attack on the northern shoulder, July 1943. | Defence in depth, anti-tank guns, mines. A vanilla map. |
| S1, "The Battle of Kursk: Southern Front" | II SS Panzer Corps and Prokhorovka. | The charge, and what it cost. |
| S2, "The Battle of France" | 1940. | Mobility and radio over armour. |
| S2, "The Battle of Tunisia" | Kasserine and after, 1943. | The first US tank battles against German armour. |
| S2, "Tank Battles of Italy" | 1943-44. | Hull-down fighting in hills and towns; Road to Rome's setting. |
| S2, "The Battle for the Baltics" | 1944. | Carius country. |
| S2, "The Battle of Stalingrad" | 1942-43. | Tanks in ruins; a vanilla map. |
| S2, "Tank Ace Ludwig Bauer" | A Panther ace in Normandy and on the Eastern Front. | One crew's ambushes, episode-length. |
| S3, "Michael Wittmann: Greatest Tank Ace" | Kursk to Villers-Bocage to his death. | The ambush and the flank shot that answered it, in one episode. |
| S3, "Canadian Tank Battle in Italy" | 1944. | Shermans against prepared positions. |
| S3, "The Battle for Germany" | 1945. | Last-ditch ambushes in towns. |
| S3, "Tank Battles of the Pacific" | Shermans and Chi-Has. | The Type 97 in its real setting; tanks with infantry. |

Not WWII and so out of the cast, but worth a look for "see first": S1 "The
Battle of 73 Easting" (1991, thermal sights let the US troop see and kill first
in a sandstorm) and the two *October War* episodes (Golan and Sinai, 1973,
hull-down defence against massed armour). Two Season 1 episodes we could not
confirm from listings.

**Sources:**
[Michael Wittmann (Wikipedia)](https://en.wikipedia.org/wiki/Michael_Wittmann),
[Villers-Bocage (Battle of Normandy Tours)](https://battleofnormandytours.com/villers-bocage.html),
[Villers-Bocage (warhistory.org)](https://warhistory.org/2015/12/21/villers-bocage/),
[Ernst Barkmann (Wikipedia)](https://en.wikipedia.org/wiki/Ernst_Barkmann),
[Barkmann (achtungpanzer.com)](https://achtungpanzer.com/gen5.htm),
[Joe Ekins (Wikipedia)](https://en.wikipedia.org/wiki/Joe_Ekins),
[Joe Ekins (War History Online)](https://www.warhistoryonline.com/world-war-ii/joe-ekins.html),
[Was Wittmann killed by...? (Battlefront forum)](https://community.battlefront.com/topic/23096-was-whittman-killed-by),
[Carius at Malinava (militaryheritagetourism.info)](https://militaryheritagetourism.info/en/military/stories/view/447),
[Kampfgruppe Carius (Weapons and Warfare)](https://weaponsandwarfare.com/?p=7717),
[Carius' claims questioned (Tank Archives)](https://www.tankarchives.com/2019/07/cheating-at-statistics-machinations-at.html),
[Tanker ace War Daddy (HistoryNet)](https://historynet.com/tanker-ace-war-daddy-his-final-fight/),
[Lafayette Pool (Military Times)](https://www.militarytimes.com/off-duty/military-culture/2023/06/16/meet-the-real-wwii-tanker-who-inspired-brad-pitts-character-in-fury/),
[Creighton Abrams at Arracourt (Britannica)](https://www.britannica.com/print/article/1004087),
[Zaloga, Patton Versus the Panzers](https://www.schweitzer-online.de/buch/Zaloga/Patton-versus-Panzers/9780811717892/A34678188/),
[Greatest Tank Battles (Wikipedia)](https://en.wikipedia.org/wiki/Greatest_Tank_Battles),
[Season 1 episode guide (epguides)](https://www.epguides.tv/shows/greatest-tank-battles/seasons/1),
[Episode guide (TVMaze)](https://www.tvmaze.com/shows/2090/greatest-tank-battles/episodeguide),
[All seasons (TheTVDB)](https://thetvdb.com/series/greatest-tank-battles/allseasons/official).

---

## 4. Rules of thumb for the screen

Short enough for a loading tip or a coach line. The BF1942-specific ones come
from section 5's numbers.

**Seeing and being seen**
- See first, shoot first.
- If you can see them, they can see you. Be the one who was already looking.
- Stop to look. A moving tank is a blind tank.
- Check behind you. (A 2003 player tip: use the view key to look back.)
- The tank that kills you is the one you never saw.

**Position**
- Pick the spot before the fight, not during it.
- Show the turret, hide the hull.
- Never cross a skyline you can go round.
- Never park beside a building you have not cleared.
- Leave by a different door than you came in.

**The face you show**
- Never show your rear. One square hit there kills a medium tank.
- Face them square to a big gun; angle a little to a small one.
- If they are side-on to you, shoot now.
- Low on the hull, not the turret.

**Gunnery**
- The shell is slow: aim high at range, and lead a moving target.
- Your first shot tells you the range. Watch where it lands.
- Fire when the sight settles, not while it is still swinging.
- Short is better than over: dirt in their face buys a second shot.

**The reload clock**
- Their shot is your cue: you have three seconds (four against a Tiger or an M10).
- Peek, shoot, back. Never stay out for a second shot you did not need.
- Count their reload, not just your own.

**Fighting a better tank**
- Do not trade shots at range with a Tiger. Close from cover, or go round.
- Inside thirty metres, a Tiger cannot turn its turret fast enough. Circle.
- Make it the knife fight or the ambush. Never the duel.

**Smoke and fire**
- Smoking means half gone. Burning means finish them, or leave.
- A burning tank's turret turns at a crawl. If you are burning, get out of
  their sight first, then repair.

**Infantry, mines and friends**
- Infantry behind you? Back up, and turn to face them.
- Keep moving near cover; a parked tank collects explosive packs.
- One mine is one tank. Drive in the tracks of friends.
- One tank is a target; two tanks are a team. One watches while one moves.
- An engineer in the crew is a second life.

---

## 5. BF1942 itself: community lore, and what the engine does

### What the community left behind

Far more survives for tanks than for planes, thanks mostly to one page.

- **Panzaman's tank tutorial (Trevor Larkum, a former Royal Tank Regiment
  troop leader, for BF1942 v1.2, last changed June 2003),** hosted on Eric
  Haines' BF1942 pages. Sourced player claims:
  - The philosophy: cautious and merciless. Fire first, take on one tank at a
    time, and put your strongest armour toward the enemy before the first shot.
  - Use folds in the ground and buildings; move out to fire and back in. Go
    round a building and come out behind the enemy. Good ambush spots are
    clumps of trees, gaps between buildings and the dips beside bridges.
  - Angle about 30 degrees to the enemy; more exposes the side.
  - Aim the bottom of the sight at the join between hull and turret for a
    first-round hit at typical range; aim higher at long range. A short round
    throws up earth and blinds the target.
  - Fire as the sight comes back down through the target after the gun's
    bounce, not on the way up. Firing to the side has worse recoil.
  - Keep moving to be hard to hit. A missed shell does no splash damage to a
    tank.
  - Prefer the engineer kit to the anti-tank kit: repair between shots while
    the enemy reloads, lay mines to steer them, finish a disabled tank with
    an explosive pack. Use repair pads whenever you can. Advance in pairs, one
    covering while the other repairs.
  - Reloads: M10 and Tiger 4.0 s; Panzer IV, Sherman and Chi-Ha 2.9 s. The
    Tiger is the slowest to traverse.
  - Armour ranking: Tiger, M10, Panzer IV, Sherman, Chi-Ha. Gun ranking: M10,
    Tiger, then the three mediums. They call the M10 the best vehicle overall.
  - Weak points: the Tiger's side suspension (up to 30 points extra); the
    Sherman's and Panzer IV's nose (about 10 extra); the Chi-Ha's nose (about
    20 extra); the Sherman's turret rear. The Panzer IV model is oversized, so
    shots land on its turret sides and hull top.
  - Their hit counts (v1.2): a Tiger takes about 12 hits to the front from a
    Sherman, Panzer IV or Tiger, 3 to the hull rear from a Sherman and 5 to the
    side; an M10 takes about 10 on most spots from the mediums but 2 on the
    side or rear.
- **The Tips and Tactics collection on the same site** (contributors named
  per tip). Sourced player claims: never show your rear; aim low, because the
  hull is weaker than the turret; hit square, because angled hits do less;
  the Tiger's and M10's treads are weak; white smoke means about 60 percent
  damage, grey about 70; a jeep or motorcycle rammed at full speed can kill a
  tank (more with explosive packs aboard); reverse when a jeep is about to
  ram you; the gun sits to the right of the view, so aim slightly left up
  close; an anti-tank soldier only needs to see the tank for the instant they
  fire; mines on the far side of hills, at bridge ends, and on repair pads;
  an engineer repairs 100 points and then needs about 80 s to recharge, and
  can repair while moving or prone; assault rifles and machine guns do
  nothing to tanks; the trick of firing the tank gun, jumping out to fire a
  bazooka, and jumping back in.
- **Tank reputations (player claims and our reading of the data):**
  - **Tiger:** the heaviest armour and a big gun, but the slowest turret and a
    4 s reload; no roof machine gun, so infantry and aircraft get close. The
    game's version of the real tank's trade-offs.
  - **M10:** in BF1942, the surprise. Real M10s were thin-skinned; the game's
    is heavily armoured in front (Panzaman: about 10 medium hits) with the
    Tiger's 4 s reload and the strongest gun. Fragile only on the side and
    rear.
  - **Sherman and Panzer IV:** the balanced mediums: quick turret (35 degrees
    a second), 2.9 s reload, light shell. Mirror images.
  - **T-34:** in vanilla data it fires the *heavy* Allied shell (the same
    material as the M10) on a medium hull with the Tiger's slow 20-degree
    turret; the T-34-85, oddly, fires the light shell. **(read from the data;
    worth a check in game)**
  - **Type 97 Chi-Ha:** the weakest armour, a light shell, and the slowest
    round in the game (80 m/s against everyone else's 100), so it drops the
    most at range. It should fight close.
  - **Road to Rome:** the Sturmgeschutz (a turretless assault gun with a
    tank-killing reputation in the expansion's own publicity), the M3 Grant
    (80 HP, a hull gun and a turret gun) and the Italian M11/39 (80 HP), plus
    the Pak 40 and other anti-tank guns.
  - **Secret Weapons:** the Sturmtiger and T95 (turretless, 200 m/s rounds,
    0.2 rounds a second, a 5 s reload), the Sherman Calliope (a Sherman with
    rockets) and the Flakpanzer. We found little surviving player comment on
    any of them.
  - **Black Prince:** not in vanilla, Road to Rome or Secret Weapons as far as
    the extracted trees show; it is a mod vehicle.
- **Spawn camping, artillery spotting, ramming.** Tank camping on enemy
  spawns and airfields was a common complaint, but we found no surviving
  forum thread to cite. Scout binoculars mark targets for friendly artillery
  (the Priest, Wespe, Sexton and Katyusha): sourced to a strategy wiki and an
  AnandTech thread on directed artillery; tank crews should treat a stationary
  minute in sight of an enemy scout as an artillery invitation.
  **(that last clause is inference)**
- **Infantry against tanks.** Player guides agree: wait for the tank to pass,
  then put a rocket in its rear; one bazooka hit to a medium tank's rear
  kills it. The 1.6 data agrees exactly (see below).

### What the engine does that changes the lessons

Read from the vanilla 1.6 `Objects` and `materialManagerSettings.con` data
(as exported to `damage.json`) and the engine ledger.

**The tanks, in one table.**

| Tank | HP | Shell (material) | Reload | Turret yaw | Shell speed |
|---|---|---|---|---|---|
| Sherman | 100 | light (236) | 2.87 s | 35 deg/s | 100 m/s |
| Panzer IV | 100 | light (237) | 2.87 s | 35 deg/s | 100 m/s |
| Chi-Ha | 100 | light (237) | 2.87 s | 35 deg/s | 80 m/s |
| T-34-85 | 100 | light (236) | 2.87 s | (not read) | 100 m/s |
| T-34 | 100 | heavy Allied (238) | 2.87 s | 20 deg/s | 100 m/s |
| M10 | 100 | heavy Allied (238) | 4.0 s | 20 deg/s | 100 m/s |
| Tiger | 125 | heavy Axis (239) | 4.0 s | 20 deg/s | 100 m/s |

Reloads follow from `roundOfFire` (0.35 or 0.25 a second) and the gun firing
on whole 30 Hz ticks (ledger GUN-13): 86 ticks or 120. Turret yaw is the
tower's `setMaxSpeed` first component (the Chi-Ha's tower is yaw-only, which
fixes the order); the servo's acceleration (GUN-2) was not read, so the real
time to swing 90 degrees is a little longer than 90 / speed. Every tank's
`criticalDamage` is 12 and `hpLostWhileCriticalDamage` 1.5 (HP-12); the
Sherman smokes from 50 HP (its `addArmorEffect` tiers, ARM-1).

**Damage depends on the face struck.** A direct hit costs
`materialDamage(shell) x damageMod(shell group, struck face's material) x
angle factor` (DMG-3). The face material is per collision face: the Sherman's
hull carries 50 (rear), 51 (side) and 52 (front), and its running gear 46
(`features/bf1942-3d-models`, "The face material"; the proving ground's
`materialName`). Heavier tanks also use 53 and 54. Per square hit, with hits to
kill a 100 HP tank / the 125 HP Tiger:

| Face | Light shell (Sherman, Pz IV, Chi-Ha, T-34-85) | Heavy Allied (T-34, M10) | Tiger | Bazooka / Panzerschreck |
|---|---|---|---|---|
| 50 rear | 100 (1 / 2) | 156 (1 / 1) | 132 (1 / 1) | 100 (1 / 2) |
| 51 side | 50 (2 / 3) | 91 (2 / 2) | 77 (2 / 2) | 35 (3 / 4) |
| 52 front | 40 (3 / 4) | 52 (2 / 3) | 44 (3 / 3) | 26 (4 / 5) |
| 53 heavy | 25 (4 / 5) | 39 (3 / 4) | 33 (4 / 4) | 19 (6 / 7) |
| 54 heaviest | 10 (10 / 13) | 26 (4 / 5) | 22 (5 / 6) | 13 (8 / 10) |
| 46 running gear | 35 (3 / 4) | 104 (1 / 2) | 88 (2 / 2) | 50 (2 / 3) |

Which faces each tank carries is the **[faces]** survey. Panzaman's v1.2
counts fit a Tiger front of 54, a Tiger side near 53 and a Tiger rear near 51,
and an M10 front of 54 with sides and rear near 51; if the 1.6 files agree,
then **a Sherman cannot realistically kill a Tiger from the front (13 hits,
37 s of reloads) and must reach its side or rear**, while the Tiger kills the
Sherman's front in 3. That single fact is the lesson plan for the medium tank.

Three consequences worth drilling:

- **A rear hit is a kill.** From any tank gun, a square hit on face 50 kills
  every 100 HP tank; the heavy guns kill the Tiger too. A bazooka's rear hit
  kills a medium. Never show it.
- **For the heavy guns the running gear is a weak spot, for the light guns it
  is not.** A Tiger, T-34 or M10 shooting low into the road wheels does 88-104
  points; a Sherman doing the same does 35, less than its 40 on the front
  plate.
- **Splash does nothing to armour.** Tank shells and bazooka splash have no
  vehicle cells (DMG-2), so a miss is a miss, and near misses on a tank are
  only a vision effect. (The exception: a mine's splash, material 232, has a
  modifier of 100 on every tank material, so a mine within about 3.8 m kills.)

**Angling, with the engine's angle law.** Ground vehicles author no
`angleMod`, so the factor is `sin(|cos t| x pi/2)`, t the shot's angle off
square to the struck face (DMG-4):

| Off square | 0 | 15 | 30 | 45 | 54 | 60 | 70 | 80 |
|---|---|---|---|---|---|---|---|---|
| Factor | 1.00 | 1.00 | 0.98 | 0.90 | 0.80 | 0.71 | 0.51 | 0.27 |

Put a tank's hull at an angle a to a shooter: the front face is struck at a,
the side at 90 - a. Damage per hit, front face / side face, on a Sherman-like
layout (front 52, side 51) **[faces]**:

| Hull angle | 0 | 15 | 20 | 30 | 45 | 60 |
|---|---|---|---|---|---|---|
| vs light shell | 40 / - | 40 / 20 | 40 / 26 | 39 / 35 | 36 / 45 | 28 / 49 |
| vs Tiger shell | 44 / - | 44 / 30 | 44 / 39 | 43 / 54 | 39 / 69 | 31 / 75 |
| vs T-34 / M10 shell | 52 / - | 52 / 36 | 52 / 47 | 51 / 64 | 47 / 82 | 37 / 89 |

So, in BF1942: **angling buys almost nothing on the front plate below 45
degrees, and it shows the side.** The safe angle is whatever keeps a side hit
below a square front hit: up to about 35 degrees against a light gun, about 20
against a heavy one. The Tiger crew's real 30-45 degree *Mahlzeit* is a
mistake in this game against an M10 or a T-34. Panzaman's "about 30 degrees"
was right for the medium guns that tutorial mostly faced.

**Ballistics.** No vanilla tank shell sets `gravityModifier` or `drag`, so a
shell falls at full gravity from its muzzle speed (GUN-9 has the integrator).
Flight time and drop:

| Range | 50 m | 100 m | 150 m | 200 m | 300 m |
|---|---|---|---|---|---|
| 100 m/s shell | 0.5 s, 1.2 m | 1.0 s, 4.9 m | 1.5 s, 11 m | 2.0 s, 20 m | 3.0 s, 44 m |
| Chi-Ha, 80 m/s | 0.6 s, 1.9 m | 1.3 s, 7.7 m | 1.9 s, 17 m | 2.5 s, 31 m | 3.8 s, 69 m |
| Bazooka, 50 m/s | 1.0 s, 4.9 m | 2.0 s, 20 m | 3.0 s, 44 m | 4.0 s, 79 m | - |

Past about 100 m, first-round hits need holdover; past 150 m, a moving target
needs lead of a tank length or more. Whether the shell inherits the firing
tank's velocity was not checked; it matters for shooting on the move.
**(open question for the school's gunnery lesson)**

**Circling against turret speed.** The speed a circler needs, at radius r, to
move round the target faster than its turret can follow (v = turret rate x r):

| Radius | 10 m | 15 m | 20 m | 30 m | 50 m |
|---|---|---|---|---|---|
| vs 20 deg/s (Tiger, T-34, M10) | 3.5 m/s | 5.2 | 7.0 | 10.5 | 17.5 |
| vs 35 deg/s (Sherman, Pz IV, Chi-Ha) | 6.1 m/s | 9.2 | 12.2 | 18.3 | 30.5 |
| vs a burning Tiger (4 deg/s) | 0.7 m/s | 1.0 | 1.4 | 2.1 | 3.5 |

The victim can add hull yaw to turret yaw, and a tank cannot pivot from a
dead stop on steering alone (TANK-6: it needs throttle), which helps the
circler against a parked target. **(inference; the bots should fly it)**

**Other engine facts that bend the lessons:**

- **No stabiliser.** `automaticYawStabilization` and `...PitchStabilization`
  do nothing (GUN-17): the turret's angle is relative to the hull, so a hull
  that turns or pitches drags the gun with it. Firing on the move or while
  turning is a real skill, and stopping to shoot is a real advantage, as in
  1944.
- **The critical state is BF1942's mobility kill.** At 12 HP or below the tank
  burns 1.5 HP a second (dead in about 8 s unless repaired) and every turret
  axis answers at a fifth of its speed (HP-15). A hit that leaves a tank
  burning is nearly a kill, and a burning tank cannot defend itself against a
  circler at any radius.
- **The vehicle HUD shows your own HP** (HP-12) but nothing shows the enemy's
  except their smoke and fire tiers: smoke at 50 HP, fire at 12.
- **Repair is fast and repeatable.** An engineer, a repair pad, or a hangar
  resets the clock; a tank fight is often won by the crew that disengages and
  repairs first.

**Implications for the bots and the lessons:**

1. The decisive BF1942 tank skills are, in order: **knowing where they will
   come from; the face you show and the face you hit; the reload clock; the
   first-round range; and, up close, the circle.**
2. Teach the doctrine as the documentaries tell it, then show what the game
   does: "the Tiger crews angled 30-45 degrees; here, against an M10, that
   shows your side for more than your front".
3. The counter to nearly every tank trick is the same: **do not be where they
   planned for you to be, and do not stay where they can see you after you
   fire.**

**Sources:**
[Panzaman's BF1942 tank tutorial (realtimerendering.com)](https://www.realtimerendering.com/erich/bf1942/tankvstank.html),
[Battlefield 1942 tips and tactics (realtimerendering.com)](https://realtimerendering.com/erich/bf1942/tips.html),
[BF1942 map vehicle list (realtimerendering.com)](https://www.realtimerendering.com/erich/bf1942/vehiclelist.html),
[Heavily armored tanks (Ludo guide)](https://www.ludo.guide/guide/battlefield-1942/heavily-armored-tanks),
[Medium armored tanks (Ludo guide)](https://www.ludo.guide/guide/battlefield-1942/medium-armored-tanks),
[Directed artillery manual for BF1942 fans (AnandTech forums)](https://forums.anandtech.com/threads/directed-artillery-manual-for-you-bf1942-fans.948577),
[Road to Rome weapons (StrategyWiki)](https://strategywiki.org/wiki/Battlefield_1942:_The_Road_to_Rome/Weapons),
[Road to Rome announced (Blue's News)](https://www.bluesnews.com/a/493/battlefield-1942-the-road-to-rome-announced),
[Secret Weapons of WWII (Wikipedia)](https://en.wikipedia.org/wiki/Battlefield_1942:_Secret_Weapons_of_WWII),
[Engineer in BF1942 (Battlefield Wiki)](https://battlefield.fandom.com/wiki/Engineer/Battlefield_1942);
repo: `features/bf1942-engine-reference/ledger.md` rows DMG-2, DMG-3, DMG-4,
HP-12, HP-15, ARM-1, GUN-2, GUN-9, GUN-13, GUN-17, TANK-6;
`features/bf1942-3d-models/README.md` ("The face material");
`tools/bf1942-models/viewer/proving-ground-page.js` (`materialName`); the
exported `damage.json` (vanilla `bf1942/game/materialManagerSettings.con`,
weapons from each tank's `Weapons.con`). The Ludo guides are recent and call
tank shells "missiles"; treat them as weak sources.

---

## 6. Dogfight to tank fight: what carries over, what does not

### Concepts that translate

| Dogfight idea | Tank equivalent | How well it maps |
|---|---|---|
| Energy (speed plus height): a bank you spend for position | **Exposure budget**: seconds seen by a loaded, roughly laid enemy gun; and **hit points**, which repair restores the way an engine restores energy | Good. Both are "never spend more than the fight is worth". |
| Height advantage | **The position you chose first**: hull-down, on a flank, in their blind spot. Height itself helps only when it gives hull-down or sight. | Good. "Position is life insurance." |
| The six, the control zone | **The rear arc and the weak faces**: anywhere off their gun axis with their side or rear toward you | Very good, and stronger: here one hit in the "six" is a kill. |
| Angle-off / aspect | **Aspect**: where you sit off their nose (decides which face you can hit) and **hull angle** (decides which face they can hit) | Good, with two angles instead of one, because hull and turret point different ways. |
| Turn rate | **Turret traverse plus hull yaw**: how fast the gun comes round | Good, and it is where the circle comes from. |
| The kill-shot window | **The exposure window**: LOS open, gun loaded, turret within reach | Good. The theatre's kill-shot shading becomes "exposed and loaded" shading. |
| Lose sight, lose the fight | See first, shoot first | Identical. |
| Boom and zoom: one pass, then reset | **The peek / shoot and scoot**: one shot, then back to cover | Very good. Hartmann's see, decide, attack, reverse is the peek. |
| Lead pursuit | **Gun lead and holdover** on a slow shell | Good, but for the round, not for the vehicle. |
| Thach weave, the wingman | **Overwatch and bounding; bait and flank** | Good. |
| Throttle chop / forcing the overshoot | **The fighting withdrawal into a trap**, or reversing out of a circle | Partial. |
| Fight your plane's fight (Zero against Wildcat) | Fight your tank's fight (Sherman against Tiger) | Identical. |

### What is new for a pilot

- **Terrain is the third player.** The sky is empty; the ground is not. Every
  lesson needs a map, and the same move works on one crest and fails on the
  next.
- **The hull and the turret point different ways.** A plane's gun points where
  the plane goes; a tank's gun points where the turret points, and the armour
  points where the hull points. You aim one and protect yourself with the
  other. This is the tank's lift-vector lesson, and the most teachable single
  idea: **point the hull where you want the armour, the turret where you want
  the shot.**
- **The gun is slow to come round.** 20 to 35 degrees a second, against a
  fighter's 200-plus degrees a second of roll. Being out of their arc is a
  position you can hold for seconds.
- **A fight is a sequence of shots, not a stream.** A fighter's guns fire 10 to
  15 rounds a second; a tank fires one every 2.9 or 4 seconds. Each shot is a
  decision, and the gap between shots is the space everything else happens
  in. The reload clock is the beat of the fight, the way energy is the beat
  of a dogfight.
- **One hit can end it, and which face decides how many.** A fighter dies of
  accumulated rounds; a tank dies of one well-placed one or of four badly
  placed ones.
- **Stopping is good.** A pilot who stops dies. A tank that stops shoots
  straighter (no stabiliser) and sees better; it just must not stay stopped
  where it was seen.
- **Repair.** Nothing in the dogfight school heals mid-fight. Tanks do.
- **Threats from outside the duel.** Mines, rockets from a ditch, a bomb. The
  tank school must teach checking these, not only the enemy tank.

### A scoring scheme: Duck, Flank, Ghost

The dogfight school scores Dip (escape), Flip (the chased becomes the chaser)
and Ninja (get the shot and keep it without giving one). The tank versions
keep the shape and measure what decides a tank fight: exposure, faces and
first shots. Definitions below are first drafts to be hardened by the same
adversarial reviews the dogfight lessons had. "Exposed" means: the enemy has
line of sight to any part of your hull or turret, their gun is loaded, and
their turret could lay on you within 0.5 s at its traverse speed. "Off their
gun" means you are more than 0.5 s of traverse outside their gun's bearing.

- **Duck (escape).** From the move on, no round of theirs strikes you; within
  10 s you are out of their line of sight (hull and turret), and you stay out
  of it for 10 s, above the critical 12 HP. Being exposed for more than 2 s in
  total after the move fails it. The tank Dip: breaking contact so you can
  choose the next fight.
- **Flank (reversal).** Starting in their frontal arc (within 30 degrees of
  their gun axis, they are exposed-laid on you), within 30 s you land a hit on
  a side, rear or running-gear face (50, 51, 46, or the tank's weakest face
  for your shell) while off their gun, or you kill them; between the move and
  that hit they land at most one round on you and never one on your rear. The
  tank Flip: the tank looking down your barrel ends up showing you its side.
- **Ghost (the clean kill).** Two hits or more on them, or a kill, and no round
  of theirs strikes you. Your exposed time totals less than one of their
  reloads (2.9 s against a medium, 4.0 s against a Tiger or M10), and you are
  never exposed while they have a loaded, laid gun for more than 1 s at a
  time. Once you have hit them, you are never 20 s in their sight without
  another shot: sitting hull-down trading nothing is a stalemate, not the
  upper hand. The tank Ninja.
- **All:** never closer than 3 m (no ramming), never upside down, no
  friendly mines; a fight is measured to the kill.
- **Starts:** the same L9 orthogonal array over four nudges, but tank-sized:
  sideways and along (10 m), hull angle (15 degrees) and the moment the
  enemy appears (1 s). 7 of 9 is "works", 3-6 "partly", fewer "no", as in the
  dogfight school.

What the theatre should draw, by analogy with the dogfight's kill-shot
windows and energy chart: each tank's sight lines (shaded when exposed), the
reload clock of each gun as a ring that fills, each shell's arc and the face
it struck coloured by armour band, and, in place of the energy chart, an
**exposure and hit-points strip**: seconds exposed and hit points over time,
one line per tank.

### Lessons the school could teach, ranked for a beginner

Ranked by how much each would help a pilot who has never fought a tank. Each
is a situation, a move and its counter, flown from nine nudged starts.
Lessons marked **[faces]** need the face survey before their numbers can be
trusted.

| Rank | Lesson | Situation | The move (the bot flies it) | The counter (the player learns it) | Map |
|---|---|---|---|---|---|
| 1 | **Turn to face** **[faces]** | An enemy tank appears off your side or rear at 100 m. | The bot holds its gun on your side and fires. | Turn the *hull* to face (not just the turret), to within 20 degrees of square against a heavy gun, 35 against a light one, while the turret tracks; then back toward cover. Score: Duck. | El Alamein, Kursk |
| 2 | **Peek on the reload** | A hull-down enemy covers a crest you must hold. | The bot sits hull-down and fires the moment you show. | Wait turret-down for its shot, then roll up, fire inside its 2.9 or 4 s reload, and back off. Score: Ghost. | Kursk, Gazala |
| 3 | **The first round** | A stationary tank at 150-250 m, unaware. | (Gunnery, no move: the target only reacts after your first shot by reversing into cover.) | Range by holdover on the 100 m/s shell; aim at the hull-turret join plus drop; read the first round's dirt and correct. Score: kill in two rounds or fewer before it reaches cover. | El Alamein |
| 4 | **Circle the Tiger** **[faces]** | Sherman against Tiger, start at 80 m in light cover. | The Tiger sits and trades shots at range. | Close from cover, then circle inside 25 m faster than its 20 deg/s turret, shooting side and rear. Counter-lesson for the Tiger: reverse to open the range and swing the hull. Score: Flank. | Kursk, Battle of the Bulge |
| 5 | **The ambush lane** | You must cross a road between two crests; an enemy covers it. | The bot ambushes from hull-down, firing first at your side. | Read the dead ground: approach from an angle the ambusher's crest does not cover, or cross where it cannot see; reach its flank. Score: Flank or Duck. | Liberation of Caen, Bocage |
| 6 | **Never chase the bait** | One enemy tank shows, fires, and pulls back behind a building. | Two bots: the bait retreats, the second waits off to one side. | Stop at the corner; look; find the second tank; take it on from cover, or leave. Score: Duck (survive), then Ghost against the waiting tank. | Berlin, Stalingrad |
| 7 | **Hold the corner** | A medium tank peeks a building corner at you. | The bot peeks, fires and backs off on your reload. | Keep the gun laid on the corner and fire the instant it stops to shoot; or move during its hidden time so it peeks into nothing. Score: Ghost. | Berlin, Market Garden |
| 8 | **Out of the burn** | You are hit to the critical state (under 12 HP) in a duel. | The bot pushes to finish you. | Break line of sight first (the turret answers at a fifth of its speed), then repair as an engineer or reach a pad; fight again full. Score: Duck. | Any |
| 9 | **The fighting withdrawal** **[faces]** | A Tiger or M10 out-ranges you in the open. | The bot advances and fires every 4 s. | Reverse toward cover, front to it, firing at its running gear if you carry a heavy gun; make it cross ground to follow. Score: Duck, or Flank if it follows into a flank shot. | Kursk, Gazala |
| 10 | **Tanks and infantry** | Your tank in a village with enemy anti-tank soldiers about. | Rocket soldiers wait for your rear; an engineer mines the road. | Keep moving, keep buildings at a distance, back up when infantry are behind you, turn to face, drive in friends' tracks. Score: Duck, no round on your rear. | Market Garden, Berlin |

The top three (turn to face, the peek on the reload, the first round) are the
ones a pilot most lacks: they carry no instinct over from flying. Lesson 4,
the circle, is the one most like a dogfight, and the best bridge for the owner.

### What to measure from real rounds

The dogfight school mines player recordings for real fights. The tank
equivalents to extract from replays, per tank-on-tank engagement: who had line
of sight first and by how many seconds; who fired first, and who won; the
face each hit struck and its aspect; the range of each hit; exposure seconds
per tank before the kill; whether the killer was stationary when it fired;
whether a circle (bearing rate above the victim's traverse) preceded the kill;
and whether the kill came from a tank the victim had never seen. If "fired
first wins" holds in BF1942 at anything like the WWII rate, it is the school's
opening slide.
