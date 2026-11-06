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
      'The school\'s ace flies the way the best pilots do. Faster or higher, he fights in the vertical. With you on his tail, he breaks or climbs away. Behind you, he chases with yo-yos.',
      'The coach tells you what he is doing and what beats it.',
    ],
    counterStory: [
      'Keep your speed above 50 m/s. Turn to face every dive. When he climbs away, follow shallow. Lose sight, lose the fight.',
    ],
    ace: { plan: 'ace', start: { at: [0, 360, -900], headingDeg: 180, speed: 60 } },
    you: { start: { at: [0, 300, 0], headingDeg: 0, speed: 58 } },
    demos: [],
    seconds: 60,
    coach: {
      assess: { line: 'He is sizing you up', tip: 'Get your speed up and climb shallow.', keys: ['W'] },
      climb: { line: 'He is climbing above you', tip: 'Climb too, shallow, and keep him in sight.', keys: ['W'] },
      dive: { line: 'He is diving on you', tip: 'Turn to face him: make it head on.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'He is zooming back up', tip: 'Follow shallow. Stay fast.', keys: ['W'] },
      break: { line: 'He broke into you', tip: 'Do not chase him round: pull up out of his turn.', keys: ['Mouse', 'S'] },
      vertical: { line: 'He is going straight up', tip: 'Follow shallow under him and catch him at the top.', keys: ['Mouse'] },
      hammer: { line: 'He is tipping over the top', tip: 'He is slow: nose on him and shoot.', keys: ['Mouse', 'Space'] },
      chase: { line: 'He is on your tail', tip: 'Break turn into him, hard.', keys: ['Mouse', 'Arrows'] },
      yoyo: { line: 'He pulled up so he does not overshoot', tip: 'Reverse toward him.', keys: ['Mouse', 'Arrows'] },
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
