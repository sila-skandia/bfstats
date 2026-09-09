#!/usr/bin/env bash
# Compress the local Neo4j graph template and attach it to the `e2e-fixture`
# release so a developer pulling the fixture gets a graph that matches it.
#
#   scripts/publish-e2e-fixture.sh [--yes]
#
# This script owns the GRAPH half of the release only. The SQLite half
# (`template.db.zst` + `template.meta`) is carved straight off the production
# backup by the `bfstats-backup-both` runbook in home-server-mgr and uploaded
# from there, so it refreshes on every backup instead of whenever someone
# remembers to. Don't re-add it here — two publishers for one asset is how the
# release ends up describing data it isn't carrying.
#
# THIS PUBLISHES DATA. The repository is public. The graph carries player names,
# servers and co-play edges, all of which are already public on bfstats.io. It
# carries no emails and no account-to-gamertag linkage — those exist only in the
# SQLite half, and the runbook is what redacts them.
#
# The release is a plain storage tag, not a software release — the asset is
# re-uploaded in place with --clobber each time the graph is rebuilt.
set -euo pipefail

CACHE="${BFSTATS_E2E_CACHE:-$HOME/.cache/bfstats-e2e}"
TAG=e2e-fixture
ASSUME_YES=""

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "==> $*"; }

[[ "${1:-}" == "--yes" ]] && ASSUME_YES=1

command -v gh    >/dev/null || die "gh CLI is required"
command -v zstd  >/dev/null || die "zstd is required"
[[ -f "$CACHE/neo4j.dump" ]] || die "no graph at $CACHE/neo4j.dump — run scripts/make-e2e-graph.sh"

META="$CACHE/template.meta"
[[ -f "$META" ]] || die "no $META — a graph is only meaningful next to the fixture it was built from.
     Fetch the current pair:  gh release download $TAG --dir $CACHE --clobber && zstd -d $CACHE/*.zst --rm"

# make-e2e-graph.sh appends these. Without them this dump was not built from the
# template.db sitting beside it, and publishing it would pair a graph with a
# fixture it does not describe.
grep -q '^graph_built=' "$META" \
  || die "$META records no graph build — this dump and that fixture are unrelated.
     Rebuild:  scripts/make-e2e-graph.sh --force"

echo
echo "About to publish the graph to the PUBLIC repository $(gh repo view --json nameWithOwner -q .nameWithOwner):"
grep -E '^(anchor|fact_from|built|graph_)' "$META" | sed 's/^/    /'
echo

if [[ -z "$ASSUME_YES" ]]; then
    read -r -p "Type 'publish' to continue: " reply
    [[ "$reply" == "publish" ]] || { echo "Aborted."; exit 1; }
fi

note "compressing"
zstd -19 -T0 -q -f "$CACHE/neo4j.dump" -o "$CACHE/neo4j.dump.zst"
ls -lh "$CACHE/neo4j.dump.zst" | sed 's/^/    /'

if ! gh release view "$TAG" >/dev/null 2>&1; then
    note "creating release $TAG"
    gh release create "$TAG" \
      --title "E2E fixtures" \
      --notes "Slim SQLite + Neo4j fixtures for the E2E suite. The SQLite half is published from the bfstats-backup-both runbook in home-server-mgr; the graph from scripts/publish-e2e-fixture.sh. See features/e2e-real-data-fixtures/. Not a software release." \
      --latest=false
fi

# The asset name is the basename, so this lands as neo4j.dump.zst — which is what
# the CI workflow's blanket `zstd -d *.zst` and verify.sh both expect.
note "uploading"
gh release upload "$TAG" "$CACHE/neo4j.dump.zst" --clobber

rm -f "$CACHE/neo4j.dump.zst"
note "published. E2E_NEO4J=1 runs will pick it up on the next fetch."
