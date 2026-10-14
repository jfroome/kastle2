import type { BoardState, PanelAction, PanelInputs } from "../firmware/board";
import type { AnalogOptions } from "../firmware/codec";

export type ToWorklet =
  | {
      type: "init";
      firmwareId: string;
      wasm: ArrayBuffer;
      userData?: ArrayBuffer;
      eeprom?: Uint8Array;
      analog: AnalogOptions;
      panel: PanelInputs;
      script: PanelAction[];
    }
  | { type: "panel"; panel: PanelInputs }
  | { type: "analog"; analog: AnalogOptions }
  | { type: "actions"; actions: PanelAction[] }
  | { type: "midi"; bytes: number[] };

export interface MeterMessage {
  type: "meters";
  inPeak: number;
  outPeak: number;
  inRms: number;
  outRms: number;
  board: BoardState;
}

export type FromWorklet =
  | MeterMessage
  | { type: "ready"; name: string }
  | { type: "error"; message: string }
  | { type: "eeprom"; data: Uint8Array };

export const PROCESSOR_NAME = "firmware-processor";
