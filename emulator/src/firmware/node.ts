// Node-only helpers (tests, scripts)
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FirmwareBoard, type BoardConfig } from "./board";
import { getFirmwareInfo } from "./registry";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export function nodeWasm(id: string): ArrayBuffer {
  const buf = readFileSync(here(`./${id}.wasm`));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function nodeUserData(id: string): Uint8Array | undefined {
  const info = getFirmwareInfo(id);
  if (!info.userData) return undefined;
  const path = here("../../../code/src/apps/WaveBard/SAMPLES.bin");
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
}

export async function createNodeBoard(id: string, config: Partial<BoardConfig> = {}): Promise<FirmwareBoard> {
  return FirmwareBoard.create({ wasm: nodeWasm(id), userData: nodeUserData(id), ...config });
}
