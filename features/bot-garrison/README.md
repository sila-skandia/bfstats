# Bot garrison: one defender a captured flag, the rest pushing

Asked 2026-09-24: too many bots stayed around to defend. One defender for
each flag the side has taken is enough, and the rest push. The defender does
not stand there like a statue: he mans a gun at the flag or walks around it,
like a player hanging back to hold it.

## Where the idle bots came from

The engine's SAI (`viewer/strategic-ai.js`) splits its free bots into
attackers and defenders by the strategy's aggression, and wants at least two
defenders on a defended area (`round(2 x max(1, present))`). A bot that none
of its targets collected holds the area it stands in (`retainBot`) and is
re-ordered there every 20 s. Inside an area its side holds, that order asks
for nothing, so the bot stands and scans. On Bocage every strategy has no
defences and aggression 1, so the idle soldiers were all of this kind: bots
held at the base they spawned at, or at the flag they had just taken.

Separately, bots sat in fixed guns for whole matches. A gun is worth a flat
5.0 to the Change law with no enemy about (`fixedStrategic`), and "an enemy
in reach" counts any enemy inside the gun's range whether anyone has seen it
(the engine's `getEnemyObjects` branch), which from the bridges' AA guns
(300 m) and MG42s (250 m) is most of Bocage. A gunner's own seat never took
the fixed-weapon test at all, so nothing made him get up.

## The garrison (INVENTION)

`viewer/doctrine-garrison.js`, the doctrine 'garrison', over the SAI's own
strategy, targets and bookkeeping (`strategic-ai.js _distribute` with
`opts.garrison`; the 'sai' doctrine passes none, so its traces are
unchanged):

- **Posts.** Each flag the side holds and the enemy can take gets at most one
  bot, up to a third of the side's alive bots (none below three bots), the
  flags the SAI's own `_defenceNeed` rates highest first (the area's
  temperature with the hostile and neutral neighbour factors). A post stands
  while the side holds its flag. It goes to the flag's last guard when he is
  free again, else the nearest free bot on foot or in a fixed gun. A
  record's `post` is set only while the bot is posted (`lastPost` keeps the
  flag's guard): a guard freed by a unit change and collected by an attack
  target before the next pass had kept his `post`, counted as a second guard
  and took a post order when his team took that flag.
- **Everyone else attacks.** A free bot is an attacker whatever the
  aggression, and one the attack targets did not collect joins the nearest of
  them instead of holding where it is.
- **What the guard does (`WPPost`).** With a free fixed gun within 1.75 flag radii of
  the flag, he walks to its door and presses Use, and mans it (the gun's
  Scout sweeps, its Fire shoots). With none, he walks a ring of six points
  0.6 flag radii round the flag (6..15 m), stands 3..7 s at each point while
  his Scout looks round, then walks on. A leg starting more than two flag
  radii off runs. A posted bot does not Change, and one posted from a gun away
  from his flag gets out.
- **Guns only when engaged.** A bot not on a post values a fixed gun only for
  an enemy he has spotted inside its range and traverse, and gets out of one
  once he has none (at the gun's own exit point).

The page runs the garrison by default (`map.html`, `?doctrine=sai` for the
engine's SAI alone). The runner's default is still the SAI, the baseline:
`sim/run.mjs --doctrine garrison` runs the page's.

## Measured

Bocage, 8 a side, 420 s, seeds 1..4, the SAI against the garrison (same
code otherwise). Measured before bots' rounds met their own side
([features/bot-friendly-fire](../bot-friendly-fire/README.md)); re-run
before comparing against it:

| | SAI | garrison |
|---|---:|---:|
| soldiers on foot standing still 10 s or more (not firing) | 1642 s | 275 s |
| of which a guard stopping at a ring point | | 18 s |
| guards on foot (walking their ring or to their gun) | | 1071 s |
| bots in fixed guns | 6512 s | 4477 s |
| of which guards | | 1608 s |
| gunners not on a post, with no target | 5363 s | 2039 s |
| captures (per match) | 2, 4, 4, 3 | 2, 2, 6, 5 |

At most two guards a side at once (the cap for 8 bots), never two on one
flag; both bridges and the sawmill were each guarded when held. The gunners
left with no target are mostly bots that took a gun for an enemy they had
spotted and are held in it by the Change law's 15 s ramp.

## The rule between orders (2026-11-10)

The engine's SAI drops a bot's order when his unit changes
(`SAI::handleChangingBot` 0x08631450, `strategic-ai.js` `botChangedUnit`) and
orders him again at the next pass. The garrison's `guns: 'engaged'` rode on
the order alone, so for those seconds a bot weighed a fixed gun by the
engine's open rule (any enemy inside its range, AI-59) instead of the
garrison's (a spotted one). On BF1918's aube_de_soiree that was a loop: on
foot the base's Frz155er was worth its base 25 and a horse 12 m off won (85);
mounted, the order gone, the gun was worth 155 against 106 for staying, so
he got off; on foot, ordered again, the horse won. The same lapse threw a
post's man out of the gun his post had just seated him in, and the next pass
seated him again (PomPom_Static).

* The side's doctrine carries its standing rule (`gunsRule`, `doctrine.js`
  `gunsRuleOf`), which the referee hands each bot every tick; `bot-mount.js`
  `gunsRule(bot)` reads the order's flag, or the side's while he holds none.
* A doctrine's `unitChanged(id, previous)` may return the order the bot keeps
  until the next pass: the garrison keeps a post's own boarding (an order in
  its `board` phase) and its posted record; any other unit change drops the
  order and the post, as before.
* Measured, 16 bots, team 2 / team 1: aube_de_soiree 180 s, rides shorter
  than 2 s 50 / 63 before (18 / 53 on horses), 1 / 3 after (none on a horse);
  El Alamein three 120 s runs each, 71 boardings and 2 short rides before, 67
  and 2 after; DC Basrah's Edge 150 s, 28 short before, 14 after (all
  `Pickup`, a separate loop still open). `tests/test_doctrine.py`
  `test_a_post_keeps_its_order_through_a_unit_change`, `tests/test_bot_ai.py`
  `test_the_gun_rule_holds_between_orders`.

## Knobs

`GARRISON` in `doctrine-garrison.js` (KNOBS.md, "garrison" rows).

## One unit urgency, seated or on foot (2026-11-10)

The `Pickup` loop left open above had its own cause. `BBChange::calculateUrgency`
0x0855e0c0 scores every unit around through `calculateVehicleUrgency`
0x08583b10, seated or not (`features/bf1942-ai-research-2026-09-21/bot-behaviours.md`
section 8; `features/bf1942-ai-spec/KNOBS.md`: the x2.5 move factor when a bot
already sits in the unit, the 15 s ramps after the bot left it and after it
spawned). `bot-mount.js` `urgencyChange` gave those three terms to the
candidates on foot only. Seated, a Pickup's driver scored another Pickup's
passenger seat, its driver a bot, at 63 (x4 on the move term); on foot the same
seat was 44, so he walked to a Shilka (48), and from the Shilka's seat the
Pickup was 63 again. The seated loop now scores a unit exactly as the foot
branch does. `tests/test_bot_ai.py` `test_a_seated_bot_scores_a_unit_as_it_would_on_foot`.

Rides shorter than 2 s, 16 bots, before -> after: DC Basrah's Edge 150 s, four
runs 9, 4, 11, 3 -> three runs 0, 0, 0; FHSW Battle_Of_Orel-1943 150 s 4 -> 1;
El Alamein 120 s 2 -> 0; BF1918 aube_de_soiree 180 s 0 -> 0.
