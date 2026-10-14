import type { ControlSpec } from "../core/app";
import { PARAM_MAX } from "../core/constants";

// Base-platform controls shared by every app (code/src/common/core/Base.cpp). Value = knob position 0..PARAM_MAX.
// Factory default for input/output gain is EEPROM byte 160 (Memory.cpp) = 62.5 % of the knob.
const FACTORY = Math.round((2560 / 4095) * PARAM_MAX);
const dbText = (db: number) => (Number.isFinite(db) ? `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB` : "-∞ dB");
const potOf = (v: number) => (v / PARAM_MAX) * 4095;

/** Input stage: codec PGA = pot >> 6 (0.75 dB per step from -12 dB) plus software gain pot * 8. */
export function inputGainText(v: number): string {
  const pot = potOf(v);
  const pga = ((Math.floor(pot) >> 6) - 16) * 0.75;
  const sw = 20 * Math.log10(Math.max(1e-6, (pot / 4095) * 8));
  return `PGA ${dbText(pga)} · soft ${dbText(sw)}`;
}

/** Output stage: codec headphone volume (1 dB steps) plus digital attenuation below half. */
export function outputGainText(v: number, maxVolume = 53): string {
  const pot = potOf(v);
  const hp = Math.round((pot / 4105) * maxVolume);
  const soft = pot < 2048 ? 20 * Math.log10(Math.max(1e-6, (2 * pot) / 4095)) : 0;
  return `HP ${dbText(hp - 57)}${soft < 0 ? ` · soft ${dbText(soft)}` : ""}`;
}

export const platformSharedControls = (): ControlSpec[] => [
  {
    key: "input_gain", label: "Input gain", pot: 0, layer: "SHIFT", owner: "platform", low: "min", high: "max",
    description: "Base input gain: codec PGA (-12..+35.25 dB, 0.75 dB steps) plus a software gain of up to x8. Factory default 62.5 %.",
    default: FACTORY, format: inputGainText,
  },
  {
    key: "rhythm", label: "Rhythm", pot: 2, layer: "SHIFT", owner: "platform",
    description: "Base sequencer rhythm. Not used by this app.", default: 0, format: () => "—", unused: true,
  },
  {
    key: "output_gain", label: "Output gain", pot: 4, layer: "SHIFT", owner: "platform", low: "min", high: "max",
    description: "Base output volume: codec headphone amplifier in 1 dB steps, digital attenuation below 50 %. Factory default 62.5 %.",
    default: FACTORY, format: (v) => outputGainText(v),
  },
  {
    key: "tempo", label: "Tempo", pot: 6, layer: "SHIFT", owner: "platform",
    description: "Base clock tempo. Not used by this app.", default: 0, format: () => "—", unused: true,
  },
];

/** NORMAL K3 / K7 belong to the Base LFO unless the app takes them over. */
export const baseLfoControls = (): ControlSpec[] => [
  {
    key: "lfo_mod", label: "LFO mod", pot: 2, layer: "NORMAL", owner: "platform", low: "-", high: "+",
    description: "Base LFO modulation amount / destination (hold the LFO-mod patch destination).", default: 16384, format: () => "base",
  },
  {
    key: "lfo", label: "LFO", pot: 6, layer: "NORMAL", owner: "platform", low: "slow", high: "fast",
    description: "Base LFO rate (also drives the LFO / TRI jack).", default: 16384, format: () => "base",
  },
];
