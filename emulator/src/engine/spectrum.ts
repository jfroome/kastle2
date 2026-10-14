import { bandFrequencies } from "../audio/analysis";

/** Collapses linear FFT bins (dB) into the log-spaced bands used across the UI. */
export function binsToBands(binsDb: Float32Array, sampleRate: number, bands = 64): Float32Array {
  const centers = bandFrequencies(bands);
  const out = new Float32Array(bands);
  const binHz = sampleRate / 2 / binsDb.length;
  for (let b = 0; b < bands; b++) {
    const lo = b === 0 ? centers[0] / 1.07 : Math.sqrt(centers[b - 1] * centers[b]);
    const hi = b === bands - 1 ? centers[b] * 1.07 : Math.sqrt(centers[b] * centers[b + 1]);
    const k0 = Math.max(0, Math.floor(lo / binHz));
    const k1 = Math.max(k0 + 1, Math.min(binsDb.length, Math.ceil(hi / binHz)));
    let max = -200;
    for (let k = k0; k < k1; k++) max = Math.max(max, binsDb[k]);
    out[b] = max;
  }
  return out;
}
