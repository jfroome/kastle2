#!/usr/bin/env bash
# Builds the real MasterBlaster firmware for the RP2040 and publishes the .uf2 for the web page's "Deliver to Citadel" panel.
# Needs the Arm GNU toolchain (arm-none-eabi-gcc), cmake and the Raspberry Pi pico-sdk (PICO_SDK_PATH). See ../TOOLCHAIN_INSTALL.md
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
BUILD="${K2_BUILD_DIR:-/tmp/kastle2-uf2-build}"
mkdir -p "$BUILD"
cd "$BUILD"
CC="${ARM_CC:-$(command -v arm-none-eabi-gcc)}"
CXX="${ARM_CXX:-$(command -v arm-none-eabi-g++)}"
cmake -DCMAKE_BUILD_TYPE=Debug -DCMAKE_C_COMPILER="$CC" -DCMAKE_CXX_COMPILER="$CXX" "$REPO/code"
make -j8 master-blaster
mkdir -p "$HERE/../public/firmware"
cp "$BUILD/output/kastle2-master-blaster.uf2" "$HERE/../public/firmware/"
node "$HERE/write-firmware-manifest.mjs"
