# recording-ml

The local trial for [features/recording-ml](../../features/recording-ml/README.md):
round recordings as tables, and the first models on them. Research code, run
by hand on a laptop; nothing here is deployed or imported by the site.

## Run it

```bash
tools/recording-ml/run.sh             # fetch what is new, export, build, analyse
tools/recording-ml/run.sh --no-sync   # the same on the recordings already here
```

The first run makes a virtualenv with `python3 -m venv` and installs
`requirements.txt` (DuckDB, PyArrow, NumPy, scikit-learn, Matplotlib). It
needs `node` and Python 3.11 or newer. It ends by printing the resume
triggers: what the parked work waits for and which are met.

Step by step, as `run.sh` does it (`PY=~/.cache/bfstats-recml/venv/bin/python`):

| Step | Command | Writes |
|---|---|---|
| Sync | `$PY tools/recording-ml/sync.py` | `raw/<slug>.ndjson.gz`, `raw/manifest.json`, `raw/feed.json` |
| Export | `node tools/bf1942-models/export_recording_tables.mjs` | `tables/<slug>/*.jsonl`; `name-key` on the first run |
| Tank fights | `node tools/bf1942-models/extract_tank_fights.mjs ~/.cache/bfstats-recml/raw --out ~/.cache/bfstats-recml/extract/tankfights --feed ~/.cache/bfstats-recml/raw/feed.json --glb-cache ~/.cache/bfstats-recml/catalogue/glb-guns.json` | `extract/tankfights/*.json` |
| Flatten | `$PY tools/recording-ml/flatten_tank_fights.py` | `tables/<slug>/tank_fights.jsonl`, `tank_shots.jsonl` |
| Parquet | `$PY tools/recording-ml/build_tables.py` | `parquet/<table>.parquet`, `parquet/splits.parquet` |
| Air approach | `$PY tools/recording-ml/approach_model.py [--chart file.png]` | `out/approach.md`, `.json`, `approach-lead-times.png` |
| Tank guns | `$PY tools/recording-ml/tank_first_shots.py` | `out/tank_first_shots.md`, `.json` |
| Triggers | `$PY tools/recording-ml/status.py` | `out/status.md`, `.json` |

Sync and export are incremental: a recording already fetched is not fetched
again, and one whose tables carry the same content hash and rule versions is
not exported again (`--force` does).

## Where the data is

Everything is under `~/.cache/bfstats-recml/` (`$BFSTATS_RECML_DIR` or
`--data` moves it), outside the repository:

| Folder | Holds | Player names |
|---|---|---|
| `raw/` | the recordings as the site stores them, the manifest | yes (the files themselves) |
| `extract/` | the tank school's fight files | yes |
| `name-key` | the key names are hashed under; never copy it anywhere | |
| `catalogue/` | the model catalogues and gun data the export read | no |
| `tables/`, `parquet/` | the tables | no: a 16-digit key a name |
| `out/` | reports and the chart | no |
| `venv/` | the Python environment | |

## Rules

- Local only. Nothing is uploaded; only the public feed is read.
- Names are keyed at export (HMAC-SHA256 under `name-key`); chat is not
  exported. Reports say "one pilot", never who.
- One recording a round (the manifest's `lead`) in every count, so a round
  recorded twice is not counted twice.
- Validate by round and by pilot, never by row: fights of one round share
  their pilots. `splits.parquet` holds a stable five-fold assignment for
  both; the scripts here leave one round, or both pilots, out.
- A recording the feed no longer lists is removed by the next sync, with its
  tables.

## Query the tables

```bash
~/.cache/bfstats-recml/venv/bin/python - <<'PY'
import sys; sys.path.insert(0, "tools/recording-ml")
from common import connect, data_dir, rows
db = connect(data_dir())
print(rows(db, "SELECT plane0, plane1, count(*) n FROM air_encounters GROUP BY ALL ORDER BY n DESC LIMIT 5"))
PY
```

Tables: `recordings`, `players`, `kills`, `tickets`, `captures`, `accuracy`,
`air_fights`, `air_encounters`, `air_ticks`, `tank_fights`, `tank_shots`,
`splits`. Their columns are described at the top of
`tools/bf1942-models/export_recording_tables.mjs` and
`flatten_tank_fights.py`.
