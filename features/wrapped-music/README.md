# Wrapped Music — extracting game/mod soundtracks as MP3

The player wrapped (`ui/src/views/v4/PlayerWrappedV4.vue`) plays background
music from the original BF1942 game and its mods. This documents where the
music comes from and how to extract more of it.

## Where the music lives

The soundtrack is **not** inside the `.rfa` archives — every mod ships its
music as loose Bink (`.bik`) files:

```
~/.wine/drive_c/EA Games/Battlefield 1942/Mods/<mod>/Music/*.bik   (or music/)
```

Known mod folders: `bf1942` (vanilla), `DC_Final`, `DesertCombat`, `FH`,
`FHSW`, `GCMOD` (Galactic Conquest), `bf1918`, `interstate`, `EoD`,
`XPack1`, `XPack2`.

Each `.bik` is a Bink container (video stream + 44.1kHz stereo Bink audio).
ffmpeg decodes Bink audio natively (`binkaudio_dct`) — no RAD tooling needed.

## Conversion

```bash
ffmpeg -i Theme2.bik -vn -c:a libmp3lame -b:a 128k vanilla-theme2.mp3
```

- `-vn` drops the video stream.
- **Use MP3, not AAC/m4a.** Open-codec Chromium builds (Playwright's
  bundled browser, some Linux Firefox installs) can't decode AAC — playback
  fails silently: `paused` is `false` but `currentTime` stays at 0.
- Output naming: `<modprefix>-<sourcename>.mp3` into
  `ui/public/wrapped-music/` (served statically, loaded on demand,
  intentionally not bundled by Vite).

If system ffmpeg fails with `libsndio.so.7` missing (Arch): install the
`sndio` package, or extract it from
`https://archlinux.org/packages/extra/x86_64/sndio/download/` and run
ffmpeg with `LD_LIBRARY_PATH=<extracted>/usr/lib`.

## Checksum before converting

Run `md5sum` across the `.bik` files first — there are duplicates:

- **XPack2** music is byte-identical to vanilla `bf1942` — nothing unique.
- **GCMOD**'s `briefing`/`slaughter4`/`theme2`/`vehicle4` are one identical
  file — convert once.
- Also listen before shipping: `bf1918`'s `slaughter4` cuts out halfway
  through and was dropped for that reason.

## Mod icons

Most mods ship an `.ico` next to their mod folder (vanilla's `bf1942.ico`
and DC's `desertcombaticon.ico` are in the install root). Probe the layers
and extract the largest one with alpha:

```bash
ffprobe -show_entries stream=index,width,height,pix_fmt file.ico
ffmpeg -i file.ico -map 0:v:<stream> -frames:v 1 icons/<modprefix>.png
```

Interstate has no `.ico`; its 16×16 `serverInfo.dds` (the server-browser
icon) was used instead — ffmpeg decodes DDS too.

Output: `ui/public/wrapped-music/icons/<modprefix>.png`.

## Wiring into the UI

`ui/src/composables/useWrappedMusic.ts` is the single source of truth:

- Add the track to `WRAPPED_TRACKS` (`id` = mp3 basename without extension,
  `label` = curated display name — labels deliberately don't match source
  filenames, e.g. `slaughter4` → "Gettin' Kicked" — `mod` = display name of
  the group).
- New mod? Add its icon to `MOD_ICONS` keyed by the same `mod` name.
- Groups in the selector popover (`WrappedMusicControl.vue`) derive from
  the track list; removing a mod's last track removes its group.
- Track choice and on/off persist in localStorage
  (`wrapped-music-track` / `wrapped-music-enabled`); a stored id that no
  longer exists falls back to `DEFAULT_TRACK_ID`.

## If a track really is inside an RFA

`.rfa` is the Refractor engine archive format. Tools: `bga`
(Battlefield Game Archive) or `winrfa`; the install's `Tools/` folder may
have one. Extract the `.bik`/`.wav` from the archive, then convert as above.
