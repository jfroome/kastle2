#!/usr/bin/env bash
# Debug build of the firmware host for the development machine (AddressSanitizer, native exceptions).
# Used to track down crashes with precise stack traces; the shipped build is build_firmware.sh.
set -euo pipefail
APP="${1:?usage: build_native.sh masterblaster|examplesynth|wavebard}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../../code/src"
HAL="$HERE/../hal"
BUILD="$HERE/../../.build/$APP"
OUT="$BUILD/native"
APP_DEFS=()
mkdir -p "$BUILD/overlay/common"
sed -e 's|^#define USER_DATA_SECTION_BEGIN .*|extern "C" size_t emu_user_data_base(void);\n#define USER_DATA_SECTION_BEGIN (emu_user_data_base())|' \
    -e 's|^#define USER_DATA_SECTION __attribute__.*|#define USER_DATA_SECTION|' \
    "$SRC/common/config.hpp" > "$BUILD/overlay/common/config.hpp"
case "$APP" in
  masterblaster) APP_SOURCES=("$SRC/apps/MasterBlaster/AppMasterBlaster.cpp" "$SRC/apps/MasterBlaster/MasterBlasterDsp.cpp"); APP_INC=("-I$SRC/apps/MasterBlaster") ;;
  beads)         APP_SOURCES=("$SRC/apps/Beads/AppBeads.cpp" "$SRC/apps/Beads/BeadsDsp.cpp"); APP_INC=("-I$SRC/apps/Beads") ;;
  template)      APP_SOURCES=("$SRC/apps/Template/AppTemplate.cpp"); APP_INC=("-I$SRC/apps/Template") ;;
  examplesynth)  APP_SOURCES=("$SRC/apps/ExampleSynth/AppExampleSynth.cpp"); APP_INC=("-I$SRC/apps/ExampleSynth") ;;
  wavebard)      APP_SOURCES=("$SRC/apps/WaveBard/AppWaveBard.cpp"); APP_INC=("-I$SRC/apps/WaveBard"); APP_DEFS=("-DFW_USER_DATA_BYTES=8388608") ;;
esac
COMMON=$(sed -n '/^COMMON=(/,/^)/p' "$HERE/build_firmware.sh" | grep -oE '[a-zA-Z0-9_/]+\.cpp')
SOURCES=(); for f in $COMMON; do SOURCES+=("$SRC/common/$f"); done
clang++ -std=c++2b -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer \
  ${APP_DEFS[@]+"${APP_DEFS[@]}"} -include "$HAL/prelude.h" -DUSB_PRODUCT_NAME='"x"' -DPICO_SDK_VERSION_MAJOR=2 -w \
  -I"$BUILD/overlay" -I"$HAL" -I"$SRC" -I"$SRC/common" "${APP_INC[@]}" \
  "${SOURCES[@]}" "${APP_SOURCES[@]}" "$HAL/hal.cpp" "$HERE/fw_runtime.cpp" "$HERE/glue_$APP.cpp" \
  "$HERE/native_main.cpp" -o "$OUT"
echo "$OUT"
