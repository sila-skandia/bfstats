#!/usr/bin/env bash
# Bootstrap a Claude Code cloud session for BF1942 reverse engineering with Ghidra.
# Idempotent: safe to re-run; re-runs skip work already done.
#
# Installs: JDK 21 (if missing), Ghidra 12.1.2 (headless zip), PyGhidra 3.1.0 (pip)
# Downloads: bf1942_lnxded.static + BF1942.exe from the bf1942-binaries GitHub release
# Restores: pre-analyzed Ghidra projects (client exe fully labeled, server with DWARF)
#
# Run from anywhere -- paths resolve relative to this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GHIDRA_VERSION="12.1.2"
GHIDRA_ZIP="ghidra_${GHIDRA_VERSION}_PUBLIC_20260605.zip"
GHIDRA_URL="https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/${GHIDRA_ZIP}"
REPO="sila-skandia/bfstats"
RELEASE_TAG="bf1942-binaries"
WORK="${SCRIPT_DIR}/.work"
INSTALL_DIR="${HOME}/ghidra-installs"
PROJECTS_DIR="${HOME}/ghidra"
GHIDRA_HOME="${INSTALL_DIR}/ghidra_${GHIDRA_VERSION}_PUBLIC"
HEADLESS="${GHIDRA_HOME}/support/analyzeHeadless"

mkdir -p "$WORK" "$INSTALL_DIR" "$PROJECTS_DIR"

# --- 1. JDK (Ghidra 12.x needs JDK 21+) --------------------------------------
if ! command -v java >/dev/null 2>&1 || ! java -version 2>&1 | grep -qE 'version "(21|22|23|24|25|26)'; then
  echo "[setup] installing JDK 21"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y -qq openjdk-21-jdk-headless
  else
    echo "ERROR: no java >= 21 and no apt-get; install JDK 21 manually" >&2
    exit 1
  fi
fi
java -version 2>&1 | head -1

# --- 2. Ghidra ----------------------------------------------------------------
if [ -x "$HEADLESS" ]; then
  echo "[setup] Ghidra already installed at $GHIDRA_HOME"
else
  echo "[setup] downloading Ghidra $GHIDRA_VERSION"
  if ! [ -f "$WORK/$GHIDRA_ZIP" ]; then
    curl -fSL --retry 3 -o "$WORK/$GHIDRA_ZIP" "$GHIDRA_URL"
  fi
  unzip -q "$WORK/$GHIDRA_ZIP" -d "$INSTALL_DIR"
fi

# --- 3. PyGhidra (lets headless run .py scripts via the `pyghidra` CLI) --------
if python3 -c "import pyghidra" 2>/dev/null; then
  echo "[setup] pyghidra already installed"
else
  echo "[setup] installing pyghidra (3.1.0 pairs with Ghidra 12.1.2)"
  python3 -m pip install "pyghidra==3.1.0"
fi
export GHIDRA_INSTALL_DIR="$GHIDRA_HOME"

# --- 4. Game binaries from the release -----------------------------------------
cd "$WORK"
echo "[setup] downloading binaries from release $RELEASE_TAG"

# Release assets are on a PRIVATE repo, so they need auth. gh is not
# pre-installed in the sandbox and GH_TOKEN may be unset in the setup-script
# environment, so discover a token: env -> the git credential helper the
# container used to clone this private repo.
find_github_token() {
  if [ -n "${GH_TOKEN:-}" ] && [ "$GH_TOKEN" != "proxy-injected" ]; then echo "$GH_TOKEN"; return 0; fi
  if [ -n "${GITHUB_TOKEN:-}" ] && [ "$GITHUB_TOKEN" != "proxy-injected" ]; then echo "$GITHUB_TOKEN"; return 0; fi
  local cred
  cred=$(printf 'protocol=https\nhost=github.com\n\n' \
    | GIT_TERMINAL_PROMPT=0 timeout 15 git credential fill 2>/dev/null \
    | sed -n 's/^password=//p')
  if [ -n "$cred" ] && [ "$cred" != "proxy-injected" ]; then echo "$cred"; return 0; fi
  return 1
}

GH_TOKEN="$(find_github_token)" || {
  echo "ERROR: could not find a GitHub token to fetch private release assets." >&2
  echo "Fix: add GH_TOKEN=<a PAT with repo scope on sila-skandia/bfstats> to the" >&2
  echo "cloud environment's environment-variable settings and start a new session." >&2
  exit 1
}
export GH_TOKEN

# gh -> apt gh -> raw REST calls, all authenticated with the found token.
download_release_assets() {
  local out_dir="$1"
  if command -v gh >/dev/null 2>&1; then
    gh release download "$RELEASE_TAG" --repo "$REPO" --clobber -D "$out_dir" && return 0
  fi
  echo "[setup] gh not found; trying apt-get install gh"
  if command -v apt-get >/dev/null 2>&1; then
    (sudo apt-get update -qq && sudo apt-get install -y -qq gh) \
      && gh release download "$RELEASE_TAG" --repo "$REPO" --clobber -D "$out_dir" && return 0
  fi
  echo "[setup] falling back to the GitHub REST API"
  local api="https://api.github.com/repos/$REPO/releases/tags/$RELEASE_TAG"
  local asset_url name
  curl -fsSL --retry 5 --retry-all-errors -H "Authorization: Bearer $GH_TOKEN" "$api" \
    | python3 -c 'import json,sys; [print(a["name"], a["url"]) for a in json.load(sys.stdin)["assets"]]' \
    | while read -r name asset_url; do
        echo "[setup] fetching $name"
        curl -fSL --retry 5 --retry-all-errors -H "Authorization: Bearer $GH_TOKEN" \
          -H "Accept: application/octet-stream" -o "$out_dir/$name" "$asset_url"
      done
}
download_release_assets "$WORK"

sha256sum bf1942_lnxded.static BF1942.exe
# expected:
#   496672374c27c62490bdc7ad93ae225a2195d1de0a4a3516e07060dccc447cf2  bf1942_lnxded.static
#   05929c957777b9af5bde2cf266b6fcd303c819f7e9bf7b4359a2e5620f19b4b0  BF1942.exe

# --- 5. Pre-analyzed projects ---------------------------------------------------
# bf1942-client.rep: BF1942.exe imported, analyzed, and the label/type/enhance
#   scripts already applied (known globals, function names, structs).
# linux-server.rep: bf1942_lnxded.static analyzed with full DWARF (named
#   functions, structs, types).
for proj in bf1942-client linux-server; do
  if [ -d "$PROJECTS_DIR/$proj.rep" ]; then
    echo "[setup] $proj.rep already present"
  else
    echo "[setup] restoring $proj.rep"
    unzip -q -o "$WORK/$proj.rep.zip" -d "$PROJECTS_DIR"
  fi
done

# --- 6. Summary -----------------------------------------------------------------
cat <<EOF

[setup] ready. Everything is pre-analyzed; query it with pyghidra scripts:
  client:  $PROJECTS_DIR/bf1942-client.rep   (program /BF1942.exe)
  server:  $PROJECTS_DIR/linux-server.rep    (program /bf1942_lnxded.static)

  pyghidra-style queries go through the shipped helper (opens the project
  program by name; never re-imports):
    python3 "$SCRIPT_DIR/apply_labels.py" "$PROJECTS_DIR" linux-server bf1942_lnxded.static my_query.py

Write ad-hoc queries as Ghidra scripts (currentProgram, getFunctionManager(),
DecompInterface, ...), print with println(), read results from stdout.
EOF
