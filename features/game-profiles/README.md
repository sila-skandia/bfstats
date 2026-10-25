# Game profiles on the account

A BF1942 profile (`Mods/bf1942/Settings/Profiles/<name>/`) holds the player
name (`GeneralOptions.con` `game.setPlayerName`) and the control maps
(`Controls/{Common,Infantry,Air,Land}.con`). The viewer already imports one
(`viewer/controls.js` `importFiles`) and keeps it in localStorage, so it is
lost on another browser or machine.

Goal (2026-10-25): a one-time setup. Import your profiles from the game once,
on the site's profile page; they live on your bfstats.io account; any machine
you sign in on, with or without the game installed, plays with your name and
your controls. Controls changed in the viewer are saved back to the account.

## Decisions

- **Stored on the account**, per user, up to 10 profiles, one marked active.
  A profile is its name (the folder name), the player name, and the files the
  viewer uses: `Controls/Common.con`, `Controls/Infantry.con`,
  `Controls/Air.con`, `Controls/Land.con`, `GeneralOptions.con`. Nothing
  else is uploaded (no server lists, buddy lists or video settings). Each file
  is at most 64 KB of text.
- **Imported on the site's profile page** with a folder picker: pick the
  game's `Settings/Profiles` folder (every profile in it) or one profile
  folder. Parsed in the browser, uploaded as text. Re-importing a profile of
  the same name replaces it.
- **The viewer uses the account's active profile** when signed in. It
  overrides the localStorage copy, which stays as the offline cache. An
  import or a control change in the viewer is saved to the account's active
  profile (debounced). A profile picker in the viewer switches the active one.
- **The player name comes from the profile.** Retail sends the name in the
  ConnectRequest, so it must be known before the sidecar connects. The tray
  app runs the sidecar with `--name-from-page`: the sidecar listens, the page
  opens and sends `{type: 'identity', name}` as soon as its socket opens, and
  the sidecar connects with that name. With no identity within 15 s (no page,
  page not signed in and no local profile), it connects with the `--name`
  fallback. A rejoin keeps the name it joined with.
- **The tray app's name setting** becomes a choice:
  - "From the viewer's profile" (default);
  - a profile from this PC's game install, if one is found (the tray reads
    `Settings/Profiles/*/GeneralOptions.con`; Linux under `~/.wine`, Windows
    under the registry's or the default install path);
  - a custom name.

  The last two pass `--name` and no `--name-from-page`.

## API contract

Under the signed-in user (Bearer token), route `stats/account/game-profiles`:

| method | path | body | answer |
|---|---|---|---|
| GET | `/stats/account/game-profiles` | | `[{ name, playerName, isActive, updatedAt, files: { "Controls/Common.con": "...", ... } }]` |
| PUT | `/stats/account/game-profiles/{name}` | `{ playerName?, files, makeActive? }` | the profile; creates or replaces by name (case-insensitive) |
| POST | `/stats/account/game-profiles/{name}/activate` | | 204 |
| DELETE | `/stats/account/game-profiles/{name}` | | 204 |

- `files` keys outside the five above are refused with 400.
- `playerName`, when missing, is read from the `GeneralOptions.con` text.
- The first profile created becomes active. Deleting the active one makes the
  most recently updated remaining one active.
- The 11th profile is refused with 409.

The viewer reaches the API through `viewer/recordings-api.js`'s client (same
origin on play.bfstats.io, the site's refresh cookie).

## How it is built

### API (`api/GameProfiles`)

- One table, `GameProfiles` (migration `20261025061344_AddGameProfiles`):
  user id (FK to `Users`, cascade), `Name` as the folder spells it,
  `NormalizedName` (upper-cased, unique per user, so names match
  case-insensitively), `PlayerName` (raw cp1252 text, as the game stores it),
  `IsActive`, `FilesJson` (the files as one JSON object), `CreatedAt` and
  `UpdatedAt` (Instant, ExtendedIso).
- `GameProfileRules` holds the limits: the five keys (matched
  case-insensitively, `\` or `/`, stored under the spelling above), 64 KB of
  UTF-8 per file, 10 profiles, a name of 1-32 characters with nothing a
  Windows folder name cannot hold (`<>:"/\|?*`, control characters, a leading
  or trailing space or dot).
- A PUT **replaces the whole file set**: a file left out of `files` is gone
  afterwards. The player name is the body's, else `GeneralOptions.con`'s
  `game.setPlayerName` (quoted or bare, the last one wins), else the stored
  profile's, else the profile's name. A re-import under another case renames
  the stored profile to that spelling.
- Answers: PUT 200 with the profile; 400 `{ message }` for a bad name, key,
  size or player name; 409 `{ message }` for the 11th profile (and for two
  first writes of one name racing). Activate and delete 204, 404 for an
  unknown name. GET lists in name order; a row whose stored files no longer
  parse lists with `files: {}`.
- The account export (`stats/auth/account/export`) carries `gameProfiles`
  with their files; account erasure removes them (`gameProfilesRemoved`).

### Site (`ui/src/components/v4/MmGameProfilesPanel.vue`)

The "Game profiles" tab of the dashboard (`/v4/dashboard`,
`ui/src/views/v4/DashboardV4.vue`; `/v4/dashboard?tab=profiles` opens it).
"Import from game" opens a folder picker; `ui/src/utils/gameProfileImport.ts`
groups the picked files by the folder after `Profiles` in
`webkitRelativePath` (or the picked folder itself when it is one profile),
keeps the five files, decodes them as windows-1252, and shows what it found
(name, player name, which files, "Replaces stored", "Over limit") with a
checkbox each before any upload. A profile name found in two mods keeps the
first. Each row has Set active, Re-import (a pick narrowed to that profile)
and Delete (confirmed). E2E: `ui/e2e/game-profiles.spec.ts`, with fixture
profiles under `ui/e2e/fixtures/game-profiles/Profiles`.

## Tasks

- [x] API: entity, migration, controller and service in `api/GameProfiles`,
      tests
- [x] Site: "Game profiles" section on the user profile page: import from a
      folder, list, set active, delete; e2e
- [ ] Viewer: load the active profile when signed in, save changes back,
      profile picker
- [ ] Sidecar: `--name-from-page`, the page's `identity` action, the 15 s
      fallback
- [ ] Tray app: the name setting as profile / install profile / custom
