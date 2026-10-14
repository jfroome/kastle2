import { analyze } from "../audio/analysis";
import type { ControlSpec } from "../core/app";
import { SAMPLE_RATE } from "../core/constants";
import type { StereoSignal } from "../engine/offline";
import type { Performance } from "../firmware/performance";
import { renderFirmware } from "../firmware/runner";
import type { BenchEnv } from "./suite";

export interface SweepPoint {
  /** 0..32767 */
  value: number;
  label: string;
  outRmsDb: number;
  outPeakDb: number;
  lufs: number;
}

/**
 * Sweeps one control across its range by cold-booting the real firmware at each position and rendering the input
 * (or a synth performance when there is none), everything else as set now.
 */
export async function runParamSweep(
  env: BenchEnv,
  control: ControlSpec,
  input: StereoSignal | null,
  base: Record<string, number>,
  steps = 17,
  onProgress?: (fraction: number) => void,
  performance?: Performance,
): Promise<SweepPoint[]> {
  const points: SweepPoint[] = [];
  const seconds = Math.min(input ? input.left.length / SAMPLE_RATE : 4, 6);
  const clip: StereoSignal | null = input
    ? {
        sampleRate: input.sampleRate,
        left: input.left.subarray(0, Math.floor(seconds * SAMPLE_RATE)),
        right: input.right.subarray(0, Math.floor(seconds * SAMPLE_RATE)),
      }
    : null;
  for (let i = 0; i < steps; i++) {
    const value = Math.round((i / (steps - 1)) * 32767);
    const board = await env.newBoard({ ...base, [control.key]: value });
    const perf = clip ? null : (performance ?? null);
    const out = await renderFirmware(board, clip, {
      frames: clip ? undefined : Math.floor(seconds * SAMPLE_RATE),
      warmupSec: 3.5,
      latencySamples: env.latencySamples,
      sampleRate: SAMPLE_RATE,
      beforeBlock: perf ? (t, b) => perf.beforeBlock(t, b) : undefined,
    });
    const stats = analyze(out);
    points.push({ value, label: control.format(value), outRmsDb: stats.rmsDb, outPeakDb: stats.peakDb, lufs: stats.lufs });
    onProgress?.((i + 1) / steps);
    await new Promise((r) => setTimeout(r, 0));
  }
  return points;
}
