import { BLOCK_SIZE, SAMPLE_RATE } from "../core/constants";
import type { DspInstance, DspParams } from "../dsp/types";
import { BlockRunner } from "./runner";

export interface StereoSignal {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export interface RenderOptions {
  dsp: DspInstance;
  /** Parameters to use for the block starting at `timeSec`. Return the same object to avoid redundant updates. */
  paramsAt: (timeSec: number) => DspParams;
  initialParams?: DspParams;
  inputGain?: number;
  outputGain?: number;
  /** Delay-compensate so the output lines up with the input (adds `latencySamples` of silence to the end of the input) */
  compensateLatency?: boolean;
  onProgress?: (fraction: number) => void;
}

export interface RenderResult extends StereoSignal {
  /** Per block: lowest compressor gain (0..1, 1 = none) and limiter gain */
  compGain: Float32Array;
  limiterGain: Float32Array;
  blockSize: number;
}

/** Renders a whole signal through a firmware DSP, deterministic and faster than real time. */
export async function renderOffline(input: StereoSignal, opts: RenderOptions): Promise<RenderResult> {
  const { dsp } = opts;
  const latency = opts.compensateLatency === false ? 0 : dsp.latencySamples;
  const total = input.left.length + latency;
  const inL = new Float32Array(total);
  const inR = new Float32Array(total);
  inL.set(input.left);
  inR.set(input.right);
  const outL = new Float32Array(total);
  const outR = new Float32Array(total);

  const runner = new BlockRunner(dsp, BLOCK_SIZE);
  runner.inputGain = opts.inputGain ?? 1;
  runner.outputGain = opts.outputGain ?? 1;
  const first = opts.initialParams ?? opts.paramsAt(0);
  runner.reset(first);
  dsp.setParams(first);

  const blocks = Math.ceil(total / BLOCK_SIZE);
  const comp = new Float32Array(blocks).fill(1);
  const limiter = new Float32Array(blocks).fill(1);

  let last: DspParams = first;
  const CHUNK_FRAMES = BLOCK_SIZE * 2000;
  for (let start = 0; start < total; start += CHUNK_FRAMES) {
    const end = Math.min(total, start + CHUNK_FRAMES);
    const baseBlock = start / BLOCK_SIZE;
    runner.processOffline(
      inL.subarray(start, end),
      inR.subarray(start, end),
      outL.subarray(start, end),
      outR.subarray(start, end),
      (_block, frameIndex) => {
        const p = opts.paramsAt((start + frameIndex) / SAMPLE_RATE);
        if (p !== last) {
          dsp.setParams(p);
          last = p;
        }
      },
      { comp: comp.subarray(baseBlock), limiter: limiter.subarray(baseBlock) },
    );
    opts.onProgress?.(end / total);
    if (end < total) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    left: outL.slice(latency),
    right: outR.slice(latency),
    sampleRate: input.sampleRate,
    compGain: comp,
    limiterGain: limiter,
    blockSize: BLOCK_SIZE,
  };
}
