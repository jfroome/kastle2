# Beads (app ID 0x32)

A granular texture processor for the **Citadel** (eurorack Kastle 2), modelled on Mutable Instruments **Beads**: record the input into a buffer, scatter it back as a cloud of grains, or run it as a two-tap delay, then feed it back and add reverb.

Source: [code/src/apps/Beads](code/src/apps/Beads). Host tests: [code/tests/beads_tests.cpp](code/tests/beads_tests.cpp). Browser test bench: [emulator/](emulator/README.md).

## Read this first: what this is and isn't

This is **not** Mutable Instruments' code running on the Citadel. The original Beads needs an FPU, about 830 KB of RAM for its buffers and 32 float grains with Hermite interpolation. Compiled for the RP2040 (no FPU, 240 KB RAM) and run through the cycle model, it needs 1.8-2.7x one core's audio budget and 877 KB of RAM, so it cannot work as is. This firmware is a from-scratch **fixed-point re-implementation** of the signal flow and the parameter laws. No code was copied.

Credit: Beads is by Emilie Gillet / Mutable Instruments, MIT licensed ([pichenettes/eurorack](https://github.com/pichenettes/eurorack/tree/master/beads)). This app is a tribute to it, not an official port, and it will not sound identical.

### Differences from the module

| Beads | This firmware |
|---|---|
| Synth mode (internal oscillator grains) | Not implemented |
| Clock-synced multitap delay, tap tempo | Not implemented. Delay mode is a simple two-tap delay |
| Wow / flutter, mono mode | Not implemented |
| Seed-gate divider mode | Not implemented |
| 32 grains, Hermite interpolation | 10 grains (16 at 22 kHz), linear interpolation |
| 3 s of 32-bit float stereo | 128 KB buffer. Length depends on the quality setting (see below) |
| Patch detection by noise injection | A CV jack counts as patched for 4 s after it has moved more than about 100 mV |
| Float reverb, 64 KB | Integer reverb, 20 KB, run at 22 kHz |
| Settings saved | Not saved across power cycles |

### Quality settings (the original's four "media")

| Zone of SHIFT + K2 | Name | Storage | Rate | Buffer |
|---|---|---|---|---|
| 1 (CCW) | Dirty tape | 8-bit mu-law | 22 kHz | 3.0 s |
| 2 | Clean tape | 16-bit | 22 kHz | 1.5 s |
| 3 | Vintage digital | 8-bit mu-law | 44 kHz | 1.5 s |
| 4 (CW) | Digital | 16-bit | 44 kHz | 0.74 s |

## Panel map

The Citadel has seven knobs, and SHIFT and MODE select two extra layers of them. Under each layer the knob keeps its own value and picks it up again when you move it.

### NORMAL layer

| Knob | Function | Notes |
|---|---|---|
| K1 | **Time** | Where in the buffer grains start. In delay mode and when frozen, the position of the loop slice |
| K2 | **Size** | Grain length. Below 1/3 grains play reversed. Fully clockwise switches to delay mode |
| K3 | **Shape** | Grain envelope: square, decay, bell, reverse |
| K4 (big centre knob) | **Density** | Below the centre: regular grains. Centre (about 48-52 %): no grains by itself, only seed events. Above: random grains |
| K5 | **Pitch** | +-24 semitones, with detents at 0, 1, 3, 4, 7, 12 and 24 |
| K6 | **Blend** | Dry/wet |
| K7 | **Reverb** | Reverb amount (and time) |

### SHIFT layer (hold SHIFT)

| Knob | Function |
|---|---|
| K2 | **Quality**: four zones, see the table above |
| K6 | **Feedback** |
| K1, K3, K5, K7 | Platform controls (input gain, rhythm, output gain, tempo). Not used by Beads |

### MODE layer (hold MODE)

| Knob | Function |
|---|---|
| K1 / K2 / K3 | **Time / Size / Shape attenuverters**. Scale the CV if one is patched, otherwise set how much random variation each grain gets |
| K4 | **Seed mode**: below 50 % free-running grains, above 50 % grains only on seed events |
| K5 | **Pitch attenuverter** |
| K6 | **Assign destination** for the PITCH 2 jack: feedback, blend or reverb (three zones) |
| K7 | Platform control. Not used |

### Buttons

| Gesture | Action |
|---|---|
| Tap MODE (no knob moved) | **Freeze** the buffer on or off |
| Tap SHIFT (no knob moved) | **Seed pulse** (60 ms). One grain in seeded mode |
| Hold either button and move a knob | Reach that layer's functions. A button used this way does not also fire its tap action |

### Jacks

| Jack | Function |
|---|---|
| AUDIO L IN / R IN | Audio in |
| AUDIO L OUT / R OUT | Audio out |
| PARAM 1 | Time CV, +-5 V |
| PARAM 2 | Size CV, +-5 V |
| PARAM 3 | Shape CV, +-5 V |
| MODE jack | Density CV, +-5 V. Moves the knob and also frequency-modulates the grain rate |
| PITCH 1 | Pitch CV, 1 V/oct |
| PITCH 2 | Assignable CV (feedback, blend or reverb, see MODE + K6) |
| TRIG | Seed gate |
| RESET | Freeze gate (high = frozen) |

### LEDs

| LED | Meaning |
|---|---|
| LED 1 | Input level (from the platform) |
| LED 2 | Freeze (blue) |
| LED 3 | Flashes once per grain or tap, coloured by the quality setting: orange dirty tape, yellow clean tape, cyan vintage digital, violet digital |

## Parameter laws

- **Density**: below 0.48 regular grains at 130.8 Hz x 2^(-16 d). Above 0.52 random (exponential-interval) grains at 65 Hz x 2^(-16 (1-d)).
- **Size**: grain duration 4 s x 2^(-9 s) for shortness s. Delay mode has hysteresis and a fade.
- **Pitch attenuverter**: (2 / 0.47) x x x max(|x| - 0.03, 0).
- **Grain level**: 1 / sqrt(active grains + 1). Stolen grains fade out in 5 ms.
- **Feedback**: goes through a DC blocker and a low-pass, with a soft clip on the 8-bit and clean-tape settings. An output limiter keeps the sum from clipping.
- **Blend gains**: dry (1-d)(1+d) x 0.75, wet d(2-d) x 1.5. Reverb mix r^2 x 0.9, time r^3.

## CPU

Measured with the instruction-level Cortex-M0+ model in [emulator/cpu](emulator/cpu), on one core, as a share of the 192,000 cycles available per 48-sample block at 176 MHz:

| Scenario | Share |
|---|---|
| Idle (density at centre) | 46 % |
| Dense 130 Hz grains (worst case) | 64 % |
| Random cloud | 64 % |
| Delay mode | 42 % |
| Dirty tape grains | 41 % |
| Vintage digital grains | 50 % |

These are estimates. The model does not include flash cache misses, bus contention between the cores or the SDK's hardware divider. Nothing here has been measured on a real module.

## Verification status

- Verified: 17 host tests (including under ASan/UBSan), the browser bench's real-firmware tests (boot, determinism, streaming equals offline, layers, density, freeze, seed, feedback stability, CV), a clean RP2040 build (FLASH 54 %, RAM 72 %).
- Not verified: how it sounds next to a real Beads, and behaviour on a real Citadel (including CPU load on dense clouds and the analogue level at your jacks). Please listen and report back.

## Build and flash

```sh
cd emulator && npm run uf2 -- beads     # builds the RP2040 firmware and publishes public/firmware/kastle2-beads.uf2
```

Or use the test bench's **Deliver to Citadel** button (select Beads first), which carries the same steps and a ready-built file. See [TOOLCHAIN_INSTALL.md](TOOLCHAIN_INSTALL.md) for the toolchain.
