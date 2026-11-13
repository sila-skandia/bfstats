// The flat scissors on a jet (features/dogfight-lessons-jets/scissors.md).
//
// Flown as written on the F-16 the braid came apart: the nose answers 0.8 s
// late, so a pilot who reverses as the paths cross swings 104 to 106
// degrees off the line, and at full throttle the jet does not drift ahead a
// little, it weaves at 73 to 78 m/s to the ace's 43 to 48 and is 240 to 530
// m out in front at 45 s. Here both pilots fly the scissors with the
// reversal led by the lag (`jetScissors`, `mem.lead` 0.8 s) and on the
// brakes, the pilot in trouble a little faster than the ace (42-46 against
// 38-42 in the Spitfire's m/s: 53 against 47 real, the Spitfire's 45 to 40).
// The braid holds; it is nobody's kill; and on a jet there is no way out of
// it: the cannon reaches, so the Dip is shot down from every start.
export default {
  note: 'A jet flies the scissors on the brakes and reverses early, because the nose answers 0.8 s late. Flown nine times on the F-16 it braided along one line and was nobody\'s kill; the slower pilot got the only shots, never more than 0.13 s, and the pilot who left it was shot down every time.',
  story: [
    'It starts with an overshoot: you came in too fast and slid out alongside them, on their heading. Now each of you turns into the other, your paths cross, and both reverse to turn into each other again. From above the two paths braid along one line, like the blades of a pair of scissors.',
    'Every crossing is a race to be slowest along that line. The faster one drifts forward a little each time, and the slower one gets a nose onto the faster as they cross: snap shots, on a jet a tenth of a second or less, never a steady seat on a tail.',
    'A jet\'s nose answers the stick 0.8 s late, so a jet pilot starts each reversal before the crossing, not at it. Reverse as the paths cross and the weave swings past 100 degrees off the line, the passes as close as 3 m. And a jet\'s full throttle is not a little faster: flown that way you weave at 73 to 78 m/s to their 43 to 48 and are 240 to 530 m out in front at 45 s. So both of you are on the brakes here: they sit at about 47 m/s, you at 53, and that is enough.',
  ],
  counterStory: [
    'Throttle back early and reverse early: roll the other way just before you cross, because the nose takes most of a second to answer. Keep the nose on the horizon.',
    'Do not shoot as you cross them head-on: that is a split second. Wait until they have drifted out in front and your nose comes onto their tail.',
    'Do not leave it. A jet\'s cannon reaches: run at a crossing and they turn after you and sit 240 to 440 m behind you, close enough to shoot you down, in all nine. Going up out of it gets you the height for a few seconds only: the roof levels your climb off and they climb after you, level with you by 40 s and then in behind you. Flown nine times slower than them, you never once sat in their rear quarter.',
  ],
  survival: { verdict: 'no', line: 'No way out on a jet: while it lasts they get a tenth of a second at a time (one hit in 45 s, in 4 of 9), but leave at a crossing and they shoot you down (9 of 9); fly it slower than them and you never get behind them; go up and they climb after you to the roof and come in behind you (0 of 9 each).' },
  ace: { plan: 'jetScissors', memory: { lead: 0.8 } },
  // FLY IT's ace on a jet: the lesson's `scAce`, its scissors led.
  flyAce: 'jetScAce',
  // FLY IT's guide and instructor: stay in it. No way out works on a jet,
  // and the lesson's best move by the count would be a Ninja at 0 of 9.
  guide: 'jetScissors',
  you: { memory: { lead: 0.8, fast: false, band: [42, 46] } },
  demos: {
    move: { seat: 'jetScissors', note: 'You scissor too, on the brakes, but a little faster than them: about 53 m/s to their 47.' },
    dip: {
      seat: 'jetScDip', ace: 'jetScAce', label: 'The Dip: out at a crossing, tried',
      note: 'Two crossings in, at the second you do not reverse: hold the heading the crossing left you on, full throttle, a shallow dive. What you see is it failing: a jet\'s cannon reaches.',
      verdict: { works: 0, of: 9, line: 'Out 8 to 9 s in, every time, and they turn after you: they sit 240 to 440 m behind you, inside their cannon\'s reach, and shoot you down 14 to 17 s after you left, in 9 of 9. Leaving at the first, third or fourth crossing, or diving steeper, did no better (0 of 9).' },
    },
    flip: {
      seat: 'jetScFlip', ace: 'jetScClimber',
      note: 'The move most pilots try first: from the first crossing you throttle back and fly the scissors slower than them, so that they should drift out in front. What you see is it failing: three crossings, never behind them, sinking under them.',
      verdict: { works: 0, of: 9, line: 'A jet scissors cannot be turned round either: you slow to 39 to 42 m/s against their 48 to 49 and cross them three times, but you are never in their rear quarter at all. Your guns get a snap of 0.2 to 0.3 s in 2 of 9, and you sink 60 to 71 m, ending 32 to 56 m under them. They snap you as you cross (0.07 to 0.27 s, in 2 of 9) without a hit, passing as close as 10 m.' },
    },
    ninja: {
      ace: 'jetScClimber',
      note: 'You do not fly the scissors: at the overshoot you go up 45 degrees at full throttle, to come down on them from above. On a jet the climb does not run out of speed, it runs into the roof: what you see is the height won, levelled off, and caught up.',
      verdict: { works: 0, of: 9, line: 'The height is yours for a few seconds only: you climb 357 to 395 m in 20 s, up to the roof, and they climb after you, so at 20 s you are only 20 to 40 m over them, and by 40 s level with them. You never come down on them with a shot. Flown on, they come in behind you under the roof: rounds on you in 5 of 9 by 40 s and in 8 of 9 by 60 s, though nobody is shot down.' },
    },
  },
  coach: {
    reverse: { line: 'They are scissoring: turning into you each time you cross', tip: 'Throttle back (S) and reverse each time you cross, early: the nose takes most of a second to answer.', keys: ['S', 'Mouse', 'Arrows'] },
    cross: { line: 'They crossed: they are reversing', tip: 'Reverse now, toward them.', keys: ['Mouse', 'Arrows'] },
    shoot: { line: 'You drifted out in front of them', tip: 'Break hard into them, now.', keys: ['Mouse', 'Arrows'] },
  },
};
