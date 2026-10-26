# App sign-in: the tray app signs in through the browser

The sidecar tray app (`tools/sidecar-desktop`, `features/sidecar-desktop-app`)
needs the player's bfstats.io account to list and switch their game profiles
(`features/game-profiles`) and to join with the active profile's player name,
without depending on a signed-in viewer tab.

Chosen 2026-10-25: the browser hand-off (the GitHub CLI and VS Code pattern),
because it is the least friction: a player already signed in on bfstats.io
clicks Allow once. Rejected: a sign-in window inside the app (no password
manager, the player types credentials into the app).

## The flow

1. The app makes a PKCE pair (`verifier`, 32 random bytes base64url;
   `challenge` = base64url(SHA-256(verifier))) and a random `state`, and
   starts a one-shot HTTP listener on `127.0.0.1:<random port>`.
2. It opens the default browser at
   `https://bfstats.io/auth/app?client=bfstats-sidecar&device=<hostname>&redirect_uri=http://127.0.0.1:<port>/callback&state=<state>&code_challenge=<challenge>&code_challenge_method=S256`.
3. The site's `/auth/app` page sends a signed-out visitor through the normal
   sign-in and back. Signed in, it shows the request: "Allow bfstats Sidecar
   on <device> to use your account?" with what it can do (read and change
   your game profiles, see your account name), Allow and Deny. It never
   redirects without the click.
4. Allow: the page calls the API to mint a one-time code, then sends the
   browser to `<redirect_uri>?code=<code>&state=<state>`. Deny:
   `<redirect_uri>?error=access_denied&state=<state>`.
5. The app's listener checks `state`, answers with a small "Signed in, you
   can close this tab" page (or the error), closes, and exchanges the code.
6. The app keeps the refresh token encrypted with Electron `safeStorage`,
   and the access token in memory only.

## API contract

All under `stats/auth/app`. The app sends no cookies; tokens travel in
bodies and the `Authorization` header.

| method | path | auth | body | answer |
|---|---|---|---|---|
| POST | `/stats/auth/app/authorize` | the site's Bearer (signed-in user) | `{ client, device, redirectUri, state, codeChallenge, codeChallengeMethod }` | `{ code, redirectUri }` |
| POST | `/stats/auth/app/token` | none | `{ code, codeVerifier, redirectUri }` | `{ accessToken, expiresAt, refreshToken, refreshExpiresAt, user: { id, username } }` |
| POST | `/stats/auth/app/refresh` | none | `{ refreshToken }` | same shape as `token` (the refresh token rotates); 503 when the stats-DB writer is holding the SQLite lock |
| POST | `/stats/auth/app/revoke` | none | `{ refreshToken }` | 204 (signs this app out) |
| GET | `/stats/auth/app/sessions` | the site's Bearer | | `[{ id, client, device, createdAt, lastUsedAt, expiresAt }]` |
| DELETE | `/stats/auth/app/sessions/{id}` | the site's Bearer | | 204 (revokes that app's sign-in) |

Rules:

- **`client`** is `bfstats-sidecar`, the one known client. Anything else is
  a 400.
- **`device`** is free text the app sends (its hostname), cut to 64
  characters and shown on the Allow page and in the sessions list.
- **`redirectUri`** must be `http://127.0.0.1:<port>/callback` or
  `http://localhost:<port>/callback`, any port 1024-65535, and nothing else:
  no other host, path or query. The site's page checks this before it shows
  Allow, and so does the API.
- **The code** is single use, lives 2 minutes, and is bound to the user, the
  client, the redirect URI and the challenge. Only `S256` is accepted.
  `token` with a wrong verifier, a different redirect URI or a used or
  expired code is a 400 `invalid_grant`.
- **The app's refresh token** is the existing `RefreshToken` machinery
  (rotation, reuse detection revoking the family), in its own family per
  app sign-in. It is marked with the client and device so it can be listed
  and revoked, and it is never set as a cookie. It lasts the configured
  `RefreshToken__Days` (60), extended on every refresh.
- **The access token** is the normal one (`TokenService.CreateAccessToken`),
  so every existing `[Authorize]` endpoint, game profiles included, works
  with it.
- **Rate limits:** `authorize` per user, `token` and `refresh` per address,
  in line with the auth endpoints' existing limits.
- **Account erasure** revokes and removes app sessions; the account export
  lists them (without token material).

## Site

- `/auth/app`: the Allow page. Clear about which device and what it grants.
  Uses the V4 design.
- Dashboard: a "Signed-in apps" list (device, client, signed in, last used)
  with Sign out per row. It can sit beside the Game profiles tab or in
  account settings.

## Tray app

- **Signed out:** the panel's account section shows "Sign in with
  bfstats.io". The right-click brief shows a "Sign in..." item.
- **Signed in:**
  - The panel shows the account name and a profile list: name and player
    name, the active one marked, click to switch (POST
    `/stats/account/game-profiles/{name}/activate`), a link to the site's
    Game profiles tab to import more, and Sign out.
  - The right-click brief has a "Profile" submenu of radio items doing the
    same.
- **The name a join uses:** the active profile's player name, passed as
  `--name`, with no `--name-from-page` wait. The name setting's choices
  become:
  - "Your bfstats.io profile" (the default; signed out, it falls back to the
    viewer's page identity as now);
  - a profile from this PC's game install;
  - a custom name.
- **Tokens:**
  - The access token is refreshed before it expires.
  - A 401 on refresh means signed out: the token is cleared, and the panel
    says so once.
  - The refresh token is saved before the old one is dropped, because
    rotation revokes the family when an old token is replayed.
  - Saving uses `safeStorage`. On Linux without a keyring backend
    (`safeStorage.getSelectedStorageBackend() === 'basic_text'`), it still
    works but the panel says the token is not keyring-protected.

## How it is built

The API is `api/AppSignIn/` (controller, `AppSignInService`, the pure checks in
`AppSignInRules`, DTOs in `Models/`); migration `AddAppSignIn`.

- **Codes** live in `AppAuthorizationCodes`: the SHA-256 of the code (never the
  code), user, client, device, redirect URI, challenge, created, expires (2
  minutes), used, and the sign-in it was exchanged for. The first `token` call
  claims the code with one conditional update (`UsedAt` still null), whatever
  it brings, so a wrong verifier spends it and two racing exchanges cannot both
  pass. A second exchange of the same code also revokes the sign-in the first
  one issued (RFC 6749 4.1.2). `authorize` deletes the user's spent and lapsed
  codes. Times are NodaTime `Instant`s as ExtendedIso text, so expiry is
  compared in code, not SQL.
- **App refresh tokens** are rows of the existing `RefreshTokens` table with
  three new nullable columns: `Client`, `Device` and `FamilyId` (the first
  token's id, copied by every rotation). Cookie tokens keep all three null and
  behave exactly as before. `RefreshTokenService` keeps one validation core
  with a kind check first: `ValidateAsync` (the cookie refresh and logout)
  refuses a token with a client, `ValidateAppAsync` (the app refresh) refuses
  one without, both as "invalid" and with no side effects, so a token shown at
  the other endpoint neither rotates nor revokes anything. Reuse detection
  (revoked token presented: revoke the chain) and rotation are the shared
  machinery; `RotateAsync` carries client, device and family over.
  Sharing one validation would have been nearly harmless (a cookie is
  HttpOnly, an app token only ever lives in the app, and either one already
  grants the same access token), but the cookie refresh would have turned an
  app token into a browser cookie outside the Signed-in apps list, and a
  cookie token sent to the app refresh would have been rotated away from the
  browser that holds it. The kind check rules both out for the price of one
  comparison.
- **Sessions** are the user's app families with a live token: `id` is the
  family id (stable across refreshes), `createdAt` the family's first token,
  `lastUsedAt` its latest (the last refresh), `expiresAt` the live token's.
  `DELETE sessions/{id}` and `revoke` revoke every token of the family.
- **The access token** is `TokenService.CreateAccessToken`, unchanged.
  `user.username` is the account's username, or for a Discord account (which
  has none) its address, or `Account <id>`.
- **Errors:** 400 `{ error: "invalid_request" | "invalid_grant", message }`;
  `refresh` answers 401 `{ error: "invalid_grant" }` for any unusable token;
  `revoke` is 204 even for an unknown token.
- **State** must be 1-256 unreserved characters (`A-Z a-z 0-9 - . _ ~`): it
  rides back in a query string. A base64url or hex state passes. **Device**
  is trimmed, stripped of control and format characters, collapsed, cut to
  64; a blank one shows as "Unnamed device".
- **Rate limits** are ASP.NET limiter policies (Program.cs): `authorize` 20 per
  10 minutes per user, `token` 20 per 10 minutes per address, `refresh` and
  `revoke` 60 per 10 minutes per address. `UseRateLimiter` moved after
  `UseAuthentication` so a policy can see the user; the existing policies
  partition by address and are unaffected.
- **No CSRF check** on these routes: they read no cookies. `authorize` and
  `sessions` need the site's Bearer header, which a cross-site page cannot send.
  The tray app should call from Electron's main process (no CORS involved).
- **Account erasure** removes the codes along with every refresh token; the
  export's `sessions` rows now carry `client` and `device` (no token material).

The site: `ui/src/views/v4/AppSignInV4.vue` at `/auth/app`, its checks in
`ui/src/utils/appSignIn.ts` (the same rules as `AppSignInRules`), calls in
`ui/src/services/appSignInService.ts`. Signed out, it sends the visitor to
`/auth/login?returnTo=<this page>`, which comes back after either sign-in. A
request the API would refuse shows an error page and never offers a way to
the address it named. The dashboard's "Signed-in apps" tab
(`MmSignedInAppsPanel.vue`, `/v4/dashboard?tab=apps`) sits beside Game
profiles.

Tests: `tests/api/AppSignIn/` (rules, service against SQLite with the real
`RefreshTokenService`, controller), `ui/e2e/app-sign-in.spec.ts` (the Allow
page with the loopback caught by a Playwright route, Deny, refused requests,
the dashboard list and Sign out). `scripts/app-sign-in-e2e.mjs` plays the app
against a running site with a real loopback listener:

```bash
# an API with a throwaway database and the dev sign-in (see features/replay-feed, "Trying it locally")
cd api && ASPNETCORE_ENVIRONMENT=Development E2E_SEED=true DB_PATH=/tmp/app-sign-in.db \
  Jwt__PrivateKey="$(base64 -w0 ../.e2e/jwt-e2e.pem)" RefreshToken__Secret="$(cat ../.e2e/refresh-secret)" \
  Jwt__Issuer=http://localhost:9222 Jwt__Audience=http://localhost:5173 \
  dotnet run --no-launch-profile --urls http://localhost:9222
# the site, proxying /stats to it
cd ui && API_PORT=9222 npm run dev
node scripts/app-sign-in-e2e.mjs --site http://127.0.0.1:5173
```

## Tasks

- [x] API: authorize, token, refresh, revoke, sessions; migration for the
      code store and the refresh token's client/device columns; tests
- [x] Site: `/auth/app` Allow page; Signed-in apps list on the dashboard; e2e
- [x] Tray: sign-in flow, token store, profile list and switching in the
      panel and the brief menu, name from the active profile; tests
      (2026-10-25, against a stand-in API; below)
- [ ] End to end on this PC against a local API, then live

## Tray app: how it is built (2026-10-25)

`tools/sidecar-desktop/src/account.js`:

- **The flow** is as above:
  - `makePkce` (32 random bytes, S256) and `makeState` (24 random bytes,
    base64url).
  - `listenForCallback` on `127.0.0.1:0`. It answers only `GET /callback`
    (anything else 404). A wrong or missing `state` gets a 400 page and is
    ignored. The first callback with our state settles it, and the listener
    closes.
  - `authorizeUrl` builds `<site>auth/app?client&device&redirect_uri&state&code_challenge&code_challenge_method`.
    The device is `os.hostname()`, without control characters, at most 64
    characters.
  - The browser gets the URL through `shell.openExternal`, with a 5-minute
    timeout and Cancel. The code goes to `POST stats/auth/app/token`.
- **Tokens.**
  - The access token stays in memory. It is refreshed (`POST
    stats/auth/app/refresh`) when it has less than 60 s left, before a
    call. Only one refresh runs at a time, because two would replay one
    token and revoke the family.
  - `TokenStore` keeps `{ refreshToken, refreshExpiresAt, user }` encrypted
    with `safeStorage` in `<data>/account.bin`. A save writes `account.bin.tmp`
    and renames it over the old file, so the rotated token is on disk before
    the old one is gone.
  - A signed-in call that gets a 401 refreshes once and retries.
  - A 401 on refresh means signed out. A 400 `invalid_grant` counts the same,
    for an expired or revoked token. The app clears the token store and the
    profiles, and sets the panel notice "Your bfstats.io sign-in ended...".
    It sends one desktop notification. A network error or a 5xx keeps the
    sign-in, and the profiles keep their last list.
  - Sign out sends `POST stats/auth/app/revoke` (best effort) and clears the
    store.
  - Protection is `keyring`, `basic_text` (Linux without a keyring; the panel
    says "Sign-in saved without a keyring") or `memory` (no encryption at
    all; the token is not saved).
- **Profiles:**
  - `GET stats/account/game-profiles` happens at start, when the panel opens
    or gets focus, with every server list refresh (60 s, and the panel's
    refresh button), all at most every 5 s; before each join (up to 5 s, then
    the last list); and after a switch. So a profile renamed or switched on
    bfstats.io shows in the panel within a minute, or at once on clicking
    back into it.
  - A switch sends `POST stats/account/game-profiles/{name}/activate`.
  - Player names are shown decoded, as the site shows them. `--name` gets the
    raw name, through `cleanProfileName`.
  - The name shown and joined with is the profile's sidecar name when it has
    one, else its player name (`joinName`; features/game-profiles, "Sidecar
    name"). The pencil on a profile row edits it (`PATCH
    stats/account/game-profiles/{name}`).
- **Where:**
  - The site is `https://bfstats.io/`. The settings window's "bfstats.io
    address" changes it, from the next start, and so does
    `SIDECAR_DESKTOP_SITE`. The API defaults to the site;
    `SIDECAR_DESKTOP_API` or "Account API" changes it.
- **The name setting.**
  - `nameSource` is `account` (the default), `install` or `custom`. A stored
    `page` reads as `account` and is written back.
  - `account`, signed in with an active profile: `--name <sidecarName ??
    playerName>`, with no `--name-from-page`. Otherwise it is the viewer's identity as before.
  - The sidecar now prints `[sidecar] player name: <n> (given)` for a
    `--name` join too.
- **Panel:** an account card above the session card.
  - Signed out: "Not signed in" and **Sign in with bfstats.io**.
  - Waiting: a ring, "Finish signing in in your browser", Cancel, and a sweep
    along the card's edge.
  - Signed in:
    - the account's initial, its name and the profile count;
    - "Playing as <player name> <profile>". It opens the profile list: radio
      rows, Active tag, four rows tall then scrolling, so 10 fit;
    - **Import profiles on bfstats.io** (`<site>v4/dashboard?tab=profiles`);
    - a sign-out icon.
  - The list starts closed each time the panel opens.
- **Brief menu:**
  - Signed out: "Sign in...".
  - Waiting: the line and "Cancel sign-in".
  - Signed in: "Profile: <player name>", a submenu of radio items (player
    name, and the profile name when it differs), then "Import profiles on
    bfstats.io".

### Verified against the stand-in (2026-10-25)

`scripts/stand-in-api.js` behaves as the contract does:

- `/auth/app` allows at once (or denies);
- codes are single use and bound to the challenge and redirect URI;
- refresh tokens rotate, and a replayed one revokes the family with a 401;
- it serves revoke, the profile list and activate.

`npm test`: 30 pass. `test/account.test.js` covers:

- PKCE against an openssl-computed challenge;
- the authorize URL;
- the callback and state check;
- the listener (404, 400 on a bad state, one shot, closed after);
- the token store (encrypted, temp-and-rename, `basic_text`, memory);
- the setting's migration;
- the panel and menu models;
- the whole flow against the stand-in:
  - sign in, list, switch;
  - the refresh before expiry, with the rotated token saved;
  - three calls at once doing one refresh;
  - a restart from the store;
  - a replayed token's 401 signing out once, with the store cleared;
  - sign out revoking;
  - deny, timeout and cancel;
  - a code with the wrong verifier refused.

The dev app ran against the stand-in on this PC, with its own data folder,
`SIDECAR_DESKTOP_AUTH_URL_FILE`, and a check over the remote debugging port:

- signed out;
- Sign in → waiting;
- the URL fetched → "Signed in" page;
- signed in with six profiles;
- switched to "Big Ben" (active on the stand-in, and the brief menu's
  "Profile: Big Ben");
- joined the lab server `127.0.0.1:14567`. The spawn line had `--name "Big
  Ben"` and no `--name-from-page`. The sidecar said `player name: Big Ben
  (given)` and `joined as player 0 team 1`;
- left;
- the stand-in revoked everything → "Your bfstats.io sign-in ended" once,
  signed out;
- signed in again and Sign out → one revoke, `account.bin` gone.

Needs the real API and site to check:

- the Allow page's redirect back to the loopback (a browser on https
  sending a top-level navigation to `http://127.0.0.1`);
- the real token, refresh and revoke answers (field names, `expiresAt`
  format, the 400/401 split);
- the real `RefreshToken` family revocation;
- that an app's access token works on `stats/account/game-profiles`;
- the `basic_text` notice on a desktop without a keyring;
- Windows DPAPI.
