import { SAMPLE_RATE } from "../core/constants";
import type { Track } from "./track";

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function make(name: string, seconds: number): Track {
  const n = Math.round(seconds * SAMPLE_RATE);
  return { name, sampleRate: SAMPLE_RATE, left: new Float32Array(n), right: new Float32Array(n) };
}

export function sine(freq: number, seconds: number, amplitudeDb = -12, name = `Sine ${freq} Hz`): Track {
  const t = make(name, seconds);
  const a = Math.pow(10, amplitudeDb / 20);
  for (let i = 0; i < t.left.length; i++) {
    t.left[i] = t.right[i] = a * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  }
  return t;
}

export function silence(seconds: number): Track {
  return make("Silence", seconds);
}

/** Pink-ish noise (Paul Kellet filter), stereo-decorrelated. */
export function pinkNoise(seconds: number, amplitudeDb = -18, seed = 7): Track {
  const t = make("Pink noise", seconds);
  const a = Math.pow(10, amplitudeDb / 20);
  for (const ch of [t.left, t.right]) {
    const rand = rng(seed + (ch === t.right ? 101 : 0));
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < ch.length; i++) {
      const w = rand() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      ch[i] = a * (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return t;
}

/** Logarithmic sine sweep 20 Hz .. 20 kHz */
export function sweep(seconds: number, amplitudeDb = -12): Track {
  const t = make("Sweep 20Hz-20kHz", seconds);
  const a = Math.pow(10, amplitudeDb / 20);
  const f0 = 20;
  const f1 = 20000;
  const k = Math.log(f1 / f0);
  for (let i = 0; i < t.left.length; i++) {
    const time = i / SAMPLE_RATE;
    const phase = (2 * Math.PI * f0 * seconds * (Math.exp((time / seconds) * k) - 1)) / k;
    t.left[i] = t.right[i] = a * Math.sin(phase);
  }
  return t;
}

/** Amplitude steps (-40, -20, -10, -3 dB) of a 1 kHz tone, good for watching the compressor. */
export function levelSteps(secondsPerStep = 1): Track {
  const levels = [-40, -20, -10, -3, -10, -20];
  const t = make("Level steps (1 kHz)", secondsPerStep * levels.length);
  const per = Math.round(secondsPerStep * SAMPLE_RATE);
  for (let i = 0; i < t.left.length; i++) {
    const amp = Math.pow(10, levels[Math.min(levels.length - 1, Math.floor(i / per))] / 20);
    t.left[i] = t.right[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  }
  return t;
}

/**
 * A procedural 4-bar 100 BPM beat with kick, snare, hats, bass and a stereo chord pad. It's a stand-in for a real
 * track so the emulator is useful before you load a file.
 */
export function demoBeat(bars = 4, bpm = 100): Track {
  const beat = 60 / bpm;
  const seconds = bars * 4 * beat;
  const t = make("Demo beat (procedural)", seconds);
  const n = t.left.length;
  const rand = rng(42);
  const add = (start: number, length: number, fn: (i: number, time: number) => [number, number]) => {
    const s = Math.round(start * SAMPLE_RATE);
    const l = Math.round(length * SAMPLE_RATE);
    for (let i = 0; i < l && s + i < n; i++) {
      const [a, b] = fn(i, i / SAMPLE_RATE);
      t.left[s + i] += a;
      t.right[s + i] += b;
    }
  };

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * 4 * beat;
    for (let step = 0; step < 16; step++) {
      const time = barStart + step * (beat / 4);
      if ([0, 6, 8, 11].includes(step)) {
        let phase = 0;
        add(time, 0.35, (_i, x) => {
          const freq = 45 + 110 * Math.exp(-x * 28);
          phase += (2 * Math.PI * freq) / SAMPLE_RATE;
          const v = 0.9 * Math.sin(phase) * Math.exp(-x * 7);
          return [v, v];
        });
      }
      if (step === 4 || step === 12) {
        add(time, 0.25, (_i, x) => {
          const noise = (rand() * 2 - 1) * Math.exp(-x * 18) * 0.55;
          const body = Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x * 22) * 0.45;
          return [noise + body, noise * 0.9 + body];
        });
      }
      if (step % 2 === 0) {
        const pan = step % 4 === 0 ? 0.8 : 1;
        add(time, 0.06, (_i, x) => {
          const v = (rand() * 2 - 1) * Math.exp(-x * 90) * 0.22;
          return [v * pan, v * (2 - pan)];
        });
      }
      if (step % 4 === 0) {
        const root = [55, 55, 65.4, 49][bar % 4];
        let phase = 0;
        add(time, beat * 0.9, (_i, x) => {
          phase += (2 * Math.PI * root) / SAMPLE_RATE;
          const v = (Math.tanh(2.2 * Math.sin(phase)) * 0.38 + Math.sin(phase * 2) * 0.08) * Math.exp(-x * 2.2);
          return [v, v];
        });
      }
    }
    const chord = [
      [220, 261.6, 329.6],
      [220, 261.6, 329.6],
      [174.6, 220, 261.6],
      [196, 246.9, 293.7],
    ][bar % 4];
    add(barStart, 4 * beat, (_i, x) => {
      let l = 0, r = 0;
      chord.forEach((f, idx) => {
        const detune = 1 + (idx - 1) * 0.003;
        l += Math.sin(2 * Math.PI * f * detune * x) + 0.4 * Math.sin(2 * Math.PI * f * 2 * x);
        r += Math.sin(2 * Math.PI * f / detune * x + 0.6) + 0.4 * Math.sin(2 * Math.PI * f * 2 * x + 1);
      });
      const env = Math.min(1, x * 6) * Math.min(1, (4 * beat - x) * 6);
      return [l * 0.05 * env, r * 0.05 * env];
    });
  }
  // Leave headroom like an unmastered mix (peak -6 dBFS)
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(t.left[i]), Math.abs(t.right[i]));
  const scale = Math.pow(10, -6 / 20) / Math.max(peak, 1e-9);
  for (let i = 0; i < n; i++) {
    t.left[i] *= scale;
    t.right[i] *= scale;
  }
  return t;
}

export const DEMO_SOURCES: { id: string; label: string; make: () => Track }[] = [
  { id: "beat", label: "Demo beat", make: () => demoBeat() },
  { id: "pink", label: "Pink noise", make: () => pinkNoise(8) },
  { id: "sweep", label: "Sine sweep", make: () => sweep(10) },
  { id: "steps", label: "Level steps", make: () => levelSteps(1.5) },
  { id: "sine", label: "1 kHz sine", make: () => sine(1000, 6) },
];
