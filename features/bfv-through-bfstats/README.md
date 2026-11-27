# BFV through bfstats: sign-in, uploads and Shorts for a second game

Status: design agreed with the owner 2026-11-27. Phase 1's recordings part built
(branch `bfv-through-bfstats`, not deployed); sign-in, Shorts and hosting to come.

bfv.bfstats.io (Battlefield Vietnam, Lucca's viewer) is hosted on the bfstats
cluster in namespace `bfv`. Its viewer stays its own; everything else (accounts,
replay uploads, Shorts, moderation) is bfstats, reached over the normal APIs. No
BFV-only endpoints: a recording's game is one more property, read from the file.

## Decisions

- **bfstats is the authority.** bfv holds no database and no copy of ours. Its
  pages call the bfstats API from the browser (the bfv site itself has no
  outbound network; a browser does).
- **Sign-in is delegated to bfstats.io** through the app sign-in hand-off
  (features/app-sign-in): a new client `bfv-site`, one exact redirect
  `https://bfv.bfstats.io/auth/callback`. Discord and username/password stay on
  bfstats.io; bfv never sees a password or the `rt` cookie.
- **The file decides its game.** The header's `game` (`"bfv"` with
  `plus: "bfvplus/..."`) routes an upload: `bfv` runs the BFV checks and is stored
  on bfv's disk; anything else runs today's BF1942 checks and is stored on ours.
  A file that fails its game's checks is refused. No `source` field and no token
  claim chooses the game. A valid BF1942 recording sent from bfv is simply a
  bfstats recording (the owner: "that doesn't bother me").
- **The column is `Game`, not `Source`.** `Recordings.Source` already means
  server or client recorder (features/recording-source). Every recording shared
  before is `bf1942`, FHSW and the other mods included (`Mod` tells them apart).
- **Each game's feed is its own, cards and counts too** (the owner: "we need a
  game recorded on the data to prevent them showing across each other's
  sites"). The cards, card names and counts the triggers keep carry the game;
  a round is only ever found among one game's recordings.
- **Files of game `bfv` live on bfv's disk, out of bfv's reach.** bfv's disk is
  its own volume (`/dev/sdc`) mounted on the node at `/mnt/bfv-data`; bfv's pods
  mount only `/mnt/bfv-data/site`. bfstats writes to a sibling,
  `/mnt/bfv-data/bfstats` (`Recordings__BfvPath`), so `du /mnt/bfv-data` bills
  bfv while no bfv pod can see, change or link into bfstats' folder. The API
  writes and serves the files; bfv's code only makes HTTP calls, so Lucca tests
  against staging or a local bfstats with no disk involved. Not an API inside
  bfv that hands files over: bfstats would then be parsing what bfv's code sends
  (the owner, 2026-11-27: "I don't want to get infiltrated by Lucca (even by
  accident)").
- **A Short's game follows its recording**: a Short of a bfv recording is filmed
  into bfv's disk, registered as game `bfv`, and listed only where asked for.
- **Where a user came from** is data, not a role (`User.Role` holds one value):
  `User.SignedUpVia` (`bfstats` / `bfv`) set when an account is created during a
  `bfv-site` hand-off, plus the `bfv-site` app sessions (who uses bfv, last used).
- **A later `BfvAdmin` role** (Lucca) moderates game `bfv` only: take down bfv
  Shorts and recordings, revoke a user's `bfv-site` sign-in, block their bfv
  uploads. Never disable or delete the bfstats account itself.

## Phase 1: bfstats (deploy first, nothing on bfv changes)

- [x] `Recordings.Game` (default `bf1942`), set at upload from the header.
      Migration `AddRecordingGame`: every row `bf1942`; the triggers dropped,
      the cards, card names and counts given the game (the counts' table made
      afresh, its key now game, kind, name: EF would rebuild it after the
      backfill), the triggers made again and the cards rebuilt. Each version's
      SQL is frozen in `Migrations/RecordingCardsV1.cs` / `V2.cs`, so old
      migrations build what they always did.
- [x] The game rules (`RecordingInspector.GameOf`): no `game` or `bf1942` is
      BF1942; `bfv` only from `bfvplus/...` in format 5; bfvplus under any
      other game, or any other game, is refused. A BFV recording is held to
      bfvplus's record kinds and takes no server log.
- [x] A folder per game (`RecordingStores`). The upload reads the game from
      the first line, then keeps the file in that game's folder from its first
      byte; with no `BfvPath` a BFV upload is a 503 and nothing else changes.
      The BFV folder is guarded: its root and `.incoming/` must be real folders,
      and a file is read or served only when it is a regular file, not a link.
      Its own quota (`BfvQuotaBytes`, 10 GiB) and free-space floor (2 GiB / 10%).
- [x] Files served from the recording's own game's folder, found by its row: a
      file with no row is not served.
- [x] Lists, filters and the storage meter by `game` (`?game=bfv`), defaulting
      to `bf1942`, so bfstats.io shows exactly what it did.
- [x] Kept to BF1942: bfstats.io round matching (`RecordingStatsRoundService`),
      server pages' media, the Shorts' server filter, studio shares, and the
      backfills that predate the game. Round detection and admin links only
      within one game. The file check and account erasure work per folder.
- [x] Tests: `tests/api/Recordings/RecordingGameTests.cs`, including the
      migration on a database built by every migration before it.
- [ ] A BFV recording's short link (`replay.bfstats.io/<slug>`) still goes on to
      play.bfstats.io; it should go to bfv.bfstats.io's viewer.
- [ ] The migration's `Down` drops the `Game` columns, which EF does by
      rebuilding `Recordings` after the old triggers are made: run
      `RecordingCardsV1.TriggersSql` again after a rollback.
- [ ] Shorts: `Game` on the row, taken from the recording; files for game `bfv`
      under the bfv mount.
- [ ] App sign-in: client `bfv-site`, its exact redirect, in `AppSignInRules.cs`
      and `ui/src/utils/appSignIn.ts`; the Allow page names bfv.bfstats.io.
      Its access tokens short-lived (about 15 min) so a revoke lands quickly
      (today every access token lives 7 days and none is checked against
      revoked sessions). Optional: no Admin role in `bfv-site` tokens.
- [ ] `User.SignedUpVia`, carried through the Allow page's sign-up detour.
- [ ] `Cors__AllowedOrigins` gains `https://bfv.bfstats.io`.
- [ ] Regression: API tests for recordings, Shorts and app sign-in;
      `e2e/stats-page-replays.spec.ts`, `e2e/app-sign-in.spec.ts`; a real
      BF1942 upload on staging before and after.

### Hosting that goes with phase 1

- [x] `/mnt/bfv-data/bfstats` mounted into the API pod at `/mnt/bfv-recordings`,
  `Recordings__BfvPath` set (2026-11-27). `deploy/app/bfv-recordings-storage.yaml`
  (PV and claim, applied by hand); the deployment's init container hands it to
  uid 1000, mode 0750. Checked: `/dev/sdc` is mounted at `/mnt/bfv-data` itself
  (its `lost+found` is there), so the folder is on bfv's disk beside `site/`.
  Applied to the live deployment as a patch of these lines only: the live
  deployment and `deploy/app/deployment.yaml` differ elsewhere (live has
  `DiscordSuspicious__*`, the repo has `SidecarDownloads__Path` and a required
  `Shorts__UploadKey`), which a whole apply would have changed.
- [x] HAProxy (2026-11-27, `backend bfv_site`): `Cookie` dropped on requests to
  bfv and `Set-Cookie` on its answers, so bfv can neither read bfstats.io's
  cookie nor set one a browser would send to bfstats.io. Checked with
  `haproxy -c` in the live pod before it was applied.
- [x] The BF1942 server recorder's header names its game, `"game":"bf1942"`
  (`features/server-replay-recorder/src/core.c`); a header with none is still
  BF1942. Needs a recorder release to reach servers. BF42++ (the client
  recorder) is not in this repo and still writes no game.
- HAProxy (the reason): drop the `Cookie` header on requests for `bfv.bfstats.io`. The `rt`
  cookie is `Domain=bfstats.io; Path=/stats`, so browsers send it to bfv, whose
  nginx config is in Lucca's image. Independent of the rest; do it anyway.

## Phase 2: bfv (Lucca's `bfv` branch, in a branch of its own)

- Sign in button, PKCE hand-off, `/auth/callback`, token refresh.
- The UPLOAD page posts to the bfstats recordings upload with the user's token
  (parts under Cloudflare's 100 MB a request, as bfstats does).
- The REPLAY tab lists from the bfstats API (`game=bfv`) instead of
  `uploads.json`, and loads files from it.
- The Shorts strip reads bfstats' Shorts list (`game=bfv`).
- Import the replays already in `/data/uploads` (`uploads.json`) as game `bfv`
  rows, with no uploader, so nothing shared so far disappears.

## Phase 3: hosting clean-up, after the cut-over

- Remove the `upload` sidecar, the `bfv-upload-code` configmap, the
  `bfv-upload-key` secret (unread since bfv's `320839839`, 2026-11-25) and the
  `/api/upload` and `/uploads/` blocks of `bfv-nginx-snippets`.
- Update bfv's CLAUDE.md "Hosting" section to match.

## Facts this rests on (checked 2026-11-27)

- One node (`bfstats-arm64`); bfv's disk is a hostPath PV, `ReadWriteOnce`,
  already mounted by both `bfv-files-0` and `bfv-site`.
- bfv's upload sidecar: `python:3.13-alpine`, code from configmap, no key check
  since 2026-11-25, 5 tries an hour per address. The hosting snippet still caps
  bodies at 64m while bfv's code allows 128 MB; Cloudflare caps at 100 MB.
- Access tokens: RS256, user id, email and role, no client claim
  (`api/Auth/TokenService.cs`); app sign-in accepts only `bfstats-relay` and
  loopback redirects (`api/AppSignIn/AppSignInRules.cs`).

## Open

- Shorts filmed by Lucca's own runner: upload through the Shorts API with his
  sign-in (preferred, the API writes the file), or kubectl plus a
  register-by-address call with a size and SHA-256 check.
- Which Short kinds bfv uses; the API refuses unknown kinds.
