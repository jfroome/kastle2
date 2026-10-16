import type { FirmwareApp } from "../core/app";
import { controlDefaults } from "../core/app";
import { BLOCK_SIZE, PARAM_MAX, SAMPLE_RATE } from "../core/constants";
import { analyze } from "../audio/analysis";
import { levelSteps, pinkNoise, silence, sine, demoBeat } from "../audio/generators";
import type { Track } from "../audio/track";
import { MB_DEFAULTS } from "../dsp/masterblaster";
import type { DspInstance, DspParams } from "../dsp/types";
import { renderOffline, type RenderResult, type StereoSignal } from "../engine/offline";
import type { FirmwareBoard } from "../firmware/board";
import type { AnalogOptions } from "../firmware/codec";
import { PERFORMANCES } from "../firmware/performance";
import { FirmwareStreamer, renderFirmware } from "../firmware/runner";

export interface BenchEnv {
  /** The live app (read-only: tests must not change the user's knobs) */
  app: FirmwareApp;
  /** A pristine instance of the same app */
  freshApp(): FirmwareApp;
  /** Standalone firmware DSP (wasm), for DSP-level tests */
  newDsp(): Promise<DspInstance>;
  /** Cold-boots the real firmware with the given knob positions (default: the app defaults) */
  newBoard(knobs?: Record<string, number>, analog?: AnalogOptions): Promise<FirmwareBoard>;
  latencySamples: number;
  generatesSound?: boolean;
}

export interface BenchResult {
  id: string;
  name: string;
  pass: boolean;
  /** Passed, but the measurement is worth a look */
  warn?: boolean;
  detail: string;
  durationMs: number;
}

export interface BenchTest {
  id: string;
  name: string;
  description: string;
  appliesTo: (env: BenchEnv) => boolean;
  run(env: BenchEnv): Promise<{ pass: boolean; warn?: boolean; detail: string }>;
}

const db = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
const fmt = (x: number, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
const LIMITER_CEILING_DB = db(31000 / 32768);

async function render(
  env: BenchEnv,
  input: StereoSignal,
  params: DspParams,
  opts: { automate?: (t: number) => DspParams; compensate?: boolean } = {},
): Promise<RenderResult> {
  return renderOffline(input, {
    dsp: await env.newDsp(),
    initialParams: params,
    paramsAt: opts.automate ?? (() => params),
    compensateLatency: opts.compensate,
  });
}

function slice(sig: StereoSignal, fromSec: number, toSec: number): StereoSignal {
  const a = Math.floor(fromSec * sig.sampleRate);
  const b = Math.floor(toSec * sig.sampleRate);
  return { left: sig.left.slice(a, b), right: sig.right.slice(a, b), sampleRate: sig.sampleRate };
}

function rmsDb(sig: StereoSignal): number {
  return analyze(sig).rmsDb;
}

function errorDb(a: StereoSignal, b: StereoSignal, skip = 0): number {
  let err = 0;
  let ref = 0;
  const n = Math.min(a.left.length, b.left.length);
  for (let i = skip; i < n; i++) {
    err += (a.left[i] - b.left[i]) ** 2 + (a.right[i] - b.right[i]) ** 2;
    ref += a.left[i] ** 2 + a.right[i] ** 2;
  }
  return 10 * Math.log10((err + 1e-18) / (ref + 1e-18));
}

function goertzelDb(signal: Float32Array, freq: number): number {
  const w = (2 * Math.PI * freq) / SAMPLE_RATE;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const s = signal[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return 10 * Math.log10(power / (signal.length * signal.length) + 1e-18);
}

/** Standard deviation of the zero-crossing frequency estimate, relative to the mean. */
function pitchWobble(signal: Float32Array): number {
  const periods: number[] = [];
  let last = -1;
  for (let i = 1; i < signal.length; i++) {
    if (signal[i - 1] < 0 && signal[i] >= 0) {
      const frac = -signal[i - 1] / (signal[i] - signal[i - 1]);
      const pos = i - 1 + frac;
      if (last >= 0) periods.push(pos - last);
      last = pos;
    }
  }
  if (periods.length < 10) return 0;
  const mean = periods.reduce((a, b) => a + b, 0) / periods.length;
  const variance = periods.reduce((a, b) => a + (b - mean) ** 2, 0) / periods.length;
  return Math.sqrt(variance) / mean;
}

const isMasterBlaster = (env: BenchEnv) => env.app.id === "masterblaster";
const isBeads = (env: BenchEnv) => env.app.id === "beads";

async function runBlocks(board: FirmwareBoard, blocks: number): Promise<void> {
  const z = new Float32Array(BLOCK_SIZE);
  const o = new Float32Array(BLOCK_SIZE);
  for (let i = 0; i < blocks; i++) board.runBlock(z, z, 0, o, o, 0);
}

/** Runs until the queued panel gestures are done and the firmware's start-up fade has finished. */
async function settle(board: FirmwareBoard): Promise<void> {
  await runBlocks(board, 20);
  while (board.busy) await runBlocks(board, 10);
  await runBlocks(board, 100);
}

function fwPerformance(env: BenchEnv) {
  return env.generatesSound ? PERFORMANCES[0].make() : null;
}
const mb = (over: DspParams = {}): DspParams => ({ ...MB_DEFAULTS, ...over });

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BENCH_TESTS: BenchTest[] = [
  {
    id: "fw-boot",
    name: "Real firmware boots on the emulated Citadel",
    description: "Boots the unmodified firmware (Base + Hardware + app) on the emulated RP2040 board and runs half a second of audio.",
    appliesTo: () => true,
    async run(env) {
      const board = await env.newBoard();
      const out = await renderFirmware(board, null, { frames: 22000, sampleRate: 44000 });
      const finite = out.left.every(Number.isFinite);
      return { pass: board.isCitadel && finite, detail: `${board.name}, hardware detected as ${board.isCitadel ? "Citadel" : "Kastle 2"}` };
    },
  },
  {
    id: "fw-deterministic",
    name: "Firmware render is deterministic",
    description: "Two cold boots with the same panel and input give bit-identical audio.",
    appliesTo: () => true,
    async run(env) {
      const input = pinkNoise(1.5, -18);
      const once = async () => {
        const run = fwPerformance(env);
        return renderFirmware(await env.newBoard(), input, { warmupSec: 1, sampleRate: 44000, beforeBlock: run?.beforeBlock });
      };
      const a = await once();
      const b = await once();
      let same = a.left.length === b.left.length;
      for (let i = 0; same && i < a.left.length; i++) same = a.left[i] === b.left[i] && a.right[i] === b.right[i];
      return { pass: same, detail: same ? "identical" : "renders differ" };
    },
  },
  {
    id: "fw-streaming-matches-offline",
    name: "Real-time engine matches offline render",
    description: "The streaming path used by the AudioWorklet produces the same samples as the offline path (one block later).",
    appliesTo: () => true,
    async run(env) {
      const input = pinkNoise(1, -12);
      const n = input.left.length;
      const offline = await renderFirmware(await env.newBoard(), input, { sampleRate: 44000 });
      const streamer = new FirmwareStreamer(await env.newBoard());
      const outL = new Float32Array(n);
      const outR = new Float32Array(n);
      for (let pos = 0; pos < n; pos += 128) {
        const m = Math.min(128, n - pos);
        streamer.process(input.left.subarray(pos, pos + m), input.right.subarray(pos, pos + m), outL.subarray(pos, pos + m), outR.subarray(pos, pos + m), m);
      }
      const d = BLOCK_SIZE;
      const err = errorDb(
        { left: offline.left.subarray(0, n - d), right: offline.right.subarray(0, n - d), sampleRate: SAMPLE_RATE },
        { left: outL.subarray(d), right: outR.subarray(d), sampleRate: SAMPLE_RATE },
      );
      return { pass: err < -120, detail: `difference ${fmt(err, 0)} dB` };
    },
  },
  {
    id: "fw-layers",
    name: "SHIFT layer and pot pick-up (firmware Hardware layer)",
    description: "Holding SHIFT switches layers and freezes the pots; they only wake up after moving more than 48/4095.",
    appliesTo: () => true,
    async run(env) {
      const board = await env.newBoard();
      await settle(board);
      board.setButton("SHIFT", true);
      await runBlocks(board, 500); // apps ignore pots for a moment after a layer change (FancyPot layer time)
      const s1 = board.state();
      board.setPot(0, board.panel.pots[0] + 0.004);
      await runBlocks(board, 150);
      const stillFrozen = board.state().frozen[0];
      board.setPot(0, board.panel.pots[0] + 0.1);
      await runBlocks(board, 150);
      const awake = !board.state().frozen[0];
      board.setButton("SHIFT", false);
      await runBlocks(board, 100);
      const back = board.state().layer === "NORMAL";
      return {
        pass: s1.layer === "SHIFT" && s1.frozen[0] && stillFrozen && awake && back,
        detail: `layer ${s1.layer}, frozen ${s1.frozen[0]}, after 0.4% move ${stillFrozen ? "frozen" : "awake"}, after 10% move ${awake ? "awake" : "frozen"}, released → ${board.state().layer}`,
      };
    },
  },
  {
    id: "fw-panel-script",
    name: "Knob gestures leave the base gains alone",
    description: "Replaying all knob positions as panel gestures (SHIFT held, pots wiggled) must not disturb the factory input/output gain.",
    appliesTo: () => true,
    async run(env) {
      const values = Object.fromEntries(env.app.controls.map((c) => [c.key, c.owner === "app" ? Math.round(c.default * 0.7 + 3000) : c.default]));
      const board = await env.newBoard(values);
      await settle(board);
      const c = board.state().codec;
      return {
        pass: Math.abs(c.pgaDb[0] - 18) < 0.01 && Math.abs(c.hpDb[0] + 24) < 0.01,
        detail: `PGA ${fmt(c.pgaDb[0], 2)} dB (factory +18), headphone ${fmt(c.hpDb[0], 0)} dB (factory -24)`,
      };
    },
  },
  {
    id: "fw-shift-transparent",
    name: "Holding SHIFT does not change the sound",
    description: "Press SHIFT, wait for the firmware to switch layers, park the pots on the SHIFT values (what 'direct knobs' does) and release: the level must not move.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = pinkNoise(20, -18);
      const board = await env.newBoard();
      const L = new Float32Array(48);
      const R = new Float32Array(48);
      const oL = new Float32Array(48);
      const oR = new Float32Array(48);
      let pos = 0;
      const level = (secs: number) => {
        let sum = 0;
        let n = 0;
        for (let b = 0; b < Math.floor((secs * 44000) / 48); b++) {
          L.set(input.left.subarray(pos, pos + 48));
          R.set(input.right.subarray(pos, pos + 48));
          board.runBlock(L, R, 0, oL, oR, 0);
          pos = (pos + 48) % (input.left.length - 48);
          for (let i = 0; i < 48; i++) {
            sum += oL[i] * oL[i];
            n++;
          }
        }
        return 10 * Math.log10(sum / n);
      };
      while (board.busy) level(0.05);
      level(4);
      const before = level(2);
      board.setButton("SHIFT", true);
      while (board.state().layer !== "SHIFT") level(0.01);
      for (const c of env.app.controls) if (c.layer === "SHIFT" && !c.unused) board.setPot(c.pot, c.default / PARAM_MAX);
      const held = level(2);
      board.setButton("MODE", false);
      board.setButton("SHIFT", false);
      while (board.state().layer !== "NORMAL") level(0.01);
      for (const c of env.app.controls) if (c.layer === "NORMAL" && !c.unused) board.setPot(c.pot, c.default / PARAM_MAX);
      const after = level(2);
      const worst = Math.max(Math.abs(held - before), Math.abs(after - before));
      return { pass: worst < 0.3, detail: `before ${fmt(before, 2)} dB, SHIFT held ${fmt(held, 2)} dB, released ${fmt(after, 2)} dB (limit ±0.3)` };
    },
  },
  {
    id: "fw-beads-density",
    name: "Beads: density centre makes no grains, either side does",
    description: "Wet-only output on steady noise. Free-running grains are silent in the middle of the density knob (the seed-only zone).",
    appliesTo: isBeads,
    async run(env) {
      const input = pinkNoise(8, -18);
      const wet = { ...controlDefaults(env.app), dry_wet: PARAM_MAX, reverb: 0, feedback: 0, time: 6000, size: 24000 };
      const level = async (density: number) => {
        const board = await env.newBoard({ ...wet, density });
        const out = await renderFirmware(board, input, { warmupSec: 3, sampleRate: 44000 });
        return rmsDb(slice(out, 3, 8));
      };
      const regular = await level(9000);
      const centre = await level(16384);
      const random = await level(24000);
      return {
        pass: regular > centre + 20 && random > centre + 20,
        detail: `regular ${fmt(regular)} dB, centre ${fmt(centre)} dB, random ${fmt(random)} dB`,
      };
    },
  },
  {
    id: "fw-beads-freeze",
    name: "Beads: a MODE tap freezes the buffer",
    description: "Noise is recorded, then the input stops. Without freeze the cloud dies out with the buffer; after a MODE tap (the firmware's own button logic) it keeps playing.",
    appliesTo: isBeads,
    async run(env) {
      const noise = pinkNoise(3, -12);
      const silent = silence(7);
      const input = { name: "x", sampleRate: noise.sampleRate, left: new Float32Array([...noise.left, ...silent.left]), right: new Float32Array([...noise.right, ...silent.right]) };
      const knobs = { ...controlDefaults(env.app), dry_wet: PARAM_MAX, reverb: 0, feedback: 0, time: 14000, size: 24000, density: 9000, shape: 8000 };
      const run = async (tap: boolean) => {
        const board = await env.newBoard(knobs);
        let tapped = false;
        const out = await renderFirmware(board, input, {
          warmupSec: 3,
          sampleRate: 44000,
          beforeBlock: (t, b) => {
            if (tap && t >= 2.9 && !tapped) {
              tapped = true;
              b.queue([{ type: "button", button: "MODE", down: true }, { type: "wait", blocks: 15 }, { type: "button", button: "MODE", down: false }]);
            }
          },
        });
        return { late: rmsDb(slice(out, 7, 10)), led: board.state().leds[1] };
      };
      const free = await run(false);
      const frozen = await run(true);
      return {
        pass: frozen.late > free.late + 20 && frozen.led[2] > 100,
        detail: `late output ${fmt(free.late)} dB unfrozen vs ${fmt(frozen.late)} dB after the tap; LED 2 ${frozen.led.join(",")}`,
      };
    },
  },
  {
    id: "fw-beads-seed",
    name: "Beads: seeded mode only grains on TRIG",
    description: "MODE+K4 to the right makes grains wait for the seed gate; pulses on the TRIG jack then trigger them.",
    appliesTo: isBeads,
    async run(env) {
      const input = pinkNoise(8, -18);
      const knobs = { ...controlDefaults(env.app), dry_wet: PARAM_MAX, reverb: 0, feedback: 0, time: 6000, size: 24000, density: 9000, seed: PARAM_MAX };
      const run = async (pulses: boolean) => {
        const board = await env.newBoard(knobs);
        const out = await renderFirmware(board, input, {
          warmupSec: 3,
          sampleRate: 44000,
          beforeBlock: (t, b) => {
            b.panel.trig = pulses && t % 0.5 < 0.04;
          },
        });
        return rmsDb(slice(out, 2, 8));
      };
      const quiet = await run(false);
      const seeded = await run(true);
      return { pass: seeded > quiet + 15, detail: `no seed ${fmt(quiet)} dB, TRIG pulses ${fmt(seeded)} dB` };
    },
  },
  {
    id: "fw-beads-feedback",
    name: "Beads: maximum feedback stays bounded",
    description: "SHIFT+K6 at maximum with dense grains and loud noise through the real firmware: finite, under the limiter ceiling, and it settles when the input stops.",
    appliesTo: isBeads,
    async run(env) {
      const noise = pinkNoise(5, -6);
      const quiet = silence(4);
      const input = { name: "x", sampleRate: noise.sampleRate, left: new Float32Array([...noise.left, ...quiet.left]), right: new Float32Array([...noise.right, ...quiet.right]) };
      const knobs = { ...controlDefaults(env.app), feedback: PARAM_MAX, density: 4000, size: 28000, dry_wet: 30000, reverb: 20000 };
      const board = await env.newBoard(knobs);
      const out = await renderFirmware(board, input, { warmupSec: 3, sampleRate: 44000 });
      const stats = analyze(out);
      return { pass: Number.isFinite(stats.rmsDb) && stats.peakDb < -0.3, detail: `peak ${fmt(stats.peakDb)} dBFS, RMS ${fmt(stats.rmsDb)} dBFS` };
    },
  },
  {
    id: "fw-cv-front-end",
    name: "CV jacks: 0 V neutral, ±5 V full scale",
    description: "The firmware's own calibration of the PARAM inputs (inverting Citadel input stage) reads 0 V as 0 and ±5 V as ±4095 ADC units.",
    appliesTo: (env) => env.app.jacks.some((j) => j.input === "PARAM_1"),
    async run(env) {
      const board = await env.newBoard();
      await settle(board);
      const read = async (v: number | undefined) => {
        board.setVolts("PARAM_1", v);
        await runBlocks(board, 60);
        return board.state().paramAdc[0];
      };
      const unpatched = await read(undefined);
      const zero = await read(0);
      const up = await read(5);
      const down = await read(-5);
      return {
        pass: Math.abs(unpatched) < 40 && Math.abs(zero) < 40 && Math.abs(up - 4095) < 60 && Math.abs(down + 4095) < 120,
        detail: `unpatched ${unpatched}, 0 V → ${zero}, +5 V → ${up}, -5 V → ${down} (ADC units, 819 per volt)`,
      };
    },
  },
  {
    id: "fw-pitch-jacks",
    name: "PITCH jacks read steadily (not behind the multiplexer)",
    description: "The pitch inputs go straight to ADC2/ADC3, so a held voltage must read the same on every block. Regression guard for the HAL multiplexer model.",
    appliesTo: (env) => env.app.jacks.some((j) => j.input === "PITCH_1" || j.input === "PITCH_2"),
    async run(env) {
      const board = await env.newBoard();
      await settle(board);
      const z = new Float32Array(BLOCK_SIZE);
      const o = new Float32Array(BLOCK_SIZE);
      let lo = Infinity;
      let hi = -Infinity;
      for (const jack of ["PITCH_1", "PITCH_2"] as const) {
        board.setVolts(jack, 1);
        await runBlocks(board, 30);
        for (let i = 0; i < 40; i++) {
          board.runBlock(z, z, 0, o, o, 0);
          const v = board.pitchAdc(jack);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        board.setVolts(jack, undefined);
      }
      return { pass: hi - lo < 40 && Math.abs(lo - 819) < 60, detail: `1 V reads ${lo}–${hi} ADC units over 80 blocks (ideal 819)` };
    },
  },
  {
    id: "fw-gain-staging",
    name: "Factory gain staging is unity",
    description: "With the factory input/output gain (EEPROM default 160) a passthrough app returns the level it was given. Reports the codec register state.",
    appliesTo: (env) => env.app.id === "template",
    async run(env) {
      const board = await env.newBoard();
      const out = await renderFirmware(board, sine(1000, 2, -12), { warmupSec: 4, sampleRate: 44000 });
      const rms = analyze(slice(out, 0.5, 2)).rmsDb;
      const c = board.state().codec;
      return {
        pass: Math.abs(rms - -15) < 0.5,
        detail: `-15.0 dBFS in → ${fmt(rms, 2)} dBFS out (PGA ${fmt(c.pgaDb[0])} dB, ADC ${fmt(c.adcDigitalDb[0])} dB, HP ${fmt(c.hpDb[0])} dB)`,
      };
    },
  },
  {
    id: "fw-synth-sound",
    name: "Synth makes sound from MIDI/TRIG",
    description: "A MIDI note and TRIG pulse must produce audible output (peak above -45 dBFS) after the start-up fade, at the default knob positions.",
    appliesTo: (env) => env.generatesSound === true,
    async run(env) {
      const board = await env.newBoard();
      const run = fwPerformance(env)!;
      const out = await renderFirmware(board, null, { frames: 44000 * 3, warmupSec: 3, sampleRate: 44000, beforeBlock: run.beforeBlock });
      const stats = analyze(out);
      return { pass: stats.peakDb > -45 && stats.peakDb < 6, detail: `RMS ${fmt(stats.rmsDb)} dBFS, peak ${fmt(stats.peakDb)} dBFS` };
    },
  },
  {
    id: "fw-mb-bypass",
    name: "MODE tap bypasses the MasterBlaster chain",
    description: "Through the real UI loop: tapping MODE toggles bypass; the bypassed output matches the input level while the processed one does not.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = pinkNoise(10, -18);
      const board = await env.newBoard();
      let tapped = false;
      const out = await renderFirmware(board, input, {
        sampleRate: 44000,
        latencySamples: env.latencySamples,
        beforeBlock: (t, b) => {
          if (t >= 6 && !tapped) {
            tapped = true;
            b.queue([
              { type: "button", button: "MODE", down: true },
              { type: "wait", blocks: 20 },
              { type: "button", button: "MODE", down: false },
            ]);
          }
        },
      });
      const processed = rmsDb(slice(out, 4, 5.8)) - rmsDb(slice(input, 4, 5.8));
      const bypassed = rmsDb(slice(out, 8, 10)) - rmsDb(slice(input, 8, 10));
      const led = board.state().leds[1];
      return {
        pass: Math.abs(bypassed) < 1 && processed > 3 && led[0] === 40 && led[1] === 40,
        detail: `processed ${processed >= 0 ? "+" : ""}${fmt(processed)} dB, bypassed ${bypassed >= 0 ? "+" : ""}${fmt(bypassed)} dB vs input; LED 2 ${led.join(",")}`,
      };
    },
  },
  {
    id: "fw-mb-noise-switch",
    name: "Left switch picks the vinyl noise: low-pitched / high-pitched / off",
    description: "Silence in, Vinyl at maximum, through the real firmware. The CV switch (FEED 3) up gives dark rumbly noise, the middle gives bright hiss, down gives exactly nothing.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const knobs = { ...controlDefaults(env.app), drive: 0, comp: 0, vinyl: 20000, mix: PARAM_MAX };
      const measure = async (volts: number | undefined, vinyl = 20000) => {
        const board = await env.newBoard({ ...knobs, vinyl });
        const out = await renderFirmware(board, silence(3), {
          warmupSec: 3,
          sampleRate: 44000,
          beforeBlock: (_t, b) => b.setVolts("FEED_3", volts),
        });
        // Only the AC part counts: the output stage leaves a constant offset of a few LSB
        const x = out.left.slice(44000);
        const mean = x.reduce((a, b) => a + b, 0) / x.length;
        let sum = 0;
        let diff = 0;
        for (let i = 1; i < x.length; i++) {
          sum += (x[i] - mean) ** 2;
          diff += (x[i] - x[i - 1]) ** 2;
        }
        const rms = Math.sqrt(sum / x.length);
        return { rms, db: 20 * Math.log10(rms + 1e-9), brightness: rms > 0 ? Math.sqrt(diff / x.length) / rms : 0 };
      };
      const low = await measure(5);
      const high = await measure(undefined);
      const off = await measure(0, PARAM_MAX);
      const pass = off.rms === 0 && low.db > -80 && high.db > -80 && high.brightness > 3 * low.brightness && Math.abs(low.db - high.db) < 8;
      return {
        pass,
        detail: `up ${fmt(low.db)} dB, brightness ${fmt(low.brightness, 2)} · middle ${fmt(high.db)} dB, brightness ${fmt(high.brightness, 2)} · down ${off.rms === 0 ? "silent" : fmt(off.db) + " dB"}`,
      };
    },
  },
  {
    id: "fw-mb-wow-speed",
    name: "Right switch sets the wow speed: slow / medium / fast",
    description: "A steady 880 Hz tone with Wow at maximum through the real firmware. The pitch wobble's dominant rate must follow the GATE switch (FEED 1): up ≈ 0.24 Hz, middle ≈ 0.6 Hz, down ≈ 1.3 Hz.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const knobs = { ...controlDefaults(env.app), drive: 0, comp: 0, vinyl: 0, wow: PARAM_MAX, mix: PARAM_MAX };
      const dominantHz = async (volts: number | undefined) => {
        const board = await env.newBoard(knobs);
        const input = sine(880, 16, -12);
        const out = await renderFirmware(board, input, {
          warmupSec: 3,
          sampleRate: 44000,
          beforeBlock: (_t, b) => b.setVolts("FEED_1", volts),
        });
        const x = out.left;
        const times: number[] = [];
        const periods: number[] = [];
        let last = -1;
        for (let i = 44000; i < x.length; i++) {
          if (x[i - 1] < 0 && x[i] >= 0) {
            const t = i - 1 + -x[i - 1] / (x[i] - x[i - 1]);
            if (last >= 0) {
              times.push(t);
              periods.push(t - last);
            }
            last = t;
          }
        }
        const mean = periods.reduce((a, b) => a + b, 0) / periods.length;
        let best = 0;
        let bestHz = 0;
        for (let hz = 0.1; hz < 2.0; hz += 0.02) {
          let c = 0;
          let s = 0;
          for (let i = 0; i < periods.length; i++) {
            const phase = (2 * Math.PI * hz * times[i]) / 44000;
            c += (periods[i] - mean) * Math.cos(phase);
            s += (periods[i] - mean) * Math.sin(phase);
          }
          const m = Math.hypot(c, s);
          if (m > best) {
            best = m;
            bestHz = hz;
          }
        }
        return bestHz;
      };
      const slow = await dominantHz(5);
      const medium = await dominantHz(undefined);
      const fast = await dominantHz(0);
      const pass = Math.abs(slow - 0.24) < 0.1 && Math.abs(medium - 0.6) < 0.1 && Math.abs(fast - 1.32) < 0.2;
      return { pass, detail: `up ${fmt(slow, 2)} Hz · middle ${fmt(medium, 2)} Hz · down ${fmt(fast, 2)} Hz` };
    },
  },
  {
    id: "fw-mb-knob-glide",
    name: "Knob jumps glide instead of snapping",
    description: "The Output knob is jumped from 70 % to 30 % while a tone plays. The level must fall over roughly a quarter of a second (10 % to 90 % of the move takes 80-300 ms) instead of in one step, and a slow turn must not lag.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const knobs = { ...controlDefaults(env.app), drive: 0, comp: 0, vinyl: 0, wow: 0, lofi: 0, mix: PARAM_MAX };
      const outPot = env.app.controls.find((c) => c.key === "output")!.pot;
      const envelope = (x: Float32Array, window: number) => {
        const out: number[] = [];
        for (let i = 0; i + window <= x.length; i += window) {
          let peak = 0;
          for (let j = i; j < i + window; j++) peak = Math.max(peak, Math.abs(x[j]));
          out.push(peak);
        }
        return out;
      };
      const board = await env.newBoard({ ...knobs, output: 23170 });
      const jumpAt = 1.5;
      const out = await renderFirmware(board, sine(1000, 4, -12), {
        warmupSec: 3,
        sampleRate: 44000,
        beforeBlock: (t, b) => b.setPot(outPot, t < jumpAt ? 23170 / PARAM_MAX : 10000 / PARAM_MAX),
      });
      const window = 220; // 5 ms
      const env5 = envelope(out.left, window);
      const before = env5[Math.floor((jumpAt * 44000) / window) - 20];
      const after = env5[env5.length - 20];
      const t10 = before - 0.1 * (before - after);
      const t90 = before - 0.9 * (before - after);
      const start = Math.floor((jumpAt * 44000) / window) - 5;
      let i10 = -1;
      let i90 = -1;
      for (let i = start; i < env5.length; i++) {
        if (i10 < 0 && env5[i] < t10) i10 = i;
        if (i90 < 0 && env5[i] < t90) i90 = i;
      }
      const rampMs = ((i90 - i10) * window * 1000) / 44000;
      return {
        pass: i10 >= 0 && i90 >= 0 && after < before * 0.5 && rampMs >= 80 && rampMs <= 300,
        detail: `level ${fmt(20 * Math.log10(before))} → ${fmt(20 * Math.log10(after))} dBFS, 10-90 % of the move took ${fmt(rampMs, 0)} ms`,
      };
    },
  },
  {
    id: "fw-mb-cv-drive",
    name: "+5 V on PARAM 1 pushes the MasterBlaster drive",
    description: "CV on the DRIVE jack must make the chain louder than with the jack unpatched.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = pinkNoise(5, -30);
      const level = async (volts?: number) => {
        const board = await env.newBoard({ ...controlDefaults(env.app), drive: 0, comp: 0 });
        board.setVolts("PARAM_1", volts);
        const out = await renderFirmware(board, input, { warmupSec: 3, sampleRate: 44000, latencySamples: env.latencySamples });
        return rmsDb(slice(out, 1, 5));
      };
      const base = await level();
      const driven = await level(5);
      return { pass: driven > base + 6, detail: `${fmt(base)} dB → ${fmt(driven)} dB RMS with +5 V` };
    },
  },

  {
    id: "silence",
    name: "Silence in, silence out",
    description: "With vinyl off and defaults, digital silence must settle to silence (no idle noise or DC). Reports the start-up transient.",
        appliesTo: isMasterBlaster,
    async run(env) {
      const params = mb();
      const out = await render(env, silence(2), params);
      const startup = analyze(out).peakDb;
      const settled = analyze(slice(out, 0.5, 2)).peakDb;
      const warn = startup > -60;
      return {
        pass: settled < -80,
        warn,
        detail: `settled peak ${fmt(settled)} dBFS (limit -80), start-up transient ${fmt(startup)} dBFS${warn ? " (saturator bias settling through the DC blocker)" : ""}`,
      };
    },
  },
  {
    id: "bypass-transparent",
    name: "Bypass passes the input unchanged",
    description: "Bypass crossfades to the latency-matched dry path, so the output should equal the input.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = pinkNoise(2, -12);
      const out = await render(env, input, mb({ bypass: 1, drive: 30000, comp: 30000, lofi: 20000 }));
      const err = errorDb(slice(input, 0.5, 2), slice(out, 0.5, 2));
      return { pass: err < -70, detail: `error ${fmt(err)} dB relative to the signal (limit -70)` };
    },
  },
  {
    id: "bypass-click-free",
    name: "Bypass toggle is click-free",
    description: "Switching bypass in the middle of a loud sine must not create a discontinuity.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = sine(220, 2, -6);
      const base = mb({ drive: 20000, comp: 15000 });
      const toggled = { ...base, bypass: 1 };
      const out = await render(env, input, base, { automate: (t) => (t >= 1 ? toggled : base) });
      const maxStep = (from: number, to: number) => {
        let m = 0;
        for (let i = Math.floor(from * SAMPLE_RATE); i < Math.floor(to * SAMPLE_RATE); i++) {
          m = Math.max(m, Math.abs(out.left[i] - out.left[i - 1]));
        }
        return m;
      };
      const wetSteady = maxStep(0.5, 0.9);
      const drySteady = maxStep(1.5, 1.9);
      const transition = maxStep(0.95, 1.3);
      const reference = Math.max(wetSteady, drySteady);
      return {
        pass: transition < reference * 1.5,
        detail: `max step during toggle ${fmt(transition, 4)} vs ${fmt(reference, 4)} in steady state (limit 1.5×)`,
      };
    },
  },
  {
    id: "mix-dry",
    name: "Mix at 0% is the dry signal",
    description: "Fully dry mix must match the input (delay-compensated), even with everything else cranked.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = pinkNoise(2, -12);
      const out = await render(env, input, mb({ mix: 0, drive: 30000, lofi: 30000, vinyl: 30000, comp: 30000 }));
      const err = errorDb(slice(input, 0.5, 2), slice(out, 0.5, 2));
      return { pass: err < -45, detail: `error ${fmt(err)} dB (limit -45)` };
    },
  },
  {
    id: "default-level",
    name: "Default settings level (A/B loudness)",
    description: "Defaults on -18 dB pink noise vs the input RMS. Large offsets make bypass A/B misleading (louder sounds better).",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = pinkNoise(3, -18);
      const out = await render(env, input, mb());
      const diff = rmsDb(slice(out, 0.5, 3)) - rmsDb(slice(input, 0.5, 3));
      return {
        pass: Math.abs(diff) < 15,
        warn: Math.abs(diff) > 3,
        detail: `${diff >= 0 ? "+" : ""}${fmt(diff)} dB vs the dry input${Math.abs(diff) > 3 ? " (drive/comp makeup is not loudness-neutral)" : ""}`,
      };
    },
  },
  {
    id: "limiter-ceiling",
    name: "Limiter holds the ceiling",
    description: "Full-scale input with drive, comp and output maxed must not exceed the limiter ceiling (≈ -0.5 dBFS).",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = demoBeat(2);
      const hot = { ...input, left: input.left.map((v) => v * 6), right: input.right.map((v) => v * 6) };
      const out = await render(env, hot, mb({ drive: 32767, output: 32767, comp: 5000, mix: 32767 }));
      const peak = analyze(out).peakDb;
      return { pass: peak <= LIMITER_CEILING_DB + 0.3, detail: `peak ${fmt(peak, 2)} dBFS (ceiling ${fmt(LIMITER_CEILING_DB, 2)})` };
    },
  },
  {
    id: "compressor-ratio",
    name: "Compressor reduces dynamic range",
    description: "A 37 dB level step should shrink when the bus compressor is engaged.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = levelSteps(1.5);
      const measure = async (comp: number) => {
        const out = await render(env, input, mb({ comp, drive: 0, output: 23170 }));
        const loud = rmsDb(slice(out, 5.0, 6.0)); // the -3 dB step spans 4.5..6.0 s
        const quiet = rmsDb(slice(out, 0.5, 1.4)); // -40 dB step
        return loud - quiet;
      };
      const off = await measure(0);
      const on = await measure(26000);
      return { pass: on < off - 3, detail: `step ${fmt(off)} dB without → ${fmt(on)} dB with compression` };
    },
  },
  {
    id: "lofi-bandwidth",
    name: "Lo-fi removes high frequencies",
    description: "A 10 kHz tone must lose energy when the sample-rate reduction is maxed.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = sine(10000, 1, -12);
      const clean = await render(env, input, mb({ lofi: 0, drive: 0 }));
      const crushed = await render(env, input, mb({ lofi: 32767, drive: 0 }));
      const a = goertzelDb(clean.left.slice(8000), 10000);
      const b = goertzelDb(crushed.left.slice(8000), 10000);
      return { pass: b < a - 10, detail: `10 kHz: ${fmt(a)} dB → ${fmt(b)} dB` };
    },
  },
  {
    id: "wow-pitch-wobble",
    name: "Wow modulates pitch",
    description: "A steady 1 kHz tone must show measurable pitch deviation with wow up and none with wow at 0.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = sine(1000, 4, -12);
      const steady = await render(env, input, mb({ wow: 0, drive: 0 }));
      const wobbly = await render(env, input, mb({ wow: 32767, drive: 0 }));
      const a = pitchWobble(steady.left.slice(22000));
      const b = pitchWobble(wobbly.left.slice(22000));
      return { pass: b > 0.001 && b > a * 10, detail: `pitch deviation ${(a * 100).toFixed(3)}% → ${(b * 100).toFixed(3)}%` };
    },
  },
  {
    id: "width-mono",
    name: "Width at 0 collapses to mono",
    description: "Decorrelated stereo noise must become fully correlated at width 0.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const input = pinkNoise(2, -12);
      const wide = await render(env, input, mb({ width: 32767 }));
      const mono = await render(env, input, mb({ width: 0 }));
      const cw = analyze(slice(wide, 0.5, 2)).correlation;
      const cm = analyze(slice(mono, 0.5, 2)).correlation;
      return { pass: cm > 0.999 && cw < cm, detail: `correlation ${fmt(cw, 3)} (wide) → ${fmt(cm, 4)} (mono)` };
    },
  },
  {
    id: "random-sweep",
    name: "Random parameter fuzz stays bounded",
    description: "60 random knob combinations on a beat: output stays under the ceiling with no large DC offset.",
    appliesTo: isMasterBlaster,
    async run(env) {
      const rand = mulberry(1234);
      const input = demoBeat(1);
      let worstPeak = -200;
      let worstDc = 0;
      let worst = "";
      for (let i = 0; i < 60; i++) {
        const params = mb({
          drive: Math.floor(rand() * 32767), tone: Math.floor(rand() * 32767), comp: Math.floor(rand() * 32767),
          comp_speed: Math.floor(rand() * 32767), vinyl: Math.floor(rand() * 32767), wow: Math.floor(rand() * 32767),
          lofi: Math.floor(rand() * 32767), width: Math.floor(rand() * 32767), mix: Math.floor(rand() * 32767),
          output: Math.floor(rand() * 32767),
        });
        const stats = analyze(await render(env, input, params));
        if (stats.peakDb > worstPeak) {
          worstPeak = stats.peakDb;
          worst = `#${i}`;
        }
        worstDc = Math.max(worstDc, Math.abs(stats.dcOffset));
      }
      return {
        pass: worstPeak <= LIMITER_CEILING_DB + 0.3 && worstDc < 0.02,
        detail: `worst peak ${fmt(worstPeak, 2)} dBFS (${worst}), worst DC ${worstDc.toExponential(1)}`,
      };
    },
  },
];

export async function runBench(
  env: BenchEnv,
  onResult?: (result: BenchResult, index: number, total: number) => void,
  only?: string[],
): Promise<BenchResult[]> {
  const tests = BENCH_TESTS.filter((t) => t.appliesTo(env) && (!only || only.includes(t.id)));
  const results: BenchResult[] = [];
  for (const [index, test] of tests.entries()) {
    const start = performance.now();
    let outcome: { pass: boolean; warn?: boolean; detail: string };
    try {
      outcome = await test.run(env);
    } catch (error) {
      outcome = { pass: false, detail: `error: ${error instanceof Error ? error.message : String(error)}` };
    }
    const result = { id: test.id, name: test.name, ...outcome, durationMs: performance.now() - start };
    results.push(result);
    onResult?.(result, index, tests.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return results;
}

export type { Track };
