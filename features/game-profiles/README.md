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

## Tasks

- [ ] API: entity, migration, controller and service in `api/GameProfiles`,
      tests
- [ ] Site: "Game profiles" section on the user profile page: import from a
      folder, list, set active, delete; e2e
- [x] Viewer: load the active profile when signed in, save changes back,
      profile picker (2026-10-25, below)
- [x] Sidecar: `--name-from-page`, the page's `identity` action, the 15 s
      fallback (2026-10-25, below)
- [x] Tray app: the name setting as profile / install profile / custom
      (2026-10-25, below)

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
