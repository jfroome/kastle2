# MasterBlaster Test Bench (Citadel firmware emulator)

A browser test bench for the Bastl Citadel **MasterBlaster** firmware. It runs the *unmodified* firmware (Base platform, Hardware layer, Memory, MIDI and the app) compiled to WebAssembly on an emulated RP2040 board, behind a virtual Citadel panel. Load any audio file, turn the knobs, patch CV, listen, render, measure, and when you're happy flash the matching `.uf2` onto a real unit from the same page.

## Quick start

```sh
cd emulator
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests + the firmware bench suite, headless in Node
npm run build      # type-check + production bundle in dist/
```

Everything needed is committed (`src/firmware/*.wasm`, `public/firmware/kastle2-master-blaster.uf2`). Toolchains are only needed to rebuild:

| What | Command | Needs |
|---|---|---|
| Firmware host (wasm) | `npm run wasm:firmware` | `brew install emscripten` |
| Standalone DSP (wasm, bench only) | `npm run wasm:dsp` | `brew install llvm lld` |
| Real RP2040 `.uf2` for the page's Deliver button | `npm run uf2` | Arm GNU toolchain, cmake, pico-sdk (`TOOLCHAIN_INSTALL.md`) |
| ARM cycle estimate | `cpu/build_arm.sh masterblaster && python3 cpu/profile.py masterblaster` | Arm GNU toolchain, `pip install unicorn capstone pyelftools` |

## The page

- **Faceplate in the real Citadel layout**: jack bank on top (CLK / PATTERN / LFO / AUDIO and the bottom row), K1–K3 down the left, the big K4 in the centre, K5–K7 down the right, SHIFT and MODE buttons with the three firmware LEDs between them. Under each knob label are the functions of the other layers. Drag, wheel, arrow keys; double-click resets; hold keyboard `Shift` for the SHIFT button (Alt = fine), `B` taps MODE (bypass), `Space` plays. Jacks the app uses light up and can be patched; hold TRIG for a gate.
- **Audio**: load WAV (any bit depth/rate), AIFF/AIFF-C, MP3/FLAC/OGG, drag a file onto the top bar, built-in test signals, or "live in". It plays through the firmware on the audio thread in 48-sample blocks like the module.
- **Real firmware behaviour**: the UI only moves pots, buttons and voltages. Layers, pot freezing/pick-up, the MODE bypass tap, CV scaling, LED colours, gain staging and the start-up fade all come from the firmware's own code. "Direct knobs" (default) parks the pots on each layer's values on layer changes so a drag takes over without a jump; switch it off for the module's real freeze behaviour.
- **Codec & gain staging**: the firmware programs the NAU88C22 registers; the page shows the resulting PGA / ADC / DAC / headphone gains and applies them. Input/output trims are calibrated so factory gain knobs (EEPROM default 160) pass a full-scale file at unity. Optional datasheet converter noise (ADC 89 dB, DAC ~98 dB SNR) and about -78 dB THD. The analogue DC offsets the firmware removes are modelled.
- **Render & export**: cold-boots the firmware in the background, replays your knob positions as panel gestures, renders the whole file faster than real time (CV automation included), shows before/after LUFS, peak, RMS, crest, correlation, DC, clipping, overlays the waveform and exports 16/24/32f WAV.
- **Bench & sweeps**: 19 tests that boot the real firmware (and test the DSP on its own): boot, determinism, real-time == offline, layers and pick-up, base gains untouched by presets, CV front end, MODE-tap bypass, CV drive, limiter, compressor, lo-fi, wow, width, fuzz and more; plus one-knob sweep charts.
- **CPU headroom (estimate)**: cycles per 48-sample block of the real `-O3` ARM build, from an instruction-level Cortex-M0+ model. About 27 % of the 192,000-cycle budget in the worst case measured. It does not model flash/XIP cache misses, bus contention between the cores, or the SDK's hardware divider and bootrom float routines.
- **Deliver to Citadel**: the top-bar button opens step-by-step instructions (bootloader via SHIFT at power-up, per `TOOLCHAIN_INSTALL.md`) with a download of `kastle2-master-blaster.uf2` and, in Chrome/Edge, a button that writes it straight onto the RPI-RP2 drive (it refuses any drive without `INFO_UF2.TXT`).

## Architecture

```
wasm/hal/            Stand-ins for the pico-sdk (gpio, adc + mux, pwm, i2c codec + EEPROM, time, tusb, PIO LEDs, a cooperative 2nd core)
wasm/firmware/       C API (fw_*) around the firmware; per-app glue = the app's main.cpp; build_firmware.sh (emcc), build_native.sh (ASan debug)
cpu/                 ARM build + Unicorn cycle profiler  ->  src/cpu/profile.json
src/firmware/        FirmwareBoard (panel inputs, codec/analog model, block runner), panel gestures, loaders
src/engine/          AudioWorklet hosting the firmware, AudioContext @ 44 kHz, transport, analysers
src/core/emulator.ts Panel state, presets, offline render, bench glue
src/apps/            Labels, ranges, presets and recipes per app (behaviour comes from the firmware)
src/bench/           Test suite and sweeps (browser and Node)
src/ui/              React components
```

Other firmwares built the same way (Wave Bard, Example Synth, Template) are in the registry and covered by the Node tests but hidden in the UI: set `hidden: false` in `src/apps/registry.ts` to expose them (Wave Bard needs its `SAMPLES.bin`; `npm run assets` copies it).

## Fidelity and limits

- Integer maths, block size, sample rate and all control logic are the firmware's own. The audio path around the firmware is a model: codec gains from the registers the firmware writes, trims for the unknown jack levels, optional converter noise.
- CPU numbers are estimates (see above). Not a substitute for measuring on the unit.
- The second core is emulated cooperatively; the browser runs everything on one thread.
- Streaming adds one 48-sample block of latency; offline renders are latency-compensated.
- Not verified on hardware: flash it, listen, and compare with the bench graphs.

## Findings the bench surfaced for MasterBlaster

- With default knobs the chain is about **10 dB louder** than the input, which makes bypass A/B misleading (reported as a warning).
- The saturator bias leaves a **start-up transient of about -52 dBFS** until the DC blocker settles.
