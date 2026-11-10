// On their tail on a jet (features/dogfight-lessons-jets/on-his-tail.md).
//
// The F-16's single cannon has no crossing point, so its pilot opens fire
// inside 512 m where a Spitfire's wing guns open at 268, and the breaker
// breaks that much further out. Rushing in is still nobody's kill (0 to 3
// rounds a fight). What changes is the way out: leaving their circle when
// they are across it going away leaves them coming round 73 to 353 m
// behind you, inside that reach, and was shot down from all nine starts.
// Never going in (`jetOtLeave`: straight on at their break, 15 to 18 m/s
// faster than them) got clear and unhit from all nine. Getting on top does not work on a jet
// either: they climb as well as you do.
//
// Every number below is the F-16's, real metres and m/s, from
// `test_dogfight_jet_on_his_tail.py`: the school's nine starts (x and speed)
// for the story, the measure's nine (`dogfight-measure.js` STARTS) for each
// verdict.
export default {
  note: 'Their cannon opens fire from 530 m, nearly twice the reach of a Spitfire\'s guns, so the half circle that let a Spitfire leave their turn leaves you inside it: shot down in nine of nine. Holding your line at their break, you were past them and clear in all nine, never hit.',
  tagline: 'You are behind them and they break. Nobody gets a shot in their turn, and their cannon reaches anyone who leaves it. So do not follow them in: when they break, keep going.',
  story: [
    'You get in behind them, full throttle, nose on them. They see you and break: turn as hard as it goes, into you.',
    'A jet\'s single cannon has no crossing point: both of you open fire from about 530 m, not 270, and they break that much sooner, 436 to 543 m out. Rushing in, you fire as they break and land 0 to 3 rounds, all between 2.2 s before their break and 4 s after it. Then you come past their tail 49 to 60 m from them and sit 104 to 110 m behind them in their turn, your nose 51 to 53 degrees off them, and nobody comes down.',
    'Sit close behind them in their turn and a good pilot throttles back and pulls up to make you fly past them.',
  ],
  counterStory: [
    'Do not sit in their circle. A jet turning hard at 75 m/s turns 68 to 70 degrees a second, round a circle 123 to 127 m across: no lead you can pull follows that.',
    'And do not leave it the way a Spitfire does, when they are across it going away. Half a circle is not enough: they come round in behind you, 73 to 353 m back at the closest, inside their cannon\'s reach, and shoot you down 13 to 16 s after you leave.',
    'The way out is never to go in. You arrive 15 to 18 m/s faster than them; when they break, hold your line: wings level, full throttle, nose a little down. You go past them 80 to 91 m off while they turn into you, and by the time they are round you are out of their reach and opening. They do not come after you.',
    'Getting on top does not work either. A jet does not run out of speed going up: climb beside their break and they come up too, and both of you level off under the roof, between 805 and 836 m, with nobody in a place to shoot. Up there, level and fast, they come round onto your tail and sit there, never with a shot that would land.',
    'Flown nine times from slightly different starts: rushing in landed 0 to 3 rounds a fight and brought nobody down. Holding your line at their break got you clear and unhit nine times in nine; leaving their circle later was shot down nine times in nine. Climbing beside their break shot nobody down.',
  ],
  demos: {
    move: {
      note: 'Full throttle, nose on them. They break 436 to 543 m out, inside a jet cannon\'s reach; you come past their tail 49 to 60 m from them and end up 104 to 110 m behind them in their turn, your nose 51 to 53 degrees off them: no lead.',
    },
    dip: {
      label: 'The Dip: not into their circle', seat: 'jetOtLeave',
      steps: { steps: [
        { phase: 'close', say: 'Come in on their tail 15 to 18 m/s faster than them' },
        { phase: 'dip-out', say: 'They break: do not turn after them. Wings level, full throttle (W), nose 6° down, and keep going' },
      ] },
      note: 'Arrive 15 to 18 m/s faster than them. When they break, do not turn after them: hold your line, wings level, full throttle, nose 6 degrees down. You go past them while they turn into you, and you are gone before their nose is round.',
      verdict: { works: 9, of: 9, line: 'Out in all nine and never hit: you passed them 75 to 97 m off, their guns never had you, they never came after you, and at 40 s you were 2603 to 3193 m apart and opening. Leaving the Spitfire\'s way, when they are across their circle going away, was shot down in all nine, 13 to 16 s after leaving.' },
    },
    flip: {
      verdict: { works: 0, of: 9, line: 'In all nine you were never hit, and from the pull-up on your guns never had them: in their rear quarter with your nose on them for 1.33 s at most. The 0 to 2 rounds you land come in their circle before it, at 242 to 260 m. A jet keeps its speed over the top (80 to 83 m/s at the end), but you get no higher than them.' },
    },
    ninja: {
      label: 'The Ninja: up beside their break, and they come up too',
      note: 'The Spitfire\'s best try at getting on top: when they break you climb beside their circle instead of following them in. A jet does not run out of speed going up: they come up too, after you or away from you, and both of you level off under the roof, between 805 and 836 m. Nobody is in a place to shoot, and nobody is hit.',
      verdict: { works: 0, of: 9, line: 'None of the nine: no kill, 2 rounds landed, in one of the nine, and 0.17 s of a shot that would land. They never had a shot on you that would land, but level under the roof they came round onto your tail and sat there, for 13 to 38 s in 7 of 9.' },
    },
  },
  survival: { verdict: 'yes', line: 'Yes, by never going in: when they break, hold your line at full throttle and you are clear and unhit in 9 of 9. Leave their circle once you are in it and their cannon gets you (shot down in 9 of 9). Nothing found gets you on top, over their circle or up beside it (0 of 9 each).' },
  coach: {
    watch: { line: 'They have not broken yet', tip: 'When they break, do not follow them into their turn: hold your line, full throttle (W).', keys: ['W'] },
    break: { line: 'They broke into you', tip: 'Do not turn after them: wings level, full throttle (W), nose a little down. You are past them before they are round.', keys: ['Mouse', 'W'] },
    climb: { line: 'They stopped turning: they are climbing away to take the height back', tip: 'They climb as well as you do: there is no pass from above to be had. Leave, full throttle (W).', keys: ['W'] },
    chop: { line: 'They chopped their throttle and pulled up: you are closing fast', tip: 'Pull up and out of their turn now, or you fly through underneath them.', keys: ['Mouse', 'S'] },
    reverse: { line: 'They are turning onto you', tip: 'Close behind you: break turn hard into them. Do not run inside 530 m: their cannon reaches you there.', keys: ['Mouse', 'Arrows'] },
    chase: { line: 'They are chasing you, out past their cannon\'s reach', tip: 'Wings level, full throttle (W), and stay out past 530 m: inside it their cannon reaches you.', keys: ['W'] },
    letgo: { line: 'They gave up the chase: they are turning away and climbing', tip: 'Keep going. Turn back at them and they turn to meet you.', keys: ['W'] },
    meet: { line: 'You turned back: they are turning to meet you head-on', tip: 'Pass over them, not through them, and keep going: they will not let you behind them.', keys: ['Mouse', 'W'] },
    extend: { line: 'They flew past you and are running', tip: 'Nose on them and shoot now if they are close: they are getting away.', keys: ['Space', 'Mouse'] },
  },
};
