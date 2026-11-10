// Boom and zoom on a jet (features/dogfight-lessons-jets/boom-and-zoom.md).
//
// Under the roof every jet pilot flies (`dogfight-jet-ceiling.js`) the ace
// perches at 730 m, 372 m over you. The pass is the Spitfire's, faster: one
// 1.1 s burst lands 15 to 23 rounds, where the lesson's 0.6 s burst leaves
// eight of nine alive in 60 s. With it the pilot who never looks up is shot
// down from all nine starts by 52 s; the one who meets the dive is never hit,
// and after that one dive the ace never gets above them again.
//
// The way out on a jet is up, not down: the flight law thins the air with
// height and the drag with it, so a jet is fastest at the top of the sky
// (128 m/s level at 770 m on the F-16, 93 at 215 m). The Spitfire's Dip runs
// low, and the ace dives after it from its height and closes; the jet's Dip
// (`jetBzDip`, dogfight-jet-plan-boom-and-zoom.js) runs straight on climbing
// 3 degrees, and the ace, with no height over you left to dive with, gives
// the chase up. Its ace (`jetBzAceMeet`) dives as soon as you are 30 degrees
// under them: from the lesson's perch your climb took you up to them in three
// starts of nine before they dived, and no Dip was flown there.
//
// Every number below is the F-16's, real metres and m/s, held by
// `tests/test_dogfight_jet_boom_and_zoom.py`: the school's nine starts (x by
// speed) for the story and the demos, the measure's nine (`dogfight-measure.js`
// STARTS, scored as `movesOn` scores them) for each verdict.
export default {
  note: 'The pass is the same and faster: one burst lands 15 to 23 rounds, so the pilot who never looks up goes down in one pass or two. Flown nine times on the F-16 they were shot down every time, 13 to 52 s in; the one who met the dive was never hit, and once it was met the ace never got above them again.',
  story: [
    'The pilot above you holds the cards. Height is speed waiting to be spent: they come down on you fast, hold their fire until you fill their sight, fire one burst, and before you can turn they use that speed to zoom back up, out of reach. Then they turn over the top and do it again.',
    'On a jet the sky has a roof. A wing makes no lift at 1,000 m, so a jet\'s pilot levels off under 800 m, and the height they have on you is what lies under that: perched at 730 m, 372 m over you. They dive from 338 to 356 m above you, 587 to 621 m out, and one burst lands 15 to 23 rounds.',
    'Erich Hartmann, the highest-scoring ace in history, fought almost only like this: see, decide, attack, reverse.',
  ],
  counterStory: [
    'Turn to face them when they commit to the dive. Facing you, their dive is a head-on pass with no time to aim: they pull out and zoom off without firing a round.',
    'Do not stand on your tail to do it: turn round flat and keep your speed. Then let them zoom away and climb shallow at full throttle, turning gently to keep them in sight.',
    'On a jet one met dive is the whole of their height. You climb as well as they do, and under the top of the sky there is nowhere above you for them to go back to: after it they never dive on you again, and the two of you end level, at 764 to 770 m.',
    'Then leave, upward. A jet is fastest where the air is thin: straight on at full throttle, climbing gently, you reach the top of the sky at 128 m/s, and with no height over you left to dive with they give the chase up.',
    'Flown nine times from slightly different starts, the pilot who never looked up was shot down every time, in one pass or two, 13 to 52 s in. The one who met the dive was not hit once.',
  ],
  seconds: 60,
  ace: { memory: { burst: 1.1 } },
  demos: {
    counter: {
      note: 'You climb shallow, turn to face their dive and never chase their zoom. On a jet they dive once: after it you are as high as they are, under the top of the sky, and they never get above you again.',
    },
    dip: {
      label: 'The Dip: meet them, then up and away', seat: 'jetBzDip',
      ace: 'jetBzAceMeet', aceMemory: { phase: 'perch', burst: 1.1, perchDown: 30 },
      note: 'Meet their first dive head on, then straight on out of the pass the way it left you while their zoom takes them the other way: full throttle, the nose 3 degrees up. Not down low, as a Spitfire runs: a jet is fastest at the top of the sky, and there they have no height over you to dive with.',
      verdict: { works: 9, of: 9, line: 'Out in all nine and never hit: their guns never bore on you. They dive after you once more, 16 s in, from 1.7 to 1.8 km back and only 146 to 189 m above you, never get within 798 m, and give up the chase 19.5 to 20.4 s in. At 90 s you are 16.8 to 17.3 km apart, you at 770 m and 128 m/s.' },
    },
    flip: {
      note: 'This opens where their height is spent: both of you climbing at about 600 m. When they turn their nose away, in behind them with the lead, and if the guns do not bear in 3 to 5 s, up and away, never round after them. On a jet they turn to face you, and the climb takes you both to the top of the sky.',
      verdict: { works: 0, of: 9, line: 'None of the nine. They turn to face you 1.3 to 3.3 s in, and again 12.2 to 13.4 s in. In eight you go in behind them at 9.6 to 10.9 s and come within 32 to 59 m of them, but your guns never bear; in the ninth you never go in. Nobody is hit.' },
    },
    ninja: {
      note: 'This opens where their height is spent: both of you climbing at about 600 m. Climb with them until you are over them, turn toward them, and make one pass down on them with the lead. On a jet you are over them in seconds, but never far enough over to dive on.',
      verdict: { works: 0, of: 9, line: 'None of the nine. You get over them 4.5 to 8.6 s in, but never far enough over them for the dive, and you run 7.9 to 10.1 s in. Nobody fires a shot that bears, and at 25 s you are 1.7 to 3.2 km apart.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes: meet their dive, then go straight on at full throttle, climbing gently to the top of the sky, where a jet is fastest. They dive after you once more from far behind, never get within 798 m, and give the chase up: clear in 9 of 9, never hit. Run low as a Spitfire does and they follow you down. Nothing gets you on top of them (the Flip and the Ninja, 0 of 9 each).' },
};
