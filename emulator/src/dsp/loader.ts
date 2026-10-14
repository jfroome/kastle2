import masterBlasterUrl from "./masterblaster.wasm?url";
import { getDspFactory } from "./registry";
import type { DspInstance } from "./types";

const urls: Record<string, string> = { masterblaster: masterBlasterUrl };
const cache = new Map<string, Promise<WebAssembly.Module>>();

/** Browser: instantiate a standalone firmware DSP (used by the bench's DSP-level tests). */
export async function loadDsp(dspId: string): Promise<DspInstance> {
  const factory = getDspFactory(dspId);
  if (!factory.needsWasm) return factory.instantiate();
  let pending = cache.get(dspId);
  if (!pending) {
    pending = fetch(urls[dspId])
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.compile(bytes));
    cache.set(dspId, pending);
  }
  return factory.instantiate(await pending);
}
