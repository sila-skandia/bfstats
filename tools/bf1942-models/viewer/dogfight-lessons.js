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
      'Every dive he wastes costs him height: his two dives start 400 and 190 to 240 m above you, and after the second he has to climb back up beside you. Flown nine times from slightly different starts, the pilot who never looked up was shot down every time, in two or three passes. The one who met each dive was not hit once.',
    ],
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'bzAce',
    ace: { plan: 'boomAndZoom', start: { at: [-350, 680, 300], headingDeg: 0, speed: 58 }, memory: { phase: 'perch' } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'move', label: 'He bounces you', seat: 'unaware', skill: 0.55,
        note: 'You fly straight and never look up.' },
      { id: 'counter', label: 'You meet the dive', seat: 'meetTheDive', skill: 0.85,
        note: 'You turn to face every dive and never chase his zoom.' },
      // The three moves fly against `bzAceMeet`: the lesson's ace, who also
      // meets a dive he sees coming once his height is gone.
      { id: 'dip', kind: 'dip', label: 'The Dip: meet him, then run', seat: 'bzDip', ace: 'bzAceMeet', skill: 0.85, seconds: 90,
        note: 'You meet his first dive head on, then run out of the pass the way it left you while his zoom takes him the other way: full throttle, the nose 6 degrees down to 150 m, then level there at about 72 m/s. Keep running: he follows for over a minute.',
        verdict: { works: 9, of: 9, line: 'In all nine he dives after you but from 15 s on never gets within 732 m or hits you; in four he gives up a chase he cannot win at about 80 s and climbs away, and at 90 s you are 1.1 to 1.9 km apart and opening.' } },
      // The Flip and the Ninja open where they start to matter: about 36 s
      // into the lesson's fight, after two met dives, his height spent, both
      // climbing at about 470 m, 520 m apart, the energy even.
      { id: 'flip', kind: 'flip', label: 'The Flip: in behind him once his height is spent', seat: 'bzFlip', ace: 'bzAceMeet', skill: 0.85, seconds: 22,
        aceStart: { at: [-517, 449, -45], headingDeg: 165, pitchDeg: 19, speed: 58 }, aceMemory: { phase: 'climb' },
        youStart: { at: [0, 476, 0], headingDeg: -150, pitchDeg: 16, speed: 52 }, youMemory: { phase: 'climb' },
        note: 'This opens after you have met his two dives: his height is spent and you are level, climbing. His pass could not be turned round (out of the dive he is 30 m/s faster); now, when he turns his nose away, in behind him with the lead, and if the guns do not bear in 3 to 5 s, up and away, never round after him.',
        verdict: { works: 0, of: 9, line: 'In all nine he turns to face you and passes under you; 9 to 10 s in, his nose away, you turn in after him, but at even energy your nose never comes onto him: not a moment in his rear quarter, no landing shot. You leave 3 s later and at 22 s you are 0.8 to 1 km apart; he never has a shot at you.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: one pass from above, then away', seat: 'bzNinja', ace: 'bzAceMeet', skill: 0.85, seconds: 25,
        aceStart: { at: [-517, 449, -45], headingDeg: 165, pitchDeg: 19, speed: 58 }, aceMemory: { phase: 'climb' },
        youStart: { at: [0, 476, 0], headingDeg: -150, pitchDeg: 16, speed: 52 }, youMemory: { phase: 'climb' },
        note: 'This opens after you have met his two dives: his height is spent and you are level, climbing. Climb with him until you are 35 m over him, turn toward him, and make one pass down on him with the lead. If he meets it or there is no shot, run out on the dive\'s speed: never round and round with him at even energy.',
        verdict: { works: 0, of: 9, line: 'In all nine you get over him and dive at 7 to 9 s, but he turns to face you (in six he is still turning into the dive as it ends) and no shot ever bears; you run, and at 25 s you are 0.9 to 1.2 km apart. His guns never bear on you either.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, by leaving: meet his first dive head on, then run out of the pass at full throttle, level at 150 m. He follows for over a minute, never within 732 m once you are running, and gives up or falls a kilometre behind (9 of 9). You cannot turn his pass round, and once his height is spent he meets your dives as you met his (0 of 9 each).' },
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
      'The moment he has gone past, climb again. Every dive he wastes costs him height, and your climb adds to yours. Zooming away he loses sight of you, under his tail, and spends 11 to 12 s looking for you: in seven of nine fights he never gets above you again for a second dive; in two his second dive starts about 140 m above you, not 520, and he pulls out of it without a shot.',
      'Flown nine times from slightly different starts: climbing straight was shot down every time, in one pass. Turning flat was never hit, and finished at the height it started. Climbing between his dives was never hit either, and climbed 490 to 600 m: from 520 m under him to 70 to 330 m above him.',
    ],
    // He sits well back, so a straight line gives him the time to settle
    // behind it: his bursts here run up to 1.8 s, opened at 300 m.
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'uhAce',
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
      { id: 'dip', kind: 'dip', label: 'The Dip: spend his height, then run', seat: 'uhDip', ace: 'uhAce', skill: 0.85, seconds: 70,
        note: 'Running at once, he dives after you and catches you. So climb between his dives and break his dive and his chase; once his height is spent and you have 50 m of energy on him, about 40 s in, and his nose is well off you (or he is past 600 m), run straight away from him, flat out, the nose 2 degrees down. Never run down his nose line.',
        verdict: { works: 9, of: 9, line: 'In all nine you break his dive and his chase (one to three breaks), his guns never fire and he is never on your tail; you start the run 30 to 45 s in, he follows but cannot close, 6 to 20 s into the run he lets you go and climbs away, and at 70 s you are 1.5 to 3.2 km apart and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: break his chase, reverse onto him', seat: 'uhFlip', ace: 'uhAce', skill: 0.85, seconds: 60,
        note: 'You break his first dive and climb. His dive has spent his height, so he comes after you level, from behind: break into him, and the moment he has gone past you, slow, reverse onto his tail with the lead. Then stay on top: climb, and once the energy is yours come down on him from above.',
        verdict: { works: 6, of: 9, line: 'Partly. In eight of nine you reverse onto him 32 to 45 s in and sit in his rear quarter 6 to 12 s later; his guns never fire and he never gets onto your tail. But only once does the reversal itself bring the shot: mostly the turn back slows you to 27 to 33 m/s and leaves you 300 to 330 m behind him, out of gun range, and the shot comes 8 to 14 s later from a dive from above. That dive lands enough in five (and shoots him down in two, the fight shown among them) and too little in two (0.2 and 0.47 s); in the ninth he never comes after you again after his first dive, so there is nothing to reverse on.' } },
      // Opens at 26 s, his chase coming in; the scrub bar reaches back to 0.
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: take the height back, then down on him', seat: 'uhNinja', ace: 'uhAce', skill: 0.85, seconds: 90, startAt: 26,
        note: 'Break his dive and his chase and climb between them, so his guns are never on you. Once the energy is yours (35 to 53 s in), you are the boom-and-zoomer: down on him from above with the lead, up and over before he can turn onto you. If a pass leaves you level with him and no shot, do not circle with him: leave. The fight shown is the one in nine where this holds: one dive and he is down.',
        verdict: { works: 1, of: 9, line: 'No. In all nine his guns never fire and he is never on your tail, and you win the height back; but holding it does not follow. Only in the fight shown does the dive finish him (down at 62.6 s). In four a dive lands a burst, but he is not shot down and the bursts do not keep coming (a second in only one of the four, 20 s or more near him without one in three); in four no dive lands at all. Level with him then, you leave rather than circle with him, and he lets you go.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, and you can turn it round, but not at once: break his dive, then his chase, and climb between them; about 40 s in his height is spent and the energy is yours. Then run and get clear (9 of 9), or reverse onto him as he goes past your break and stay on top (6 of 9). Holding the upper hand pass after pass does not follow (1 of 9): after one dive he is level with you again and the best you can do is leave. Running before that, or pulling up after his zoom, does not work.' },
    seconds: 55,
    coach: {
      chase: { line: 'He is coming after you from behind', tip: 'Do not climb on in front of him: when he is about 380 m out with his nose on you, break into him, hard. If he goes past you slow, reverse onto his tail.', keys: ['Mouse', 'Arrows'] },
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
      'From the same nine starts: at his slowest you were 15 to 18 m/s faster than him and 180 to 275 m away. You had the first hits in all nine and landed 12 a fight to his 0.6.',
    ],
    // FLY IT's ace on the trap and counter tabs: the lesson's, plus the
    // school's one give-up rule (README, "Can you survive it?"). The Dip, the
    // Flip and the Ninja meet `uoAceSharp`, who does not loop twice in front
    // of a man he can see.
    flyAce: 'uoAce',
    ace: { plan: 'upAndOver', start: { at: [25, 280, -280], headingDeg: 0, speed: 78 } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 50 } },
    demos: [
      { id: 'move', label: 'You follow him up', seat: 'followStraightUp', skill: 0.7,
        note: 'You pull up after him as steep as he goes.' },
      { id: 'counter', label: 'You follow shallow', seat: 'shallowFollow', skill: 0.7,
        note: 'You climb after him at 25 degrees, nose under him, and save your speed.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: past him, then run', seat: 'uoDip', ace: 'uoAceSharp', skill: 0.7, seconds: 35,
        note: 'You climb after him at 30 degrees, never into his climb. As he goes over the top you fly past him, beside and under his dive, then full throttle straight away. He does not loop again with you behind him: he breaks, and climbs away the way he came.',
        verdict: { works: 7, of: 9, line: 'In seven he breaks it off 12.1 to 12.6 s in, 35 to 100 m from you, and climbs away the way he came; at 35 s you are 2298 to 2555 m apart and opening, never hit. From 30 m to the left, 30 m closer and 3 m/s slower he hits you 5 times in his pounce as you pass; from 30 m to the right, 30 m further back and 3 m/s faster he chases you over the top, sits on your tail for 7.7 s and lets you go only at 33 s, 461 m back.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: from under him, after following him up', seat: 'uoFlip', ace: 'uoAceSharp', skill: 0.7, seconds: 45, endAt: 27,
        note: 'The hunted pilot: you followed him up, and at 42 m/s, nose high and 330 to 380 m behind him, he is going over the top with you under him. Push the nose down off his line, get the speed back, and round behind him. This is the best try found, and it does not work.',
        verdict: { works: 0, of: 9, line: 'It never works: the nose comes down slowly and you spend 2 to 5 s under 35 m/s inside 300 m of him; in none of the nine are you 2 s in his rear quarter with the shot, he hits you once or twice in three, and in seven he ends up turning to meet you. Once you have followed him up, he has the fight: do not follow him up.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: at his top, then in behind him unseen', seat: 'uoNinja', ace: 'uoAceSharp', skill: 0.7, seconds: 50,
        note: 'Never follow him up and never circle with him. Climb after him at 24 degrees and shoot as he slows over the top; push the nose down past his dive; slice round nose low under his tail. He breaks off and climbs away without seeing you: close in behind him and shoot from 150 to 200 m. When he sees you and turns in, leave rather than turn with him.',
        verdict: { works: 6, of: 9, line: 'Partly. In six you shoot him at the top of his loop at 7 s and again from behind him, unseen, at 16.6 to 17.3 s, and he never has a shot at you: in one he goes down at 19.7 s, in five he sees you at 136 to 185 m and turns in, and you leave rather than turn with him: 1256 to 1597 m apart, both flying away, when the 50 s run out. From 10 m lower, 30 m closer and 3 m/s slower your first burst is short, he turns to meet you and there is no second; 10 m higher, 30 m further back and 3 m/s faster your pass goes within 7 m of him; 30 m to the right, closer and faster you get one real burst.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, if you never follow him up: climb after him at 30 degrees, pass him over the top and run (clear in 7 of 9). Staying on top works partly: climb at 24, shoot as he slows over the top, push past his dive and get in behind him while he cannot see you (6 of 9, never hit; he goes down in one, in five you leave as he turns in). Once you have followed him up, nothing found gets you out on top.' },
    seconds: 45,
    coach: {
      run: { line: 'He is running fast and level', tip: 'He is faster than you. Stay behind him and watch for the pull up.', keys: ['W'] },
      chase: { line: 'He is diving after you', tip: 'Full throttle, nose a little down, straight away from him: as fast as you, he cannot close and soon gives up.', keys: ['W', 'Mouse'] },
      pull: { line: 'He is pulling nearly straight up', tip: 'Do not follow him up. Climb after him at 25 degrees, nose under him, full throttle.', keys: ['Mouse', 'Arrows', 'W'] },
      over: { line: 'He is going over the top', tip: 'He is slow up there. Raise the nose onto him and shoot as he hangs.', keys: ['Mouse', 'Space'] },
      pounce: { line: 'He is coming back down at you', tip: 'Off the shot now: push the nose down and let him go past beside you.', keys: ['Mouse', 'W'] },
      zoom: { line: 'He is zooming back up', tip: 'Slice round nose low under his tail, then follow shallow again: he slows over the top in front of you.', keys: ['Mouse', 'W'] },
    },
  },
  {
    id: 'out-of-the-lock',
    title: 'Out of his lock: breaking the tail',
    tagline: 'He is on your tail. Turning hard keeps you alive; flying straight or diving gets you shot down. Seen far back, turn into him, go under him and run on: he follows without closing, never fires, and gives up. The chop no longer makes him fly past: he slides under your tail, where you cannot see him. From under him you can come down on him once, but not stay on top.',
    story: [
      'The best pilots get behind you and stay there. The hunter closes at full throttle, eases off as he gets in, and holds his fire until he is inside 150 m, where a burst counts. That is the lock. Dead astern he sits in the one cone your headrest hides, so a pilot who knows he is coming keeps a gentle turn on, toward him, and has him over the shoulder until he is in.',
      'Flying straight under it is death: shot down every time, 12 to 19 s in. Diving away does not shake him: he dives with you, 120 to 145 m behind you all the way down, his nose on you, and when you pull out he closes in: shot down in 7 of 9, and 20 and 4 hits in the other two.',
      'Turning hard does not shake him either. In BF1942 a Spitfire turning hard flies a circle about 120 m across, and a faster one turns faster, not wider, so he follows you round, never closer than about 50 m. His nose cannot come onto you, so he lands nothing, but he is still on your tail: the turn buys time, nothing more.',
    ],
    counterStory: [
      'What breaks the tail is seeing him early. While he is still about 400 m back, turn as hard as it turns, into him, and keep turning until your nose is on him. From that far he cannot follow you round inside a 120 m circle: the chase becomes a head-on pass. Pass over him, turn into him again, and you are even, nobody on anybody\'s tail.',
      'Seen 900 m back you can get out altogether. Turn into him at once and aim 50 m under him and to his side: he goes over you about 25 m clear. Run on the heading the pass leaves you, full throttle, nose a little down. He has to turn all the way round after you, and by then you are at 63 to 74 m/s and going: he never closes. In some fights he has his guns on you as you meet, 270 to 350 m out, or 180 to 260 m behind you as he follows, but he holds his fire to 150 m, and he gives the chase up 28 to 31 s in.',
      'The chop no longer breaks the lock. It needs a fast man closing on you from dead astern, who cannot slow in time and flies through; dead astern is the one cone your headrest hides, and a man you keep in sight over your shoulder comes in off your tail line. When you chop he is 53 to 56 m back, about 45 degrees off your tail and only about 7 m/s faster: no closing speed to fly past on. He slides under your tail, where you cannot see him, and stays behind you.',
      'Flown nine times from slightly different starts: flying straight was shot down every time, 12 to 19 s in; diving away was shot down in 7 of 9; turning hard took no hit and landed none, with him following you round the whole time; turning into him early took none, his lock gone within 3 s and the chase a head-on pass; the chop took one hit in nine fights and landed none, and he never flew past.',
      'The Dip, the Flip and the Ninja meet a sharper hunter: he runs only while your nose is on him, breaks if your sight comes on, turns back on you the moment it is off, never pulls up after you into a hang (slow, he keeps his nose level and turns to face you), and gives up a chase he cannot win, out of his guns\' reach and not closing for 6 s. Getting on top of him is the hard part. From under him, pull up behind him as he turns back after you, slow over the top (28 to 30 m/s for about 2.5 s, 190 m from him), and come down on him across his beam, 90 to 120 degrees off his tail: 10 to 22 hits, and in 3 of 9 he goes down. Only once in nine, as he went down, were you on his tail with your nose on him for the 2 s that makes you the hunter. If he lives, his nose follows you: there is no second pass without meeting it.',
    ],
    survival: { verdict: 'yes', line: 'Yes: seen far back, turn into him, go under him and run on: he follows without closing, holds his fire, and gives the chase up 28 to 31 s in, in all nine. Getting on top of him is another matter: from under him you come down on him once, 10 to 22 hits, down in 3 of 9; if he lives, his nose follows you, and no second pass comes without meeting it.' },
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'olAce',
    ace: { plan: 'hunter', start: { at: [180, 375, 240], headingDeg: -35, speed: 62 } },
    you: { start: { at: [0, 350, 0], headingDeg: 0, speed: 55 } },
    demos: [
      { id: 'without', label: 'You fly straight', seat: 'cruiser', skill: 0.85,
        note: 'He closes in behind you and you hold your heading.' },
      { id: 'flat', label: 'You turn hard', seat: 'olHardTurn', skill: 0.85,
        note: 'A gentle turn toward him keeps him in sight; once he is committed, as hard as it turns, holding your height: he cannot hit you, but he follows you round and stays on your tail.' },
      { id: 'counter', label: 'You turn, then chop', seat: 'olChop', skill: 0.85,
        note: 'Turn hard; when he slides in close behind you in the circle, throttle back and pull up. It no longer works: he slides under your tail, where you cannot see him, and stays behind you. In nine fights he never flew past.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: under him, then away', seat: 'olDip', skill: 0.85,
        ace: 'olAce', aceStart: { at: [80, 380, 900], headingDeg: -5, speed: 62 }, seconds: 40,
        note: 'Seen 900 m back: turn into him at once and aim 50 m under him and to his side; the pass comes within about 25 m. Past him, run on the heading the pass leaves you, full throttle, nose 2 degrees down. He has to turn all the way round after you, and he never closes; he gives up.',
        verdict: { works: 9, of: 9, line: 'Out in all nine and never hit. In 5 of 9 he had his guns on you as you met head-on, 270 to 350 m out, and in 6 of 9 180 to 260 m behind you at 18 to 22 s, but he holds his fire to 150 m and never fired; he gave the chase up at 28 to 31 s, and at 40 s you were 1140 to 1410 m clear and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: under him, then up behind him', seat: 'olFlip', skill: 0.85,
        ace: 'olAce', aceStart: { at: [80, 380, 900], headingDeg: -5, speed: 62 }, seconds: 28,
        note: 'Seen 900 m back: turn into him and aim 80 m under him. Once he is past overhead, pull up behind him as he turns back after you (slow over the top, 28 to 30 m/s), and come down on him across his beam with the lead: guns, then off him and up.',
        verdict: { works: 1, of: 9, line: 'After the move he never had a shot and never hit you; the pass landed 10 to 22 hits and shot him down in 3 of 9. But it comes across his beam, 90 to 120 degrees off his tail: only once, as he went down, were you on his tail with your nose on him for the 2 s that makes you the hunter.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: under him, one pass, then out of his reach', seat: 'olNinja', skill: 0.85,
        ace: 'olAce', aceStart: { at: [80, 380, 900], headingDeg: -5, speed: 62 }, seconds: 30,
        note: 'Seen 900 m back: turn into him, go under him, pull up behind him and come down on him once. Then up and away from his nose toward a perch out of his reach. His nose follows you: there is no second pass without meeting it.',
        verdict: { works: 0, of: 9, line: 'One pass in all nine, 10 to 22 hits, down in 3, and he never hit you. But as you met head-on he had his guns on you for 0.3 to 0.6 s at 270 to 350 m, where he holds his fire; and in the 6 he lived he followed you up: at 30 s he was 290 to 330 m behind and 40 to 60 m under you, on your tail for 5 to 6 s of the climb.' } },
    ],
    seconds: 45,
    coach: {
      hunt: { line: 'He is closing on your tail', tip: 'Still far back? Turn into him now, go under him and run on: he cannot catch you. Already close? Turn hard once he is inside 200 m.', keys: ['Mouse', 'Arrows'] },
      track: { line: 'He is on your tail, closing to fire', tip: 'TURN HARD now: roll and pull as far as it goes. He opens fire at 150 m.', keys: ['Mouse', 'Arrows'] },
      lag: { line: 'He followed you into your turn', tip: 'Keep turning hard and hold your height: he cannot pull his sight onto you. Do not chop: he slides under your tail, where you cannot see him.', keys: ['Mouse', 'Arrows'] },
      follow: { line: 'He is following you up, shallow', tip: 'Do not hang at the top: tip over and turn before you are slow.', keys: ['Mouse'] },
      extend: { line: 'He flew past and is running', tip: 'Nose on him and shoot now: he is faster and getting away. Then W.', keys: ['Space', 'W'] },
      headon: { line: 'He is coming at you head-on: the tail is broken', tip: 'Pass over him, not through him, then turn hard into him again.', keys: ['Mouse', 'Arrows'] },
      evade: { line: 'He is breaking away from your guns', tip: 'Let him go and get your speed back: W.', keys: ['W'] },
    },
  },
  {
    id: 'on-his-tail',
    title: 'On his tail: staying there',
    tagline: 'You are behind him and he breaks. While he turns you get no shot, and getting on top of a good pilot here rarely holds. In his circle, leave it when he is across it going away.',
    story: [
      'You get in behind him, full throttle, nose on him. He sees you and breaks: turns as hard as it goes, into you.',
      'In BF1942 a faster Spitfire turns faster, not wider, so rushing in does not fly you through his circle: you come past his tail about 35 m behind him and then sit 50 m behind him in his turn. But you cannot pull the lead on a Spitfire turning hard: about 5 hits a fight, all in the first 3 s of his break, and nobody comes down.',
      'Sit close behind him in his turn and a good pilot throttles back and pulls up to make you fly past him.',
    ],
    counterStory: [
      'Do not sit in his circle. A Spitfire turning hard at 40 m/s turns 39 degrees a second, faster than any lead you can pull on him, from behind, from above or from out wide.',
      'You can turn the speed you came in with into height: climb beside his circle instead of into it. But a good pilot does not wait to be bounced: once nobody is on his tail and he sees you above him, he stops turning and climbs away, and he turns into a dive he sees coming. You get one pass at him; if it does not bring him down, he is round onto your tail as you come off him.',
      'In his circle, leave it: when he is across the circle going the other way, wings level, full throttle, a shallow dive. He has half a circle to fly before his nose is on you; he gets in behind you 250 to 320 m back, about the edge of his guns\' reach, and cannot gain on you.',
      'Flown nine times from slightly different starts: rushing in landed about 5 hits a fight and brought nobody down. Climbing beside his break and diving on him shot him down three times in nine; in the other six he was on your tail after the pass. Leaving across his circle got you clear and unhit six times in nine; from 30 m further back he caught you twice.',
    ],
    ace: { plan: 'otAce', start: { at: [0, 300, -500], headingDeg: 0, speed: 52 } },
    you: { start: { at: [0, 320, 0], headingDeg: 0, speed: 72 } },
    demos: [
      { id: 'move', label: 'You rush in', ace: 'breakTurn', seat: 'chaser', skill: 0.9,
        note: 'Full throttle, nose on him. He breaks 300 m out; you come past his tail and end up 50 m behind him in his turn, with no lead.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: leave as he turns away', seat: 'otDip', ace: 'otAce', skill: 0.85, seconds: 40,
        note: 'You follow him in when he breaks and pass 15 to 35 m from him, then round his circle after him, going nowhere. When he is across the circle going the other way you roll out, full throttle, a shallow dive: he has half a circle to fly before his nose is on you.',
        verdict: { works: 6, of: 9, line: 'In six of the nine he got in behind you 252 to 319 m back, at the edge of his reach but never with a shot, gave up 19 to 25 s in, and at 40 s you were 1942 to 2530 m apart, never hit. From 30 m further back he caught you at 110 to 117 m and shot you down twice; from 30 m nearer you passed him at 14 m and were only 1034 m clear at 40 s.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: the high yo-yo fails', seat: 'otYoyo', ace: 'otAce', skill: 0.85, seconds: 30, startAt: 7, endAt: 23,
        note: 'One try at turning it round from his circle: pull up out of it toward a perch over his turn, then down at him from over his tail. At his speed there is no height to spend: you get no higher than him, he turns away as fast as the dive can follow, and the pass ends level with him or under him. Shown from the pull-up; the rest of the fight is more of the same.',
        verdict: { works: 0, of: 9, line: 'In all nine you were never hit, but your guns had him for 0.27 s at most (3 rounds, in two of the nine): he turns 39 degrees a second and the dive turns you no tighter. Climbing out of his circle to come down on him later, or letting him chase you up and turning back on him, put him on your tail for 5 to 28 s instead (0 of 9).' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: one pass from above, then he is on your tail', seat: 'otNinja', ace: 'otAce', skill: 0.85, seconds: 50,
        note: 'The best try at getting on top: when he breaks you climb beside his circle instead of following him in. He sees you above him, stops turning and climbs away, and you go down on him from above and behind. In this run the pass lands nine rounds and does not bring him down; as you come off him he turns after you and sits 110 to 200 m behind you, climbing with you, for 16 s, and no second pass comes.',
        verdict: { works: 3, of: 9, line: 'Three times in nine, each from 30 m to one side, the pass shot him down (14, 17 and 26 s in). In the other six it landed 2 to 21 rounds and did not, and he was on your tail 5 to 24 s after it while you climbed away; no second shot came in any. His guns never had you.' } },
    ],
    survival: { verdict: 'partly', line: 'Partly: leaving his circle when he is across it going away gets you clear and unhit in 6 of 9 (from 30 m further back he catches you). Getting on top does not hold: a pass from above kills him in 3 of 9, and otherwise he is on your tail after it. From inside his circle nothing turns it round (0 of 9).' },
    seconds: 60,
    coach: {
      watch: { line: 'He has not broken yet', tip: 'Ease the throttle (S): arrive at his speed. When he breaks, do not follow him into his turn.', keys: ['S'] },
      break: { line: 'He broke into you', tip: 'You will get no lead on him in his turn. Leave when he is across his circle going away: wings level, full throttle (W).', keys: ['Mouse', 'Arrows', 'W'] },
      climb: { line: 'He stopped turning: he is climbing away to take the height back', tip: 'If you are above him, this is your one pass: down on him from behind now. If not, leave.', keys: ['Mouse', 'Space'] },
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
      'The break saves you, but it leaves you both in a circle neither of you wins. Against a good attacker you cannot simply leave it: roll out and run, turn away and run, or split-S away, and he follows you, never more than 330 m back, with his sights on you. The way out is not to let the circle start: turn into him at once, 500 m out, before he is in reach. Once he is past, go up: he follows you up and slows. From over the top go straight away from him, full throttle: he chases, cannot close, and gives up a chase he cannot win.',
      'The upper hand is another matter. Over the top you are above him with the speed, but he keeps his nose on you the whole time, so there is never a moment to come down on him that is not nose to nose. Zoom out of the circle once it has started and the same: your dives meet him from the side or the front, never from behind.',
    ],
    counterStory: [
      'As the attacker: when he breaks, do not pull after him into his circle. You will come past his tail and end up sitting in his turn without a shot.',
      'The moment his wings go over, lift your nose up out of his turn (a high yo-yo) and stay up there, 70 m above his circle, at his speed. You never come past him, and he can never get his nose up to you.',
      'A hard-turning Spitfire is almost impossible to hit from a flat chase, and his circle is only 120 m across. Keep the height and wait for him to stop turning: then dive on him.',
      'Flown nine times, the patient attacker never came within 75 m of him, and once the break was a second old neither of them landed a hit.',
    ],
    ace: { plan: 'breakTurn', start: { at: [0, 300, -440], headingDeg: 0, speed: 52 } },
    // From his right rear quarter, so which way is into him shows; 360 m
    // out, so he breaks before his glances over the shoulder have lost the
    // attacker behind the headrest (reviews/eyes.md). From 502 m he lost him
    // at 4 s, turned to clear his tail and broke late, flat, at 228-298 m.
    you: { start: { at: [172, 320, -124], headingDeg: -25, speed: 72 } },
    demos: [
      { id: 'without', label: 'He flies straight', ace: 'cruiser', seat: 'chaser', skill: 0.55,
        note: 'The same attack on a pilot who does nothing.' },
      { id: 'move', label: 'He breaks', seat: 'chaser', skill: 0.55, seconds: 22,
        note: 'He waits until you are 300 m back, then turns hard into you. You come past his tail; he reverses into you. From here it is a circle nobody wins: the three fights after this one are what to do instead, and whether the circle can be turned round.' },
      { id: 'counter', label: 'You stay patient', seat: 'patientAttacker', skill: 0.85, seconds: 16,
        note: 'As he breaks you lift out of his turn and stay above it, instead of chasing him into it.' },
      // The three moves, flown by the pilot he closes on (you) against the
      // school's hunter (`btHunter`), who holds his height in the circle,
      // follows a climb shallow, turns back after anyone who runs, and gives
      // up a chase he cannot win (past his reach, not closing, for 6 s).
      { id: 'dip', kind: 'dip', label: 'The Dip: break at once, up, then away', seat: 'btDip', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        seconds: 50,
        note: 'Do not wait for him to sit on your tail. Turn into him at once, 500 m out, before he is in reach. Once he is past, go up at 70 degrees: he follows you up and slows. From over the top, go straight away from him, full throttle, the nose a little down: he turns after you, cannot close, and gives up the chase.',
        verdict: { works: 9, of: 9, line: 'In all nine his guns never have you and none of his rounds lands: he follows you up, slows, chases your run without closing and gives it up 27 to 28 s in (41 s in one, where you wait longer over the top); at 50 s you are 1.4 to 2.9 km apart and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: up out of the circle, down on him, up again', seat: 'btFlip', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        youMemory: { breakAt: 360 }, seconds: 50,
        note: 'Break at 360 m and hold your height in the circle. With him dead astern inside 120 m, zoom out of it at 70 degrees until 52 m/s are left; he follows you up and slows. Over the top, down on him with the lead, off him before the pass, and when he breaks with you close a high yo-yo up out of his turn: you never follow his break round in the flat.',
        verdict: { works: 0, of: 9, line: 'No: you never get in behind him in time. Up out of the circle and back down on him you put rounds on him in 6 of 9 (up to 20), but the dives meet him from the side or the front: 2 s in his rear quarter only twice, 20 and 27 s after the zoom. In five a dive passes him inside 15 m, in three he hits you (1 to 3 rounds), and in one he never sits close enough behind you to zoom from.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: break at once, up, and no way down on him', seat: 'btNinja', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        seconds: 50,
        note: 'The Dip\'s way in, waiting for the dive: turn into him at once, before he is in reach, so he never gets in behind you; go up once he is past, and he follows and slows. Over the top you wait for his nose to come off you. It never does, so there is no dive to make: after 8 s you leave from the top while he is slow.',
        verdict: { works: 0, of: 9, line: 'No: in all 9 his guns never have you and he never sits on your six, but over the top his nose never leaves you, so the dive never comes and you never fire. You leave, and he gives the chase up 27 to 28 s in (41 s in one): 1.4 to 2.9 km apart at 50 s.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, and early: turn into him before he is in reach (500 m), go up once he is past, and leave from the top while he is slow: he gives up the chase 27 to 41 s in (9 of 9). The upper hand is not to be had: over the top his nose never leaves you, so no dive comes (0 of 9), and out of the circle your dives meet him from the side, never from behind (0 of 9).' },
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
      'If you are the one drifting in front, you have the speed he gave away: use it to leave at a crossing. Going up out of his plane puts you over him for a few seconds only: a pilot who climbs with you is level again by 8 s. Flown nine times, nobody in a flat scissors ever sat in the other\'s rear quarter; the shots are snap shots of a fifth to two fifths of a second.',
    ],
    // The pilot in trouble is you: at full throttle you drift out in front
    // of him at every crossing, and he gets the snap shots.
    survival: { verdict: 'partly', line: 'Partly: leave at the second crossing without reversing, at full throttle, and he never catches you or hits you, but in 3 of 9 that crossing passes inside 15 m of him (6 of 9 clean). Against a man who climbs with you, nothing flown turns the scissors round or keeps you over him: out-slowing him never puts you behind him, and going up at the overshoot ends level with him (0 of 9 each).' },
    // The overshoot that starts it: you came in too fast and are sliding
    // past him, side by side on his heading, 120 m out.
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'scAce',
    ace: { plan: 'scissors', start: { at: [60, 300, 0], headingDeg: 0, speed: 44 } },
    you: { start: { at: [-60, 300, -15], headingDeg: 0, speed: 52 }, memory: { fast: true } },
    demos: [
      { id: 'move', label: 'Scissoring', seat: 'scissors', skill: 0.55,
        note: 'You scissor too, but at full throttle.' },
      // The three below fly against the scissors flown to win: `scAce` chases
      // a pilot who leaves, gives up a chase he cannot close, turns to face a
      // pilot who comes back, and breaks into one on his tail; `scClimber`
      // (the Flip and the Ninja) also climbs for height under a man above
      // him and turns to face his dive.
      { id: 'dip', kind: 'dip', label: 'The Dip: out at a crossing', seat: 'scDip', skill: 0.85, ace: 'scAce', seconds: 35,
        note: 'Two crossings in, at the second you do not reverse: hold the heading the crossing left you on, pointing away from him while he turns the other way, full throttle, a shallow dive.',
        verdict: { works: 6, of: 9, line: 'Out 8 s in, every time: he turns after you 1.2-1.6 s later and sits on your tail for 4-10 s, but once round he is 190-260 m back or more and never has a shot; he gives up 7-13 s after you left, 300-330 m back, and you are 900 m clear at 24-28 s, never hit in any of the nine. It counts in 6: in the other 3 the crossing you leave from passes 6-15 m from him, inside the 15 m no pass may come.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: slower than him, tried', seat: 'scFlip', skill: 0.85, ace: 'scClimber', seconds: 24,
        note: 'The move most pilots try first: from the first crossing you throttle back and fly the scissors slower than him, so that he should drift out in front. What you see is it failing: four crossings, never behind him, sinking under him, until the Flip\'s 20 s run out.',
        verdict: { works: 0, of: 9, line: 'A flat scissors cannot be turned round: you slow to 27-30 m/s against his 37-43 and cross him four times in 20 s, but you are never in his rear quarter at all (one 0.37 s snap in 9 is all your guns get), and you sink 135-170 m (that slow, every reversal costs height), ending as much as 80 m under him, while he snaps you as you cross (0.23-0.4 s, 2 hits, in 2 of 9), passing as close as 7 m. Going up at the crossing and diving back on him, hanging and dropping in behind, and diving only from his rear quarter did no better (0 of 9).' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: up before it starts, tried', seat: 'scNinja', skill: 0.85, ace: 'scClimber', seconds: 20,
        note: 'You do not fly the scissors: at the overshoot you spend your extra speed going up 45 degrees at full throttle, and over the top toward him while you still have 48 m/s, to come down on him from above. What you see is it failing: 70 m over him at 4 s, but he climbs too and turns toward you, your dive misses and leaves you 55 m under him at 8 s, and then you are level, turning with him, neither with a shot.',
        verdict: { works: 0, of: 9, line: 'You cannot hold the upper hand on a man who climbs with you: at 4 s you are 40-100 m over him with 30-70 m of energy on him, but he climbs at 20 degrees and turns toward you, your dive at him misses and takes you 30-80 m under him by 8 s, and from there it is a level fight at even energy (within 30 m of his at 20 s in all nine) with no shot for you; he gets one 0.2 s snap and one hit in 1 of 9. Every other way flown against him (112 settings of the dive-and-zoom, one pass then out, sitting high behind him) did no better (0 of 9).' } },
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
      'A split-S ends low: he has given you his height on top of yours. Let him go and he runs off at 70 m/s and nobody fires. Hold your height while he rolls over; when his nose is 25 degrees down through his half loop he is committed and cannot see you, and that is the moment to dive, with the lead. You arrive as he comes out and breaks, inside his turn. Dive the moment he rolls over and you arrive too early; once he is out, too late. Against a pilot who breaks the moment he sees you on his tail and then turns to fight, that dive shot him down in every start where he split-Sed, never with his guns on you. It is one dive: if he is still flying, he turns to fight, and circling with him wins nothing, so go.',
      'And if you want out: when he Immelmanns back at you after a head-on pass, turn back under his loop the moment he is past and going up, and run the way he came. He comes over the top slow and facing the wrong way, and an equal Spitfire that has to turn round at 40 m/s never catches you. Flying straight on at full throttle gets you out too: he follows 450 m back, no faster than you, and lets you go; turning back puts him furthest behind.',
    ],
    survival: { verdict: 'yes', line: 'Yes: turn back under his Immelmann and run, and he never catches you (9 of 9); meet a split-S from above and dive on him as his nose goes down through his half loop, and he is shot down on that one dive without a shot at you, whenever he split-Ses (6 of 9; in the other three he is too fast to split-S, and you take the Dip). Turning his Immelmann round onto his tail does not work: you get there, under his tail, too slow for the shot (0 of 9).' },
    // FLY IT is the Immelmann's counter: he has made his pass and gone by,
    // fast, 420 m in front of you.
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'taAce',
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
      // against an ace who chases a runner he can catch, breaks when you
      // get on his tail and, bounced out of a split-S, turns to fight (`taAce`).
      { id: 'dip', kind: 'dip', label: 'The Dip: back under his loop', seat: 'taDip', skill: 0.85, ace: 'taAce', seconds: 32,
        aceStart: { at: [80, 295, -800], headingDeg: 180, speed: 74 }, youStart: { at: [0, 300, 0], headingDeg: 0, speed: 56 },
        note: 'Head on, he 18 m/s faster. The moment he is past and pulling up, turn back flat at 60 degrees of bank and run under his loop the way he came, full throttle. He comes over the top at 37 m/s facing the wrong way and has to turn round.',
        verdict: { works: 9, of: 9, line: 'In all nine he never fired: he rolled out over the top 232 to 281 m from you facing away, chased from about 200 to 230 m, was 487 to 566 m behind and not closing at 19 to 19.5 s, turned away, and you were 1700 to 1813 m apart at 32 s. Running straight on or a split-S out also got you clear in all nine.' } },
      // The Flip: the Immelmann he turns round with to come back down on you.
      // Shown to 23 s, as he turns back and the circle begins; scored over
      // 45 s, where it is the circle (dfn-ta.md, "Ascendancy").
      { id: 'flip', kind: 'flip', label: 'The Flip: round under his loop onto his tail', seat: 'taFlip', skill: 0.85, ace: 'taAce', seconds: 45, endAt: 23,
        aceStart: { at: [80, 295, -800], headingDeg: 180, speed: 74 }, youStart: { at: [0, 300, 0], headingDeg: 0, speed: 56 },
        note: 'Head on, he 18 m/s faster, and he Immelmanns to come back down on you. Turn back under his loop the moment he is past and keep turning, all the way round onto his heading: you come up under his tail, where his cockpit hides you, as he rolls out slow. Then the nose on him, before he turns back. Here it fails: watch him see you and turn back. Even then, take the Dip.',
        verdict: { works: 0, of: 9, line: 'No: in all nine you were under his tail, unseen, with your nose coming on him, 15 s in, and he never fired; but the full circle leaves you at 41 to 43 m/s, and the nose reaches his lead only as he turns back to attack and sees you. Fire that would land: 0 to 0.43 s. Flown on to 45 s it is a turning circle with him in all nine, nobody shooting. Diving after his split-S onto his tail did no better against an ace who turns to fight (0 of 9).' } },
      // The Ninja: a one-dive ambush on the split-S, from the `split` demo's
      // start. Too fast to split-S (30 m further out), he goes up instead: the Dip.
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: one dive as his nose goes down, then away', seat: 'taNinja', skill: 0.85, ace: 'taAce', seconds: 50,
        aceStart: { at: [40, 460, -760], headingDeg: 180, speed: 45 }, youStart: { at: [0, 600, 0], headingDeg: 0, speed: 52 },
        note: 'A one-dive ambush. Meet him from above and hold your height while he rolls over. When his nose is 25 degrees down through his half loop, committed and unable to see you, dive with the lead: you arrive as he comes out and breaks, inside his turn. Take every shot, and if he is still flying, do not circle with him: away at full throttle.',
        verdict: { works: 6, of: 9, line: 'Partly, and it hangs on the timing: in the six starts where he split-Ses he was shot down on the dive, 10.6 to 11.0 s in, your fire that landed 1.1 to 1.3 s, his guns never on you. In the three that start 30 m further out he is too fast to split-S and goes up past you instead: no ambush, and you take the Dip. Diving the moment he rolls over, or once he is out, brought him down in under half the starts; following the dive with `ascend` circled with him for 35 to 40 s.' } },
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
/** The moves a lesson's pilot in trouble can fly, best first on ties. */
export const MOVES = ['ninja', 'flip', 'dip'];

/**
 * What FLY IT puts in the air for `lesson`, with the theatre on demo
 * `demoId`. A Dip, Flip or Ninja is practised as it was measured: its own
 * staging, the ace it was flown against, and its plan as the guide and the
 * instructor. Anything else flies the lesson's start against `flyAce` (the
 * lesson's ace with the give-up rule), the guide flying the lesson's
 * counter, or its best move when it has none.
 */
export function flightOf(lesson, demoId = null) {
  const demo = lesson.demos.find(d => d.id === demoId && MOVES.includes(d.kind)) ?? null;
  const best = lesson.demos.filter(d => MOVES.includes(d.kind))
    .sort((a, b) => (b.verdict?.works ?? 0) - (a.verdict?.works ?? 0) || MOVES.indexOf(a.kind) - MOVES.indexOf(b.kind))[0];
  if (demo) {
    return {
      demo, move: demo.kind,
      ace: { plan: demo.ace ?? lesson.flyAce ?? lesson.ace.plan, start: demo.aceStart ?? lesson.ace.start,
             memory: demo.aceMemory ?? lesson.ace.memory },
      you: { start: demo.youStart ?? lesson.you.start, memory: demo.youMemory ?? lesson.you.memory },
      guide: demo.seat,
    };
  }
  return {
    demo: null, move: null,
    ace: { plan: lesson.flyAce ?? lesson.ace.plan, start: lesson.ace.start, memory: lesson.ace.memory },
    you: { start: lesson.you.start, memory: lesson.you.memory },
    guide: lesson.demos.find(d => d.id === 'counter')?.seat ?? best?.seat ?? 'meetTheDive',
  };
}

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
