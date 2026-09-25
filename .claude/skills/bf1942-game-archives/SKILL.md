---
name: bf1942-game-archives
description: Fetch BF1942 vanilla/SW rfa archives on demand and run extractors.
---

# BF1942 game archives (on demand)

The cloud session has no BF1942 install. When a task needs raw game content —
running any `extract_*.py` in `tools/bf1942-models/`, baking a map, pulling
`.con`/texture/sound data — restore the archives first. They are NOT part of
`setup.sh`: only restore them when this task actually needs them.

## Restore (idempotent)

```bash
GAME_DIR="$HOME/bf1942-game"
mkdir -p "$GAME_DIR/Mods" tools/bf1942-models/ghidra-cloud/.work
BASE="https://github.com/sila-skandia/bfstats/releases/download/bf1942-binaries"
WORK="tools/bf1942-models/ghidra-cloud/.work"   # run from the repo root
for name in game-bf1942.zip game-xpack2.zip game-xpack1.zip; do
  [ -f "$WORK/$name" ] || curl -fSL --retry 5 --retry-all-errors -o "$WORK/$name" "$BASE/$name"
done
[ -d "$GAME_DIR/Mods/bf1942/Archives" ] || {
  unzip -q -o "$WORK/game-bf1942.zip" -d "$GAME_DIR/Mods"
  unzip -q -o "$WORK/game-xpack2.zip" -d "$GAME_DIR/Mods"
}
[ -d "$GAME_DIR/Mods/XPack1/Archives" ] || unzip -q -o "$WORK/game-xpack1.zip" -d "$GAME_DIR/Mods"
```

The zips already contain the `bf1942/` and `XPack2/` top-level folders.
Only vanilla (`bf1942`), Road to Rome (`XPack1`) and Secret Weapons
(`XPack2`) ship — every other mod was deliberately excluded. Movies/Music/eReg were dropped when the zips were
built; extractors never touch them.

## Running extractors

Point every extractor at the restored game dir. SW is the `XPack2` mod
(lowercase `xpack2` in arguments):

```bash
python3 tools/bf1942-models/extract_map.py berlin \
  --game-dir ~/bf1942-game --mod bf1942 --out /tmp/bakes/berlin
python3 tools/bf1942-models/extract_map.py <sw-level> \
  --game-dir ~/bf1942-game --mod xpack2 ...
```

Vanilla archive layout inside `Mods/bf1942/Archives/`: level rfAs under
`bf1942/levels/` (656M, all maps), `texture.rfa` (95M), `sound.rfa` (209M),
`standardMesh.rfa` (39M), plus small `Objects.rfa`, `animations.rfa`,
`menu.rfa`, fonts, shaders. Extracting and uploading resulting assets is
routine work in this repo (proceed without asking).

## Verify

- The restore check: `ls ~/bf1942-game/Mods/bf1942/Archives/` lists
  `texture.rfa`, `sound.rfa`, `standardMesh.rfa`, `bf1942/levels/`.
- A extractor smoke test: `extract_map.py berlin --game-dir ... --terrain-only`
  should report `tiles:` and `objects:` counts without missing-file errors.

## Packaging a new mod archive

Each mod is packaged as its own release artifact (`game-<folder>.zip`), and
the consumers above fetch whatever mods a task needs. To add one (e.g.
XPack1/Road to Rome):

```bash
G="<BF1942 install>/Mods"
bsdtar --format zip \
  --exclude '*/Movies' --exclude '*/Music' --exclude '*/eReg' \
  --exclude '*/Movies/*' --exclude '*/Music/*' --exclude '*/eReg/*' \
  -cf /tmp/game-xpack1.zip -C "$G" XPack1
gh release upload bf1942-binaries --repo sila-skandia/bfstats \
  /tmp/game-xpack1.zip --clobber
gh release view bf1942-binaries --repo sila-skandia/bfstats \
  --json assets --jq '.assets[] | "\(.name) \(.size)"'
```

Rules:
- One artifact per mod folder, named `game-<folder-as-on-disk>.zip`; the zip
  contains the mod folder itself (extracts into `Mods/`).
- Drop `Movies/`, `Music/`, `eReg/` — extractors never read them; rfAs are
  already-compressed content, so the zip is ~95% of raw size.
- `.rfa` archives do not compress — do not bother with gzip/xz.
- GitHub caps a single release asset at 2GiB; a whole-mod artifact stays far
  under it (biggest vanilla mod is 1.1G).
- After upload, verify by listing the release assets AND by test-extracting
  one level from the downloaded zip before declaring done.
- Then teach consumers: add the mod folder name to the restore step above so
  on-demand fetches pick it up, and note the lowercase mod name extractors
  expect (`xpack2`, `xpack1`).

## Pitfalls

- `unzip` the zips into `.../Mods`, not the game root — the archives sit one
  level below `Mods/<mod>/Archives/`.
- The zips are ~1.4GB total; download once per session, reuse for the rest.
- If an extractor complains about a missing archive, check the file is
  actually under `Mods/<mod>/Archives/` — a partial download is the usual
  cause; delete the partial file and re-fetch.