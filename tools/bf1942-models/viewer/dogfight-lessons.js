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
      'He comes down fast, fires as you fill his sight, and before you can turn he uses that speed to zoom back up, out of reach. Then he does it again.',
      'Erich Hartmann, the highest-scoring ace in history, fought almost only like this: see, decide, attack, reverse.',
    ],
    counterStory: [
      'Turn to face him when he commits to the dive. A head-on pass gives him a split second to shoot, not a free run at your tail.',
      'Do not stand on your tail to do it: turn round flat and keep your speed. Then let him zoom away and climb on your own, 20 to 30 degrees, the Spitfire\'s best sustained climb (about 12 m/s up).',
      'Every dive he wastes costs him height. Flown nine times from slightly different starts, the pilot who never looked up was shot down every time. The one who met each dive was not hit once.',
    ],
    ace: { plan: 'boomAndZoom', start: { at: [-150, 720, 420], headingDeg: 0, speed: 58 }, memory: { phase: 'perch' } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'move', label: 'He bounces you', seat: 'unaware', skill: 0.55,
        note: 'You fly straight and never look up.' },
      { id: 'counter', label: 'You meet the dive', seat: 'meetTheDive', skill: 0.85,
        note: 'You turn to face every dive and never chase his zoom.' },
    ],
    seconds: 55,
    coach: {
      climb: { line: 'He is climbing away to get above you again', tip: 'Do not follow him up steep. Climb shallow at full throttle: 20 to 30 degrees keeps your speed.', keys: ['W'] },
      perch: { line: 'He is above you, picking his moment', tip: 'Keep your speed over 50 m/s and keep him in sight. Get ready to turn and face him.', keys: ['W'] },
      dive: { line: 'He is diving on you', tip: 'Turn to face him NOW: roll toward him and pull. Make it a head-on pass.', keys: ['Mouse', 'Arrows'] },
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
      'He has the height, and every few seconds he comes down on you, shoots, and zooms back up. You want the height back. The natural thing is to climb straight for it, nose up, full throttle.',
      'That is exactly what he wants: a climbing Spitfire is slow and flies a straight line, the easiest shot there is.',
      'Turning flat in a circle is safer, but it never gets you anything back: he stays up there with all of his height.',
    ],
    counterStory: [
      'Climb, but only while he is not coming at you: when he is zooming away or turning over the top, put the nose 20 degrees up at full throttle.',
      'When he commits to a dive at you, inside about 380 m with his nose on you, break: turn as hard as it goes, into him. His pass is over in a second and he has to zoom away to try again.',
      'The moment he has gone past, climb again. Every dive he wastes costs him height, and your climb between them adds to yours.',
      'Flown nine times from slightly different starts: climbing straight was shot down every time. Turning flat was hardly touched but finished 280 m of energy behind him. Climbing between his dives was never hit, and finished 300 m of energy ahead of him, from a start 440 m below.',
    ],
    ace: { plan: 'boomAndZoom', start: { at: [-150, 720, 420], headingDeg: 0, speed: 58 }, memory: { phase: 'perch' } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'move', label: 'You climb straight', seat: 'climbStraight', skill: 0.85,
        note: 'Nose up, full throttle, straight for the height.' },
      { id: 'flat', label: 'You turn flat', seat: 'flatTurn', skill: 0.85,
        note: 'Round and round, as hard as it turns.' },
      { id: 'counter', label: 'You climb between his dives', seat: 'climbBetween', skill: 0.85,
        note: 'Climb while he is away, break when he commits, climb again.' },
    ],
    seconds: 75,
    coach: {
      climb: { line: 'He is climbing away to get above you again', tip: 'He is not coming at you: climb now, 20 degrees, full throttle.', keys: ['W', 'Mouse'] },
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
    tagline: 'He climbs away and comes back down on you. Do not let him go: follow shallow.',
    story: [
      'You are chasing him and he pulls up and away. The usual advice is never follow a faster plane up, so you let him go.',
      'That is what he wants. With you off his tail he takes all the height he likes, rolls over the top and comes down on you, again and again.',
      'This is the trick the best BF1942 pilots use: get above you, come down, pick you off, go back up.',
    ],
    counterStory: [
      'Follow him, but do not point your nose at him. Climb 20 to 30 degrees underneath him and keep your speed.',
      'Straight up, a Spitfire loses 10 to 14 m/s every second: from 70 m/s it is down to 34 in three. His steep climb spends his speed; your shallow one keeps yours. When he runs out at the top he is slow, in front of you, and inside your guns.',
      'The school flew both nine times from slightly different starts. Letting him go, he landed 11 hits on you on average. Following shallow, he landed 1, and you landed more on him than he did on you.',
    ],
    ace: { plan: 'upAndOver', start: { at: [25, 280, -440], headingDeg: 0, speed: 76 }, memory: { profile: 'efficient' } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'move', label: 'You let him go', seat: 'dontFollow', skill: 0.7,
        note: 'You peel away when he climbs, as the old advice says.' },
      { id: 'counter', label: 'You follow shallow', seat: 'shallowFollow', skill: 0.6,
        note: 'You climb under him at 25 degrees and keep your speed.' },
    ],
    seconds: 45,
    coach: {
      run: { line: 'He is running fast and level', tip: 'Stay with him. Do not let the range open.', keys: ['W'] },
      pull: { line: 'He is climbing away', tip: 'FOLLOW, but shallow: 20 to 30 degrees under him. Do not point your nose straight at him.', keys: ['Mouse', 'Arrows', 'W'] },
      over: { line: 'He is going over the top', tip: 'He is slow up there. Get your nose on him and shoot as he hangs.', keys: ['Mouse', 'Space'] },
      pounce: { line: 'He is diving on you', tip: 'Turn into him to make it head on. Keep your speed.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'He is zooming back up', tip: 'Follow shallow again. Stay fast.', keys: ['W'] },
    },
  },
  {
    id: 'out-of-the-lock',
    title: 'Out of his lock: the turn fight',
    tagline: 'He is on your tail and stays there. Turn hard, then chop the throttle and make him fly past.',
    story: [
      'The best pilots get behind you and stay there: they match your speed, lag your turn so they do not fly past, and pull up out of your turn when they are closing too fast. That is the lock.',
      'Flying straight under it is death. Diving away is nearly as bad: he dives with you, and a Spitfire diving in a straight line is an easy shot.',
      'In BF1942 a faster Spitfire turns faster, and two Spitfires turning hard turn the same: in a flat turn fight between equal pilots, neither can pull the sight onto the other.',
    ],
    counterStory: [
      'First, survive: turn as hard as the aeroplane turns and keep turning. He cannot hit a Spitfire turning hard; he can only wait for you to stop.',
      'Then turn the tables: when he is close behind you, inside about 220 m, hold S. The throttle takes three seconds to bite, then the propeller drags you back, and he flies out in front of you.',
      'He is now the one in front: take the shot, and if he tries the same trick, go up rather than sit behind him.',
      'Flown nine times from slightly different starts: flying straight was shot down every time; diving away took 12 hits a fight; turning hard took almost none; turning and chopping took none and landed the only hits of the fight.',
    ],
    ace: { plan: 'hunter', start: { at: [80, 380, 300], headingDeg: -20, speed: 62 } },
    you: { start: { at: [0, 350, 0], headingDeg: 0, speed: 55 } },
    demos: [
      { id: 'without', label: 'You fly straight', seat: 'cruiser', skill: 0.85,
        note: 'He gets on your tail and you hold your heading.' },
      { id: 'move', label: 'You dive away', seat: 'diveOut', skill: 0.85,
        note: 'The natural escape: nose down for speed.' },
      { id: 'flat', label: 'You turn hard', seat: 'flatTurn', skill: 0.85,
        note: 'As hard as it turns, and keep turning.' },
      { id: 'counter', label: 'You turn and chop', seat: 'chopper', skill: 0.85,
        note: 'Turn hard, and when he is close behind, throttle back.' },
    ],
    seconds: 60,
    coach: {
      hunt: { line: 'He is closing on your tail', tip: 'Do not fly straight. Turn hard as he comes in, and keep turning.', keys: ['Mouse', 'Arrows'] },
      track: { line: 'He has his guns on you', tip: 'TURN HARD now: roll and pull as far as it goes. Do not dive away.', keys: ['Mouse', 'Arrows'] },
      lag: { line: 'He is lagging your turn so he does not fly past', tip: 'Keep the turn tight. When he is inside 220 m, hold S: he will fly past you.', keys: ['Mouse', 'S'] },
      yoyo: { line: 'He pulled up out of your turn', tip: 'Reverse toward him: roll the other way and meet him.', keys: ['Mouse', 'Arrows'] },
      follow: { line: 'He is following you up, shallow', tip: 'Do not hang at the top: tip over and turn before you are slow.', keys: ['Mouse'] },
      evade: { line: 'He flew past: you are behind him', tip: 'Shoot! Then let go of S: you need the speed back.', keys: ['Space', 'W'] },
    },
  },
  {
    id: 'on-his-tail',
    title: 'On his tail: staying there',
    tagline: 'You are behind him and he breaks. Arrive slow, lag his turn, and stay out of his chop.',
    story: [
      'You get in behind him, full throttle, nose on him. He sees you and breaks: turns as hard as it goes, into you.',
      'You are going 20 m/s faster than him, so you cannot stay inside his turn, and in BF1942 a turning Spitfire is almost impossible to hit. Rush in and you fly through his circle: the chase turns into a head-on pass, the 50/50.',
      'Worse, a good pilot chops his throttle when you sit close behind him. Inside 220 m, you fly past and he is on you.',
    ],
    counterStory: [
      'Arrive slow. Kill your closure before you get there: be 250 m back at his speed by the time he sees you. When he breaks you are not fast enough to fly past, and you are still inside your guns\' reach.',
      'Lag his turn. While he turns, keep your nose behind him, not on him: you follow his circle instead of cutting across it. The moment he stops turning, to reverse or level out, pull the nose onto him and shoot.',
      'Stay out of his chop: 250 m back, never 150. If you find yourself closing fast anyway, do not pull harder: throttle back and lift your nose out of his turn.',
      'Flown nine times from slightly different starts: rushing in landed about 3 hits a fight and never brought him down; arriving slow brought him down eight times. Against a pilot who chops: sitting 170 m behind him took 3 hits a fight and landed almost none; lagging 250 m back took none and landed the hits.'
    ],
    ace: { plan: 'breaker', start: { at: [0, 300, -500], headingDeg: 0, speed: 52 } },
    you: { start: { at: [0, 320, 0], headingDeg: 0, speed: 72 } },
    demos: [
      { id: 'move', label: 'You rush in', ace: 'breakTurn', seat: 'chaser', skill: 0.9,
        note: 'Full throttle, nose on him. He breaks as you commit.' },
      { id: 'counter', label: 'You arrive slow', ace: 'breakTurn', seat: 'arriveSlow', skill: 0.9,
        note: 'The same attack, but 250 m back at his speed when he sees you.' },
      { id: 'close', label: 'He chops, you sit close', ace: 'chopper', seat: 'hunter', skill: 0.9,
        note: 'A pilot who chops his throttle, and you 170 m behind him.' },
      { id: 'lag', label: 'He chops, you lag back', ace: 'chopper', seat: 'lagBack', skill: 0.9,
        note: 'The same pilot, and you 250 m back at his speed.' },
    ],
    seconds: 60,
    coach: {
      watch: { line: 'He has not seen you yet', tip: 'Ease the throttle (S) now: be 250 m back at his speed when he does.', keys: ['S'] },
      break: { line: 'He broke into you', tip: 'Do not pull harder. Aim behind him and follow his circle, 250 m back.', keys: ['Mouse', 'S'] },
      chop: { line: 'He chopped his throttle: you are closing fast', tip: 'Throttle back and lift your nose out of his turn. Do not fly past.', keys: ['S', 'Mouse'] },
      reverse: { line: 'You flew past: he is reversing onto you', tip: 'Break turn into him, hard.', keys: ['Mouse', 'Arrows'] },
    },
  },
  {
    id: 'break-turn',
    title: 'The break turn',
    tagline: 'With a fighter closing on your tail, wait, then turn as hard as you can into him.',
    story: [
      'An attacker is closing on your tail, fast. Fly straight and he simply shoots you down.',
      'So you wait until he is committed, just outside his guns\' reach, and then turn as hard as the aeroplane turns, toward him.',
      'His sight cannot follow you round. In BF1942 a faster Spitfire turns as fast as you do, so he will not just fly past, but he has to start the chase all over again, and the shot he had is gone.',
      'Flown nine times from slightly different starts, the pilot who flew straight was shot down every time. The one who broke never was, and barely took a hit.',
    ],
    counterStory: [
      'As the attacker: when he breaks, do not pull harder after him and fly into his circle.',
      'Ease the throttle and lift your nose up out of his turn (a high yo-yo). You trade the extra speed for height, and stay behind him instead of beside him.',
      'A hard-turning Spitfire is almost impossible to hit from a flat chase. Keep the height and wait for him to stop turning.',
    ],
    ace: { plan: 'breakTurn', start: { at: [0, 300, -440], headingDeg: 0, speed: 52 } },
    you: { start: { at: [30, 320, 0], headingDeg: 0, speed: 72 } },
    demos: [
      { id: 'without', label: 'He flies straight', ace: 'cruiser', seat: 'chaser', skill: 0.55,
        note: 'The same attack on a pilot who does nothing.' },
      { id: 'move', label: 'He breaks', seat: 'chaser', skill: 0.55,
        note: 'He waits until you commit, then turns hard into you.' },
      { id: 'counter', label: 'You stay patient', seat: 'patientAttacker', skill: 0.85,
        note: 'You do not chase him into his turn; you lift out of it.' },
    ],
    seconds: 40,
    coach: {
      watch: { line: 'He is flying straight, watching you close', tip: 'You are closing fast. Ease the throttle (S) early, it takes seconds to bite.', keys: ['S'] },
      break: { line: 'He broke: a hard turn into you', tip: 'Do not pull after him. Pull UP out of his turn, then come back down behind him.', keys: ['Mouse', 'Arrows', 'S'] },
      reverse: { line: 'He is reversing onto your tail', tip: 'Turn hard away from him, or go up if you have the speed.', keys: ['Mouse', 'Arrows'] },
      chase: { line: 'He is behind you', tip: 'Break turn into him: roll toward him and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
    },
  },
  {
    id: 'scissors',
    title: 'The flat scissors',
    tagline: 'Side by side and slow: whoever drifts in front loses.',
    story: [
      'After a missed pass two fighters can end up side by side, each turning into the other every time they cross. From above it looks like a pair of scissors.',
      'Each crossing, the faster one drifts forward. The slower one, if he does not stall, ends up behind.',
      'In BF1942 the throttle is a brake: hold S and the propeller drags you back, but it takes 3 to 4 seconds to bite. And below 30 m/s a Spitfire barely turns, so a scissors here is slow, and it sinks.',
    ],
    counterStory: [
      'Throttle back early, reverse every time he crosses, and keep your nose on the horizon: the pilot who lets his nose drop loses height he never gets back.',
      'If you are faster and higher, do not play at all: leave before the scissors starts and come back from above.',
    ],
    ace: { plan: 'scissors', start: { at: [70, 300, -30], headingDeg: -35, speed: 46 } },
    you: { start: { at: [0, 300, 0], headingDeg: 35, speed: 50 }, memory: { fast: true } },
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
      'After a pass you need to come back. A flat turn takes 9 seconds in a Spitfire and the other pilot sees all of it.',
      'Fast: pull up through half a loop and roll upright on top. That is the Immelmann, and you come back the other way, higher.',
      'High and slow: roll upside down and pull through half a loop downward. That is the split-S, and you come back with speed.',
    ],
    counterStory: [
      'An Immelmann ends high and slow at the top. Point your nose at where his loop will top out and shoot as he hangs there. Do it from a distance: chase him straight up from close in and you run out of speed before he does.',
      'A split-S ends low. If you are higher, he has just given you the height: boom and zoom him.',
    ],
    ace: { plan: 'turnarounds', start: { at: [120, 300, -1100], headingDeg: 180, speed: 64 } },
    you: { start: { at: [0, 300, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'move', label: 'He turns round', seat: 'chaser', skill: 0.55,
        note: 'You pass head on and turn flat after him.' },
    ],
    seconds: 40,
    coach: {
      pass: { line: 'He is passing you, about to turn round', tip: 'Watch which way he goes: up or down.', keys: [] },
      immelmann: { line: 'Immelmann: he is going up through half a loop', tip: 'He will be slow at the top. Point at the top of his loop and shoot.', keys: ['Mouse', 'Space'] },
      rollout: { line: 'He is rolling upright on top', tip: 'He is slowest now. Shoot!', keys: ['Space'] },
      split: { line: 'Split-S: he rolled upside down to dive away', tip: 'You are higher now. Let him go, then dive on him.', keys: [] },
      pullthrough: { line: 'He is pulling through, going the other way below you', tip: 'Do not follow him down low. Use your height.', keys: [] },
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
 * as the school's ace unless the demo says so.
 */
export function demoSides(lesson, demo) {
  return [
    { plan: demo.ace ?? lesson.ace.plan, start: lesson.ace.start, memory: lesson.ace.memory, skill: demo.aceSkill ?? 1 },
    { plan: demo.seat, start: lesson.you.start, memory: lesson.you.memory, skill: demo.skill ?? 0.7 },
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
