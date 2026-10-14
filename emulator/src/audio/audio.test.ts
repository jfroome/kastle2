import { describe, expect, it } from "vitest";
import { analyze, averageSpectrum, bandFrequencies } from "./analysis";
import { parseAiff, parseWav, sniffFormat, toTrack } from "./decode";
import { demoBeat, pinkNoise, sine } from "./generators";
import { resample } from "./resample";
import { encodeWav } from "./wav";

function extended80(value: number): number[] {
  // Enough for integer sample rates
  const exp = Math.floor(Math.log2(value));
  const mantissa = BigInt(Math.round(value * Math.pow(2, 63 - exp)));
  const bytes = [((exp + 16383) >> 8) & 0xff, (exp + 16383) & 0xff];
  for (let i = 7; i >= 0; i--) bytes.push(Number((mantissa >> BigInt(i * 8)) & 0xffn));
  return bytes;
}

function buildAiff(left: number[], right: number[], rate: number, bits: 16 | 24): ArrayBuffer {
  const bytes = bits / 8;
  const frames = left.length;
  const ssndSize = 8 + frames * 2 * bytes;
  const total = 4 + (8 + 18) + (8 + ssndSize);
  const buf = new ArrayBuffer(8 + total);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "FORM");
  v.setUint32(4, total);
  str(8, "AIFF");
  str(12, "COMM");
  v.setUint32(16, 18);
  v.setUint16(20, 2);
  v.setUint32(22, frames);
  v.setUint16(26, bits);
  extended80(rate).forEach((b, i) => v.setUint8(28 + i, b));
  str(38, "SSND");
  v.setUint32(42, ssndSize);
  v.setUint32(46, 0);
  v.setUint32(50, 0);
  let o = 54;
  for (let i = 0; i < frames; i++) {
    for (const x of [left[i], right[i]]) {
      if (bits === 16) v.setInt16(o, Math.round(x * 32767));
      else {
        const n = Math.round(x * 8388607);
        v.setUint8(o, (n >> 16) & 0xff);
        v.setUint8(o + 1, (n >> 8) & 0xff);
        v.setUint8(o + 2, n & 0xff);
      }
      o += bytes;
    }
  }
  return buf;
}

describe("audio file support", () => {
  it("round-trips WAV at 16/24/32f", () => {
    const src = sine(440, 0.2, -6);
    for (const bits of [16, 24, 32] as const) {
      const parsed = parseWav(encodeWav(src, bits));
      expect(sniffFormat(encodeWav(src, bits))).toBe("wav");
      expect(parsed.sampleRate).toBe(44000);
      expect(parsed.channels).toHaveLength(2);
      let maxErr = 0;
      for (let i = 0; i < src.left.length; i++) maxErr = Math.max(maxErr, Math.abs(parsed.channels[0][i] - src.left[i]));
      expect(maxErr).toBeLessThan(bits === 16 ? 1e-4 : 1e-6);
    }
  });

  it("parses AIFF (16 and 24 bit, 44.1 kHz) and converts to 44 kHz", () => {
    const n = 4410;
    const left = Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 44100));
    const right = left.map((x) => -x);
    for (const bits of [16, 24] as const) {
      const file = buildAiff(left, right, 44100, bits);
      expect(sniffFormat(file)).toBe("aiff");
      const parsed = parseAiff(file);
      expect(parsed.sampleRate).toBeCloseTo(44100, 3);
      expect(parsed.channels[0].length).toBe(n);
      expect(Math.abs(parsed.channels[0][100] - left[100])).toBeLessThan(1e-3);
      expect(Math.abs(parsed.channels[1][100] + left[100])).toBeLessThan(1e-3);
      const track = toTrack(parsed, "t");
      expect(track.sampleRate).toBe(44000);
      expect(track.left.length).toBe(4400);
    }
  });

  it("resamples without changing pitch or level", () => {
    const n = 44100;
    const input = new Float32Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000));
    const out = resample(input, 48000, 44000);
    expect(out.length).toBe(Math.round((n * 44000) / 48000));
    let peak = 0;
    for (let i = 100; i < out.length - 100; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0.49);
    expect(peak).toBeLessThan(0.51);
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
    expect(crossings / (out.length / 44000)).toBeGreaterThan(995);
    expect(crossings / (out.length / 44000)).toBeLessThan(1005);
  });
});

describe("analysis", () => {
  it("measures a -20 dBFS 1 kHz sine at about -23 LUFS and flat spectrum bands", () => {
    const stats = analyze(sine(1000, 5, -20));
    expect(stats.peakDb).toBeCloseTo(-20, 1);
    expect(stats.rmsDb).toBeCloseTo(-23, 0.5);
    // Stereo sine: 1 kHz K-weighting is ~0 dB, so loudness ≈ -20 - 3.01 + ... = about -20.7 LUFS
    expect(stats.lufs).toBeGreaterThan(-24);
    expect(stats.lufs).toBeLessThan(-19);
    expect(stats.correlation).toBeCloseTo(1, 3);
  });

  it("finds the tone in the average spectrum", () => {
    const spec = averageSpectrum(sine(1000, 2, -6));
    const freqs = bandFrequencies(64);
    let best = 0;
    spec.forEach((v, i) => (v > spec[best] ? (best = i) : 0));
    expect(Math.abs(Math.log2(freqs[best] / 1000))).toBeLessThan(0.2);
  });

  it("demo beat leaves headroom and noise is decorrelated", () => {
    expect(analyze(demoBeat(1)).peakDb).toBeCloseTo(-6, 1);
    expect(Math.abs(analyze(pinkNoise(1)).correlation)).toBeLessThan(0.3);
  });
});
