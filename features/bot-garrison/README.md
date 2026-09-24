# Bot garrison: one busy guard a flag

Asked 2026-09-24: too many bots stayed around to defend. One is enough, and
it should look active, like a player manning a post: on a gun at the flag,
or walking around the flag.

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
  bot, front flags first, up to a third of the side's alive bots (none below
  three bots). The post goes to the flag's last guard when he is free again,
  else the nearest free bot on foot or in a fixed gun.
- **Everyone else attacks.** A free bot is an attacker whatever the
  aggression, and one the attack targets did not collect joins the nearest of
  them instead of holding where it is.
- **The post (`WPPost`).** With a free fixed gun within 1.75 flag radii of
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
code otherwise):

| | SAI | garrison |
|---|---:|---:|
| soldiers on foot standing still 10 s or more (not firing) | 1642 s | 317 s |
| of which a post stopping at a ring point | | 13 s |
| posts on foot (walking their ring or to their gun) | | 1039 s |
| bots in fixed guns | 6512 s | 4431 s |
| of which posts | | 1670 s |
| unposted gunners with no target | 5363 s | 1969 s |
| captures (per match) | 2, 4, 4, 3 | 2, 2, 7, 5 |

The unposted gunners left with no target are mostly bots that took a gun for
an enemy they had spotted and are held in it by the Change law's 15 s ramp.

## Knobs

`GARRISON` in `doctrine-garrison.js` (KNOBS.md, "garrison" rows).
