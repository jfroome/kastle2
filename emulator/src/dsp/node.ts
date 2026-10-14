// Node-only helpers (tests, scripts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDspFactory } from "./registry";
import type { DspInstance } from "./types";

export async function loadNodeDsp(id: string): Promise<DspInstance> {
  const factory = getDspFactory(id);
  if (!factory.needsWasm) {
    return factory.instantiate();
  }
  const bytes = readFileSync(fileURLToPath(new URL(`./${id}.wasm`, import.meta.url)));
  return factory.instantiate(await WebAssembly.compile(bytes));
}
