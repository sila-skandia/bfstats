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
- [x] App sign-in client `bfv-site` (`AppSignInRules.cs`, `ui/src/utils/appSignIn.ts`).
      It is sent back to `https://bfv.bfstats.io/auth/callback` exactly, or to
      `http://localhost:<port>/auth/callback` so Lucca can work on a local bfv
      page against bfstats; nowhere else, and the relay is never sent there. The
      Allow page names bfv.bfstats.io, no device, and what it can do.
- [x] Its access tokens (`TokenService.CreateAppAccessToken`): 15 minutes
      (`Jwt:SiteAccessTokenMinutes`), refreshed through the hand-off, so a revoke
      lands within that (every other access token lives 7 days and none is checked
      against revoked sessions). Always role `User`, and no email claim at all:
      the configured admin address is an admin by its email claim alone
      (`AppRoles.HasAdminEmail`), so an admin who signs in on bfv hands bfv's
      script nothing an admin can do. Each app token names its `client`.
- [x] `User.SignedUpVia` (`bfstats` / `bfv`, null before it was kept;
      `AddUserSignedUpVia`). The sign-in page sends `signUpVia: 'bfv'` when its
      return address is a `bfv-site` Allow page, for a password sign-up and a
      first Discord sign-in alike; the API records it only when it makes the
      account. A note, never a permission.
- [x] CORS: **not** `Cors__AllowedOrigins`. That policy is credentialed, and
      bfv.bfstats.io is the same site as bfstats.io for SameSite=Lax: a bfv page
      could call `/stats/auth/refresh` with the visitor's refresh cookie and read
      back a full sign-in. bfv's origin is `Cors__SiteOrigins` instead, its own
      policy (`api/Auth/SiteCors.cs`) with no credentials, bearer tokens only, on
      the hand-off's token, refresh and revoke and on sharing, renaming,
      deleting, covering and viewing a recording. Reads were already public.
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

## What bfv's pages call (the contract for phase 2)

Everything is `https://bfstats.io/stats/...` from the browser, tokens in
`Authorization: Bearer`, never cookies (`credentials: 'omit'`).

1. **Sign in.** Make a PKCE pair (32 random bytes base64url; challenge =
   base64url(SHA-256(verifier))) and a random `state`, keep both in
   `sessionStorage`, and send the browser to
   `https://bfstats.io/auth/app?client=bfv-site&redirect_uri=https://bfv.bfstats.io/auth/callback&state=<state>&code_challenge=<challenge>&code_challenge_method=S256`.
   bfstats.io signs the visitor in (Discord or username/password; a new account
   is marked as bfv's) and shows Allow.
2. **Callback.** `/auth/callback?code=...&state=...`: check `state`, then
   `POST /stats/auth/app/token` `{ code, codeVerifier, redirectUri }` gives
   `{ accessToken, expiresAt, refreshToken, refreshExpiresAt, user: { id, username } }`.
   `?error=access_denied` is a Deny.
3. **Stay signed in.** The access token lasts 15 minutes. Before it lapses,
   `POST /stats/auth/app/refresh` `{ refreshToken }` returns a new pair; the
   refresh token rotates, and presenting an old one signs the visitor out.
   Sign out: `POST /stats/auth/app/revoke` `{ refreshToken }`.
4. **Upload.** `POST /stats/recordings`, multipart: `recording` (the
   `replay_*.ndjson`, gzipped with `CompressionStream` where the browser can),
   `meta` (JSON, `RecordingUploadMeta`: `title`, and the details the page read
   of the file), optionally `thumbnail`. No server log for BFV. It goes up under
   the player the file says recorded it; a file that does not say needs a
   player name linked to the account. The file's own header makes it a BFV recording; 503 means
   bfstats is not taking BFV recordings just now. Under 95 MB as sent
   (Cloudflare's 100 MB a request).
5. **List and play.** `GET /stats/recordings?game=bfv` (and `/filters?game=bfv`)
   for the REPLAY tab; each recording's `recordingUrl`
   (`/stats/recordings/<slug>.ndjson`, served gzipped) and cover. Reads need no
   token. `GET /stats/recordings/me` with the token: who is signed in, and the
   player names they may share as.
6. **Manage their own.** `PATCH /stats/recordings/<slug>` `{ title }`,
   `DELETE /stats/recordings/<slug>`, `PUT /stats/recordings/<slug>/thumbnail`.
   Only the uploader (or a bfstats admin) may.

For local work: a bfv page on `http://localhost:<port>` uses
`http://localhost:<port>/auth/callback` as its `redirect_uri`, against
staging or a local bfstats API (whose `Cors__SiteOrigins` must name that origin).

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
