// Records what each published .uf2 was built from, shown next to the download button.
// Usage: node write-firmware-manifest.mjs <master-blaster|beads>
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = {
  "master-blaster": { appId: "masterblaster", sourceDir: "MasterBlaster" },
  beads: { appId: "beads", sourceDir: "Beads" },
};
const target = process.argv[2];
if (!TARGETS[target]) {
  console.error(`usage: write-firmware-manifest.mjs <${Object.keys(TARGETS).join("|")}>`);
  process.exit(1);
}
const { appId, sourceDir } = TARGETS[target];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = `kastle2-${target}.uf2`;
const uf2 = resolve(root, "public/firmware", file);
const sources = [`code/src/apps/${sourceDir}`, "code/src/common"].map((p) => resolve(root, "..", p));
let sourceHash = "";
try {
  const files = execSync(`find ${sources.join(" ")} -type f \\( -name '*.cpp' -o -name '*.hpp' -o -name '*.txt' \\) | sort`, { encoding: "utf8" }).trim().split("\n");
  const h = createHash("sha256");
  for (const f of files) h.update(readFileSync(f));
  sourceHash = h.digest("hex").slice(0, 12);
} catch {
  /* optional */
}
const manifestPath = resolve(root, "src/firmware/uf2-manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const apps = manifest.apps ?? (manifest.file ? { masterblaster: { ...manifest } } : {});
apps[appId] = {
  file,
  bytes: statSync(uf2).size,
  sha256: createHash("sha256").update(readFileSync(uf2)).digest("hex"),
  builtAt: new Date().toISOString(),
  sourceHash,
};
writeFileSync(manifestPath, JSON.stringify({ apps }, null, 2) + "\n");
console.log(appId, apps[appId]);
