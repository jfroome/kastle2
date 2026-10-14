/// <reference path="./worklet-env.d.ts" />
import { FirmwareBoard } from "../firmware/board";
import { FirmwareStreamer } from "../firmware/runner";
import type { FromWorklet, ToWorklet } from "./messages";
import { PROCESSOR_NAME } from "./messages";

const REPORT_EVERY_QUANTA = 6;

/** Hosts the real firmware (wasm) on the audio thread. */
class FirmwareProcessor extends AudioWorkletProcessor {
  private board: FirmwareBoard | null = null;
  private streamer: FirmwareStreamer | null = null;
  private quanta = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ToWorklet>) => this.onMessage(event.data);
  }

  private post(message: FromWorklet): void {
    this.port.postMessage(message);
  }

  private onMessage(message: ToWorklet): void {
    if (message.type === "init") {
      this.board = null;
      FirmwareBoard.create({
        wasm: message.wasm,
        userData: message.userData ? new Uint8Array(message.userData) : undefined,
        eeprom: message.eeprom,
        analog: message.analog,
      })
        .then((board) => {
          Object.assign(board.panel, message.panel);
          board.boot();
          board.queue(message.script);
          this.board = board;
          this.streamer = new FirmwareStreamer(board);
          this.post({ type: "ready", name: board.name });
        })
        .catch((error: unknown) => this.post({ type: "error", message: String(error) }));
      return;
    }
    const board = this.board;
    if (!board) return;
    if (message.type === "panel") Object.assign(board.panel, message.panel);
    else if (message.type === "analog") board.analog = { ...board.analog, ...message.analog };
    else if (message.type === "actions") board.queue(message.actions);
    else if (message.type === "midi") board.midiIn(message.bytes);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const frames = out[0].length;
    const outL = out[0];
    const outR = out[1] ?? out[0];
    const streamer = this.streamer;
    if (!streamer || !this.board) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }
    const input = inputs[0];
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    streamer.process(inL, inR, outL, outR, frames);

    if (++this.quanta >= REPORT_EVERY_QUANTA) {
      this.quanta = 0;
      const l = streamer.levels;
      const n = Math.max(1, l.frames);
      this.post({
        type: "meters",
        inPeak: l.inPeak,
        outPeak: l.outPeak,
        inRms: Math.sqrt(l.inSumSq / n),
        outRms: Math.sqrt(l.outSumSq / n),
        board: this.board.state(),
      });
      streamer.resetMeters();
      const eeprom = this.board.takeEeprom();
      if (eeprom) this.post({ type: "eeprom", data: eeprom });
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, FirmwareProcessor);
