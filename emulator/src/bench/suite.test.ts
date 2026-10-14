import { describe, expect, it } from "vitest";
import { pinkNoise } from "../audio/generators";
import { nodeBenchEnv } from "./nodeEnv";
import { runBench } from "./suite";
import { runParamSweep } from "./sweep";

describe("bench suite (real firmware via wasm)", () => {
  for (const id of ["masterblaster", "wavebard", "examplesynth", "template"]) {
    it(`passes every test for ${id}`, async () => {
      const results = await runBench(nodeBenchEnv(id));
      for (const r of results) console.log(`${id} ${r.pass ? (r.warn ? "WARN" : "PASS") : "FAIL"} ${r.name}: ${r.detail} (${r.durationMs.toFixed(0)} ms)`);
      expect(results.length).toBeGreaterThanOrEqual(5);
      expect(results.filter((r) => !r.pass).map((r) => `${r.name}: ${r.detail}`)).toEqual([]);
    }, 300_000);
  }

  it("param sweep follows the knob (comp raises loudness through the firmware)", async () => {
    const env = nodeBenchEnv("masterblaster");
    const control = env.app.controls.find((c) => c.key === "drive")!;
    const base = Object.fromEntries(env.app.controls.map((c) => [c.key, c.default]));
    const pts = await runParamSweep(env, control, pinkNoise(3, -24), base, 4);
    expect(pts).toHaveLength(4);
    expect(pts[3].outRmsDb).toBeGreaterThan(pts[0].outRmsDb);
  }, 120_000);
});
