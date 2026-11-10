// When they have the height, on a jet (features/dogfight-lessons-jets,
// under-the-height.md).
//
// The fights are the lesson's own starts, seats and 55 s, against the jet's
// ace: the same boom-and-zoomer, who turns over the top under the roof
// (`jetBoomAndZoom`, `jetUhAce`, `dogfight-jet-plan-under-the-height.js`).
// Every jet pilot's pull toward the sky is capped by 800 m (`stepPilot`,
// `underRoof` in `dogfight-jet-ceiling.js`), and the ace starts under it,
// at 735 m on the F-16 (`pacedHeight`). On the F-16 the climb that is fatal
// on a Spitfire gains speed as it climbs: you are at their height 13.5 s
// in, before their one dive gets near. Neither plane gets over 780 m. The
// climb between their dives ends level with them, a kilometre apart; the
// straight climb ends with them sitting behind you, nose on you, and you a
// little behind on energy; turning flat is the one that is fired at. The
// Dip is the lesson's own (`uhDip`). The words are rewritten (RETUNING.md,
// case b), every number from the nine flights on the F-16, and held by
// `tests/test_dogfight_jet_under_the_height.py`.
export default {
  note: 'On a jet their height does not last: climbing at full throttle you are level with them in 13.5 to 26 s, and neither of you can climb past about 780 m. Climb between their dives and break the one that commits: you end level with them, a kilometre apart. Climb straight on in front of them and they end up sitting behind you; turn flat and they get their shots.',
  story: [
    'They have the height, about 500 m of it, and they start their dive at you from 1 km out. The natural thing is to climb straight for it, nose 30 degrees up, full throttle.',
    'On a jet that nearly works. The F-16 climbs and gains speed at once. You are at their height 13.5 s in, while their one dive is still coming: at 14 s they pull out of it 410 to 450 m behind you, a few metres under you, without firing.',
    'Then there is nowhere higher to go: at 1,000 m a wing makes no lift at all, and both of you level off under 780 m. For a moment you have the energy, up to 92 m of it, 25 s in. But you are flying straight on in front of them, and they come up behind you: for 8 to 38 s of the fight they sit inside 450 m with their nose on you. A boom-and-zoomer with no height to dive from does not shoot, so they never fire; you, looking back for them, give your speed away and end 12 to 86 m of energy behind.',
    'Turning flat is worse. They dive three or four times, and in three of the nine flights their third dive, about 41 s in, gets a burst off from 300 to 360 m; one round lands in two of them. And it buys nothing: you finish about 127 m higher than you started, at 83 m/s, 340 to 420 m of energy behind them.',
  ],
  counterStory: [
    'Climb, but between their dives: when they are zooming away or turning over the top, put the nose up at full throttle, up to 20 degrees as the speed allows, turning gently to keep them in sight.',
    'When they commit to a dive at you, inside about 490 m with their nose on you, break: turn as hard as it goes, into them. Their pass is spoiled: they pull out without firing and zoom away.',
    'Flown nine times from slightly different starts: never fired at. Climbing between their dives broke their one dive at 435 to 485 m and had their height at 24 to 26 s, later than the straight climb, and 40 to 90 m of energy on them for a moment. Then the top of the sky evens it: you finish level with them, at 767 m and 127 m/s, a kilometre apart, and they never once sit behind you.',
    'So on a jet the height they start with is worth seconds, not the fight. Climb between their dives and break the one that commits; turning flat is the one that loses.',
  ],
  flyAce: 'jetUhAce',
  ace: { plan: 'jetBoomAndZoom' },
  demos: {
    move: { note: 'Nose 30 degrees up, full throttle, straight for the height, levelled off under the top of the sky.' },
    flat: { note: 'Round and round, as hard as it turns without losing height.' },
    counter: { note: 'Climb while they are away, break when they commit, climb again, up to their height under the top.' },
    dip: {
      ace: 'jetUhAce',
      steps: { steps: [
        { phase: 'climb', say: 'Climb while they are not coming at you (W)' },
        { phase: 'break', say: 'They dive inside about 490 m: break hard, into them' },
        { phase: 'dip-run', say: 'Their height spent, about 65 m of energy yours: run, nose 2° down, flat out' },
      ] },
      note: 'Climb between their dives, and break their dive and their chase. Once their height is spent and you have about 65 m of energy on them, and their nose is well off you (or they are past 770 m), run straight away from them, flat out, the nose 2 degrees down. Never run down their nose line.',
      verdict: { works: 9, of: 9, line: 'In all nine their guns never fire and they are never on your tail; in five, turned onto them on the way, you land 1 to 3 rounds. You start the run 36 to 62 s in; in seven they let you go 39 to 64 s in, and at 70 s you are 1.1 to 8.7 km apart and opening, at 116 to 124 m/s.' },
    },
    flip: {
      ace: 'jetUhAce',
      note: 'Break their first dive and climb. If they come after you level, from behind, break into them, and the moment they have gone past you, slow, reverse onto their tail with the lead. Then stay on top: climb, and once the energy is yours come down on them from above.',
      verdict: { works: 0, of: 9, line: 'No. In all nine you break their dive and climb, and their guns never fire; but they almost never go past you slow after a break, so there is no tail to reverse onto. The reversal is never flown.' },
    },
    ninja: {
      ace: 'jetUhAce',
      note: 'Break their dive and their chase and climb in between, so their guns are never on you. Once the energy is yours, you are the boom-and-zoomer: down on them from above with the lead, up and over before they can turn onto you. If a pass leaves you level with them and no shot, do not circle with them: leave.',
      verdict: { works: 0, of: 9, line: 'No. Their guns never fire and they are never on your tail, and in five of the nine you land 1 to 3 rounds as they cross in front of you; but the energy is never yours by the margin the move waits for: under the top of the sky you climb level with them and no higher, so the dive from above never starts.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes. On a jet a climb at full throttle takes their height away in 13 to 26 s, and the top of the sky leaves you level with them. To get clear: climb between their dives, break the ones that commit, and once the energy is yours, run: clear in 9 of 9, never fired at. Turning it round does not follow on the F-16: they almost never go past you slow (the Flip, 0 of 9), and you never get above them to dive (the Ninja, 0 of 9).' },
  coach: {
    chase: { line: 'They are coming after you from behind', tip: 'Do not climb on in front of them: when they are about 490 m out with their nose on you, break into them, hard.', keys: ['Mouse', 'Arrows'] },
    meet: { line: 'You are diving on them and they are turning to face you', tip: 'Do not take a head-on pass: pull up and keep the height.', keys: ['Mouse'] },
    climb: { line: 'They are climbing away to get above you again', tip: 'They are not coming at you: climb now, up to 20 degrees, full throttle. Level off under 800 m: there is little lift up there and none at 1,000 m.', keys: ['W', 'Mouse'] },
    perch: { line: 'They are above you, picking their moment', tip: 'Climb while they wait: their height lasts seconds. Watch their nose: when it comes round to you, be ready to break.', keys: ['W'] },
    dive: { line: 'They are diving at you', tip: 'Wait until they are about 490 m out, then BREAK: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
    zoom: { line: 'They have gone past and are zooming up', tip: 'Climb again, now, up to their height. They level off under the top of the sky: so do you, by 800 m.', keys: ['W', 'Mouse'] },
    reverse: { line: 'They are turning over the top', tip: 'Keep climbing, and keep them in sight.', keys: ['W'] },
    evade: { line: 'You are on their tail', tip: 'Shoot as they turn, then climb: do not follow them into their turn.', keys: ['Space'] },
  },
};
