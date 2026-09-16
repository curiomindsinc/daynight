#!/bin/sh
# Build daynight.html: a single standalone file for CDN deploy.
# Same code as index.html, but textures load from this repo on jsDelivr,
# pinned to a commit SHA (branch URLs can be cached by jsDelivr for days).
#
#   ./build.sh            pin to HEAD (must already be pushed)
#   ./build.sh <sha>      pin to a specific commit
set -e
cd "$(dirname "$0")"
REPO="curiomindsinc/daynight"
SHA="${1:-$(git rev-parse HEAD)}"
BASE="https://cdn.jsdelivr.net/gh/$REPO@$SHA/assets/"

grep -q "^const ASSET_BASE = 'assets/';$" index.html || { echo "ASSET_BASE line not found in index.html" >&2; exit 1; }
sed "s|^const ASSET_BASE = 'assets/';$|const ASSET_BASE = '$BASE';|" index.html > daynight.html
echo "daynight.html built: $(wc -c < daynight.html) bytes, assets from $BASE"
