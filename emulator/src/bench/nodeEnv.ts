// Node-only: a BenchEnv backed by the wasm files on disk (tests, CLI).
import { ALL_APPS } from "../apps/registry";
import { controlDefaults } from "../core/app";
import { PARAM_MAX } from "../core/constants";
import { loadNodeDsp } from "../dsp/node";
import { knobScript } from "../firmware/panelScript";
import { createNodeBoard } from "../firmware/node";
import { getFirmwareInfo } from "../firmware/registry";
import type { BenchEnv } from "./suite";

export function nodeBenchEnv(appId: string): BenchEnv {
  const entry = ALL_APPS.find((a) => a.id === appId)!;
  const app = entry.create();
  const info = getFirmwareInfo(app.firmwareId);
  return {
    app,
    freshApp: () => entry.create(),
    newDsp: () => loadNodeDsp(app.dspId ?? "masterblaster"),
    newBoard: async (knobs, analog) => {
      const values = knobs ?? controlDefaults(app);
      const board = await createNodeBoard(info.id, { analog });
      for (const c of app.controls) {
        if (c.layer === "NORMAL" && !c.unused) board.setPot(c.pot, (values[c.key] ?? c.default) / PARAM_MAX);
      }
      board.boot();
      board.queue(knobScript(app.controls, values, board.panel.pots));
      return board;
    },
    latencySamples: info.latencySamples,
    generatesSound: info.generatesSound,
  };
}
