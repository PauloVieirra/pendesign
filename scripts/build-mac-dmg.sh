#!/usr/bin/env bash
# Build the Mac DMG installer using the `release-stable` namespace so it
# attaches to the existing project silo at
# ~/Library/Application Support/Vision Design/namespaces/release-stable/data/.
#
# Without the namespace flag, `tools-pack` defaults to `default`, which is a
# DIFFERENT silo with its own SQLite + project folders — so old projects
# disappear from the UI (they're still safe on disk, just invisible to a
# default-namespace app). See AGENTS.md FAQ "Where is data written?" for the
# storage model.
#
# Usage:
#   ./scripts/build-mac-dmg.sh             # build + copy to ~/Desktop + open Finder
#   ./scripts/build-mac-dmg.sh --no-open   # skip opening Finder
#   ./scripts/build-mac-dmg.sh --signed    # signed/notarized (needs Apple cert)

set -euo pipefail

OPEN_FINDER=1
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_FINDER=0 ;;
    *) EXTRA_ARGS+=("$arg") ;;
  esac
done

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NAMESPACE=release-stable
DEST="$HOME/Desktop/Vision-Design.dmg"

cd "$REPO_ROOT"

echo "→ Building DMG (namespace: $NAMESPACE, portable: yes, unsigned unless --signed)…"
pnpm tools-pack mac build \
  --to dmg \
  --portable \
  --namespace "$NAMESPACE" \
  "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"

SRC="$REPO_ROOT/.tmp/tools-pack/out/mac/namespaces/$NAMESPACE/dmg/Vision Design-$NAMESPACE.dmg"
if [[ ! -f "$SRC" ]]; then
  echo "✗ DMG not found at: $SRC" >&2
  exit 1
fi

echo "→ Copying to $DEST"
cp "$SRC" "$DEST"

SIZE=$(du -h "$DEST" | cut -f1)
echo "✓ Done. $DEST ($SIZE)"

if [[ "$OPEN_FINDER" -eq 1 ]]; then
  open -R "$DEST"
fi
