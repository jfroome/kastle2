// Records what the published .uf2 was built from, shown next to the download button.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uf2 = resolve(root, "public/firmware/kastle2-master-blaster.uf2");
const sources = ["code/src/apps/MasterBlaster", "code/src/common"].map((p) => resolve(root, "..", p));
let sourceHash = "";
try {
  const files = execSync(`find ${sources.join(" ")} -type f \\( -name '*.cpp' -o -name '*.hpp' -o -name '*.txt' \\) | sort`, { encoding: "utf8" }).trim().split("\n");
  const h = createHash("sha256");
  for (const f of files) h.update(readFileSync(f));
  sourceHash = h.digest("hex").slice(0, 12);
} catch {
  /* optional */
}
const manifest = {
  file: "kastle2-master-blaster.uf2",
  bytes: statSync(uf2).size,
  sha256: createHash("sha256").update(readFileSync(uf2)).digest("hex"),
  builtAt: new Date().toISOString(),
  sourceHash,
};
writeFileSync(resolve(root, "src/firmware/uf2-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest);
