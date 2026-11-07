# Dogfights from the recordings

Status: built (2026-11-07). The detector, the extractor and the dogfight
school's FROM THE RECORDINGS list are in place and run over the 32 public
recordings; the extracted fights are local files, not yet published. Not yet
flown or watched by a person.

Real dogfights out of the round recordings players upload, played back in the
dogfight school's theatre (features/dogfight-school) in its simplified view:
two fighters over a grid, their paths, their shots, the kill, the words for
who was on whose tail. The owner's aim, over time, is to learn which
manoeuvres win, and from that to learn dogfighting skills to try in game.

## What it does

1. `tools/bf1942-models/extract_dogfights.mjs` reads recordings with the
   viewer's own reader (`viewer/replay-recording.js`), finds every fight with
   `viewer/dogfight-detect.js`, and writes each one to
   `viewer/dogfights/<slug>-<n>.json`, one row each in
   `viewer/dogfights/index.json`.
2. The theatre lists the index under FROM THE RECORDINGS, grouped by round,
   both-pilots-shooting first, then the kills, then the longest. A filter
   shows the dogfights only, or every attack.
3. Picking one fetches its file and turns it into the fight the theatre plays
   (`viewer/dogfight-recorded.js`), the same shape `runDuel` gives a flown
   lesson: every camera, the gunsight views, the shot freeze, the energy
   chart and the tracers work as they do for a lesson. The tags, captions,
   meters and cameras carry the pilots' names (decoded, `decodePlayerName`),
   and the battle's own type is drawn when the Range's battle parks it
   (`planeVisualFor`).

```bash
# the newest public recordings, downloaded and searched
node tools/bf1942-models/extract_dogfights.mjs --download <dir> --recent 50
# recordings you have, with the feed's mod, level and date
node tools/bf1942-models/extract_dogfights.mjs <dir or files> --feed feed.json
# what it finds, written nowhere
node tools/bf1942-models/extract_dogfights.mjs <dir> --report
```

The 32 recordings (803 MB) take about 7 s. Then open the Range on a battle
with aircraft, open the school (V) and pick a fight under FROM THE
RECORDINGS.

## How a dogfight is found

Each number is in `RULES` (`viewer/dogfight-detect.js`).

1. **A plane** is a life a player flies: someone controls the life itself
   (the pilot's seat, not a gunner's), the model catalogue calls its template
   an aircraft (`category: 'air'` in the assets site's `models.json`,
   vanilla's and each mod's: 859 aircraft of 4,986 templates), and it holds
   40 m/s or more for 3 s while the recording keeps it live. A client
   recording freezes what is out of its player's network range
   (`isReplicated`); frozen stretches are not used. A template the catalogue
   does not hold falls back to motion alone: fast for half the time it moves.
   Without the catalogue, El Alamein's modded KettenKrads (73 m/s on the
   ground), Willys and Kubelwagens, and the spectator's free camera, all came
   out as planes.
2. **A pair** is two planes in the air at once whose pilots are on opposite
   sides at the time.
3. **An aimed shot** is a round from the pilot's own plane (not a bomb or a
   torpedo, not a gunner's or the anti-aircraft's) that would pass within
   25 m of the other plane: flown at 400 m/s plus the shooter's own velocity
   for up to 1.5 s against where the other really went. A round sprayed at
   the sky, or at someone else, is not one.
4. **Evidence** is every aimed shot either way, every hit (a server
   recording's impact on the other plane, or the other plane's hit points
   falling within 1.5 s of an aimed shot), and the kill (the score's kill,
   killer and victim the two pilots).
5. **A fight** is a run of evidence with no gap over 15 s, opened 8 s before
   its first piece and closed 4 s after its last (3 s after a kill), trimmed
   to where both planes are live and flown by those two. It needs 3 aimed
   shots, and the two inside 600 m at some moment.
6. **A dogfight** is a fight where both pilots shot at each other, or which
   lasted 12 s with both turning through 180 degrees. Anything else is a
   **bounce**: one pilot attacking, the other not answering.

A pilot's control record is sent again every few seconds, now and then with a
blink to another object: spans of one pilot in one plane under 2 s apart are
one flight (without this, every fight came out 2 to 7 s long).

A plane far from the recording player is updated every second or three. The
replay holds a pose until the next sample is due (right for a parked hull);
the detector draws a straight line between samples instead, and a gap over
3 s is not live (`maxGap`). Held then moved, an Avenger on Battle of Makin
stood still and jumped 126 m in a tenth of a second; now 3 of the 578 tracks
pass 150 m/s at all (201, 186 and 181 m/s at their fastest; not yet looked
at).

## What the theatre reads into it

The file holds only what the recording says: both planes every 0.1 s in the
recording's frame, the propellers' revs, every gun round, the evidence. The
rest is worked out at load (`viewer/dogfight-recorded.js`), by the school's
own rules, so it improves without extracting again:

- the recording's frame to the viewer's (z negated, `replay-actors.js`);
- the situation (`geometry`, `situation` in `dogfight-pilot.js`): on his
  tail, on mine, head on, turning for position, held 1 s before the caption
  says it;
- a shot that would land: the nose on the lead inside 400 m (`gunSolution`);
- each round flown against the other's path, a hit where it passes within
  7 m (the sparks); the hits the recording proves are counted apart;
- THE FIGHT and THE NUMBERS under the picture: who, in what, where and when;
  each pilot's time on the other's tail, time chased, aimed rounds, time with
  a shot that would land, proven hits, degrees turned, speed and height in
  and out.

## The first catch (2026-11-07)

The 32 public recordings: 14 rounds hold air fights. 289 fights, 140 of them
dogfights, 22 with both pilots shooting, 104 ending in a kill. A fight's
median is 13.5 s, a dogfight's 17.6 s, the longest 58 s. 7.6 MB of files.

| Level | Fights | Dogfights | Both shooting | Kills |
|---|---|---|---|---|
| el_alamein | 109 | 50 | 16 | 39 |
| battle_of_britain | 60 | 24 | 0 | 17 |
| coral_sea | 34 | 12 | 4 | 11 |
| bocage | 33 | 21 | 0 | 14 |
| battleaxe | 17 | 14 | 0 | 6 |
| market_garden | 14 | 11 | 1 | 7 |
| kharkov | 9 | 2 | 0 | 6 |
| baytown | 6 | 2 | 0 | 3 |
| battle_of_makin | 4 | 2 | 0 | 0 |
| supercharge-1942, rush_to_baghdad, midway | 3 | 2 | 1 | 1 |

Two things already show:

- **Whoever shoots first wins.** Of the 104 kills, 97 went to the pilot who
  fired the first aimed round. Most attacks are bounces: the attacked pilot
  never shoots back.
- **When both shoot, it turns.** In the 22 fights where both pilots fired,
  6 ended in a kill, and the first to fire won only 2 of them.

Checked by eye: El Alamein's BennyBlanco (Bf 109) against Chief-H.E.M.P
(Yak9), a 26 s turning fight passing 12 m apart, Chief-H.E.M.P on his tail at
130 m with BennyBlanco down to 26 m/s, then the kill; Battle of Britain's
Option_X (Spitfire) shooting down A de(CHN) (Bf 109) in 15 s. Both read as
the fight from above and from behind each plane.

## Tests

`tools/bf1942-models/tests/test_dogfight_recordings.py` writes a 30 s round
in the recorder's own format (a Spitfire chasing a Bf 109 round a circle with
aimed bursts and a kill, a teammate shooting at his own side, a burst at the
sky, a jeep, a 50 m/s KettenKrad), reads it with the viewer's reader and holds
every rule above: the planes, the one fight, its window, its sides, the
aimed count, the kill, and the theatre's frame and reading of it.

## Open

- **Publishing.** The files are local (`viewer/dogfights` is ignored, as the
  other generated trees are). For play.bfstats.io they need a home on the
  assets volume and a run after each upload, or the replay page could find a
  recording's fights itself (the detector is a browser module and runs in a
  fraction of a second on a parsed recording).
- **The heights** are the recording's own, metres above the map's zero, not
  above the ground under the plane.
- **The planes drawn** are the Range battle's types when it parks them; a
  fight on another battle's types falls back to the battle's fighter.
- **Server recordings** carry impacts (`i`) and so prove hits outright;
  client recordings prove them by hit points, which only the client's
  replicated objects carry.

## Next: what wins

The owner's aim is to learn which manoeuvres win. The fights are now data:
both paths at 10 Hz, the shots, the hits and the result, labelled with who
was on whose tail, second by second. The next steps:

1. **Name the manoeuvres** in a recorded path with the school's own vocabulary
   (break turn, high and low yo-yo, scissors, Immelmann, split-S, boom and
   zoom, the chop): rules over the path's turn rate, climb, speed and the
   geometry to the other plane, checked against the school's flown lessons,
   whose manoeuvres are known.
2. **Score them**: for every named manoeuvre, what the geometry was before and
   after (who was behind whom, the energy, the range), and how the fight
   ended. A table of manoeuvre against situation against outcome, across all
   the fights, is the first answer to "what works".
3. **Learn from it**: with a few hundred more fights, a model that predicts
   the outcome from the opening geometry and the manoeuvres flown, and the
   school's pilots flying the moves the data says win (the Dip, the Flip and
   the Ninja checked against what real players did).
