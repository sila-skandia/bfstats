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
// Starts are in the Spitfire's units (68 m/s is 87 on the F-16); the words
// give the F-16's own numbers, measured from the nine starts.
export default {
  note: 'Their cannon has you from 500 m, so there is no waiting: the break comes at once, 460 m out. Flown nine times on the F-16, the pilot who cruised straight at 86 m/s was shot down every time, 30 to 40 s in; the one who broke never was.',
  tagline: 'With a fighter closing on your tail, turn as hard as you can into them the moment they are in reach.',
  seconds: 45,
  ace: { start: { speed: 68 } },
  story: [
    'An attacker is closing on your tail, fast, from one side. Fly straight and they simply shoot you down: they close to 25 to 30 m behind you and stay there.',
    'On a jet there is no waiting for them to commit. Their cannon has you from 500 m, so they are in reach from the start: turn at once, as hard as the aeroplane turns, toward their side: into them.',
    'Their sight cannot follow you round, and they come past your tail 4 to 7 s later, 40 to 75 m from you. As they cross, reverse: turn into them again.',
    'Do not expect them to fly out in front of you. A hard-turning F-16 goes round a circle about 135 m across at 70 to 80 m/s, and they swing back in behind you, about 110 m back. But while you keep turning into them their nose stays 45 degrees or more off you: they have no shot, and their extra speed is gone (both of you at 70 to 85 m/s).',
    'Flown nine times from slightly different starts, the pilot who flew straight was shot down every time, 30 to 40 s in. The one who broke never was, and took 0 to 4 hits, all in the first 3.5 s, before the attacker came past.',
    'The break saves you, but it leaves you both in a circle neither of you wins. The way out is not to let the circle start: turn into them at once, 640 m out. Once they are past, go up: they follow you up and slow to about 60 m/s. From over the top go straight away from them, full throttle: they chase, cannot close, and give up 32 to 33 s in. On a jet that run is slow: for about 20 s you are at 10 to 50 m/s, and it costs 520 to 630 m of height.',
    'The upper hand is another matter. Over the top you are above them, but their nose never leaves you, so there is never a moment to come down on them that is not nose to nose. Stay in the circle to zoom out of it and they never sit close behind you to zoom from: they hang 110 to 750 m away and 20 to 140 m above you, until a head-on pass 44 to 46 s in.',
  ],
  counterStory: [
    'As the attacker: when they break, do not pull after them into their circle. You will come past their tail and end up sitting in their turn without a shot.',
    'The moment their wings go over, lift your nose up out of their turn (a high yo-yo) and stay up there, 40 to 70 m above their circle, at their speed. You never come past them, and they never land a round on you.',
    'A hard-turning F-16 is no easier to hit from a flat chase, and its circle is only about 135 m across. Keep the height and wait for them to stop turning: then dive on them.',
    'Flown nine times, the patient attacker never came within 59 m of the breaker, and after the first 1.2 s neither of them landed a hit.',
  ],
  demos: {
    move: { note: 'They break the moment you are in reach, 460 m out, and turn hard into you. You come past their tail; they reverse into you. From here it is a circle nobody wins: the three fights after this one are what to do instead, and whether the circle can be turned round.' },
    dip: {
      note: 'Do not wait for them to sit on your tail. Turn into them at once, 640 m out. Once they are past, go up at 70 degrees: they follow you up and slow. From over the top, go straight away from them, full throttle, the nose a little down: they turn after you, cannot close, and give up the chase. On a jet the run from the top starts slow and stays slow for about 20 s.',
      verdict: { works: 9, of: 9, line: 'In all nine their guns never have you and none of their rounds lands: they follow you up and slow to 57 to 65 m/s, chase your run without closing and give it up 32 to 33 s in; at 50 s you are 1.2 to 1.4 km apart and opening. The run is slow on a jet: over the top you are down to 40 m/s, then 10 to 50 m/s for about 20 s, sinking 520 to 630 m.' },
    },
    flip: {
      note: 'Break at 460 m and hold your height in the circle. With them dead astern inside 155 m, zoom out of it at 70 degrees until 67 m/s are left; they follow you up and slow. Over the top, down on them with the lead, off them before the pass, and when they break with you close a high yo-yo up out of their turn: you never follow their break round in the flat.',
      verdict: { works: 0, of: 9, line: 'No: on a jet you never get to zoom. In the circle they hang 110 to 750 m away and 20 to 140 m above you, never dead astern inside 155 m, until a head-on pass 44 to 46 s in; the zoom starts 46 to 48 s in, with no time left to come back down. Nobody lands a round.' },
    },
    ninja: {
      note: 'The Dip\'s way in, waiting for the dive: turn into them at once, 640 m out, and go up once they are past; they follow and slow. Over the top you wait for their nose to come off you. It never does, so there is no dive to make: after 8 s you leave from the top while they are slow.',
      verdict: { works: 0, of: 9, line: 'No: in all 9 their guns never have you and none of their rounds lands, but over the top their nose never leaves you, so the dive never comes and you never fire; once they sit on your six for 1.4 to 1.6 s without a shot. You leave, and they give the chase up 32 to 33 s in: 1.2 to 1.4 km apart at 50 s.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes, and early: turn into them at once, go up once they are past, and leave from the top while they are slow: they give up the chase 32 to 33 s in (9 of 9), though on a jet the run from the top is slow, 10 to 50 m/s for about 20 s. The upper hand is not to be had: over the top their nose never leaves you, so no dive comes (0 of 9), and in the circle they never sit close enough behind you to zoom from (0 of 9).' },
  coach: {
    watch: { line: 'They are flying straight, watching you close', tip: 'They break the moment you are in reach, about 550 m out. Ease the throttle (S) early, it takes seconds to bite.', keys: ['S'] },
    break: { line: 'They broke: a hard turn into you', tip: 'Do not pull after them into their circle. Pull UP out of their turn and stay above it, at their speed.', keys: ['Mouse', 'Arrows', 'S'] },
    reverse: { line: 'You came past their tail: they are reversing into you', tip: 'Too close and too fast. Pull up out of their turn before you pass them again.', keys: ['Mouse', 'S'] },
    turn: { line: 'You are in their turn, 110 m behind them, with no lead', tip: 'You will not get a shot from here. Pull up out of their circle and keep the height.', keys: ['Mouse', 'S'] },
    chase: { line: 'You are out in front of them: they are behind you', tip: 'Break turn into them: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
  },
};
