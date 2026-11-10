// When they have the height, on a jet (features/dogfight-lessons-jets,
// under-the-height.md).
//
// The fights are the lesson's own starts, seats and 55 s, against the jet's
// ace: the same boom-and-zoomer, who turns over the top under the roof
// (`jetBoomAndZoom`, `jetUhAce`, `dogfight-jet-plan-under-the-height.js`).
// Every jet pilot levels off by 800 m (`stepPilot`, `underRoof` in
// `dogfight-jet-ceiling.js`), and the ace starts under it, at 735 m on the
// F-16 (`pacedHeight`). On the F-16 the climb that is fatal on a Spitfire
// gains speed as it climbs: you are at their height 13.5 s in, before their
// one dive gets near, and nobody is fired at in any of the three. The roof
// then takes the rest of their edge: both planes end up level under it at
// the same speed. Only turning flat loses. The Dip is the jet's own
// (`jetUhDip`): run once it is even, coming down off the roof first. The
// words are rewritten (RETUNING.md, case b), every number from the nine
// flights on the F-16, and held by
// `tests/test_dogfight_jet_under_the_height.py`.
export default {
  note: 'On a jet their height does not last: climbing straight at full throttle you are level with them 13.5 s in, before their dive gets near you, and nobody is fired at in nine flights. Neither of you can climb past about 840 m, so the fight ends level. Only turning flat gives them the sky.',
  story: [
    'They have the height, about 500 m of it, and they start their dive at you from 1 km out. The natural thing is to climb straight for it, nose 30 degrees up, full throttle.',
    'On a jet that works. The F-16 climbs and gains speed at once, from 72 to 125 m/s. You are at their height 13.5 s in, while their one dive is still coming: at 14 s they pull out of it 410 to 450 m behind you, already a few metres under you, without firing.',
    'Then there is nowhere higher to go. At 1,000 m a wing makes no lift at all, so both of you level off under 840 m and fly on there at 125 m/s. Their energy edge is gone by 28 to 33 s, and at 55 s you are level with them, at the same speed: dead even, and they never dive again.',
    'Turning flat is safe too: they dive three times and never fire. But it buys nothing: you finish about 127 m higher than you started, at 83 m/s, about 350 to 570 m of energy behind them.',
  ],
  counterStory: [
    'Climb, but between their dives: when they are zooming away or turning over the top, put the nose up at full throttle, up to 20 degrees as the speed allows, turning gently to keep them in sight.',
    'When they commit to a dive at you, inside about 490 m with their nose on you, break: turn as hard as it goes, into them. Their pass is spoiled: they pull out without firing and zoom away.',
    'Flown nine times from slightly different starts: none of the three was fired at. Climbing between their dives broke their one dive at 435 to 485 m and had their height at 24 to 25 s, about 11 s later than the straight climb. For a few seconds after it you are 65 to 100 m of energy ahead; then the top of the sky evens it, and you finish where the straight climb does, level with them at 125 m/s.',
    'So on a jet the height they start with is worth about 13 s. Climb, straight or between their dives, and it is gone; turning flat is the one that loses.',
  ],
  flyAce: 'jetUhAce',
  ace: { plan: 'jetBoomAndZoom' },
  demos: {
    move: { note: 'Nose 30 degrees up, full throttle, straight for the height, levelled off under the top of the sky.' },
    flat: { note: 'Round and round, as hard as it turns without losing height.' },
    counter: { note: 'Climb while they are away, break when they commit, climb again, up to their height under the top.' },
    dip: {
      ace: 'jetUhAce',
      seat: 'jetUhDip',
      steps: { steps: [
        { phase: 'climb', say: 'Climb while they are not coming at you (W)' },
        { phase: 'break', say: 'They dive inside about 490 m: break hard, into them' },
        { phase: 'dip-run', say: 'Level with them, flying apart: run, nose down off the top, flat out' },
      ] },
      note: 'Climb between their dives, and break their dive and their chase. Up under the top of the sky nobody wins 50 m of energy: once it is even, you level with them, and the two of you flying apart, run straight away from them, flat out, the nose 5 degrees down to 780 m and then 2 degrees down. Never run down their nose line.',
      verdict: { works: 9, of: 9, line: 'In all nine their guns never fire and they are never on your tail. You start the run 28 to 37 s in, they let you go 37 to 46 s in, and at 70 s you are 4.6 to 6.0 km apart at 120 to 125 m/s.' },
    },
    flip: {
      ace: 'jetUhAce',
      note: 'Break their first dive and climb. If they come after you level, from behind, break into them, and the moment they have gone past you, slow, reverse onto their tail with the lead. Then stay on top: climb, and once the energy is yours come down on them from above.',
      verdict: { works: 0, of: 9, line: 'No. In all nine you break their dive and climb, and their guns never fire; but they almost never go past you slow after a break, so there is no tail to reverse onto. The reversal is flown in two of the nine, 27.5 and 50.4 s in, and brings no shot.' },
    },
    ninja: {
      ace: 'jetUhAce',
      note: 'Break their dive and their chase and climb in between, so their guns are never on you. Once the energy is yours, you are the boom-and-zoomer: down on them from above with the lead, up and over before they can turn onto you. If a pass leaves you level with them and no shot, do not circle with them: leave.',
      verdict: { works: 0, of: 9, line: 'No. Their guns never fire and they are never on your tail, but the energy is never yours: under the top of the sky you climb level with them and no higher, so the dive from above never starts in any of the nine.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes. On a jet any climb at full throttle takes their height away in 13 to 25 s, and the top of the sky leaves you level with them. To get clear: climb between their dives, break the ones that commit, and once you are even and flying apart, run, down off the top first: clear in 9 of 9, never fired at. Turning it round does not follow on the F-16: they almost never go past you slow (the Flip, 0 of 9), and you never get above them to dive (the Ninja, 0 of 9).' },
  coach: {
    chase: { line: 'They are coming after you from behind', tip: 'Do not climb on in front of them: when they are about 490 m out with their nose on you, break into them, hard.', keys: ['Mouse', 'Arrows'] },
    meet: { line: 'You are diving on them and they are turning to face you', tip: 'Do not take a head-on pass: pull up and keep the height.', keys: ['Mouse'] },
    climb: { line: 'They are climbing away to get above you again', tip: 'They are not coming at you: climb now, up to 20 degrees, full throttle. Level off by 800 m: there is little lift up there and none at 1,000 m.', keys: ['W', 'Mouse'] },
    perch: { line: 'They are above you, picking their moment', tip: 'Climb while they wait: their height lasts seconds. Watch their nose: when it comes round to you, be ready to break.', keys: ['W'] },
    dive: { line: 'They are diving at you', tip: 'Wait until they are about 490 m out, then BREAK: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
    zoom: { line: 'They have gone past and are zooming up', tip: 'Climb again, now, up to their height. They level off under the top of the sky: so do you, by 800 m.', keys: ['W', 'Mouse'] },
    reverse: { line: 'They are turning over the top', tip: 'Keep climbing, and keep them in sight.', keys: ['W'] },
    evade: { line: 'You are on their tail', tip: 'Shoot as they turn, then climb: do not follow them into their turn.', keys: ['Space'] },
  },
};
