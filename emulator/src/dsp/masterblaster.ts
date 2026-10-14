import type { DspFactory, DspInstance, DspParams } from "./types";

interface MbExports {
  memory: WebAssembly.Memory;
  mb_max_frames(): number;
  mb_latency_samples(): number;
  mb_input_ptr(): number;
  mb_output_ptr(): number;
  mb_init(): void;
  mb_init_with(...args: number[]): void;
  mb_set_params(...args: number[]): void;
  mb_process(frames: number): void;
  mb_comp_gain(): number;
  mb_limiter_gain(): number;
  mb_bypass_amount(): number;
  mb_pot_to_param(pot: number, potMax: number): number;
  mb_apply_cv(param: number, cv: number, adc5v: number): number;
}

/** Parameter order of mb_set_params in wasm/masterblaster_wasm.cpp */
export const MB_PARAM_ORDER = [
  "drive",
  "tone",
  "comp",
  "comp_speed",
  "vinyl",
  "wow",
  "lofi",
  "width",
  "mix",
  "output",
  "bypass",
] as const;

export const MB_DEFAULTS: Record<(typeof MB_PARAM_ORDER)[number], number> = {
  drive: 8000,
  tone: 16384,
  comp: 9000,
  comp_speed: 16384,
  vinyl: 0,
  wow: 0,
  lofi: 0,
  width: 16384,
  mix: 32767,
  output: 23170,
  bypass: 0,
};

function toArgs(params: DspParams): number[] {
  return MB_PARAM_ORDER.map((key) => Math.round(params[key] ?? MB_DEFAULTS[key]));
}

class MasterBlasterInstance implements DspInstance {
  readonly latencySamples: number;
  readonly maxFrames: number;
  readonly input: Int16Array;
  readonly output: Int16Array;

  constructor(private readonly x: MbExports) {
    this.latencySamples = x.mb_latency_samples();
    this.maxFrames = x.mb_max_frames();
    this.input = new Int16Array(x.memory.buffer, x.mb_input_ptr(), this.maxFrames * 2);
    this.output = new Int16Array(x.memory.buffer, x.mb_output_ptr(), this.maxFrames * 2);
    x.mb_init();
  }

  init(params?: DspParams): void {
    if (params) {
      this.x.mb_init_with(...toArgs(params));
    } else {
      this.x.mb_init();
    }
  }

  setParams(params: DspParams): void {
    this.x.mb_set_params(...toArgs(params));
  }

  process(frames: number): void {
    this.x.mb_process(frames);
  }

  meters(): Record<string, number> {
    return {
      compGain: this.x.mb_comp_gain(),
      limiterGain: this.x.mb_limiter_gain(),
      bypassAmount: this.x.mb_bypass_amount(),
    };
  }

  potToParam(pot: number, potMax: number): number {
    return this.x.mb_pot_to_param(pot, potMax);
  }

  applyCv(param: number, cv: number, adc5v: number): number {
    return this.x.mb_apply_cv(param, cv, adc5v);
  }
}

export const masterBlasterDsp: DspFactory = {
  id: "masterblaster",
  needsWasm: true,
  async instantiate(wasm) {
    if (!wasm) {
      throw new Error("masterblaster DSP needs its WebAssembly binary");
    }
    const instance =
      wasm instanceof WebAssembly.Module
        ? await WebAssembly.instantiate(wasm, {})
        : (await WebAssembly.instantiate(wasm, {})).instance;
    return new MasterBlasterInstance(instance.exports as unknown as MbExports);
  },
};
