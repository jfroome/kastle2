import beadsUrl from "./beads.wasm?url";
import examplesynthUrl from "./examplesynth.wasm?url";
import masterblasterUrl from "./masterblaster.wasm?url";
import templateUrl from "./template.wasm?url";
import wavebardUrl from "./wavebard.wasm?url";

const wasmUrls: Record<string, string> = {
  masterblaster: masterblasterUrl,
  beads: beadsUrl,
  examplesynth: examplesynthUrl,
  wavebard: wavebardUrl,
  template: templateUrl,
};
const cache = new Map<string, Promise<ArrayBuffer>>();

/** Browser: fetch a firmware binary (cached). */
export function loadFirmwareWasm(id: string): Promise<ArrayBuffer> {
  let pending = cache.get(id);
  if (!pending) {
    const url = wasmUrls[id];
    if (!url) return Promise.reject(new Error(`No wasm for firmware '${id}'`));
    pending = fetch(url).then((r) => r.arrayBuffer());
    cache.set(id, pending);
  }
  return pending;
}

/** Browser: fetch the bundled user data (e.g. Wave Bard samples) from public/firmware/. */
export async function loadUserData(file: string): Promise<Uint8Array | undefined> {
  const response = await fetch(`${import.meta.env.BASE_URL}firmware/${file}`);
  if (!response.ok || (response.headers.get("content-type") ?? "").includes("text/html")) return undefined;
  return new Uint8Array(await response.arrayBuffer());
}
