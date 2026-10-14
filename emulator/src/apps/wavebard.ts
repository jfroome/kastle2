import type { ControlSpec, FirmwareApp, JackSpec, LedSpec, SignalStage } from "../core/app";
import { PARAM_MAX } from "../core/constants";
import { baseLfoControls, platformSharedControls } from "./platform";

const pct = (v: number) => `${Math.round((v / PARAM_MAX) * 100)}%`;
const bipolar = (v: number) => `${v >= PARAM_MAX / 2 ? "+" : ""}${Math.round(((v - PARAM_MAX / 2) / (PARAM_MAX / 2)) * 100)}%`;
const HALF = Math.round(PARAM_MAX / 2);

// Pot map from AppWaveBard.cpp (FancyPot::Create calls) and the Citadel Wave Bard faceplate.
const controls: ControlSpec[] = [
  { key: "pitch_mod", label: "Pitch mod", pot: 0, layer: "NORMAL", owner: "app", low: "−", high: "+", description: "Attenuverter for the pitch CV inputs (FREE / NOTE).", default: HALF, format: bipolar },
  { key: "sample_mod", label: "Sample mod", pot: 1, layer: "NORMAL", owner: "app", low: "−", high: "+", description: "Attenuverter for the SAMPLE CV input.", default: HALF, format: bipolar },
  ...baseLfoControls().filter((c) => c.pot === 2).map((c) => ({ ...c, label: "LFO mod" })),
  { key: "length", label: "Length", pot: 3, layer: "NORMAL", owner: "app", low: "short", high: "long", description: "Envelope / playback length of the sample. CV: LENGTH jack.", default: HALF, format: pct },
  { key: "pitch", label: "Pitch", pot: 4, layer: "NORMAL", owner: "app", low: "low", high: "high", description: "Sample pitch (free, or quantized to the selected scale).", default: HALF, format: pct },
  { key: "sample", label: "Sample", pot: 5, layer: "NORMAL", owner: "app", low: "first", high: "last", description: "Selects the sample within the bank. CV: SAMPLE jack.", default: 0, format: pct },
  ...baseLfoControls().filter((c) => c.pot === 6).map((c) => ({ ...c, label: "LFO" })),

  { key: "length_mod", label: "Length mod", pot: 3, layer: "SHIFT", owner: "app", low: "−", high: "+", description: "Attenuverter for the LENGTH CV input.", default: HALF, format: bipolar },
  { key: "fx", label: "FX", pot: 1, layer: "SHIFT", owner: "app", low: "dry", high: "wet", description: "Delay / effect amount.", default: 0, format: pct },
  { key: "filter", label: "Filter", pot: 5, layer: "SHIFT", owner: "app", low: "LP", high: "HP", description: "DJ-style filter, centre = off.", default: HALF, format: bipolar },
  ...platformSharedControls(),

  { key: "scale", label: "Scale", pot: 0, layer: "MODE", owner: "app", low: "first", high: "last", description: "Pitch quantizer scale (Mode layer).", default: HALF, format: pct },
  { key: "root", label: "Root", pot: 1, layer: "MODE", owner: "app", low: "C", high: "B", description: "Quantizer root note (12 semitones).", default: 0, format: (v) => ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][Math.min(11, Math.floor((v / PARAM_MAX) * 12))] },
  { key: "fine", label: "Fine", pot: 2, layer: "MODE", owner: "app", low: "−", high: "+", description: "Fine tuning.", default: HALF, format: bipolar },
  { key: "quantized", label: "Quantize", pot: 4, layer: "MODE", owner: "app", low: "free", high: "quantized", description: "Pitch quantization amount (Mode layer).", default: 0, format: pct },
];

const jacks: JackSpec[] = [
  { input: "PITCH_1", label: "FREE (pitch)", description: "Free 1 V/oct pitch CV.", range: [-1, 8] },
  { input: "PITCH_2", label: "NOTE (pitch)", description: "Stepped / quantized 1 V/oct pitch CV.", range: [-1, 8] },
  { input: "PARAM_1", label: "SAMPLE", description: "Sample selection CV.", range: [-5, 5] },
  { input: "PARAM_3", label: "LENGTH", description: "Envelope length CV.", range: [-5, 5] },
  { input: "MODE", label: "BANK", description: "Bank selection CV.", range: [-5, 5] },
  { input: "PARAM_2", label: "LFO MOD", description: "Base LFO modulation CV.", range: [-5, 5] },
];

const leds: LedSpec[] = [
  { index: 0, label: "LED 1", description: "Tempo / LFO blink (fake blinker) and input level" },
  { index: 1, label: "LED 2", description: "Sample / bank colour" },
  { index: 2, label: "LED 3", description: "Trigger / bank indication" },
];

const stages: SignalStage[] = [
  { name: "Trigger", detail: "TRIG jack, MIDI note, sequencer", keys: [] },
  { name: "Sample player", detail: "SAMPLE, PITCH, LENGTH, scale/root", keys: ["sample", "pitch", "length"] },
  { name: "Filter", detail: "SHIFT+K6", keys: ["filter"] },
  { name: "FX", detail: "SHIFT+K2", keys: ["fx"] },
  { name: "Output", detail: "SHIFT+K5 volume", keys: ["output_gain"] },
];

export class WaveBardApp implements FirmwareApp {
  readonly id = "wavebard";
  readonly name = "Wave Bard";
  readonly tagline = "Stereo sample player and beyond: needs a trigger or MIDI note (use the keyboard below).";
  readonly firmwareId = "wavebard";
  readonly controls = controls;
  readonly jacks = jacks;
  readonly leds = leds;
  readonly stages = stages;
  readonly presets = [{ name: "Init", values: {} }];
  readonly hasBypass = false;
  readonly buttons = {
    shift: "SHIFT: length mod, FX, filter, base input/output gain.",
    mode: "BANK (MODE): pitch scale, root, fine tune; tap to change bank.",
  };
}
