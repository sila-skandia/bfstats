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
| POST | `/stats/auth/app/refresh` | none | `{ refreshToken }` | same shape as `token` (the refresh token rotates) |
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

## Tasks

- [ ] API: authorize, token, refresh, revoke, sessions; migration for the
      code store and the refresh token's client/device columns; tests
- [ ] Site: `/auth/app` Allow page; Signed-in apps list on the dashboard; e2e
- [ ] Tray: sign-in flow, token store, profile list and switching in the
      panel and the brief menu, name from the active profile; tests
- [ ] End to end on this PC against a local API, then live
