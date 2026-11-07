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
      { id: 'dip', kind: 'dip', label: 'The Dip: meet him, then run', seat: 'bzDip', ace: 'bzAce', skill: 0.85, seconds: 90,
        note: 'You meet his first dive head on, then run out of the pass the way it left you while his zoom takes him the other way: flat out, the nose a little down to 150 m, then level. Keep running: he follows for a minute.',
        verdict: { works: 9, of: 9, line: 'In all nine he dives after you for a minute but never gets inside 416 m or hits you, gives up a chase he cannot win at 62 to 76 s and climbs away, and at 90 s you are 1.9 to 2.9 km apart and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: break, then up after him', seat: 'bzFlip', ace: 'bzAce', skill: 0.85, seconds: 28,
        note: 'You fly on flat out with him diving in behind. At 230 m you break hard away for 0.7 s, he overshoots about 40 m off, and you pull up after his zoom.',
        verdict: { works: 0, of: 9, line: 'The break spoils his burst (not one round lands in nine) and you sit in his rear quarter for 1.3 to 2 s, but out of the dive he is about 30 m/s faster and zooming at 35 degrees: in nine tries your nose never gets onto his lead before he is out of reach.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: meet every dive', seat: 'meetTheDive', ace: 'bzAce', skill: 0.85, seconds: 55,
        note: 'You turn to face every dive, flat, and never chase his zoom: each dive becomes a head-on pass he breaks off without firing.',
        verdict: { works: 0, of: 9, line: 'Half of it: in all nine his guns are never on you and he never hits you, but he never sits in front of your guns either (passes 62 to 161 m apart), so you never get a shot of your own.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, by leaving: meet his first dive head on, then run out of the pass flat out and low. He follows for a minute, never gets inside 416 m, and gives up a chase he cannot win (9 of 9). You cannot turn his pass round or get a shot of your own.' },
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
      // The three below fly against `uhAce`: the same boom-and-zoomer, who
      // also chases a runner and turns to face a dive on him.
      { id: 'dip', kind: 'dip', label: 'The Dip: spend his height, then run', seat: 'uhDip', ace: 'uhAce', skill: 0.85, seconds: 80,
        note: 'Running at once, he dives after you and catches you. So climb between his dives and break each one; once his height is spent and you have 100 m of energy on him, about 55 s in, run straight away from him, flat out, the nose 2 degrees down.',
        verdict: { works: 9, of: 9, line: 'In all nine you break three dives, are never hit, start the run 53 to 57 s in from 470 to 530 m away, and he chases but cannot close: 10 to 11 s into the run he lets you go and climbs away, and at 80 s you are 1.9 to 2.7 km apart and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: break, then up after his zoom', seat: 'uhFlip', ace: 'uhAce', skill: 0.85, seconds: 32,
        note: 'You break his first dive; the moment he has gone past, 110 to 120 m away, you pull up after him to shoot him in the zoom.',
        verdict: { works: 0, of: 9, line: 'It never works: he goes past at 71 to 74 m/s to your 42 and zooms away, your nose never gets onto his lead, and within 8 s you hang at 14 to 15 m/s under him with no shot, hit twice in one of the nine as he comes back over the top.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: take the height back, then his tail', seat: 'uhNinja', ace: 'uhAce', skill: 0.85, seconds: 85,
        note: 'Climb between his dives and break each one, so his guns are never on you. Once the energy is yours and he is flying away from you, go in behind him and close to 220 m. In the fight shown (the middle start) he chases you instead of flying away, so you finish high above him instead.',
        verdict: { works: 6, of: 9, line: 'Partly: in all nine his guns are never on you and you climb 420 to 570 m; in six you sit in his rear quarter for 6.7 to 9.1 s, though chasing him costs you the height and your guns land at most 0.4 s; in three you finish 280 to 310 m above him but never get in behind him.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, but not at once: break every dive and climb between them, and after about 55 s his height is spent and yours is won; then you can run and get clear (9 of 9) or go in behind him (6 of 9). Running before that, or turning on him as he zooms, does not work.' },
    seconds: 55,
    coach: {
      chase: { line: 'You ran, and he is coming after you', tip: 'He has the height to catch you: turn back, break when he commits, and climb between his dives.', keys: ['Mouse', 'Arrows'] },
      meet: { line: 'You are diving on him and he is turning to face you', tip: 'Do not take a head-on pass: pull up and keep the height.', keys: ['Mouse'] },
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
      { id: 'dip', kind: 'dip', label: 'The Dip: past him, then run', seat: 'uoDip', ace: 'uoAce', skill: 0.7, seconds: 35,
        note: 'You climb after him at 30 degrees, never into his climb. As he goes over the top you fly past him, beside and under his dive, then full throttle straight away: his half loop has pointed him back the way he came, and he has to turn round, slow, to chase you.',
        verdict: { works: 9, of: 9, line: 'Never hit in all nine: he dives after you but cannot close, and 21 to 29 s in, 730 to 1300 m behind, he gives the chase up; at 35 s you are 1566 to 1765 m apart and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: shoot him as he hangs', seat: 'uoFlip', ace: 'uoAce', skill: 0.7, seconds: 24,
        note: 'You stay the chaser: climb after him at 25 degrees, nose under him, shoot as he hangs slow at the top, then fly past beside and under his dive instead of into it, and round onto him again when he zooms.',
        verdict: { works: 6, of: 9, line: 'In six starts you sit in his rear quarter, nose on him, and have the shot as he hangs for 1.0 to 1.3 s, landing 7 to 19; from the three starts 30 m to the left he is 245 to 270 m off at the top, past your guns, and you get no shot. His guns land on you for 0.13 s at most, never a hit.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: shallow, never in his sights', seat: 'uoNinja', ace: 'uoAce', skill: 0.7, seconds: 40,
        note: 'The Flip flown on: never follow him up, never fly into his dive. Every pull up gets the same answer, a 25 degree climb, the shot if he is in reach, and a pass beside his dive.',
        verdict: { works: 9, of: 9, line: 'In all nine his guns are on you for 0.13 s at most and never hit you in 40 s; you land 7 to 19 in six of them and 0 to 2 in the three starts 30 m to the left, and the closest he comes is 17 m.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, if you never follow him up: climb after him at 25 degrees, shoot as he hangs and fly past his dive, and he never hits you (9 of 9); or climb at 30, pass him over the top and run (clear in 9 of 9).' },
    seconds: 45,
    coach: {
      run: { line: 'He is running fast and level', tip: 'He is faster than you. Stay behind him and watch for the pull up.', keys: ['W'] },
      chase: { line: 'He is diving after you', tip: 'Full throttle, nose a little down, straight away from him: as fast as you, he cannot close and soon gives up.', keys: ['W', 'Mouse'] },
      pull: { line: 'He is pulling nearly straight up', tip: 'Do not follow him up. Climb after him at 25 degrees, nose under him, full throttle.', keys: ['Mouse', 'Arrows', 'W'] },
      over: { line: 'He is going over the top', tip: 'He is slow up there. Raise the nose onto him and shoot as he hangs.', keys: ['Mouse', 'Space'] },
      pounce: { line: 'He is coming back down at you', tip: 'Do not climb into him: nose down, keep your speed, let him go past.', keys: ['Mouse', 'W'] },
      zoom: { line: 'He is zooming back up', tip: 'Follow shallow again. Stay fast.', keys: ['W'] },
    },
  },
  {
    id: 'out-of-the-lock',
    title: 'Out of his lock: breaking the tail',
    tagline: 'He is on your tail. Turning hard keeps you alive; diving does not shake him, and running after a head-on pass gets you away only when he falls out of reach and gives up. Turn into him while he is still far back and he gets no shot, or let him in close in your turn and chop: he flies past and you get a burst. Against an ace who turns back, neither makes you the hunter.',
    story: [
      'The best pilots get behind you and stay there. The hunter closes at full throttle, eases off as he gets in, and holds his fire until he is inside 150 m, where a burst counts. That is the lock.',
      'Flying straight under it is death: shot down every time, about 15 to 20 s in. Diving away does not shake him: he dives with you, sits about 140 m behind you all the way down, his nose on you, and when you pull out he closes in and lands 7 to 20 hits.',
      'Turning hard does not shake him either. In BF1942 a Spitfire turning hard flies a circle about 120 m across, and a faster one turns faster, not wider, so he follows you round 40 to 100 m behind. His nose cannot come onto you, so he lands nothing, but he is still on your tail: the turn buys time, nothing more.',
    ],
    counterStory: [
      'Two things break the tail. The first is to see him early. While he is still about 400 m back, turn as hard as it turns, into him, and keep turning until your nose is on him. From that far he cannot follow you round inside a 120 m circle: the chase becomes a head-on pass. Pass over him, turn into him again, and you are even, nobody on anybody\'s tail.',
      'The second is the chop, once he is in close. Fly on until he is committed behind you, inside 180 m and closing, and turn hard. He follows you in and slides up close behind you in the circle. Inside about 90 m and still closing, hold S and pull up through the turn: you go up and slow to about 26 m/s, his throttle takes seconds to bite, and he flies through underneath you and out in front.',
      'Now he is the one with a man on his tail. He runs, full throttle, and he is faster than you: point the nose at him and shoot in the first seconds, before he is out of reach.',
      'Flown nine times from slightly different starts: flying straight was shot down every time; diving away took 7 to 20 hits; turning hard took none and landed none, with him following you round the whole time; turning into him early took none, his lock gone 2 s into the turn and the chase a head-on pass; turning and chopping took none, made him fly past every time, put him in front of you for about 13 s as he ran, and landed 1 to 10 hits.',
      'That hunter runs straight on after he flies past, whatever you do. A sharper one runs only while your nose is on him, breaks if your sight comes on, and turns back on you the moment it is off. Like every ace in the school, he gives up a chase he cannot win: out of his guns\' reach and not closing for 6 s. Running after a head-on pass got you away in 5 of 9: he turned round and followed, fell back past 300 m, and gave up at 46 to 54 s; in the other 4 he held 230 to 275 m behind you, inside his reach, and never let go. Nothing made you the hunter or took the fight over. The chop made him fly past 14 to 18 m under you every time, and you landed 21 hits in nine fights, but your guns had him for half a second at most. Meeting him head-on every time, from 800 m out, gave him no shot at all in nine fights, and you none either.',
    ],
    survival: { verdict: 'partly', line: 'Partly: turning hard he lands nothing, and turning into him early he never gets a shot; turn into him, pass head-on and run, and in 5 of 9 he falls out of reach and gives up the chase, but nothing makes you the hunter against a hunter who turns back.' },
    ace: { plan: 'hunter', start: { at: [50, 375, 230], headingDeg: -20, speed: 62 } },
    you: { start: { at: [0, 350, 0], headingDeg: 0, speed: 55 } },
    demos: [
      { id: 'without', label: 'You fly straight', seat: 'cruiser', skill: 0.85,
        note: 'He closes in behind you and you hold your heading.' },
      { id: 'flat', label: 'You turn hard', seat: 'lockHardTurn', skill: 0.85,
        note: 'As hard as it turns, holding your height: he cannot hit you, but he follows you round and stays on your tail.' },
      { id: 'counter', label: 'You turn, then chop', seat: 'lockChop', skill: 0.85,
        note: 'Turn hard; when he slides in close behind you in the circle, throttle back and pull up. He flies past, and you go after him. This hunter runs straight on after flying past; the Flip flies the chop against one who turns back.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: turn in, then run', seat: 'olDip', skill: 0.85,
        ace: 'olHunter', aceStart: { at: [80, 380, 480], headingDeg: -10, speed: 62 }, seconds: 62,
        note: 'Seen 400 m back: turn into him, pass over him head-on, and run the way the pass points you, full throttle, nose a little down. He turns round and follows in the same aeroplane; if he ends up out of his guns\' reach and not closing, he gives up a chase he cannot win.',
        verdict: { works: 5, of: 9, line: 'Out in 5 of 9: there he followed more than 300 m back, not closing, gave the chase up at 46 to 54 s, and you were 1000 to 2100 m clear; in the other 4 he stayed 230 to 275 m behind you, inside his reach, and in one he closed and landed 6 hits.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: chop and pull up', seat: 'olFlip', skill: 0.85, ace: 'olHunter', seconds: 40,
        note: 'Turn hard; inside 90 m and closing, throttle back; inside 60 m, pull up 30 degrees through the turn. He flies past underneath, and you go after him, against a hunter who turns back once your nose is off him.',
        verdict: { works: 1, of: 9, line: 'He flew past 14 to 18 m under you in all nine and never hit you, and you landed 21 hits in all, but your guns had him for half a second at most: the 2 s on his tail with a burst that makes you the hunter came in only one of the nine.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: meet him every time', seat: 'olNinja', skill: 0.85,
        ace: 'olHunter', aceStart: { at: [80, 380, 900], headingDeg: -5, speed: 62 }, seconds: 45,
        note: 'Seen 800 m back: turn into him at once and meet him nose on; start your turn 200 m before the pass, and meet him again each time he comes round. He never gets a shot, but neither do you.',
        verdict: { works: 0, of: 9, line: 'He had no shot at all in nine fights and nobody was hit, but you never got your guns on him or sat behind him for even half a second.' } },
    ],
    seconds: 45,
    coach: {
      hunt: { line: 'He is closing on your tail', tip: 'Still far back? Turn hard into him now and meet him head-on. Already close? Turn hard once he is inside 200 m.', keys: ['Mouse', 'Arrows'] },
      track: { line: 'He is on your tail, closing to fire', tip: 'TURN HARD now: roll and pull as far as it goes. He opens fire at 150 m.', keys: ['Mouse', 'Arrows'] },
      lag: { line: 'He followed you into your turn', tip: 'Keep turning hard and hold your height. When he is inside 90 m, hold S and pull up: he flies past underneath.', keys: ['Mouse', 'S'] },
      follow: { line: 'He is following you up, shallow', tip: 'Do not hang at the top: tip over and turn before you are slow.', keys: ['Mouse'] },
      extend: { line: 'He flew past and is running', tip: 'Nose on him and shoot now: he is faster and getting away. Then W.', keys: ['Space', 'W'] },
      headon: { line: 'He is coming at you head-on: the tail is broken', tip: 'Pass over him, not through him, then turn hard into him again.', keys: ['Mouse', 'Arrows'] },
      evade: { line: 'He is breaking away from your guns', tip: 'Let him go and get your speed back: W.', keys: ['W'] },
    },
  },
  {
    id: 'on-his-tail',
    title: 'On his tail: staying there',
    tagline: 'You are behind him and he breaks. While he turns you get no shot, and a good pilot keeps turning: stay out of his circle, and leave it when he is across it going away.',
    story: [
      'You get in behind him, full throttle, nose on him. He sees you and breaks: turns as hard as it goes, into you.',
      'In BF1942 a faster Spitfire turns faster, not wider, so rushing in does not fly you through his circle: you come past his tail about 35 m behind him and then sit 50 m behind him in his turn. But you cannot pull the lead on a Spitfire turning hard: about 3 hits a fight, all as he breaks, and nobody comes down.',
      'Worse, a good pilot chops his throttle and pulls up when you sit close behind him in his turn. You fly through underneath him and out in front, and he turns onto you.',
    ],
    counterStory: [
      'Do not sit in his circle. A Spitfire turning hard at 40 m/s turns 39 degrees a second, faster than any lead you can pull on him, from behind, from above or from out wide.',
      'Stay out of it and he cannot hurt you either. When he breaks 300 m in front of you, turn the same way, as hard, where you are: your circle and his go round side by side, 250 to 300 m apart, and neither of you has the other inside his guns. Never follow him in to 150 m.',
      'If he thinks he has shaken you off and rolls out, you are 250 m behind him at his speed: nose on him and guns. A good pilot does not roll out while you are near him. Then leave: when he is across the circle going the other way, wings level, full throttle, a shallow dive. He has half a circle to fly before his nose is on you, gets in behind you about 300 m back, out of his reach, and cannot gain on you.',
      'Flown nine times from slightly different starts: rushing in landed about 3 hits a fight and brought nobody down. Against the pilot who chops: sitting close behind him in his turn, you flew past underneath him every time, ran for it, and took 2 to 7 hits; turning with him 250 m out, you took at most one and shot him down seven times in nine after he rolled out. Against the one who never rolls out, leaving across his circle got you clear, unhit, nine times in nine.',
    ],
    ace: { plan: 'otBreaker', start: { at: [0, 300, -500], headingDeg: 0, speed: 52 } },
    you: { start: { at: [0, 320, 0], headingDeg: 0, speed: 72 } },
    demos: [
      { id: 'move', label: 'You rush in', ace: 'breakTurn', seat: 'chaser', skill: 0.9,
        note: 'Full throttle, nose on him. He breaks 300 m out; you come past his tail and end up 50 m behind him in his turn, with no lead.' },
      { id: 'close', label: 'He chops, you sit close', ace: 'chopper', seat: 'hunter', skill: 0.9,
        aceStart: { at: [0, 350, -300], headingDeg: 0, speed: 55 }, youStart: { at: [80, 380, 0], headingDeg: -20, speed: 62 },
        note: 'A pilot who chops his throttle, and you following him into his turn.' },
      { id: 'lag', label: 'He chops, you lag back', ace: 'chopper', seat: 'lagBack', skill: 0.9,
        aceMemory: { breakAt: 300, rollOut: true }, youStart: { at: [0, 310, -180], headingDeg: 0, speed: 56 },
        note: 'The same pilot, breaking at 300 m this time, and you 250 m back at his speed, staying out of his circle.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: leave as he turns away', seat: 'otDip', ace: 'otBreaker', skill: 0.85, seconds: 40,
        note: 'In his circle after him for a turn and more, going nowhere. When he is across the circle going the other way you roll out, full throttle, a shallow dive: he has half a circle to fly before his nose is on you.',
        verdict: { works: 9, of: 9, line: 'In all nine he got in behind you 276 to 329 m back, outside his guns, never closed, and gave up 21 to 23 s in, turning away; at 40 s you were 2150 to 2449 m apart and never hit.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: the high yo-yo', seat: 'otYoyo', ace: 'otBreaker', skill: 0.85, seconds: 30,
        note: 'The best try at turning it round: up out of his circle onto a perch 100 m over his turn, down on him whenever you are over him and behind him, up again before you fly past. It keeps you safe; it does not give you the shot.',
        verdict: { works: 0, of: 9, line: 'In all nine you were never hit, and your guns never had him at all: he turns 39 degrees a second and the dive turns you no tighter. A vertical reversal and letting him reverse onto you, then chopping, did no better (0 of 9).' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: stay out wide', seat: 'otOutWide', ace: 'otBreaker', skill: 0.85, seconds: 40,
        note: 'The best try at never giving him a chance: arrive at his speed and, when he breaks, turn the same way 250 to 300 m out, never into his circle. His guns are almost never on you, and yours are almost never on him.',
        verdict: { works: 0, of: 9, line: 'In all nine his guns had you for a tenth of a second at most and he never hit you, but you were never in his rear quarter and your guns had him for 0.13 s at most (2 rounds landed, in two of the nine). Arriving slow, a yo-yo at his break and a dive from 300 m above did no better (0 of 9).' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, by leaving: nothing flown gets a shot on a Spitfire that keeps breaking (a yo-yo, a vertical reversal, a chop, out wide: 0 of 9), but leaving his circle when he is across it going away gets you clear and unhit in 9 of 9.' },
    seconds: 60,
    coach: {
      watch: { line: 'He has not broken yet', tip: 'Ease the throttle (S): arrive at his speed. When he breaks, do not follow him into his turn.', keys: ['S'] },
      break: { line: 'He broke into you', tip: 'Do not follow him in: you will get no lead on him in his turn. Turn the same way out here, 250 m off, and leave when he is across the circle going away.', keys: ['Mouse', 'Arrows'] },
      chop: { line: 'He chopped his throttle and pulled up: you are closing fast', tip: 'Pull up and out of his turn now, or you fly through underneath him.', keys: ['Mouse', 'S'] },
      reverse: { line: 'He is turning onto you', tip: 'Close behind you: break turn hard into him. 300 m back and you going away: wings level, full throttle (W).', keys: ['Mouse', 'Arrows', 'W'] },
      chase: { line: 'He is chasing you, 400 m back or more', tip: 'Wings level, full throttle (W): he is no faster than you and cannot gain.', keys: ['W'] },
      letgo: { line: 'He gave up the chase: he is turning away and climbing', tip: 'Keep going. Turn back at him and he turns to meet you.', keys: ['W'] },
      meet: { line: 'You turned back: he is turning to meet you head-on', tip: 'Pass over him, not through him, and keep going: he will not let you behind him.', keys: ['Mouse', 'W'] },
      extend: { line: 'He flew past you and is running', tip: 'Nose on him and shoot now if he is close: he is faster than you and getting away.', keys: ['Space', 'Mouse'] },
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
      'The break saves you, but it leaves you both in a circle neither of you wins. Against a good attacker you cannot simply leave it: roll out and run, turn away and run, or split-S away, and he follows you, never more than 330 m back, with his sights on you. The way out is up: break early, at 360 m, hold your height, and when he sits close behind you in the circle, zoom straight up out of it. He follows shallow and slows; in about half the starts you come down behind him without his guns ever having had you. Even then the shot is rare. But it is your door out: once he has fallen away in front of you going the other way, run, and he follows, cannot close, and gives up a chase he cannot win.',
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
      { id: 'move', label: 'He breaks', seat: 'chaser', skill: 0.55, seconds: 22,
        note: 'He waits until you are 300 m back, then turns hard into you. You come past his tail; he reverses into you. From here it is a circle nobody wins: the three fights after this one are the ways out of it.' },
      { id: 'counter', label: 'You stay patient', seat: 'patientAttacker', skill: 0.85, seconds: 16,
        note: 'As he breaks you lift out of his turn and stay above it, instead of chasing him into it.' },
      // The three ways out, flown by the pilot who broke (you) against the
      // school's hunter (`btHunter`), who holds his height in the circle,
      // follows a climb shallow, turns back after anyone who runs, and gives
      // up a chase he cannot win (past his reach, not closing, for 6 s).
      { id: 'dip', kind: 'dip', label: 'The Dip: up, then away', seat: 'btDip', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        youMemory: { breakAt: 360 }, seconds: 60,
        note: 'Run while he sits behind you and he follows with his sights on you. So break, and when he sits close behind you in the circle, zoom straight up out of it; once he has followed, slowed and fallen away in front of you, going the other way, run. He turns after you, cannot close, and gives up the chase.',
        verdict: { works: 7, of: 9, line: 'In 7 of 9 none of his rounds lands once you run, he gives up the chase he cannot win 37 to 52 s in, and at 60 s you are 1.2 to 3 km apart; in the other two he is still 305 and 379 m behind you at the end (one ran only at 50 s), and in one his sights were on you for 3.6 s.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: up out of the circle', seat: 'btFlip', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        youMemory: { breakAt: 360 }, seconds: 50,
        note: 'Break at 360 m and hold your height in the circle. With him dead astern inside 120 m, zoom straight up at full throttle; he follows shallow and slows, and you come over and down behind him. Then the shot, if he gives you one.',
        verdict: { works: 1, of: 9, line: 'You get behind him but not the shot: in 7 of 9 you sit in his rear quarter for 3.3 to 9.4 s, but only 17 to 27 s after the zoom, and he breaks the moment you are there, so your guns have him for half a second in 1 of 9; he hit you in one.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: break early, then up', seat: 'btNinja', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        youMemory: { breakAt: 360 }, seconds: 45,
        note: 'Break at 360 m, before his sight is on you (break at 300 m and his guns still have you for 1.2 s while your wings roll over), hold your height in the circle, and zoom out of it the moment he sits close behind: he follows you up, slows, and you come down onto his tail.',
        verdict: { works: 5, of: 9, line: 'In 5 of 9 his guns never have you and you sit in his rear quarter for 3.8 to 9.4 s; in the others you are behind him only 0.3 to 2.2 s, or he catches you hanging at the top of the zoom (0.9 s, 4 hits), or he sits close enough to zoom from only 36 s in.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, by leaving: break early (360 m), hold your height, and zoom out of the circle when he sits close behind; once he has followed you up and fallen away in front, going the other way, run, and he gives up a chase he cannot win (7 of 9). Getting behind him without his guns ever having had you works in 5 of 9; the shot from there, 1 of 9.' },
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
      'Every crossing is a race to be slowest along that line. The faster one drifts forward a little each time, and the slower one gets his nose onto him as they cross: snap shots, a fraction of a second each, never a steady seat on his tail.',
      'In BF1942 the throttle is a brake: hold S and the propeller drags you back, but it takes 3 to 4 seconds to bite. Below 30 m/s a Spitfire barely turns, so slow does not mean as slow as possible: the ace here sits at about 40 m/s, the other pilot at full throttle a little faster, and that is enough.',
    ],
    counterStory: [
      'Throttle back early, reverse every time he crosses, and keep your nose on the horizon: roll from bank to bank without letting the nose fall, or each reversal costs height you never get back.',
      'Do not shoot as you cross him head-on: that is a split second. Wait until he has drifted out in front and your nose comes onto his tail.',
      'If you are the one drifting in front, you have the speed he gave away: use it to leave at a crossing, or, before it starts, to go up out of his plane and come down behind him. Flown nine times, nobody in a flat scissors ever sat in the other\'s rear quarter; the shots are snap shots of a fifth to two fifths of a second.',
    ],
    // The pilot in trouble is you: at full throttle you drift out in front
    // of him at every crossing, and he gets the snap shots.
    survival: { verdict: 'yes', line: 'Yes: leave at the second crossing without reversing, at full throttle, and he never catches you (9 of 9); going up before it starts keeps you out of his guns too, but nothing flown turns the scissors into a kill.' },
    // The overshoot that starts it: you came in too fast and are sliding
    // past him, side by side on his heading, 120 m out.
    ace: { plan: 'scissors', start: { at: [60, 300, 0], headingDeg: 0, speed: 44 } },
    you: { start: { at: [-60, 300, -15], headingDeg: 0, speed: 52 }, memory: { fast: true } },
    demos: [
      { id: 'move', label: 'Scissoring', seat: 'scissors', skill: 0.55,
        note: 'You scissor too, but at full throttle.' },
      // The three below fly against `scAce`, the scissors flown to win: he
      // chases a pilot who leaves, gives up a chase he cannot close, turns to
      // face a pilot who comes back, and breaks into one on his tail.
      { id: 'dip', kind: 'dip', label: 'The Dip: out at a crossing', seat: 'scDip', skill: 0.85, ace: 'scAce', seconds: 35,
        note: 'Two crossings in, at the second you do not reverse: hold the heading the crossing left you on, pointing away from him while he turns the other way, full throttle, a shallow dive.',
        verdict: { works: 9, of: 9, line: 'Out 8 s in, every time: he turns after you some 5 s behind, comes no nearer than 150-165 m once the crossing is past and never has a shot, gives up 7-10 s later 300 m back, and you are 900 m clear at 24-25 s, never hit.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: up at the crossing', seat: 'scFlip', skill: 0.85, ace: 'scAce', seconds: 30,
        note: 'At the first crossing you pull up 75 degrees out of his plane, throttle back, let him slide out in front, then come down behind him.',
        verdict: { works: 0, of: 9, line: 'It does not turn the fight: you get behind him for 2 s in 3 of 9 (2 inside 20 s), but he breaks into you every time and your shot never lasts more than 0.2 s. The throttle chop, a 30-70 degree yo-yo and running out to come back did no better (0 or 1 of 9).' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: up before it starts', seat: 'scNinja', skill: 0.85, ace: 'scAce', seconds: 30,
        note: 'You never fly the scissors: at the overshoot you spend your extra speed going up 65 degrees, throttle back, and hang above him while he slides out in front, then come down into his rear quarter.',
        verdict: { works: 7, of: 9, line: 'He never has a shot in any of the nine: you hang 100-120 m above him at 12 m/s (a hanging target for anyone else), then, back above 35 m/s, sit in his rear quarter as he breaks for 3 s or more in 6 of 9 (2.5-4.1 s in all), with a 0.6 s shot in one more; your shot is 0-0.6 s: the upper hand, not a kill. Pull up 60 degrees instead of 65 and it holds in only 4 of 9.' } },
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
      'A split-S ends low: he has given you his height on top of yours. Let him go and he runs off at 70 m/s and nobody fires. Go down on him the moment he rolls over, straight at where he will come out, not through his half loop after him: a Spitfire\'s dive gains speed slowly, so a dive started after he is out never catches him. Close on his run from behind and above, then zoom back up. Against a pilot who breaks the moment he sees you on his tail, that keeps you behind him and out of his guns every time, but the shot is a snap as he comes out of the half loop: under half a second in all nine.',
      'And if you want out: when he Immelmanns back at you after a head-on pass, turn back under his loop the moment he is past and going up, and run the way he came. He comes over the top slow and facing the wrong way, and an equal Spitfire that has to turn round at 40 m/s never catches you. Flying straight on at full throttle gets you out too: he follows 450 m back, no faster than you, and lets you go; turning back puts him furthest behind.',
    ],
    survival: { verdict: 'yes', line: 'Yes: turn back under his Immelmann and run, and he never catches you (9 of 9); meet a split-S from above and dive on him at once, and he never gets a shot at you (9 of 9). Getting onto his tail with a shot that lands works only partly (3 of 9).' },
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
      // The Dip, the Flip and the Ninja (reviews/dfn-ta.md): you in trouble,
      // against an ace who chases a runner he can catch and breaks when you
      // get on his tail (`taAce`).
      { id: 'dip', kind: 'dip', label: 'The Dip: back under his loop', seat: 'taDip', skill: 0.85, ace: 'taAce', seconds: 32,
        aceStart: { at: [80, 295, -800], headingDeg: 180, speed: 74 }, youStart: { at: [0, 300, 0], headingDeg: 0, speed: 56 },
        note: 'Head on, he 18 m/s faster. The moment he is past and pulling up, turn back flat at 60 degrees of bank and run under his loop the way he came, full throttle. He comes over the top at 37 m/s facing the wrong way and has to turn round.',
        verdict: { works: 9, of: 9, line: 'In all nine he never fired: he came over the top 200 to 255 m from you facing away, chased, was 570 to 600 m behind and not closing at 19 to 20 s, turned away, and you were 1730 to 1780 m apart at 32 s. Running straight on or a split-S out also got you clear in all nine.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: down after his split-S', seat: 'taFlip', skill: 0.85, ace: 'taAce', seconds: 22,
        aceStart: { at: [40, 460, -760], headingDeg: 180, speed: 45 }, youStart: { at: [0, 600, 0], headingDeg: 0, speed: 52 },
        note: 'He is high and slow, you 140 m higher and coming at him. As he rolls over, dive after him onto his run and sit behind him, closing slowly: the shot is as he comes out of his half loop, before he can break.',
        verdict: { works: 3, of: 9, line: 'Partly: in all nine you were on his tail with your nose on him for 3.9 to 6.1 s and he never fired, but he breaks the moment he is out, and the fire that would land was 0 to 0.73 s, half a second in only three. Going up behind his Immelmann put you on his tail with no shot at all; turning and chopping as he came down got you hit.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: from above, down at once', seat: 'turnaroundsBoom', skill: 0.85, ace: 'taAce', seconds: 24,
        aceStart: { at: [40, 460, -760], headingDeg: 180, speed: 45 }, youStart: { at: [0, 600, 0], headingDeg: 0, speed: 52 },
        note: 'Meet him from above, not level. High and slow, he split-Ses away; dive on him the moment he rolls over, close on his run from behind and above, and zoom back up before he can turn on you.',
        verdict: { works: 9, of: 9, line: 'In all nine his guns were never on you: you sat in his rear quarter inside 400 m for 3.9 to 4.3 s and never came closer than 50 m. Your fire was a snap, 0 to 0.43 s, since he breaks as soon as he is out. Meeting his Immelmann at the top instead held in 2 or 3 of nine: you pass him close and he fires back.' } },
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
      chase: { line: 'He is after you, his height into speed', tip: 'Full throttle and keep going: once his height is spent he gains nothing on you.', keys: ['W'] },
      'let-go': { line: 'He has let you go', tip: 'You are out of the fight. Climb, and come back with the height.', keys: ['W'] },
      meet: { line: 'You turned back at him: he is turning to face you', tip: 'Do not meet him level and slow. Keep going, or come back with the height.', keys: ['W'] },
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
