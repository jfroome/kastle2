# MasterBlaster

A single, fixed **stereo mastering chain** for the Bastl Citadel (and Kastle 2): tape/vinyl-style saturation, tilt tone, glue bus compressor, vinyl character, lo-fi crunch, stereo width, dry/wet and a safety limiter.
There are no modes. Every knob is always part of the same signal path (inspired by SP-404 vinyl sim, OTO Boum and SSL bus compression).

App ID: `0x31`. Firmware: `kastle2-master-blaster.uf2`. Host DSP tests: `code/tests/master_blaster_tests.cpp`.

## Signal flow

```
 IN L/R ─► INPUT GAIN ─► SATURATE ─► TONE ─► BUS COMP ─► VINYL ─► LO-FI ─► WIDTH ─► MIX ─► OUTPUT ─► LIMITER ─► OUT L/R
          (Base,         K1         K2       K3 (+K2     K4 (+K4   K5       SHIFT   K6      K7         fixed       │
           SHIFT+K1)     drive      tilt     SHIFT:      SHIFT:    bits &   +K6     │       trim         ceiling     │
                                              speed)      wow)      rate     │      │                                │
                                                                              └──────┴─ dry path (delayed 96 samples to match wow stage)
 BYPASS (MODE short press): click-free crossfade to the latency-matched dry signal
```

| Stage | What it does |
|---|---|
| Saturate | 1x–8x input drive into a soft cubic shaper (reaches full saturation at mid knob), slight asymmetry for even harmonics, level compensation, DC blocker |
| Tone | Tilt EQ pivoting at about 700 Hz. Centre = flat, left = darker, right = brighter |
| Bus comp | Stereo-linked peak detector, fixed 4:1 ratio, knob lowers the threshold, automatic makeup gain, attack/release scaled by the speed control |
| Vinyl | Wow/flutter/drift pitch wobble (modulated delay), high-frequency rolloff, hiss and crackle |
| Lo-fi | Sample-rate reduction (down to about 1/8) and bit reduction (down to 8 bit) |
| Width | Mid/side. 0 = mono, centre = unchanged, max = 2x side |
| Mix | Parallel dry/wet. The dry path is delay-matched so it never phases against the wet path |
| Output | Output trim (unity at about 70%), then a peak limiter at about -0.5 dBFS |

## Knob map

All parameters are available from the three pot layers. Pots keep their last value when you switch layer; a pot only takes over again after you move it.

```
 NORMAL layer (no button)
 ┌────────┬────────┬────────┬────────┬────────┬────────┬────────┐
 │  K1    │  K2    │  K3    │  K4    │  K5    │  K6    │  K7    │
 │ DRIVE  │ TONE   │ COMP   │ VINYL  │ LO-FI  │ MIX    │ OUTPUT │
 │ 1x-8x  │ dark → │ none → │ clean →│ clean →│ dry →  │ trim   │
 │ sat    │ bright │ squash │ worn   │ crushed│ wet    │        │
 └────────┴────────┴────────┴────────┴────────┴────────┴────────┘

 SHIFT held
 ┌────────┬────────┬────────┬────────┬────────┬────────┬────────┐
 │  K1    │  K2    │  K3    │  K4    │  K5    │  K6    │  K7    │
 │ (Base) │ COMP   │ (Base) │ WOW    │ (Base) │ WIDTH  │ (Base) │
 │ input  │ SPEED  │        │ pitch  │ output │ mono → │        │
 │ gain   │ slow → │        │ wobble │ gain   │ wide   │        │
 │        │ fast   │        │        │        │        │        │
 └────────┴────────┴────────┴────────┴────────┴────────┴────────┘
   K1/K3/K5/K7 on SHIFT belong to the base platform (input gain, rhythm, output gain, tempo) and are not used here.

 MODE held: pots belong to the base platform (settings). Moving one of them cancels the bypass toggle on release.
 MODE tap : bypass on/off
```

### Jacks (Citadel)

CV inputs are bipolar and **additive**: 0 V (or nothing patched) leaves the knob untouched, +5 V adds a full knob range, negative voltage subtracts. Results are clamped.

| Jack | Controls |
|---|---|
| PARAM 1 CV | Drive |
| PARAM 2 CV | Comp amount |
| PARAM 3 CV | Lo-fi |
| Audio in L/R | Stereo input (a mono cable on L is fine, enable mono mode in the base settings if needed) |
| Audio out L/R | Stereo output |

> The CV roles use the base platform's PARAM 1–3 inputs. Check your module's panel labelling for the matching jacks.

### LEDs

| LED | Shows |
|---|---|
| LED 1 | Input level (base platform) |
| LED 2 | Compressor gain reduction (brighter = more reduction) |
| LED 3 | Limiter activity (red) over mix level, grey when bypassed (LED 2 also grey) |

## Quick recipes

| Goal | Settings |
|---|---|
| Transparent glue | Drive 20%, Tone centre, Comp 30%, SHIFT Comp speed 60%, rest 0, Mix 100% |
| SSL-style squeeze | Drive 30%, Comp 60-70%, speed fast, Mix 60% for parallel compression |
| SP-404 vinyl sim | Drive 40%, Tone slightly dark, Vinyl 50%, Wow 30%, Lo-fi 15% |
| OTO Boum style crush | Drive 70%, Comp 80%, Lo-fi 50%, Output down to compensate, Mix 70% |
| Mono-safe low end | SHIFT Width down to 0 |

## Notes and limits

- Fixed latency: 96 samples (about 2.2 ms), the dry and bypass paths are matched.
- Integer DSP only (the RP2040 has no FPU). Stereo processing runs well within the audio budget; exact load has not been measured on hardware.
- Settings are **not** saved across power cycles yet; the module starts with the defaults (mild drive, flat tone, mix 100%, output about unity).
- Knob ranges and time constants were tuned by calculation and host simulation. Expect to fine tune by ear on hardware.

## Development

```
cmake -S code/tests -B /tmp/mbt && cmake --build /tmp/mbt && ctest --test-dir /tmp/mbt
```

The tests compile the real `MasterBlasterDsp.cpp` and check bounds (fuzzed parameters), silence, transparency at neutral settings, saturation, compression, lo-fi quantisation, wow, vinyl filtering, width, limiter, click-free bypass, parameter sweeps and the CV/pot mappings.

### Browser emulator

`emulator/` is a web test bench that runs the real MasterBlaster firmware (Base + app) as WebAssembly behind a Citadel-layout virtual panel. Load a WAV/AIFF/MP3, play it through the chain in real time, render and export it, run the firmware bench suite, see an ARM cycle estimate, and flash the `.uf2` to a Citadel from the page. See [emulator/README.md](emulator/README.md).

```
cd emulator && npm install && npm run dev
```
