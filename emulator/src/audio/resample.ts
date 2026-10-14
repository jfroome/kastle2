/** Band-limited (Blackman-windowed sinc) sample-rate conversion. Pure TS so it also runs in tests. */
export function resample(input: Float32Array, fromRate: number, toRate: number, zeroCrossings = 16): Float32Array {
  if (fromRate === toRate) {
    return input;
  }
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLength);
  const cutoff = Math.min(1, ratio); // low-pass at the lower Nyquist
  const halfWidth = zeroCrossings / cutoff;

  for (let i = 0; i < outLength; i++) {
    const center = i / ratio;
    const first = Math.max(0, Math.ceil(center - halfWidth));
    const last = Math.min(input.length - 1, Math.floor(center + halfWidth));
    let sum = 0;
    for (let n = first; n <= last; n++) {
      const x = (n - center) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = (n - center) / halfWidth;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w);
      sum += input[n] * sinc * window;
    }
    out[i] = sum * cutoff;
  }
  return out;
}
