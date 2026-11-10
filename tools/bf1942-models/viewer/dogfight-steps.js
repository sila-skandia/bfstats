// The three ways out of a fight, in plain words (features/dogfight-school,
// "Move cards"). The school calls them the Dip, the Flip and the Ninja; a
// pilot calls them an extension, a reversal and a bounce, and so do the
// recorded fights' manoeuvre tags (`dogfight-manoeuvres.js`). Each move
// demo gets a short list of steps, each anchored to a phase of the seat's
// plan (`dogfight-pilot.js`), so its marker on the path and the timeline
// lands where the flown demo really does it.

/** The moves: their real name, the school's nickname, and what each is for. */
export const MOVE_INFO = {
  dip: {
    name: 'Extension', nick: 'the Dip',
    what: 'Leave the fight. Get out of their reach at full speed and keep going until they give up.',
  },
  flip: {
    name: 'Reversal', nick: 'the Flip',
    what: 'Turn the tables. Make the chaser fly past you, then get onto their tail.',
  },
  ninja: {
    name: 'Bounce', nick: 'the Ninja',
    what: 'Take the upper hand. Attack from above, or from where they cannot see you, then get away before they answer.',
  },
};

/**
 * Each move demo's steps, by `<lesson>/<demo>`. A step is `{ phase, say }`:
 * `say` is what to do, short, with the key in brackets where one matters,
 * and its time is the first tick at or after the step before it where the
 * seat's plan is in `phase` (`stepTimes`). `why`, for a move that rarely or
 * only sometimes works, says what goes wrong.
 */
export const STEPS = {
  'boom-and-zoom/dip': { steps: [
    { phase: 'climb', say: 'Keep your speed and climb shallow, watching them' },
    { phase: 'face', say: 'They dive: turn to face them, a head-on pass' },
    { phase: 'dip-run', say: 'Their zoom takes them up: run, full throttle (W), nose 6° down to 150 m' },
  ] },
  'boom-and-zoom/flip': { why: 'At even energy your nose never comes onto them: no shot.', steps: [
    { phase: 'climb', say: 'Their height is spent: climb level with them' },
    { phase: 'flip-in', say: 'Their nose turns away: in behind them with the lead' },
    { phase: 'flip-leave', say: 'No shot in 3 to 5 s: up and away, never round after them' },
  ] },
  'boom-and-zoom/ninja': { why: 'They turn to face your dive, as you met theirs.', steps: [
    { phase: 'climb', say: 'Climb with them until you are 35 m above' },
    { phase: 'ninja-perch', say: 'Turn toward them' },
    { phase: 'ninja-dive', say: 'One pass down on them with the lead (Space)' },
    { phase: 'ninja-run', say: 'No shot: run on the dive\'s speed' },
  ] },
  'under-the-height/dip': { steps: [
    { phase: 'climb', say: 'Climb while they are not coming at you (W)' },
    { phase: 'break', say: 'They dive inside 380 m: break hard, into them' },
    { phase: 'dip-run', say: 'Their height spent, yours won: run, nose 2° down, flat out' },
  ] },
  'under-the-height/flip': { why: 'If they do not fly past you slow, there is no tail to reverse onto.', steps: [
    { phase: 'climb', say: 'Climb while they are not coming at you (W)' },
    { phase: 'break', say: 'They dive: break hard, into them' },
    { phase: 'flip-reverse', say: 'They go past you slow: reverse onto their tail' },
    { phase: 'dive', say: 'With the energy yours, down on them from above' },
  ] },
  'under-the-height/ninja': { why: 'Shown: the one fight in nine where the first dive kills. Usually they meet it.', steps: [
    { phase: 'climb', say: 'Break their dives and climb in between (W)' },
    { phase: 'find', say: 'The height is yours: wait for their nose to go away' },
    { phase: 'dive', say: 'Down on them with the lead (Space)' },
    { phase: 'zoom', say: 'Up again before they turn onto you' },
  ] },
  'up-and-over/dip': { steps: [
    { phase: 'chase', say: 'On their tail, closing' },
    { phase: 'dip-follow', say: 'They pull straight up: climb after them at 30°, not into their climb' },
    { phase: 'dip-pass', say: 'Over the top: fly past beside and under their dive' },
    { phase: 'dip-run', say: 'Full throttle (W), straight away' },
  ] },
  'up-and-over/flip': { why: 'They come out of the loop with the speed: you never get behind them.', steps: [
    { phase: 'chase', say: 'On their tail, closing' },
    { phase: 'up', say: 'Follow them up as steep as they go' },
    { phase: 'flip-dive', say: 'Out of speed under their loop: nose down, off their line' },
    { phase: 'flip-slice', say: 'Round onto their line, nose low' },
  ] },
  'up-and-over/ninja': { why: 'When they see you climbing back, it is over: leave.', steps: [
    { phase: 'ninja-follow', say: 'Climb after them at 24°, the nose under them' },
    { phase: 'ninja-shoot', say: 'Shoot as they slow over the top (Space)' },
    { phase: 'ninja-slice', say: 'Push down past their dive, slice round under their tail' },
    { phase: 'ninja-stalk', say: 'They have lost you: close in behind and shoot' },
    { phase: 'leave', say: 'They see you: leave, never turn with them' },
  ] },
  'out-of-the-lock/dip': { steps: [
    { phase: 'turn', say: 'Seen far back: turn hard into them' },
    { phase: 'meet', say: 'Head on, aim 50 m under them' },
    { phase: 'dip-run', say: 'Past them: run, full throttle (W), nose 2° down' },
  ] },
  'out-of-the-lock/flip': { why: 'Their nose follows you round: the shot rarely bears.', steps: [
    { phase: 'turn', say: 'Seen far back: turn hard into them' },
    { phase: 'meet', say: 'Head on, aim 80 m under them' },
    { phase: 'flip-up', say: 'They pass overhead: pull up behind them' },
    { phase: 'dive', say: 'Down on them across their beam with the lead' },
  ] },
  'out-of-the-lock/ninja': { why: 'Their nose follows you: no second pass without meeting it head on.', steps: [
    { phase: 'turn', say: 'Seen far back: turn hard into them' },
    { phase: 'meet', say: 'Head on, aim 80 m under them' },
    { phase: 'ninja-up', say: 'They pass overhead: pull up behind them' },
    { phase: 'dive', say: 'One pass down on them' },
    { phase: 'ninja-perch', say: 'Up and away from their nose' },
  ] },
  'on-his-tail/dip': { why: 'Roll out early and their nose is on you before you are clear.', steps: [
    { phase: 'close', say: 'Close on their tail at their speed' },
    { phase: 'circle', say: 'They break: round their circle after them' },
    { phase: 'dip-out', say: 'They are across the circle going away: roll out, full throttle, shallow dive' },
  ] },
  'on-his-tail/flip': { why: 'At their speed there is no height to spend: they turn away as fast as you dive.', steps: [
    { phase: 'circle', say: 'In their circle, going nowhere' },
    { phase: 'flip-up', say: 'Pull up out of the circle, over their turn' },
    { phase: 'flip-dive', say: 'Down at them from over their tail' },
  ] },
  'on-his-tail/ninja': { why: 'The pass rarely kills, and they turn after you onto your tail.', steps: [
    { phase: 'ninja-climb', say: 'They break: climb beside their circle, not into it' },
    { phase: 'find', say: 'Above them: wait for their nose to go away' },
    { phase: 'dive', say: 'Down on them from behind, guns inside 230 m' },
    { phase: 'zoom', say: 'Off them and up past them' },
  ] },
  'break-turn/dip': { steps: [
    { phase: 'break', say: 'Break into them at once, 500 m out' },
    { phase: 'zoom', say: 'Once they are past, go up at 70°: they follow and slow' },
    { phase: 'over', say: 'Over the top: wait for their nose to come off you' },
    { phase: 'dip-run', say: 'Away, full throttle (W), the nose a little down' },
  ] },
  'break-turn/flip': { why: 'They meet every dive: you never stay behind them.', steps: [
    { phase: 'watch', say: 'Fly straight, watching them close' },
    { phase: 'break', say: 'Break hard into them at 360 m' },
    { phase: 'turn', say: 'Hold your height in the circle' },
    { phase: 'flip-guns', say: 'Zoom out of it, then down on them with the lead' },
    { phase: 'flip-up', say: 'Off them and up before they turn in' },
  ] },
  'break-turn/ninja': { why: 'Their nose never leaves you, so there is no dive to make.', steps: [
    { phase: 'break', say: 'Break into them at once, 500 m out' },
    { phase: 'zoom', say: 'Once they are past, go up at 70°' },
    { phase: 'over', say: 'Over the top: wait for their nose to leave you' },
    { phase: 'leave', say: 'It never does: leave while they are slow' },
  ] },
  'scissors/dip': { why: 'Leave at the wrong crossing and you run down their nose.', steps: [
    { phase: 'reverse', say: 'Turn into them as your paths cross' },
    { phase: 'cross', say: 'Crossed: reverse back into them' },
    { phase: 'dip-run', say: 'Next crossing, do not reverse: full throttle, shallow dive away' },
  ] },
  'scissors/flip': { why: 'They never drift out in front: you sink under them.', steps: [
    { phase: 'reverse', say: 'Turn into them as your paths cross' },
    { phase: 'flip-reverse', say: 'Throttle back (S): fly the scissors slower than them' },
    { phase: 'flip-cross', say: 'Cross and reverse again' },
  ] },
  'scissors/ninja': { why: 'They climb with you and turn toward you: the dive misses.', steps: [
    { phase: 'ninja-up', say: 'Do not scissor: go up 45° on your extra speed (W)' },
    { phase: 'over', say: 'Over the top toward them' },
    { phase: 'find', say: 'Nose down toward them for the dive' },
  ] },
  'turnarounds/dip': { steps: [
    { phase: 'pass', say: 'Head on, holding your height' },
    { phase: 'dip-turn', say: 'They pass and pull up: turn back flat, 60° of bank' },
    { phase: 'dip-run', say: 'Run under their loop the way they came, full throttle (W)' },
  ] },
  'turnarounds/flip': { why: 'They see you and turn back before the shot.', steps: [
    { phase: 'pass', say: 'Head on, holding your height' },
    { phase: 'flip-turn', say: 'Turn under their loop, all the way onto their heading' },
    { phase: 'flip-climb', say: 'Under their tail, unseen: the nose on them, guns' },
    { phase: 'flip-seen', say: 'They see you and turn back: extend instead' },
  ] },
  'turnarounds/ninja': { why: 'Dive too early and they see you coming.', steps: [
    { phase: 'wait', say: 'Above them, hold your height while they roll over' },
    { phase: 'dive', say: 'Their nose 25° down through the half loop: dive with the lead' },
    { phase: 'dip-out', say: 'Off them before you pass: away at full throttle (W)' },
  ] },
  // Breaking the circle: one extension and five tries that fail, each
  // flown from the same deadlock (features/dogfight-school, "Breaking the circle").
  'the-circle/dip': { steps: [
    { phase: 'circle', say: 'Half a turn apart, both turning hard: nobody gains' },
    { phase: 'dip-run', say: 'They are across the circle going away: roll out, full throttle (W), nose 6° down' },
  ] },
  'the-circle/zoom': { why: 'They follow you up shallow and keep their speed: you come down into the same circle.', steps: [
    { phase: 'circle', say: 'Half a turn apart, both turning hard: nobody gains' },
    { phase: 'zoom', say: 'Straight up out of the circle, 60°: your speed into height' },
    { phase: 'over', say: 'Slow at the top: over toward them' },
    { phase: 'again', say: 'They followed you up: back in the circle, level again' },
  ] },
  'the-circle/back': { why: 'They look round for you, see you coming and turn to meet you: a head-on pass.', steps: [
    { phase: 'circle', say: 'Half a turn apart, both turning hard: nobody gains' },
    { phase: 'out', say: 'Out of the circle while they are across it (W)' },
    { phase: 'back', say: 'Clear of them: turn back to come in under their tail' },
    { phase: 'off', say: 'They have turned to meet you: past them and away' },
  ] },
  'the-circle/chop': { why: 'Slower turns no tighter here, only slower: you sink under them and hand them the energy.', steps: [
    { phase: 'circle', say: 'Half a turn apart, both turning hard: nobody gains' },
    { phase: 'flip-chop', say: 'Throttle back (S) to turn inside them: you only slow and sink' },
  ] },
  'the-circle/reverse': { why: 'Turning opposite ways you meet head-on every half circle: no time for a shot.', steps: [
    { phase: 'circle', say: 'Half a turn apart, both turning hard: nobody gains' },
    { phase: 'flip-reverse', say: 'Roll into the opposite turn, toward them' },
    { phase: 'flip-guns', say: 'Head-on as you meet: a snap at best, then the circle again' },
  ] },
  'the-circle/low': { why: 'Getting round behind them costs 100 m of height, and the climb back costs the speed.', steps: [
    { phase: 'circle', say: 'Half a turn apart, both turning hard: nobody gains' },
    { phase: 'flip-low', say: 'Nose low in the turn: the speed it gains turns you faster' },
    { phase: 'flip-up', say: 'Round behind them, 100 m under: pull up into them, guns (Space)' },
    { phase: 'flip-off', say: 'Out of speed short of them: back into the turn' },
  ] },
};

/** A demo's label with the move's pilot name in front of what it does:
 *  "The Dip: meet them, then run" reads "Extension: meet them, then run".
 *  Any other demo's label is its own. */
export function moveLabel(demo) {
  const info = MOVE_INFO[demo?.kind];
  if (!info) return demo?.label ?? '';
  return `${info.name}: ${String(demo.label).replace(/^The (Dip|Flip|Ninja)\s*[:\-]\s*/i, '')}`;
}

/**
 * A demo's steps and why it fails, or null for a demo that is not a move.
 * `lesson` is a lesson or its id. A demo may carry a card of its own
 * (`steps: { why, steps }`), which is how a lesson's jet file gives a move
 * it re-flew its steps (`dogfight-lessons.js` `lessonFor`). A jet lesson's
 * other moves have none: the lists here are the Spitfire's, their distances
 * and speeds its own, and a jet's verdict line says what the move does there.
 */
export function stepsOf(lesson, demoId) {
  if (lesson && typeof lesson === 'object') {
    const own = lesson.demos?.find(d => d.id === demoId)?.steps;
    if (own) return own;
    if (lesson.era === 'jet') return null;
    return STEPS[`${lesson.id}/${demoId}`] ?? null;
  }
  return STEPS[`${lesson}/${demoId}`] ?? null;
}

/**
 * When each step happens in a flown fight: the first tick of `track` (the
 * seat's samples, each with its plan's phase in `ph`) from `from` seconds
 * on, and after the step before it, whose phase is the step's. A step whose
 * phase never comes has no time (`t: null`), and neither does any after it.
 */
export function stepTimes(track, steps, from = 0) {
  let after = from - 1e-9, lost = false;
  return steps.map(step => {
    if (lost) return { ...step, t: null };
    const k = track.find(s => s.t >= after && s.ph === step.phase);
    if (!k) { lost = true; return { ...step, t: null }; }
    after = k.t;
    return { ...step, t: k.t };
  });
}

/**
 * The move a lesson answers best with: the highest score among its Dip,
 * Flip and Ninja, if it works sometimes or better (3 of 9 and up), else null.
 */
export function bestMove(demos) {
  let best = null;
  for (const d of demos) {
    if (!MOVE_INFO[d.kind] || !d.verdict) continue;
    if (d.verdict.works >= 3 && (!best || d.verdict.works > best.verdict.works)) best = d;
  }
  return best?.id ?? null;
}
