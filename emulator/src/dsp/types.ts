/** Anything that can process the firmware audio stream (a compiled firmware DSP or a plain JS function). */
export interface DspInstance {
  readonly latencySamples: number;
  readonly maxFrames: number;
  /** Interleaved stereo Q15 buffers the DSP reads from / writes to. */
  readonly input: Int16Array;
  readonly output: Int16Array;
  init(params?: DspParams): void;
  setParams(params: DspParams): void;
  process(frames: number): void;
  /** Meter values the firmware exposes (e.g. compressor gain). Q15 unless noted. */
  meters(): Record<string, number>;
  potToParam(pot: number, potMax: number): number;
  applyCv(param: number, cvAdc: number, adc5v: number): number;
}

export type DspParams = Record<string, number>;

/** A compiled module, or the raw bytes (what AudioWorklets receive, as modules can't be posted to them). */
export type WasmSource = WebAssembly.Module | ArrayBuffer;

export interface DspFactory {
  id: string;
  /** True when instantiate() needs a compiled WebAssembly.Module. */
  needsWasm: boolean;
  instantiate(wasm?: WasmSource): Promise<DspInstance>;
}
