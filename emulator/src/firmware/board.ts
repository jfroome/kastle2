import { BLOCK_SIZE, POT_COUNT } from "../core/constants";
import {
  channelGains,
  DAC_NOISE_RMS,
  ADC_NOISE_RMS,
  decodeCodec,
  DEFAULT_ANALOG,
  gaussian,
  INPUT_DC_Q15,
  OUTPUT_DC_Q15,
  THD_K3,
  type AnalogOptions,
  type CodecGains,
} from "./codec";
import { ADC_ROUTE, PIN, POT_JACKS, potNormToRaw, UNPATCHED_RAW, voltsToRaw, type JackName } from "./frontend";

export type ButtonName = "SHIFT" | "MODE";
export type Layer = "NORMAL" | "SHIFT" | "MODE" | "SETTINGS" | "SETTINGS_SHIFT" | "SETTINGS_MODE";
export const LAYERS: Layer[] = ["NORMAL", "SHIFT", "MODE", "SETTINGS", "SETTINGS_SHIFT", "SETTINGS_MODE"];

interface FirmwareExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  fw_name(): number;
  fw_input(): number;
  fw_scratch(): number;
  fw_output(): number;
  fw_user_data_ptr(): number;
  fw_user_data_capacity(): number;
  fw_set_adc(hw: number, mux: number, raw: number): void;
  fw_set_pin(pin: number, level: number): void;
  fw_midi_in(byte: number): void;
  fw_get_pin(pin: number): number;
  fw_get_pwm(slice: number, chan: number): number;
  fw_get_led(index: number): number;
  fw_get_codec_reg(reg: number): number;
  fw_midi_out_pop(ptr: number): number;
  fw_eeprom_ptr(): number;
  fw_eeprom_size(): number;
  fw_eeprom_take_dirty(): number;
  fw_layer(): number;
  fw_pot_frozen(pot: number): number;
  fw_pot_raw(pot: number): number;
  fw_analog_value(input: number): number;
  fw_button_pressed(button: number): number;
  fw_version(): number;
  fw_boot(): void;
  fw_run_block(uiIterations: number): void;
}

/** Everything the outside world drives into the board. */
export interface PanelInputs {
  /** Physical pot positions, 0..1 */
  pots: number[];
  /** Volts at each jack; undefined = nothing patched */
  volts: Partial<Record<JackName, number>>;
  buttons: Record<ButtonName, boolean>;
  trig: boolean;
  resetIn: boolean;
  syncIn: boolean;
  audioInPlugged: boolean;
}

export const defaultPanel = (): PanelInputs => ({
  pots: new Array(POT_COUNT).fill(0.5),
  volts: {},
  buttons: { SHIFT: false, MODE: false },
  trig: false,
  resetIn: false,
  syncIn: false,
  audioInPlugged: true,
});

export interface BoardState {
  layer: Layer;
  frozen: boolean[];
  leds: [number, number, number][];
  gateOut: boolean;
  pulseOut: boolean;
  syncOut: boolean;
  /** PWM outputs normalised 0..1 (the firmware drives them inverted) */
  lfoOut: number;
  envOut: number;
  cvOut: number;
  codec: CodecGains;
  /** Firmware's own view of the CV jacks, in ADC units (819 per volt) */
  paramAdc: [number, number, number];
}

export type PanelAction =
  | { type: "pot"; pot: number; norm: number }
  | { type: "button"; button: ButtonName; down: boolean }
  | { type: "wait"; blocks: number };

export interface BoardConfig {
  wasm: WebAssembly.Module | ArrayBuffer;
  userData?: Uint8Array;
  eeprom?: Uint8Array;
  analog?: Partial<AnalogOptions>;
  /** Main-loop iterations per audio block (the real loop spins much faster than one block) */
  uiIterationsPerBlock?: number;
}

const isModule = (w: WebAssembly.Module | ArrayBuffer): w is WebAssembly.Module => w instanceof WebAssembly.Module;

/**
 * The real Kastle 2 firmware (Base, Hardware, Memory, MIDI and the app) running as WebAssembly on an emulated
 * RP2040 board (wasm/hal). This class is the "outside world": pots, CV, buttons, audio converters.
 */
export class FirmwareBoard {
  readonly name: string;
  readonly panel: PanelInputs = defaultPanel();
  analog: AnalogOptions;
  uiIterationsPerBlock: number;

  private readonly x: FirmwareExports;
  private input: Int32Array;
  private output: Int32Array;
  private appliedPanel = "";
  private actions: PanelAction[] = [];
  private waitBlocks = 0;
  private codecCache: CodecGains;
  private blocks = 0;

  private constructor(x: FirmwareExports, config: BoardConfig) {
    this.x = x;
    this.analog = { ...DEFAULT_ANALOG, ...config.analog };
    this.uiIterationsPerBlock = config.uiIterationsPerBlock ?? 4;
    x._initialize();
    if (config.userData) {
      if (config.userData.length > x.fw_user_data_capacity()) {
        throw new Error(`User data (${config.userData.length} B) does not fit this firmware (${x.fw_user_data_capacity()} B)`);
      }
      new Uint8Array(x.memory.buffer, x.fw_user_data_ptr(), config.userData.length).set(config.userData);
    }
    if (config.eeprom) {
      new Uint8Array(x.memory.buffer, x.fw_eeprom_ptr(), x.fw_eeprom_size()).set(
        config.eeprom.subarray(0, x.fw_eeprom_size()),
      );
    }
    this.input = new Int32Array(x.memory.buffer, x.fw_input(), BLOCK_SIZE * 2);
    this.output = new Int32Array(x.memory.buffer, x.fw_output(), BLOCK_SIZE * 2);
    this.name = this.readString(x.fw_name());
    this.codecCache = decodeCodec((r) => x.fw_get_codec_reg(r));
  }

  static async create(config: BoardConfig): Promise<FirmwareBoard> {
    const wasm = config.wasm;
    const instance = isModule(wasm) ? await WebAssembly.instantiate(wasm, {}) : (await WebAssembly.instantiate(wasm, {})).instance;
    return new FirmwareBoard(instance.exports as unknown as FirmwareExports, config);
  }

  private readString(ptr: number): string {
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, 64);
    const end = bytes.indexOf(0);
    // TextDecoder does not exist in AudioWorkletGlobalScope
    return String.fromCharCode(...bytes.subarray(0, end < 0 ? 64 : end));
  }

  /** Boots the firmware (Kastle2::Init, app Init...) with the current panel positions. */
  boot(): void {
    this.applyPanel(true);
    this.x.fw_boot();
    this.codecCache = decodeCodec((r) => this.x.fw_get_codec_reg(r));
  }

  // ------------------------------------------------------------ inputs

  private pushPanel(force: boolean): void {
    const p = this.panel;
    const key = JSON.stringify([p.pots, p.volts, p.buttons, p.trig, p.resetIn, p.syncIn, p.audioInPlugged]);
    if (!force && key === this.appliedPanel) return;
    this.appliedPanel = key;
    const x = this.x;
    for (let i = 0; i < POT_COUNT; i++) {
      const [hw, mux] = ADC_ROUTE[POT_JACKS[i]];
      x.fw_set_adc(hw, mux, potNormToRaw(p.pots[i]));
    }
    for (const jack of Object.keys(ADC_ROUTE) as (keyof typeof ADC_ROUTE)[]) {
      if (jack.startsWith("POT_")) continue;
      const j = jack as JackName;
      const [hw, mux] = ADC_ROUTE[j];
      const volts = p.volts[j];
      const raw = volts === undefined ? (UNPATCHED_RAW[j] ?? voltsToRaw(j, 0)) : voltsToRaw(j, volts);
      x.fw_set_adc(hw, mux, raw);
    }
    // Buttons and digital inputs are active low
    x.fw_set_pin(PIN.BUTTON_SHIFT, p.buttons.SHIFT ? 0 : 1);
    x.fw_set_pin(PIN.BUTTON_MODE, p.buttons.MODE ? 0 : 1);
    x.fw_set_pin(PIN.TRIG_IN, p.trig ? 0 : 1);
    x.fw_set_pin(PIN.RESET_IN, p.resetIn ? 0 : 1);
    x.fw_set_pin(PIN.SYNC_IN, p.syncIn ? 0 : 1);
    x.fw_set_pin(PIN.AUDIO_IN_DETECT, p.audioInPlugged ? 1 : 0);
  }

  applyPanel(force = false): void {
    this.pushPanel(force);
  }

  setPot(pot: number, norm: number): void {
    this.panel.pots[pot] = Math.max(0, Math.min(1, norm));
  }

  setButton(button: ButtonName, down: boolean): void {
    this.panel.buttons[button] = down;
  }

  setVolts(jack: JackName, volts: number | undefined): void {
    if (volts === undefined) delete this.panel.volts[jack];
    else this.panel.volts[jack] = volts;
  }

  midiIn(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.x.fw_midi_in(bytes[i]);
  }

  /** Packets the firmware sent over USB MIDI (4 bytes each). */
  midiOut(): number[][] {
    const out: number[][] = [];
    const ptr = this.x.fw_scratch();
    while (this.x.fw_midi_out_pop(ptr)) {
      out.push(Array.from(new Uint8Array(this.x.memory.buffer, ptr, 4)));
    }
    return out;
  }

  /** Schedule panel gestures (button presses, knob moves, waits) to run on following blocks. */
  queue(actions: PanelAction[]): void {
    this.actions.push(...actions);
  }

  get busy(): boolean {
    return this.actions.length > 0 || this.waitBlocks > 0;
  }

  private stepActions(): void {
    if (this.waitBlocks > 0) {
      this.waitBlocks--;
      return;
    }
    while (this.actions.length) {
      const a = this.actions.shift()!;
      if (a.type === "wait") {
        this.waitBlocks = Math.max(0, a.blocks - 1);
        return;
      }
      if (a.type === "pot") this.setPot(a.pot, a.norm);
      else this.setButton(a.button, a.down);
    }
  }

  // ------------------------------------------------------------ audio

  /**
   * Runs one 48-frame block. Audio is float; this applies the analogue front end (codec PGA/ADC gain), the firmware
   * processes Q15, then the DAC/headphone gain stage turns it back into float.
   */
  runBlock(inL: ArrayLike<number> | null, inR: ArrayLike<number> | null, inOffset: number, outL: Float32Array, outR: Float32Array, outOffset: number): void {
    this.stepActions();
    this.pushPanel(false);

    const g = channelGains(this.codecCache, this.analog);
    const nonIdeal = this.analog.nonIdeal;
    const inp = this.input;
    for (let i = 0; i < BLOCK_SIZE; i++) {
      let l = inL ? inL[inOffset + i] : 0;
      let r = inR ? inR[inOffset + i] : 0;
      if (nonIdeal) {
        l += gaussian() * ADC_NOISE_RMS;
        r += gaussian() * ADC_NOISE_RMS;
      }
      l *= g.input[0];
      r *= g.input[1];
      if (nonIdeal) {
        l -= THD_K3 * l * l * l;
        r -= THD_K3 * r * r * r;
      }
      // The analogue input stage has a DC offset that the firmware removes in Kastle2::AudioCallback
      inp[2 * i] = clampQ15(Math.round(l * 32768 + INPUT_DC_Q15));
      inp[2 * i + 1] = clampQ15(Math.round(r * 32768 + INPUT_DC_Q15));
    }

    this.x.fw_run_block(this.uiIterationsPerBlock);
    this.blocks++;
    if ((this.blocks & 7) === 0) {
      this.codecCache = decodeCodec((r) => this.x.fw_get_codec_reg(r));
    }

    const out = this.output;
    for (let i = 0; i < BLOCK_SIZE; i++) {
      // The I2S driver shifts the 32-bit container: values beyond 16 bit wrap like on the real DAC path
      const l = (out[2 * i] << 16) >> 16;
      const r = (out[2 * i + 1] << 16) >> 16;
      // ...and the output stage adds one that the firmware pre-compensates
      let fl = ((l + OUTPUT_DC_Q15) / 32768) * g.output[0];
      let fr = ((r + OUTPUT_DC_Q15) / 32768) * g.output[1];
      if (nonIdeal) {
        fl += gaussian() * DAC_NOISE_RMS;
        fr += gaussian() * DAC_NOISE_RMS;
      }
      outL[outOffset + i] = fl;
      outR[outOffset + i] = fr;
    }
  }

  // ------------------------------------------------------------ state / persistence

  state(): BoardState {
    const x = this.x;
    const led = (i: number): [number, number, number] => {
      const c = x.fw_get_led(i);
      return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    };
    const pwm = (slice: number, chan: number) => 1 - x.fw_get_pwm(slice, chan) / 1023;
    return {
      layer: LAYERS[x.fw_layer()] ?? "NORMAL",
      frozen: Array.from({ length: POT_COUNT }, (_, i) => x.fw_pot_frozen(i) !== 0),
      leds: [led(0), led(1), led(2)],
      gateOut: x.fw_get_pin(PIN.GATE_OUT) === 0,
      pulseOut: x.fw_get_pin(PIN.PULSE_OUT) === 0,
      syncOut: x.fw_get_pin(PIN.SYNC_OUT) === 0,
      lfoOut: pwm(2, 0),
      envOut: pwm(2, 1),
      cvOut: pwm(3, 0),
      codec: this.codecCache,
      paramAdc: [x.fw_analog_value(4), x.fw_analog_value(9), x.fw_analog_value(3)],
    };
  }

  /** Current EEPROM image (settings the firmware persisted), or null if nothing changed since the last call. */
  takeEeprom(): Uint8Array | null {
    if (!this.x.fw_eeprom_take_dirty()) return null;
    return new Uint8Array(this.x.memory.buffer, this.x.fw_eeprom_ptr(), this.x.fw_eeprom_size()).slice();
  }

  get isCitadel(): boolean {
    return this.x.fw_version() === 1;
  }

  potRaw(pot: number): number {
    return this.x.fw_pot_raw(pot);
  }
}

const clampQ15 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
