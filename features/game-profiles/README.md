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
  ConnectRequest, so it must be known before the relay connects. The page
  sends `{type: 'identity', name}` as soon as its relay socket opens, and the
  relay connects with that name. With no identity within 15 s (no page, page
  not signed in and no local profile), the relay connects with its own
  fallback name. A rejoin keeps the name it joined with.
- **The relay app's name setting** is a choice: the viewer's profile
  (default; since the app sign-in, "Your bfstats.io profile",
  features/app-sign-in), a profile from this PC's game install, or a custom
  name. Only the first involves the page.

## API contract

Under the signed-in user (Bearer token), route `stats/account/game-profiles`:

| method | path | body | answer |
|---|---|---|---|
| GET | `/stats/account/game-profiles` | | `[{ name, playerName, joinName, isActive, updatedAt, files: { "Controls/Common.con": "...", ... } }]` |
| PUT | `/stats/account/game-profiles/{name}` | `{ playerName?, files, makeActive?, joinName? }` | the profile; creates or replaces by name (case-insensitive) |
| PATCH | `/stats/account/game-profiles/{name}` | `{ joinName: string \| null }` | the profile; sets or (null, `""`) clears its join name; 404 unknown, 400 invalid |
| POST | `/stats/account/game-profiles/{name}/activate` | | 204 |
| DELETE | `/stats/account/game-profiles/{name}` | | 204 |

- `files` keys outside the five above are refused with 400.
- `playerName`, when missing, is read from the `GeneralOptions.con` text.
- The first profile created becomes active. Deleting the active one makes the
  most recently updated remaining one active.
- The 11th profile is refused with 409.
- `joinName` (added 2026-10-25, "Join name" below) is null unless set.
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

## Join name (2026-10-25)

Owner's request: players want their profile, with a different name when they
play through the relay. A profile keeps `playerName`, the game's (from
`GeneralOptions.con`, as before), and gains an optional `joinName`. The
name a relay join uses is `joinName ?? playerName`, everywhere: the relay
app's name, the viewer's page identity, the panel's "Playing as".

- **Rule**, the one retail's name field allows (below, "What retail takes as
  a name"), in places that agree: `GameProfileRules.ValidateJoinName` (API),
  `ui/src/utils/joinName.ts` (site) and the relay app's edit. Trimmed;
  blank clears; no `"`, no control characters (U+0000-001F, U+007F-009F),
  nothing past U+00FF; at most 23 characters,
  the server's limit. The relay cuts a longer name to 23; the edit refuses
  it instead, so the saved name is the scoreboard's. Stored as typed (a
  Latin-1 string, sent as its bytes); shown through `$pn` like the game name.
- **API.** Column `GameProfiles.JoinName` (TEXT, max 23, nullable;
  migration `20261025111556_AddGameProfileJoinName`). `PATCH {name}` sets
  or clears it and leaves `UpdatedAt` alone (that stamps the files, and picks
  the next active profile on a delete). PUT tells a missing field from a null
  one (`UpsertGameProfileRequest.HasJoinName`, set by the JSON reader only
  when the property is present). The account export carries it.
- **Site.** Each row of the Game profiles tab says `Plays as <game name>`
  and, when set, `Joins as <join name>`. **Join name** opens an
  inline form under the row: the field (placeholder the game name, a 23
  counter), the rule's message as it is typed, Save (disabled while the rule
  refuses), Clear (when one is set), Cancel. E2E in
  `ui/e2e/game-profiles.spec.ts` ("a profile joins from the browser under
  its own name"): the three refusals, save, a PUT without the field keeping
  it, the API's 400s and 404, mobile at 390 px, clear.
- **Relay app.** Signed in, it joins under the active profile's join name
  and can edit it through the `PATCH`.
- **Viewer.** `profile-sync.js` `identity()` is the active profile's
  `joinName`, else its `playerName`, else the local profile's. The page
  never sends the field, so its saves keep it. `test_profile_sync.py`
  (`test_the_relay_name_names_the_player_and_survives_a_save`); the
  stand-in models PUT keeping the field and the PATCH.

Verified on this PC (2026-10-25) against the real API and site (`dotnet run`
on a throwaway database with the dev sign-in, `vite` proxying to it) and the
relay app signed in through the real Allow page: the site's PUT made
`LiveTester` (game name `GameNameLive`, `joinName: null`); the app's edit
refused `bad"name` and saved `JoinLive` (the API then answered `joinName:
"JoinLive"`, `playerName: "GameNameLive"`). A join link to the lab server
`127.0.0.1:14567` joined as player 0 team 1 under that name, and the
recording's player row from the server is `"name":"JoinLive"`. The E2E run
migrated the real-data fixture through `AddGameProfileJoinName`.

## Tasks

- [x] API: entity, migration, controller and service in `api/GameProfiles`,
      tests
- [x] Site: "Game profiles" section on the user profile page: import from a
      folder, list, set active, delete; e2e
- [x] Viewer: load the active profile when signed in, save changes back,
      profile picker (2026-10-25, below)
- [x] Relay: the page's `identity` action, the 15 s fallback, the name
      setting as profile / install profile / custom (2026-10-25, below)
- [x] Join name: API column and PATCH, site edit, the relay app's edit and
      join name, viewer identity (2026-10-25, above)

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
  name}` the moment the relay socket opens (`net-relay.js` `identity`).

Tested by `tests/test_profile_sync.py` (the module through the real API
client against `tests/game_profiles_standin.mjs`, a stand-in of the contract
that also serves the viewer for a headless page) and the existing
`test_controls`, `test_controls_menu`, `test_mouse_look_key` and
`test_recordings_api`.

## Relay (2026-10-25)

What the page relies on: the relay opens the page socket before it joins,
and the pre-join server query runs while it waits. The page's `{type:
'identity', name}` settles the name; a null name, or one that cannot be
sent, settles on the relay's fallback at once, and so does no identity
within 15 s. Rejoins keep the name, and a later identity is ignored.

**What retail takes as a name**: the name rides the CreatePlayer the client
queues at the Challenge, a 32-byte field. The client cuts it at 31 bytes
(`GameEventManager::createPlayerRequest`, lnxded `0x0812cf20`), the server
keeps 23 (`GameServer::createPlayer` `0x081310e0`, `std::string(name, 0,
0x17)`). Neither filters characters, but the field is single bytes and the
profile file quotes the name, so a quote, a control character or anything
past U+00FF is refused (fallback), and a longer name is cut to 23.

## Verified on this PC (2026-10-25)

Against the local server (`127.0.0.1:14567`, BF1942 server1, Wake), with
the stand-in serving the viewer and the contract on one origin
(`node tests/game_profiles_standin.mjs --port 5291 --static viewer --seed
<profile dir> ProfileTester`):

- a headless `map.html?relay=...&api=<stand-in>` sent `identity
  "ProfileTester"` 0.4 s after opening; the relay logged `player name:
  ProfileTester (from the page)`, and the server's own CreatePlayer echo named
  the player `ProfileTester`;
- with no page, `no identity from a page within 15 s`, `player name:
  FallbackTester (fallback)`, and the server's CreatePlayer named
  `FallbackTester`; the pre-join query (`the server plays wake conquest`) ran
  during the wait;
- a page that came after the 15 s joined as the fallback and its identity
  was ignored;
- the front end's OPTIONS > CONTROLS drew the picker, a click on `>`
  switched the active profile (`POST .../Second/activate`), and an import
  of a folder `Imported` was saved (`PUT .../Imported`) and made active.

**Needs the real API to check live:** the refresh-cookie sign-in on
play.bfstats.io against `api/GameProfiles`, its validation answers (400 for an
unknown file key, 409 for the 11th profile) as the stand-in models them, and
`playerName` read from `GeneralOptions.con` when a PUT leaves it out (the
viewer always sends it when it knows it).
