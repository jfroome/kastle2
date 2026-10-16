#!/usr/bin/env bash
# Builds the real RP2040 firmware for an app and publishes the .uf2 for the web page's "Deliver to Citadel" panel.
# Usage: build-uf2.sh [master-blaster|beads|all]   (default: all)
# Needs the Arm GNU toolchain (arm-none-eabi-gcc), cmake and the Raspberry Pi pico-sdk (PICO_SDK_PATH). See ../TOOLCHAIN_INSTALL.md
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
BUILD="${K2_BUILD_DIR:-/tmp/kastle2-uf2-build}"
TARGET="${1:-all}"
case "$TARGET" in
  all) TARGETS="master-blaster beads" ;;
  master-blaster | beads) TARGETS="$TARGET" ;;
  *) echo "unknown target '$TARGET' (master-blaster, beads or all)" >&2; exit 1 ;;
esac
mkdir -p "$BUILD"
cd "$BUILD"
CC="${ARM_CC:-$(command -v arm-none-eabi-gcc)}"
CXX="${ARM_CXX:-$(command -v arm-none-eabi-g++)}"
cmake -DCMAKE_BUILD_TYPE=Debug -DCMAKE_C_COMPILER="$CC" -DCMAKE_CXX_COMPILER="$CXX" "$REPO/code"
mkdir -p "$HERE/../public/firmware"
for t in $TARGETS; do
  make -j8 "$t"
  cp "$BUILD/output/kastle2-$t.uf2" "$HERE/../public/firmware/"
  node "$HERE/write-firmware-manifest.mjs" "$t"
done
