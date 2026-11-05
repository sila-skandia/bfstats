#!/usr/bin/env bash
# Which Python verify.sh runs the repo's own tests with.
#
# Sourced, then call verify_python: it prints the interpreter's path.
#
#   PYTHON=/path/to/python   wins outright.
#   otherwise                the first interpreter that is 3.10+ and imports
#                            PIL, else the first that is 3.10+, else python3.
#
# Candidates are python3 first, so a machine where python3 already works is
# left alone (CI, any Linux box), then every python3.N on PATH, newest first.
#
# Why not just python3: macOS ships /usr/bin/python3 as 3.9, too old for the
# BF1942 tool tests (zip(strict=), `X | None`), and a non-login shell, the kind
# Claude Code runs commands in, puts /usr/bin ahead of Homebrew's bin. A
# login shell may instead put a keg-only python@3.N first, without Pillow. The
# Pillow preference makes both pick the same Homebrew python. Sourced by
# verify.sh and bootstrap-worktree.sh, so they cannot disagree about it.

verify_python() {
    if [ -n "${PYTHON:-}" ]; then
        command -v "$PYTHON" || echo "$PYTHON"
        return 0
    fi
    local candidates want py
    # `|| true`: no python3.N on PATH is fine, and callers may set -e -o pipefail.
    candidates="python3 $(compgen -c python3. 2>/dev/null | grep -E '^python3\.[0-9]+$' | sort -t. -k2 -rn | uniq || true)"
    for want in 'import PIL' ''; do
        for py in $candidates; do
            command -v "$py" >/dev/null 2>&1 || continue
            if "$py" -c "import sys; assert sys.version_info >= (3, 10); $want" >/dev/null 2>&1; then
                command -v "$py"
                return 0
            fi
        done
    done
    command -v python3 || echo python3
}
