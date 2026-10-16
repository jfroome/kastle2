import type { FirmwareApp } from "../core/app";
import { BeadsApp } from "./beads";
import { ExampleSynthApp } from "./examplesynth";
import { MasterBlasterApp } from "./masterblaster";
import { TemplateApp } from "./template";
import { WaveBardApp } from "./wavebard";

export interface AppEntry {
  id: string;
  name: string;
  create: () => FirmwareApp;
  /** Built and tested, but not offered in the UI */
  hidden?: boolean;
}

/** Add new firmware apps here: a spec in src/apps plus a firmware build (wasm/firmware/build_firmware.sh) and an entry in src/firmware/registry.ts. */
export const ALL_APPS: AppEntry[] = [
  { id: "masterblaster", name: "MasterBlaster", create: () => new MasterBlasterApp() },
  { id: "beads", name: "Beads", create: () => new BeadsApp() },
  { id: "wavebard", name: "Wave Bard", create: () => new WaveBardApp(), hidden: true },
  { id: "examplesynth", name: "Example Synth", create: () => new ExampleSynthApp(), hidden: true },
  { id: "template", name: "Template (passthrough)", create: () => new TemplateApp(), hidden: true },
];

/** What the UI offers: MasterBlaster and Beads. Flip `hidden` above to expose the other builds again. */
export const APPS: AppEntry[] = ALL_APPS.filter((a) => !a.hidden);
