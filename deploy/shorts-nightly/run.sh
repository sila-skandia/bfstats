#!/usr/bin/env bash
# What the scheduler runs (launchd or systemd, both installed by install.sh):
# bring this checkout up to origin/main, then run the nightly from it. The
# checkout is the nightly's own, never a working one, so a change to the runner
# or the picker reaches the nightly once it is on main and nothing else moves.
# git replaces a changed file rather than writing into it, so updating the
# checkout under this running script is safe.
set -uo pipefail
cd "$(dirname "$0")/../.."
git fetch -q origin main && git checkout -q --detach FETCH_HEAD \
  || echo "could not bring the checkout up to origin/main; running what is here"
git log -1 --format='nightly at %h %s'
exec /bin/bash scripts/shorts-nightly.sh
