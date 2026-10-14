import { BLOCK_SIZE } from "../core/constants";
import type { DspInstance, DspParams } from "../dsp/types";

const toQ15 = (x: number): number => {
  const v = Math.round(x * 32768);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
};

export interface LevelStats {
  inPeak: number;
  outPeak: number;
  inSumSq: number;
  outSumSq: number;
  frames: number;
}

/**
 * Feeds float audio to a firmware DSP in fixed-size blocks, the way the audio interrupt does on the module.
 * Used by the AudioWorklet (streaming) and by offline rendering (whole buffers).
 */
export class BlockRunner {
  inputGain = 1;
  outputGain = 1;

  readonly levels: LevelStats = { inPeak: 0, outPeak: 0, inSumSq: 0, outSumSq: 0, frames: 0 };
  /** Lowest firmware meter values seen since the last resetMeters() */
  readonly minMeters: Record<string, number> = {};

  private stagingFill = 0;
  private readonly outL: Float32Array;
  private readonly outR: Float32Array;
  private outRead = 0;
  private outWrite = 0;

  constructor(
    readonly dsp: DspInstance,
    readonly blockSize: number = BLOCK_SIZE,
  ) {
    const capacity = blockSize * 8;
    this.outL = new Float32Array(capacity);
    this.outR = new Float32Array(capacity);
    this.prefillLatency();
  }

  private prefillLatency(): void {
    // One block of silence so streaming never underruns
    this.outRead = 0;
    this.outWrite = this.blockSize % this.outL.length;
    this.outL.fill(0);
    this.outR.fill(0);
  }

  reset(params?: DspParams): void {
    this.dsp.init(params);
    this.stagingFill = 0;
    this.prefillLatency();
    this.resetMeters();
  }

  resetMeters(): void {
    this.levels.inPeak = this.levels.outPeak = this.levels.inSumSq = this.levels.outSumSq = this.levels.frames = 0;
    for (const key of Object.keys(this.minMeters)) {
      delete this.minMeters[key];
    }
  }

  private runBlock(frames: number): void {
    this.dsp.process(frames);
    const meters = this.dsp.meters();
    for (const key of Object.keys(meters)) {
      const prev = this.minMeters[key];
      this.minMeters[key] = prev === undefined ? meters[key] : Math.min(prev, meters[key]);
    }
  }

  /** Streaming: any number of frames per call, output is delayed by one block. */
  processStream(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    const { dsp, blockSize, levels } = this;
    const cap = this.outL.length;
    for (let i = 0; i < frames; i++) {
      const l = inL[i] * this.inputGain;
      const r = inR[i] * this.inputGain;
      const q = this.stagingFill * 2;
      dsp.input[q] = toQ15(l);
      dsp.input[q + 1] = toQ15(r);
      const al = Math.abs(l);
      const ar = Math.abs(r);
      levels.inPeak = Math.max(levels.inPeak, al, ar);
      levels.inSumSq += (l * l + r * r) * 0.5;
      this.stagingFill++;

      if (this.stagingFill === blockSize) {
        this.runBlock(blockSize);
        for (let j = 0; j < blockSize; j++) {
          this.outL[this.outWrite] = dsp.output[2 * j] / 32768;
          this.outR[this.outWrite] = dsp.output[2 * j + 1] / 32768;
          this.outWrite = (this.outWrite + 1) % cap;
        }
        this.stagingFill = 0;
      }

      const ol = this.outL[this.outRead] * this.outputGain;
      const or = this.outR[this.outRead] * this.outputGain;
      this.outRead = (this.outRead + 1) % cap;
      outL[i] = ol;
      outR[i] = or;
      levels.outPeak = Math.max(levels.outPeak, Math.abs(ol), Math.abs(or));
      levels.outSumSq += (ol * ol + or * or) * 0.5;
      levels.frames++;
    }
  }

  /**
   * Offline: processes whole buffers block by block with no extra latency.
   * `beforeBlock(blockIndex)` lets the caller automate parameters.
   */
  processOffline(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    beforeBlock?: (blockIndex: number, frameIndex: number) => void,
    meterTimeline?: { comp: Float32Array; limiter: Float32Array },
  ): void {
    const { dsp, blockSize } = this;
    const total = inL.length;
    let blockIndex = 0;
    for (let pos = 0; pos < total; pos += blockSize, blockIndex++) {
      const n = Math.min(blockSize, total - pos);
      beforeBlock?.(blockIndex, pos);
      for (let j = 0; j < n; j++) {
        dsp.input[2 * j] = toQ15(inL[pos + j] * this.inputGain);
        dsp.input[2 * j + 1] = toQ15(inR[pos + j] * this.inputGain);
      }
      dsp.process(n);
      for (let j = 0; j < n; j++) {
        outL[pos + j] = (dsp.output[2 * j] / 32768) * this.outputGain;
        outR[pos + j] = (dsp.output[2 * j + 1] / 32768) * this.outputGain;
      }
      if (meterTimeline) {
        const m = dsp.meters();
        if (blockIndex < meterTimeline.comp.length) {
          meterTimeline.comp[blockIndex] = (m.compGain ?? 32768) / 32768;
          meterTimeline.limiter[blockIndex] = (m.limiterGain ?? 32768) / 32768;
        }
      }
    }
  }
}
