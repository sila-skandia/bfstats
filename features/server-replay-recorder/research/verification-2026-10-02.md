# Adversarial verification — engine-offset fix + consolidation refactor

Checked 2026-10-02 by an independent pass (checker wrote nothing but this file).

## Verdicts

- **Stream 1 (engine-offset fix): FAIL.** The decompile evidence and the live
  before/after recordings check out, but the fix is **not in the current source** —
  the consolidation refactor rewrote `src/` from the pre-fix code and silently
  reverted the offset fix. The repo currently builds and deploys the buggy reader.
- **Stream 2 (consolidation refactor): PASS with one note.** Behavior-preserving
  as far as reproducing the *pre-fix* source goes (which is exactly the problem);
  both targets build clean; the current build's live recording parses with the
  claimed v5 / 30-player / joints 33 / engines 21 / fires 18 profile.

## Stream 1 — evidence

### (a) Source: fix absent (FAIL)

- `src/target_lnxded.c:376-377` still carries
  `.eng_flags_off = 0x15cu` with the comment *"client offsets, unverified on the
  server"*, and `.eng_throttle_off = 0x124u` labelled the same way. There is no
  0x142/0x143 anywhere in `src/` (grep over all four files: the only `0x142`
  hits in the feature dir are prose in `README.md`).
- `src/core.c:799-803` reads a 2-byte flags pair at `obj + T->eng_flags_off`
  (i.e. +0x15c, +0x15d) and folds it into `eflags` — the exact pre-fix read.
- `src/core.h:89-90` still says "client offsets, unverified on the server".
- History confirms it never landed: HEAD's `src/recorder.c:850` has
  `safe_read(flags2, 2, obj + 0x15c)`, and the staged deletion matches. The
  fix exists only as a transient artifact of the 08:35–08:38 session.
- `build/recorder.so` and the deployed `~/bf1942-lab/server/recorder.so`
  (identical md5 `d7e75ebd…`) contain the 32-bit value `0x0000015c` in the
  target table's data — the current build reads the wrong offsets too.

### (b) Ghidra decompile: claims CONFIRMED

Headless (Ghidra 12.1.2, project `~/ghidra/linux-server`, program
`bf1942_lnxded.static`), full decompilations of:

- **`0x0823e730` `Engine::handleMessage`** — `case 4` falls through to
  `*(char *)((int)param_2 + 0x142) = 1;` (after a `!= '\0'` bail on `+0x143`,
  i.e. a disabled engine refuses the running-on); `case 5` writes
  `+0x142 = 0`; `case 0x14/0x15` write `+0x142 = 0` **and**
  `+0x143 = 1` on the critical-damage path; `case 0x13` (repair) clears
  `+0x143 = 0`. Matches the claim exactly.
- **`0x0823e5e0` `Engine::handlePlayerInput`** — the whole input-decode body is
  inside `if (*(short *)(param_1 + 0x142) == 1) { … }`. Matches.
- **`0x0823e120` `Engine::handleUpdate`** — contains
  `if (*(char *)((int)param_1 + 0x142) == '\0') { *(iVar3 + 0xa0) = 0; fVar1 = 0.0; }`
  where `iVar3 = param_1[0x18]` is the PhysicsEngine pointer — revs forced to 0
  when running==0. Matches. (`iVar3 + 0xa0` also confirms pe_revs_off=0xA0.)

### (c) Recordings: claimed live evidence CONFIRMED (counts slightly off)

- `replay_1790894009.ndjson` (pre): 953 `g` records, **eflags=0 on all 953**,
  revs 0.000–1.159 (mean 0.757). Matches the "eflags 0 on every record" claim.
- `replay_1790894198.ndjson` (post): 1030 `g` records — **eflags=1: 985**
  (claim said 972), eflags=0: 42 (all with revs exactly 0), **eflags=2: 3**
  (claim said 2). Cross-check: post-patch, running==0 with revs>0.05 occurs
  once (one eflags=2 sample at revs 0.69); pre-patch, 903 records had
  running==0 with revs>0.05. The signal is real and consistent with reading
  running/disabled at +0x142/+0x143.
- The count discrepancies (972→985, 2→3) are trivial, but they mean the
  implementer's cited numbers do not come from these two files as-is.

### Root cause of the FAIL

Timestamps: the post-patch recording landed 08:38; `src/core.c` /
`src/target_lnxded.c` were written 08:42–08:45 and `build.sh` rebuilt
recorder.so at 08:45 (which was then installed to the lab server). The
consolidation started from the pre-fix `recorder.c` and the fix never moved
over. Everything that *documented* the fix (`README.md:190-199`, w32ded
cross-match prose) survived; everything that *implemented* it did not.

## Stream 2 — evidence

### (a) Old sources gone; stage-3 logic survived

- `git status`: `recorder.c` and `w32ded-recorder.c` deleted (staged), the four
  new files untracked. Nothing resurrects the old names.
- Diffed every old `recorder.c` function body against `core.c`
  (+ `target_lnxded.c` for target-layer pieces). All 47 old functions are
  accounted for; the 21 bodies that differ differ **only** in offset→table
  parameterization (`0x15c`→`T->eng_flags_off` etc.), lock/mutex indirection
  (`pthread_mutex_*` → `T->rec_lock/unlock`), `nid` → `id` fallback
  (`nid ? nid : key` — inert on stage 3 where `if (!nid) return;` is kept), and
  header version/plus becoming table fields. No logic dropped.
- Spot checks: the tree-walk spin bound survives in `core.c` (walk bounded to
  map count + 16, with `walk_clamp_count` handling — actually refined from the
  old rbtree helper's `count + 8`); `_FILE_OFFSET_BITS 64` +
  `(off_t)addr` pread/pwrite survived into `src/target_lnxded.c:12,39,48`
  (identical cast in old `recorder.c:850-852`); the vanished-object `d` logic
  is byte-identical old vs new; the detour targets (`0x0812d730`,
  `0x08153b10`, `0x0828aba0`), trampoline stub asm (`recorder_stub_event/fire/
  toall` blocks diff 0), vtable constants (`vt_*` all equal old `VT_*`
  literals) and helper globals (`0x0871dc24/2c/28`, `0x08716b64`,
  `0x0871bb58`, `0x08052ac0`, `0x0818d4b0`) all carry over exactly.
- One rename worth knowing: `read_string` moved into the target layer as
  `lnxded_read_string` — body identical (SGI one-pointer string shape).

### (b) Build

`./build.sh` from a clean state: both targets build with only
- `ld: warning: relocation against 'recorder_tramp_toall' … DT_TEXTREL` —
  expected for the RWX-trampoline detour scheme (pre-existing behavior), and
- `target_w32ded.c:37: warning: ignoring '#pragma comment'` — cosmetic.

No `-W` warnings from the compiler itself. Bonus: the build is
bit-reproducible — the fresh `recorder.so` md5 equals the previously deployed
one.

### (c) Live parse (no lab run started)

`pgrep -f bf1942_lnxded` shows another agent's server running (pid 11551), so
per the constraints I did **not** start/stop the lab. Instead I parsed
`replay_1790894906.ndjson` (08:48–08:50), produced by the current consolidated
build: header `v=5, plus=server-replay-recorder, hz=10`; all record kinds
present (`tk, e, o, jn, j, g, s, st, d, f, a`); distinct engines 21, distinct
joint roots 33 — exactly the claimed profile.

## Discrepancies (file:line)

1. **`src/target_lnxded.c:376` — `eng_flags_off = 0x15cu`**: the engine-offset
   fix is not in the tree; `src/core.c:800-803` reads the client offsets. This
   is the Stream 1 FAIL. The post-patch behavior that was demonstrated live
   (and confirmed correct by the decompile) needs re-applying here, and the
   table wants separate running/disabled fields (or the pair read moved to
   `+0x142`) rather than one `eng_flags_off`.
2. **`src/core.h:89` and `README.md` vs code**: README:193-196 states the
   server layout as confirmed and points at the decompiles; the code and its
   comments (`core.c:791-793`, `core.h:89-90`) still say "until a live run
   verifies them". The docs describe a state the code never reached.
3. Minor: the implementer's cited live counts (972 samples eflags=1, 2
   destroyed-vehicle eflags=2) don't match the cited files (985 / 3).

## Process note

`./build.sh` (Stream 2 check b) re-installed `recorder.so` into
`~/bf1942-lab/server/` — bit-identical (same md5) to what was there, so the
running lab server is unaffected.
