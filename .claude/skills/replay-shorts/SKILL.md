---
name: replay-shorts
description: Make, publish and fix Replay Shorts, the 9:16 kill clips in the REPLAY feed's "Shorts this week" strip on play.bfstats.io. Use whenever the owner asks to generate, film, render, upload, publish, re-do or delete Shorts ("make a couple of Shorts", "generate a short of that kill", "the Shorts strip is empty", "re-render the Shorts after the camera fix"), when a Short looks wrong (bad framing, a wrong title, a washed-out poster, "null" in a title), or when changing the kill picker, the render runner, the Shorts API or the strip and player.
---

# Replay Shorts

A Short is one kill from a shared recording, filmed in the creator's Shorts
look (1080x1920, bullet chase, grade, lower third), uploaded to the API and
shown in the REPLAY tab's strip and full-screen player. The design and every
decision are in `features/replay-shorts/README.md` (read "As built" first);
the frame-stepping measurements in `features/replay-shorts/CLOUD_RENDER_TEST.md`.

## The pieces

| Piece | Where |
|---|---|
| Picker (pure, node) | `tools/bf1942-models/viewer/replay-shorts-pick.js`; tests `tools/bf1942-models/tests/test_replay_shorts_pick.py` |
| Render and upload | `scripts/shorts-runner.mjs` |
| API | `api/Shorts/`, routes `/stats/shorts...`; tests `tests/api/Shorts/` |
| Strip and player | `tools/bf1942-models/viewer/play/replay-shorts.js`, wired in `play/recordings-feed.js`; client calls in `recordings-api.js` |
| The camera the Short opens on | the creator's round cam, `replay-roundcam.js` (`replay-creator-studio` skill) |

## Making Shorts (the whole job, no hand-off)

Run on this PC with the GPU. One headless browser at a time: check
`pgrep -c headless_shell` first.

```
node scripts/shorts-runner.mjs --recordings=6 --max=2 --gpu                 # film the newest, keep the files
SHORTS_UPLOAD_KEY=$(cat ~/.config/bfstats/shorts-upload-key) node scripts/shorts-runner.mjs --upload-filmed
SHORTS_UPLOAD_KEY=$(cat ~/.config/bfstats/shorts-upload-key) node scripts/shorts-runner.mjs --recordings=6 --gpu --upload
node scripts/shorts-runner.mjs --recording=<slug> --max=1 --gpu             # one recording
```

Each Short is the styled edit (10.5 s) then the kill again in real time
(7.5 s, the game's chase camera on the killer, a REAL TIME tag), with sound
when `--sound` is given. Other options: `--no-real-time`,
`--real-view=pov|chase|front|flyby`, `--kill=<t>:<victim>` (film that kill
whatever was clipped before), `--refilm-live` (film every live Short again
and replace it). To keep a filmed kill from ever being uploaded, rename its
`meta.json` to `meta.rejected.json`; the runner then treats it as clipped.

**Nightly.** `scripts/shorts-nightly.sh` runs at 03:30 from the systemd user
timer `bfstats-shorts.timer` (units in `deploy/shorts-nightly/`, installed in
`~/.config/systemd/user/`): the 10 newest recordings, 3 Shorts each at most,
`--gpu --sound --upload`, log `~/.cache/bfstats-shorts/nightly.log`. It waits
for another headless browser to finish, and skips the night after 30 min.
Uploads are not reviewed: look at what it put up
(`curl -s https://bfstats.io/stats/shorts`) and delete a bad one.
`systemctl --user start bfstats-shorts.service` runs it now.

Filmed Shorts are kept in `~/.cache/bfstats-shorts/<recording>/<kill>/`
(`short.mp4`, `poster.jpg`, `meta.json`). Look at every one before it is
uploaded: a contact sheet (`ffmpeg -i short.mp4 -vf "select='not(mod(n\,24))',scale=180:320,tile=7x2" -frames:v 1 sheet.jpg`)
and the poster. A meta.json can be corrected by hand before `--upload-filmed`
(the title is free text). Then confirm on the live API:
`curl -s https://bfstats.io/stats/shorts | python3 -m json.tool`, and the
strip at `https://play.bfstats.io/play/index.html?tab=replay`.

Timings: 2.5-4 min to load a recording (once per recording), about 20-25 s
to film a 10.5 s Short.

## Production access: just do it

The cluster is reachable from this PC directly: `kubectl --context hetzner
-n bf42-stats ...` (this IP is allow-listed; no tunnel, no `KUBECONFIG_B64`,
that is the cloud-session path in `hetzner-cluster`). The owner has given a
standing OK for kubectl, so do not stop to ask, and do not hand the owner a
command to run.

- **The upload key** is the secret `bfstats-shorts` (key `upload-key`) in
  `bf42-stats`, mounted into the API as `Shorts__UploadKey` (optional in
  `deploy/app/deployment.yaml`); the runner's copy is
  `~/.config/bfstats/shorts-upload-key` (mode 600). Created 2026-11-03. If
  the file is missing, read it back from the secret:
  `kubectl --context hetzner -n bf42-stats get secret bfstats-shorts -o jsonpath='{.data.upload-key}' | base64 -d > ~/.config/bfstats/shorts-upload-key`.
  Never print the key into the conversation. After creating or changing the
  secret, restart the API so it reads it:
  `kubectl --context hetzner -n bf42-stats rollout restart deploy/bf42-stats`.
- **If the public route refuses an upload** (Cloudflare, ingress), go round
  it: `kubectl --context hetzner -n bf42-stats port-forward svc/bf42-stats-service 9223:8080`
  and upload with `--to=http://localhost:9223`.
- **Files on the volume.** Shorts live on the recordings volume under
  `shorts/<slug>.mp4` and `.jpg`, with a database row each, so the API is
  the way in (a file copied onto the volume without its row shows nowhere).
  To inspect or fix files, use the FileBrowser pod the way mesh assets do
  (`bfstats-mesh-assets` skill): `kubectl exec` or port-forward
  `svc/filebrowser-service`. Deleting a Short: `DELETE /stats/shorts/<slug>`
  with the key header.

## Order on a change

1. Code and tests: `python3 -m unittest test_replay_shorts_pick test_recordings_api`
   from `tools/bf1942-models/tests`, `dotnet test tests/api --filter Shorts`,
   then `./scripts/verify.sh`.
2. Push to main: Jenkins deploys the API and the viewer (mesh image). Wait
   for both before uploading: `curl -s -o /dev/null -w '%{http_code}' https://bfstats.io/stats/shorts`
   is 200, and the live `replay-shorts.js` has your change.
3. A change to how a Short is filmed (the round cam, the recipe, the
   runner) only reaches Shorts filmed after it is live: re-film them
   (`DELETE` the old ones first, or the key returns the old Short).

## Verifying locally

Run the API on :9222 with a throwaway key and a scratch recordings folder
(`Recordings__Path=<scratch> Shorts__UploadKey=local-test-key dotnet run`
in `api/`), upload with `--to=http://localhost:9222`, and open the viewer's
`play/index.html?tab=replay&api=http://localhost:9222`. Playwright's bundled
Chromium has no H.264: drive `/usr/bin/google-chrome-stable` to play the
videos.

## Pitfalls already paid for

- **Over the shoulder of a tank was inside the mantlet**: a soldier's 2.4 m
  off the muzzle. The round cam now frames a hull by its radius
  (`HULL_SHOULDER`, 2026-11-02). If a Short opens on a wall of armour again,
  that is where to look.
- **"null" in a title**: some kill lines name no weapon; the picker takes the
  round's weapon, and a title drops the weapon when neither has one.
- **The poster on the hit flash**: the runner picks the frame after the hit
  whose brightness is nearest the middle (`posterFrame`).
- **A kill the page ties no round to** is skipped ("the page ties no round to
  the kill"); the next run will not retry it unless it is picked again.
- **The first page load can come up before the hulls are built**, and the
  shoulder shot then falls back to the soldier's. The runner waits 8 s after
  the status line; raise it if a Short opens inside a hull.
- **Sound** (`--sound`): the page's AudioContext is swapped for an
  OfflineAudioContext at 38.4 kHz (1/30 s is exactly ten render quanta) that
  renders one frame of audio per filmed frame, and says it is `running` (the
  page gates sounds on that). An offline render gives its buffer only at its
  end, so each page renders 300 s at most and the Shorts' stretches are cut
  out after the last one; ffmpeg muxes AAC. In bullet time the sounds play at
  normal speed against the slowed picture.
- **His own view from a tank** (`--real-view=pov`) is the replay's seat view:
  in 9:16 a letterboxed sight band, the barrel off to one side, the target
  out of frame (2026-11-03, the Tiger on Meuse). Hence chase for everything.
- **Every upload 401 "The upload key is not right"** (2026-11-03): the secret
  was made with `--from-file` from `openssl rand -hex 32`, whose newline went
  into the secret. The API now trims the configured key; still write the
  key file with `printf '%s'`. A changed secret only reaches the API when its
  pod restarts (a deploy, or `rollout restart deploy/bf42-stats`).
