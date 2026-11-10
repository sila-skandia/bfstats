// When they have the height, on a jet (features/dogfight-lessons-jets,
// under-the-height.md).
//
// The fights are the lesson's own starts, seats and 55 s, against the jet's
// ace: the same boom-and-zoomer, who levels every zoom and climb off under
// the top of the sky (`jetBoomAndZoom`, `jetUhAce`,
// `dogfight-jet-plan-under-the-height.js`, over `dogfight-jet-ceiling.js`).
// On the F-16 the climb that is fatal on a Spitfire (down to 35 m/s on a
// straight line) gains speed as it climbs, and the diver never gets inside
// 280 m: none of the three ways out is fired at once in nine starts. The
// flight law's lift goes to nothing at 1,000 m (`aircraft.js`
// AIR_DENSITY_ZERO_AT_HEIGHT), and every pilot noses over at 880 m
// (`dogfight-pilot.js` `guard`, read over the pace), so the straight climb
// levels off just under the top and keeps the height it won. On a jet both
// climbs win it back; only turning flat loses. The words are rewritten
// (RETUNING.md, case b), every number from the nine flights on the F-16, and
// held by `tests/test_dogfight_jet_under_the_height.py`.
export default {
  note: 'A diver cannot catch a jet that climbs at full throttle: in nine flights on the F-16 not one of the three ways out was fired at. Climb, straight or between their dives, and level off before the top of the sky: at 1,000 m a wing makes no lift at all.',
  story: [
    'They have the height, about 670 m of it, and they start their dive at you from 1.1 km out. The natural thing is to climb straight for it, nose 30 degrees up, full throttle.',
    'On a jet that works. The F-16 climbs and gains speed at once: their dive at 120 to 130 m/s never gets nearer than 280 to 320 m, and they pull out without firing. You are at their height 11 s in and have as much energy as they do at 16 s.',
    'The air thins as you climb, and at 1,000 m a wing makes no lift at all, nor does the tail. So level off before it: past 880 m, nose to the horizon. You top out at 950 m and fly on there at 132 to 138 m/s. They level off under the top too, at 870 m, and never get above you again: they never dive a second time. At 55 s you are 100 to 180 m of energy ahead of them.',
    'Turning flat is safe too: they dive three times and never fire. But it buys nothing: you finish 126 m higher than you started, at 83 m/s, 390 to 490 m of energy behind them.',
  ],
  counterStory: [
    'Climb, but between their dives: when they are zooming away or turning over the top, put the nose up at full throttle, up to 20 degrees as the speed allows, turning gently to keep them in sight.',
    'When they commit to a dive at you, inside about 490 m with their nose on you, break: turn as hard as it goes, into them. Their pass is spoiled: they pull out without firing and zoom away to try again.',
    'On a jet there is a roof over the fight. A diver who knows the top of the sky levels off under it, at 860 m, and your climb goes on: once you are higher than that they cannot get above you again without climbing into the thin air, and they do not.',
    'Flown nine times from slightly different starts: none of the three was fired at. Climbing between their dives broke their one dive at 485 m, had their height at 24 s and climbed 680 m, to 910 m at 135 m/s, and finished 120 to 130 m of energy ahead of them and about 50 m above them. On a jet the straight climb does as well: the Spitfire\'s trap is not there, as long as you level off under the top. Turning flat is the one that loses.',
  ],
  flyAce: 'jetUhAce',
  ace: { plan: 'jetBoomAndZoom' },
  demos: {
    move: { note: 'Nose 30 degrees up, full throttle, straight for the height, levelled off as the air runs out.' },
    flat: { note: 'Round and round, as hard as it turns without losing height.' },
    counter: { note: 'Climb while they are away, break when they commit, climb again: up over their roof, under the top.' },
    dip: {
      ace: 'jetUhAce',
      note: 'Climb between their dives, and break their dive and their chase. Once their height is spent and you have 50 m of energy on them, and their nose is well off you (or they are past 770 m), run straight away from them, flat out, the nose 2 degrees down. Never run down their nose line.',
      verdict: { works: 9, of: 9, line: 'In all nine their guns never fire and they are never on your tail. You start the run 32 to 35 s in, they let you go 38 to 44 s in, and at 70 s you are 8.3 to 9.4 km apart at 128 to 129 m/s.' },
    },
    flip: {
      ace: 'jetUhAce',
      note: 'Break their first dive and climb. If they come after you level, from behind, break into them, and the moment they have gone past you, slow, reverse onto their tail with the lead. Then stay on top: climb, and once the energy is yours come down on them from above.',
      verdict: { works: 0, of: 9, line: 'No. In all nine you break their dive and climb, and their guns never fire; but they almost never go past you slow after a break, so there is no tail to reverse onto. The reversal is flown once in nine, 29.5 s in, and brings no shot.' },
    },
    ninja: {
      ace: 'jetUhAce',
      note: 'Break their dive and their chase and climb in between, so their guns are never on you. Once the energy is yours, you are the boom-and-zoomer: down on them from above with the lead, up and over before they can turn onto you. If a pass leaves you level with them and no shot, do not circle with them: leave.',
      verdict: { works: 0, of: 9, line: 'No. Their guns never fire and they are never on your tail, and in all nine you win the energy, 36 to 41 s in; but the shot does not follow. In none of the nine do you have it for a moment.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes. On a jet any climb at full throttle wins the height back, straight or between their dives, as long as you level off under the top. To get clear: climb between their dives, break the ones that commit, and run once their height is spent: clear in 9 of 9, never fired at. Turning it round does not follow on the F-16: they almost never go past you slow, so the reversal never brings the shot (0 of 9), and the height won does not bring the shot either (0 of 9).' },
  coach: {
    chase: { line: 'They are coming after you from behind', tip: 'Do not climb on in front of them: when they are about 490 m out with their nose on you, break into them, hard.', keys: ['Mouse', 'Arrows'] },
    meet: { line: 'You are diving on them and they are turning to face you', tip: 'Do not take a head-on pass: pull up and keep the height.', keys: ['Mouse'] },
    climb: { line: 'They are climbing away to get above you again', tip: 'They are not coming at you: climb now, up to 20 degrees, full throttle. Level off before 1,000 m: there is no lift up there.', keys: ['W', 'Mouse'] },
    perch: { line: 'They are above you, picking their moment', tip: 'Climb while they wait. Watch their nose: when it comes round to you, be ready to break.', keys: ['W'] },
    dive: { line: 'They are diving at you', tip: 'Wait until they are about 490 m out, then BREAK: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
    zoom: { line: 'They have gone past and are zooming up', tip: 'Climb again, now. They level off under the top of the sky: climb on over them, but stay under 1,000 m.', keys: ['W', 'Mouse'] },
    reverse: { line: 'They are turning over the top', tip: 'Keep climbing, and keep them in sight.', keys: ['W'] },
    evade: { line: 'You are on their tail', tip: 'Shoot as they turn, then climb: do not follow them into their turn.', keys: ['Space'] },
  },
};
