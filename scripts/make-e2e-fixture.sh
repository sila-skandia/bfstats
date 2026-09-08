#!/usr/bin/env bash
# Carve a slim, referentially-complete E2E fixture out of a full playertracker.db.
#
#   scripts/make-e2e-fixture.sh <source.db> [options]
#
#   --out PATH        where to write it (default ~/.cache/bfstats-e2e/template.db)
#   --fact-days N     history of rounds/sessions/aggregates to keep (default 14)
#   --obs-rounds N    how many of the newest rounds keep their observations (default 1000)
#   --anchor 'TS'     override the window anchor (default: MAX(Rounds.StartTime))
#   --keep-emails     copy Users.Email verbatim instead of redacting it
#   --keep-profiles   comma-separated Users.Id whose linked player names, buddies
#                     and favourite servers survive. Everyone else's are dropped.
#                     Default: drop all. This fixture is publishable, and the
#                     account-to-gamertag mapping is the one part of it that is
#                     not already on the public site.
#   --force           overwrite an existing --out
#
# Design notes and measurements: features/e2e-real-data-fixtures/.
#
# Rarely run — only when the schema changes or the data goes stale. verify.sh
# consumes the output; it never calls this.
set -euo pipefail

FACT_DAYS=14
OBS_ROUNDS=1000
ANCHOR=""
KEEP_EMAILS=""
KEEP_PROFILES=""
FORCE=""
# E2eDatabaseSeed's synthetic admin. Not a real address, so the leak sweep below
# must not trip on it once the graph build has seeded the template.
E2E_SEED_EMAIL="admin@bfstats.io"
OUT="${HOME}/.cache/bfstats-e2e/template.db"
SRC=""

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "==> $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)         OUT="$2"; shift 2 ;;
    --fact-days)   FACT_DAYS="$2"; shift 2 ;;
    --obs-rounds)  OBS_ROUNDS="$2"; shift 2 ;;
    --anchor)      ANCHOR="$2"; shift 2 ;;
    --keep-emails) KEEP_EMAILS=1; shift ;;
    --keep-profiles)
      [[ "$2" =~ ^[0-9]+(,[0-9]+)*$ ]] || die "--keep-profiles wants comma-separated numeric ids, got '$2'"
      KEEP_PROFILES="$2"; shift 2 ;;
    --force)       FORCE=1; shift ;;
    -h|--help)     sed -n '2,15p' "$0"; exit 0 ;;
    -*)            die "unknown option $1" ;;
    *)             [[ -n "$SRC" ]] && die "source given twice"; SRC="$1"; shift ;;
  esac
done

[[ -n "$SRC" ]] || die "no source database given. Usage: $0 <source.db> [options]"
[[ -f "$SRC" ]] || die "source not found: $SRC"
command -v sqlite3 >/dev/null || die "sqlite3 is required"
[[ -f "$OUT" && -z "$FORCE" ]] && die "$OUT exists. Pass --force to replace it."

# A non-empty WAL means the backup was taken without checkpointing and the
# newest committed rows are not in the main file. BACKUP_RUNBOOK.md step 5.
if [[ -s "${SRC}-wal" ]]; then
  die "${SRC}-wal is non-empty — the source is missing committed data.
     Checkpoint it first:  sqlite3 '$SRC' 'PRAGMA wal_checkpoint(TRUNCATE);'"
fi

RO="file:${SRC}?mode=ro"
sqlite3 "$RO" "SELECT 1 FROM Rounds LIMIT 1;" >/dev/null 2>&1 \
  || die "source has no readable Rounds table — is this a playertracker.db?"

# Anchor on the SOURCE's own clock, never wall clock. A backup is always stale;
# "now() minus N days" against one silently produces an empty fixture.
[[ -n "$ANCHOR" ]] || ANCHOR="$(sqlite3 "$RO" "SELECT MAX(StartTime) FROM Rounds;")"
[[ -n "$ANCHOR" ]] || die "could not determine an anchor (Rounds is empty)"

FACT_FROM="$(date -u -d "${ANCHOR%% *} -${FACT_DAYS} days" +%Y-%m-%d)"
FACT_YM=$(( $(date -u -d "$FACT_FROM" +%Y) * 100 + 10#$(date -u -d "$FACT_FROM" +%m) ))

WORK="$(mktemp -d)"
TMP_OUT="${WORK}/template.db"
trap 'rm -rf "$WORK"' EXIT

note "source     $SRC ($(du -h "$SRC" | cut -f1))"
note "anchor     $ANCHOR"
note "facts      [$FACT_FROM .. $ANCHOR]  (month-granular tables from $FACT_YM)"
note "detail     newest $OBS_ROUNDS rounds keep observations"

# DDL comes from sqlite_master, not `.schema`: index DDL here spans multiple
# lines, so a line-oriented split tears statements in half. Indexes are applied
# after the inserts — building 122 of them incrementally is far slower.
sqlite3 "$RO" "SELECT sql||';' FROM sqlite_master
               WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%';" \
  > "$WORK/tables.sql"
sqlite3 "$RO" "SELECT sql||';' FROM sqlite_master
               WHERE type='index' AND sql IS NOT NULL;" > "$WORK/indexes.sql"
sqlite3 "$TMP_OUT" < "$WORK/tables.sql"

# Reference/config tables copied whole. Emitted only if the source actually has
# them, so an older production schema does not abort the run.
WHOLE_TABLES=(
  Servers Users UserPlayerNames UserBuddies UserFavoriteServers
  app_data __EFMigrationsHistory
  HourlyActivityPatterns HourlyPlayerPredictions MapGlobalAverages
  ServerHourlyPatterns
  TournamentTheme Tournaments TournamentTeams TournamentTeamPlayers
  TournamentMatches TournamentMatchMaps TournamentMatchResults
  TournamentTeamRankings TournamentWeekDates TournamentPosts
  TournamentComments TournamentMatchComments TournamentFiles TournamentMatchFiles
  PlayerComments ServerComments
)
: > "$WORK/whole.sql"
for t in "${WHOLE_TABLES[@]}"; do
  if sqlite3 "$RO" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='$t';" | grep -q 1; then
    echo "INSERT INTO main.\"$t\" SELECT * FROM src.\"$t\";" >> "$WORK/whole.sql"
  else
    echo "    (source has no $t — skipped)"
  fi
done

# Never copied: RefreshTokens, AdminPins (credentials); PlayerWrappedCaches,
# ServerWrappedCaches (regenerable JSON blobs); AdminAuditLogs, AIChatFeedback,
# TournamentImageIndices, __EFMigrationsLock.

note "extracting"
t0=$(date +%s)
sqlite3 "$TMP_OUT" <<SQL
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
ATTACH DATABASE '$RO' AS src;

.read $WORK/whole.sql

-- Rounds define the window; everything else keys off the retained round set.
INSERT INTO main.Rounds
  SELECT * FROM src.Rounds
  WHERE StartTime >= '$FACT_FROM' AND StartTime <= '$ANCHOR';

-- Sessions follow their round rather than their own StartTime. A session can
-- begin inside the window on a round that began before it; filtering on the
-- session date leaves those pointing at a round we did not keep.
INSERT INTO main.PlayerSessions
  SELECT * FROM src.PlayerSessions
  WHERE RoundId IN (SELECT RoundId FROM main.Rounds)
     OR (RoundId IS NULL AND StartTime >= '$FACT_FROM' AND StartTime <= '$ANCHOR');

INSERT INTO main.ServerOnlineCounts
  SELECT * FROM src.ServerOnlineCounts
  WHERE HourTimestamp >= '$FACT_FROM' AND HourTimestamp <= '$ANCHOR';

INSERT INTO main.Players
  SELECT * FROM src.Players
  WHERE Name IN (SELECT DISTINCT PlayerName FROM main.PlayerSessions);

-- Per-player aggregates are scoped to the (player, server) pairs that actually
-- appear in the window. Filtering on PlayerName alone drags in every server the
-- player ever touched, which on its own doubled the fixture.
CREATE TEMP TABLE kept_pairs AS
  SELECT DISTINCT PlayerName, ServerGuid FROM main.PlayerSessions;
CREATE INDEX temp.ix_kept_pairs ON kept_pairs(PlayerName, ServerGuid);
CREATE TEMP TABLE kept_servers AS
  SELECT DISTINCT ServerGuid FROM main.PlayerSessions;

-- Month-granular tables can only be cut to whole months, so a 14-day window
-- still pulls the containing month. That is the floor on fixture size.
INSERT INTO main.PlayerMapStats
  SELECT a.* FROM src.PlayerMapStats a
  JOIN kept_pairs k ON k.PlayerName = a.PlayerName AND k.ServerGuid = a.ServerGuid
  WHERE a.Year * 100 + a.Month >= $FACT_YM;

INSERT INTO main.PlayerServerStats
  SELECT a.* FROM src.PlayerServerStats a
  JOIN kept_pairs k ON k.PlayerName = a.PlayerName AND k.ServerGuid = a.ServerGuid
  WHERE a.UpdatedAt >= '$FACT_FROM';

INSERT INTO main.ServerPlayerRankings
  SELECT a.* FROM src.ServerPlayerRankings a
  JOIN kept_pairs k ON k.PlayerName = a.PlayerName AND k.ServerGuid = a.ServerGuid
  WHERE a.Year * 100 + a.Month >= $FACT_YM;

INSERT INTO main.PlayerStatsMonthly
  SELECT * FROM src.PlayerStatsMonthly
  WHERE Year * 100 + Month >= $FACT_YM
    AND PlayerName IN (SELECT Name FROM main.Players);

INSERT INTO main.PlayerAchievements
  SELECT * FROM src.PlayerAchievements
  WHERE AchievedAt >= '$FACT_FROM' AND AchievedAt <= '$ANCHOR'
    AND PlayerName IN (SELECT Name FROM main.Players);

INSERT INTO main.PlayerBestScores
  SELECT * FROM src.PlayerBestScores
  WHERE PlayerName IN (SELECT Name FROM main.Players);

INSERT INTO main.ServerMapStats
  SELECT a.* FROM src.ServerMapStats a
  WHERE a.Year * 100 + a.Month >= $FACT_YM
    AND a.ServerGuid IN (SELECT ServerGuid FROM kept_servers);

INSERT INTO main.MapServerHourlyPatterns
  SELECT * FROM src.MapServerHourlyPatterns
  WHERE ServerGuid IN (SELECT ServerGuid FROM kept_servers);

INSERT INTO main.ServerBestScoreRaw
  SELECT * FROM src.ServerBestScoreRaw
  WHERE SessionId IN (SELECT SessionId FROM main.PlayerSessions);

-- Observations are bounded by round COUNT, not by days, so fixture size does
-- not swing with how busy production happened to be that fortnight. This table
-- is ~78% of the source file; nothing else here matters as much.
CREATE TEMP TABLE detail_sessions AS
  SELECT SessionId FROM main.PlayerSessions
  WHERE RoundId IN (
    SELECT RoundId FROM main.Rounds ORDER BY StartTime DESC LIMIT $OBS_ROUNDS
  );

INSERT INTO main.PlayerObservations
  SELECT * FROM src.PlayerObservations
  WHERE SessionId IN (SELECT SessionId FROM detail_sessions);

-- ObservationCount would otherwise advertise rows that are not here, and the
-- round report renders straight off it.
UPDATE main.PlayerSessions
   SET ObservationCount = 0
 WHERE SessionId NOT IN (SELECT SessionId FROM detail_sessions);

-- Referential closure. The whole-copied tables reference players and rounds
-- from outside the window; without this the fixture carries ~490 dangling FKs,
-- and a tournament with a missing Organizer breaks the tournament list.
INSERT INTO main.Players
  SELECT * FROM src.Players
  WHERE Name NOT IN (SELECT Name FROM main.Players)
    AND Name IN (
      SELECT Organizer            FROM main.Tournaments           WHERE Organizer IS NOT NULL
      UNION SELECT PlayerName     FROM main.TournamentTeamPlayers WHERE PlayerName IS NOT NULL
      UNION SELECT BuddyPlayerName FROM main.UserBuddies          WHERE BuddyPlayerName IS NOT NULL
      UNION SELECT PlayerName     FROM main.ServerPlayerRankings  WHERE PlayerName IS NOT NULL
    );

INSERT INTO main.Rounds
  SELECT * FROM src.Rounds
  WHERE RoundId NOT IN (SELECT RoundId FROM main.Rounds)
    AND RoundId IN (SELECT RoundId FROM main.TournamentMatchResults WHERE RoundId IS NOT NULL);
SQL

if [[ -z "$KEEP_EMAILS" ]]; then
  # Player and server names are public; account emails are not. The suite
  # authenticates as E2eDatabaseSeed's own admin@bfstats.io, so nothing depends
  # on these values. --keep-emails opts out.
  # LastLoggedIn is NOT NULL, so it stays as-is; the email is the identifier.
  # Tournaments and TournamentPosts keep denormalised copies of the creator's
  # address; both carry the user id too, so they redact to the same value.
  sqlite3 "$TMP_OUT" <<'SQL'
UPDATE Users            SET Email              = 'user' || Id || '@e2e.invalid';
UPDATE Tournaments      SET CreatedByUserEmail = 'user' || CreatedByUserId || '@e2e.invalid'
  WHERE CreatedByUserEmail IS NOT NULL;
UPDATE TournamentPosts  SET CreatedByUserEmail = 'user' || CreatedByUserId || '@e2e.invalid'
  WHERE CreatedByUserEmail IS NOT NULL;
SQL
  note "redacted emails ($(sqlite3 "$TMP_OUT" "SELECT COUNT(*) FROM Users;") users, \
$(sqlite3 "$TMP_OUT" "SELECT COUNT(*) FROM Tournaments WHERE CreatedByUserEmail IS NOT NULL;") tournaments, \
$(sqlite3 "$TMP_OUT" "SELECT COUNT(*) FROM TournamentPosts WHERE CreatedByUserEmail IS NOT NULL;") posts)"

  # Schema-driven backstop. The three columns above were found by sweeping for
  # them, not by reading the model — so sweep every time instead, and fail
  # rather than publish an address a future migration adds somewhere new.
  LEAKS=""
  for t in $(sqlite3 "$TMP_OUT" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"); do
      for c in $(sqlite3 "$TMP_OUT" "PRAGMA table_info(\"$t\");" | awk -F'|' '$2 ~ /[Ee]mail/ {print $2}'); do
          n="$(sqlite3 "$TMP_OUT" "SELECT COUNT(*) FROM \"$t\"
                 WHERE \"$c\" IS NOT NULL
                   AND \"$c\" NOT LIKE '%@e2e.invalid'
                   AND \"$c\" <> '${E2E_SEED_EMAIL}';")"
          [[ "${n:-0}" -gt 0 ]] && LEAKS="${LEAKS}
       $t.$c: $n row(s)"
      done
  done
  [[ -z "$LEAKS" ]] || die "unredacted addresses remain — refusing to publish:$LEAKS
     Add them to the redaction block above."
fi

# Users rows themselves have to stay — tournaments, teams and comments all
# reference them — but the three profile tables are leaves that nothing points
# at, so they can be emptied without dangling anything. They hold the
# account-to-gamertag mapping, which unlike player names and scores is behind
# auth in production and is not otherwise public.
KEEP_SQL="${KEEP_PROFILES:-NULL}"
sqlite3 "$TMP_OUT" <<SQL
DELETE FROM UserPlayerNames     WHERE UserId NOT IN ($KEEP_SQL);
DELETE FROM UserBuddies         WHERE UserId NOT IN ($KEEP_SQL);
DELETE FROM UserFavoriteServers WHERE UserId NOT IN ($KEEP_SQL);
SQL
if [[ -n "$KEEP_PROFILES" ]]; then
    note "kept profiles for user id(s) $KEEP_PROFILES — $(sqlite3 "$TMP_OUT" \
      "SELECT (SELECT COUNT(*) FROM UserPlayerNames)||' names, '||
              (SELECT COUNT(*) FROM UserBuddies)||' buddies, '||
              (SELECT COUNT(*) FROM UserFavoriteServers)||' favourites';")"
else
    note "dropped all linked profiles (pass --keep-profiles to retain some)"
fi

t1=$(date +%s); note "extract: $((t1-t0))s"
sqlite3 "$TMP_OUT" < "$WORK/indexes.sql"
t2=$(date +%s); note "indexes: $((t2-t1))s"

# The app leans on sqlite_stat1 for plan selection (SqliteConnectionInterceptor),
# so the fixture ships with statistics rather than making the first run pay.
sqlite3 "$TMP_OUT" "ANALYZE; VACUUM; PRAGMA journal_mode=WAL;" >/dev/null
t3=$(date +%s); note "analyze+vacuum: $((t3-t2))s"

# Production carries dangling foreign keys of its own — SQLite only enforces
# ON DELETE CASCADE when foreign_keys=ON, and nothing in the app sets it, so
# deleted parents leave orphans behind. Those are faithfully copied here. Drop
# them: a fixture should be cleaner than production, and a dangling parent is a
# confusing test failure rather than a useful one.
#
# This is deliberately not a hard failure, but the count is reported and the
# check below is still a hard gate — if orphans remain after one sweep, the
# extraction itself introduced something and must not be published.
note "pruning orphans inherited from the source"
ORPHANS=0
while read -r child rowid parent _; do
    [[ -n "$child" ]] || continue
    sqlite3 "$TMP_OUT" "DELETE FROM \"$child\" WHERE rowid = $rowid;"
    ORPHANS=$((ORPHANS + 1))
done < <(sqlite3 -separator ' ' "$TMP_OUT" "PRAGMA foreign_key_check;")
if [[ "$ORPHANS" -gt 0 ]]; then
    note "removed $ORPHANS orphaned row(s)"
fi

note "verifying"
FK="$(sqlite3 "$TMP_OUT" "PRAGMA foreign_key_check;" | head -5)"
[[ -z "$FK" ]] || die "fixture still has dangling foreign keys after pruning —
     this means the extraction introduced them, not the source. Refusing to publish:
$FK"

check_rows() {
  local table="$1" min="$2" n
  n="$(sqlite3 "$TMP_OUT" "SELECT COUNT(*) FROM \"$table\";")"
  [[ "$n" -ge "$min" ]] || die "$table has $n rows, expected >= $min. Window is probably wrong."
  printf '    %-22s %s\n' "$table" "$n"
}
check_rows Servers 1
check_rows Rounds 100
check_rows PlayerSessions 100
check_rows Players 50
check_rows PlayerObservations 100
check_rows PlayerServerStats 1

mkdir -p "$(dirname "$OUT")"
mv -f "$TMP_OUT" "$OUT"
rm -f "${OUT}-wal" "${OUT}-shm"

cat > "${OUT%.db}.meta" <<META
source=$SRC
source_mtime=$(date -u -d "@$(stat -c %Y "$SRC")" +%Y-%m-%dT%H:%M:%SZ)
anchor=$ANCHOR
fact_days=$FACT_DAYS
fact_from=$FACT_FROM
obs_rounds=$OBS_ROUNDS
emails=$([[ -n "$KEEP_EMAILS" ]] && echo verbatim || echo redacted)
kept_profiles=${KEEP_PROFILES:-none}
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
migration_head=$(sqlite3 "$OUT" "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1;" 2>/dev/null)
META

note "wrote $OUT ($(du -h "$OUT" | cut -f1)) in $((t3-t0))s"
note "meta  ${OUT%.db}.meta"
echo
echo "Next: build the graph template from it —"
echo "  scripts/make-e2e-graph.sh $OUT"
