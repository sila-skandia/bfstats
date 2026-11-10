// The break turn on a jet (features/dogfight-lessons-jets/break-turn.md).
//
// The break is the Spitfire's and it holds: on the F-16 the pilot who
// breaks is never shot down. Two things are the jet's own. Its cannon has
// you from 500 m (the pilots' gun range), so the defender is in reach from
// the lesson's start and breaks at once, 460 m out, not at 300 m. And a
// target cruising at the Spitfire's 52 m/s (67 m/s on the F-16) is one the
// eager attacker overtakes at 20 m/s and flies straight through, 20 s in,
// with 5 to 20 rounds on it: flying straight survived 8 starts of 9. At a
// jet's cruise, 86 m/s, the attacker settles 25 to 30 m behind and shoots
// it down every time, 30 to 40 s in, so the fight runs 45 s.
//
// The way out of the circle on a jet is not up. With every jet pilot under
// the roof (`dogfight-jet-ceiling.js`, 800 m) the Spitfire's zoom levels off
// at 830 m still fast and the hunter levels off beside it, so the Dip and
// the Ninja as written never get away (0 of 9). The jet Dip
// (`jetBtDip`, dogfight-jet-plan-break-turn.js) breaks and then goes
// straight on, full throttle, nose a little down: the hunter's turn after
// you goes up to the top of the sky, they let you go 16 s in, 9 of 9.
//
// Starts are in the Spitfire's units (68 m/s is 87 on the F-16); the words
// give the F-16's own numbers, measured from the nine starts.
export default {
  note: 'Their cannon has you from 500 m, so there is no waiting: the break comes at once, 460 m out. Flown nine times on the F-16, the pilot who cruised straight at 86 m/s was shot down every time, 30 to 40 s in; the one who broke never was. Once they are past, straight on at full throttle got away in all nine; going up did not.',
  tagline: 'With a fighter closing on your tail, turn as hard as you can into them the moment they are in reach.',
  seconds: 45,
  ace: { start: { speed: 68 } },
  story: [
    'An attacker is closing on your tail, fast, from one side. Fly straight and they simply shoot you down: they close to 25 to 30 m behind you and stay there.',
    'On a jet there is no waiting for them to commit. Their cannon has you from 500 m, so they are in reach from the start: turn at once, as hard as the aeroplane turns, toward their side: into them.',
    'Their sight cannot follow you round, and they come past your tail 4 to 7 s later, 40 to 75 m from you. As they cross, reverse: turn into them again.',
    'Do not expect them to fly out in front of you. A hard-turning F-16 goes round a circle about 135 m across at 70 to 80 m/s, and they swing back in behind you, about 110 m back. But while you keep turning into them their nose stays 45 degrees or more off you: they have no shot, and their extra speed is gone (both of you at 70 to 85 m/s).',
    'Flown nine times from slightly different starts, the pilot who flew straight was shot down every time, 30 to 40 s in. The one who broke never was, and took 0 to 4 hits, all in the first 3.5 s, before the attacker came past.',
    'The break saves you, but it leaves you both in a circle neither of you wins, and on a jet the way out of it is not up. Break at once, and the moment they are past your tail, 7 s in, roll level and go straight on at full throttle, the nose a little down. Their turn after you takes them up to the top of the sky, 840 m; by the time they are round you are 700 to 870 m ahead of them and they are not closing, and they let you go, 16 s in. Flown nine times, nobody was hit, and at 50 s you were 4.8 to 5 km apart.',
    'The Spitfire\'s way out is to go up once they are past, for them to follow and slow. A jet does not slow going up: the zoom levels off under the top of the sky at 830 m, 19 s in, still at 121 m/s, and they level off beside you, never more than 60 m higher. They let you go 16 s in, but you are up there together at the same speed: leave 24 s in, and at 50 s they are 250 to 330 m from you and closing.',
    'The upper hand is not to be had either. Over the top you are never more than 5 m above them, so there is no dive to make. Stay in the circle to zoom out of it and they never sit close behind you to zoom from: from 12 s to 42 s in they circle above you, 17 to 150 m higher and 90 to 650 m away, and the zoom never comes.',
  ],
  counterStory: [
    'As the attacker: when they break, do not pull after them into their circle. You will come past their tail and end up sitting in their turn without a shot.',
    'The moment their wings go over, lift your nose up out of their turn (a high yo-yo) and stay up there, 40 to 70 m above their circle, at their speed. You never come past them, and they never land a round on you.',
    'A hard-turning F-16 is no easier to hit from a flat chase, and its circle is only about 135 m across. Keep the height and wait for them to stop turning: then dive on them.',
    'Flown nine times, the patient attacker never came within 59 m of the breaker, and after the first 1.2 s neither of them landed a hit.',
  ],
  demos: {
    move: { note: 'They break the moment you are in reach, 460 m out, and turn hard into you. You come past their tail; they reverse into you. From here it is a circle nobody wins: the three fights after this one try the way out of it and the upper hand. On a jet the way out is straight on, not up, and the upper hand is not to be had.' },
    dip: {
      label: 'The Dip: break, then straight on', seat: 'jetBtDip',
      steps: { steps: [
        { phase: 'dip-break', say: 'Break hard into them at once, about 650 m out' },
        { phase: 'dip-out', say: 'They are past: not up, not after them. Wings level, full throttle (W), nose 6° down, and keep going' },
      ] },
      note: 'Turn into them at once, about 650 m out. Once they are past your tail, do not go up: roll level, full throttle, nose 6 degrees down to 510 m, and keep going. Their turn after you takes them up toward the top of the sky, and by the time they are round you are out of their reach and they let you go.',
      verdict: { works: 9, of: 9, line: 'Yes, in all nine: their guns never have you and none of their rounds lands. They come past you 68 to 88 m off and you leave 7 s in; their turn after you takes them up to 840 m, and 700 to 870 m behind you, not closing, they let you go 16 s in and stay up there. At 50 s you are 4.8 to 5 km apart and opening.' },
    },
    flip: {
      note: 'Break at 460 m and hold your height in the circle. With them dead astern inside 155 m, zoom out of it at 70 degrees until 67 m/s are left. Over the top, down on them with the lead, off them before the pass, and when they break with you close a high yo-yo up out of their turn: you never follow their break round in the flat.',
      verdict: { works: 0, of: 9, line: 'No: on a jet you never get to zoom. In the circle, 12 to 42 s in, they stay above you, 17 to 150 m higher and 87 to 645 m away, under the top of the sky at 840 m, never dead astern inside 155 m, so in none of the nine does the zoom come. Nobody lands a round.' },
    },
    ninja: {
      note: 'The Spitfire\'s way in, waiting for the dive: turn into them at once, about 650 m out, and go up once they are past. On a jet the zoom does not slow you and levels off under the top of the sky, and they level off beside you: you are never more than 5 m above them, so there is no dive to make.',
      verdict: { works: 0, of: 9, line: 'No: you never fire. Your zoom levels off at 830 m, 19 s in, at 121 m/s; they go up to 840 m, never more than 60 m above you, and let you go 16 s in. With no dive to make you leave 24 s in, at their speed, and at 50 s they are 250 to 330 m from you and closing. Nobody lands a round, and they sit on your six half a second at most.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes, by not going up: break into them at once and, once they are past, straight on at full throttle, nose a little down. They let you go 16 s in and you are clear and unhit in 9 of 9. Up once they are past, the Spitfire\'s way, you level off under the top of the sky beside them: no dive comes and you never get away (0 of 9). And the upper hand is not to be had: in the circle they never sit close behind you to zoom from (0 of 9).' },
  coach: {
    watch: { line: 'They are flying straight, watching you close', tip: 'They break the moment you are in reach, about 550 m out. Ease the throttle (S) early, it takes seconds to bite.', keys: ['S'] },
    break: { line: 'They broke: a hard turn into you', tip: 'Do not pull after them into their circle. Pull UP out of their turn and stay above it, at their speed.', keys: ['Mouse', 'Arrows', 'S'] },
    reverse: { line: 'You came past their tail: they are reversing into you', tip: 'Too close and too fast. Pull up out of their turn before you pass them again.', keys: ['Mouse', 'S'] },
    turn: { line: 'You are in their turn, 110 m behind them, with no lead', tip: 'You will not get a shot from here. Pull up out of their circle and keep the height.', keys: ['Mouse', 'S'] },
    chase: { line: 'You are out in front of them: they are behind you', tip: 'Break turn into them: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
  },
};
