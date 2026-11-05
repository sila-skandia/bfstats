# verify.sh on macOS

`./scripts/verify.sh` and `./scripts/bootstrap-worktree.sh` now run on a Mac
(Apple Silicon, macOS 26, `/bin/bash` 3.2, Docker through Colima) as well as on
Linux and CI. Where the platforms can share code they do: what a Mac runs is
what CI runs, so a macOS fix cannot rot unseen.

## What broke on a Mac

| Gap | What happened | Fix | Where it runs |
|---|---|---|---|
| no `setsid(1)` (util-linux) | `verify.sh` died starting the API, so E2E never ran | `in_new_session`: the same `setsid(2)` through a `python3` one-liner, keeping the PID so `$!` is still the group leader | every platform |
| no `flock(1)` (util-linux) | every slot looked taken: "No free E2E isolation slot" | `_e2e_lock_fd9`: `fcntl.flock(9, LOCK_EX \| LOCK_NB)` through `python3` (below) | every platform |
| Docker's `--network host` is a VM's network | every test got `ERR_CONNECTION_REFUSED` on `127.0.0.1:<ui port>` | `ssh -R` puts the UI port on the Colima VM's loopback; Playwright keeps `--network host` (below) | macOS |
| `python3` is Apple's 3.9 in a non-login shell | 161 tool-test errors (`zip(strict=)`, `X \| None`, no Pillow, no liblzo2) | `scripts/verify-python.sh` picks a 3.10+ Python that has Pillow | every platform; picks `python3` wherever that already works |
| Ctrl+C never reached Playwright | the whole suite ran to the end before `verify.sh` could clean up | the container's init runs `npx` in its own process group and signals all of it | every platform (this was broken on Linux too) |
| `cleanup` was installed after the API started | a failed `E2E_PREVIEW` build left the API running | `trap cleanup EXIT` goes in before anything starts; `NEO4J_STARTED` is set before `docker run -d` | every platform (also broken on Linux) |
| `cleanup` sent one SIGTERM and returned | the API could still be in its graceful shutdown, port bound, after `verify.sh` exited | `stop_groups`: SIGTERM, wait up to 10 s for every member, then SIGKILL | every platform |

### Checked and fine as they were

`md5sum` (macOS 26 ships a GNU-compatible `/sbin/md5sum`), `sort -z`, `xargs -0`,
`base64 -w0` (and its existing BSD fallback), `/dev/tcp` (the existing fallback
when `ss` is missing, which it is on macOS), `date +%s`, `seq`, `sqlite3`,
`openssl`, `du -h`. Bash 3.2 handles everything the four scripts use: `+=` on
arrays, `<<<`, `16#hex` arithmetic, `${#arr[@]}` on an empty array under `set -u`,
and `compgen`. None of them uses `wait -n`, `readlink -f`, `sed -i`, `date -d`,
`mapfile` or associative arrays. (`scripts/dev.sh` does use `wait -n`; it is
being fixed separately.)

## Why fallbacks in the scripts, not a `brew install`

The alternative was `brew install util-linux` (or `flock`) as a prerequisite
that bootstrap checks for. That was rejected for three reasons:

- **One code path.** The shims are used on Linux too, not only when the tool is
  missing. `os.setsid()` and `fcntl.flock()` are the syscalls `setsid(1)` and
  `flock(1)` make, so CI now exercises, on every run, exactly the code a Mac
  runs. A Mac-only branch would be code CI never runs.
- **No new dependency.** `python3` is already required: step 1 of `verify.sh`
  runs the tool tests with it. Bootstrap now fails early if it is missing.
- **Homebrew's util-linux is keg-only** on macOS, so it would also need a PATH
  change in every shell that runs `verify.sh`, including the non-login shells
  Claude Code uses.

Things a script cannot shim (an interpreter, Pillow, a C library, ffmpeg) are
prerequisites instead, and bootstrap checks them with a clear message.

### The flock shim

A `flock(2)` lock belongs to the open file description, not to the process that
asked for it. `e2e-env.sh` opens the lock file as fd 9 in the shell, and a
`python3` child that inherits fd 9 takes the lock on that shared description. It
stays held by the shell after Python exits, until fd 9 closes. That is all
`flock -n 9` ever did, since it is a child process too. The servers inherit fd 9
as well, so a leftover API keeps its slot taken, as before.

## How Playwright reaches the UI on a Mac

Docker on macOS runs containers in a VM, so `--network host` gives the container
the VM's loopback, not the Mac's. `E2E_PW_NETWORK` picks one of three ways
across; the browser loads the same `http://127.0.0.1:<ui port>` origin in all of
them:

| Mode | Default on | How |
|---|---|---|
| `host` | Linux | `--network host` shares this machine's loopback |
| `tunnel` | macOS with Colima | `ssh -R 127.0.0.1:<ui port>:127.0.0.1:<ui port>` into the Colima VM, then `--network host`, so the container's command line is Linux's |
| `relay` | other Docker on macOS | Docker's default network; the container's init listens on its own `127.0.0.1:<ui port>` and pipes to `host.docker.internal:<ui port>` |

Keeping the origin `127.0.0.1` matters more than it looks. Vite's allowed-hosts
check reads the `Host` header. `127.0.0.1` is a secure context and
`host.docker.internal` is not, so as the origin it would switch off
`crypto.subtle`. And `verify.sh` sets the JWT audience to that URL. Only the UI
port crosses: the specs talk to `PLAYWRIGHT_BASE_URL` alone, and the UI proxies
`/stats` to the API on the host.

### Why a tunnel and not the relay on Colima

The relay was built first and worked, but the full suite through it failed 15
tests, mostly in threes: all three workers timed out together, about once a
minute. Measured:

- **Not the specs, the API or Vite.** During a stall the API log is silent, and
  a probe on the Mac requesting a Vite module and `/health` every half second
  never took more than 27 ms. The requests left hanging (recorded at each
  timeout) were ordinary GETs: `/@vite/client`, `/src/main.js`, a CSS file, an
  image, the document itself.
- **Not the relay.** The same stalls hit pages loaded straight from Colima's
  gateway (`http://192.168.5.2:<port>`), with no relay involved.
- **Colima's user-mode network.** Colima here runs lima's `user-v2` network: a
  userspace TCP stack (gVisor, in `limactl usernet`) carries every
  container-to-Mac connection. Plain HTTP across it is fine (583 fresh
  connections, then 3,180 requests on a keep-alive pool with 2 s and 7 s idle
  gaps, none slower than 2.1 s), but a browser's load is not.
- **The tunnel avoids it.** `ssh -R` carries the connections inside the one ssh
  session Colima already uses for its own port forwarding, the path the API's
  Redis traffic takes. Benchmark, 3 workers loading `/servers/bf1942`,
  `/players` and a player page, 60 loads each way in the same run: **0 stalls
  through the tunnel, 3 through the gateway.**

Two details of the tunnel matter. Colima forwards every port that listens in the
VM back to the Mac, so the tunnel opens only after the UI already holds its port
here (Colima's attempt then fails harmlessly), and it closes before the UI does.
`colima ssh-config` names the VM's ssh host, and the profile is read from the
Docker context (`colima` or `colima-<profile>`).

### The container's init

`scripts/e2e-container-init.mjs` is PID 1 of the Playwright container in every
mode:

```
node e2e-container-init.mjs --port <ui port> [--relay] -- npx playwright test ...
```

- **It waits for the UI** to answer from inside the container (up to 15 s, for
  the tunnel) and says what to check if it never does, rather than letting every
  test fail on an empty response.
- **It lets Ctrl+C stop the run.** A terminal's Ctrl+C signals the whole
  foreground process group, but `docker run` forwards a signal to PID 1 alone,
  and `npx playwright test` is npm running a shell running Playwright. The init
  starts the command detached (its own process group) and passes each signal to
  the whole group. Measured: Ctrl+C during the run now stops it in about a
  second ("3 interrupted, 15 did not run"). Before, all 18 landing tests ran to
  the end (53 s).
- **`--relay`** turns on the relay mode above.

## Which Python

`verify_python` (in `scripts/verify-python.sh`, sourced by `verify.sh` and
bootstrap so they cannot disagree):

1. `PYTHON=...` wins outright.
2. Otherwise it takes the first of `python3`, then every `python3.N` on PATH
   newest first, that is 3.10+ **and imports PIL**. If none has Pillow, it takes
   the first that is 3.10+. Failing that, `python3`.

`python3` goes first so a working Linux box or CI runner is untouched. In a
`python:3.12-slim` container with no Pillow, and a newer `python3.99` added to
PATH, it still picks `python3`. The Pillow preference exists because PATH
differs between the shells a Mac runs `verify.sh` from:

| Shell on this Mac | `python3` resolves to | Picked |
|---|---|---|
| Claude Code (non-login, `/usr/bin` first) | Apple 3.9 | `/opt/homebrew/bin/python3.15` |
| Terminal (`~/.zprofile` puts `python@3.13/libexec/bin` first) | Homebrew 3.13, no Pillow | `/opt/homebrew/bin/python3.15` |

Homebrew's `pillow` bottle is built only for Homebrew's default `python` (3.15
here, plus 3.14), never for a keg-only `python@3.13`, which is why bootstrap
suggests `brew install python pillow` together.

## Mac prerequisites

On top of the Docker runtime, .NET 10, Node and `gh`/`zstd`:

```bash
brew install python pillow lzo ffmpeg
```

Bootstrap's "Tool-test prerequisites" step checks Python 3.10+, Pillow,
`liblzo2` (loaded through ctypes; Homebrew's Pythons search `/opt/homebrew/lib`,
Apple's does not) and `ffmpeg`, and prints the `brew` or `apt` line for whatever
is missing. These are warnings, not failures, because CI is missing some of
them too (below) and its bootstrap must keep passing.

On this machine `python`, `pillow` and `lzo` were installed for this work.
`ffmpeg` was not, which costs one tool-test class (`test_scene_layers`).

## Verification

All on this Mac, with `bash 3.2.57`, Colima 0.10.3 (vz, virtiofs, 6 CPU / 12 GB),
the real-data fixture, and Linux cross-checks in `python:3.12-slim` (bash 5.2).

Because this branch changes `verify.sh`, every run of it on the branch counts as
`--all` and starts with the tool tests, which stop it (below). To exercise
everything after step 1, the runs marked *harness* used a copy of `verify.sh`
generated into the gitignored `.e2e/` with exactly two edits: step 1 cut out,
and the API tests made opt-in. It sources the real `e2e-env.sh` and
`e2e-secrets.sh`, so every line under test is the branch's own.

### Primitives

| Check | macOS (bash 3.2) | Linux (bash 5.2) |
|---|---|---|
| slot lock: a second holder takes the next slot; the slot frees when the first exits | slot 9, then 10, then 9 | slot 14, then 15, then 14 |
| `in_new_session`: `$!` is the group leader, grandchild in the group | yes | yes |
| `stop_groups` on a group that exits on SIGTERM | 0 s, nothing left | 1 s, nothing left |
| `stop_groups` on a group that ignores SIGTERM | SIGKILL at 10 s, nothing left | SIGKILL at 10 s, nothing left |
| bash's EXIT trap on SIGINT / SIGTERM in a script | runs | runs |

### No process left behind

Each run below was followed by
`pgrep -fl 'bin/Debug/net10.0/api|vite|dotnet run|ssh .*-R 127'` (empty),
`docker ps -a` (only `bf1942-redis`), and `lsof -iTCP -sTCP:LISTEN` diffed
against a baseline taken before any run (identical). Ctrl+C was emulated
exactly: the run started as its own process group with SIGINT at its default,
then `kill -INT -- -<pgid>`, which is what the terminal does.

| Case | Exit | Left behind |
|---|---|---|
| pass (landing, 18/18, `E2E_NEO4J=1`) | 0 | nothing; slot Neo4j removed |
| pass (landing, 18/18, tunnel) | 0 | nothing; tunnel closed |
| test failure (landing, 17/18) | 1 | nothing |
| failed `E2E_PREVIEW` build, after the API started | 1 | nothing (unpatched `main`: the API, both processes) |
| Ctrl+C during the Neo4j graph load | 130 | nothing |
| Ctrl+C while the API and UI boot, slot Neo4j running | 130 | nothing |
| Ctrl+C three seconds into Playwright, tunnel open | 130 after 1 s | nothing (before the init: 130, but only after the suite finished, 53 s) |
| full suite (harness, below) | 1 | nothing |

`E2E_PW_NETWORK=host` on the Mac reproduces the original failure
(`ERR_CONNECTION_REFUSED at http://127.0.0.1:<ui port>`) through the Linux
branch, which shows that branch's command line is well-formed and its exit code
propagates.

### The suites

`./scripts/bootstrap-worktree.sh` on this worktree: every step ran, then a
re-run skipped them all. Its only warning is the missing `ffmpeg`.

| Run | Tool tests | API unit tests | E2E (198) | Time |
|---|---|---|---|---|
| `./scripts/verify.sh --all` | 7,599 run, 24 fail (below): stops here, rc 1 | not reached | not reached | 1:26 |
| harness `--all`, relay (before the tunnel) | cut | 1,068 / 1,068 | 182 passed, 15 failed, 1 did not run | 5:18 |
| harness `--all`, tunnel | cut | 1,068 / 1,068 | **198 passed** | 1:30 |
| harness `--all`, tunnel, again | cut | 1,068 / 1,068 | **198 passed** | 1:30 |

Through the tunnel the suite runs with no failures at all, so there are no
known-flaky specs to discount on this machine. The relay run's 15 were the
Colima stalls described above. They also explain why the relay run took four
times as long: every stalled test waited out its 30 s timeout.
`verify.sh --all` itself still stops at step 1, as it does on every fresh
checkout, CI included.

## Still red, and not part of this change

### The tool tests stop `verify.sh --all` on any fresh checkout

Step 1 runs every BF1942 tool test under `set -e`, so any failure there ends the
run before the API tests and Playwright. With Python 3.15, Pillow and liblzo2 in
place, 24 fail on this Mac.

**9 also fail on CI.** They are broken on a fresh clone wherever it runs:

- `test_regression_corpus.test_commits_are_real`: names commit `b01483de`, which
  is not in the published history.
- `test_gun_burst_edges`, `test_spotter` (marker weapon), `test_ticket_blink`:
  `viewer/gun-cycle.js` imports `three` by bare name, and nothing installs it
  where Node resolves from `tools/bf1942-models/viewer` (the other harnesses
  stub it).
- `test_audit_completeness` (3), `test_audit_sides` (case mismatch),
  `test_ai_level` (Wake from the installed game).

**15 fail only on macOS**, from portability bugs in the tool code and tests:

| Cause | Tests |
|---|---|
| `/var` vs `/private/var` (a temp dir resolved on one side only) | `test_glb_store` (mesh root), `test_glb_image_cache` |
| case-insensitive APFS | `test_delta_extract` (case change re-exports) |
| `bf42` pipeline shells out to `flock(1)` | `test_mod_pipeline` (`the_lock_is_the_flock_cli_lock`) |
| no `ffmpeg` | `test_scene_layers` |
| `three` (as above; on CI these die earlier, on Pillow) | `test_load_settle_terrain`, `test_replay_support`, `test_video_settings` |
| expects a game install at `~/.wine/...` instead of skipping | `test_modmenu` |
| exits 1 under its CLI flag combinations | `test_adversarial_loading_assets` (5) |
| a worker pool returns nothing (`spawn` start method on macOS) | `test_viewmodel_level_skin` (workers decode the same bytes) |

### CI's E2E job has not reached Playwright recently

The `e2e` job of `claude-cursor-review.yml` runs `bootstrap-worktree.sh` then
`verify.sh`. Its six most recent failures all stopped in step 1, with 261 tool
tests failing or erroring (`failures=71, errors=190`), mostly
`No module named 'PIL'`: the runner's `python3` has no Pillow. Bootstrap now
prints that as a warning in the CI log. Installing the tool tests' dependencies
on the runner is its own change.

## Files

- `scripts/verify.sh`: `in_new_session`, `stop_groups`, the early trap,
  `open_colima_tunnel`, `E2E_PW_NETWORK`, the container init, `PYTHON`.
- `scripts/e2e-env.sh`: `_e2e_lock_fd9` / `_e2e_unlock_fd9`.
- `scripts/verify-python.sh`: `verify_python` (new).
- `scripts/e2e-container-init.mjs`: PID 1 of the Playwright container (new).
- `scripts/bootstrap-worktree.sh`: `python3` is required; the "Tool-test
  prerequisites" step.
