import type { CvShape } from "../core/cv";
import { ADC_1V } from "../core/constants";
import { useEmu } from "./useEmu";

const SHAPES: CvShape[] = ["dc", "sine", "triangle", "square", "saw", "random"];

/** CV for the jacks this firmware uses: a patched jack gets a DC voltage or an LFO. */
export function CvPanel() {
  const emu = useEmu();
  if (emu.app.jacks.length === 0) return null;
  const state = emu.boardState;
  return (
    <section className="panel">
      <h3>CV jacks</h3>
      <div className="cv-grid">
        {emu.app.jacks.filter((j) => !j.gate).map((jack) => {
          const ch = emu.cv[jack.input];
          if (!ch) return null;
          const [lo, hi] = jack.range ?? [-5, 5];
          const volts = emu.panel.volts[jack.input] ?? 0;
          const adc = state && jack.input === "PARAM_1" ? state.paramAdc[0] : state && jack.input === "PARAM_2" ? state.paramAdc[1] : state && jack.input === "PARAM_3" ? state.paramAdc[2] : null;
          return (
            <div className={`cv ${ch.patched ? "patched" : ""}`} key={jack.input}>
              <div className="cv-head">
                <label className="check" title={jack.description}>
                  <input type="checkbox" checked={ch.patched} onChange={(e) => emu.setCv(jack.input, { patched: e.target.checked })} />
                  <b>{jack.label}</b>
                </label>
                <span className="cv-volts" title={adc !== null ? `firmware reads ${adc} ADC units` : undefined}>
                  {volts >= 0 ? "+" : ""}
                  {volts.toFixed(2)} V
                </span>
              </div>
              {ch.patched && (
                <div className="cv-body">
                  <select value={ch.shape} onChange={(e) => emu.setCv(jack.input, { shape: e.target.value as CvShape })}>
                    {SHAPES.map((s) => (
                      <option key={s} value={s}>
                        {s === "dc" ? "DC voltage" : s}
                      </option>
                    ))}
                  </select>
                  <label>
                    {ch.shape === "dc" ? "Level" : "Offset"} {ch.offset.toFixed(1)} V
                    <input type="range" min={lo} max={hi} step={0.05} value={ch.offset} onChange={(e) => emu.setCv(jack.input, { offset: Number(e.target.value) })} />
                  </label>
                  {ch.shape !== "dc" && (
                    <>
                      <label>
                        Depth ±{ch.depth.toFixed(1)} V
                        <input type="range" min={0} max={hi} step={0.1} value={ch.depth} onChange={(e) => emu.setCv(jack.input, { depth: Number(e.target.value) })} />
                      </label>
                      <label>
                        Rate {ch.rateHz.toFixed(2)} Hz
                        <input type="range" min={0.05} max={10} step={0.05} value={ch.rateHz} onChange={(e) => emu.setCv(jack.input, { rateHz: Number(e.target.value) })} />
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="hint">
        Voltages go through the Citadel's analog front end (inverting input stage, calibration curves) into the firmware's own ADC code ({ADC_1V} units per volt). Unpatched jacks read 0 V. Offline renders include the CV automation.
      </p>
    </section>
  );
}
