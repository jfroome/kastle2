export type CvShape = "dc" | "sine" | "triangle" | "square" | "saw" | "random";

/** A simulated CV source patched into a Citadel PARAM jack. Unpatched jacks read 0 V. */
export interface CvChannel {
  patched: boolean;
  shape: CvShape;
  /** Offset / DC level in volts */
  offset: number;
  /** Peak amplitude in volts (ignored for dc) */
  depth: number;
  rateHz: number;
}

export const defaultCv = (): CvChannel => ({ patched: false, shape: "dc", offset: 0, depth: 2.5, rateHz: 0.5 });

export function cvVoltsAt(ch: CvChannel, t: number): number {
  if (!ch.patched) return 0;
  const phase = (t * ch.rateHz) % 1;
  let wave = 0;
  switch (ch.shape) {
    case "dc":
      return clampVolts(ch.offset);
    case "sine":
      wave = Math.sin(2 * Math.PI * phase);
      break;
    case "triangle":
      wave = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
      break;
    case "square":
      wave = phase < 0.5 ? 1 : -1;
      break;
    case "saw":
      wave = 2 * phase - 1;
      break;
    case "random": {
      // sample & hold, deterministic per step
      const step = Math.floor(t * ch.rateHz);
      const x = Math.sin(step * 12.9898 + 78.233) * 43758.5453;
      wave = (x - Math.floor(x)) * 2 - 1;
      break;
    }
  }
  return clampVolts(ch.offset + ch.depth * wave);
}

const clampVolts = (v: number) => Math.max(-5, Math.min(8, v));
