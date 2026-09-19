# Briefing for every agent in this round

Read this first, then your stream's section in [README.md](README.md). The rules
here each cost a past round real work to learn. They are not style preferences.

## Where you are

- Repo: `bfstats`. Your code lives under `tools/bf1942-models/`, your docs
  under `features/`. The project rules are in `CLAUDE.md`; two bind you here:
  **no emojis anywhere**, and docs go in `features/<feature-name>/`.
- The installed game: `~/.wine/drive_c/EA Games/Battlefield 1942/` (18 mods under
  `Mods/`). The extraction guide is `~/.claude/skills/bf1942-mod-extraction/SKILL.md`.
  Read its section 10 before touching any interface surface, section 9 before
  opening a binary.
- The engine corpus: `features/bf1942-engine-reference/` (`ledger.md`,
  `symbols.json`, `xref.py`, `subsystems/`).
- The main checkout is `/home/dylan/projects/skandia/bfstats`. Unless your
  prompt says otherwise you are in your own git worktree and must stay in it.
- User reference captures, readable by absolute path, not committed:
  `/home/dylan/projects/skandia/bfstats/models-work/` (`willy-hands-wheel.png`,
  `sherman-cockpit-hud.png`, `sherman-browning.png`, `spawn-interface.mp4`,
  `kit-rotations.mp4`) and four `.webp` files in the main checkout's root.

## Shell

- The Bash tool is **zsh**. An unmatched glob aborts the whole command line, and
  `g`, `sec` and other short names are aliased. Put anything longer than a line
  in a bash script under your scratch directory and run it with `bash`.
- Shell cwd resets between calls. Use absolute paths, or `cd` at the start of
  every command.
- Long jobs run **in the foreground** (Bash timeout up to 600000 ms) or you poll
  them yourself. A background-task notification never wakes a subagent. Never
  end your turn "waiting for" something: if work is outstanding, keep going.

## Scratch space

Every agent in this session shares one scratch directory. Make your own
subdirectory, named by your stream tag, and keep every helper and output in it:

```
/tmp/claude-1000/-home-dylan-projects-skandia-bfstats/81fd3562-aa7d-45ca-b42a-016fc11e395e/scratchpad/<tag>/
```

## The shared asset trees: read, never write

`tools/bf1942-models/viewer/maps` (15 GB) and `viewer/models` exist once, in the
main checkout, gitignored. The lead is re-extracting into them during this
round. **You must not run any extractor whose `--out` resolves into the main
checkout's `viewer/` tree**, including through a symlink.

- To see your viewer changes with real data, run
  `bash tools/bf1942-models/link_viewer_assets.sh` from your worktree. It
  symlinks `maps` and the entries of `models` around the four tracked fixtures.
  Check `git status` afterwards; never `git add -A`.
- To prove an extractor change, extract **one** level or a handful of templates
  into your scratch directory (`--out <scratch>/out`) and inspect that. The
  lead runs the full re-extract once after merging.
- A subset run of `extract_models.py` rewrites `models.json` to only that
  subset. Another reason it must never point at the shared tree.

## Seeing the viewer

- Serve your own worktree on your assigned port, in the foreground of a
  short-lived command or as a background process you kill when done:
  `python3 -m http.server <port> --directory <worktree>/tools/bf1942-models/viewer`.
  Port 5273 is the main checkout's; do not use it to judge your own changes.
- Headless checks: `map.html?mod=bf1942&map=wake&shots` enables
  `window.__renderOnce(w, h)`, which steps one `frame(1/60)` and renders. The
  page's rAF loop does not tick in a hidden tab, so step frames instead of
  sleeping. `?cam=x,y,z,yaw,pitch` pins the camera. `__setOnFoot(true)`,
  `__deploy.select(name)`, `__deploy.spawn()`, `__teleport(x,y,z,yaw)`,
  `__vehicles()`, `__hud` exist for driving it. Playwright is installed
  (`tools/bf1942-models/shoot.mjs` is a working example of launching it).
- Under SwiftShader a tight `__renderOnce` loop crashes the browser after 30 to
  45 calls. Batch in 20s, retry on a closed page, keep sessions short.
- Measure `canvas.toDataURL()` output, never a page screenshot (the site nav and
  CSS stretch the canvas).
- Audio checks need Playwright's **default** autoplay policy and a real
  `page.mouse.click` first; `--autoplay-policy=no-user-gesture-required` hides
  the very bug you would be looking for.

## Tests

From `tools/bf1942-models`: `python3 -m unittest discover -s tests`. pytest is
not installed. The suite was 1,116 green when this round started; leave it green
and add tests for what you change. JS modules are tested under node through
`tests/*_harness.mjs`; a viewer module that stays free of `three` imports can be
tested the same way, so keep new logic in its own module and keep the hooks in
`map.html` small. `map.html` is 10,000 lines and every stream touches it, so a
small hook is also what makes your branch mergeable.

## Git

- Work only in your worktree. Before **every** commit run
  `git rev-parse --show-toplevel` and confirm it is your worktree, not the main
  checkout.
- Commit with explicit paths (`git add <paths>` then `git commit`), never
  `git add -A`, `git add .` or `git commit -a`.
- **Commit each self-contained piece as you finish it.** If the account quota
  caps mid-run, committed work survives and uncommitted work is a rescue job.
- Message style, matching the log: `feat(mesh): a sentence saying what is now
  true`, a blank line, then a short body saying why. No `Co-Authored-By` line,
  no generated-with footer.
- Never push, never merge into `main`, never touch another worktree.
- Never run `kubectl`, never upload or publish anything, never apply a manifest.
  If your stream needs deployment files, write them and stop there.

## Binaries

- **Client** (`BF1942.exe`, sha256 `60c9452d...cd3699`): Ghidra is running with
  the GhidraMCP bridge on `http://127.0.0.1:8089` (`/mcp/schema` lists the
  endpoints). `features/bf1942-engine-reference/xref.py check` verifies the
  hash; `xref.py list <subsystem>` and `xref.py` lookups wrap the common calls.
  The bridge is shared by every agent in the round.
  - The client is stripped: expect `FUN_*`. Names come from the Linux server.
  - Functions created by earlier sessions may be gone. Call
    `get_function_by_address` before decompiling; create a function only at an
    entry you have proved (a vtable slot, a call target).
  - **Never run a global re-analysis.** Ignore `0x00838b5e` to `0x008b191f`
    (CRT static-initialiser thunks).
- **Linux dedicated server**, not stripped, the authority for gameplay sim:
  `/home/dylan/Downloads/bf1942_lnxded-1.61-patched` (a tarball and a `.static`
  sit beside it). Use `nm -C`, `objdump -d -M intel --start-address=...`, `gdb
  -batch`. The gcc vptr is symbol + 8; vtable slot reads have been two early
  before.
- **Measure before you decompile.** A survey script over every installed mod's
  archives takes minutes and usually answers the question. See
  `features/bf1942-engine-reference/surveys/`.

## Claims

Every claim about the engine carries an address or a command that reproduces
it. Anything you could not verify is marked UNVERIFIED in so many words. An
invented field name is worse than `reserved`, because the next agent trusts it.
Past verifiers found wrong "verified" claims in most research reports: inverted
x87 comparisons, a live branch called dead, a vtable slot shared by 46 classes.
Write as if yours will be re-derived, because it will be.

## Shared documents you do not edit

`features/bf1942-3d-models/parity-gaps.md`, this round's `README.md`,
`features/bf1942-engine-reference/ledger.md`, `symbols.json` and the corpus
`README.md` are edited by the lead only, because every stream would otherwise
conflict in them. Put what you learned in your own feature doc, and put ledger
and symbol rows in your final message in the ledger's own table format so they
can be pasted in.

## Your final message

It is the only thing the lead reads. Give, in this order: what is now true and
how you proved it (commands, captures, numbers); what you did not finish and
why; ledger or symbol rows to integrate; anything another stream needs to know;
the branch name and the commits on it. Do not launch sub-agents.
