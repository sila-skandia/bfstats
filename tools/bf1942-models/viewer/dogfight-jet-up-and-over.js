// Up and over on a jet (features/dogfight-lessons-jets/up-and-over.md).
//
// The Spitfire's lesson rests on the follower running out of speed going up.
// A jet does not: nose 76 degrees up the F-16 never drops below 77 m/s and
// is going 88 m/s at 1,000 m, where a wing makes no lift at all (lift falls
// as 1 - height / 1000, `aircraft.js` `medium`). The fight is flown as
// written and the words say what it does: following them up lands nothing
// either way, following shallow lands one burst as they pull (not at the
// top, which never comes slow), and the Dip is re-flown as that shot and
// then straight on under them (`jetUoDip`), clear in nine of nine.
export default {
  note: 'Straight up, a jet keeps its speed and runs out of air instead, so the trick buys them nothing: following them up, nobody landed a round in nine flights on the F-16. The shot comes as they pull, and the way out is straight on under them.',
  tagline: 'They pull straight up out of your chase. On a jet that costs them no speed: it takes them up to where the air runs out. Follow them up and nobody gets a shot; take the one shot as they pull, then go on under them.',
  story: [
    'You are chasing them, but they came in faster than you. They pull nearly straight up, and the instinct is to follow them, nose on them.',
    'Straight up, a jet does not run out of speed. Nose 76 degrees up, the F-16 never drops below 77 m/s, and it is going 88 m/s when it reaches 1,000 m, 10 s after the pull. What stops it is the air: in BF1942 a wing makes half its lift at 500 m and none at all at 1,000 m. They go on up to 1,180 m, where their wings make nothing, and take 11 s to fall back under 700 m.',
    'Follow them up and you do not hang below them either: you are 93 to 110 m under them as they top out, never slower than 40 m/s on the climb, and you go on up into the thin air after them, to 1,115 to 1,260 m. Flown nine times from slightly different starts, nobody landed a round on the climb. Going up buys them nothing on a jet, and following them up buys you nothing.',
  ],
  counterStory: [
    'Follow them, but shallow: 25 degrees on their bearing, nose under them, full throttle. Do not point your nose at them: a jet\'s nose answers slowly, and chasing their climb with it lands nothing.',
    'The shot is not at the top, because they are never slow there. It is the pull: as their nose comes up through 62 to 65 degrees they fly through your sight 390 to 430 m out, inside your cannon\'s reach. From the same nine starts that second landed 6 to 12 hits in seven; in the other two, 30 m to the right and as fast or 3 m/s faster, it never came. Their guns never touched you.',
    'One burst does not bring them down, and there is no second: keep after them and you follow them up into the thin air too, to 1,110 to 1,240 m. So take the shot, then do not climb after them. Roll out on your heading and go on under them, full throttle, the nose a little down. They top out 15 s in, chase you for 6 s and let you go; at 35 s you are 1.9 to 2.1 km apart, never hit.',
  ],
  demos: {
    move: { note: 'You pull up after them as steep as they go. On a jet you keep your speed, and you follow them up into the thin air.' },
    counter: { note: 'You climb after them at 25 degrees, nose under them. As they pull, they fly through your sight: that is the shot.' },
    dip: {
      seat: 'jetUoDip',
      label: 'The Dip: the shot as they pull, then on under them',
      steps: { steps: [
        { phase: 'chase', say: 'Stay on their tail until they pull up' },
        { phase: 'dip-shot', say: 'They pull: hold 25° up on their bearing for 2.5 s and shoot as they cross your sight (Space)' },
        { phase: 'dip-run', say: 'Do not climb after them: roll out and go on under them, full throttle (W), nose 6° down' },
      ] },
      note: 'Hold 25 degrees on their bearing for 2.5 s as they pull and take the shot. Then do not climb after them: roll out on the heading you had and go on under them, full throttle, the nose 6 degrees down. They are going up to where a wing does nothing.',
      verdict: { works: 9, of: 9, line: 'In all nine, never hit. The shot as they pull lands up to 10 hits (none from one start). They top out at 1,180 m 15 s in, chase you for 6 s and let you go 20.7 s in; at 35 s you are 1.9 to 2.1 km apart and opening.' },
    },
    flip: {
      note: 'The hunted pilot: you followed them up. Once the climb has slowed you to 54 m/s, push the nose down off their line, get the speed back and round behind them. On a jet that speed comes late and high, in the thin air.',
      verdict: { works: 0, of: 9, line: 'It never works. Following them up you do not slow to 54 m/s until 17 to 22 s in, 1,080 to 1,290 m up, where a wing makes nothing. In none of the nine are you in their rear quarter for more than 0.9 s, and nobody lands a round after the climb.' },
    },
    ninja: {
      note: 'Never follow them up and never circle with them. Climb after them at 24 degrees and wait to shoot as they slow over the top. On a jet they do not slow: they go on up past 1,000 m with their speed.',
      verdict: { works: 0, of: 9, line: 'No. The shot as they slow over the top never comes, because they never slow there. Nobody hits you in any of the nine, but you come up with a burst in only two, and only one of those lands (3 hits, 48.7 s in). In eight they see you and turn in, and you leave.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes, and more easily than on a Spitfire: going up buys them nothing. Following shallow, the shot as they pull lands 6 to 12 hits in seven of nine. Then go on under them and away: clear in 9 of 9, never hit. Following them up is not fatal, just useless: nobody lands a round. Getting on top of them does not follow (0 of 9).' },
  coach: {
    run: { line: 'They are running fast and level', tip: 'They are faster than you. Stay behind them and watch for the pull up.', keys: ['W'] },
    chase: { line: 'They are diving after you', tip: 'Full throttle, nose a little down, straight away from them: they cannot close and soon give up.', keys: ['W', 'Mouse'] },
    pull: { line: 'They are pulling nearly straight up', tip: 'Do not follow them up. Hold 25 degrees on their bearing, nose under them: they fly through your sight. Shoot.', keys: ['Mouse', 'Space'] },
    over: { line: 'They are up where the air runs out', tip: 'Up there they cannot turn. Do not climb after them: go on under them, full throttle.', keys: ['W', 'Mouse'] },
    pounce: { line: 'They are coming back down at you', tip: 'Off their line: push the nose down and keep going, full throttle.', keys: ['Mouse', 'W'] },
    zoom: { line: 'They are zooming back up', tip: 'Let them go up: up there they are out of the fight. Stay low and fast.', keys: ['W'] },
  },
};
