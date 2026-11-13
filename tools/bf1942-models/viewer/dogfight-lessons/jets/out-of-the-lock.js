// Out of their lock on a jet (features/dogfight-lessons-jets/out-of-the-lock.md).
//
// Flown as written on the F-16, the turn and the chop were each shot down in
// one start of nine: the pilot's gentle look turn toward the hunter, 20
// degrees of bank, turns a jet at three quarters of the Spitfire's rate, the
// hunter slides into the cone behind the headrest, is lost, and comes in
// unseen to a pilot flying straight. The jet's watchers (`jetOlHardTurn`,
// `jetOlChop`, plan-out-of-the-lock.js) hold the Spitfire's
// rate of turn instead, 26 to 39 degrees of bank, and from then on fly the
// Spitfire's plans: no hit either way in nine. The rest is rewritten for
// what a jet does: the chop's moment never comes, and an equal jet can be
// neither outrun nor got on top of (the Dip, the Flip and the Ninja, 0 of 9
// each, scored as `movesOn` scores them).
export default {
  note: 'The hard turn still saves you, but keeping them in sight takes a steeper turn first: a faster aeroplane turns more slowly at the same bank. Flown nine times on the F-16, flying straight was shot down every time and turning hard never took a hit; nothing got you out of an equal jet\'s lock, or on top of them.',
  tagline: 'They are on your tail. Turning hard keeps you alive; flying straight gets you shot down. Keep them in sight with a steeper turn than a Spitfire needs. An equal jet cannot be outrun: passed under and run from, they sit 300 m behind you and never let you go. Nor do they slow over the top, so no pass comes down on them from behind.',
  story: [
    'The best pilots get behind you and stay there. The hunter closes at full throttle, eases off as they get in, and holds their fire until they are inside about 190 m. Dead astern the hunter sits in the one cone your headrest hides, so a pilot who knows the hunter is coming keeps a turn on toward them and has them over the shoulder until they are in.',
    'On a jet that turn is steeper. The same 20 degrees of bank turns a faster aeroplane more slowly: the hunter slides into the cone, is lost, and comes in unseen, and a pilot who no longer knows they are there flies straight. Hold the Spitfire\'s rate of turn instead, 26 to 39 degrees of bank, and you have them in sight until they are in.',
    'Flying straight under the lock is death: shot down every time, 10 to 12 s in.',
    'Turning hard does not shake them. They follow you round, never closer than 64 m, and once the turn is on their nose cannot come onto you: nobody is hit. At full throttle a jet has power to spare in the turn, so the circle climbs: both of you go up about 310 m in 45 s, until the roof levels the turn off at about 760 m. Up there the air is thin and the turn slows; you end at 120 m/s, 667 to 673 m from them, and they are hunting you again. The turn buys time, nothing more.',
  ],
  counterStory: [
    'Running does not work against an equal jet. Seen 900 m back you can turn into them and go under them, as in a Spitfire, but they turn round after you and settle 300 to 340 m behind you, their nose on you. You both run at about 100 m/s: they never close to their 190 m, and you never get away. They give a chase up only once you are out of their guns\' reach, and a jet\'s cannon reaches past 500 m: 40 s on they are still behind you.',
    'The chop never comes. It waits for them to slide in close behind you and still be closing. On a jet they swing in to 64 m behind you and out again, never closing while they are close: in nine fights the chop was never flown, and the fight was the hard turn.',
    'Nor can you get on top of them. From under them you pull up behind them as they turn back after you, but a jet does not slow over the top: they follow you up at 60 to 68 m/s, and no dive comes down on them from behind. The Flip and the Ninja landed a single hit in one fight of nine and none in the rest.',
    'Flown nine times from slightly different starts: flying straight was shot down every time, 10 to 12 s in; turning hard, and turning hard waiting to chop, took no hit and landed none, with them following you round the whole time; going under them and running took no hit and never got out; going under them and up behind them never got you on their tail.',
  ],
  survival: { verdict: 'no', line: 'No: turning hard keeps you alive in all nine, but nothing gets you out. Passed under and run from, an equal jet sits 300 m behind you, never closing and never giving up; and they do not slow over the top, so no pass comes down on them from behind. The Dip, the Flip and the Ninja: 0 of 9 each.' },
  demos: {
    flat: { seat: 'jetOlHardTurn',
      note: 'A turn toward them keeps them in sight, steeper than a Spitfire needs; once they are committed, as hard as it turns. They cannot hit you, but they follow you round, and the circle climbs, 310 m in 45 s, up to the roof, where it slows.' },
    counter: { seat: 'jetOlChop',
      note: 'Turn hard; when they slide in close behind you and are still closing, throttle back and pull up. On a jet that moment never comes: they swing in and out behind you, and in nine fights the chop was never flown.' },
    dip: {
      note: 'Seen 900 m back: turn into them at once and aim 50 m under them and to their side; the pass comes within about 45 m. Past them, run on full throttle, nose 2 degrees down. They turn round after you and settle 300 m behind you: an equal jet cannot be outrun.',
      verdict: { works: 0, of: 9, line: 'Never hit, never out. They had their nose on you from 300 to 340 m behind for 23 to 24 s of the fight, but they hold their fire to 190 m and never closed to it; they never gave the chase up, and at 40 s they were 306 to 323 m behind you.' } },
    flip: {
      note: 'Seen 900 m back: turn into them and aim 80 m under them. Once they are past overhead, pull up behind them as they turn back after you, and come down on them with the lead. On a jet they do not slow over the top: they follow you up.',
      verdict: { works: 0, of: 9, line: 'They never hit you, but you were never on their tail: they stayed at 60 to 68 m/s and followed you up, and the passes landed a single hit in one fight of nine and none in the rest.' } },
    ninja: {
      note: 'Seen 900 m back: turn into them, go under them, pull up behind them and come down on them, then up and away toward a perch out of their reach. On a jet they follow you up, fast, and the pass from above does not come.',
      verdict: { works: 0, of: 9, line: 'They never hit you, but no attack came: the passes landed a single hit in one fight of nine and none in the rest, and they stayed at 60 to 68 m/s, following you up.' } },
  },
  coach: {
    hunt: { line: 'They are closing on your tail', tip: 'Turn toward them, steeper than feels right: at a gentle bank they slide in behind your headrest. Once they are inside 230 m, turn hard.', keys: ['Mouse', 'Arrows'] },
    track: { line: 'They are on your tail, closing to fire', tip: 'TURN HARD now: roll and pull as far as it goes. They open fire at 190 m.', keys: ['Mouse', 'Arrows'] },
    lag: { line: 'They followed you into your turn', tip: 'Keep turning hard: they cannot pull their sight onto you. Do not roll out and run: an equal jet does not fall behind.', keys: ['Mouse', 'Arrows'] },
    follow: { line: 'They are following you up, shallow', tip: 'Do not hang at the top: tip over and turn before you are slow.', keys: ['Mouse'] },
    extend: { line: 'They flew past and are running', tip: 'Nose on them and shoot now: they are getting away. Then W.', keys: ['Space', 'W'] },
    headon: { line: 'They are coming at you head-on: the tail is broken', tip: 'Pass over them, not through them, then turn hard into them again.', keys: ['Mouse', 'Arrows'] },
    evade: { line: 'They are breaking away from your guns', tip: 'Let them go and get your speed back: W.', keys: ['W'] },
  },
};
