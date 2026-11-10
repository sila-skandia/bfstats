// Up and over on a jet (features/dogfight-lessons-jets/up-and-over.md).
//
// The Spitfire's lesson rests on the follower running out of speed going up.
// A jet does not: nose 72 degrees up the F-16 never drops below 71 m/s. What
// runs out is the air (lift falls as 1 - height / 1000, `aircraft.js`
// `medium`), so the jet's ace (`jetUpAndOver`, `jetUoAce`, `jetUoAceSharp`,
// `dogfight-jet-plan-up-and-over.js`) goes over the top at 550 m while the
// air still holds it, tops out at 725 m and comes straight back down. The
// words say what that fight does: following them up lands nothing either
// way, following shallow lands one burst as they pull (not at the top, which
// never comes slow), and the Dip is that shot, then past them as they come
// back down and away (`jetUoDip`), clear in nine of nine.
export default {
  note: 'Straight up, a jet keeps its speed and the air runs out instead, so they go over the top long before they are slow: following them up, nobody was shot down in nine flights on the F-16. The shot comes as they pull, and the way out is past them as they come back down.',
  tagline: 'They pull straight up out of your chase. On a jet that costs them no speed: they loop over the top under the thin air and come straight back down. Follow them up and nobody gets a shot; take the one shot as they pull, then go past them and away.',
  story: [
    'You are chasing them, but they came in faster than you. They pull nearly straight up, and the instinct is to follow them, nose on them.',
    'Straight up, a jet does not run out of speed: with its nose over 60 degrees the F-16 never drops below 71 m/s. What runs out is the air: in BF1942 a wing makes half its lift at 500 m and none at all at 1,000 m, and a jet pilot does not climb into that. They pull up 1.5 s in and go over the top at 550 m, 4 s later, while the air still holds them: a loop that tops out at 725 m at 75 m/s, 9 s in, and brings them straight back down at you.',
    'Follow them up and you do not hang below them: you are 38 to 53 m under them as they go over, never slower than 60 m/s, and they come back down past you, 80 m away at the closest. Flown nine times from slightly different starts, nobody was shot down: their guns never touched you, and you landed 2 rounds at most. Going up buys them nothing on a jet, and following them up buys you nothing.',
  ],
  counterStory: [
    'Follow them, but shallow: 25 degrees on their bearing, nose under them, full throttle. Do not point your nose at them: a jet\'s nose answers slowly, and chasing their climb with it lands nothing.',
    'The shot is not at the top, because they are never slow there. It is the pull: as their nose comes up through 62 to 65 degrees they fly through your sight 390 to 430 m out, inside your cannon\'s reach. From the same nine starts that second landed 6 to 12 hits in seven; in the other two, 30 m to the right and as fast or 3 m/s faster, it never came, and in one of them their guns found you once, 3 hits 18.5 s in.',
    'One burst does not bring them down, and there is no second: keep climbing at 25 degrees and you go on up alone, to 1,070 to 1,400 m, into the thin air, while they loop back down. So take the shot and keep climbing after them only until they come back over the top. Then fly past them, beside and under their dive, and away, full throttle, the nose a little down. They turn round after you, chase you for 6 to 7 s and let you go; at 35 s you are 2.3 to 2.9 km apart, never hit.',
  ],
  flyAce: 'jetUoAce',
  ace: { plan: 'jetUpAndOver' },
  demos: {
    move: { note: 'You pull up after them as steep as they go. On a jet you keep your speed, and they are over the top and coming back down before you are slow.' },
    counter: { note: 'You climb after them at 25 degrees, nose under them. As they pull, they fly through your sight: that is the shot.' },
    dip: {
      seat: 'jetUoDip',
      ace: 'jetUoAceSharp',
      label: 'The Dip: the shot as they pull, then past them and away',
      steps: { steps: [
        { phase: 'chase', say: 'Stay on their tail until they pull up' },
        { phase: 'dip-shot', say: 'They pull: climb after them at 25° on their bearing and shoot as they cross your sight (Space)' },
        { phase: 'dip-pass', say: 'They come back over the top: fly past beside and under their dive' },
        { phase: 'dip-run', say: 'Full throttle (W), straight away from them, nose 6° down' },
      ] },
      note: 'Climb after them at 25 degrees on their bearing as they pull and take the shot, never into their climb. When they come back over the top at you, fly past them, beside and under their dive, then full throttle straight away from them, the nose 6 degrees down. Their loop points them back the way they came while you go on.',
      verdict: { works: 9, of: 9, line: 'In all nine, never hit. The shot as they pull lands up to 10 hits (none from one start). You pass them 9 s in; they turn round after you, chase you for 6 to 7 s and let you go 24 to 27 s in; at 35 s you are 2.3 to 2.9 km apart and opening.' },
    },
    flip: {
      ace: 'jetUoAceSharp',
      note: 'The hunted pilot: you followed them up. Once the climb has slowed you to 54 m/s, push the nose down off their line, get the speed back and round behind them. On a jet the climb never slows you that much.',
      verdict: { works: 0, of: 9, line: 'It never starts. Following them up you top out at 755 to 790 m and are never slow: the 54 m/s the move waits for never comes, in any of the nine.' },
    },
    ninja: {
      ace: 'jetUoAceSharp',
      note: 'Never follow them up and never circle with them. Climb after them at 24 degrees and wait to shoot as they slow over the top. On a jet they do not slow: they loop and come back down, and you climb on alone.',
      verdict: { works: 0, of: 9, line: 'No. The shot as they slow over the top never comes, because they never slow there. You climb on alone at 24 degrees to 1,230 to 1,360 m, into the thin air, and slow there to under 30 m/s. You never land a round; in one of the nine they hit you 4 times.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes, and more easily than on a Spitfire: going up buys them nothing. Following shallow, the shot as they pull lands 6 to 12 hits in seven of nine. Then go past them as they come back down, and away: clear in 9 of 9, never hit. Following them up is not fatal, just useless: nobody is shot down. Getting on top of them does not follow (0 of 9).' },
  coach: {
    run: { line: 'They are running fast and level', tip: 'They are faster than you. Stay behind them and watch for the pull up.', keys: ['W'] },
    chase: { line: 'They are diving after you', tip: 'Full throttle, nose a little down, straight away from them: they cannot close and soon give up.', keys: ['W', 'Mouse'] },
    pull: { line: 'They are pulling nearly straight up', tip: 'Do not follow them up. Hold 25 degrees on their bearing, nose under them: they fly through your sight. Shoot.', keys: ['Mouse', 'Space'] },
    over: { line: 'They are going over the top', tip: 'They are not slow up there: they are coming straight back down. Get ready to fly past them, beside and under their dive.', keys: ['Mouse', 'W'] },
    pounce: { line: 'They are coming back down at you', tip: 'Off their line: past them beside and under their dive, then full throttle away.', keys: ['Mouse', 'W'] },
    zoom: { line: 'They are zooming back up', tip: 'Do not climb after them. Stay low and fast, and keep going away.', keys: ['W'] },
  },
};
