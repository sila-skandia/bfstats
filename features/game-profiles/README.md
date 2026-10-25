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
  - "From the viewer's profile" (default; since the app sign-in,
    "Your bfstats.io profile", features/app-sign-in);
  - a profile from this PC's game install, if one is found (the tray reads
    `Settings/Profiles/*/GeneralOptions.con`; Linux under `~/.wine`, Windows
    under the registry's or the default install path);
  - a custom name.

  The last two pass `--name` and no `--name-from-page`.

## API contract

Under the signed-in user (Bearer token), route `stats/account/game-profiles`:

| method | path | body | answer |
|---|---|---|---|
| GET | `/stats/account/game-profiles` | | `[{ name, playerName, sidecarName, isActive, updatedAt, files: { "Controls/Common.con": "...", ... } }]` |
| PUT | `/stats/account/game-profiles/{name}` | `{ playerName?, files, makeActive?, sidecarName? }` | the profile; creates or replaces by name (case-insensitive) |
| PATCH | `/stats/account/game-profiles/{name}` | `{ sidecarName: string \| null }` | the profile; sets or (null, `""`) clears its sidecar name; 404 unknown, 400 invalid, 503 when SQLite is locked |
| POST | `/stats/account/game-profiles/{name}/activate` | | 204 |
| DELETE | `/stats/account/game-profiles/{name}` | | 204 |

- `files` keys outside the five above are refused with 400.
- `playerName`, when missing, is read from the `GeneralOptions.con` text.
- The first profile created becomes active. Deleting the active one makes the
  most recently updated remaining one active.
- The 11th profile is refused with 409.
- A write that hits `SQLITE_BUSY` (hourly / Recreate-extra holding the
  write lock) waits at most 5s — the same bound as `Default Timeout` /
  `busy_timeout`, not EF's 60s `CommandTimeout` — and answers 503
  `{ message: "The database is busy; try again" }`. PUT, PATCH, activate
  and delete all share that path. The panel already shows the server
  message. See `features/game-profile-write-busy`.
- `sidecarName` (added 2026-10-25, "Sidecar name" below) is null unless set.
  A PUT changes it only when its body names the field: a re-import or the
  viewer's save leaves it out and keeps it. A PATCH without the field is a 400.

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
  first writes of one name racing); 503 `{ message }` when SQLite is
  locked. Activate and delete 204, 404 for an unknown name, 503 on the
  same lock. GET lists in name order; a row whose stored files no longer
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

## Sidecar name (2026-10-25)

Owner's request: players want their profile, with a different name when they
play through the sidecar. A profile keeps `playerName`, the game's (from
`GeneralOptions.con`, as before), and gains an optional `sidecarName`. The
name a sidecar join uses is `sidecarName ?? playerName`, everywhere: the tray
app's `--name`, the viewer's page identity, the panel's "Playing as".

- **Rule**, the sidecar's own (`sidecar/player-name.mjs`), in three places
  that agree: `GameProfileRules.ValidateSidecarName` (API),
  `ui/src/utils/sidecarName.ts` (site), `address.js` `sidecarNameError`
  (tray). Trimmed; blank clears; no `"`, no control characters
  (U+0000-001F, U+007F-009F), nothing past U+00FF; at most 23 characters,
  the server's limit. The sidecar cuts a longer name to 23; the edit refuses
  it instead, so the saved name is the scoreboard's. Stored as typed (a
  Latin-1 string, sent as its bytes); shown through `$pn` like the game name.
- **API.** Column `GameProfiles.SidecarName` (TEXT, max 23, nullable;
  migration `20261025111556_AddGameProfileSidecarName`). `PATCH {name}` sets
  or clears it and leaves `UpdatedAt` alone (that stamps the files, and picks
  the next active profile on a delete). PUT tells a missing field from a null
  one (`UpsertGameProfileRequest.HasSidecarName`, set by the JSON reader only
  when the property is present). The account export carries it.
- **Site.** Each row of the Game profiles tab says `Plays as <game name>`
  and, when set, `Sidecar as <sidecar name>`. **Sidecar name** opens an
  inline form under the row: the field (placeholder the game name, a 23
  counter), the rule's message as it is typed, Save (disabled while the rule
  refuses), Clear (when one is set), Cancel. E2E in
  `ui/e2e/game-profiles.spec.ts` ("a profile plays through the sidecar under
  its own name"): the three refusals, save, a PUT without the field keeping
  it, the API's 400s and 404, mobile at 390 px, clear.
- **Tray app.** `profileView` carries `sidecarName` and `joinName`; a join
  (`resolveName`, nameSource `account`) passes `--name <joinName>`. The panel's
  profile rows show the join name with `game: <name>` dimmed beside it when
  they differ, and a pencil (shown on hover, always on the active row) that
  turns the row into the edit: Enter or the tick saves (`PATCH`), the undo
  icon clears, Escape or the cross cancels. The account card's "Playing as"
  and the brief menu's `Profile:` and radio items use the join name. Tested
  in `test/sidecar-name.test.js` against the stand-in's `PATCH`.
- **Viewer.** `profile-sync.js` `identity()` is the active profile's
  `sidecarName`, else its `playerName`, else the local profile's. The page
  never sends the field, so its saves keep it. `test_profile_sync.py`
  (`test_the_sidecar_name_names_the_player_and_survives_a_save`); the
  stand-in models PUT keeping the field and the PATCH.

Verified on this PC (2026-10-25) against the real API and site (`dotnet run`
on a throwaway database with the dev sign-in, `vite` proxying to it) and the
dev tray app on its own data folder, driven over its remote debugging port:
the site's PUT made `LiveTester` (game name `GameNameLive`, `sidecarName:
null`); the tray signed in through the real Allow page and showed "Playing as
GameNameLive"; its pencil refused `bad"name` ("No quotes") and saved
`SidecarLive` (the API then answered `sidecarName: "SidecarLive"`,
`playerName: "GameNameLive"`); the card read "Playing as SidecarLive
GameNameLive" and the row `SidecarLive  game: GameNameLive`. A join link to
the lab server `127.0.0.1:14567` logged `player name from the bfstats.io
profile LiveTester (its sidecar name)`, the sidecar `[sidecar] player name:
SidecarLive (given)` and `joined as player 0 team 1`, and the recording's
player row from the server is `"name":"SidecarLive"`. The E2E run migrated
the real-data fixture through `AddGameProfileSidecarName`.

## Tasks

- [x] API: entity, migration, controller and service in `api/GameProfiles`,
      tests
- [x] Site: "Game profiles" section on the user profile page: import from a
      folder, list, set active, delete; e2e
- [x] Viewer: load the active profile when signed in, save changes back,
      profile picker (2026-10-25, below)
- [x] Sidecar: `--name-from-page`, the page's `identity` action, the 15 s
      fallback (2026-10-25, below)
- [x] Tray app: the name setting as profile / install profile / custom
      (2026-10-25, below)
- [x] Sidecar name: API column and PATCH, site edit, tray edit and join
      name, viewer identity (2026-10-25, above)

## Viewer (2026-10-25)

`viewer/profile-sync.js` holds the account side; `viewer/controls.js` the
maps. `map.html` and the front end (`play/front-end.js`) each make one
(`window.__profileSync` for headless checks).

- **Loading.** The API is `recordings-api.js`'s client for the page
  (`resolveApi`: the same origin on play.bfstats.io, signed in with the
  site's refresh cookie; `?api=<origin>` names another). Signed in, `GET
  /stats/account/game-profiles`, and the active profile goes over the
  localStorage copy (`controls.applyProfile`), which it also replaces, so the
  next offline page plays with it. A change made while the account was
  still loading wins over it.
- **Saving.** `controls.onChange` fires on an import (`import`), a DEFAULT
  (`reset`) and an account profile taken (`account`, never saved back). Two
  seconds after the last change, one `PUT` with `makeActive: true` for an
  import:
  - an import of a profile folder goes to that folder's name (created or
    replaced, as the site's import does) and becomes active;
  - DEFAULT goes to the active profile: the four control files become the
    shipped maps; its `GeneralOptions.con` and player name are kept (what the
    page does not hold, the account keeps);
  - with no profile at all, one named after the folder, else `Viewer`;
  - an empty account takes this browser's earlier import, so a profile
    imported before signing in is kept.
- **Files.** The contract's keys map to the control map's contexts
  (`controls.js` `PROFILE_FILE_KEYS`): `Controls/Common.con` common,
  `Controls/Infantry.con` infantry, `Controls/Air.con` air,
  `Controls/Land.con` land. `GeneralOptions.con` is the imported file as the
  game wrote it (`controls.js` now keeps it whole); a page that never saw one
  writes a short one from the player name, crosshair colour and minimap words.
- **Picker.** OPTIONS > CONTROLS: signed in, the foot of the right-hand panel
  (where the import help sat) shows YOUR BFSTATS.IO PROFILE, the active one's
  name with `n/m`, and `<` `>` that switch it (`POST .../activate`, then the
  page plays with it). The profile plate still imports a folder.
- **Offline, signed out, API errors.** The page plays from localStorage as
  before and says why once (`console.warn` `[profiles] ...`). A 409 (the
  11th profile) is said and the import stays in this browser.
- **The name.** `profileSync.identity()` is the active profile's player name,
  else this browser's profile's (`game.setPlayerName`), else null, waiting at
  most 5 s for the account. `net-room.js` sends it as `{type: 'identity',
  name}` the moment the sidecar socket opens (`net-sidecar.js` `identity`).

Tested by `tests/test_profile_sync.py` (the module through the real API
client against `tests/game_profiles_standin.mjs`, a stand-in of the contract
that also serves the viewer for a headless page) and the existing
`test_controls`, `test_controls_menu`, `test_mouse_look_key` and
`test_recordings_api`.

## Sidecar (2026-10-25)

`sidecar.mjs --name-from-page [--name-wait 15]`:

1. the page socket comes up first (`[sidecar] live feed:`, which the tray app
   opens the viewer on);
2. the pre-join server query and table fetch run while it waits;
3. the page's `{type: 'identity', name}` (MSG_ACTION) settles the name; a
   null name, or one that cannot be sent, settles on `--name` at once; no
   identity within `--name-wait` seconds settles on `--name`;
4. `[sidecar] player name: <name> (from the page|fallback)`, then the
   ConnectRequest. Rejoins keep the name. A later identity is ignored
   (`page identity ignored: already joined as ...`).

Without the flag nothing changes (the lab probes connect at once), and an
identity row is ignored.

**What retail takes as a name** (`sidecar/player-name.mjs`): the name rides
the CreatePlayer the client queues at the Challenge, a 32-byte field. The
client cuts it at 31 bytes (`GameEventManager::createPlayerRequest`, lnxded
`0x0812cf20`), the server keeps 23 (`GameServer::createPlayer` `0x081310e0`,
`std::string(name, 0, 0x17)`). Neither filters characters, but the field is
single bytes and the profile file quotes the name, so a quote, a control
character or anything past U+00FF is refused (fallback), and a longer name is
cut to 23.

Tested by `tests/test_sidecar_identity.py`: the real sidecar against a fake
server that notes when the ConnectRequest came, the harness as the page
(identity, null, no page, a name with a quote, a 30-character name, a late
identity, no flag).

## Tray app (2026-10-25)

Settings > Player name is a choice (`nameSource`):

- **From the viewer's profile** (default): `--name-from-page`, with the name
  the viewer's profile gave the last join (`lastPageName`) or the custom
  name as `--name`.
- **A profile from this PC's game install** (`src/game-install.js`): the
  folder set in Settings, else on Windows the registry's `GAMEDIR`
  (`HKLM\SOFTWARE\WOW6432Node\EA GAMES\Battlefield 1942`, then
  `HKLM\SOFTWARE\EA GAMES\Battlefield 1942`, through `reg query`) and the
  default install paths, on Linux `~/.wine/drive_c/EA Games/Battlefield 1942`
  (and `$WINEPREFIX`, the Program Files variants). Its profiles are every
  `Mods/bf1942/Settings/Profiles/*/GeneralOptions.con` with a player name;
  the default pick is the game's own current one (`Settings/Profile.con`
  `game.setProfile`). Passes `--name`.
- **Custom name**: `--name`.

A name a join carries (a link's `?name=`, the join window's) is used as given.
The menu's session header says `Playing as <name>` once known (from the
start for the last two; from the sidecar's `player name:` line with the first,
`Playing as: waiting for the viewer's profile` until then), and the app log
says `playing as <name> (<source>)`.

## Verified on this PC (2026-10-25)

Against the local server (`127.0.0.1:14567`, BF1942 server1, Wake), with
the stand-in serving the viewer and the contract on one origin
(`node tests/game_profiles_standin.mjs --port 5291 --static viewer --seed
<profile dir> ProfileTester`):

- a headless `map.html?sidecar=...&api=<stand-in>` sent `identity
  "ProfileTester"` 0.4 s after opening; the sidecar logged `player name:
  ProfileTester (from the page)` and the server's own CreatePlayer echo named
  the player `ProfileTester`;
- with no page, `no identity from a page within 15 s`, `player name:
  FallbackTester (fallback)`, and the server's CreatePlayer named
  `FallbackTester`; the pre-join query (`the server plays wake conquest`) ran
  during the wait;
- the dev tray app (`SIDECAR_DESKTOP_DATA`, `SIDECAR_DESKTOP_NO_BROWSER=1`, a
  join link) logged `opening the viewer` before the connect; a headless page
  on its socket made it `playing as ImportedTester (the viewer's profile)`; a
  page that came after the 15 s joined as the fallback and its identity was
  ignored;
- the front end's OPTIONS > CONTROLS drew the picker, a click on `>`
  switched the active profile (`POST .../Second/activate`), and an import
  of a folder `Imported` was saved (`PUT .../Imported`) and made active.

**Needs the real API to check live:** the refresh-cookie sign-in on
play.bfstats.io against `api/GameProfiles`, its validation answers (400 for an
unknown file key, 409 for the 11th profile) as the stand-in models them, and
`playerName` read from `GeneralOptions.con` when a PUT leaves it out (the
viewer always sends it when it knows it).
