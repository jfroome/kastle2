/** The firmware builds the emulator can run (wasm/firmware/build_all.sh). */
export interface FirmwareInfo {
  id: string;
  name: string;
  /** DSP delay (samples) between input and output, compensated in offline renders */
  latencySamples: number;
  /** Apps that make sound on their own (synths) don't need an input signal */
  generatesSound: boolean;
  /** Name of the bundled user-data file (samples) in public/firmware/, if the app needs one */
  userData?: { file: string; label: string };
}

export const FIRMWARES: FirmwareInfo[] = [
  { id: "masterblaster", name: "MasterBlaster", latencySamples: 96, generatesSound: false },
  { id: "beads", name: "Beads", latencySamples: 0, generatesSound: false },
  { id: "wavebard", name: "Wave Bard", latencySamples: 0, generatesSound: true, userData: { file: "wavebard-samples.bin", label: "Wave Bard samples (SAMPLES.bin)" } },
  { id: "examplesynth", name: "Example Synth", latencySamples: 0, generatesSound: true },
  { id: "template", name: "Template (passthrough)", latencySamples: 0, generatesSound: false },
];

export const getFirmwareInfo = (id: string): FirmwareInfo => {
  const info = FIRMWARES.find((f) => f.id === id);
  if (!info) throw new Error(`Unknown firmware '${id}'`);
  return info;
};
