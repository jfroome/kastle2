#!/usr/bin/env bash
# Builds the firmware host (real firmware + HAL stand-in) for Cortex-M0+ with the same optimisation as the real
# firmware (-O3), to be run in the cycle-counting simulator cpu/profile.py.
#   ./build_arm.sh masterblaster|examplesynth|wavebard|template
set -euo pipefail
APP="${1:?usage: build_arm.sh <app>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../code/src"
HAL="$HERE/../wasm/hal"
FW="$HERE/../wasm/firmware"
BUILD="$HERE/../.build/$APP"
OUT="$BUILD/arm.elf"
GCC_DIR="${ARM_GCC_DIR:-}"
for c in "$GCC_DIR" /private/tmp/armx/Payload/bin /tmp/arm-gnu-toolchain/Payload/bin /opt/homebrew/bin ""; do
  if [ -x "${c:+$c/}arm-none-eabi-g++" ] || { [ -z "$c" ] && command -v arm-none-eabi-g++ >/dev/null; }; then GCC_DIR="$c"; break; fi
done
CXX="${GCC_DIR:+$GCC_DIR/}arm-none-eabi-g++"
CC="${GCC_DIR:+$GCC_DIR/}arm-none-eabi-gcc"
mkdir -p "$BUILD/overlay/common"
sed -e 's|^#define USER_DATA_SECTION_BEGIN .*|extern "C" size_t emu_user_data_base(void);\n#define USER_DATA_SECTION_BEGIN (emu_user_data_base())|' \
    -e 's|^#define USER_DATA_SECTION __attribute__.*|#define USER_DATA_SECTION|' \
    "$SRC/common/config.hpp" > "$BUILD/overlay/common/config.hpp"
APP_DEFS=()
case "$APP" in
  masterblaster) APP_SOURCES=("$SRC/apps/MasterBlaster/AppMasterBlaster.cpp" "$SRC/apps/MasterBlaster/MasterBlasterDsp.cpp"); APP_INC=("-I$SRC/apps/MasterBlaster") ;;
  examplesynth)  APP_SOURCES=("$SRC/apps/ExampleSynth/AppExampleSynth.cpp"); APP_INC=("-I$SRC/apps/ExampleSynth") ;;
  wavebard)      APP_SOURCES=("$SRC/apps/WaveBard/AppWaveBard.cpp"); APP_INC=("-I$SRC/apps/WaveBard"); APP_DEFS=("-DFW_USER_DATA_BYTES=8388608") ;;
  template)      APP_SOURCES=("$SRC/apps/Template/AppTemplate.cpp"); APP_INC=("-I$SRC/apps/Template") ;;
  *) echo "unknown app" >&2; exit 1 ;;
esac
COMMON=$(sed -n '/^COMMON=(/,/^)/p' "$FW/build_firmware.sh" | grep -oE '[a-zA-Z0-9_/]+\.cpp')
SOURCES=(); for f in $COMMON; do SOURCES+=("$SRC/common/$f"); done
KEEP=""
for sym in $(grep -oE "^EXPORT [a-z0-9_ ]*\*? ?fw_[a-z_0-9]+" "$FW/fw_runtime.cpp" | grep -oE "fw_[a-z_0-9]+"); do KEEP="$KEEP -Wl,--undefined=$sym"; done
KEEP="$KEEP -Wl,--undefined=emu_core1_begin -Wl,--undefined=emu_core1_end"
"$CC" -c -mcpu=cortex-m0plus -mthumb -O2 "$HERE/arm_support.c" -o "$BUILD/arm_support.o"
"$CXX" -std=c++23 -O3 -mcpu=cortex-m0plus -mthumb -ffunction-sections -fdata-sections -fno-rtti -fexceptions \
  --specs=nano.specs --specs=nosys.specs -w \
  ${APP_DEFS[@]+"${APP_DEFS[@]}"} -DUSB_PRODUCT_NAME='"x"' -DPICO_SDK_VERSION_MAJOR=2 \
  -include "$HAL/prelude.h" -I"$BUILD/overlay" -I"$HAL" -I"$SRC" -I"$SRC/common" "${APP_INC[@]}" \
  "${SOURCES[@]}" "${APP_SOURCES[@]}" "$HAL/hal.cpp" "$FW/fw_runtime.cpp" "$FW/glue_$APP.cpp" "$BUILD/arm_support.o" \
  -nostartfiles -T "$HERE/link.ld" -Wl,--gc-sections $KEEP -o "$OUT"
echo "$OUT"
