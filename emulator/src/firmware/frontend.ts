// Analog front end of the Citadel as seen by the RP2040 ADC. All numbers come from the firmware sources:
//   Hardware.cpp  NormalizeAdcResult / Citadel reference calibrations / ADC mux routing
//   Hardware.hpp  FEED thresholds, pin numbers
import { POT_COUNT } from "../core/constants";

export type JackName =
  | "PITCH_1"
  | "PITCH_2"
  | "RESET"
  | "MODE"
  | "PARAM_1"
  | "PARAM_2"
  | "PARAM_3"
  | "FEED_1"
  | "FEED_2"
  | "FEED_3"
  | "TRIG_IN";

/** [hardware ADC input, multiplexer address] for each analog source (Hardware::AdcIrqHandler). */
export const ADC_ROUTE: Record<JackName | `POT_${1 | 2 | 3 | 4 | 5 | 6 | 7}`, [number, number]> = {
  RESET: [0, 0],
  PARAM_3: [0, 1],
  PARAM_1: [0, 2],
  MODE: [0, 3],
  FEED_1: [0, 4],
  FEED_2: [0, 5],
  FEED_3: [0, 6],
  PARAM_2: [0, 7],
  POT_5: [1, 0],
  POT_1: [1, 1],
  POT_4: [1, 2],
  POT_6: [1, 3],
  TRIG_IN: [1, 4],
  POT_7: [1, 5],
  POT_2: [1, 6],
  POT_3: [1, 7],
  PITCH_1: [2, 0],
  PITCH_2: [3, 0],
};

/** Raw ADC counts measured on real Citadels at 0..4 V (inverting input stage), from Hardware.hpp */
const CITADEL_PITCH_RAW = [3866, 3329, 2782, 2243, 1694];

export const PIN = {
  RX: 1,
  PULSE_OUT: 2,
  GATE_OUT: 3,
  SYNC_OUT: 7,
  BUTTON_SHIFT: 17,
  BUTTON_MODE: 18,
  TRIG_IN: 19,
  RESET_IN: 22,
  AUDIO_IN_DETECT: 23,
  SYNC_IN_DETECT: 24,
  SYNC_IN: 25,
} as const;

export const POT_RAW_MIN = 20;
export const POT_RAW_MAX = 4078;

export function potNormToRaw(norm: number): number {
  return Math.round(POT_RAW_MIN + Math.max(0, Math.min(1, norm)) * (POT_RAW_MAX - POT_RAW_MIN));
}

/** Raw ADC counts the RP2040 would read for a voltage at the jack. */
export function voltsToRaw(jack: JackName, volts: number): number {
  let raw: number;
  switch (jack) {
    case "PARAM_1":
    case "PARAM_2":
    case "PARAM_3":
      raw = 2049 + (volts / 5) * (192 - 2049);
      break;
    case "RESET":
    case "MODE":
    case "TRIG_IN":
      raw = 2049 + (volts / 5) * (194 - 2049);
      break;
    case "FEED_1":
    case "FEED_2":
    case "FEED_3":
      raw = 980 + (volts / 5) * (3750 - 980);
      break;
    case "PITCH_1":
    case "PITCH_2": {
      const slope = (CITADEL_PITCH_RAW[4] - CITADEL_PITCH_RAW[1]) / 3;
      if (volts <= 0) raw = CITADEL_PITCH_RAW[0] + volts * slope;
      else if (volts >= 4) raw = CITADEL_PITCH_RAW[4] + (volts - 4) * slope;
      else {
        const i = Math.floor(volts);
        raw = CITADEL_PITCH_RAW[i] + (volts - i) * (CITADEL_PITCH_RAW[i + 1] - CITADEL_PITCH_RAW[i]);
      }
      break;
    }
  }
  return Math.max(0, Math.min(4095, Math.round(raw)));
}

/** Voltage at which an unpatched jack reads (FEEDs sit in the middle of their tri-state window). */
export const UNPATCHED_RAW: Partial<Record<JackName, number>> = {
  FEED_1: 2076,
  FEED_2: 2076,
  FEED_3: 2076,
};

export const POT_JACKS = (["POT_1", "POT_2", "POT_3", "POT_4", "POT_5", "POT_6", "POT_7"] as const).slice(0, POT_COUNT);
