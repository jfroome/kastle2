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
  label: string;
  description: string;
  /** Voltage range shown on the slider */
  range?: [number, number];
}

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
