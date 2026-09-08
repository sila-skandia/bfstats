#!/usr/bin/env bash
# Build the Neo4j graph template that pairs with an E2E SQLite fixture.
#
#   scripts/make-e2e-graph.sh [template.db] [--out PATH] [--force]
#
# The graph is a pure function of Rounds + PlayerSessions
# (PlayerRelationshipEtlService), so it is rebuilt from the fixture rather than
# restored from a production Neo4j backup. That guarantees the graph and the
# relational data agree — a 3 GB production graph paired with a 350 MB SQLite
# slice would not.
#
# Run this from a checkout of the branch you want the template to carry
# (normally main): the fixture is migrated to this branch's head as a side
# effect, and that schema ships inside template.db.
#
# Design notes and measurements: features/e2e-real-data-fixtures/.
set -euo pipefail

CACHE="${BFSTATS_E2E_CACHE:-$HOME/.cache/bfstats-e2e}"
TEMPLATE="$CACHE/template.db"
OUT="$CACHE/neo4j.dump"
FORCE=""
# Deliberately outside both the dev port (7687) and the per-slot range (7690+).
BUILD_PORT=7689
CONTAINER=bfstats-e2e-graph-build
NEO4J_IMAGE="${NEO4J_IMAGE:-neo4j:5.15-community}"
NEO4J_PASSWORD=bf1942stats

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "==> $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)     OUT="$2"; shift 2 ;;
    --force)   FORCE=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*)        die "unknown option $1" ;;
    *)         TEMPLATE="$1"; shift ;;
  esac
done

[[ -f "$TEMPLATE" ]] || die "no fixture at $TEMPLATE — run scripts/make-e2e-fixture.sh first"
[[ -f "$OUT" && -z "$FORCE" ]] && die "$OUT exists. Pass --force to replace it."
command -v docker >/dev/null || die "docker is required"
command -v sqlite3 >/dev/null || die "sqlite3 is required"

WORK="$(mktemp -d)"
DATA="$WORK/data"
DUMPS="$WORK/dumps"
mkdir -p "$DATA" "$DUMPS"
chmod -R 777 "$WORK"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # The store is written by uid 7474, so remove it from inside a container.
  docker run --rm -v "$WORK":/w alpine:latest rm -rf /w/data /w/dumps >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# The ETL is additive: PLAYED_WITH.sessionCount accumulates, and its own docs warn
# that replaying a range whose graph data still exists double-counts. Building
# into a container with an empty store is what makes the result deterministic.
note "starting empty $NEO4J_IMAGE on :$BUILD_PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -p "${BUILD_PORT}:7687" \
  -v "$DATA":/data \
  -e NEO4J_AUTH="neo4j/${NEO4J_PASSWORD}" \
  -e NEO4J_server_memory_heap_initial__size=1g \
  -e NEO4J_server_memory_heap_max__size=2g \
  -e NEO4J_server_memory_pagecache_size=512m \
  "$NEO4J_IMAGE" >/dev/null

deadline=$(( $(date +%s) + 120 ))
until docker exec "$CONTAINER" cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "RETURN 1;" >/dev/null 2>&1; do
  sleep 1
  [[ $(date +%s) -gt $deadline ]] && { docker logs --tail 30 "$CONTAINER"; die "Neo4j did not come up"; }
done
note "Neo4j ready"

# The ETL stamps SyncedToNeo4jAt as it goes, so it writes to the fixture. Work on
# a copy and only publish it if the whole build succeeds.
WORK_DB="$WORK/build.db"
sqlite3 "$TEMPLATE" ".backup '$WORK_DB'"

FACT_FROM="$(sed -n 's/^fact_from=//p' "${TEMPLATE%.db}.meta" 2>/dev/null || true)"
GRAPH_FROM="${FACT_FROM:-2000-01-01}"
note "building graph from $GRAPH_FROM (E2E_SEED migrates the fixture to this branch's head first)"

BUILD_LOG="/tmp/bfstats-e2e-graph-build.log"
t0=$(date +%s)
(
  cd "$REPO_ROOT/api" && exec env \
    ASPNETCORE_ENVIRONMENT=Development \
    DB_PATH="$WORK_DB" \
    E2E_SEED=true \
    E2E_BUILD_GRAPH=true \
    E2E_GRAPH_FROM="$GRAPH_FROM" \
    DISABLE_BACKGROUND_PROCESSING=true \
    REDIS_CONNECTION_STRING='localhost:6379' \
    REDIS_INSTANCE_NAME='e2e-graph-build' \
    Neo4j__Uri="bolt://127.0.0.1:${BUILD_PORT}" \
    Neo4j__Username=neo4j \
    Neo4j__Password="$NEO4J_PASSWORD" \
    Neo4j__Database=neo4j \
    dotnet run --no-launch-profile
) > "$BUILD_LOG" 2>&1 || { tail -30 "$BUILD_LOG"; die "graph build failed — full log: $BUILD_LOG"; }
t1=$(date +%s)
grep -oE '"?Graph build[^"]*' "$BUILD_LOG" | tail -2 | sed 's/^/    /' || true
note "ETL finished in $((t1-t0))s (log: $BUILD_LOG)"

NODES="$(docker exec "$CONTAINER" cypher-shell -u neo4j -p "$NEO4J_PASSWORD" --format plain \
          "MATCH (n) RETURN count(n);" | tail -1)"
RELS="$(docker exec "$CONTAINER" cypher-shell -u neo4j -p "$NEO4J_PASSWORD" --format plain \
          "MATCH ()-[r]->() RETURN count(r);" | tail -1)"
note "graph: $NODES nodes, $RELS relationships"
[[ "${RELS:-0}" -gt 0 ]] || die "graph is empty — the ETL found nothing to sync.
     Check that $TEMPLATE has rounds on or after $GRAPH_FROM."

# Stop before dumping: the shutdown checkpoints the store, and neo4j-admin
# refuses to run against a live database.
note "stopping Neo4j and dumping"
docker stop "$CONTAINER" >/dev/null
docker run --rm -v "$DATA":/data -v "$DUMPS":/dumps "$NEO4J_IMAGE" \
  neo4j-admin database dump neo4j --to-path=/dumps 2>&1 | tail -2

[[ -f "$DUMPS/neo4j.dump" ]] || die "neo4j-admin produced no dump"
docker run --rm -v "$DUMPS":/dumps alpine:latest \
  chown "$(id -u):$(id -g)" /dumps/neo4j.dump

mkdir -p "$(dirname "$OUT")"
mv -f "$DUMPS/neo4j.dump" "$OUT"

# Publish the fixture too. Its SyncedToNeo4jAt stamps now match the dump, so a
# run that re-triggers the ETL finds nothing pending instead of double-counting
# into an already-populated graph.
sqlite3 "$WORK_DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
rm -f "$TEMPLATE" "${TEMPLATE}-wal" "${TEMPLATE}-shm"
sqlite3 "$WORK_DB" ".backup '$TEMPLATE'"

cat >> "${TEMPLATE%.db}.meta" <<META
graph_built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
graph_from=$GRAPH_FROM
graph_nodes=$NODES
graph_relationships=$RELS
graph_image=$NEO4J_IMAGE
META

note "wrote $OUT ($(du -h "$OUT" | cut -f1))"
note "republished $TEMPLATE with matching sync watermarks"
echo
echo "Both artifacts are in $CACHE. verify.sh will pick them up automatically."
