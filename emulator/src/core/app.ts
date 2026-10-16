import type { BoardState, Layer } from "../firmware/board";
import type { JackName } from "../firmware/frontend";

/** A pot function in one layer. `value` is the knob position 0..PARAM_MAX. */
export interface ControlSpec {
  key: string;
  label: string;
  pot: number;
  layer: Layer;
  /** "app" controls are read by the firmware app; "platform" ones belong to the Base layer shared by all apps. */
  owner: "app" | "platform";
  /** Short end-of-range captions shown on the faceplate, e.g. "dark" / "bright" */
  low?: string;
  high?: string;
  description: string;
  default: number;
  /** Human readable value, derived from the firmware formulas */
  format(value: number): string;
  /** Platform pots the app doesn't use */
  unused?: boolean;
}

export interface JackSpec {
  input: JackName;
  /** Full label for tooltips and the CV panel */
  label: string;
  /** Short caption under the jack on the faceplate */
  short?: string;
  description: string;
  /** A digital gate input (TRIG): held with the mouse instead of patched with a voltage */
  gate?: boolean;
  /** Voltage range shown on the slider */
  range?: [number, number];
}

/** One of the two 3-pole switches on the Citadel (silkscreened RND / INV, they sit on the tri-state FEED inputs) */
export interface SwitchSpec {
  /** FEED_3 is the left switch (CV), FEED_1 the right one (GATE) */
  input: "FEED_1" | "FEED_3";
  /** Caption on the panel, e.g. "CV" / "GATE" */
  panelLabel: string;
  /** What the switch does in this app */
  label: string;
  description: string;
  /** What each position does, shown next to the switch */
  up: string;
  middle: string;
  down: string;
}

/** 0 = up (line driven high, "RND"), 1 = middle (floating), 2 = down (line driven low, "INV") */
export type SwitchPosition = 0 | 1 | 2;

/** Voltage the emulated switch puts on its FEED input; undefined leaves the jack floating */
export const switchVolts = (position: SwitchPosition): number | undefined => (position === 0 ? 5 : position === 2 ? 0 : undefined);

export interface LedSpec {
  index: number;
  label: string;
  description: string;
}

export interface Preset {
  name: string;
  description?: string;
  /** Knob positions by control key (0..PARAM_MAX); missing keys use the defaults */
  values: Record<string, number>;
}

export interface SignalStage {
  name: string;
  detail: string;
  keys: string[];
}

/** Everything the emulator needs to know about a firmware app: labels, ranges and recipes. Behaviour comes from the firmware. */
export interface FirmwareApp {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  /** Firmware build in src/firmware (wasm/firmware/build_all.sh) */
  readonly firmwareId: string;
  readonly controls: ControlSpec[];
  readonly jacks: JackSpec[];
  readonly leds: LedSpec[];
  /** Panel switches the app uses; apps without any leave this out */
  readonly switches?: SwitchSpec[];
  readonly stages: SignalStage[];
  readonly presets: Preset[];
  readonly buttons: { shift: string; mode: string };
  /** True when MODE tap toggles an on/off bypass the UI should highlight */
  readonly hasBypass: boolean;
  isBypassed?(state: BoardState): boolean;
  /** DSP-level test hooks (MasterBlaster only) */
  readonly dspId?: string;
}

export const controlDefaults = (app: FirmwareApp): Record<string, number> =>
  Object.fromEntries(app.controls.map((c) => [c.key, c.default]));
