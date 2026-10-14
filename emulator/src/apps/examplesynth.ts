import type { ControlSpec, FirmwareApp, JackSpec, LedSpec, SignalStage } from "../core/app";
import { PARAM_MAX } from "../core/constants";
import { baseLfoControls, platformSharedControls } from "./platform";

const pct = (v: number) => `${Math.round((v / PARAM_MAX) * 100)}%`;
const HALF = Math.round(PARAM_MAX / 2);
const bipolar = (v: number) => `${v >= HALF ? "+" : ""}${Math.round(((v - HALF) / HALF) * 100)}%`;

// Pot map from AppExampleSynth.cpp
const controls: ControlSpec[] = [
  { key: "pitch_mod", label: "Pitch mod", pot: 0, layer: "NORMAL", owner: "app", low: "−", high: "+", description: "Pitch CV attenuverter.", default: HALF, format: bipolar },
  { key: "timbre_mod", label: "Timbre mod", pot: 1, layer: "NORMAL", owner: "app", low: "−", high: "+", description: "Timbre CV attenuverter.", default: HALF, format: bipolar },
  ...baseLfoControls().filter((c) => c.pot === 2),
  { key: "env", label: "Envelope", pot: 3, layer: "NORMAL", owner: "app", low: "short", high: "long", description: "Envelope length.", default: HALF, format: pct },
  { key: "pitch", label: "Pitch", pot: 4, layer: "NORMAL", owner: "app", low: "low", high: "high", description: "Oscillator pitch.", default: HALF, format: pct },
  { key: "timbre", label: "Timbre", pot: 5, layer: "NORMAL", owner: "app", low: "dark", high: "bright", description: "Timbre.", default: HALF, format: pct },
  ...baseLfoControls().filter((c) => c.pot === 6),
  { key: "env_mod", label: "Env mod", pot: 3, layer: "SHIFT", owner: "app", low: "−", high: "+", description: "Envelope CV attenuverter.", default: HALF, format: bipolar },
  { key: "fx", label: "FX", pot: 1, layer: "SHIFT", owner: "app", low: "dry", high: "wet", description: "Delay amount.", default: 0, format: pct },
  { key: "resonance", label: "Resonance", pot: 5, layer: "SHIFT", owner: "app", low: "low", high: "high", description: "Filter resonance.", default: HALF, format: pct },
  ...platformSharedControls(),
  { key: "scale", label: "Scale", pot: 0, layer: "MODE", owner: "app", low: "first", high: "last", description: "Quantizer scale.", default: HALF, format: pct },
  { key: "root", label: "Root", pot: 1, layer: "MODE", owner: "app", low: "C", high: "B", description: "Quantizer root.", default: 0, format: pct },
  { key: "fine", label: "Fine", pot: 2, layer: "MODE", owner: "app", low: "−", high: "+", description: "Fine tuning.", default: HALF, format: bipolar },
  { key: "mode_mod", label: "Mode mod", pot: 3, layer: "MODE", owner: "app", low: "−", high: "+", description: "Mode CV attenuverter.", default: HALF, format: bipolar },
];

const jacks: JackSpec[] = [
  { input: "PITCH_1", label: "FREE (pitch)", description: "Free pitch modulation.", range: [-1, 8] },
  { input: "PITCH_2", label: "NOTE (pitch)", description: "Quantized 1 V/oct pitch.", range: [-1, 8] },
  { input: "PARAM_1", label: "TIMBRE", description: "Timbre CV.", range: [-5, 5] },
  { input: "PARAM_3", label: "ENV", description: "Envelope CV.", range: [-5, 5] },
  { input: "MODE", label: "MODE", description: "Mode CV.", range: [-5, 5] },
];

const leds: LedSpec[] = [
  { index: 0, label: "LED 1", description: "Input level / LFO" },
  { index: 1, label: "LED 2", description: "Mode colour" },
  { index: 2, label: "LED 3", description: "Envelope" },
];

const stages: SignalStage[] = [
  { name: "Oscillator", detail: "K5 pitch, scale/root", keys: ["pitch"] },
  { name: "Filter", detail: "K6 timbre, SHIFT+K6 resonance", keys: ["timbre", "resonance"] },
  { name: "Envelope", detail: "K4 length", keys: ["env"] },
  { name: "Delay FX", detail: "SHIFT+K2", keys: ["fx"] },
];

export class ExampleSynthApp implements FirmwareApp {
  readonly id = "examplesynth";
  readonly name = "Example Synth";
  readonly tagline = "The repo's example synthesizer. Play it with the keyboard below or the TRIG jack.";
  readonly firmwareId = "examplesynth";
  readonly controls = controls;
  readonly jacks = jacks;
  readonly leds = leds;
  readonly stages = stages;
  readonly presets = [{ name: "Init", values: {} }];
  readonly hasBypass = false;
  readonly buttons = { shift: "SHIFT: envelope mod, FX, resonance.", mode: "MODE: scale, root, fine, mode mod." };
}
