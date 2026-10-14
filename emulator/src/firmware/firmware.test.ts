import { describe, expect, it } from "vitest";
import { analyze } from "../audio/analysis";
import { sine } from "../audio/generators";
import { FirmwareBoard } from "./board";
import { createNodeBoard } from "./node";
import { renderFirmware } from "./runner";

async function booted(id: string, setup?: (b: FirmwareBoard) => void): Promise<FirmwareBoard> {
  const board = await createNodeBoard(id);
  setup?.(board);
  board.boot();
  return board;
}

describe("real firmware on the emulated board", () => {
  it("boots all firmwares as a Citadel", async () => {
    for (const id of ["masterblaster", "wavebard", "examplesynth", "template"]) {
      const board = await booted(id);
      expect(board.isCitadel).toBe(true);
      const out = await renderFirmware(board, null, { frames: 44000 / 2 });
      expect(out.left.length).toBe(22000);
    }
  }, 60_000);

  it("template at factory gain staging passes audio at unity (calibrated trims)", async () => {
    const board = await booted("template");
    const input = sine(1000, 1, -12);
    const out = await renderFirmware(board, input, { warmupSec: 4 });
    const a = analyze({ ...out, left: out.left.slice(8000), right: out.right.slice(8000) });
    const state = board.state();
    expect(state.codec.pgaDb[0]).toBeCloseTo(18, 1);
    expect(a.rmsDb).toBeCloseTo(-15, 0);
  });
});
