import type { StereoSignal } from "../engine/offline";
import { fft } from "./fft";

const toDb = (x: number): number => (x > 1e-9 ? 20 * Math.log10(x) : -180);

export interface SignalStats {
  durationSec: number;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  /** Integrated loudness, ITU-R BS.1770-4 (K-weighted, gated). -Infinity for silence. */
  lufs: number;
  clippedSamples: number;
  dcOffset: number;
  /** L/R correlation, -1 (out of phase) .. +1 (mono) */
  correlation: number;
}

interface Biquad {
  b: [number, number, number];
  a: [number, number];
}

function kWeightingFilters(fs: number): Biquad[] {
  const G = 3.99984385397;
  const Q = 0.7071752369554193;
  const fc = 1681.9744509555319;
  const K = Math.tan((Math.PI * fc) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  const Q2 = 0.5003270373253953;
  const fc2 = 38.13547087613982;
  const K2 = Math.tan((Math.PI * fc2) / fs);
  const a02 = 1 + K2 / Q2 + K2 * K2;
  const highpass: Biquad = {
    b: [1, -2, 1],
    a: [(2 * (K2 * K2 - 1)) / a02, (1 - K2 / Q2 + K2 * K2) / a02],
  };
  return [shelf, highpass];
}

function applyBiquad(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b[0] * x[i] + f.b[1] * x1 + f.b[2] * x2 - f.a[0] * y1 - f.a[1] * y2;
    x2 = x1; x1 = x[i];
    y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

export function integratedLoudness(signal: StereoSignal): number {
  const fs = signal.sampleRate;
  const filters = kWeightingFilters(fs);
  const weighted = [signal.left, signal.right].map((ch) => filters.reduce((acc, f) => applyBiquad(acc, f), ch));
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  if (signal.left.length < block) {
    return -Infinity;
  }
  const energies: number[] = [];
  for (let start = 0; start + block <= signal.left.length; start += hop) {
    let sum = 0;
    for (const ch of weighted) {
      let s = 0;
      for (let i = start; i < start + block; i++) s += ch[i] * ch[i];
      sum += s / block;
    }
    energies.push(sum);
  }
  const loud = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = energies.filter((z) => z > 0 && loud(z) > -70);
  if (!abs.length) return -Infinity;
  const relGate = loud(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => loud(z) > relGate);
  if (!gated.length) return -Infinity;
  return loud(gated.reduce((a, b) => a + b, 0) / gated.length);
}

export function analyze(signal: StereoSignal): SignalStats {
  const { left, right } = signal;
  const n = left.length;
  let peak = 0, sumSq = 0, clipped = 0, dc = 0, sl = 0, sr = 0, slr = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSq += (l * l + r * r) * 0.5;
    if (Math.abs(l) >= 0.9999 || Math.abs(r) >= 0.9999) clipped++;
    dc += (l + r) * 0.5;
    sl += l * l;
    sr += r * r;
    slr += l * r;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  const denom = Math.sqrt(sl * sr);
  return {
    durationSec: n / signal.sampleRate,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    crestDb: toDb(peak) - toDb(rms),
    lufs: integratedLoudness(signal),
    clippedSamples: clipped,
    dcOffset: dc / Math.max(1, n),
    correlation: denom > 1e-12 ? slr / denom : 1,
  };
}

export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
}

/** Mono min/max envelope with `bins` columns for drawing overview waveforms. */
export function waveformPeaks(signal: StereoSignal, bins: number): WaveformPeaks {
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  const n = signal.left.length;
  const per = Math.max(1, n / bins);
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(n, Math.floor((b + 1) * per) + 1);
    let lo = 0, hi = 0;
    for (let i = start; i < end; i++) {
      const v = (signal.left[i] + signal.right[i]) * 0.5;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/** Log-spaced band centre frequencies used by the spectrum displays. */
export function bandFrequencies(count = 64, fMin = 20, fMax = 20000): number[] {
  return Array.from({ length: count }, (_, i) => fMin * Math.pow(fMax / fMin, i / (count - 1)));
}

/** Average power spectrum in dB per log band (Hann window, 4096-point FFT, up to ~400 frames). */
export function averageSpectrum(signal: StereoSignal, bands = 64, size = 4096): Float32Array {
  const n = signal.left.length;
  const window = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const power = new Float64Array(size / 2);
  const frames = Math.max(1, Math.min(400, Math.floor((n - size) / (size / 2)) + 1));
  const stride = Math.max(size / 2, Math.floor((n - size) / frames));
  let used = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * stride;
    if (start + size > n) break;
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (signal.left[start + i] + signal.right[start + i]) * 0.5 * window[i];
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  const centers = bandFrequencies(bands);
  const out = new Float32Array(bands);
  const binHz = signal.sampleRate / size;
  const norm = 1 / Math.max(1, used) / (size * size * 0.375);
  for (let b = 0; b < bands; b++) {
    const lo = b === 0 ? centers[0] / 1.07 : Math.sqrt(centers[b - 1] * centers[b]);
    const hi = b === bands - 1 ? centers[b] * 1.07 : Math.sqrt(centers[b] * centers[b + 1]);
    const k0 = Math.max(1, Math.floor(lo / binHz));
    const k1 = Math.max(k0 + 1, Math.min(size / 2, Math.ceil(hi / binHz)));
    let sum = 0;
    for (let k = k0; k < k1; k++) sum += power[k];
    out[b] = 10 * Math.log10(sum * norm + 1e-18);
  }
  return out;
}
