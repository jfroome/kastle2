// Model of the NAU88C22 codec and the analogue stages around it, driven by the registers the firmware writes.
// Gain tables: NAU88C22 datasheet (input PGA -12..+35.25 dB in 0.75 dB steps, ADC/DAC digital volume 0.5 dB steps,
// headphone volume 1 dB steps, ADC full scale 1 Vrms). DC offsets: Kastle2_parameters.hpp (the firmware removes them).

export const REG = {
  LEFT_DAC_VOLUME: 0x0b,
  RIGHT_DAC_VOLUME: 0x0c,
  LEFT_ADC_VOLUME: 0x0f,
  RIGHT_ADC_VOLUME: 0x10,
  LEFT_INPUT_PGA: 0x2d,
  RIGHT_INPUT_PGA: 0x2e,
  LEFT_HP_VOLUME: 0x34,
  RIGHT_HP_VOLUME: 0x35,
} as const;

export interface CodecGains {
  pgaDb: [number, number];
  adcDigitalDb: [number, number];
  dacDigitalDb: [number, number];
  hpDb: [number, number];
  pgaMuted: [boolean, boolean];
  hpMuted: [boolean, boolean];
}

const db = (x: number) => Math.pow(10, x / 20);

export function decodeCodec(read: (reg: number) => number): CodecGains {
  const pga = (reg: number): [number, boolean] => [((reg & 0x3f) - 0x10) * 0.75, (reg & 0x40) !== 0];
  const vol = (reg: number) => (reg & 0xff) === 0 ? -Infinity : ((reg & 0xff) - 0xff) * 0.5;
  const hp = (reg: number): [number, boolean] => [(reg & 0x3f) - 0x39, (reg & 0x40) !== 0];
  const [pl, pml] = pga(read(REG.LEFT_INPUT_PGA));
  const [pr, pmr] = pga(read(REG.RIGHT_INPUT_PGA));
  const [hl, hml] = hp(read(REG.LEFT_HP_VOLUME));
  const [hr, hmr] = hp(read(REG.RIGHT_HP_VOLUME));
  return {
    pgaDb: [pml ? -Infinity : pl, pmr ? -Infinity : pr],
    adcDigitalDb: [vol(read(REG.LEFT_ADC_VOLUME)), vol(read(REG.RIGHT_ADC_VOLUME))],
    dacDigitalDb: [vol(read(REG.LEFT_DAC_VOLUME)), vol(read(REG.RIGHT_DAC_VOLUME))],
    hpDb: [hml ? -Infinity : hl, hmr ? -Infinity : hr],
    pgaMuted: [pml, pmr],
    hpMuted: [hml, hmr],
  };
}

export interface AnalogOptions {
  /** Level at the jack (dB) that corresponds to digital full scale in the audio file / source: input stage trim */
  inputTrimDb: number;
  outputTrimDb: number;
  /** Add DC offsets, converter noise and a little distortion per the datasheet figures */
  nonIdeal: boolean;
}

/**
 * Calibration of the unknown analogue level at the jacks so that the factory-default knob positions are unity gain
 * for a source at digital full scale:
 *   input:  EEPROM default 160 -> input pot 2560 -> PGA register 40 = +18 dB, ADC digital volume 0xF0 = -7.5 dB,
 *           firmware software gain 0.625 * 8 = x5 = +13.98 dB  =>  trim -24.48 dB
 *   output: EEPROM default 160 -> output pot 2560 -> headphone volume 33 = -24 dB, DAC digital volume 0 dB => trim +24 dB
 * (Memory.cpp writes the 160 defaults, Base.cpp derives the registers.)
 */
export const INPUT_TRIM_UNITY_DB = -(18 - 7.5 + 20 * Math.log10(5));
export const OUTPUT_TRIM_UNITY_DB = 24;

export const DEFAULT_ANALOG: AnalogOptions = {
  inputTrimDb: INPUT_TRIM_UNITY_DB,
  outputTrimDb: OUTPUT_TRIM_UNITY_DB,
  nonIdeal: false,
};

/** Firmware compensates these (Kastle2_parameters.hpp), so the analogue side must have the opposite offset. */
/** q15(0.01f) / q15(-0.008f) in Kastle2_parameters.hpp: the firmware adds the negation of these */
export const INPUT_DC_Q15 = -327;
export const OUTPUT_DC_Q15 = 262;
/** Datasheet: ADC SNR 89 dB, DAC SNR ~98 dB (A-weighted, relative to full scale), THD about -78 dB */
export const ADC_NOISE_RMS = Math.pow(10, -89 / 20);
export const DAC_NOISE_RMS = Math.pow(10, -98 / 20);
export const THD_K3 = 4 * Math.pow(10, -78 / 20);

export interface ChannelGains {
  input: [number, number];
  output: [number, number];
}

export function channelGains(c: CodecGains, o: AnalogOptions): ChannelGains {
  // The firmware swaps ADC L/R (AUDIO_INTERFACE register) to match the wiring, so channel order is preserved end to end
  const lin = (d: number) => (Number.isFinite(d) ? db(d) : 0);
  return {
    input: [
      lin(o.inputTrimDb + c.pgaDb[0] + c.adcDigitalDb[0]),
      lin(o.inputTrimDb + c.pgaDb[1] + c.adcDigitalDb[1]),
    ],
    output: [
      lin(o.outputTrimDb + c.dacDigitalDb[0] + c.hpDb[0]),
      lin(o.outputTrimDb + c.dacDigitalDb[1] + c.hpDb[1]),
    ],
  };
}

let rngState = 0x9e3779b9;
export function gaussian(): number {
  // xorshift + Box-Muller-lite (sum of uniforms), good enough for a noise floor
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    sum += (rngState >>> 0) / 4294967296;
  }
  return (sum - 2) * 1.7320508; // variance 4/12 -> scale to unit variance
}
