// Galactic Conquest's own lessons (features/dogfight-lessons-gcmod): shown
// first in the school on GCMOD and nowhere else (`dogfight-lessons.js`
// `lessonsFor`). Data, like the jet files: the plans are `plans.js`.
//
// Both sides fly at the craft's own size (`pace: 1`), with the craft's own
// lasers and hull, read off GCMOD's data:
//
// - the lasers: `MediumLaserProjectileRedNS` / `GreenNS`, 650 m/s, living
//   5 s; the X-Wing's four `XWing_Laser_Cannon` at 5.3 rounds a second each,
//   the TIE fighter's one `TieFighterGuns` at 4.8;
// - the hulls: a bolt (material 702, 7 damage) does twice that to GCMOD's
//   light armour (material 801, modifier 2.0): 14. The X-Wing's 90 hit points
//   are 7 bolts, the TIE's 55 are 4.
//
// Every number in the words is measured from the nine starts (the school's
// ±30 m and ±3 m/s about yours) on the published X-Wing and TIE fighter,
// `tests/dogfight_gcmod_harness.mjs`, and held by
// `tests/test_dogfight_gcmod.py`.

const LASER = { speed: 650, reach: 3250, span: 0.5, converge: 0 };
/** The X-Wing's fight: four cannon, seven bolts to bring it down. */
export const XWING = Object.freeze({ pace: 1, gun: { ...LASER, rate: 21.2 }, killHits: 7 });
/** The TIE fighter's: one gun, four bolts. */
export const TIE = Object.freeze({ pace: 1, gun: { ...LASER, rate: 4.8 }, killHits: 4 });

export const GC_LESSONS = [
  {
    id: 'dont-race-a-tie',
    mods: ['gcmod'],
    title: 'Never race a TIE',
    tagline: 'A TIE on your tail is faster than you and brakes as hard. Do not run, do not brake: turn.',
    story: [
      'A TIE fighter on your tail, 450 m back and closing. In an X-Wing the reflex is to run for it, and it is the wrong one: a TIE flies level at 108 m/s to the X-Wing\'s 79. From nine starts, straight and level at full throttle, it closed to 95 m and shot you down in all nine, 16 s in. A bolt takes 14 of your 90 hit points: seven bring you down.',
      'Nor do the brakes save you. Pull the throttle right back and the X-Wing\'s lift engines spin up and stand it on the air: from 86 m/s to 7.7 in 9.8 s, climbing 51 m as it slows. But the TIE carries the same lift engines, and its pilot eases off as hard as you do. In all nine it stayed behind you and shot you down 15 to 17 s in; it got past you in three, after you were already done.',
    ],
    counterStory: [
      'Turn. As they come inside 300 m, hard over at full throttle. A TIE is fast in a straight line; it does not follow a hard turn round. From the same nine starts its bolts never touched you, it ended up in front of you 9 to 19 s in, in all nine, and at 40 s the two of you were 52 to 224 m apart and nobody was down.',
      'Once it is in front, your four cannon are on it: four bolts bring a TIE down (55 hit points). In one fight of the nine you landed two before it got away.',
    ],
    ace: { plan: 'hunter', craft: 'tiefighter', name: 'TIE fighter', fight: TIE, start: { at: [0, 300, 450], headingDeg: 0, speed: 100 } },
    you: { craft: 'X-Wing', name: 'X-Wing', fight: XWING, start: { at: [0, 300, 0], headingDeg: 0, speed: 78 } },
    demos: [
      { id: 'move', label: 'Run for it', seat: 'swRun', skill: 0.9, aceSkill: 1,
        note: 'Full throttle, straight: try to outrun them.',
        verdict: { works: 0, of: 9, line: 'In all nine the TIE closes to 95 m and shoots you down 15.8 to 16.2 s in: seven bolts, and you never fire one.' } },
      { id: 'brake', label: 'Hit the brakes', seat: 'swBrake', skill: 0.9, aceSkill: 1,
        note: 'Full reverse as they close, hoping they fly past.',
        verdict: { works: 0, of: 9, line: 'In all nine the TIE brakes with you (down to 39 to 41 m/s; you to 25) and shoots you down 14.7 to 16.8 s in; in three it slides past you at 19 s, too late.' } },
      { id: 'counter', label: 'Turn hard', seat: 'swBreak', skill: 0.9, aceSkill: 1,
        note: 'Hard over at full throttle as they close: they cannot follow it round.',
        verdict: { works: 9, of: 9, line: 'In all nine no bolt of theirs lands; the TIE is in front of you 9 to 19 s in, and at 40 s you are 52 to 224 m apart, both still flying. In one you land two bolts on it.' } },
    ],
    seconds: 40,
    coach: {
      run: { line: 'A TIE closing on your tail', tip: 'Do not run and do not brake: it is faster and brakes as well. Hard over as it comes inside 300 m.', keys: ['Mouse', 'A', 'D'] },
    },
  },
  {
    id: 'four-guns-to-one',
    mods: ['gcmod'],
    title: 'Four guns to one',
    tagline: 'Head-on, the X-Wing wins: four cannon against one, seven bolts against four. A TIE pilot never takes that pass.',
    story: [
      'An X-Wing and a TIE fighter, head-on, 1,400 m apart. The X-Wing\'s four cannon put out 21 bolts a second to the TIE\'s single gun\'s 4.8, and a TIE comes apart after four bolts (55 hit points, 14 a bolt) where an X-Wing takes seven. From nine starts, both straight at each other with the guns on, the X-Wing shot the TIE down in all nine, 6.1 to 7.1 s in, after taking 0 to 4 of the seven bolts that would have finished it.',
      'In an X-Wing, take that pass every time.',
    ],
    counterStory: [
      'In the TIE, never take it. Turning off the line and coming back round is not enough: the X-Wing still shot you down in five of nine, 10.3 to 10.9 s in, and you landed two bolts at most.',
      'Turn off the line before the guns bear, and keep going. At full throttle a TIE is 108 m/s to the X-Wing\'s 79, and from the same nine starts no bolt landed either way: the nearest the two came was 1,124 m, and at 40 s they were 2.2 km apart. Come back on your terms, from behind (the lesson before this one, from the X-Wing\'s seat).',
    ],
    ace: { plan: 'swJoust', craft: 'tiefighter', name: 'TIE fighter', fight: TIE, start: { at: [0, 300, -1400], headingDeg: 180, speed: 105 } },
    you: { craft: 'X-Wing', name: 'X-Wing', fight: XWING, start: { at: [0, 300, 0], headingDeg: 0, speed: 78 } },
    demos: [
      { id: 'move', label: 'The joust', seat: 'swJoust', skill: 0.9, aceSkill: 1,
        note: 'Both straight at each other, guns on.',
        verdict: { works: 9, of: 9, line: 'The X-Wing wins all nine, 6.1 to 7.1 s in, four bolts on the TIE; the TIE lands 0 to 4 of the seven it needs.' } },
      { id: 'slash', label: 'The TIE comes back', seat: 'swJoust', ace: 'swSlash', skill: 0.9, aceSkill: 1,
        note: 'The TIE turns off the line and comes back round with its speed.',
        verdict: { works: 4, of: 9, line: 'For the TIE: shot down in five of nine, 10.3 to 10.9 s in; in the other four nobody goes down. It lands two bolts at most.' } },
      { id: 'counter', label: 'The TIE leaves', seat: 'swJoust', ace: 'swExtend', skill: 0.9, aceSkill: 1,
        note: 'The TIE turns off the line and runs: the X-Wing cannot follow.',
        verdict: { works: 9, of: 9, line: 'For the TIE: never hit in nine of nine; never closer than 1,124 m, and 2.2 km apart at 40 s.' } },
    ],
    seconds: 40,
    coach: {
      joust: { line: 'Head-on with a TIE', tip: 'In an X-Wing, hold the line and fire: four bolts bring it down. In a TIE, off the line before the guns bear, and away.', keys: ['Mouse', 'Space'] },
    },
  },
];
