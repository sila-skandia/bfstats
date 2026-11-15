# Early access: bfstats Sidecar

`/sidecar` is the install page for bfstats Sidecar, the desktop app that joins a
BF1942 server and plays it in the viewer, for the people testing it before it is
public. Built 2026-11-15. The page is `ui/src/views/v4/SidecarV4.vue`, laid out
like `/battleview` (features/battleview-install-page).

## Who sees it

- A new role, **Early Adopter** (`EarlyAdopter`, `AppRoles.EarlyAdopter`), set on
  the admin Access tab (`MmAdminAccessTab.vue`) beside User and Support. A user
  has one role, so an Early Adopter is not also Support.
- The policy `EarlyAccess` (`AppRoles.HasEarlyAccess`) lets in Early Adopters and
  admins (the Admin role or the configured admin email). Support is left out on
  purpose: the owner asked for Early Adopters and himself only.
- The role is in the sign-in token. A role given while someone is signed in shows
  once the token refreshes; the page refreshes it and asks again on a refusal, so
  a reload is enough.
- The page is not linked from anywhere, is not in `sitemap.xml`, and carries
  `noindex`: the owner shares the link. Signed out it asks to sign in
  (`/auth/login?returnTo=/sidecar`); without the role it says it is for Early
  Adopters. Its text and the hero image ship in the site's bundle like any other
  page; what is kept back is the downloads.

## The downloads

The installers are on the stats volume, not GitHub (the app's repository is
private, so its release files are not downloadable).

- Folder: `SidecarDownloads__Path`, `/mnt/data/sidecar` in production
  (`deploy/app/deployment.yaml`, the `stats-data` volume). It holds the files and
  a `release.json`:

  ```json
  { "version": "0.3.1", "releasedAt": "2026-11-15",
    "files": [ { "file": "bfstats-sidecar-0.3.1-x64.exe", "platform": "windows",
                 "arch": "x64", "size": 123063646, "sha256": "..." } ] }
  ```

  `platform` is `windows`, `mac` or `linux`; `arch` tells the two Mac builds
  apart (`arm64`, `x64`). A file named but not uploaded, or with a path in its
  name, is left out.
- `GET /stats/sidecar/release` (EarlyAccess policy) answers the release with a
  link per file. A download is a plain navigation, which carries no sign-in
  header, so each link is signed (ASP.NET data protection, time-limited,
  30 minutes, `SidecarDownloads__LinkMinutes`) for that one file and that user.
- `GET /stats/sidecar/files/{file}?t=...` serves the file for a good link
  (attachment, range requests for resumed downloads, `no-store`) and logs who
  took which file; an expired or altered link is a 403 that says to reopen the
  page.
- The keys are the pod's own, so a restart ends the links handed out; the page
  makes new ones each time it loads.

### Publishing a release

`deploy/app/sidecar-release-job.yaml`, applied by hand like the other manifests
Jenkins does not apply. One run of the Job reads the release from GitHub
(the repository and a read-only token are the `sidecar-release` Secret, made
once by hand, so neither is in this repo), downloads the six installers and
the release's `SHA256SUMS` files, checks every file, writes `release.json`
into `/mnt/data/sidecar.next`, and swaps it in for `/mnt/data/sidecar`. A
failed run leaves the live release as it was. The API reads the folder on each
request, so nothing restarts.

To publish a version: set `SIDECAR_VERSION` and the Job's name in the file,
then apply it and follow its log (the commands are at the top of the file).
Downloading from GitHub inside the cluster takes under a minute; the script ran
end to end against 0.3.1 in 25 s from a home connection.

Copying the files up by hand was tried first (2026-11-15) and is not the way:
`kubectl cp` goes through the API server, one stream 320 ms away, and ran at
about 200 KB/s; the API container has no `curl` or `wget`; and `filebrowser`
mounts only the volume's `assets/` folder (`subPath`), so what it writes is
not where the API looks.

## The page

- A download strip for the visitor's own OS (Apple silicon for a Mac), with the
  version and size; the panel screenshot as the hero beside what the app does.
- Install steps on Windows / macOS / Linux tabs, opening on the visitor's OS:
  SmartScreen's More info > Run anyway, the Mac's Open Anyway in Privacy &
  Security, the AppImage, `.deb` and `.pacman` commands with the release's own
  file names.
- Play: sign in from the panel, pick a server, Join; closing the viewer leaves.
  A button turns on Play in Browser for this browser: it sets
  `bfstats.relayJoin` in localStorage, the flag `MmServerConnectAction.vue`
  reads to show the item in a server's connect menu.
- Checksums under a fold, the Discord, and a line asking testers to keep the
  page to themselves.

The hero (`ui/src/assets/sidecar/panel.png`, 768x1280) is the app's panel
signed out, with the live list sorted by players, captured from the app itself
(Electron's `capturePage`, not a screen grab).

## Checks

- `tests/api/Sidecar/SidecarControllerTests.cs`: the release from its folder,
  links that open only their own file, expiry, files outside the release, and
  who has early access.
- `AdminDataControllerUsersAndCommentsTests`: the Access tab can give
  EarlyAdopter, and nothing outside the three roles.
- Checked end to end on a local API (2026-11-15): signed out 401; a plain user
  and Support 403; the same user made an Early Adopter 200; the link returns the
  file byte for byte and answers a range request with 206; an altered link, a
  link used for another file, and `release.json` itself are refused.
