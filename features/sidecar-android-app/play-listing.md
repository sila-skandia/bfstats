# Google Play: listing, forms and first release

Everything the Play Console asks for, ready to paste, and the order to do it
in. Drafted 2026-10-26; the owner is creating the developer account.

## 1. Before the console

- **Package name: `io.bfstats.sidecar`.** It cannot change after the first
  upload. It is never shown as the app's name, but it is in the store URL
  (`play.google.com/store/apps/details?id=io.bfstats.sidecar`). If the app
  should outlive the sidecar idea (say, stats too), change it now, for
  example to `io.bfstats.app`: one line in `app/build.gradle.kts`
  (`applicationId`) and the workflow's `packageName`.
- **Upload key.** Run `tools/sidecar-android/scripts/make-upload-key.sh`
  once. It asks for a password, writes the key to
  `~/.config/bfstats-release/upload.jks` and the git-ignored
  `tools/sidecar-android/keystore.properties`, and prints the two GitHub
  secrets to add (`SIDECAR_UPLOAD_KEYSTORE_B64`,
  `SIDECAR_UPLOAD_STORE_PASSWORD`). Back the key and password up.
- **The bundle.** `cd tools/sidecar-android && ./gradlew :app:bundleRelease`
  writes `app/build/outputs/bundle/release/app-release.aab` (about 4.4 MB),
  signed with the upload key. CI builds the same once the secrets are in.

## 2. Create the app

Play Console > Create app:

| field | value |
|---|---|
| App name | bfstats.io |
| Default language | English (United Kingdom) or (United States) |
| App or game | Game |
| Free or paid | Free |
| Declarations | Developer Program Policies, US export laws: yes |

Then Setup > App signing: accept **Play App Signing** (Google holds the app
key; the upload key above signs uploads).

## 3. Store listing

**App name** (30 max): `bfstats.io`

**Short description** (80 max, 78 used):

> Join live Battlefield 1942 servers and play them on your phone, in the browser.

**Full description** (4000 max):

> bfstats.io lets you join the Battlefield 1942 servers that are still running
> today and play them on your phone.
>
> Pick a server from the live list (the same one bfstats.io shows, with
> players, map and mode), type the name you want to play as, and tap it. The
> app connects to the server the way the game does, and the round plays in
> the bfstats.io game page: the map, the other players, vehicles, chat and the
> scoreboard, live, with touch controls.
>
> - The live server list, busiest first
> - Join any server by address, LAN servers included
> - Fullscreen landscape play with touch controls
> - Leave from the app or its notification
> - No account, no ads, no tracking
>
> This is a fan-made, non-commercial project from bfstats.io. It is not
> affiliated with or endorsed by Electronic Arts or DICE. Battlefield 1942 is
> a trademark of Electronic Arts Inc. The app contains no game files; the
> game page is part of bfstats.io.

**Category:** Game > Action. **Tags:** shooter, multiplayer, war.

**Contact:** website `https://bfstats.io`, email (a public one; Play shows
it), privacy policy `https://bfstats.io/privacy` (section 04 covers the app).

**Graphics:**

| asset | spec | where |
|---|---|---|
| App icon | 512 x 512 PNG | `features/sidecar-android-app/store/icon-512.png` (the site logo) |
| Feature graphic | 1024 x 500 PNG/JPG | `features/sidecar-android-app/store/feature-1024x500.png` |
| Phone screenshots | 2 to 8, 16:9 or 9:16, 320-3840 px a side | taken on the phone from a lab round (bot names only, no real players); see below |

Screenshots to take (adb: `adb exec-out screencap -p > shot.png`): the server
list; in game on foot (landscape); a vehicle; the scoreboard; the spawn map.

## 4. App content (Policy > App content)

- **Privacy policy:** `https://bfstats.io/privacy`.
- **App access:** all functionality available without special access. Note
  for the reviewer: "No sign-in. Pick any server in the list with players,
  type a player name, tap the server. Servers are run by the game's
  community; if one is full, pick another."
- **Ads:** no ads.
- **Content rating** (IARC questionnaire): category Game. Violence: yes,
  realistic war violence (soldiers shot, vehicles destroyed), no blood or gore
  close-ups, no violence against children or animals. Fear: no. Sexuality,
  nudity, profanity, drugs, gambling: no. Users interact: yes (in-game text
  chat with other players, unmoderated). Shares location: no. Digital
  purchases: no. Expect about PEGI 12-16 / Teen.
- **Target audience:** 18 and over. Keeps it out of the Families programme;
  the original game was rated Teen / PEGI 16.
- **News app:** no. **COVID-19, government, financial, health:** no.
- **Data safety:**

  | question | answer |
  |---|---|
  | Does the app collect or share user data? | Yes |
  | Data types | Personal info > **User IDs**: the in-game player name the user types |
  | Collected or shared | Collected (sent off the device to the game server the user picks). Not shared: a transfer the user starts to a server they chose is exempt |
  | Processed ephemerally | No (game servers keep player names in their logs) |
  | Required or optional | Required to play |
  | Purposes | App functionality |
  | Encrypted in transit | **No**: the game protocol is plain UDP, as the game's own is |
  | Users can request deletion | No account is created; nothing is stored by the developer |

  Device identifiers: none (the game identity is a random value the app
  makes, not a device ID). Location, contacts, files, photos, app activity,
  diagnostics: none.
- **Foreground service** (Policy > App content > Foreground service
  permissions): type `specialUse`. Justification:

  > The app holds a live UDP connection to a multiplayer game server while
  > the user plays. The foreground service keeps that connection alive when
  > the user briefly leaves the game screen (a notification, a call), so the
  > round is not dropped; it shows an ongoing notification with a Leave
  > button and stops as soon as the user leaves the game. No other service
  > type describes a live game connection.

  Play may ask for a short video: start a join, pull down the notification,
  tap Leave. If the declaration is refused, the fallback is a build without
  the service (the game then ends when the app leaves the screen).

## 5. Testing, then production

1. **Internal testing** (Testing > Internal testing): create a release,
   upload the first `.aab` by hand (Play takes a new app's first bundle only
   through the console), add testers by email, roll out. After that, a
   `sidecar-android-v*` tag uploads through CI once `PLAY_SERVICE_ACCOUNT_JSON`
   is set (Setup > API access: link a Google Cloud project, create a service
   account, grant it "Release to testing tracks" for this app, add its JSON
   key as that secret).
2. **Closed testing** (personal accounts): at least 12 testers opted in for
   14 days in a row. A Google Group as the tester list is easiest; aim for 15
   to 20.
3. **Production access:** apply from the Dashboard; the form asks how
   testing went.
