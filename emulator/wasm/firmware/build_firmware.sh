#!/usr/bin/env bash
# Builds the unmodified Kastle 2 firmware (Base + Hardware + app) for the browser with Emscripten.
#   ./build_firmware.sh masterblaster|beads|examplesynth|wavebard|template
# The pico-sdk is replaced by the shims in ../hal. Requires emcc (brew install emscripten).
set -euo pipefail

APP="${1:?usage: build_firmware.sh masterblaster|beads|examplesynth|wavebard|template}"
APP_DEFS=()
MEMORY=${FW_INITIAL_MEMORY:-16777216}
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../../.."
SRC="$REPO/code/src"
HAL="$HERE/../hal"
OUT_DIR="$HERE/../../src/firmware"
BUILD="$HERE/../../.build/$APP"
mkdir -p "$OUT_DIR" "$BUILD/overlay/common"

case "$APP" in
  masterblaster) APP_SOURCES=("$SRC/apps/MasterBlaster/AppMasterBlaster.cpp" "$SRC/apps/MasterBlaster/MasterBlasterDsp.cpp"); APP_INC=("-I$SRC/apps/MasterBlaster") ;;
  beads)         APP_SOURCES=("$SRC/apps/Beads/AppBeads.cpp" "$SRC/apps/Beads/BeadsDsp.cpp"); APP_INC=("-I$SRC/apps/Beads") ;;
  template)      APP_SOURCES=("$SRC/apps/Template/AppTemplate.cpp"); APP_INC=("-I$SRC/apps/Template") ;;
  examplesynth)  APP_SOURCES=("$SRC/apps/ExampleSynth/AppExampleSynth.cpp"); APP_INC=("-I$SRC/apps/ExampleSynth") ;;
  wavebard)      APP_SOURCES=("$SRC/apps/WaveBard/AppWaveBard.cpp"); APP_INC=("-I$SRC/apps/WaveBard"); APP_DEFS=("-DFW_USER_DATA_BYTES=8388608"); MEMORY=${FW_INITIAL_MEMORY:-33554432} ;;
  *) echo "unknown app $APP" >&2; exit 1 ;;
esac

# config.hpp points at the flash address of the user data (samples); the emulator keeps it in linear memory instead.
sed -e 's|^#define USER_DATA_SECTION_BEGIN .*|extern "C" size_t emu_user_data_base(void);\n#define USER_DATA_SECTION_BEGIN (emu_user_data_base())|' \
    -e 's|^#define USER_DATA_SECTION __attribute__.*|#define USER_DATA_SECTION|' \
    "$SRC/common/config.hpp" > "$BUILD/overlay/common/config.hpp"

COMMON=(
  core/Base.cpp core/Kastle2.cpp core/clocks/InternalClockSource.cpp core/clocks/ExternalClockSource.cpp
  core/clocks/MidiClockSource.cpp core/midi/Handler.cpp core/midi/Message.cpp core/Clock.cpp core/Hardware.cpp
  core/LfoMod.cpp core/Memory.cpp controls/FancyPot.cpp controls/FancyMode.cpp debug/UsbSerial.cpp
  peripherals/NAU88C22.cpp peripherals/AT24C.cpp peripherals/WS2812.cpp testmode/TestMode.cpp
  testmode/TestEntry.cpp testmode/version_samples.cpp dsp/synthesis/Oscillator.cpp dsp/synthesis/OscillatorQ15.cpp
  dsp/synthesis/MultiOscillator.cpp dsp/synthesis/Fm2.cpp dsp/control/AdsrEnv.cpp dsp/control/Lfo.cpp
  dsp/control/EnvelopeFollower.cpp dsp/filters/Svf.cpp dsp/filters/SvfStereo.cpp dsp/filters/DjFilter.cpp
  dsp/filters/DjFilterStereo.cpp dsp/math/Fft.cpp dsp/utility/Quantizer.cpp dsp/utility/SignalCorrelator.cpp
  dsp/utility/Sequencer.cpp dsp/utility/Portamento.cpp dsp/utility/KastleRungler.cpp dsp/effects/HardClipper.cpp
  dsp/effects/SoftClipper.cpp dsp/effects/StereoDelay.cpp dsp/effects/CorrectingTrackAndHold.cpp
  dsp/control/BeatDetector.cpp
)
SOURCES=()
for f in "${COMMON[@]}"; do SOURCES+=("$SRC/common/$f"); done

em++ -std=c++23 -O3 ${FW_EXTRA_FLAGS:-} -fwasm-exceptions -fno-rtti \
  ${APP_DEFS[@]+"${APP_DEFS[@]}"} -DUSB_PRODUCT_NAME='"Kastle 2 Emulator"' -DPICO_SDK_VERSION_MAJOR=2 \
  -Wno-deprecated-declarations -Wno-c++11-narrowing -Wno-unknown-attributes \
  -include "$HAL/prelude.h" -I"$BUILD/overlay" -I"$HAL" -I"$SRC" -I"$SRC/common" "${APP_INC[@]}" \
  "${SOURCES[@]}" "${APP_SOURCES[@]}" \
  "$HAL/hal.cpp" "$HERE/fw_runtime.cpp" "$HERE/glue_$APP.cpp" \
  -sSTANDALONE_WASM=1 -sERROR_ON_UNDEFINED_SYMBOLS=1 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=$MEMORY \
  -sSTACK_SIZE=${FW_STACK:-262144} --no-entry \
  -o "$OUT_DIR/$APP.wasm"
ls -l "$OUT_DIR/$APP.wasm"
