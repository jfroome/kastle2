#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
for app in masterblaster beads examplesynth wavebard template; do
  echo "== $app"
  "$HERE/build_firmware.sh" "$app"
done
