import { masterBlasterDsp } from "./masterblaster";
import type { DspFactory } from "./types";

const factories: Record<string, DspFactory> = {
  [masterBlasterDsp.id]: masterBlasterDsp,
};

/** Register new firmware DSPs here (and add a matching app in src/apps). */
export function getDspFactory(id: string): DspFactory {
  const factory = factories[id];
  if (!factory) {
    throw new Error(`Unknown DSP '${id}'`);
  }
  return factory;
}
