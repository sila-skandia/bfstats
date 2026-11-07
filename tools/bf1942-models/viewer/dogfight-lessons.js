// The dogfight school's lessons (features/dogfight-school): each one a move,
// the fights that show what it does (`demos`), and what the coach says when
// you fly against it yourself.
//
// A side's `start` is metres from the fight's centre: x right, y above the
// ground, z back (a heading of 0 flies toward -z, down the range; 180 flies
// back up it). `ace` is the school's pilot flying the move; `you` is the
// other seat. In WATCH each demo puts a plan in that seat (`seat`), and may
// swap the ace's (`ace`) to show what happens without the move. In FLY IT
// the other seat is you.
//
// Every demo here is flown on the engine's own flight law, and
// `tests/test_dogfight_school.py` holds each one to what its words say: the
// school does not script outcomes. The numbers in the words are the
// Spitfire's, measured on the same law (features/dogfight-school/README.md,
// "What the airframe does").

export const LESSONS = [
  {
    id: 'boom-and-zoom',
    title: 'Boom and zoom',
    tagline: 'Height is a loaded gun. Dive, shoot, climb away. Never turn with him.',
    story: [
      'The pilot above you holds the cards. Height is speed waiting to be spent: a Spitfire diving at 45 degrees goes from 60 to over 100 m/s in ten seconds.',
      'He comes down fast and steep, 40 to 60 degrees, holds his fire until you fill his sight, fires one short burst, and before you can turn he uses that speed to zoom back up, out of reach. Then he turns over the top and does it again.',
      'Erich Hartmann, the highest-scoring ace in history, fought almost only like this: see, decide, attack, reverse.',
    ],
    counterStory: [
      'Turn to face him when he commits to the dive. Facing you, his dive is a head-on pass with no time to aim: he pulls out about 350 m away and zooms off without firing.',
      'Do not stand on your tail to do it: turn round flat and keep your speed. Then let him zoom away, get your speed back, and climb shallow, about 10 degrees, turning gently to keep him in sight.',
      'Every dive he wastes costs him height: his three dives start 400, about 250 and about 150 m above you. Flown nine times from slightly different starts, the pilot who never looked up was shot down every time, in two or three passes. The one who met each dive was not hit once.',
    ],
    ace: { plan: 'boomAndZoom', start: { at: [-350, 680, 300], headingDeg: 0, speed: 58 }, memory: { phase: 'perch' } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'move', label: 'He bounces you', seat: 'unaware', skill: 0.55,
        note: 'You fly straight and never look up.' },
      { id: 'counter', label: 'You meet the dive', seat: 'meetTheDive', skill: 0.85,
        note: 'You turn to face every dive and never chase his zoom.' },
    ],
    seconds: 55,
    coach: {
      climb: { line: 'He is climbing away to get above you again', tip: 'Do not follow him up steep. Get your speed back, then climb shallow at full throttle.', keys: ['W'] },
      perch: { line: 'He is above you, picking his moment', tip: 'Keep your speed up and keep him in sight. Get ready to turn and face him.', keys: ['W'] },
      dive: { line: 'He is diving on you', tip: 'Turn to face him NOW: roll toward him and pull, the nose no more than 15 degrees up. Make it a head-on pass.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'He is zooming back up on the dive\'s speed', tip: 'Let him go. Level off and climb shallow.', keys: ['W'] },
      reverse: { line: 'He is turning over the top to dive again', tip: 'Watch where his nose goes and be ready to meet him.', keys: [] },
      evade: { line: 'He is breaking: you are on his tail', tip: 'Shoot as he turns, then do not follow him into the turn.', keys: ['Space'] },
    },
  },
  {
    id: 'under-the-height',
    title: 'When he has the height',
    tagline: 'He is above you and keeps coming down. Climb between his dives, break only when he commits.',
    story: [
      'He has the height, 520 m of it, and he keeps coming down on you, shooting and zooming back up. You want the height back. The natural thing is to climb straight for it, nose up, full throttle.',
      'That is exactly what he wants: 30 degrees nose up, a Spitfire is down to 35 m/s on a straight line, the easiest shot there is. He settles in behind and one long burst finishes it.',
      'Turning flat in a circle is safer: he cannot hold his sight on you, and his dives come to nothing. But it never gets you anything back: you finish at the height you started.',
    ],
    counterStory: [
      'Climb, but only while he is not coming at you: when he is zooming away or turning over the top, put the nose up at full throttle, up to 20 degrees once the speed is back, turning gently to keep him in sight.',
      'When he commits to a dive at you, inside about 380 m with his nose on you, break: turn as hard as it goes, into him. Turned toward him, his pass is spoiled: he pulls out without a shot and zooms away to try again.',
      'The moment he has gone past, climb again. Every dive he wastes costs him height, and your climb between them adds to yours: his second dive starts about 160 m above you, not 520.',
      'Flown nine times from slightly different starts: climbing straight was shot down every time, in one pass. Turning flat was never hit, and finished at the height it started. Climbing between his dives was never hit either, and climbed about 450 m: from 520 m under him to within about 150 m.',
    ],
    // He sits well back, so a straight line gives him the time to settle
    // behind it: his bursts here run up to 1.8 s, opened at 300 m.
    ace: { plan: 'boomAndZoom', start: { at: [-150, 700, 700], headingDeg: 0, speed: 58 }, memory: { phase: 'perch', burst: 1.8, open: 300 } },
    you: { start: { at: [0, 180, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'move', label: 'You climb straight', seat: 'climbStraight', skill: 0.85,
        note: 'Nose 30 degrees up, full throttle, straight for the height.' },
      { id: 'flat', label: 'You turn flat', seat: 'flatTurn', skill: 0.85,
        note: 'Round and round, as hard as it turns without losing height.' },
      { id: 'counter', label: 'You climb between his dives', seat: 'climbBetween', skill: 0.85,
        note: 'Climb while he is away, break when he commits, climb again.' },
    ],
    seconds: 55,
    coach: {
      climb: { line: 'He is climbing away to get above you again', tip: 'He is not coming at you: climb now, up to 20 degrees, full throttle.', keys: ['W', 'Mouse'] },
      perch: { line: 'He is above you, picking his moment', tip: 'Climb while he waits. Watch his nose: when it comes round to you, be ready to break.', keys: ['W'] },
      dive: { line: 'He is diving at you', tip: 'Wait until he is about 380 m out, then BREAK: roll toward him and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'He has gone past and is zooming up', tip: 'Climb again, now. His height is going and yours is coming.', keys: ['W', 'Mouse'] },
      reverse: { line: 'He is turning over the top', tip: 'Keep climbing, and keep him in sight.', keys: ['W'] },
      evade: { line: 'You are on his tail', tip: 'Shoot as he turns, then climb: do not follow him into his turn.', keys: ['Space'] },
    },
  },
  {
    id: 'up-and-over',
    title: 'Up and over',
    tagline: 'He pulls straight up out of your chase. Follow him up and you hang below him; follow shallow and he hangs in front of you.',
    story: [
      'You are chasing him, but he came in faster than you. He pulls nearly straight up, and the instinct is to follow him, nose on him.',
      'Straight up, the slower plane runs out first. You hang below him at 13 m/s with no control and the nose falling, while he still has the speed to go over the top in a half loop and come back down at you from above.',
      'This is the trick the best BF1942 pilots use: up where you cannot follow, then back down on you. Flown nine times from slightly different starts, you hung 45 to 115 m below him every time. The school\'s ace seldom lands the shot from over the top (under one hit a fight): what the trick bought him was the height and four seconds of you helpless beneath him.',
    ],
    counterStory: [
      'Follow him, but shallow: 25 degrees on his bearing, nose under him, full throttle. Do not point your nose at him.',
      'Straight up, a Spitfire loses 10 to 14 m/s every second: from 70 m/s it is down to 34 in three. His climb spends his speed; your shallow one spends far less. When he goes over the top he is slow, above you and inside your guns, and you are the faster plane.',
      'From the same nine starts: at his slowest you were 15 to 18 m/s faster than him and 180 to 275 m away. You had the first hits in 7 of the 9 and landed 11 a fight to his 0.2.',
    ],
    ace: { plan: 'upAndOver', start: { at: [25, 280, -280], headingDeg: 0, speed: 78 } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 50 } },
    demos: [
      { id: 'move', label: 'You follow him up', seat: 'followStraightUp', skill: 0.7,
        note: 'You pull up after him as steep as he goes.' },
      { id: 'counter', label: 'You follow shallow', seat: 'shallowFollow', skill: 0.7,
        note: 'You climb after him at 25 degrees, nose under him, and save your speed.' },
    ],
    seconds: 45,
    coach: {
      run: { line: 'He is running fast and level', tip: 'He is faster than you. Stay behind him and watch for the pull up.', keys: ['W'] },
      pull: { line: 'He is pulling nearly straight up', tip: 'Do not follow him up. Climb after him at 25 degrees, nose under him, full throttle.', keys: ['Mouse', 'Arrows', 'W'] },
      over: { line: 'He is going over the top', tip: 'He is slow up there. Raise the nose onto him and shoot as he hangs.', keys: ['Mouse', 'Space'] },
      pounce: { line: 'He is coming back down at you', tip: 'Do not climb into him: nose down, keep your speed, let him go past.', keys: ['Mouse', 'W'] },
      zoom: { line: 'He is zooming back up', tip: 'Follow shallow again. Stay fast.', keys: ['W'] },
    },
  },
  {
    id: 'out-of-the-lock',
    title: 'Out of his lock: the turn fight',
    tagline: 'He is on your tail and stays there. Turn hard, and when he sits close behind you in the turn, chop the throttle and pull up: he flies past underneath.',
    story: [
      'The best pilots get behind you and stay there. The hunter closes from 300 m at full throttle, eases off as he gets in, and holds his fire until he is inside 150 m, where a burst counts. That is the lock.',
      'Flying straight under it is death: shot down every time, 14 to 23 s in. Diving away is no escape either: he dives with you and sits 140 m behind you all the way down, and when you pull out and zoom you are slow in front of him.',
      'In BF1942 a Spitfire turning hard flies a circle about 120 m across, round in nine seconds, and a faster one turns faster, not wider. Turn as hard as it goes once he is committed behind you, and he follows you round, 40 to 100 m behind, but he cannot pull his sight onto you, and you cannot get round onto him: a stalemate.',
    ],
    counterStory: [
      'First, survive: fly on until he is committed behind you, inside 180 m and closing, then turn as hard as the aeroplane turns and hold your height. He follows you in, but he cannot hit a Spitfire turning hard.',
      'Then turn the tables: once he is sitting close behind you in the circle, inside about 90 m and still closing, hold S and pull up through the turn. You go up and slow to about 26 m/s; his throttle takes seconds to bite, so he cannot slow as fast, and he flies through underneath you, a few metres below, on your heading, and out in front.',
      'Turn onto him at once, full throttle. He is in front of you for about a second before he breaks away: that is your burst. Then get your speed back: you are slow.',
      'Flown nine times from slightly different starts: flying straight was shot down every time; diving away took 6 to 22 hits a fight and was shot down once; turning hard took no hits and landed none; turning and chopping took none, made him fly past every time and landed 1 to 7 hits.',
    ],
    ace: { plan: 'hunter', start: { at: [80, 380, 300], headingDeg: -20, speed: 62 } },
    you: { start: { at: [0, 350, 0], headingDeg: 0, speed: 55 } },
    demos: [
      { id: 'without', label: 'You fly straight', seat: 'cruiser', skill: 0.85,
        note: 'He closes in behind you and you hold your heading.' },
      { id: 'move', label: 'You dive away', seat: 'diveOut', skill: 0.85,
        note: 'The natural escape: when he is committed behind you, nose down and away for speed.' },
      { id: 'flat', label: 'You turn hard', seat: 'lockHardTurn', skill: 0.85,
        note: 'When he is committed behind you, as hard as it turns, holding your height, and keep turning.' },
      { id: 'counter', label: 'You turn and chop', seat: 'chopper', skill: 0.85,
        note: 'Turn hard; when he sits close behind you in the circle, throttle back and pull up.' },
    ],
    seconds: 60,
    coach: {
      hunt: { line: 'He is closing on your tail', tip: 'Do not fly straight. When he is committed, inside 200 m, turn hard.', keys: ['Mouse', 'Arrows'] },
      track: { line: 'He is on your tail, closing to fire', tip: 'TURN HARD now: roll and pull as far as it goes. He opens fire at 150 m.', keys: ['Mouse', 'Arrows'] },
      lag: { line: 'He followed you into your turn', tip: 'Keep turning hard and hold your height. When he is inside 90 m, hold S and pull up: he flies past underneath.', keys: ['Mouse', 'S'] },
      follow: { line: 'He is following you up, shallow', tip: 'Do not hang at the top: tip over and turn before you are slow.', keys: ['Mouse'] },
      evade: { line: 'He flew past and is breaking away', tip: 'Shoot now, then W: you are slow.', keys: ['Space', 'W'] },
    },
  },
  {
    id: 'on-his-tail',
    title: 'On his tail: staying there',
    tagline: 'You are behind him and he breaks. Do not sit in his circle: go up over it, or stay out of it, and wait for him to stop turning.',
    story: [
      'You get in behind him, full throttle, nose on him. He sees you and breaks: turns as hard as it goes, into you.',
      'In BF1942 a faster Spitfire turns faster, not wider, so rushing in does not fly you through his circle: you come past his tail about 35 m behind him and then sit 50 m behind him in his turn. But you cannot pull the lead on a Spitfire turning hard: about 3 hits a fight, all as he breaks, and nobody comes down.',
      'Worse, a good pilot chops his throttle and pulls up when you sit close behind him in his turn. You fly through underneath him and out in front, and he turns onto you.',
    ],
    counterStory: [
      'Do not sit in his circle. Arrive at his speed, and when he breaks, go up over his turn instead of into it: he never gets his nose on you, though you never get yours on him while he turns either.',
      'Or stay out of it. When he breaks 300 m in front of you, turn the same way, as hard, where you are: your circle and his go round side by side, 250 to 300 m apart, and neither of you has the other inside his guns. Never follow him in to 150 m.',
      'He cannot turn for ever. When he thinks he has shaken you off and rolls out, you are 250 m behind him at his speed: nose on him and guns.',
      'Flown nine times from slightly different starts: rushing in landed about 3 hits a fight and brought nobody down; arriving slow, nobody was hit. Against the pilot who chops: sitting close behind him in his turn, you flew past underneath him every time and took 2 to 10 hits; turning with him 250 m out, you took at most one and shot him down seven times in nine after he rolled out.',
    ],
    ace: { plan: 'breaker', start: { at: [0, 300, -500], headingDeg: 0, speed: 52 } },
    you: { start: { at: [0, 320, 0], headingDeg: 0, speed: 72 } },
    demos: [
      { id: 'move', label: 'You rush in', ace: 'breakTurn', seat: 'chaser', skill: 0.9,
        note: 'Full throttle, nose on him. He breaks 300 m out; you come past his tail and end up 50 m behind him in his turn, with no lead.' },
      { id: 'counter', label: 'You arrive slow', ace: 'breakTurn', seat: 'arriveSlow', skill: 0.9,
        note: 'At his speed this time. He still breaks 300 m out; you do not follow him in, you go up over his turn.' },
      { id: 'close', label: 'He chops, you sit close', ace: 'chopper', seat: 'hunter', skill: 0.9,
        aceStart: { at: [0, 350, -300], headingDeg: 0, speed: 55 }, youStart: { at: [80, 380, 0], headingDeg: -20, speed: 62 },
        note: 'A pilot who chops his throttle, and you following him into his turn.' },
      { id: 'lag', label: 'He chops, you lag back', ace: 'chopper', seat: 'lagBack', skill: 0.9,
        aceMemory: { breakAt: 300, rollOut: true }, youStart: { at: [0, 310, -180], headingDeg: 0, speed: 56 },
        note: 'The same pilot, breaking at 300 m this time, and you 250 m back at his speed, staying out of his circle.' },
    ],
    seconds: 60,
    coach: {
      watch: { line: 'He has not broken yet', tip: 'Ease the throttle (S): arrive at his speed. When he breaks, do not follow him into his turn.', keys: ['S'] },
      break: { line: 'He broke into you', tip: 'Do not follow him in: his circle is 120 m across. Go up over it, or turn the same way out here, 250 m off.', keys: ['Mouse', 'Arrows'] },
      chop: { line: 'He chopped his throttle and pulled up: you are closing fast', tip: 'Pull up and out of his turn now, or you fly through underneath him.', keys: ['Mouse', 'S'] },
      reverse: { line: 'You flew past: he is turning onto you', tip: 'Break turn hard, and get your speed back (W).', keys: ['Mouse', 'Arrows', 'W'] },
    },
  },
  {
    id: 'break-turn',
    title: 'The break turn',
    tagline: 'With a fighter closing on your tail, wait, then turn as hard as you can into him.',
    story: [
      'An attacker is closing on your tail, fast, from one side. Fly straight and he simply shoots you down.',
      'So you wait until he is committed, 300 m back, just outside his guns\' reach, and then turn as hard as the aeroplane turns, toward his side: into him.',
      'His sight cannot follow you round, and his closure carries him past your tail, about 30 m behind you. As he crosses, reverse: turn into him again.',
      'Do not expect him to fly out in front of you. In BF1942 a faster Spitfire turns faster, not wider (its turn is 110 to 150 m across at any speed), so he swings back in behind you. But close, inside your turn, his nose behind you: while you keep turning into him he has no shot, and his 20 m/s are gone.',
      'Flown nine times from slightly different starts, the pilot who flew straight was shot down every time. The one who broke never was, and barely took a hit, all of them in the first two seconds of the break, while his wings were still rolling over.',
    ],
    counterStory: [
      'As the attacker: when he breaks, do not pull after him into his circle. You will come past his tail and end up sitting in his turn without a shot.',
      'The moment his wings go over, lift your nose up out of his turn (a high yo-yo) and stay up there, 70 m above his circle, at his speed. You never come past him, and he can never get his nose up to you.',
      'A hard-turning Spitfire is almost impossible to hit from a flat chase, and his circle is only 120 m across. Keep the height and wait for him to stop turning: then dive on him.',
      'Flown nine times, the patient attacker never came within 80 m of him, and once the break was a second old neither of them landed a hit.',
    ],
    ace: { plan: 'breakTurn', start: { at: [0, 300, -440], headingDeg: 0, speed: 52 } },
    // From his right rear quarter, so which way is into him shows.
    you: { start: { at: [240, 320, 0], headingDeg: -25, speed: 72 } },
    demos: [
      { id: 'without', label: 'He flies straight', ace: 'cruiser', seat: 'chaser', skill: 0.55,
        note: 'The same attack on a pilot who does nothing.' },
      { id: 'move', label: 'He breaks', seat: 'chaser', skill: 0.55,
        note: 'He waits until you are 300 m back, then turns hard into you. You come past his tail; he reverses into you.' },
      { id: 'counter', label: 'You stay patient', seat: 'patientAttacker', skill: 0.85,
        note: 'As he breaks you lift out of his turn and stay above it, instead of chasing him into it.' },
    ],
    seconds: 40,
    coach: {
      watch: { line: 'He is flying straight, watching you close', tip: 'You are closing fast. Ease the throttle (S) early, it takes seconds to bite.', keys: ['S'] },
      break: { line: 'He broke: a hard turn into you', tip: 'Do not pull after him into his circle. Pull UP out of his turn and stay above it, at his speed.', keys: ['Mouse', 'Arrows', 'S'] },
      reverse: { line: 'You came past his tail: he is reversing into you', tip: 'Too close and too fast. Pull up out of his turn before you pass him again.', keys: ['Mouse', 'S'] },
      turn: { line: 'You are in his turn, 50 m behind him, with no lead', tip: 'You will not get a shot from here. Pull up out of his circle and keep the height.', keys: ['Mouse', 'S'] },
      chase: { line: 'You are out in front of him: he is behind you', tip: 'Break turn into him: roll toward him and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
    },
  },
  {
    id: 'scissors',
    title: 'The flat scissors',
    tagline: 'Side by side and slow: whoever drifts in front loses.',
    story: [
      'It starts with an overshoot: you came in too fast and slid out alongside him, on his heading. Now each of you turns into the other, your paths cross, and both reverse to turn into each other again. From above the two paths braid along one line, like the blades of a pair of scissors.',
      'Every crossing is a race to be slowest along that line. The faster one drifts forward a little each time, and the slower one ends up behind him with his nose coming onto him.',
      'In BF1942 the throttle is a brake: hold S and the propeller drags you back, but it takes 3 to 4 seconds to bite. Below 30 m/s a Spitfire barely turns, so slow does not mean as slow as possible: the ace here sits at about 40 m/s, the other pilot at full throttle a little faster, and that is enough.',
    ],
    counterStory: [
      'Throttle back early, reverse every time he crosses, and keep your nose on the horizon: roll from bank to bank without letting the nose fall, or each reversal costs height you never get back.',
      'Do not shoot as you cross him head-on: that is a split second. Wait until he has drifted out in front and your nose comes onto his tail.',
      'If you are faster and higher, do not play at all: leave before the scissors starts and come back from above.',
    ],
    // The overshoot that starts it: you came in too fast and are sliding
    // past him, side by side on his heading, 120 m out.
    ace: { plan: 'scissors', start: { at: [60, 300, 0], headingDeg: 0, speed: 44 } },
    you: { start: { at: [-60, 300, -15], headingDeg: 0, speed: 52 }, memory: { fast: true } },
    demos: [
      { id: 'move', label: 'Scissoring', seat: 'scissors', skill: 0.55,
        note: 'You scissor too, but at full throttle.' },
    ],
    seconds: 45,
    coach: {
      reverse: { line: 'He is scissoring: turning into you each time you cross', tip: 'Throttle back (S) early, it takes seconds to bite. Reverse each time he crosses.', keys: ['S', 'Mouse', 'Arrows'] },
      cross: { line: 'He crossed: he is reversing', tip: 'Reverse now, toward him.', keys: ['Mouse', 'Arrows'] },
      shoot: { line: 'You drifted out in front of him', tip: 'Break hard into him, now.', keys: ['Mouse', 'Arrows'] },
    },
  },
  {
    id: 'turnarounds',
    title: 'The Immelmann and the split-S',
    tagline: 'Two ways to turn round in the vertical: up with speed, or down with height.',
    story: [
      'After a pass you have to turn round. A flat turn round takes about 5 seconds at a Spitfire\'s hardest and leaves you at the height you were. The two vertical ways round trade height and speed instead.',
      'Fast: pull straight up through half a loop and, upside down on top, roll upright. That is the Immelmann. Here he has just gone past you at 74 m/s; he climbs about 107 m and rolls out going back the other way at 37 m/s, still 70 m above where he started.',
      'High and slow, with you coming at him: roll upside down with the nose on the horizon, then pull through half a loop downward. That is the split-S. He goes in at 51 m/s and comes out going back the way he came, 145 m lower and 17 m/s faster.',
    ],
    counterStory: [
      'An Immelmann ends high and slow. Do not chase him up from close in: from 170 m behind you hang at 16 to 28 m/s under his top while he rolls out at 37, and you get a fifth of a second of fire at most.',
      'Hold off instead. From 420 m back, keep your speed and climb 20 degrees at where his loop tops out: as he hangs there you are about 270 m off with your nose on him, closing. Flown nine times, that was 0.6 to 3.3 seconds of fire that would land in seven, and you never fell below 44 m/s. He shoots back as you pass under him in three of them.',
      'A split-S ends low: he has given you his height on top of yours. Let him go and he runs off at 70 m/s and nobody fires. Go down on him the moment he rolls over, straight at where he will come out, not through his half loop after him: a Spitfire\'s dive gains speed slowly, so a dive started after he is out never catches him. Shoot as you close on his run, then zoom back up. Flown nine times, that landed fire every time, a second or more in eight, and he never fired back.',
    ],
    // FLY IT is the Immelmann's counter: he has made his pass and gone by,
    // fast, 420 m in front of you.
    ace: { plan: 'turnarounds', start: { at: [0, 295, -420], headingDeg: 0, speed: 74 } },
    you: { start: { at: [0, 300, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'immelmann', label: 'You follow him up', seat: 'turnaroundsFollow', skill: 0.7, seconds: 16,
        aceStart: { at: [0, 275, -170], headingDeg: 0, speed: 76 },
        note: 'He went by 170 m in front of you and pulls up. You pull straight up after him.' },
      { id: 'immelmann-counter', label: 'You meet him at the top', seat: 'turnaroundsMeetTop', skill: 0.7, seconds: 18,
        note: 'The same Immelmann, you 420 m back: you hold off, climb 20 degrees at the top of his loop and shoot as he hangs there.' },
      { id: 'split', label: 'You let him go', seat: 'turnaroundsLetGo', skill: 0.7, seconds: 22,
        aceStart: { at: [40, 460, -760], headingDeg: 180, speed: 45 }, youStart: { at: [0, 600, 0], headingDeg: 0, speed: 52 },
        note: 'He is high and slow, you 140 m higher and coming at him. He split-Ses away; you fly on and keep your height.' },
      { id: 'split-counter', label: 'You dive on him', seat: 'turnaroundsBoom', skill: 0.7, seconds: 24,
        aceStart: { at: [40, 460, -760], headingDeg: 180, speed: 45 }, youStart: { at: [0, 600, 0], headingDeg: 0, speed: 52 },
        note: 'The same split-S: the moment he rolls over you dive on him from your height, shoot as you close on his run, and zoom back up.' },
    ],
    seconds: 40,
    coach: {
      pass: { line: 'He has gone past you fast, about to turn round', tip: 'Watch which way he goes: up or down. Keep your speed.', keys: ['W'] },
      immelmann: { line: 'Immelmann: he is going up through half a loop', tip: 'Do not follow him up. Keep your speed and climb 20 degrees at the top of his loop.', keys: ['Mouse', 'W'] },
      rollout: { line: 'He is upside down on top, rolling upright', tip: 'He is slowest now. Nose on him and shoot.', keys: ['Mouse', 'Space'] },
      top: { line: 'He is on top going the other way, above you', tip: 'He is slow and coming back over you: shoot as he comes, then keep your speed.', keys: ['Space', 'W'] },
      split: { line: 'Split-S: he rolled upside down', tip: 'He is giving you the height. Go down on him now.', keys: ['Mouse'] },
      pullthrough: { line: 'He is pulling through, going back the way he came below you', tip: 'Dive at where he will come out, not after him through his loop.', keys: ['Mouse'] },
      run: { line: 'He is running out of the split-S, fast and low', tip: 'Shoot as you close on him, then zoom back up.', keys: ['Space', 'W'] },
      attack: { line: 'He is coming back at you', tip: 'Turn to face him.', keys: ['Mouse', 'Arrows'] },
    },
  },
  {
    id: 'free',
    title: 'Against the ace',
    tagline: 'No script: he picks his own moves. Use everything.',
    story: [
      'The school\'s ace picks from the moves its fights proved. Behind you, he never lets you run. Coming at him, he turns to face you instead of climbing away. On his tail, he breaks into you, and if you stay close he chops his throttle to make you fly past. With height over you, he bounces you and zooms back up. When you climb away, he follows shallow.',
      'Flown against every other pilot in the school from ten starts each, he landed 128 hits and took 82. The ace he replaced landed 9 and took 178.',
      'The coach tells you which move he is on and what beats it.',
    ],
    counterStory: [
      'Keep your speed above 50 m/s. Turn to face every dive. When he climbs away, follow shallow. If he breaks, do not sit 50 m behind him in his circle: he will chop his throttle and you will be in front. Lose sight, lose the fight.',
    ],
    ace: { plan: 'ace', start: { at: [0, 360, -900], headingDeg: 180, speed: 60 } },
    you: { start: { at: [0, 300, 0], headingDeg: 0, speed: 58 } },
    demos: [],
    seconds: 60,
    coach: {
      climb: { line: 'He is climbing round you, out of reach', tip: 'Climb too, shallow, and keep him in sight. Do not let him get above you for free.', keys: ['W'] },
      dive: { line: 'He is diving on you', tip: 'Turn to face him: make it head on.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'He is zooming back up', tip: 'Follow shallow. Stay fast.', keys: ['W'] },
      over: { line: 'He is going over the top', tip: 'He is slow up there: nose on him and shoot.', keys: ['Mouse', 'Space'] },
      break: { line: 'He broke into you', tip: 'Do not sit close behind him in his circle: pull up out of it, or he chops his throttle and you fly past.', keys: ['Mouse', 'S'] },
      meet: { line: 'He turned to face you', tip: 'A head-on pass: shoot early, then turn the way he is going.', keys: ['Space', 'Mouse'] },
      attack: { line: 'He is behind you, closing', tip: 'Break turn into him, hard, before he is inside 270 m.', keys: ['Mouse', 'Arrows'] },
      follow: { line: 'He is following you up, shallow', tip: 'Do not hang at the top: tip over before you are slow.', keys: ['Mouse'] },
    },
  },
];

export const lessonById = id => LESSONS.find(l => l.id === id) ?? null;

/** What the keys are called on the Air control map (controls-defaults.js). */
export const KEY_WORDS = {
  W: 'W: throttle up',
  S: 'S: throttle back (a brake after 3 s)',
  Mouse: 'Mouse: roll and pitch',
  Arrows: 'Arrows: roll and pitch',
  Space: 'Space: fire',
  AD: 'A / D: rudder',
};

/** Rules of thumb for the school's tip line. */
export const RULES = [
  'Speed is life. Below 30 m/s a Spitfire can barely turn.',
  'Height is speed in the bank: a dive turns it back into speed.',
  'Turn to face every dive. A head-on pass is a short pass.',
  'When he climbs away, follow shallow: his steep climb spends his speed.',
  'Lose sight, lose the fight.',
  'Roll first, then pull: point your lift where you want to go.',
  'A hard-turning Spitfire is almost impossible to hit from a flat chase.',
  'Throttle back early: the brake takes 3 to 4 seconds to bite.',
  'Out of speed, out of ideas.',
];

/**
 * A lesson demo's two seats: the ace (or the demo's own plan in his seat)
 * and the other pilot, with their skills. The other seat is never as sharp
 * as the school's ace unless the demo says so. A demo may stage its own
 * starts (`aceStart`, `youStart`) and memories when its move needs another
 * height or speed than the lesson's FLY IT start.
 */
export function demoSides(lesson, demo) {
  return [
    { plan: demo.ace ?? lesson.ace.plan, start: demo.aceStart ?? lesson.ace.start, memory: demo.aceMemory ?? lesson.ace.memory, skill: demo.aceSkill ?? 1 },
    { plan: demo.seat, start: demo.youStart ?? lesson.you.start, memory: demo.youMemory ?? lesson.you.memory, skill: demo.skill ?? 0.7 },
  ];
}

/** Single-seat fighters first, then anything with wings: the order the
 *  school picks an airframe in. Matched on the template's name. */
export const FIGHTERS = ['spitfire', 'bf109', 'mustang', 'yak9', 'zero', 'corsair', 'fw190', 'p47', 'p38', 'hurricane',
  'me262', 'goblin', 'natter', 'bf110', 'mosquito'];

/** How fighter-like a template is: 0 for the best, a large number for a
 *  bomber or anything unknown. */
export function fighterRank(name) {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const i = FIGHTERS.findIndex(f => n.includes(f));
  if (i >= 0) return i;
  if (/b17|ju88|c47|lancaster|heinkel|he111|betty|ac130|transport/.test(n)) return 900;
  return 100;
}
