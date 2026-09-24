#!/usr/bin/env bash
# Bootstrap a Claude Code cloud session for BF1942 reverse engineering with Ghidra.
# Idempotent: safe to re-run; re-runs skip work already done.
#
# Installs: JDK 21 (if missing), Ghidra 12.1.2 (headless zip), PyGhidra 3.1.0 (pip)
# Downloads: bf1942_lnxded.static + BF1942.exe from the bf1942-binaries GitHub release
# Restores: pre-analyzed Ghidra projects (client exe fully labeled, server demangled)
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
# Direct asset URLs, not the api.github.com listing: the anonymous API is
# rate-limited to 60 req/h per IP and cloud datacenter IPs share it (403s).
# github.com download URLs are unauthenticated and rate-limit-free.
base="https://github.com/$REPO/releases/download/$RELEASE_TAG"
for name in bf1942_lnxded.static BF1942.exe bf1942-client.rep.zip linux-server.rep.zip; do
  echo "[setup] fetching $name"
  curl -fSL --retry 5 --retry-all-errors -o "$name" "$base/$name"
done

sha256sum bf1942_lnxded.static BF1942.exe
# expected:
#   496672374c27c62490bdc7ad93ae225a2195d1de0a4a3516e07060dccc447cf2  bf1942_lnxded.static
#   05929c957777b9af5bde2cf266b6fcd303c819f7e9bf7b4359a2e5620f19b4b0  BF1942.exe

# --- 5. Pre-analyzed projects ---------------------------------------------------
# bf1942-client.rep: BF1942.exe imported, analyzed, and the label/type/enhance
#   scripts already applied (known globals, function names, structs).
# linux-server.rep: bf1942_lnxded.static analyzed; its unstripped symbols are
#   demangled into named engine classes/functions (DWARF covers only the GCC
#   runtime, not the engine).
for proj in bf1942-client linux-server; do
  if [ -d "$PROJECTS_DIR/$proj.rep" ]; then
    echo "[setup] $proj.rep already present"
  else
    echo "[setup] restoring $proj.rep"
    unzip -q -o "$WORK/$proj.rep.zip" -d "$PROJECTS_DIR"
  fi
  # The zips record whoever built them as OWNER, and Ghidra refuses to open a
  # project owned by another user (NotOwnerException) -- cloud sessions run as
  # root. Re-own to the current user; runs every time so restores made by an
  # earlier copy of this script get fixed too.
  sed -i -E "s/(NAME=\"OWNER\" TYPE=\"string\" VALUE=\")[^\"]*/\1$(id -un)/" \
    "$PROJECTS_DIR/$proj.rep/project.prp"
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
