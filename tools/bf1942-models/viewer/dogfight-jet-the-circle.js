// Breaking the circle on a jet (features/dogfight-lessons-jets/the-circle.md).
//
// Flown on the F-16 from the nine starts the school scores a move from
// (`dogfight-measure.js` `STARTS`), every try with the plan it flies on the
// Spitfire: none of the six breaks the circle (0 of 9 each). Leaving, the
// Spitfire's way out, fails because an equal jet behind you never falls
// back: they sit 285 to 361 m behind with their guns bearing, and only the
// hunter's habit of holding fire outside 150 m (192 m on the jet) keeps you
// alive. Going straight up costs a jet nothing, and costs them nothing
// either. The words say so; no fight is changed.
export default {
  note: 'Nothing breaks it. Flown nine times on the F-16, none of the six ways out landed a round or got clear: an equal jet follows you up, down and away, and run from them and they sit 285 to 361 m behind you with their guns on you.',
  tagline: 'Two equal jets turning round each other: nobody gets a shot. Six ways to break it, and none does.',
  story: [
    'Two equal fighters each go for the other\'s tail and end up half a turn apart on one circle, each turning as hard as it holds its height. Pilots have called it the Lufbery since the First World War. Neither can bring the nose round onto the other, because neither turns faster.',
    'A jet brings one more thing to trade: thrust. An F-16 climbs at 60 degrees and gains speed doing it, so going up costs nothing. But it costs the other jet nothing too. Between two F-16s flown equally there is still nothing to trade: 50 to 279 m apart for the first 8 s, both speeding up to 85 to 90 m/s, and in 30 s nobody gets a shot.',
    'Six ways to break it were flown against the school\'s hunter from nine starts each. On the F-16 none works.',
  ],
  counterStory: [
    'Leaving, the Spitfire\'s way out, does not work here. Roll out while they are across the circle, full throttle, nose down, and they turn after you and settle 285 to 361 m behind you, nose on you, their guns bearing for 16 to 23 s of the 32. They never let you go. Only the hunter\'s habit of holding fire outside 190 m keeps you alive; turn back at them and the pass is head-on, they are behind you again, and in two of nine they shoot you down.',
    'Straight up you top out 274 to 322 m over them still at 105 m/s, but they come up after you just as cheaply, and at the ceiling there is no more up: you hang at 25 to 29 m/s and fall away under them. The throttle back only slows you to 37 m/s and sinks you 272 to 320 m under them. Reversing the turn just turns the circle the other way, with no pass at all. Nose low you come round behind them and the jet climbs back up to them at 82 m/s, but the nose never comes onto them.',
    'Do not go into the circle with an equal jet. Inside it nobody is hit; out of it, they are behind you.',
  ],
  survival: { verdict: 'no', line: 'No: on the F-16 nothing gets you out. Leaving, going straight up, out and back, the throttle chop, reversing the turn and the nose-low turn all fail (0 of 9 each). Leaving puts them 285 to 361 m behind you with their guns on you, and out and back gets you shot down in two of nine. The circle itself never hurts you: nobody has a shot in it.' },
  demos: {
    circle: {
      note: 'The deadlock: half a turn apart on one circle, both turning as hard as it goes, both speeding up to 85 to 90 m/s. Watch the gun lines: neither nose ever comes round onto the other.',
    },
    dip: {
      label: 'The Dip: out of the circle, tried',
      note: 'Eight seconds of the circle, then out: wings level on the circle\'s edge while they are across it going the other way, full throttle, nose 6 degrees down. What you see is it failing: an equal jet behind you never falls back.',
      verdict: { works: 0, of: 9, line: 'In all nine they turn after you and settle 285 to 361 m behind you, nose on you, their guns bearing for 16 to 23 s of the 32. They never let you go and never fire: the school\'s hunter holds their fire outside 190 m. You are not hit, and you are not out.' },
    },
    zoom: {
      note: 'Going vertical: out of the circle straight up at 60 degrees, to come over the top and down on them. A jet keeps its speed going up. What you see is it failing anyway: they come up after you just as cheaply.',
      verdict: { works: 0, of: 9, line: 'In all nine you top out 274 to 322 m over them still at 105 to 106 m/s, but they follow you up and you reach the ceiling first: you hang there at 25 to 29 m/s and fall away, 423 to 618 m under them at 30 s. Nobody lands a round, and you never have a shot.' },
    },
    back: {
      note: 'Leave as the Dip does, run 22 s, then turn back and come in under their tail for a burst. What you see is it failing: they never let you go, so turning back is a head-on pass, and then they are behind you again.',
      verdict: { works: 0, of: 9, line: 'Never a shot that lands. They never let you go: turning back you pass 29 to 42 m apart and they are behind you again, their guns bearing for 12 to 35 s. In six of nine they land 10 to 44 rounds, and in two they shoot you down.' },
    },
    chop: {
      note: 'The throttle back (S) in the circle, to turn inside them. What you see is it failing: a slower jet turns no tighter here, only slower, and sinks.',
      verdict: { works: 0, of: 9, line: 'In all nine you slow to 37 or 38 m/s, sink 272 to 320 m under them, end 514 to 563 m of energy behind them, and never come behind them. Nobody has a shot.' },
    },
    reverse: {
      note: 'Roll out of the circle into the opposite turn, so that you meet them. What you see is it failing: the circle simply turns the other way, with no pass and no shot.',
      verdict: { works: 0, of: 9, line: 'You never have a shot. In none of the nine is there a head-on pass: the circle turns the other way, 98 to 160 m apart at the closest, and nobody fires.' },
    },
    low: {
      note: 'The circle flown nose low, to gain on them round the circle, then up into them from below. What you see is it nearly working: you get round behind them and the jet climbs back up to them at speed, but the nose never comes onto them.',
      verdict: { works: 0, of: 9, line: 'In all nine you come round behind them (100 to 131 degrees round behind their heading, seen from above) 14 to 16 s in, 114 to 134 m under them, and start up at 82 or 83 m/s. No round lands in any: the nose never comes onto them. In seven you sit in their rear quarter at last, 37 to 40 s in, too late and with no shot.' },
    },
  },
  coach: {
    hunt: { line: 'They are closing on you', tip: 'Turn hard into them before they close.', keys: ['Mouse', 'Arrows'] },
    track: { line: 'They are on your tail, closing', tip: 'Break turn into them, hard, now.', keys: ['Mouse', 'Arrows'] },
    lag: { line: 'In the circle with you, half a turn behind', tip: 'Neither of you gains here, and leaving does not shake an equal jet. Hold the turn and keep them in sight.', keys: ['Mouse', 'Arrows'] },
    follow: { line: 'They are following you up', tip: 'They keep their speed and so do you, but you reach the ceiling first: level off before you hang.', keys: ['Mouse'] },
    extend: { line: 'They flew past you and are running', tip: 'Let them go, or turn after them at full throttle.', keys: ['W', 'Mouse'] },
    headon: { line: 'Head-on: nobody on anybody\'s tail', tip: 'A pass is no time for a shot. Keep turning.', keys: ['Mouse', 'Arrows'] },
    'let-go': { line: 'They have let you go', tip: 'You are out of the circle. Keep going, or climb and come back with the height.', keys: ['W'] },
    meet: { line: 'You came back at them: they are turning to face you', tip: 'They have seen you. Pass them and keep going, never back into the circle.', keys: ['Mouse', 'W'] },
  },
};
