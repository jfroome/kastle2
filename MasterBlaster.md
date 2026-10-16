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
| Vinyl | Wow/flutter/drift pitch wobble (modulated delay, three speeds from the right switch), high-frequency rolloff, hiss and crackle (low / high / off from the left switch) |
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

### Panel switches (Citadel)

The two 3-position switches under the big knob (silkscreened RND / INV, labelled CV and GATE on the Wave Bard panel) shape the vinyl stage. They work in every layer and are read continuously, so you can flip them while playing.

| Switch | Up | Middle | Down |
|---|---|---|---|
| **Left (CV)**: vinyl noise | Low-pitched: dark, rumbly hiss and soft thumps | High-pitched: bright hiss and sharp ticks | **Off**: no hiss and no crackle |
| **Right (GATE)**: wow speed | Slow, about 0.24 Hz | Medium, about 0.6 Hz | Fast, about 1.3 Hz (a 78 rpm record turns at 1.3 Hz) |

- The **Vinyl knob (K4)** still sets the amount of noise, crackle and treble rolloff. With the noise switch down only the hiss and crackle go away; the rolloff stays.
- **SHIFT + K4** still sets the wow depth. The speed switch changes only the rate. At the fast setting the depth is backed off a little (and raised a little at slow) so all three speeds detune by a similar amount.
- With both switches in the middle the module behaves as it did before the switches were added (the high-pitched noise is a touch brighter and about 2 dB quieter than the old plain hiss).
- A switch position only takes effect after it has been stable for 40 ms. The switches sit on the same tri-state inputs as the C IN and G IN jacks, so a cable patched into one of those jacks will most likely override its switch (not tested on hardware). Keep them unpatched while you use the switches.
- Noise and speed changes are smoothed (no clicks).

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
| SP-404 vinyl sim | Drive 40%, Tone slightly dark, Vinyl 50%, Wow 30%, Lo-fi 15%, both switches in the middle |
| Dusty, slow warp | Vinyl 60%, Wow 40%, noise switch up (low-pitched), wow switch up (slow) |
| Clean but warped | Vinyl 20%, Wow 50%, noise switch down (off), wow switch to taste |
| OTO Boum style crush | Drive 70%, Comp 80%, Lo-fi 50%, Output down to compensate, Mix 70% |
| Mono-safe low end | SHIFT Width down to 0 |

## Knob jumps glide

When a knob jumps to a new value (you pick it up in the SHIFT or MODE layer, or it is released from frozen), the value glides there over about 250 ms with an ease-in/ease-out curve instead of snapping, so things like lo-fi, drive or output don't produce a harsh transient. Turning a knob normally follows it immediately, with no lag. A move of more than about 5% of the range in one step counts as a jump. CV is added after the glide, so CV modulation is not slowed down. The first 0.6 s after power-up snaps to the knob positions.

## Notes and limits

- Fixed latency: 96 samples (about 2.2 ms), the dry and bypass paths are matched.
- Integer DSP only (the RP2040 has no FPU). Stereo processing runs well within the audio budget; exact load has not been measured on hardware.
- Settings are **not** saved across power cycles yet; the module starts with the defaults (mild drive, flat tone, mix 100%, output about unity).
- Knob ranges and time constants were tuned by calculation and host simulation. Expect to fine tune by ear on hardware.

## Development

```
cmake -S code/tests -B /tmp/mbt && cmake --build /tmp/mbt && ctest --test-dir /tmp/mbt
```

The tests compile the real `MasterBlasterDsp.cpp` and check bounds (fuzzed parameters), silence, transparency at neutral settings, saturation, compression, lo-fi quantisation, knob glides, wow, wow speeds, vinyl filtering, the noise types, the switch mapping and debounce, width, limiter, click-free bypass, parameter sweeps and the CV/pot mappings.

### Browser emulator

`emulator/` is a web test bench that runs the real MasterBlaster firmware (Base + app) as WebAssembly behind a Citadel-layout virtual panel. Load a WAV/AIFF/MP3, play it through the chain in real time, render and export it, run the firmware bench suite, see an ARM cycle estimate, and flash the `.uf2` to a Citadel from the page. See [emulator/README.md](emulator/README.md).

```
cd emulator && npm install && npm run dev
```
