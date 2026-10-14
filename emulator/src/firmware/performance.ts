import type { FirmwareBoard } from "./board";

export interface Performance {
  id: string;
  label: string;
  /** Drives MIDI/gates on the board; call before each block with the time in seconds */
  beforeBlock(t: number, board: FirmwareBoard): void;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

/** Minor arpeggio, eighth notes at 120 BPM: MIDI note on/off plus a TRIG pulse for each note. */
export function arpeggio(): Performance {
  const notes = [48, 51, 55, 60, 63, 60, 55, 51];
  let step = -1;
  let current = -1;
  return {
    id: "arp",
    label: "C minor arpeggio (MIDI + TRIG, 120 BPM)",
    beforeBlock(t, board) {
      const s = Math.floor(t / 0.25);
      const into = t - s * 0.25;
      if (s !== step) {
        if (current >= 0) board.midiIn([NOTE_OFF, current, 0]);
        step = s;
        current = notes[s % notes.length];
        board.midiIn([NOTE_ON, current, 100]);
      }
      board.panel.trig = into < 0.03;
    },
  };
}

/** TRIG pulses only (4 per second), for firmwares that play from the gate jack. */
export function gateTrain(): Performance {
  return {
    id: "gates",
    label: "TRIG pulses (4 per second)",
    beforeBlock(t, board) {
      board.panel.trig = t % 0.25 < 0.03;
    },
  };
}

export const PERFORMANCES: { id: string; label: string; make: () => Performance }[] = [
  { id: "arp", label: "C minor arpeggio (MIDI + TRIG)", make: arpeggio },
  { id: "gates", label: "TRIG pulses (4/s)", make: gateTrain },
];
