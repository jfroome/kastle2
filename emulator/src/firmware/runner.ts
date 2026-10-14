import { BLOCK_SIZE } from "../core/constants";
import type { StereoSignal } from "../engine/offline";
import type { FirmwareBoard, PanelInputs } from "./board";

export interface LevelStats {
  inPeak: number;
  outPeak: number;
  inSumSq: number;
  outSumSq: number;
  frames: number;
}

/** Streaming adapter: arbitrary-size audio quanta in, fixed 48-sample firmware blocks inside, one block of latency. */
export class FirmwareStreamer {
  readonly levels: LevelStats = { inPeak: 0, outPeak: 0, inSumSq: 0, outSumSq: 0, frames: 0 };
  private readonly stageL = new Float32Array(BLOCK_SIZE);
  private readonly stageR = new Float32Array(BLOCK_SIZE);
  private fill = 0;
  private readonly ringL = new Float32Array(BLOCK_SIZE * 8);
  private readonly ringR = new Float32Array(BLOCK_SIZE * 8);
  private readPos = 0;
  private writePos = BLOCK_SIZE; // one block of silence pre-filled
  private readonly blockL = new Float32Array(BLOCK_SIZE);
  private readonly blockR = new Float32Array(BLOCK_SIZE);

  constructor(readonly board: FirmwareBoard) {}

  resetMeters(): void {
    const l = this.levels;
    l.inPeak = l.outPeak = l.inSumSq = l.outSumSq = l.frames = 0;
  }

  process(inL: ArrayLike<number> | null, inR: ArrayLike<number> | null, outL: Float32Array, outR: Float32Array, frames: number): void {
    const cap = this.ringL.length;
    const l = this.levels;
    for (let i = 0; i < frames; i++) {
      const a = inL ? inL[i] : 0;
      const b = inR ? inR[i] : 0;
      this.stageL[this.fill] = a;
      this.stageR[this.fill] = b;
      this.fill++;
      l.inPeak = Math.max(l.inPeak, Math.abs(a), Math.abs(b));
      l.inSumSq += (a * a + b * b) * 0.5;

      if (this.fill === BLOCK_SIZE) {
        this.board.runBlock(this.stageL, this.stageR, 0, this.blockL, this.blockR, 0);
        for (let j = 0; j < BLOCK_SIZE; j++) {
          this.ringL[this.writePos] = this.blockL[j];
          this.ringR[this.writePos] = this.blockR[j];
          this.writePos = (this.writePos + 1) % cap;
        }
        this.fill = 0;
      }
      const ol = this.ringL[this.readPos];
      const or = this.ringR[this.readPos];
      this.readPos = (this.readPos + 1) % cap;
      outL[i] = ol;
      outR[i] = or;
      l.outPeak = Math.max(l.outPeak, Math.abs(ol), Math.abs(or));
      l.outSumSq += (ol * ol + or * or) * 0.5;
      l.frames++;
    }
  }
}

export interface FirmwareRenderOptions {
  /** Frames to render. Defaults to the input length (+ latency). Needed when there's no input (synths). */
  frames?: number;
  /** Called before every block with the time in seconds; drive CV, gates, MIDI, pots here. */
  beforeBlock?: (timeSec: number, board: FirmwareBoard) => void;
  /** Settle time (seconds) rendered and discarded before audio is captured, so panel scripts take effect */
  warmupSec?: number;
  latencySamples?: number;
  onProgress?: (fraction: number) => void;
  sampleRate?: number;
}

export interface FirmwareRenderResult extends StereoSignal {
  /** State of the board at the end of the render */
  panel: PanelInputs;
}

/** Deterministic offline render of a booted board. */
export async function renderFirmware(
  board: FirmwareBoard,
  input: StereoSignal | null,
  options: FirmwareRenderOptions = {},
): Promise<FirmwareRenderResult> {
  const sampleRate = options.sampleRate ?? input?.sampleRate ?? 44000;
  const latency = options.latencySamples ?? 0;
  const inFrames = input ? input.left.length : 0;
  const frames = (options.frames ?? inFrames) + latency;
  const blocks = Math.ceil(frames / BLOCK_SIZE);
  const warmupBlocks = Math.ceil(((options.warmupSec ?? 0) * sampleRate) / BLOCK_SIZE);

  const outL = new Float32Array(blocks * BLOCK_SIZE);
  const outR = new Float32Array(blocks * BLOCK_SIZE);
  const inL = new Float32Array(BLOCK_SIZE);
  const inR = new Float32Array(BLOCK_SIZE);
  const scratchL = new Float32Array(BLOCK_SIZE);
  const scratchR = new Float32Array(BLOCK_SIZE);

  for (let b = -warmupBlocks; b < blocks; b++) {
    const t = Math.max(0, b * BLOCK_SIZE) / sampleRate;
    options.beforeBlock?.(b < 0 ? 0 : t, board);
    const start = b * BLOCK_SIZE;
    if (input && b >= 0) {
      for (let i = 0; i < BLOCK_SIZE; i++) {
        const k = start + i;
        inL[i] = k < inFrames ? input.left[k] : 0;
        inR[i] = k < inFrames ? input.right[k] : 0;
      }
    } else {
      inL.fill(0);
      inR.fill(0);
    }
    if (b >= 0) board.runBlock(inL, inR, 0, outL, outR, b * BLOCK_SIZE);
    else board.runBlock(inL, inR, 0, scratchL, scratchR, 0);

    if ((b & 1023) === 1023) {
      options.onProgress?.((b + warmupBlocks) / (blocks + warmupBlocks));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  options.onProgress?.(1);
  return {
    left: outL.slice(latency, frames),
    right: outR.slice(latency, frames),
    sampleRate,
    panel: board.panel,
  };
}
