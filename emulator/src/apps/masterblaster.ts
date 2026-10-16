import type { ControlSpec, FirmwareApp, JackSpec, LedSpec, Preset, SignalStage, SwitchSpec } from "../core/app";
import { PARAM_MAX, SAMPLE_RATE } from "../core/constants";
import type { BoardState } from "../firmware/board";
import { MB_DEFAULTS } from "../dsp/masterblaster";
import { platformSharedControls } from "./platform";

const pct = (v: number) => `${Math.round((v / PARAM_MAX) * 100)}%`;
const db = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} dB`;

const appControls: ControlSpec[] = [
  {
    key: "drive", label: "Drive", pot: 0, layer: "NORMAL", owner: "app", low: "1x", high: "8x",
    description: "Input drive into a soft cubic saturator with slight asymmetry (even harmonics). Level compensated. CV: PARAM 1.",
    default: MB_DEFAULTS.drive, format: (v) => `${(1 + (7 * v) / PARAM_MAX).toFixed(1)}x`,
  },
  {
    key: "tone", label: "Tone", pot: 1, layer: "NORMAL", owner: "app", low: "dark", high: "bright",
    description: "Tilt EQ pivoting around 700 Hz. Centre is flat.",
    default: MB_DEFAULTS.tone,
    format: (v) => {
      const t = Math.round(((v - 16384) / 16384) * 100);
      return Math.abs(t) < 3 ? "flat" : `${t > 0 ? "+" : ""}${t}% ${t > 0 ? "bright" : "dark"}`;
    },
  },
  {
    key: "comp", label: "Comp", pot: 2, layer: "NORMAL", owner: "app", low: "off", high: "squash",
    description: "SSL-style stereo-linked bus compressor, fixed 4:1. Turning it up lowers the threshold; makeup gain is automatic. CV: PARAM 2.",
    default: MB_DEFAULTS.comp,
    format: (v) => {
      const thr = (PARAM_MAX - (v * (PARAM_MAX - 2600)) / PARAM_MAX) / PARAM_MAX;
      return v < 100 ? "off" : `thr ${db(20 * Math.log10(thr))}`;
    },
  },
  {
    key: "vinyl", label: "Vinyl", pot: 3, layer: "NORMAL", owner: "app", low: "clean", high: "worn",
    description: "SP-404 style vinyl: high-frequency rolloff, hiss and crackle. The left panel switch picks low-pitched or high-pitched noise, or turns the noise off (the rolloff stays).",
    default: MB_DEFAULTS.vinyl, format: pct,
  },
  {
    key: "lofi", label: "Lo-Fi", pot: 4, layer: "NORMAL", owner: "app", low: "clean", high: "crushed",
    description: "Sample-rate reduction (down to 1/8) and bit reduction (down to 8 bit). CV: PARAM 3.",
    default: MB_DEFAULTS.lofi,
    format: (v) => {
      const step = 256 - (v * 224) / PARAM_MAX;
      const bits = 16 - Math.ceil((v * 8) / PARAM_MAX - 1e-9);
      return v < 100 ? "off" : `${((SAMPLE_RATE * step) / 256 / 1000).toFixed(1)} kHz / ${bits} bit`;
    },
  },
  {
    key: "mix", label: "Mix", pot: 5, layer: "NORMAL", owner: "app", low: "dry", high: "wet",
    description: "Parallel dry/wet. Dry is delay-matched (96 samples) so parallel compression never phases.",
    default: MB_DEFAULTS.mix, format: pct,
  },
  {
    key: "output", label: "Output", pot: 6, layer: "NORMAL", owner: "app", low: "-∞", high: "+6 dB",
    description: "Output trim before the limiter. About 70% is unity.",
    default: MB_DEFAULTS.output,
    format: (v) => {
      const p = v / PARAM_MAX;
      return db(20 * Math.log10(Math.max(1e-6, 2 * p * p)));
    },
  },
  {
    key: "comp_speed", label: "Comp speed", pot: 1, layer: "SHIFT", owner: "app", low: "slow", high: "fast",
    description: "Compressor attack/release. Slow = glue, fast = pump/limit.",
    default: MB_DEFAULTS.comp_speed,
    format: (v) => {
      const slow = PARAM_MAX - v;
      const attack = ((44 + (slow * 1200) / PARAM_MAX) / SAMPLE_RATE) * 1000;
      const release = ((1760 + (slow * 33440) / PARAM_MAX) / SAMPLE_RATE) * 1000;
      return `A ${attack.toFixed(1)} / R ${release.toFixed(0)} ms`;
    },
  },
  {
    key: "wow", label: "Wow", pot: 3, layer: "SHIFT", owner: "app", low: "steady", high: "warped",
    description: "Wow, flutter and drift pitch wobble (modulated delay), the vinyl warp. This knob sets the depth; the right panel switch sets the speed.",
    default: MB_DEFAULTS.wow,
    format: (v) => (v < 100 ? "off" : `±${((v * 40) / PARAM_MAX / SAMPLE_RATE * 1000).toFixed(2)} ms`),
  },
  {
    key: "width", label: "Width", pot: 5, layer: "SHIFT", owner: "app", low: "mono", high: "wide",
    description: "Mid/side stereo width. Centre unchanged, 0 = mono (mono-safe low end), max = 2x side.",
    default: MB_DEFAULTS.width, format: (v) => `${Math.round((v / PARAM_MAX) * 200)}%`,
  },
  ...platformSharedControls(),
];

const appJacks: JackSpec[] = [
  { input: "PARAM_1", short: "DRIVE", label: "PARAM 1 → Drive", description: "Additive CV. 0 V = no change, +5 V adds a full knob range, negative subtracts.", range: [-5, 5] },
  { input: "PARAM_2", short: "COMP", label: "PARAM 2 → Comp", description: "Additive CV on the bus compressor amount.", range: [-5, 5] },
  { input: "PARAM_3", short: "LO-FI", label: "PARAM 3 → Lo-Fi", description: "Additive CV on the lo-fi crush.", range: [-5, 5] },
];

const appSwitches: SwitchSpec[] = [
  {
    input: "FEED_3", panelLabel: "CV", label: "Vinyl noise",
    description: "Left switch (INV CV): the pitch of the vinyl hiss and crackle: low-pitched (up), high-pitched (middle) or off (down).",
    up: "low", middle: "high", down: "off",
  },
  {
    input: "FEED_1", panelLabel: "GATE", label: "Wow speed",
    description: "Right switch (INV GATE): speed of the wow / drift / flutter: slow ~0.24 Hz, medium ~0.6 Hz, fast ~1.3 Hz. SHIFT+K4 still sets the amount.",
    up: "slow", middle: "medium", down: "fast",
  },
];

const appLeds: LedSpec[] = [
  { index: 0, label: "LED 1", description: "Input level (Base platform)" },
  { index: 1, label: "LED 2", description: "Compressor gain reduction (yellow→orange). Grey when bypassed." },
  { index: 2, label: "LED 3", description: "Limiter activity (red) over mix level (blue). Grey when bypassed." },
];

const stages: SignalStage[] = [
  { name: "Input", detail: "SHIFT+K1 input gain", keys: ["input_gain"] },
  { name: "Saturate", detail: "K1 drive, soft cubic + asymmetry", keys: ["drive"] },
  { name: "Tone", detail: "K2 tilt EQ @ 700 Hz", keys: ["tone"] },
  { name: "Bus Comp", detail: "K3 amount, SHIFT+K2 speed, 4:1", keys: ["comp", "comp_speed"] },
  { name: "Vinyl", detail: "K4 rolloff/noise, left switch noise type, SHIFT+K4 wow depth, right switch wow speed", keys: ["vinyl", "wow"] },
  { name: "Lo-Fi", detail: "K5 sample-rate + bit crush", keys: ["lofi"] },
  { name: "Width", detail: "SHIFT+K6 mid/side", keys: ["width"] },
  { name: "Mix", detail: "K6 dry/wet (dry delay-matched)", keys: ["mix"] },
  { name: "Output", detail: "K7 trim, then -0.5 dBFS limiter", keys: ["output"] },
];

const pctOf = (p: number) => Math.round(p * PARAM_MAX);

const presets: Preset[] = [
  { name: "Init (defaults)", description: "Mild drive, flat tone, mix 100%", values: {} },
  {
    name: "Transparent glue",
    description: "Gentle bus glue, nothing else",
    values: { drive: pctOf(0.2), tone: 16384, comp: pctOf(0.3), comp_speed: pctOf(0.6), vinyl: 0, wow: 0, lofi: 0, mix: PARAM_MAX },
  },
  {
    name: "SSL-style squeeze",
    description: "Fast heavy bus comp blended 60/40 for parallel compression",
    values: { drive: pctOf(0.3), comp: pctOf(0.65), comp_speed: pctOf(0.9), mix: pctOf(0.6) },
  },
  {
    name: "SP-404 vinyl sim",
    description: "Dark, worn, warbly record",
    values: { drive: pctOf(0.4), tone: pctOf(0.4), vinyl: pctOf(0.5), wow: pctOf(0.3), lofi: pctOf(0.15), comp: pctOf(0.3) },
  },
  {
    name: "OTO Boum crush",
    description: "Hard drive, heavy comp and crush, blended back",
    values: { drive: pctOf(0.7), comp: pctOf(0.8), lofi: pctOf(0.5), output: pctOf(0.55), mix: pctOf(0.7) },
  },
  {
    name: "Mono-safe master",
    description: "Light glue with the stereo image collapsed",
    values: { drive: pctOf(0.2), comp: pctOf(0.3), comp_speed: pctOf(0.6), width: 0 },
  },
];

export class MasterBlasterApp implements FirmwareApp {
  readonly id = "masterblaster";
  readonly name = "MasterBlaster";
  readonly tagline = "One end-to-end mastering chain: SP-404 vinyl sim × OTO Boum × SSL bus comp";
  readonly firmwareId = "masterblaster";
  readonly dspId = "masterblaster";
  readonly controls = appControls;
  readonly jacks = appJacks;
  readonly leds = appLeds;
  readonly switches = appSwitches;
  readonly stages = stages;
  readonly presets = presets;
  readonly hasBypass = true;
  readonly buttons = {
    shift: "Hold SHIFT to reach comp speed, wow, width (and base input/output gain).",
    mode: "Tap MODE to toggle bypass (a click-free crossfade to the delay-matched dry signal).",
  };

  isBypassed(state: BoardState): boolean {
    // The firmware shows bypass as grey on LED 2 and LED 3
    const [r, g, b] = state.leds[1];
    return r === 40 && g === 40 && b === 40;
  }
}
