# Re-tuning one lesson for jets

The job, for one lesson `<id>` of the dogfight school. Written so that one
person, or one agent, can take one lesson without touching another's files.
What a jet is to the school, and where each lesson stands, is in
[README.md](README.md): read it first.

## Read

1. [README.md](README.md).
2. The lesson: `tools/bf1942-models/viewer/dogfight-lessons.js`, the object
   with the id (story, counterStory, ace, you, demos, survival, coach).
3. Its plans in `tools/bf1942-models/viewer/dogfight-pilot.js`: `PLANS.<name>`
   for the ace's plan and each demo's `seat`. Grep the names; the file is
   5,000 lines. Read enough of the helpers near its top (`geometry`, `go`,
   `leadPursuit`, `turnToward`, how `mem` is used) to follow a plan.
4. How the Spitfire version is held: `tests/test_dogfight_school.py` (grep
   the lesson's tests), its review notes in
   `features/dogfight-school/reviews/`, and its `tests/test_dogfight_dfn_*.py`
   and `test_dogfight_shape_*.py`.
5. The lesson already done, as the pattern:
   `viewer/dogfight-jet-boom-and-zoom.js` and `BoomAndZoomOnAJetTests` in
   `tests/test_dogfight_jets.py`.

## Do

Make the lesson true on the F-16, and say so with numbers.

- **Fly it first.** From `tools/bf1942-models`:
  `node tests/dogfight_jet_harness.mjs <id> --text` gives the nine starts of
  each demo; `--trace <demo> [--step 1] [--start 0..8]` one fight's timeline;
  `--demo <demo>` one demo (a retired demo the stories quote, such as `move`
  or `without`, is reached this way); `--base` the lesson as written;
  `--plane Mig29` the other jet. Understand why each fight goes as it does
  before changing anything.
- **Then decide, claim by claim.**
  (a) If the claim is true of a jet once the fight is set up for one, tune
  it until it holds from the nine starts: a side's or a demo's `memory`
  values that the plan reads, the starts, `seconds`, which plan a seat
  flies, or a jet plan of your own.
  (b) If the jet makes the claim false in a way that is itself the lesson (a
  jet does not run out of speed going up), keep the fight honest and rewrite
  the lesson's words for the jet (`story`, `counterStory`, a demo's `label`
  and `note`, `survival`, `coach` lines, as needed) to say what the jet
  does, with numbers from the nine flights.
  Never bend a fight until the Spitfire's words come true when they are not
  true of a jet. Prefer (a) where the tactic is real for jets.
- **The extra moves** (demos with a `kind`, each with `verdict: { works, of,
  line }`): fly them on the F-16 and give each a jet `verdict` whose count
  and line are what the nine flights showed. Re-tune one only if a small
  change clearly makes it work; otherwise report it truthfully (0 of 9 is a
  fine verdict). The count is of nine starts scored as the school scores
  them (`viewer/dogfight-measure.js` `movesOn`, `scoreMove`); say in your
  notes how you counted.
- **The note.** `note` is one or two sentences on what the nine F-16
  flights show. It is drawn under the words ON A JET: do not open with them.

## The files that are yours

Create or edit only these four.

| File | What it is |
|---|---|
| `tools/bf1942-models/viewer/dogfight-jet-<id>.js` | Data only, no imports; `export default` the jet block. How it is merged: the header of `viewer/dogfight-jets.js`, and `lessonFor` in `dogfight-lessons.js` |
| `tools/bf1942-models/viewer/dogfight-jet-plan-<id>.js` | Only if the lesson needs a plan of its own. It may import from `./dogfight-pilot.js` and `./dogfight-flight.js`, registers its plans on `PLANS` and their phases on `INTENTS`, and names every plan with a `jet` prefix. With none, it keeps `export {};` |
| `tools/bf1942-models/tests/test_dogfight_jet_<id_with_underscores>.py` | New. Holds every number and claim the words make, with `from jet_school import jet_lesson, shot_down`. A range where a count differs between starts; never something not seen |
| `features/dogfight-lessons-jets/<id>.md` | New. What was found, what was changed and why, the nine-start results of every demo before and after on the F-16, what the MiG-29 does with it, what is open |

If a shared file must change (a helper in `dogfight-pilot.js`, the harness,
the lesson merge, the theatre), do not change it: say exactly what and why
in the lesson's `.md` and in the hand-over.

## Rules

- Starts, and every number a plan reads, are in the Spitfire's units: the
  duel makes a jet's fight larger by its pace (1.28 for the F-16) and shows
  its pilot the fight at the Spitfire's size. The harness prints real metres
  and real speeds, and the words on screen give the jet's real ones.
- A plan flies the airframe through the stick and is deterministic. The
  school does not script an outcome.
- Words on screen: plain, short sentences, British spelling as in the
  lessons. Pilots are "they" and "them". No emojis. Every number is one
  measured on the harness.
- After every edit to the plan file, `node --check` it. The tree stays
  importable at all times.
- Before finishing, from `tools/bf1942-models/tests`:
  `python3 -m unittest test_dogfight_jet_<id_with_underscores> test_dogfight_jets`
  passes, and `python3 -m unittest test_dogfight_school` still passes (the
  Spitfire is untouched; about two minutes).
- Shell and file tools only. No browser, browser pane or computer-control
  tool; no server; no kubectl; no push.
- Commit the four files on the worktree's own branch
  (`feat(dogfight-school): <title> on a jet`), with no attribution or
  co-author line in the message. Do not push.

## Hand over

Under 40 lines: the branch name and worktree path; for each demo the
nine-start line before and after; which claims were tuned to hold and which
were rewritten; anything needed in a shared file; what is open.
