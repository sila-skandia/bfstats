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
// There is no way out of the circle on a jet. The Dip, the Flip and the
// Ninja go up for the hunter to follow and slow; a jet does not slow in a
// 70 degree climb, and with every pilot nosing over at the sky's 880 m
// (the ceiling guard read over the pace) the hunter stays under the top of
// the sky, fast, while the one who zooms goes on up through it to 1,600 m.
// The Dip's 9 of 9 before the guard fix came from the hunter following up
// past 1,000 m and wallowing there.
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
    'The break saves you, but it leaves you both in a circle neither of you wins, and on a jet there is no way out of it here. The Spitfire\'s way is to go up once they are past, for them to follow and slow. A jet climbing at 70 degrees does not slow, and above 880 m, where the wings are dying, its nose will not come down: you go on up to about 1,600 m and hang over the top at 34 to 44 m/s. They level off under the top of the sky, at about 950 m and never slower than 95 m/s, give the chase up 31 to 33 s in and turn back the way they came, which is toward you. You come down from the top at 35 m/s, 1.2 to 1.5 km from them and closing.',
    'The upper hand is not to be had either. Over the top their nose does come off you, 30 to 32 s in, but they are more than a kilometre away and below: the dive never gets near a shot. Stay in the circle to zoom out of it and they never sit close behind you to zoom from: they hang 110 to 860 m away, from 100 m below you to 120 m above, until a head-on pass 40 to 45 s in.',
  ],
  counterStory: [
    'As the attacker: when they break, do not pull after them into their circle. You will come past their tail and end up sitting in their turn without a shot.',
    'The moment their wings go over, lift your nose up out of their turn (a high yo-yo) and stay up there, 40 to 70 m above their circle, at their speed. You never come past them, and they never land a round on you.',
    'A hard-turning F-16 is no easier to hit from a flat chase, and its circle is only about 135 m across. Keep the height and wait for them to stop turning: then dive on them.',
    'Flown nine times, the patient attacker never came within 59 m of the breaker, and after the first 1.2 s neither of them landed a hit.',
  ],
  demos: {
    move: { note: 'They break the moment you are in reach, 460 m out, and turn hard into you. You come past their tail; they reverse into you. From here it is a circle nobody wins: the three fights after this one try the way out of it and the upper hand, and on a jet none of them works.' },
    dip: {
      note: 'The Spitfire\'s way out: turn into them at once, 640 m out, and once they are past go up at 70 degrees for them to follow and slow. On a jet they do not: the climb does not slow you, its nose will not come down above 880 m, and you go on up to 1,600 m while they level off under the top of the sky, fast. They give the chase up; you come down from the top slow, toward them.',
      verdict: { works: 0, of: 9, line: 'No: their guns never have you and none of their rounds lands, but you never get away. You go over the top at 1,590 to 1,600 m at 34 to 44 m/s, 26 s in; they level off at 950 m (1,030 m in one), never under 95 m/s, and give the chase up 31 to 33 s in, turning back the way they came, toward you. You leave from the top 44 to 47 s in at 35 m/s: at 50 s you are 1.2 to 1.5 km apart and closing, and in one they turn to meet you and land 2 rounds as you leave.' },
    },
    flip: {
      note: 'Break at 460 m and hold your height in the circle. With them dead astern inside 155 m, zoom out of it at 70 degrees until 67 m/s are left; they follow you up and slow. Over the top, down on them with the lead, off them before the pass, and when they break with you close a high yo-yo up out of their turn: you never follow their break round in the flat.',
      verdict: { works: 0, of: 9, line: 'No: on a jet you barely get to zoom. In the circle they hang 110 to 860 m away, from 100 m below you to 120 m above, never dead astern inside 155 m, until a head-on pass 40 to 45 s in; the zoom starts 44 to 45 s in, in three of the nine, with no time left to come back down. Their rounds never land; yours land once, 1 round in the head-on pass.' },
    },
    ninja: {
      note: 'The Dip\'s way in, waiting for the dive: turn into them at once, 640 m out, and go up once they are past. On a jet they do not follow: you go on up to 1,600 m and they stay under the top of the sky. Their nose comes off you as they give the chase up, and the dive comes, but from more than a kilometre away.',
      verdict: { works: 0, of: 9, line: 'No: you never fire. You go over the top at 1,590 to 1,600 m, 26 s in; they level off at 950 m and give the chase up 31 to 33 s in, and as their nose comes off you, 30 to 32 s in, you dive, 1.2 to 1.3 km from them and 550 to 620 m above. They sit on your six 1.5 to 1.8 s once, as you go up, without a shot. You leave from the top 44 to 47 s in, slow; at 50 s you are 1.2 to 1.5 km apart and closing, and in one they turn to meet you and land 2 rounds.' },
    },
  },
  survival: { verdict: 'no', line: 'No, not on a jet: the break is never shot down, but nothing gets you out of the circle or on top of it. Up once they are past, you go on through the top of the sky to 1,600 m while they stay under it, fast, and you come down slow toward them (0 of 9); over the top the dive comes from more than a kilometre away and never fires (0 of 9); and in the circle they never sit close enough behind you to zoom from until 44 s in (0 of 9).' },
  coach: {
    watch: { line: 'They are flying straight, watching you close', tip: 'They break the moment you are in reach, about 550 m out. Ease the throttle (S) early, it takes seconds to bite.', keys: ['S'] },
    break: { line: 'They broke: a hard turn into you', tip: 'Do not pull after them into their circle. Pull UP out of their turn and stay above it, at their speed.', keys: ['Mouse', 'Arrows', 'S'] },
    reverse: { line: 'You came past their tail: they are reversing into you', tip: 'Too close and too fast. Pull up out of their turn before you pass them again.', keys: ['Mouse', 'S'] },
    turn: { line: 'You are in their turn, 110 m behind them, with no lead', tip: 'You will not get a shot from here. Pull up out of their circle and keep the height.', keys: ['Mouse', 'S'] },
    chase: { line: 'You are out in front of them: they are behind you', tip: 'Break turn into them: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
  },
};
