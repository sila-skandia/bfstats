#!/usr/bin/env bash
# Throwaway signing material for an E2E stack, one set per worktree.
#
# The API refuses to start without an RS256 key (Program.cs asserts on
# Jwt:PrivateKey / Jwt:PrivateKeyPath), and ui/e2e/helpers/auth.ts logs in
# through the real /stats/auth/login endpoint, so the suite needs a genuine
# signed token rather than a stub.
#
# That key used to come from the developer's `dotnet user-secrets`, which is
# per-machine, invisible, and not something a fresh worktree or a CI runner has
# — so the workflow grew its own `openssl genrsa` step to compensate. This file
# is the one implementation both now use, so local and CI cannot drift.
#
# Sourced, then call ensure_e2e_secrets. Exports:
#   E2E_JWT_PRIVATE_KEY_B64  base64 of the PEM. TokenService.DecodePemIfBase64
#                            accepts that, which keeps a multi-line key out of
#                            the single-line env string verify.sh builds.
#   E2E_REFRESH_SECRET       HMAC secret for RefreshTokenService.
#
# Both live in the gitignored .e2e/ directory and are regenerated on demand.
# They sign nothing that outlives the run; do not reuse them anywhere real.

ensure_e2e_secrets() {
    local root="${1:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
    local dir="$root/.e2e"
    local key="$dir/jwt-e2e.pem"
    local secret="$dir/refresh-secret"

    if ! command -v openssl >/dev/null 2>&1; then
        echo "❌ openssl is required to generate E2E signing material." >&2
        return 1
    fi

    mkdir -p "$dir"

    if [[ ! -s "$key" ]]; then
        openssl genrsa -out "$key" 2048 2>/dev/null || {
            echo "❌ Could not generate $key" >&2
            return 1
        }
        chmod 600 "$key"
        echo "🔑 Generated throwaway E2E JWT signing key ($key)"
    fi

    if [[ ! -s "$secret" ]]; then
        openssl rand -base64 48 | tr -d '\n' > "$secret"
        chmod 600 "$secret"
    fi

    # -w0 is GNU coreutils; BSD base64 wraps by default and needs the tr.
    E2E_JWT_PRIVATE_KEY_B64="$(base64 -w0 < "$key" 2>/dev/null || base64 < "$key" | tr -d '\n')"
    E2E_REFRESH_SECRET="$(cat "$secret")"
    export E2E_JWT_PRIVATE_KEY_B64 E2E_REFRESH_SECRET
}
