#!/usr/bin/env bash
# Builds the MasterBlaster firmware DSP to WebAssembly (needs clang with the wasm32 target and wasm-ld).
# macOS: brew install llvm lld     Linux: apt install clang lld
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HERE/../../code/src/apps/MasterBlaster"
OUT="$HERE/../src/dsp/masterblaster.wasm"

CLANG="${CLANG:-}"
if [ -z "$CLANG" ]; then
  for candidate in /opt/homebrew/opt/llvm/bin/clang /usr/local/opt/llvm/bin/clang clang; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" --print-targets 2>/dev/null | grep -q wasm32; then
      CLANG="$candidate"
      break
    fi
  done
fi
if [ -z "$CLANG" ]; then
  echo "No clang with wasm32 support found. Install llvm + lld or set CLANG=/path/to/clang." >&2
  exit 1
fi
export PATH="$(dirname "$CLANG"):/opt/homebrew/opt/lld/bin:$PATH"

mkdir -p "$(dirname "$OUT")"
"$CLANG" --target=wasm32 -std=c++17 -O3 -ffreestanding -fno-exceptions -fno-rtti -fno-threadsafe-statics \
  -mbulk-memory -nostdlib -fuse-ld=lld \
  -nostdinc++ -isystem "$HERE/shim" -I"$APP_DIR" \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--strip-all -Wl,-z,stack-size=65536 -Wl,--initial-memory=262144 \
  "$HERE/masterblaster_wasm.cpp" "$APP_DIR/MasterBlasterDsp.cpp" \
  -o "$OUT"
ls -l "$OUT"
