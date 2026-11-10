// When they have the height, on a jet (features/dogfight-lessons-jets,
// under-the-height.md).
//
// The fights are the lesson's own, unchanged: the same ace, starts, seats
// and 55 s. What a jet changes is the lesson. On the F-16 the climb that is
// fatal on a Spitfire (down to 35 m/s on a straight line) gains speed as it
// climbs, 72 to over 120 m/s, and the diver never gets inside 410 m: none of
// the three ways out is fired at once in nine starts. What a jet must not do
// is climb into the top of the sky: the flight law's lift goes to nothing at
// 1,000 m (`aircraft.js` AIR_DENSITY_ZERO_AT_HEIGHT), for the tail as for the
// wing, and the straight climb reaches it at 21 s, falls 330 m nose down,
// climbs back and hangs there. Climbing between the dives keeps its speed
// under the top while the diver's zoom carries them over it. So the words
// are rewritten (RETUNING.md, case b), every number from the nine flights on
// the F-16, and held by `tests/test_dogfight_jet_under_the_height.py`.
export default {
  note: 'A diver cannot catch a jet that climbs at full throttle: in nine flights on the F-16 not one of the three ways out was fired at. What throws the height away is the top of the sky: at 1,000 m a wing makes no lift at all, and a jet held nose up into it falls out of it.',
  story: [
    'They have the height, about 670 m of it, and they start their dive at you from 1.1 km out. The natural thing is to climb straight for it, nose 30 degrees up, full throttle.',
    'On a jet that works, for a while. The F-16 climbs and gains speed at once, from 72 to over 120 m/s: their dive at 120 to 130 m/s never gets nearer than 410 to 440 m, and they pull out above you without firing. You are at their height 11 s in, have as much energy as they do at 21 s, and 630 m more than them at 35 s.',
    'But the air thins as you climb, and at 1,000 m a wing makes no lift at all, nor does the tail. Held at 30 degrees, the nose takes you into it at 21 s and falls through: you drop 330 m nose down, climb back, and hang at the top, the nose bobbing and the speed bleeding away. At 55 s you are at 680 to 700 m and 31 to 44 m/s, 280 to 300 m under them, with 840 to 880 m less energy. You won the height back and threw it away.',
    'Turning flat is safe here too: they dive three times and never fire. But it buys nothing: you finish 126 m higher than you started, at 83 m/s, 410 to 620 m of energy behind them.',
  ],
  counterStory: [
    'Climb, but between their dives: when they are zooming away or turning over the top, put the nose up at full throttle, up to 20 degrees as the speed allows, turning gently to keep them in sight.',
    'When they commit to a dive at you, inside about 490 m with their nose on you, break: turn as hard as it goes, into them. Their pass is spoiled: they pull out without firing and zoom away to try again.',
    'Your climb keeps its speed and stays under the top. Their zoom does not: it carries them over 1,000 m, up to 1,050 to 1,150 m, where nothing holds them up, and they come down slow, at 15 to 34 m/s.',
    'Flown nine times from slightly different starts: none of the three was fired at. Climbing straight had their height in 11 s and lost it at the top. Turning flat gained 126 m. Climbing between their dives climbed 680 to 730 m, to 910 to 960 m at 130 to 143 m/s, and finished 980 to 1,360 m of energy ahead of them, down at 240 to 640 m.',
  ],
  demos: {
    move: { note: 'Nose 30 degrees up, full throttle, straight for the height, and held there.' },
    flat: { note: 'Round and round, as hard as it turns without losing height.' },
    counter: { note: 'Climb while they are away, break when they commit, climb again: under the top.' },
    dip: {
      note: 'Climb between their dives, and break their dive and their chase. Once their height is spent and you have 50 m of energy on them, and their nose is well off you (or they are past 770 m), run straight away from them, flat out, the nose 2 degrees down. Never run down their nose line.',
      verdict: { works: 9, of: 9, line: 'In all nine their guns never fire and they are never on your tail. You start the run 27 to 38 s in, they let you go 36 to 54 s in, and at 70 s you are 3.7 to 7.5 km apart at 127 to 131 m/s.' },
    },
    flip: {
      note: 'Break their first dive and climb. If they come after you level, from behind, break into them, and the moment they have gone past you, slow, reverse onto their tail with the lead. Then stay on top: climb, and once the energy is yours come down on them from above.',
      verdict: { works: 0, of: 9, line: 'No. In all nine you break their dive and climb, and their guns never fire; but they never go past you slow after a break, so there is no tail to reverse onto. In five your climb takes you in behind them, 30 to 38 s in, and they break away from you.' },
    },
    ninja: {
      note: 'Break their dive and their chase and climb in between, so their guns are never on you. Once the energy is yours, you are the boom-and-zoomer: down on them from above with the lead, up and over before they can turn onto you. If a pass leaves you level with them and no shot, do not circle with them: leave.',
      verdict: { works: 0, of: 9, line: 'No. Their guns never fire, and in eight you win the energy, 29 to 58 s in; but the shot does not follow. You have it in four, half a second at most, and land 2 rounds in one and 1 in another. In four they sit on your tail for 1 to 11 s, without firing.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes: climb between their dives, break the ones that commit, and run once their height is spent: clear in 9 of 9, never fired at. Turning it round does not follow on the F-16: they never go past you slow, so the reversal never comes (0 of 9), and the height won does not bring the shot (0 of 9).' },
  coach: {
    chase: { line: 'They are coming after you from behind', tip: 'Do not climb on in front of them: when they are about 490 m out with their nose on you, break into them, hard.', keys: ['Mouse', 'Arrows'] },
    meet: { line: 'You are diving on them and they are turning to face you', tip: 'Do not take a head-on pass: pull up and keep the height.', keys: ['Mouse'] },
    climb: { line: 'They are climbing away to get above you again', tip: 'They are not coming at you: climb now, up to 20 degrees, full throttle. Level off before 1,000 m: there is no lift up there.', keys: ['W', 'Mouse'] },
    perch: { line: 'They are above you, picking their moment', tip: 'Climb while they wait. Watch their nose: when it comes round to you, be ready to break.', keys: ['W'] },
    dive: { line: 'They are diving at you', tip: 'Wait until they are about 490 m out, then BREAK: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
    zoom: { line: 'They have gone past and are zooming up', tip: 'Climb again, now, and stay under 1,000 m. Their zoom may carry them over the top.', keys: ['W', 'Mouse'] },
    reverse: { line: 'They are turning over the top', tip: 'Keep climbing, and keep them in sight.', keys: ['W'] },
    evade: { line: 'You are on their tail', tip: 'Shoot as they turn, then climb: do not follow them into their turn.', keys: ['Space'] },
  },
};
