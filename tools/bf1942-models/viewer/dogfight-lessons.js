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
    tagline: 'Height is a loaded gun. Dive, shoot, climb away. Never turn with them.',
    story: [
      'The pilot above you holds the cards. Height is speed waiting to be spent: a Spitfire diving at 45 degrees goes from 60 to over 100 m/s in ten seconds.',
      'They come down fast and steep, 40 to 60 degrees, hold their fire until you fill their sight, fire one short burst, and before you can turn they use that speed to zoom back up, out of reach. Then they turn over the top and do it again.',
      'Erich Hartmann, the highest-scoring ace in history, fought almost only like this: see, decide, attack, reverse.',
    ],
    counterStory: [
      'Turn to face them when they commit to the dive. Facing you, their dive is a head-on pass with no time to aim: they pull out about 350 m away and zoom off without firing.',
      'Do not stand on your tail to do it: turn round flat and keep your speed. Then let them zoom away, get your speed back, and climb shallow, about 10 degrees, turning gently to keep them in sight.',
      'Every dive they waste costs them height: their two dives start 400 and 190 to 240 m above you, and after the second they have to climb back up beside you. Flown nine times from slightly different starts, the pilot who never looked up was shot down every time, in two or three passes. The one who met each dive was not hit once.',
    ],
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'bzAce',
    ace: { plan: 'boomAndZoom', start: { at: [-350, 680, 300], headingDeg: 0, speed: 58 }, memory: { phase: 'perch' } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'counter', label: 'You meet the dive', seat: 'meetTheDive', skill: 0.85,
        note: 'You turn to face every dive and never chase their zoom.' },
      // The three moves fly against `bzAceMeet`: the lesson's ace, who also
      // meets a dive he sees coming once his height is gone.
      { id: 'dip', kind: 'dip', label: 'The Dip: meet them, then run', seat: 'bzDip', ace: 'bzAceMeet', skill: 0.85, seconds: 90,
        note: 'You meet their first dive head on, then run out of the pass the way it left you while their zoom takes them the other way: full throttle, the nose 6 degrees down to 150 m, then level there at about 72 m/s. Keep running: they follow for over a minute.',
        verdict: { works: 9, of: 9, line: 'In all nine they dive after you but from 15 s on never get within 732 m or hit you; in four they give up a chase they cannot win at about 80 s and climb away, and at 90 s you are 1.1 to 1.9 km apart and opening.' } },
      // The Flip and the Ninja open where they start to matter: about 36 s
      // into the lesson's fight, after two met dives, his height spent, both
      // climbing at about 470 m, 520 m apart, the energy even.
      { id: 'flip', kind: 'flip', label: 'The Flip: in behind them once their height is spent', seat: 'bzFlip', ace: 'bzAceMeet', skill: 0.85, seconds: 22,
        aceStart: { at: [-517, 449, -45], headingDeg: 165, pitchDeg: 19, speed: 58 }, aceMemory: { phase: 'climb' },
        youStart: { at: [0, 476, 0], headingDeg: -150, pitchDeg: 16, speed: 52 }, youMemory: { phase: 'climb' },
        note: 'This opens after you have met their two dives: their height is spent and you are level, climbing. Their pass could not be turned round (out of the dive they are 30 m/s faster); now, when they turn their nose away, in behind them with the lead, and if the guns do not bear in 3 to 5 s, up and away, never round after them.',
        verdict: { works: 0, of: 9, line: 'In all nine they turn to face you and pass under you; 9 to 10 s in, their nose away, you turn in after them, but at even energy your nose never comes onto them: not a moment in their rear quarter, no landing shot. You leave 3 s later and at 22 s you are 0.8 to 1 km apart; they never have a shot at you.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: one pass from above, then away', seat: 'bzNinja', ace: 'bzAceMeet', skill: 0.85, seconds: 25,
        aceStart: { at: [-517, 449, -45], headingDeg: 165, pitchDeg: 19, speed: 58 }, aceMemory: { phase: 'climb' },
        youStart: { at: [0, 476, 0], headingDeg: -150, pitchDeg: 16, speed: 52 }, youMemory: { phase: 'climb' },
        note: 'This opens after you have met their two dives: their height is spent and you are level, climbing. Climb with them until you are 35 m over them, turn toward them, and make one pass down on them with the lead. If they meet it or there is no shot, run out on the dive\'s speed: never round and round with them at even energy.',
        verdict: { works: 0, of: 9, line: 'In all nine you get over them and dive at 7 to 9 s, but they turn to face you (in six they are still turning into the dive as it ends) and no shot ever bears; you run, and at 25 s you are 0.9 to 1.2 km apart. Their guns never bear on you either.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, by leaving: meet their first dive head on, then run out of the pass at full throttle, level at 150 m. They follow for over a minute, never within 732 m once you are running, and give up or fall a kilometre behind (9 of 9). You cannot turn their pass round, and once their height is spent they meet your dives as you met theirs (0 of 9 each).' },
    seconds: 55,
    coach: {
      climb: { line: 'They are climbing away to get above you again', tip: 'Do not follow them up steep. Get your speed back, then climb shallow at full throttle.', keys: ['W'] },
      perch: { line: 'They are above you, picking their moment', tip: 'Keep your speed up and keep them in sight. Get ready to turn and face them.', keys: ['W'] },
      dive: { line: 'They are diving on you', tip: 'Turn to face them NOW: roll toward them and pull, the nose no more than 15 degrees up. Make it a head-on pass.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'They are zooming back up on the dive\'s speed', tip: 'Let them go. Level off and climb shallow.', keys: ['W'] },
      reverse: { line: 'They are turning over the top to dive again', tip: 'Watch where their nose goes and be ready to meet them.', keys: [] },
      evade: { line: 'They are breaking: you are on their tail', tip: 'Shoot as they turn, then do not follow them into the turn.', keys: ['Space'] },
    },
  },
  {
    id: 'under-the-height',
    title: 'When they have the height',
    tagline: 'They are above you and keep coming down. Climb between their dives, break only when they commit.',
    story: [
      'They have the height, 520 m of it, and they keep coming down on you, shooting and zooming back up. You want the height back. The natural thing is to climb straight for it, nose up, full throttle.',
      'That is exactly what they want: 30 degrees nose up, a Spitfire is down to 35 m/s on a straight line, the easiest shot there is. They settle in behind and one long burst finishes it.',
      'Turning flat in a circle is safer: they cannot hold their sight on you, and their dives come to nothing. But it never gets you anything back: you finish at the height you started.',
    ],
    counterStory: [
      'Climb, but only while they are not coming at you: when they are zooming away or turning over the top, put the nose up at full throttle, up to 20 degrees once the speed is back, turning gently to keep them in sight.',
      'When they commit to a dive at you, inside about 380 m with their nose on you, break: turn as hard as it goes, into them. Turned toward them, their pass is spoiled: they pull out without a shot and zoom away to try again.',
      'The moment they have gone past, climb again. Every dive they waste costs them height, and your climb adds to yours. Zooming away they lose sight of you, under their tail, and spend 11 to 12 s looking for you: in seven of nine fights they never get above you again for a second dive; in two their second dive starts about 140 m above you, not 520, and they pull out of it without a shot.',
      'Flown nine times from slightly different starts: climbing straight was shot down every time, in one pass. Turning flat was never hit, and finished at the height it started. Climbing between their dives was never hit either, and climbed 490 to 600 m: from 520 m under them to 70 to 330 m above them.',
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
      { id: 'counter', label: 'You climb between their dives', seat: 'climbBetween', skill: 0.85,
        note: 'Climb while they are away, break when they commit, climb again.' },
      // The three below fly against `uhAce`: the same boom-and-zoomer, who
      // also chases a runner and turns to face a dive on him.
      { id: 'dip', kind: 'dip', label: 'The Dip: spend their height, then run', seat: 'uhDip', ace: 'uhAce', skill: 0.85, seconds: 70,
        note: 'Running at once, they dive after you and catch you. So climb between their dives and break their dive and their chase; once their height is spent and you have 50 m of energy on them, about 40 s in, and their nose is well off you (or they are past 600 m), run straight away from them, flat out, the nose 2 degrees down. Never run down their nose line.',
        verdict: { works: 9, of: 9, line: 'In all nine you break their dive and their chase (one to three breaks), their guns never fire and they are never on your tail; you start the run 30 to 45 s in, they follow but cannot close, 6 to 20 s into the run they let you go and climb away, and at 70 s you are 1.5 to 3.2 km apart and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: break their chase, reverse onto them', seat: 'uhFlip', ace: 'uhAce', skill: 0.85, seconds: 60,
        note: 'You break their first dive and climb. Their dive has spent their height, so they come after you level, from behind: break into them, and the moment they have gone past you, slow, reverse onto their tail with the lead. Then stay on top: climb, and once the energy is yours come down on them from above.',
        verdict: { works: 6, of: 9, line: 'Partly. In eight of nine you reverse onto them 32 to 45 s in and sit in their rear quarter 6 to 12 s later; their guns never fire and they never get onto your tail. But only once does the reversal itself bring the shot: mostly the turn back slows you to 27 to 33 m/s and leaves you 300 to 330 m behind them, out of gun range, and the shot comes 8 to 14 s later from a dive from above. That dive lands enough in five (and shoots them down in two, the fight shown among them) and too little in two (0.2 and 0.47 s); in the ninth they never come after you again after their first dive, so there is nothing to reverse on.' } },
      // Opens at 26 s, his chase coming in; the scrub bar reaches back to 0.
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: take the height back, then down on them', seat: 'uhNinja', ace: 'uhAce', skill: 0.85, seconds: 90, startAt: 26,
        note: 'Break their dive and their chase and climb in between, so their guns are never on you. Once the energy is yours (35 to 53 s in), you are the boom-and-zoomer: down on them from above with the lead, up and over before they can turn onto you. If a pass leaves you level with them and no shot, do not circle with them: leave. The fight shown is the one in nine where this holds: one dive and they are down.',
        verdict: { works: 1, of: 9, line: 'No. In all nine their guns never fire and they are never on your tail, and you win the height back; but holding it does not follow. Only in the fight shown does the dive finish them (down at 62.6 s). In four a dive lands a burst, but they are not shot down and the bursts do not keep coming (a second in only one of the four, 20 s or more near them without one in three); in four no dive lands at all. Level with them then, you leave rather than circle with them, and they let you go.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, and you can turn it round, but not at once: break their dive, then their chase, and climb in between; about 40 s in their height is spent and the energy is yours. Then run and get clear (9 of 9), or reverse onto them as they go past your break and stay on top (6 of 9). Holding the upper hand pass after pass does not follow (1 of 9): after one dive they are level with you again and the best you can do is leave. Running before that, or pulling up after their zoom, does not work.' },
    seconds: 55,
    coach: {
      chase: { line: 'They are coming after you from behind', tip: 'Do not climb on in front of them: when they are about 380 m out with their nose on you, break into them, hard. If they go past you slow, reverse onto their tail.', keys: ['Mouse', 'Arrows'] },
      meet: { line: 'You are diving on them and they are turning to face you', tip: 'Do not take a head-on pass: pull up and keep the height.', keys: ['Mouse'] },
      climb: { line: 'They are climbing away to get above you again', tip: 'They are not coming at you: climb now, up to 20 degrees, full throttle.', keys: ['W', 'Mouse'] },
      perch: { line: 'They are above you, picking their moment', tip: 'Climb while they wait. Watch their nose: when it comes round to you, be ready to break.', keys: ['W'] },
      dive: { line: 'They are diving at you', tip: 'Wait until they are about 380 m out, then BREAK: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'They have gone past and are zooming up', tip: 'Climb again, now. Their height is going and yours is coming.', keys: ['W', 'Mouse'] },
      reverse: { line: 'They are turning over the top', tip: 'Keep climbing, and keep them in sight.', keys: ['W'] },
      evade: { line: 'You are on their tail', tip: 'Shoot as they turn, then climb: do not follow them into their turn.', keys: ['Space'] },
    },
  },
  {
    id: 'up-and-over',
    title: 'Up and over',
    tagline: 'They pull straight up out of your chase. Follow them up and you hang below them; follow shallow and they hang in front of you.',
    story: [
      'You are chasing them, but they came in faster than you. They pull nearly straight up, and the instinct is to follow them, nose on them.',
      'Straight up, the slower plane runs out first. You hang below them at 13 m/s with no control and the nose falling, while they still have the speed to go over the top in a half loop and come back down at you from above.',
      'This is the trick the best BF1942 pilots use: up where you cannot follow, then back down on you. Flown nine times from slightly different starts, you hung 45 to 115 m below them every time. The school\'s ace seldom lands the shot from over the top (under one hit a fight): what the trick bought them was the height and four seconds of you helpless beneath them.',
    ],
    counterStory: [
      'Follow them, but shallow: 25 degrees on their bearing, nose under them, full throttle. Do not point your nose at them.',
      'Straight up, a Spitfire loses 10 to 14 m/s every second: from 70 m/s it is down to 34 in three. Their climb spends their speed; your shallow one spends far less. When they go over the top they are slow, above you and inside your guns, and you are the faster plane.',
      'From the same nine starts: at their slowest you were 15 to 18 m/s faster than them and 180 to 275 m away. You had the first hits in all nine and landed 12 a fight to their 0.6.',
    ],
    // FLY IT's ace on the trap and counter tabs: the lesson's, plus the
    // school's one give-up rule (README, "Can you survive it?"). The Dip, the
    // Flip and the Ninja meet `uoAceSharp`, who does not loop twice in front
    // of a man he can see.
    flyAce: 'uoAce',
    ace: { plan: 'upAndOver', start: { at: [25, 280, -280], headingDeg: 0, speed: 78 } },
    you: { start: { at: [0, 280, 0], headingDeg: 0, speed: 50 } },
    demos: [
      { id: 'move', label: 'You follow them up', seat: 'followStraightUp', skill: 0.7,
        note: 'You pull up after them as steep as they go.' },
      { id: 'counter', label: 'You follow shallow', seat: 'shallowFollow', skill: 0.7,
        note: 'You climb after them at 25 degrees, nose under them, and save your speed.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: past them, then run', seat: 'uoDip', ace: 'uoAceSharp', skill: 0.7, seconds: 35,
        note: 'You climb after them at 30 degrees, never into their climb. As they go over the top you fly past them, beside and under their dive, then full throttle straight away. They do not loop again with you behind them: they break, and climb away the way they came.',
        verdict: { works: 7, of: 9, line: 'In seven they break it off 12.1 to 12.6 s in, 35 to 100 m from you, and climb away the way they came; at 35 s you are 2298 to 2555 m apart and opening, never hit. From 30 m to the left, 30 m closer and 3 m/s slower they hit you 5 times in their pounce as you pass; from 30 m to the right, 30 m further back and 3 m/s faster they chase you over the top, sit on your tail for 7.7 s and let you go only at 33 s, 461 m back.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: from under them, after following them up', seat: 'uoFlip', ace: 'uoAceSharp', skill: 0.7, seconds: 45, endAt: 27,
        note: 'The hunted pilot: you followed them up, and at 42 m/s, nose high and 330 to 380 m behind them, they are going over the top with you under them. Push the nose down off their line, get the speed back, and round behind them. This is the best try found, and it does not work.',
        verdict: { works: 0, of: 9, line: 'It never works: the nose comes down slowly and you spend 2 to 5 s under 35 m/s inside 300 m of them; in none of the nine are you 2 s in their rear quarter with the shot, they hit you once or twice in three, and in seven they end up turning to meet you. Once you have followed them up, they have the fight: do not follow them up.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: at their top, then in behind them unseen', seat: 'uoNinja', ace: 'uoAceSharp', skill: 0.7, seconds: 50,
        note: 'Never follow them up and never circle with them. Climb after them at 24 degrees and shoot as they slow over the top; push the nose down past their dive; slice round nose low under their tail. They break off and climb away without seeing you: close in behind them and shoot from 150 to 200 m. When they see you and turn in, leave rather than turn with them.',
        verdict: { works: 6, of: 9, line: 'Partly. In six you shoot them at the top of their loop at 7 s and again from behind them, unseen, at 16.6 to 17.3 s, and they never have a shot at you: in one they go down at 19.7 s, in five they see you at 136 to 185 m and turn in, and you leave rather than turn with them: 1256 to 1597 m apart, both flying away, when the 50 s run out. From 10 m lower, 30 m closer and 3 m/s slower your first burst is short, they turn to meet you and there is no second; 10 m higher, 30 m further back and 3 m/s faster your pass goes within 7 m of them; 30 m to the right, closer and faster you get one real burst.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, if you never follow them up: climb after them at 30 degrees, pass them over the top and run (clear in 7 of 9). Staying on top works partly: climb at 24, shoot as they slow over the top, push past their dive and get in behind them while they cannot see you (6 of 9, never hit; they go down in one, in five you leave as they turn in). Once you have followed them up, nothing found gets you out on top.' },
    seconds: 45,
    coach: {
      run: { line: 'They are running fast and level', tip: 'They are faster than you. Stay behind them and watch for the pull up.', keys: ['W'] },
      chase: { line: 'They are diving after you', tip: 'Full throttle, nose a little down, straight away from them: as fast as you, they cannot close and soon give up.', keys: ['W', 'Mouse'] },
      pull: { line: 'They are pulling nearly straight up', tip: 'Do not follow them up. Climb after them at 25 degrees, nose under them, full throttle.', keys: ['Mouse', 'Arrows', 'W'] },
      over: { line: 'They are going over the top', tip: 'They are slow up there. Raise the nose onto them and shoot as they hang.', keys: ['Mouse', 'Space'] },
      pounce: { line: 'They are coming back down at you', tip: 'Off the shot now: push the nose down and let them go past beside you.', keys: ['Mouse', 'W'] },
      zoom: { line: 'They are zooming back up', tip: 'Slice round nose low under their tail, then follow shallow again: they slow over the top in front of you.', keys: ['Mouse', 'W'] },
    },
  },
  {
    id: 'out-of-the-lock',
    title: 'Out of their lock: breaking the tail',
    tagline: 'They are on your tail. Turning hard keeps you alive; flying straight or diving gets you shot down. Seen far back, turn into them, go under them and run on: they follow without closing, never fire, and give up. The chop no longer makes them fly past: they slide under your tail, where you cannot see them. From under them you can come down on them once, but not stay on top.',
    story: [
      'The best pilots get behind you and stay there. The hunter closes at full throttle, eases off as they get in, and holds their fire until they are inside 150 m, where a burst counts. That is the lock. Dead astern the hunter sits in the one cone your headrest hides, so a pilot who knows the hunter is coming keeps a gentle turn on, toward the hunter, and has them over the shoulder until they are in.',
      'Flying straight under it is death: shot down every time, 12 to 19 s in. Diving away does not shake them: they dive with you, 120 to 145 m behind you all the way down, their nose on you, and when you pull out they close in: shot down in 7 of 9, and 20 and 4 hits in the other two.',
      'Turning hard does not shake them either. In BF1942 a Spitfire turning hard flies a circle about 120 m across, and a faster one turns faster, not wider, so they follow you round, never closer than about 50 m. Their nose cannot come onto you, so they land nothing, but they are still on your tail: the turn buys time, nothing more.',
    ],
    counterStory: [
      'What breaks the tail is seeing them early. While they are still about 400 m back, turn as hard as it turns, into them, and keep turning until your nose is on them. From that far they cannot follow you round inside a 120 m circle: the chase becomes a head-on pass. Pass over them, turn into them again, and you are even, nobody on anybody\'s tail.',
      'Seen 900 m back you can get out altogether. Turn into them at once and aim 50 m under them and to their side: they go over you about 25 m clear. Run on the heading the pass leaves you, full throttle, nose a little down. They have to turn all the way round after you, and by then you are at 63 to 74 m/s and going: they never close. In some fights they have their guns on you as you meet, 270 to 350 m out, or 180 to 260 m behind you as they follow, but they hold their fire to 150 m, and they give the chase up 28 to 31 s in.',
      'The chop no longer breaks the lock. It needs a fast pilot closing on you from dead astern, who cannot slow in time and flies through; dead astern is the one cone your headrest hides, and a pilot you keep in sight over your shoulder comes in off your tail line. When you chop they are 53 to 56 m back, about 45 degrees off your tail and only about 7 m/s faster: no closing speed to fly past on. They slide under your tail, where you cannot see them, and stay behind you.',
      'Flown nine times from slightly different starts: flying straight was shot down every time, 12 to 19 s in; diving away was shot down in 7 of 9; turning hard took no hit and landed none, with them following you round the whole time; turning into them early took none, their lock gone within 3 s and the chase a head-on pass; the chop took one hit in nine fights and landed none, and they never flew past.',
      'The Dip, the Flip and the Ninja meet a sharper hunter: they run only while your nose is on them, break if your sight comes on, turn back on you the moment it is off, never pull up after you into a hang (slow, they keep their nose level and turn to face you), and give up a chase they cannot win, out of their guns\' reach and not closing for 6 s. Getting on top of them is the hard part. From under them, pull up behind them as they turn back after you, slow over the top (28 to 30 m/s for about 2.5 s, 190 m from them), and come down on them across their beam, 90 to 120 degrees off their tail: 10 to 22 hits, and in 3 of 9 they go down. Only once in nine, as they went down, were you on their tail with your nose on them for the 2 s that makes you the hunter. If they live, their nose follows you: there is no second pass without meeting it.',
    ],
    survival: { verdict: 'yes', line: 'Yes: seen far back, turn into them, go under them and run on: they follow without closing, hold their fire, and give the chase up 28 to 31 s in, in all nine. Getting on top of them is another matter: from under them you come down on them once, 10 to 22 hits, down in 3 of 9; if they live, their nose follows you, and no second pass comes without meeting it.' },
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'olAce',
    ace: { plan: 'hunter', start: { at: [180, 375, 240], headingDeg: -35, speed: 62 } },
    you: { start: { at: [0, 350, 0], headingDeg: 0, speed: 55 } },
    demos: [
      { id: 'flat', label: 'You turn hard', seat: 'olHardTurn', skill: 0.85,
        note: 'A gentle turn toward them keeps them in sight; once they are committed, as hard as it turns, holding your height: they cannot hit you, but they follow you round and stay on your tail.' },
      { id: 'counter', label: 'You turn, then chop', seat: 'olChop', skill: 0.85,
        note: 'Turn hard; when they slide in close behind you in the circle, throttle back and pull up. It no longer works: they slide under your tail, where you cannot see them, and stay behind you. In nine fights they never flew past.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: under them, then away', seat: 'olDip', skill: 0.85,
        ace: 'olAce', aceStart: { at: [80, 380, 900], headingDeg: -5, speed: 62 }, seconds: 40,
        note: 'Seen 900 m back: turn into them at once and aim 50 m under them and to their side; the pass comes within about 25 m. Past them, run on the heading the pass leaves you, full throttle, nose 2 degrees down. They have to turn all the way round after you, and they never close; they give up.',
        verdict: { works: 9, of: 9, line: 'Out in all nine and never hit. In 5 of 9 they had their guns on you as you met head-on, 270 to 350 m out, and in 6 of 9 180 to 260 m behind you at 18 to 22 s, but they hold their fire to 150 m and never fired; they gave the chase up at 28 to 31 s, and at 40 s you were 1140 to 1410 m clear and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: under them, then up behind them', seat: 'olFlip', skill: 0.85,
        ace: 'olAce', aceStart: { at: [80, 380, 900], headingDeg: -5, speed: 62 }, seconds: 28,
        note: 'Seen 900 m back: turn into them and aim 80 m under them. Once they are past overhead, pull up behind them as they turn back after you (slow over the top, 28 to 30 m/s), and come down on them across their beam with the lead: guns, then off them and up.',
        verdict: { works: 1, of: 9, line: 'After the move they never had a shot and never hit you; the pass landed 10 to 22 hits and shot them down in 3 of 9. But it comes across their beam, 90 to 120 degrees off their tail: only once, as they went down, were you on their tail with your nose on them for the 2 s that makes you the hunter.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: under them, one pass, then out of their reach', seat: 'olNinja', skill: 0.85,
        ace: 'olAce', aceStart: { at: [80, 380, 900], headingDeg: -5, speed: 62 }, seconds: 30,
        note: 'Seen 900 m back: turn into them, go under them, pull up behind them and come down on them once. Then up and away from their nose toward a perch out of their reach. Their nose follows you: there is no second pass without meeting it.',
        verdict: { works: 0, of: 9, line: 'One pass in all nine, 10 to 22 hits, down in 3, and they never hit you. But as you met head-on they had their guns on you for 0.3 to 0.6 s at 270 to 350 m, where they hold their fire; and in the 6 they lived they followed you up: at 30 s they were 290 to 330 m behind and 40 to 60 m under you, on your tail for 5 to 6 s of the climb.' } },
    ],
    seconds: 45,
    coach: {
      hunt: { line: 'They are closing on your tail', tip: 'Still far back? Turn into them now, go under them and run on: they cannot catch you. Already close? Turn hard once they are inside 200 m.', keys: ['Mouse', 'Arrows'] },
      track: { line: 'They are on your tail, closing to fire', tip: 'TURN HARD now: roll and pull as far as it goes. They open fire at 150 m.', keys: ['Mouse', 'Arrows'] },
      lag: { line: 'They followed you into your turn', tip: 'Keep turning hard and hold your height: they cannot pull their sight onto you. Do not chop: they slide under your tail, where you cannot see them.', keys: ['Mouse', 'Arrows'] },
      follow: { line: 'They are following you up, shallow', tip: 'Do not hang at the top: tip over and turn before you are slow.', keys: ['Mouse'] },
      extend: { line: 'They flew past and are running', tip: 'Nose on them and shoot now: they are faster and getting away. Then W.', keys: ['Space', 'W'] },
      headon: { line: 'They are coming at you head-on: the tail is broken', tip: 'Pass over them, not through them, then turn hard into them again.', keys: ['Mouse', 'Arrows'] },
      evade: { line: 'They are breaking away from your guns', tip: 'Let them go and get your speed back: W.', keys: ['W'] },
    },
  },
  {
    id: 'on-his-tail',
    title: 'On their tail: staying there',
    tagline: 'You are behind them and they break. While they turn you get no shot, and getting on top of a good pilot here rarely holds. In their circle, leave it when they are across it going away.',
    story: [
      'You get in behind them, full throttle, nose on them. They see you and break: turn as hard as it goes, into you.',
      'In BF1942 a faster Spitfire turns faster, not wider, so rushing in does not fly you through their circle: you come past their tail about 35 m behind them and then sit 50 m behind them in their turn. But you cannot pull the lead on a Spitfire turning hard: about 5 hits a fight, all in the first 3 s of their break, and nobody comes down.',
      'Sit close behind them in their turn and a good pilot throttles back and pulls up to make you fly past them.',
    ],
    counterStory: [
      'Do not sit in their circle. A Spitfire turning hard at 40 m/s turns 39 degrees a second, faster than any lead you can pull on them, from behind, from above or from out wide.',
      'You can turn the speed you came in with into height: climb beside their circle instead of into it. But a good pilot does not wait to be bounced: once nobody is on their tail and they see you above them, they stop turning and climb away, and they turn into a dive they see coming. You get one pass at them; if it does not bring them down, they are round onto your tail as you come off them.',
      'In their circle, leave it: when they are across the circle going the other way, wings level, full throttle, a shallow dive. They have half a circle to fly before their nose is on you; they get in behind you 250 to 320 m back, about the edge of their guns\' reach, and cannot gain on you.',
      'Flown nine times from slightly different starts: rushing in landed about 5 hits a fight and brought nobody down. Climbing beside their break and diving on them shot them down three times in nine; in the other six they were on your tail after the pass. Leaving across their circle got you clear and unhit six times in nine; from 30 m further back they caught you twice.',
    ],
    ace: { plan: 'otAce', start: { at: [0, 300, -500], headingDeg: 0, speed: 52 } },
    you: { start: { at: [0, 320, 0], headingDeg: 0, speed: 72 } },
    demos: [
      { id: 'move', label: 'You rush in', ace: 'breakTurn', seat: 'chaser', skill: 0.9,
        note: 'Full throttle, nose on them. They break 300 m out; you come past their tail and end up 50 m behind them in their turn, with no lead.' },
      { id: 'dip', kind: 'dip', label: 'The Dip: leave as they turn away', seat: 'otDip', ace: 'otAce', skill: 0.85, seconds: 40,
        note: 'You follow them in when they break and pass 15 to 35 m from them, then round their circle after them, going nowhere. When they are across the circle going the other way you roll out, full throttle, a shallow dive: they have half a circle to fly before their nose is on you.',
        verdict: { works: 6, of: 9, line: 'In six of the nine they got in behind you 252 to 319 m back, at the edge of their reach but never with a shot, gave up 19 to 25 s in, and at 40 s you were 1942 to 2530 m apart, never hit. From 30 m further back they caught you at 110 to 117 m and shot you down twice; from 30 m nearer you passed them at 14 m and were only 1034 m clear at 40 s.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: the high yo-yo fails', seat: 'otYoyo', ace: 'otAce', skill: 0.85, seconds: 30, startAt: 7, endAt: 23,
        note: 'One try at turning it round from their circle: pull up out of it toward a perch over their turn, then down at them from over their tail. At their speed there is no height to spend: you get no higher than them, they turn away as fast as the dive can follow, and the pass ends level with them or under them. Shown from the pull-up; the rest of the fight is more of the same.',
        verdict: { works: 0, of: 9, line: 'In all nine you were never hit, but your guns had them for 0.27 s at most (3 rounds, in two of the nine): they turn 39 degrees a second and the dive turns you no tighter. Climbing out of their circle to come down on them later, or letting them chase you up and turning back on them, put them on your tail for 5 to 28 s instead (0 of 9).' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: one pass from above, then they are on your tail', seat: 'otNinja', ace: 'otAce', skill: 0.85, seconds: 50,
        note: 'The best try at getting on top: when they break you climb beside their circle instead of following them in. They see you above them, stop turning and climb away, and you go down on them from above and behind. In this run the pass lands nine rounds and does not bring them down; as you come off them they turn after you and sit 110 to 200 m behind you, climbing with you, for 16 s, and no second pass comes.',
        verdict: { works: 3, of: 9, line: 'Three times in nine, each from 30 m to one side, the pass shot them down (14, 17 and 26 s in). In the other six it landed 2 to 21 rounds and did not, and they were on your tail 5 to 24 s after it while you climbed away; no second shot came in any. Their guns never had you.' } },
    ],
    survival: { verdict: 'partly', line: 'Partly: leaving their circle when they are across it going away gets you clear and unhit in 6 of 9 (from 30 m further back they catch you). Getting on top does not hold: a pass from above kills them in 3 of 9, and otherwise they are on your tail after it. From inside their circle nothing turns it round (0 of 9).' },
    seconds: 60,
    coach: {
      watch: { line: 'They have not broken yet', tip: 'Ease the throttle (S): arrive at their speed. When they break, do not follow them into their turn.', keys: ['S'] },
      break: { line: 'They broke into you', tip: 'You will get no lead on them in their turn. Leave when they are across their circle going away: wings level, full throttle (W).', keys: ['Mouse', 'Arrows', 'W'] },
      climb: { line: 'They stopped turning: they are climbing away to take the height back', tip: 'If you are above them, this is your one pass: down on them from behind now. If not, leave.', keys: ['Mouse', 'Space'] },
      chop: { line: 'They chopped their throttle and pulled up: you are closing fast', tip: 'Pull up and out of their turn now, or you fly through underneath them.', keys: ['Mouse', 'S'] },
      reverse: { line: 'They are turning onto you', tip: 'Close behind you: break turn hard into them. 300 m back and you going away: wings level, full throttle (W).', keys: ['Mouse', 'Arrows', 'W'] },
      chase: { line: 'They are chasing you, 400 m back or more', tip: 'Wings level, full throttle (W): they are no faster than you and cannot gain.', keys: ['W'] },
      letgo: { line: 'They gave up the chase: they are turning away and climbing', tip: 'Keep going. Turn back at them and they turn to meet you.', keys: ['W'] },
      meet: { line: 'You turned back: they are turning to meet you head-on', tip: 'Pass over them, not through them, and keep going: they will not let you behind them.', keys: ['Mouse', 'W'] },
      extend: { line: 'They flew past you and are running', tip: 'Nose on them and shoot now if they are close: they are faster than you and getting away.', keys: ['Space', 'Mouse'] },
    },
  },
  {
    id: 'break-turn',
    title: 'The break turn',
    tagline: 'With a fighter closing on your tail, wait, then turn as hard as you can into them.',
    story: [
      'An attacker is closing on your tail, fast, from one side. Fly straight and they simply shoot you down.',
      'So you wait until they are committed, 300 m back, just outside their guns\' reach, and then turn as hard as the aeroplane turns, toward their side: into them.',
      'Their sight cannot follow you round, and their closure carries them past your tail, about 30 m behind you. As they cross, reverse: turn into them again.',
      'Do not expect them to fly out in front of you. In BF1942 a faster Spitfire turns faster, not wider (its turn is 110 to 150 m across at any speed), so they swing back in behind you. But close, inside your turn, their nose behind you: while you keep turning into them they have no shot, and their 20 m/s are gone.',
      'Flown nine times from slightly different starts, the pilot who flew straight was shot down every time. The one who broke never was, and barely took a hit, all of them in the first two seconds of the break, while their wings were still rolling over.',
      'The break saves you, but it leaves you both in a circle neither of you wins. Against a good attacker you cannot simply leave it: roll out and run, turn away and run, or split-S away, and they follow you, never more than 330 m back, with their sights on you. The way out is not to let the circle start: turn into them at once, 500 m out, before they are in reach. Once they are past, go up: they follow you up and slow. From over the top go straight away from them, full throttle: they chase, cannot close, and give up a chase they cannot win.',
      'The upper hand is another matter. Over the top you are above them with the speed, but they keep their nose on you the whole time, so there is never a moment to come down on them that is not nose to nose. Zoom out of the circle once it has started and the same: your dives meet them from the side or the front, never from behind.',
    ],
    counterStory: [
      'As the attacker: when they break, do not pull after them into their circle. You will come past their tail and end up sitting in their turn without a shot.',
      'The moment their wings go over, lift your nose up out of their turn (a high yo-yo) and stay up there, 70 m above their circle, at their speed. You never come past them, and they can never get their nose up to you.',
      'A hard-turning Spitfire is almost impossible to hit from a flat chase, and its circle is only 120 m across. Keep the height and wait for them to stop turning: then dive on them.',
      'Flown nine times, the patient attacker never came within 75 m of the breaker, and once the break was a second old neither of them landed a hit.',
    ],
    ace: { plan: 'breakTurn', start: { at: [0, 300, -440], headingDeg: 0, speed: 52 } },
    // From his right rear quarter, so which way is into him shows; 360 m
    // out, so he breaks before his glances over the shoulder have lost the
    // attacker behind the headrest (reviews/eyes.md). From 502 m he lost him
    // at 4 s, turned to clear his tail and broke late, flat, at 228-298 m.
    you: { start: { at: [172, 320, -124], headingDeg: -25, speed: 72 } },
    demos: [
      { id: 'move', label: 'They break', seat: 'chaser', skill: 0.55, seconds: 22,
        note: 'They wait until you are 300 m back, then turn hard into you. You come past their tail; they reverse into you. From here it is a circle nobody wins: the three fights after this one are what to do instead, and whether the circle can be turned round.' },
      { id: 'counter', label: 'You stay patient', seat: 'patientAttacker', skill: 0.85, seconds: 16,
        note: 'As they break you lift out of their turn and stay above it, instead of chasing them into it.' },
      // The three moves, flown by the pilot he closes on (you) against the
      // school's hunter (`btHunter`), who holds his height in the circle,
      // follows a climb shallow, turns back after anyone who runs, and gives
      // up a chase he cannot win (past his reach, not closing, for 6 s).
      { id: 'dip', kind: 'dip', label: 'The Dip: break at once, up, then away', seat: 'btDip', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        seconds: 50,
        note: 'Do not wait for them to sit on your tail. Turn into them at once, 500 m out, before they are in reach. Once they are past, go up at 70 degrees: they follow you up and slow. From over the top, go straight away from them, full throttle, the nose a little down: they turn after you, cannot close, and give up the chase.',
        verdict: { works: 9, of: 9, line: 'In all nine their guns never have you and none of their rounds lands: they follow you up, slow, chase your run without closing and give it up 27 to 28 s in (41 s in one, where you wait longer over the top); at 50 s you are 1.4 to 2.9 km apart and opening.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: up out of the circle, down on them, up again', seat: 'btFlip', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        youMemory: { breakAt: 360 }, seconds: 50,
        note: 'Break at 360 m and hold your height in the circle. With them dead astern inside 120 m, zoom out of it at 70 degrees until 52 m/s are left; they follow you up and slow. Over the top, down on them with the lead, off them before the pass, and when they break with you close a high yo-yo up out of their turn: you never follow their break round in the flat.',
        verdict: { works: 0, of: 9, line: 'No: you never get in behind them in time. Up out of the circle and back down on them you put rounds on them in 6 of 9 (up to 20), but the dives meet them from the side or the front: 2 s in their rear quarter only twice, 20 and 27 s after the zoom. In five a dive passes them inside 15 m, in three they hit you (1 to 3 rounds), and in one they never sit close enough behind you to zoom from.' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: break at once, up, and no way down on them', seat: 'btNinja', skill: 1, ace: 'btHunter',
        aceStart: { at: [240, 620, 0], headingDeg: -25, speed: 72 }, youStart: { at: [0, 600, -440], headingDeg: 0, speed: 52 },
        seconds: 50,
        note: 'The Dip\'s way in, waiting for the dive: turn into them at once, before they are in reach, so they never get in behind you; go up once they are past, and they follow and slow. Over the top you wait for their nose to come off you. It never does, so there is no dive to make: after 8 s you leave from the top while they are slow.',
        verdict: { works: 0, of: 9, line: 'No: in all 9 their guns never have you and they never sit on your six, but over the top their nose never leaves you, so the dive never comes and you never fire. You leave, and they give the chase up 27 to 28 s in (41 s in one): 1.4 to 2.9 km apart at 50 s.' } },
    ],
    survival: { verdict: 'yes', line: 'Yes, and early: turn into them before they are in reach (500 m), go up once they are past, and leave from the top while they are slow: they give up the chase 27 to 41 s in (9 of 9). The upper hand is not to be had: over the top their nose never leaves you, so no dive comes (0 of 9), and out of the circle your dives meet them from the side, never from behind (0 of 9).' },
    seconds: 40,
    coach: {
      watch: { line: 'They are flying straight, watching you close', tip: 'You are closing fast. Ease the throttle (S) early, it takes seconds to bite.', keys: ['S'] },
      break: { line: 'They broke: a hard turn into you', tip: 'Do not pull after them into their circle. Pull UP out of their turn and stay above it, at their speed.', keys: ['Mouse', 'Arrows', 'S'] },
      reverse: { line: 'You came past their tail: they are reversing into you', tip: 'Too close and too fast. Pull up out of their turn before you pass them again.', keys: ['Mouse', 'S'] },
      turn: { line: 'You are in their turn, 50 m behind them, with no lead', tip: 'You will not get a shot from here. Pull up out of their circle and keep the height.', keys: ['Mouse', 'S'] },
      chase: { line: 'You are out in front of them: they are behind you', tip: 'Break turn into them: roll toward them and pull as hard as it goes.', keys: ['Mouse', 'Arrows'] },
    },
  },
  {
    id: 'scissors',
    title: 'The flat scissors',
    tagline: 'Side by side and slow: whoever drifts in front loses.',
    story: [
      'It starts with an overshoot: you came in too fast and slid out alongside them, on their heading. Now each of you turns into the other, your paths cross, and both reverse to turn into each other again. From above the two paths braid along one line, like the blades of a pair of scissors.',
      'Every crossing is a race to be slowest along that line. The faster one drifts forward a little each time, and the slower one gets a nose onto the faster as they cross: snap shots, a fraction of a second each, never a steady seat on a tail.',
      'In BF1942 the throttle is a brake: hold S and the propeller drags you back, but it takes 3 to 4 seconds to bite. Below 30 m/s a Spitfire barely turns, so slow does not mean as slow as possible: the ace here sits at about 40 m/s, the other pilot at full throttle a little faster, and that is enough.',
    ],
    counterStory: [
      'Throttle back early, reverse every time they cross, and keep your nose on the horizon: roll from bank to bank without letting the nose fall, or each reversal costs height you never get back.',
      'Do not shoot as you cross them head-on: that is a split second. Wait until they have drifted out in front and your nose comes onto their tail.',
      'If you are the one drifting in front, you have the speed they gave away: use it to leave at a crossing. Going up out of the scissors\' plane puts you over them for a few seconds only: a pilot who climbs with you is level again by 8 s. Flown nine times, nobody in a flat scissors ever sat in the other\'s rear quarter; the shots are snap shots of a fifth to two fifths of a second.',
    ],
    // The pilot in trouble is you: at full throttle you drift out in front
    // of him at every crossing, and he gets the snap shots.
    survival: { verdict: 'partly', line: 'Partly: leave at the second crossing without reversing, at full throttle, and they never catch you or hit you, but in 3 of 9 that crossing passes inside 15 m of them (6 of 9 clean). Against a pilot who climbs with you, nothing flown turns the scissors round or keeps you over them: out-slowing them never puts you behind them, and going up at the overshoot ends level with them (0 of 9 each).' },
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
        note: 'Two crossings in, at the second you do not reverse: hold the heading the crossing left you on, pointing away from them while they turn the other way, full throttle, a shallow dive.',
        verdict: { works: 6, of: 9, line: 'Out 8 s in, every time: they turn after you 1.2-1.6 s later and sit on your tail for 4-10 s, but once round they are 190-260 m back or more and never have a shot; they give up 7-13 s after you left, 300-330 m back, and you are 900 m clear at 24-28 s, never hit in any of the nine. It counts in 6: in the other 3 the crossing you leave from passes 6-15 m from them, inside the 15 m no pass may come.' } },
      { id: 'flip', kind: 'flip', label: 'The Flip: slower than them, tried', seat: 'scFlip', skill: 0.85, ace: 'scClimber', seconds: 24,
        note: 'The move most pilots try first: from the first crossing you throttle back and fly the scissors slower than them, so that they should drift out in front. What you see is it failing: four crossings, never behind them, sinking under them, until the Flip\'s 20 s run out.',
        verdict: { works: 0, of: 9, line: 'A flat scissors cannot be turned round: you slow to 27-30 m/s against their 37-43 and cross them four times in 20 s, but you are never in their rear quarter at all (one 0.37 s snap in 9 is all your guns get), and you sink 135-170 m (that slow, every reversal costs height), ending as much as 80 m under them, while they snap you as you cross (0.23-0.4 s, 2 hits, in 2 of 9), passing as close as 7 m. Going up at the crossing and diving back on them, hanging and dropping in behind, and diving only from their rear quarter did no better (0 of 9).' } },
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: up before it starts, tried', seat: 'scNinja', skill: 0.85, ace: 'scClimber', seconds: 20,
        note: 'You do not fly the scissors: at the overshoot you spend your extra speed going up 45 degrees at full throttle, and over the top toward them while you still have 48 m/s, to come down on them from above. What you see is it failing: 70 m over them at 4 s, but they climb too and turn toward you, your dive misses and leaves you 55 m under them at 8 s, and then you are level, turning with them, neither with a shot.',
        verdict: { works: 0, of: 9, line: 'You cannot hold the upper hand on a pilot who climbs with you: at 4 s you are 40-100 m over them with 30-70 m of energy on them, but they climb at 20 degrees and turn toward you, your dive at them misses and takes you 30-80 m under them by 8 s, and from there it is a level fight at even energy (within 30 m of theirs at 20 s in all nine) with no shot for you; they get one 0.2 s snap and one hit in 1 of 9. Every other way flown against them (112 settings of the dive-and-zoom, one pass then out, sitting high behind them) did no better (0 of 9).' } },
    ],
    seconds: 45,
    coach: {
      reverse: { line: 'They are scissoring: turning into you each time you cross', tip: 'Throttle back (S) early, it takes seconds to bite. Reverse each time they cross.', keys: ['S', 'Mouse', 'Arrows'] },
      cross: { line: 'They crossed: they are reversing', tip: 'Reverse now, toward them.', keys: ['Mouse', 'Arrows'] },
      shoot: { line: 'You drifted out in front of them', tip: 'Break hard into them, now.', keys: ['Mouse', 'Arrows'] },
    },
  },
  {
    id: 'turnarounds',
    title: 'The Immelmann and the split-S',
    tagline: 'Two ways to turn round in the vertical: up with speed, or down with height.',
    story: [
      'After a pass you have to turn round. A flat turn round takes about 5 seconds at a Spitfire\'s hardest and leaves you at the height you were. The two vertical ways round trade height and speed instead.',
      'Fast: pull straight up through half a loop and, upside down on top, roll upright. That is the Immelmann. Here the ace has just gone past you at 74 m/s; they climb about 107 m and roll out going back the other way at 37 m/s, still 70 m above where they started.',
      'High and slow, with you coming at them: roll upside down with the nose on the horizon, then pull through half a loop downward. That is the split-S. They go in at 51 m/s and come out going back the way they came, 145 m lower and 17 m/s faster.',
    ],
    counterStory: [
      'An Immelmann ends high and slow. Do not chase them up from close in: from 170 m behind you hang at 16 to 28 m/s under their top while they roll out at 37, and you get a fifth of a second of fire at most.',
      'Hold off instead. From 420 m back, keep your speed and climb 20 degrees at where their loop tops out: as they hang there you are about 270 m off with your nose on them, closing. Flown nine times, that was 0.6 to 3.3 seconds of fire that would land in seven, and you never fell below 44 m/s. They shoot back as you pass under them in three of those.',
      'A split-S ends low: they have given you their height on top of yours. Let them go and they run off at 70 m/s and nobody fires. Hold your height while they roll over; when their nose is 25 degrees down through their half loop they are committed and cannot see you, and that is the moment to dive, with the lead. You arrive as they come out and break, inside their turn. Dive the moment they roll over and you arrive too early; once they are out, too late. Against a pilot who breaks the moment they see you on their tail and then turns to fight, that dive shot them down in every start where they split-Sed, never with their guns on you. It is one dive: if they are still flying, they turn to fight, and circling with them wins nothing, so go.',
      'And if you want out: when they Immelmann back at you after a head-on pass, turn back under their loop the moment they are past and going up, and run the way they came. They come over the top slow and facing the wrong way, and an equal Spitfire that has to turn round at 40 m/s never catches you. Flying straight on at full throttle gets you out too: they follow 450 m back, no faster than you, and let you go; turning back puts them furthest behind.',
    ],
    survival: { verdict: 'yes', line: 'Yes: turn back under their Immelmann and run, and they never catch you (9 of 9); meet a split-S from above and dive on them as their nose goes down through their half loop, and they are shot down on that one dive without a shot at you, whenever they split-S (6 of 9; in the other three they are too fast to split-S, and you take the Dip). Turning their Immelmann round onto their tail does not work: you get there, under their tail, too slow for the shot (0 of 9).' },
    // FLY IT is the Immelmann's counter: he has made his pass and gone by,
    // fast, 420 m in front of you.
    // FLY IT's ace: the lesson's, plus the school's one give-up rule
    // (README, "Can you survive it?"), as the Dip, Flip and Ninja met him.
    flyAce: 'taAce',
    ace: { plan: 'turnarounds', start: { at: [0, 295, -420], headingDeg: 0, speed: 74 } },
    you: { start: { at: [0, 300, 0], headingDeg: 0, speed: 56 } },
    demos: [
      { id: 'immelmann', label: 'You follow them up', seat: 'turnaroundsFollow', skill: 0.7, seconds: 16,
        aceStart: { at: [0, 275, -170], headingDeg: 0, speed: 76 },
        note: 'They went by 170 m in front of you and pull up. You pull straight up after them.' },
      { id: 'immelmann-counter', label: 'You meet them at the top', seat: 'turnaroundsMeetTop', skill: 0.7, seconds: 18,
        note: 'The same Immelmann, you 420 m back: you hold off, climb 20 degrees at the top of their loop and shoot as they hang there.' },
      { id: 'split', label: 'You let them go', seat: 'turnaroundsLetGo', skill: 0.7, seconds: 22,
        aceStart: { at: [40, 460, -760], headingDeg: 180, speed: 45 }, youStart: { at: [0, 600, 0], headingDeg: 0, speed: 52 },
        note: 'They are high and slow, you 140 m higher and coming at them. They split-S away; you fly on and keep your height.' },
      // The Dip, the Flip and the Ninja (reviews/dfn-ta.md): you in trouble,
      // against an ace who chases a runner he can catch, breaks when you
      // get on his tail and, bounced out of a split-S, turns to fight (`taAce`).
      { id: 'dip', kind: 'dip', label: 'The Dip: back under their loop', seat: 'taDip', skill: 0.85, ace: 'taAce', seconds: 32,
        aceStart: { at: [80, 295, -800], headingDeg: 180, speed: 74 }, youStart: { at: [0, 300, 0], headingDeg: 0, speed: 56 },
        note: 'Head on, they are 18 m/s faster. The moment they are past and pulling up, turn back flat at 60 degrees of bank and run under their loop the way they came, full throttle. They come over the top at 37 m/s facing the wrong way and have to turn round.',
        verdict: { works: 9, of: 9, line: 'In all nine they never fired: they rolled out over the top 232 to 281 m from you facing away, chased from about 200 to 230 m, were 487 to 566 m behind and not closing at 19 to 19.5 s, turned away, and you were 1700 to 1813 m apart at 32 s. Running straight on or a split-S out also got you clear in all nine.' } },
      // The Flip: the Immelmann he turns round with to come back down on you.
      // Shown to 23 s, as he turns back and the circle begins; scored over
      // 45 s, where it is the circle (dfn-ta.md, "Ascendancy").
      { id: 'flip', kind: 'flip', label: 'The Flip: round under their loop onto their tail', seat: 'taFlip', skill: 0.85, ace: 'taAce', seconds: 45, endAt: 23,
        aceStart: { at: [80, 295, -800], headingDeg: 180, speed: 74 }, youStart: { at: [0, 300, 0], headingDeg: 0, speed: 56 },
        note: 'Head on, they are 18 m/s faster, and they Immelmann to come back down on you. Turn back under their loop the moment they are past and keep turning, all the way round onto their heading: you come up under their tail, where their cockpit hides you, as they roll out slow. Then the nose on them, before they turn back. Here it fails: watch them see you and turn back. Even then, take the Dip.',
        verdict: { works: 0, of: 9, line: 'No: in all nine you were under their tail, unseen, with your nose coming on them, 15 s in, and they never fired; but the full circle leaves you at 41 to 43 m/s, and the nose reaches their lead only as they turn back to attack and see you. Fire that would land: 0 to 0.43 s. Flown on to 45 s it is a turning circle with them in all nine, nobody shooting. Diving after their split-S onto their tail did no better against an ace who turns to fight (0 of 9).' } },
      // The Ninja: a one-dive ambush on the split-S, from the `split` demo's
      // start. Too fast to split-S (30 m further out), he goes up instead: the Dip.
      { id: 'ninja', kind: 'ninja', label: 'The Ninja: one dive as their nose goes down, then away', seat: 'taNinja', skill: 0.85, ace: 'taAce', seconds: 50,
        aceStart: { at: [40, 460, -760], headingDeg: 180, speed: 45 }, youStart: { at: [0, 600, 0], headingDeg: 0, speed: 52 },
        note: 'A one-dive ambush. Meet them from above and hold your height while they roll over. When their nose is 25 degrees down through their half loop, committed and unable to see you, dive with the lead: you arrive as they come out and break, inside their turn. Take every shot, and if they are still flying, do not circle with them: away at full throttle.',
        verdict: { works: 6, of: 9, line: 'Partly, and it hangs on the timing: in the six starts where they split-S they were shot down on the dive, 10.6 to 11.0 s in, your fire that landed 1.1 to 1.3 s, their guns never on you. In the three that start 30 m further out they are too fast to split-S and go up past you instead: no ambush, and you take the Dip. Diving the moment they roll over, or once they are out, brought them down in under half the starts; following the dive with `ascend` circled with them for 35 to 40 s.' } },
    ],
    seconds: 40,
    coach: {
      pass: { line: 'They have gone past you fast, about to turn round', tip: 'Watch which way they go: up or down. Keep your speed.', keys: ['W'] },
      immelmann: { line: 'Immelmann: they are going up through half a loop', tip: 'Do not follow them up. Keep your speed and climb 20 degrees at the top of their loop.', keys: ['Mouse', 'W'] },
      rollout: { line: 'They are upside down on top, rolling upright', tip: 'They are slowest now. Nose on them and shoot.', keys: ['Mouse', 'Space'] },
      top: { line: 'They are on top going the other way, above you', tip: 'They are slow and coming back over you: shoot as they come, then keep your speed.', keys: ['Space', 'W'] },
      split: { line: 'Split-S: they rolled upside down', tip: 'They are giving you the height. Go down on them now.', keys: ['Mouse'] },
      pullthrough: { line: 'They are pulling through, going back the way they came below you', tip: 'Dive at where they will come out, not after them through their loop.', keys: ['Mouse'] },
      run: { line: 'They are running out of the split-S, fast and low', tip: 'Shoot as you close on them, then zoom back up.', keys: ['Space', 'W'] },
      attack: { line: 'They are coming back at you', tip: 'Turn to face them.', keys: ['Mouse', 'Arrows'] },
      chase: { line: 'They are after you, their height into speed', tip: 'Full throttle and keep going: once their height is spent they gain nothing on you.', keys: ['W'] },
      'let-go': { line: 'They have let you go', tip: 'You are out of the fight. Climb, and come back with the height.', keys: ['W'] },
      meet: { line: 'You turned back at them: they are turning to face you', tip: 'Do not meet them level and slow. Keep going, or come back with the height.', keys: ['W'] },
    },
  },
  {
    id: 'the-circle',
    title: 'Breaking the circle',
    tagline: 'Two equals turning round each other: nobody gets a shot. Six ways to break it, and which one does.',
    story: [
      'Two equal fighters each go for the other\'s tail and end up half a turn apart on one circle, each turning as hard as it holds its height. Pilots have called it the Lufbery since the First World War. Neither can bring the nose round onto the other, because neither turns faster.',
      'In a real aeroplane the way out is a trade: turn tighter by flying slower, or turn faster by flying at the corner speed, or take the fight up or down where gravity helps one of you. On BF1942\'s flight law a faster Spitfire turns faster at the same radius and nothing limits the pull, so between two Spitfires flown equally there is nothing to trade: 52 to 218 m apart for 30 s, and nobody gets a shot.',
      'Six ways to break it were flown against the school\'s hunter from nine starts each. One works.',
    ],
    counterStory: [
      'Leave it. Roll out on the circle\'s edge while they are across it going the other way, full throttle, nose a little down. They have half a circle to turn before their nose is on you, and an equal Spitfire behind you never closes: they chase you 160 to 235 m back, out of their guns\' reach, and give up 16 to 24 s later (7 of 9).',
      'What does not work, and why: straight up, they follow you shallow and keep their speed while you hang at 30 m/s. The throttle back only slows you, it does not turn you tighter. Reversing the turn makes it a head-on pass every half circle. Nose low you do come round behind them, but 100 m under them, and the climb back takes the speed. And once out, coming back for them, they see you coming and turn to meet you.',
      'Do not go into the circle with an equal. If you are in one, do not stay: every second in it is a second their friends have to find you.',
    ],
    survival: { verdict: 'yes', line: 'Yes, by leaving: roll out on the circle\'s edge while they are across it going the other way, full throttle, nose a little down, and they chase you out of their reach and give up (7 of 9). Nothing tried turns the circle round or puts you on top: going straight up, the throttle chop, reversing the turn, the nose-low turn and coming back after leaving all fail (0 of 9 each).' },
    // The deadlock: two equal Spitfires half a turn apart on one circle,
    // 122 m across, each turning right as hard as it holds its height. Each
    // starts wings level where its hard turn settles onto that circle (a
    // Spitfire turning right from 46 m/s settles 73 m right of where it
    // rolled in and 50 m ahead of it).
    // FLY IT's ace: the school's hunter (`btHunter`), who turns after you
    // round the circle, follows a climb shallow, chases anyone who runs and
    // gives up a chase he cannot close.
    flyAce: 'btHunter',
    ace: { plan: 'btHunter', start: { at: [73, 400, -49.5], headingDeg: 180, speed: 46 } },
    you: { start: { at: [-73, 400, 49.5], headingDeg: 0, speed: 46 } },
    demos: [
      { id: 'circle', label: 'You turn with them', seat: 'ciCircle', skill: 0.85, seconds: 30,
        note: 'The deadlock: half a turn apart on one circle, both turning as hard as it goes. Watch the gun lines: neither nose ever comes round onto the other.' },
      { id: 'dip', kind: 'dip', tab: 'leave', label: 'The Dip: out of the circle', seat: 'ciDip', skill: 0.85, seconds: 40,
        note: 'Eight seconds of the circle, then out: wings level on the circle\'s edge while they are across it going the other way, full throttle, nose 6 degrees down to 150 m. You do not look back.',
        verdict: { works: 7, of: 9, line: 'In seven they turn after you and chase you 160 to 235 m back, out of their reach, never fire, give up 16 to 24 s after you left and climb away; at 40 s you are 1.1 to 2 km apart and opening. From 30 m to your right and 10 m higher or lower they never give up: still 274 to 291 m behind at 40 s, their guns on you for 5 s at a range where they hold their fire.' } },
      { id: 'zoom', kind: 'ninja', tab: 'go vertical', label: 'The Ninja: straight up out of the circle, tried', seat: 'ciZoom', skill: 0.85, seconds: 30,
        note: 'Going vertical: out of the circle straight up at 60 degrees, to come over the top and down on them. What you see is it failing: they follow you up shallow, and over the top they are behind you, not under your nose.',
        verdict: { works: 0, of: 9, line: 'In all nine you top out 38 to 48 m over them at 30 m/s while they still have 41 to 43: they followed you up shallow and sit on your tail for 1 to 9 s as you hang. Over the top they are never under your nose, so there is no dive, and from 16.5 s you are back in a circle with them, 54 to 160 m apart at 30 s; in two they hit you as you hang (6 and 8 rounds). You never have a shot.' } },
      { id: 'back', kind: 'ninja', tab: 'out and back', label: 'The Ninja: out, then back under their tail, tried', seat: 'ciBack', skill: 0.85, seconds: 70,
        note: 'Leave as the Dip does, run 22 s, then turn back and come in under their tail, where the cockpit hides you, for a burst. What you see is it failing: here they have not let you go, and turning back puts you head-on to them.',
        verdict: { works: 0, of: 9, line: 'Never a burst from under their tail: one round lands, on a head-on pass. In six they had let you go, but they turn to look for you, see you coming and turn to meet you (38 to 52 s), or pass you head-on; in three they were still chasing when you turned back, and the pass is head-on. Six of the passes come within 2 to 24 m, and in one they land 4 rounds on you.' } },
      { id: 'chop', kind: 'flip', tab: 'throttle chop', label: 'The Flip: throttle back to turn inside them, tried', seat: 'ciChop', skill: 0.85, seconds: 30,
        note: 'The throttle back (S) in the circle, to turn inside them. What you see is it failing: a slower Spitfire turns no tighter here, only slower, and sinks.',
        verdict: { works: 0, of: 9, line: 'In all nine you slow to 27 or 28 m/s and hang under 35 for 5 s, sink 50 to 70 m under them and end 42 to 94 m of energy behind them, and never come behind them (nobody has a shot). There is nobody close behind you to fly past, which is what the chop is for.' } },
      { id: 'reverse', kind: 'flip', tab: 'reverse', label: 'The Flip: reverse the turn, tried', seat: 'ciReverse', skill: 0.85, seconds: 35,
        note: 'Roll out of the circle into the opposite turn, so that you meet them. What you see is it failing: two equal Spitfires turning opposite ways meet head-on every half circle, with no time for a shot.',
        verdict: { works: 0, of: 9, line: 'You never have a shot that lands. In five you meet head-on 22 s in and pass 15 to 21 m apart; in the other four the circle simply turns the other way, 71 to 83 m apart at the closest, and they snap you in two (1 and 3 rounds).' } },
      { id: 'low', kind: 'flip', tab: 'nose low', label: 'The Flip: nose low round the circle, then up into them, tried', seat: 'ciLow', skill: 0.85, seconds: 40,
        note: 'The circle flown nose low: the engine\'s gravity adds speed, and a faster Spitfire turns faster, so you gain on them round the circle. Then up into them from below. What you see is it nearly working: you get round behind them, but far under them, and the climb takes the speed.',
        verdict: { works: 0, of: 9, line: 'In all nine you come round behind them (95 to 135 degrees round behind their heading, seen from above) 17 to 24 s in, but 70 to 131 m under them; the pull up to them takes you from 50 to 28-38 m/s before the nose gets there. One burst lands, 7 rounds in one of the nine; they never fire, and in five they see you coming up and break.' } },
    ],
    seconds: 40,
    coach: {
      hunt: { line: 'They are closing on you', tip: 'Turn hard into them before they are inside 270 m.', keys: ['Mouse', 'Arrows'] },
      track: { line: 'They are on your tail, closing', tip: 'Break turn into them, hard, now.', keys: ['Mouse', 'Arrows'] },
      lag: { line: 'In the circle with you, half a turn behind', tip: 'Neither of you gains here. Roll out while they are across the circle going the other way, full throttle, nose a little down.', keys: ['Mouse', 'W'] },
      follow: { line: 'They are following you up, shallow', tip: 'They keep their speed and you lose yours: level off before you hang.', keys: ['Mouse'] },
      extend: { line: 'They flew past you and are running', tip: 'Let them go, or turn after them at full throttle.', keys: ['W', 'Mouse'] },
      headon: { line: 'Head-on: nobody on anybody\'s tail', tip: 'A pass is no time for a shot. Keep turning, or leave on the far side.', keys: ['Mouse', 'Arrows'] },
      'let-go': { line: 'They have let you go', tip: 'You are out of the circle. Keep going, or climb and come back with the height.', keys: ['W'] },
      meet: { line: 'You came back at them: they are turning to face you', tip: 'They have seen you. Pass them and keep going, never back into the circle.', keys: ['Mouse', 'W'] },
    },
  },
  {
    id: 'free',
    title: 'Against the ace',
    tagline: 'No script: they pick their own moves. Use everything.',
    story: [
      'The school\'s ace picks from the moves its fights proved. Behind you, they never let you run. Coming at them, they turn to face you instead of climbing away. With you on their tail, they break into you, and if you stay close they chop their throttle to make you fly past. With height over you, they bounce you and zoom back up. When you climb away, they follow shallow.',
      'Flown against every other pilot in the school from ten starts each, the ace landed 128 hits and took 82. The ace it replaced landed 9 and took 178.',
      'The coach tells you which move they are on and what beats it.',
    ],
    counterStory: [
      'Keep your speed above 50 m/s. Turn to face every dive. When they climb away, follow shallow. If they break, do not sit 50 m behind them in their circle: they will chop their throttle and you will be in front. Lose sight, lose the fight.',
    ],
    ace: { plan: 'ace', start: { at: [0, 360, -900], headingDeg: 180, speed: 60 } },
    you: { start: { at: [0, 300, 0], headingDeg: 0, speed: 58 } },
    demos: [],
    seconds: 60,
    coach: {
      climb: { line: 'They are climbing round you, out of reach', tip: 'Climb too, shallow, and keep them in sight. Do not let them get above you for free.', keys: ['W'] },
      dive: { line: 'They are diving on you', tip: 'Turn to face them: make it head on.', keys: ['Mouse', 'Arrows'] },
      zoom: { line: 'They are zooming back up', tip: 'Follow shallow. Stay fast.', keys: ['W'] },
      over: { line: 'They are going over the top', tip: 'They are slow up there: nose on them and shoot.', keys: ['Mouse', 'Space'] },
      break: { line: 'They broke into you', tip: 'Do not sit close behind them in their circle: pull up out of it, or they chop their throttle and you fly past.', keys: ['Mouse', 'S'] },
      meet: { line: 'They turned to face you', tip: 'A head-on pass: shoot early, then turn the way they are going.', keys: ['Space', 'Mouse'] },
      attack: { line: 'They are behind you, closing', tip: 'Break turn into them, hard, before they are inside 270 m.', keys: ['Mouse', 'Arrows'] },
      follow: { line: 'They are following you up, shallow', tip: 'Do not hang at the top: tip over before you are slow.', keys: ['Mouse'] },
    },
  },
  {
    // Boelcke's rule 3 as a drill (features/dogfight-doctrine): a target
    // that never shoots back, and the score is range.
    id: 'gunnery',
    title: 'Gunnery: close, then closer',
    tagline: 'A target that never shoots back. Hold fire until you are close.',
    story: [
      'Boelcke\'s third rule (1916): fire only at close range, and only with the target properly in your sights. In the players\' recorded fights, 25 rounds in 100 hit from inside 100 m, 13 from 300 to 400 m, and 1 from farther out.',
      'In vanilla BF1942 the two wing guns\' streams part past the target\'s wingtips beyond about 270 m. In BF1918 a machine-gun round does full damage only to 100 m and 30% from 150 m; in Forgotten Hope the rounds weaken from the muzzle.',
      'The target flies straight, turns gently, jinks and climbs, round and round. The score under the coach counts your rounds, your hits, and how many you fired past your guns\' useful range.',
    ],
    counterStory: [
      'Close to the useful range before you fire: the coach says when. Fire short bursts while the target flies straight or turns steadily; hold your fire while it jinks.',
    ],
    ace: { plan: 'target', start: { at: [0, 330, -500], headingDeg: 0, speed: 50 } },
    you: { start: { at: [0, 300, 0], headingDeg: 0, speed: 60 } },
    demos: [],
    seconds: 90,
    drill: 'gunnery',
    // The guide and the instructor close in behind it and shoot.
    guide: 'chaser',
    coach: {
      straight: { line: 'The target is flying straight', tip: 'The easy shot: close in behind it, then a short burst.', keys: ['Mouse', 'Space'] },
      turn: { line: 'The target is turning', tip: 'Lead it: put the sight a little ahead, inside its turn.', keys: ['Mouse', 'Space'] },
      jink: { line: 'The target is jinking', tip: 'Hold your fire until it steadies. Stay close.', keys: ['Mouse'] },
      climb: { line: 'The target is climbing round', tip: 'Lead it up and round. Keep your speed.', keys: ['Mouse', 'W'] },
    },
  },
];

export const lessonById = id => LESSONS.find(l => l.id === id) ?? null;

/**
 * The fights in which a pilot does nothing: flies straight and never looks
 * up, or never reacts to the attack. They left the lessons' tabs (a pilot who
 * does nothing teaches nothing to watch), but the stories still quote what
 * they measured ("the pilot who never looked up was shot down every time"),
 * so the school's tests still fly them, from here. Not shown anywhere.
 */
export const RETIRED_DEMOS = {
  'boom-and-zoom': [{ id: 'move', seat: 'unaware', skill: 0.55 }],
  'out-of-the-lock': [{ id: 'without', seat: 'cruiser', skill: 0.85 }],
  'break-turn': [{ id: 'without', ace: 'cruiser', seat: 'chaser', skill: 0.55 }],
};

/** A lesson's demo by id, the retired ones included (for the tests). */
export const demoById = (lesson, id) =>
  lesson.demos.find(d => d.id === id) ?? RETIRED_DEMOS[lesson.id]?.find(d => d.id === id) ?? null;

/** What the keys are called on the Air control map (controls-defaults.js). */
export const KEY_WORDS = {
  W: 'W: throttle up',
  S: 'S: throttle back (a brake after 3 s)',
  Mouse: 'Mouse: roll and pitch',
  Arrows: 'Arrows: roll and pitch',
  Space: 'Space: fire',
  AD: 'A / D: rudder',
  X: 'X: extend the scene',
};

/** Rules of thumb for the school's tip line. */
export const RULES = [
  'Speed is life. Below 30 m/s a Spitfire can barely turn.',
  'Height is speed in the bank: a dive turns it back into speed.',
  'Turn to face every dive. A head-on pass is a short pass.',
  'When they climb away, follow shallow: their steep climb spends their speed.',
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
    guide: lesson.guide ?? lesson.demos.find(d => d.id === 'counter')?.seat ?? best?.seat ?? 'meetTheDive',
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
