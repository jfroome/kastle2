# MasterBlaster

MasterBlaster is a Boum-inspired alternative firmware for the Bastl Kastle 2 and the Citadel.
The goal is not to copy the OTO Machines Boum one-to-one, but to capture the same spirit: warm, saturated, gently broken, mastering-adjacent coloration with a lo-fi finish.

This document acts as the current overview and operating guide for the firmware.

---

## Quick concept

The effect is intended to behave like a hybrid between:
- an analog preamp / tape drive stage
- a warm mastering chain
- a gently corrupted lo-fi / sample-rate reducer
- a lightly unstable wow/flutter section

The signal path is:
1. input trim / drive
2. soft saturation
3. warmth and low-mid glue
4. compression-like gain fusion
5. wow and flutter modulation
6. bit reduction / lo-fi crunch
7. wet/dry mix and output trim

---

## Hardware map: Kastle 2 face

This is the front panel layout for the Kastle 2 desktop version.

```text
                [ LED 1 ]   [ LED 2 ]   [ LED 3 ]

                   MODE        SHIFT

      +----------------------------------------------------------------+
      |  K1  |  K2  |  K3  |  K4  |  K5  |  K6  |  K7  |              |
      | DRIVE| TONE| GLUE| WOW | CRUSH| MIX | OUT |              |
      +----------------------------------------------------------------+

      ^                                                            ^
      |                                                            |
   left button                                                  right button
```

Notes:
- The seven pots are the main performance controls.
- The two buttons are the primary UI controls: `SHIFT` and `MODE`.
- The three LEDs are used to show the active effect mode and state.

---

## Hardware map: Citadel face

The Citadel uses the same logical control order as the Kastle 2, with its larger eurorack-facing layout and CV patch arrangement. The primary knob positions remain the same, and the firmware uses the same logic across both hardware variants.

```text
        [ LED 1 ]      [ LED 2 ]      [ LED 3 ]

                MODE                     SHIFT

      +----------------------------------------------------------------+
      |  K1  |  K2  |  K3  |  K4  |  K5  |  K6  |  K7  |              |
      | DRIVE| TONE| GLUE| WOW | CRUSH| MIX | OUT |              |
      +----------------------------------------------------------------+

      [ CV IN ]   [ GATE ]   [ SYNC ]    [ PATCH BAY / JACKS ]
```

Key point:
- The front-panel knob order is functionally the same as Kastle 2.
- The Citadel differences are mainly around signal routing and ADC scaling, not the MasterBlaster control philosophy.

---

## MasterBlaster knob map

The current firmware uses the following assignment from left to right on the face:

| Knob | Function | Purpose |
|---|---|---|
| K1 | Drive | Input saturation intensity |
| K2 | Warmth / Tone | Low-mid richness and analog color |
| K3 | Glue | Compression / gain fusion |
| K4 | Wow / Flutter | Instability and tape-like wobble |
| K5 | Crush | Bit-depth and lo-fi reduction |
| K6 | Mix | Wet/dry blend |
| K7 | Output | Final level trim |

This is the effective mapping used by the current MasterBlaster app implementation.

---

## Buttons and modes

### MODE button
Cycles the active effect profile:
- WARM
- MASTER
- CRUSH
- BYPASS

### SHIFT button
Shift changes the active control layer. On Kastle 2/Citadel this is a secondary control layer, used for alternate values or settings depending on the firmware.

In MasterBlaster the current implementation is primarily using the normal knob layer, but the base hardware architecture supports Shift + knob access should we want to expose secondary controls later.

---

## LED behavior

The LEDs are used as a visual status indicator for the active mode:
- warm mode = amber / golden
- master mode = cool blue / bright modern mastering tone
- crush mode = magenta / hot lo-fi color
- bypass mode = neutral gray

---

## Shift + knob behavior on Kastle 2 / Citadel

This is the core hardware concept shared by both devices:

- normal knob operation = main app parameters
- Shift + knob = alternate control layer
- the same physical knob reads a different layer value when Shift is held
- this is how the platform exposes hidden controls, settings, or secondary functions without changing the physical layout

So in practical terms:
- the knob itself does not magically change function by code alone
- the firmware changes which "pot layer" is being read when Shift is active

This is the underlying system behavior used by the stock base firmware and is available to MasterBlaster later if we want extended hidden controls.

---

## Firmware summary

MasterBlaster is designed as a single-app effect intended to feel like a warm, imperfect, mastering-style processor with the following character:
- more saturation than clean dynamics processing
- subtle tape wow and instability
- compressed glue stage
- low-bit, low-sample-rate degradation
- gentle final drive and output trim

It is meant to feel like a lo-fi / warm / broken master bus tool rather than a pristine plugin-style effect.

---

## Built-in panel I/O mapping

The Kastle 2 / Citadel have a few built-in panel inputs and outputs that are useful for MasterBlaster beyond the main seven pots.

### Current practical mapping in the firmware

- PARAM_1: drive CV / saturation amount modulation
- PARAM_2: glue CV / compression / warmth modulation
- PARAM_3: crush CV / bit-depth modulation

This is already used by the app in the UI loop as an external modulation path. The app reads those ADC inputs and adds their influence to the mapped drive, glue, and crush parameters.

### Planned / recommended extra mapping

- PITCH_1: external wow / flutter modulation or a secondary drive bias
- PITCH_2: optional tape-speed / instability modulation
- MODE: effect mode selection / bank switching when used as a digital control input
- FEED_1 / FEED_2 / FEED_3: external signal sources for modulation, sidechain style control, or future cross-patching
- ENV_OUT: envelope-like output of the processed signal or internal drive contour
- CV_OUT: processed control voltage derived from the drive/glue/crush state
- TRI_OUT: slow modulation reference or LFO-like modulation source for external modules

### How the controls line up conceptually

The physical knobs remain the primary performer controls:
- K1 Drive: input drive and break-up depth
- K2 Warmth: tone and low-mid saturation color
- K3 Glue: compression and density
- K4 Wow: tape wobble and instability
- K5 Crush: bit reduction and sample-rate collapse
- K6 Mix: dry / wet blend
- K7 Output: final level trim

The panel CV inputs are not a second parameter set yet; they act as modulation sources that bias the same core controls.

That means the effect stays simple and musical: the knobs set the main tone, and the CV inputs can nudge drive, glue, and crunch without completely replacing the front panel workflow.

---

## Current implementation status

This project has reached the point where the app is integrated into the firmware tree and compiles as a standalone firmware target. The current implementation is intentionally a first-pass prototype of the effect architecture, with the following goals still in progress:

- refine tonal shaping and drive response
- tune wow / flutter to feel more analog and less synthetic
- polish parameter ranges for a more convincing Boum-like character
- add stronger hardware validation through end-to-end testing

The current tuning target is deliberately intentionally subtle near minimum and much more dramatic near maximum, so it behaves like a warm and musical effect at low settings and becomes unmistakably broken / saturated at the top end.

---

## Development note

When adding new controls or new modes, keep the panel mapping consistent with this document so the physical hardware and the firmware remain aligned.

The intended flow is:
- map the physical knob positions first
- define the effect function in software
- validate it with tests before writing to hardware
