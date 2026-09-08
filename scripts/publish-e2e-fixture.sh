#!/usr/bin/env bash
# Compress the local E2E fixture pair and attach it to the `e2e-fixture` release
# so GitHub Actions can pull it.
#
#   scripts/publish-e2e-fixture.sh [--yes]
#
# THIS PUBLISHES DATA. The repository is public, so anything uploaded here is
# world-readable. Run scripts/make-e2e-fixture.sh first and be deliberate about
# --keep-profiles: player names, servers and scores are already public on
# bfstats.io, but the account-to-gamertag mapping in UserPlayerNames is not.
#
# The release is a plain storage tag, not a software release — it carries no
# code and is re-uploaded in place with --clobber each time the fixture is
# rebuilt from a fresh backup.
set -euo pipefail

CACHE="${BFSTATS_E2E_CACHE:-$HOME/.cache/bfstats-e2e}"
TAG=e2e-fixture
ASSUME_YES=""

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "==> $*"; }

[[ "${1:-}" == "--yes" ]] && ASSUME_YES=1

command -v gh    >/dev/null || die "gh CLI is required"
command -v zstd  >/dev/null || die "zstd is required"
[[ -f "$CACHE/template.db"  ]] || die "no fixture at $CACHE/template.db — run scripts/make-e2e-fixture.sh"
[[ -f "$CACHE/neo4j.dump"   ]] || die "no graph at $CACHE/neo4j.dump — run scripts/make-e2e-graph.sh"

META="$CACHE/template.meta"
[[ -f "$META" ]] || die "no $META — rebuild the fixture so provenance is recorded"

# Hard stop rather than a warning: a fixture built with --keep-emails carries
# real addresses, and this uploads to a public repository.
if grep -q '^emails=verbatim' "$META"; then
    die "this fixture was built with --keep-emails and must not be published.
     Rebuild without that flag."
fi

echo
echo "About to publish to the PUBLIC repository $(gh repo view --json nameWithOwner -q .nameWithOwner):"
sed 's/^/    /' "$META"
echo
echo "    linked profiles retained:"
sqlite3 "$CACHE/template.db" \
  "SELECT '      '||UserId||': '||COUNT(*)||' player names' FROM UserPlayerNames GROUP BY UserId;" \
  2>/dev/null || true
echo

if [[ -z "$ASSUME_YES" ]]; then
    read -r -p "Type 'publish' to continue: " reply
    [[ "$reply" == "publish" ]] || { echo "Aborted."; exit 1; }
fi

note "compressing"
zstd -19 -T0 -q -f "$CACHE/template.db" -o "$CACHE/template.db.zst"
zstd -19 -T0 -q -f "$CACHE/neo4j.dump"  -o "$CACHE/neo4j.dump.zst"
ls -lh "$CACHE/template.db.zst" "$CACHE/neo4j.dump.zst" | sed 's/^/    /'

if ! gh release view "$TAG" >/dev/null 2>&1; then
    note "creating release $TAG"
    gh release create "$TAG" \
      --title "E2E fixtures" \
      --notes "Slim SQLite + Neo4j fixtures for the E2E suite. Rebuilt from a production backup; see features/e2e-real-data-fixtures/. Not a software release." \
      --latest=false
fi

# Asset names are the basenames, so template.meta lands as template.meta — which
# is what the workflow and verify.sh both read.
note "uploading"
gh release upload "$TAG" \
  "$CACHE/template.db.zst" "$CACHE/neo4j.dump.zst" "$META" \
  --clobber

rm -f "$CACHE/template.db.zst" "$CACHE/neo4j.dump.zst"
note "published. The E2E workflow will pick it up on the next run."
