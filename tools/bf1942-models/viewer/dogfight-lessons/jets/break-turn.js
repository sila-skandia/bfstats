// The break turn on a jet (features/dogfight-lessons-jets/break-turn.md).
//
// The break is the Spitfire's and it holds: on the F-16 the pilot who
// breaks is never shot down. Two things are the jet's own. Its cannon has
// you from 500 m (the pilots' gun range), so the defender is in reach from
// the lesson's start and breaks at once, 460 m out, not at 300 m. And a
// target cruising at the Spitfire's 52 m/s (67 m/s on the F-16) is one the
// eager attacker overtakes at 20 m/s and flies straight through, 20 s in,
// with 6 to 17 rounds on it: flying straight survived 7 starts of 9. At a
// jet's cruise, 86 m/s, the attacker settles 25 to 30 m behind and shoots
// it down every time, 30 to 40 s in, so the fight runs 45 s.
//
// The way out of the circle is the Spitfire's, run level. Every jet pilot
// flies under the roof (`dogfight-jet-ceiling.js`): the zoom levels off at
// 760 m still fast, and the hunter comes up beside it and follows. The
// Spitfire's Dip runs from the top 8 degrees nose down, into thicker air
// where a jet is slower, and the hunter sits 500 m behind it, just inside
// the reach it gives up outside: 5 of 9. The jet Dip (`jetBtDip`,
// plan-break-turn.js) runs with the nose on the horizon, draws
// out past 550 m, and they let you go 31 to 35 s in: 9 of 9.
//
// Starts are in the Spitfire's units (68 m/s is 87 on the F-16); the words
// give the F-16's own numbers, measured from the nine starts.
export default {
  note: 'Their cannon has you from 500 m, so there is no waiting: the break comes at once, 460 m out. Flown nine times on the F-16, the pilot who cruised straight at 86 m/s was shot down every time, 30 to 40 s in; the one who broke never was. Up once they are past and away level got out in all nine; away nose down, in five.',
  tagline: 'With a fighter closing on your tail, turn as hard as you can into them the moment they are in reach.',
  seconds: 45,
  ace: { start: { speed: 68 } },
  story: [
    'An attacker is closing on your tail, fast, from one side. Fly straight and they simply shoot you down: they close to 25 to 30 m behind you and stay there.',
    'On a jet there is no waiting for them to commit. Their cannon has you from 500 m, so they are in reach from the start: turn at once, as hard as the aeroplane turns, toward their side: into them.',
    'Their sight cannot follow you round, and they come past your tail 4 to 7 s later, 40 to 75 m from you. As they cross, reverse: turn into them again.',
    'Do not expect them to fly out in front of you. A hard-turning F-16 goes round a circle about 135 m across at 70 to 80 m/s, and they swing back in behind you, about 110 m back. But while you keep turning into them their nose stays 45 degrees or more off you: they have no shot, and their extra speed is gone (both of you at 70 to 85 m/s).',
    'Flown nine times from slightly different starts, the pilot who flew straight was shot down every time, 30 to 40 s in. The one who broke never was, and took 0 to 4 hits, all in the first 3.5 s, before the attacker came past.',
    'The break saves you, but it leaves you both in a circle neither of you wins. The way out is the Spitfire\'s, flown level. The moment they are past your tail, 7 s in, go up at 70 degrees. A jet does not slow going up: the zoom levels off under the top of the sky at about 760 m, still fast, and they come up after you. Over the top keep your lift on them for 8 s, then go straight away from them at full throttle, the nose on the horizon.',
    'Do not put the nose down for speed. Lower down the air is thicker and a jet is slower: run 8 degrees down and they sit 500 m behind you, just inside their reach, and never let you go (in four of nine). Level, you draw out to 560 to 620 m, and they give the chase up 31 to 35 s in. Flown nine times, nobody was hit, and at 50 s you were 3.6 to 4.5 km apart and opening.',
    'The upper hand is not to be had either. Over the top you are 50 to 55 m above them, but their nose stays on you and no moment to dive comes. Stay in the circle to zoom out of it and they never sit close enough behind you in time: they hang 25 to 744 m away, from 41 m below you to 69 m above, and the zoom comes in two of the nine, 41 s in, with no time left to come down on them.',
  ],
  counterStory: [
    'As the attacker: when they break, do not pull after them into their circle. You will come past their tail and end up sitting in their turn without a shot.',
    'The moment their wings go over, lift your nose up out of their turn (a high yo-yo) and stay up there, 40 to 70 m above their circle, at their speed. You never come past them, and they never land a round on you.',
    'A hard-turning F-16 is no easier to hit from a flat chase, and its circle is only about 135 m across. Keep the height and wait for them to stop turning: then dive on them.',
    'Flown nine times, the patient attacker never came within 56 m of the breaker, and after the first 1.2 s neither of them landed a hit.',
  ],
  demos: {
    move: { note: 'They break the moment you are in reach, 460 m out, and turn hard into you. You come past their tail; they reverse into you. From here it is a circle nobody wins: the three fights after this one try the way out of it and the upper hand. On a jet the way out is up and away level, and the upper hand is not to be had.' },
    dip: {
      label: 'The Dip: break, up, and away level', seat: 'jetBtDip',
      steps: { steps: [
        { phase: 'dip-break', say: 'Break hard into them at once, about 650 m out' },
        { phase: 'dip-zoom', say: 'Once they are past, go up at 70°' },
        { phase: 'dip-over', say: 'Over the top: keep your lift on them' },
        { phase: 'dip-out', say: 'Away, full throttle (W), the nose on the horizon: not down' },
      ] },
      note: 'Turn into them at once, about 650 m out. Once they are past, go up at 70 degrees: the zoom levels off under the top of the sky, still fast, and they come up too. Over the top keep your lift on them for 8 s, then straight away from them at full throttle with the nose on the horizon. Not down: lower down a jet is slower, and they stay inside their reach.',
      verdict: { works: 9, of: 9, line: 'Yes, in all nine: none of their rounds lands. They come past you 83 to 101 m off; your zoom levels off at 756 to 759 m and they come up to 758 to 762. You leave 24 s in, and at 560 to 620 m behind you, not closing, they let you go 31 to 35 s in. At 50 s you are 3.6 to 4.5 km apart and opening, at 127 m/s. As you go up they sit on your tail for up to 4.7 s and have a shot for 0.8 s at most.' },
    },
    flip: {
      note: 'Break at 460 m and hold your height in the circle. With them dead astern inside 155 m, zoom out of it at 70 degrees until 67 m/s are left. Over the top, down on them with the lead, off them before the pass, and when they break with you close a high yo-yo up out of their turn: you never follow their break round in the flat.',
      verdict: { works: 0, of: 9, line: 'No: you barely get to zoom. In the circle, 12 to 42 s in, they hang 25 to 744 m away, from 41 m below you to 69 m above, never dead astern inside 155 m in time: the zoom comes in two of the nine, 41 s in, with no time left to come back down. Their rounds never land; yours land in three of the nine, 1 round each, 38 to 39 s in.' },
    },
    ninja: {
      note: 'The Spitfire\'s way in, waiting for the dive: turn into them at once, about 650 m out, and go up once they are past. On a jet the zoom does not slow you and levels off under the top of the sky, and they come up after you with their nose on you: no moment to dive comes, and after 8 s you leave, the nose down.',
      verdict: { works: 0, of: 9, line: 'No: you never fire. Your zoom levels off at 756 to 759 m, 17 to 18 s in, at 111 to 113 m/s; they come up to 750 to 753 m, and you are 50 to 55 m above them, but their nose stays on you and the dive never comes. You leave 24 s in, 8 degrees nose down: in five of nine they let you go 31 s in, in four they sit 493 to 500 m behind you at 50 s. Nobody lands a round.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes: break into them at once, go up once they are past, and from the top straight away at full throttle with the nose on the horizon. They let you go 31 to 35 s in and you are clear and unhit in 9 of 9. The nose down, as on a Spitfire, they sit 500 m behind you in four of nine. The upper hand is not to be had: over the top their nose stays on you and no dive comes (0 of 9), and in the circle they never sit close behind you in time to zoom from (0 of 9).' },
  coach: {
    watch: { line: 'They are flying straight, watching you close', tip: 'They break the moment you are in reach, about 550 m out. Ease the throttle (S) early, it takes seconds to bite.', keys: ['S'] },
    break: { line: 'They broke: a hard turn into you', tip: 'Do not pull after them into their circle. Pull UP out of their turn and stay above it, at their speed.', keys: ['Mouse', 'Arrows', 'S'] },
    reverse: { line: 'You came past their tail: they are reversing into you', tip: 'Too close and too fast. Pull up out of their turn before you pass them again.', keys: ['Mouse', 'S'] },
    turn: { line: 'You are in their turn, 110 m behind them, with no lead', tip: 'You will not get a shot from here. Pull up out of their circle and keep the height.', keys: ['Mouse', 'S'] },
    chase: { line: 'You are out in front of them: they are behind you', tip: 'Break turn into them: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
  },
};
