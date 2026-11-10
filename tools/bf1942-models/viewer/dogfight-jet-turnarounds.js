// The Immelmann and the split-S on a jet (features/dogfight-lessons-jets,
// turnarounds.md).
//
// The fights are the lesson's own plans; what a jet does with them is the
// lesson. The F-16 climbs faster than it slows, so its Immelmann costs it
// 12 m/s for 130 m of height and does not leave it hanging at the top: the
// counters built on catching them slow up there get a snap shot at most.
// Its split-S costs 163 m and turns 58 m/s into 96, but a jet is slow for
// only a second or two at 600 m with the throttle open, so the split-S stage
// starts 120 m closer (the ace decides at 650 m, Spitfire units, while still
// slow); from the lesson's own stage the ace is past 75 m/s by then and goes
// up instead. A loop started high runs into the roof every jet's pilot flies
// under (`dogfight-jet-ceiling.js`, 800 m), which pushes it off before the
// top; the lesson's own Immelmanns start at 350 to 380 m and are untouched
// by it. Every number below is the F-16 from the nine starts (the
// harness's for the demos, the school's `STARTS` for the Dip, Flip and
// Ninja), in real metres and m/s.
const SPLIT_STAGE = { at: [40, 460, -640], headingDeg: 180, speed: 45 };

export default {
  note: 'The Immelmann costs a jet almost nothing: they went up at 95 m/s and came over the top at 83, 130 m higher, and were never slow enough to catch hanging there. The split-S still trades height for speed, 163 m for 38 m/s, and it is for a jet that is slow and high, which a jet is only for a moment.',
  story: [
    'After a pass you have to turn round. A flat turn round at full pull takes an F-16 3 seconds from 96 m/s and leaves it at 79 m/s, at the height it was. The two vertical ways round trade height and speed instead, and a jet trades them on better terms than a Spitfire: its engine pushes harder than its weight, so it does not run out of speed going up.',
    'Fast: pull straight up through half a loop and, upside down on top, roll upright. That is the Immelmann. Here the ace has just gone past you at 95 m/s; they climb about 130 m and roll out going back the other way 4.8 seconds later at 83 m/s, and 4 seconds after that they are at 89 m/s and still more than 100 m up. That is the turn round to make after a pass, and to make low down. The air thins toward 1000 m, and a jet\'s pilot levels off by 800 m, where the wing still has a fifth of its lift: from 450 m the loop is still round in 5 to 6 seconds, but from 510 m the climb is levelled off before the top, and they roll out 265 to 290 m higher after 9 to 10 seconds, only 92 to 122 degrees round. From 580 m up they never go over the top at all: the loop is flattened at 816 to 831 m, and 14 seconds later they are still up there, not round.',
    'High and slow, with you coming at them: roll upside down with the nose on the horizon, then pull through half a loop downward. That is the split-S. They go in at 58 m/s and come out going back the way they came, 163 m lower and at 96 m/s, 5.3 seconds later. A jet is slow only for a moment, and that is the moment for it: from cruising speed a split-S buys almost no speed (in at 97 m/s, out at 91 to 101). It needs 500 m under it: from 380 m the pull out of the dive stops it 40 to 50 degrees short of round.',
  ],
  counterStory: [
    'An Immelmann on a jet does not end slow. Chase them up from 170 m behind and you do not hang under them either: you never drop below 66 m/s. But they are over the top and coming back down past you before your nose is on them. Flown nine times: 0 to 0.1 seconds of fire that would land, 0 to 3 hits, and they pass 50 to 54 m over you.',
    'Holding off and climbing at the top of their loop does not catch them hanging there, because they never hang: their slowest is 69 m/s. Their loop is tight and brings them back over you head on, 5 seconds after they pull up. From 420 m back that is a head-on snap: 0.2 to 0.7 seconds of fire that would land, 0 to 5 hits, passing 23 to 43 m apart. They fire nothing back.',
    'A split-S ends low and fast: they have given you 163 m of height for 38 m/s of speed. Let them go and they run off at 96 m/s and nobody fires. The one-dive ambush that works on a Spitfire does not work here: once their nose is 25 degrees down their split-S is over in about 2 seconds, and your dive arrives after they are out. Dive as they roll over instead and you arrive in front of them as they come out, and they shoot you down.',
    'And if you want out: when they Immelmann back at you after a head-on pass, turn back under their loop the moment they are past and going up, and run the way they came. They roll out 280 to 340 m from you, chase from 260 m, never close, and let you go at 630 to 700 m, about 18 seconds in.',
  ],
  survival: { verdict: 'yes', line: 'Yes: turn back under their Immelmann and run, and they never catch you (9 of 9). Nothing else here works on a jet: the dive on their split-S arrives after they are out of it (0 of 9), and the circle round under their loop meets them coming back over you, not under their tail (0 of 9).' },
  demos: {
    immelmann: {
      note: 'They went by 170 m in front of you and pull up. You pull straight up after them: on a jet you keep your speed, but they are over the top before you have a shot.',
    },
    'immelmann-counter': {
      label: 'You meet them coming back',
      note: 'The same Immelmann, you 420 m back: you hold off and climb 20 degrees at the top of their loop. They do not hang there; they come back over you head on.',
    },
    split: {
      aceStart: SPLIT_STAGE,
      note: 'They are slow at 58 m/s and high, you 115 m higher and coming at them. They split-S away; you fly on and keep your height.',
    },
    dip: {
      verdict: { works: 9, of: 9, line: 'In all nine they never fired: they rolled out over the top 277 to 342 m from you, chased from about 260 m, were 634 to 704 m behind and not closing at 17.5 to 17.9 s, turned away, and you were 2937 to 3081 m apart at 32 s.' },
    },
    flip: {
      note: 'Head on, they are faster, and they Immelmann to come back down on you. Turn back under their loop the moment they are past and keep turning, all the way round onto their heading. On a jet it fails: their loop is so tight that they roll out almost over you, see you and break. Take the Dip.',
      verdict: { works: 0, of: 9, line: 'No: in all nine you come round 114 to 193 m from them 10 s in, not under their tail but under their roll-out, and they see you and turn on you within 3.5 s. Fire that would land: 0 to 0.1 s. Flown on to 45 s it is a turning circle with them: 0 to 2 hits either way.' },
    },
    ninja: {
      aceStart: SPLIT_STAGE,
      note: 'The one-dive ambush, tried on a jet. Meet them from above and hold your height while they roll over. When their nose is 25 degrees down, dive with the lead. On a jet the split-S is over before you get there: you pass over them and they run.',
      verdict: { works: 0, of: 9, line: 'No: in all nine they split-S, and your dive starts as their nose goes down, 3.5 to 3.7 s in, 237 to 298 m from them; 1.5 s later they are out and going the other way, 148 to 227 m under you at the closest, and nobody has fired. Diving sooner, as they roll over, put you in front of them as they came out: shot down in all nine.' },
    },
  },
  coach: {
    pass: { line: 'They have gone past you fast, about to turn round', tip: 'Watch which way they go: up or down. Keep your speed.', keys: ['W'] },
    immelmann: { line: 'Immelmann: they are going up through half a loop', tip: 'They will not be slow at the top. Turn back under their loop and run.', keys: ['Mouse', 'W'] },
    rollout: { line: 'They are upside down on top, rolling upright', tip: 'They are coming back over you, fast. Keep going.', keys: ['W'] },
    top: { line: 'They are on top going the other way, above you', tip: 'They have the height and their speed. Full throttle and keep going.', keys: ['W'] },
    split: { line: 'Split-S: they rolled upside down', tip: 'They are giving you the height. Keep it: their split-S is over before a dive gets there.', keys: ['W'] },
    pullthrough: { line: 'They are pulling through, going back the way they came below you', tip: 'Keep your height and your speed.', keys: ['W'] },
    run: { line: 'They are running out of the split-S, fast and low', tip: 'Let them go, or come down on them with your height before they climb back.', keys: ['Mouse', 'W'] },
    attack: { line: 'They are coming back at you', tip: 'Turn to face them.', keys: ['Mouse', 'Arrows'] },
    chase: { line: 'They are after you, their height into speed', tip: 'Full throttle and keep going: once their height is spent they gain nothing on you.', keys: ['W'] },
    'let-go': { line: 'They have let you go', tip: 'You are out of the fight. Climb, and come back with the height.', keys: ['W'] },
    meet: { line: 'You turned back at them: they are turning to face you', tip: 'Do not meet them level and slow. Keep going, or come back with the height.', keys: ['W'] },
  },
};
