import { useEffect } from "react";
import { useEmu } from "./useEmu";

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };
const KEYMAP: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };
const BASE = 48; // C3

/** On-screen / computer keyboard sending MIDI notes (and the TRIG jack) to firmwares that play sounds. */
export function Keys() {
  const emu = useEmu();
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;
      const n = KEYMAP[e.key.toLowerCase()];
      if (n !== undefined) {
        void emu.engine.ensure();
        emu.noteOn(BASE + 12 + n);
      }
    };
    const up = (e: KeyboardEvent) => {
      const n = KEYMAP[e.key.toLowerCase()];
      if (n !== undefined) emu.noteOff(BASE + 12 + n);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [emu]);

  const octaves = [0, 1];
  const press = (note: number) => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    void emu.engine.ensure().then(() => emu.noteOn(note));
  };
  return (
    <section className="panel">
      <h3>Play (MIDI notes)</h3>
      <div className="keys">
        {octaves.flatMap((o) =>
          WHITE.map((semi, i) => {
            const note = BASE + 12 * o + semi;
            return (
              <button key={note} className={`key white ${emu.heldNotes.has(note) ? "down" : ""}`} style={{ left: `${((o * 7 + i) / 14) * 100}%`, width: `${100 / 14}%` }} onPointerDown={press(note)} onPointerUp={() => emu.noteOff(note)} onPointerCancel={() => emu.noteOff(note)} aria-label={`note ${note}`} />
            );
          }),
        )}
        {octaves.flatMap((o) =>
          Object.entries(BLACK).map(([idx, semi]) => {
            const note = BASE + 12 * o + semi;
            return (
              <button key={note} className={`key black ${emu.heldNotes.has(note) ? "down" : ""}`} style={{ left: `${((o * 7 + Number(idx) + 1) / 14) * 100 - 2.2}%`, width: "4.4%" }} onPointerDown={press(note)} onPointerUp={() => emu.noteOff(note)} onPointerCancel={() => emu.noteOff(note)} aria-label={`note ${note}`} />
            );
          }),
        )}
      </div>
      <p className="hint">
        Computer keys <kbd>A</kbd>–<kbd>K</kbd> (white) and <kbd>W E T Y U</kbd> (black) play C4–C5. Hold the TRIG jack on the faceplate for a gate. The firmware receives real MIDI bytes on its UART input.
      </p>
    </section>
  );
}
