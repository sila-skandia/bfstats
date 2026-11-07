# Recorder update notice

Tell a player whose recording came from an old BF42++ to update it, and make
the BattleView page and its Discord easier to reach.

## Why

On 2026-11-07 the owner looked at `pqjc9t92fb` (FHSWEurope, Supercharge,
uploaded by Jan Paul, recorded 2026-11-06). At 8:18 a soldier glides along the
ground. The file's header is `{"k":"h","v":5,"plus":"2.0",...}`, with no
`build` stamp and no `anim` state table. Builds before bf42plus `3979cd2`
(2026-10-18, released as `v2.0-round-replay`) never wrote FHSW's table: it has
58,059 states and the old recorder stopped at 4,096. Without the table the
viewer cannot read stance, so a soldier crawling slower than the walk band
plays the standing idle clip while he moves. The released `dsound.dll` writes
both the stamp and the table (checked by its strings: `"build":"{}"` and the
`anim` record with `skipped`/`limit`).

The three newest FHSWEurope uploads at the time (`pqjc9t92fb`, `zejq6ugy69`,
`nmvmebfgmg`, by two different players) were all from pre-fix builds, so
players were not updating. Nothing on the site can repair a recording that
never held the data, so the fix is to tell them.

## What was built

- `tools/bf1942-models/viewer/recorder-update.js`. `recorderStatus(header)`
  says whether a header came from an outdated BF42++: no `build` stamp, or a
  stamp whose day is before the release's (`LATEST.built`). Only the day is
  compared because `__DATE__ __TIME__` is the build machine's local time. A
  stamp it cannot parse counts as current. The server recorder
  (`plus: server-replay-recorder/N`) is never told to update.
  `remindToUpdate(files)` shows a small card in the bottom-right corner after
  a share: what the release fixes, Get the update (the release page), Not now,
  and links to `/battleview` and the Discord. It has no backdrop and takes no
  focus. Not now hides it for a day for that release tag (`localStorage`), so
  a backlog of old files shared in one sitting asks once.
- All three upload paths call it once the upload has succeeded: Share in the
  replay (`replay-social.js`), Share in the feed and Share several in the feed
  (`play/recordings-feed.js`). It never blocks or fails an upload.
- `/battleview` (`ui/src/views/v4/BattleViewV4.vue`): an "Already have
  BF42++?" note under the download, a Discord link in the top bar and in the
  Share step, and a Join the BattleView Discord strip after the install cards.

## Cutting a new BF42++ release

Move `LATEST` in `recorder-update.js` (tag, the released dll's own `build`
stamp, the fix list) and `CLIENT_TAG` in `BattleViewV4.vue` together.
`test_recorder_update.py` fails when the two tags differ. Read the stamp from
the release asset: `strings -a dsound.dll | grep -E '^[A-Z][a-z]{2} [ 0-9]{2} 20'`.

## Verification

- `tools/bf1942-models/tests/test_recorder_update.py`: no stamp, before,
  same day, later, unreadable, server recorder, header parsing, and the
  BattleView tag matching.
- `ui/e2e/battleview-replays.spec.ts`: the update note and the three Discord
  links.
- In a browser (2026-11-07): on the replay feed the card shows for a no-stamp
  and a Sep 27 header, not for the release's stamp or a server recording.
  Not now hides it, it fits a 375 px phone, and both importing pages load.
  The full upload with sign-in was not run against a live API.
