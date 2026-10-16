import type { ControlSpec, FirmwareApp, JackSpec, LedSpec, Preset, SignalStage } from "../core/app";
import { PARAM_MAX } from "../core/constants";
import { platformSharedControls } from "./platform";

const HALF = 16384;
const pct = (v: number) => `${Math.round((v / PARAM_MAX) * 100)}%`;

// Display-only copies of the firmware's laws (BeadsDsp.cpp). The firmware computes the real values.
function pitchSemitones(pot: number): number {
  const intervals = [0, 1, 3, 4, 7, 12, 24, 24];
  const d = Math.max(0, Math.min(PARAM_MAX, pot)) - HALF;
  const sign = d < 0 ? -1 : 1;
  const detune = (Math.abs(d) * 6) / 16384;
  const i = Math.min(Math.floor(detune), 6);
  const frac = Math.max((detune - i - 1 / 3) * 1.5, 0);
  const s = frac * frac * (3 - 2 * frac);
  return sign * (intervals[i] + (intervals[i + 1] - intervals[i]) * Math.min(s, 1));
}

function attenuverter(pot: number): number {
  const x = (Math.max(0, Math.min(PARAM_MAX, pot)) - HALF) / PARAM_MAX;
  const v = (2 / 0.47) * x * Math.max(Math.abs(x) - 0.03, 0);
  return Math.max(-1, Math.min(1, v));
}

const attText = (pot: number) => {
  const a = attenuverter(pot);
  if (Math.abs(a) < 0.02) return "off";
  return `${a > 0 ? "+" : "−"}${Math.round(Math.abs(a) * 100)}% ${a > 0 ? "(random / CV)" : "(sparse random / CV·random)"}`;
};

function grainText(size: number): string {
  const s = size / PARAM_MAX;
  if (s > 0.99) return "delay mode";
  const reverse = s < 1 / 3;
  const shortness = Math.min(1, 1.025 * (reverse ? s * 3 * (2 - s * 3) : 1 - 1.5 * (s - 1 / 3)));
  const seconds = 4 * Math.pow(2, -9 * shortness);
  const text = seconds < 1 ? `${(seconds * 1000).toFixed(seconds < 0.01 ? 1 : 0)} ms` : `${seconds.toFixed(1)} s`;
  return `${reverse ? "reverse " : ""}${text}`;
}

function shapeText(shape: number): string {
  const s = shape / PARAM_MAX;
  const names: [number, string][] = [[0, "square"], [0.33, "decay"], [0.67, "bell"], [1, "reverse ramp"]];
  return names.reduce((best, n) => (Math.abs(n[0] - s) < Math.abs(best[0] - s) ? n : best))[1];
}

function densityText(d: number): string {
  const x = d / PARAM_MAX;
  if (x < 0.48) return `regular ${(130.8 * Math.pow(2, -16 * x)).toFixed(x < 0.3 ? 1 : 2)} grains/s`;
  if (x > 0.52) return `random ~${(65.4 * Math.pow(2, -16 * (1 - x))).toFixed(1)} grains/s`;
  return "seed / taps only";
}

const MEDIA = [
  { name: "Dirty tape", detail: "8-bit µ-law · 22 kHz · 3.0 s" },
  { name: "Clean tape", detail: "16-bit · 22 kHz · 1.5 s" },
  { name: "Vintage digital", detail: "8-bit µ-law · 44 kHz · 1.5 s" },
  { name: "Digital", detail: "16-bit · 44 kHz · 0.74 s" },
];
const mediaOf = (v: number) => MEDIA[Math.min(3, Math.floor((v / (PARAM_MAX + 1)) * 4))];

const controls: ControlSpec[] = [
  { key: "time", label: "Time", pot: 0, layer: "NORMAL", owner: "app", low: "recent", high: "oldest", description: "Where in the recorded buffer grains start (how far back). CV: PARAM 1.", default: 16384, format: (v) => `${Math.round((v / PARAM_MAX) * 100)}% back` },
  { key: "size", label: "Size", pot: 1, layer: "NORMAL", owner: "app", low: "reverse", high: "delay", description: "Grain length. Counter-clockwise: reversed grains, long → short; then forward grains, short → long. Fully clockwise switches to the two-tap delay mode. CV: PARAM 2.", default: 24000, format: grainText },
  { key: "shape", label: "Shape", pot: 2, layer: "NORMAL", owner: "app", low: "square", high: "reverse", description: "Grain envelope: square, decay, bell, reverse ramp. CV: PARAM 3.", default: 14000, format: shapeText },
  { key: "density", label: "Density", pot: 3, layer: "NORMAL", owner: "app", low: "regular", high: "random", description: "Grain rate. Left of centre: regular grains from 130 Hz (audio rate) down to 0.6 Hz. Centre: grains only on seed taps. Right of centre: random grains, up to 65 per second. In delay mode: delay time (exponential away from the centre). CV: MODE jack (linear + exponential FM).", default: 9000, format: densityText },
  { key: "pitch", label: "Pitch", pot: 4, layer: "NORMAL", owner: "app", low: "−2 oct", high: "+2 oct", description: "Grain transposition, ±24 semitones with detents at 0, 1, 3, 4, 7, 12 and 24 semitones. CV: PITCH 1 jack, 1 V/oct.", default: 16384, format: (v) => { const st = pitchSemitones(v); return Math.abs(st) < 0.05 ? "0 st" : `${st > 0 ? "+" : ""}${st.toFixed(1)} st`; } },
  { key: "dry_wet", label: "Blend", pot: 5, layer: "NORMAL", owner: "app", low: "dry", high: "wet", description: "Dry/wet balance (equal-power-ish, as the original). Also assignable CV (PITCH 2 jack).", default: 24000, format: pct },
  { key: "reverb", label: "Reverb", pot: 6, layer: "NORMAL", owner: "app", low: "off", high: "long", description: "Griesinger reverb after the mix; amount and decay time rise together. Runs at 22 kHz.", default: 8000, format: pct },

  { key: "quality", label: "Quality", pot: 1, layer: "SHIFT", owner: "app", low: "dirty", high: "digital", description: "Recording quality (the original's four media): dirty tape, clean tape, vintage digital, digital. Lower quality means a longer buffer. Changing it clears the buffer.", default: 28672, format: (v) => `${mediaOf(v).name} · ${mediaOf(v).detail}` },
  { key: "feedback", label: "Feedback", pot: 5, layer: "SHIFT", owner: "app", low: "none", high: "∞", description: "Feeds the output back into the buffer. The lower qualities soft-clip it and the 16-bit digital mode squares the knob, as in the original.", default: 8000, format: pct },

  { key: "time_amt", label: "Time amount", pot: 0, layer: "MODE", owner: "app", low: "−", high: "+", description: "Attenuverter. With CV patched on PARAM 1 it scales the CV (negative: CV drives random scatter). Without CV: positive = random time per grain, negative = sparse random.", default: 16384, format: attText },
  { key: "size_amt", label: "Size amount", pot: 1, layer: "MODE", owner: "app", low: "−", high: "+", description: "Attenuverter for Size (PARAM 2). In delay mode it sets the bandwidth of the echoes.", default: 16384, format: attText },
  { key: "shape_amt", label: "Shape amount", pot: 2, layer: "MODE", owner: "app", low: "−", high: "+", description: "Attenuverter for Shape (PARAM 3).", default: 16384, format: attText },
  { key: "seed", label: "Seed mode", pot: 3, layer: "MODE", owner: "app", low: "free-run", high: "seeded", description: "Left: grains run by themselves (the original's locked seed). Right: grains only while the seed gate is high: SHIFT tap or the TRIG jack.", default: 0, format: (v) => (v < PARAM_MAX / 2 ? "free-running" : "seeded: SHIFT tap / TRIG") },
  { key: "pitch_amt", label: "Pitch amount", pot: 4, layer: "MODE", owner: "app", low: "−", high: "+", description: "Attenuverter for Pitch (PITCH 1). Without CV it adds random pitch per grain (up to ±2 octaves).", default: 16384, format: attText },
  { key: "assign", label: "Assign CV", pot: 5, layer: "MODE", owner: "app", low: "feedback", high: "reverb", description: "Which mix control the PITCH 2 jack modulates: feedback, blend or reverb.", default: 0, format: (v) => ["Feedback", "Blend", "Reverb"][Math.min(2, Math.floor((v / (PARAM_MAX + 1)) * 3))] },
  ...platformSharedControls(),
];

const jacks: JackSpec[] = [
  { input: "PARAM_1", short: "TIME", label: "PARAM 1 → Time", description: "Time CV, ±5 V, scaled by the Time amount knob.", range: [-5, 5] },
  { input: "PARAM_2", short: "SIZE", label: "PARAM 2 → Size", description: "Size CV, ±5 V.", range: [-5, 5] },
  { input: "PARAM_3", short: "SHAPE", label: "PARAM 3 → Shape", description: "Shape CV, ±5 V.", range: [-5, 5] },
  { input: "MODE", short: "DENSITY", label: "MODE jack → Density", description: "Density CV: moves the knob and frequency-modulates the grain rate.", range: [-5, 5] },
  { input: "PITCH_1", short: "PITCH", label: "PITCH 1 → Pitch", description: "1 V/oct pitch CV (scaled by the Pitch amount knob).", range: [-2, 5] },
  { input: "PITCH_2", short: "ASSIGN", label: "PITCH 2 → Assign", description: "Assignable CV for feedback, blend or reverb (MODE+K6).", range: [-5, 5] },
  { input: "TRIG_IN", short: "SEED", gate: true, label: "TRIG → Seed", description: "Seed gate: a grain per pulse in seeded mode.", range: [0, 5] },
];

const leds: LedSpec[] = [
  { index: 0, label: "LED 1", description: "Input level (Base platform)" },
  { index: 1, label: "LED 2", description: "Freeze (blue-white)" },
  { index: 2, label: "LED 3", description: "Flashes on every grain / tap, coloured by the recording quality" },
];

const stages: SignalStage[] = [
  { name: "Input", detail: "SHIFT+K1 gain", keys: ["input_gain"] },
  { name: "Record", detail: "+ feedback (SHIFT+K6), quality (SHIFT+K2)", keys: ["feedback", "quality"] },
  { name: "Grains / taps", detail: "time, size, shape, density, pitch", keys: ["time", "size", "shape", "density", "pitch"] },
  { name: "Blend", detail: "K6 dry/wet", keys: ["dry_wet"] },
  { name: "Reverb", detail: "K7", keys: ["reverb"] },
  { name: "Limiter", detail: "→ out", keys: ["output_gain"] },
];

const at = (pot01: number) => Math.round(pot01 * PARAM_MAX);
const presets: Preset[] = [
  { name: "Init", description: "Regular grains, a short digital buffer", values: {} },
  { name: "Granular wash", description: "Random dense clouds, long bell grains, a bit of feedback and reverb", values: { time: at(0.6), size: at(0.7), shape: at(0.65), density: at(0.85), dry_wet: at(0.8), reverb: at(0.45), feedback: at(0.25), quality: at(0.4) } },
  { name: "Stutter", description: "Short square grains at 6 Hz from the recent past", values: { time: at(0.05), size: at(0.42), shape: at(0.02), density: at(0.34), dry_wet: at(0.7), reverb: at(0.1), feedback: 0 } },
  { name: "Tape echo", description: "Delay mode on dirty tape, repeating with feedback", values: { size: PARAM_MAX, density: at(0.42), dry_wet: at(0.5), reverb: at(0.2), feedback: at(0.55), quality: 0 } },
  { name: "Octave shimmer", description: "Grains an octave up, feeding back into a reverb", values: { time: at(0.2), size: at(0.62), shape: at(0.67), density: at(0.8), pitch: at(0.9167), dry_wet: at(0.6), reverb: at(0.7), feedback: at(0.45), quality: at(0.55) } },
  { name: "Reverse smear", description: "Reversed medium grains, long buffer", values: { time: at(0.8), size: at(0.2), shape: at(0.5), density: at(0.2), dry_wet: at(0.75), reverb: at(0.3), feedback: at(0.2), quality: at(0.2) } },
];

/** Beads for Citadel: a fixed-point granular texture processor after Mutable Instruments' Beads. */
export class BeadsApp implements FirmwareApp {
  readonly id = "beads";
  readonly name = "Beads";
  readonly tagline = "Granular texture processor after Mutable Instruments Beads, in fixed point for the RP2040";
  readonly firmwareId = "beads";
  readonly controls = controls;
  readonly jacks = jacks;
  readonly leds = leds;
  readonly stages = stages;
  readonly presets = presets;
  readonly hasBypass = false;
  readonly buttons = {
    shift: "Hold SHIFT for Quality, Feedback and the base gains. A quick tap (no knob moved) is a seed pulse.",
    mode: "Hold MODE for the attenuverters, seed mode and the assign destination. A quick tap (no knob moved) toggles FREEZE.",
  };
}
