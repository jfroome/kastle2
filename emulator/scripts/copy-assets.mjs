// Copies firmware user data (Wave Bard samples) from the repo into public/ so the browser can fetch it.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [{ from: "../code/src/apps/WaveBard/SAMPLES.bin", to: "public/firmware/wavebard-samples.bin" }];
for (const a of assets) {
  const from = resolve(root, a.from);
  if (!existsSync(from)) {
    console.warn(`skip ${a.from} (not found)`);
    continue;
  }
  mkdirSync(dirname(resolve(root, a.to)), { recursive: true });
  copyFileSync(from, resolve(root, a.to));
  console.log(`copied ${a.from} -> ${a.to}`);
}
