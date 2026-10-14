import type { Layer } from "../firmware/board";
import { useEmu } from "./useEmu";

const LAYERS: Layer[] = ["NORMAL", "SHIFT", "MODE"];

/** Knob map, jack/LED table and signal flow, generated from the app spec so it never drifts from the emulator. */
export function ReferencePanel() {
  const emu = useEmu();
  const { app } = emu;
  return (
    <div className="reference">
      <h4>Signal flow</h4>
      <div className="chain">
        {app.stages.map((s, i) => (
          <div className="stage" key={s.name}>
            <div className="stage-box">
              <b>{s.name}</b>
              <span>{s.detail}</span>
            </div>
            {i < app.stages.length - 1 && <span className="arrow">▶</span>}
          </div>
        ))}
      </div>

      <h4>Knobs</h4>
      <table className="stats compact map">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 7 }, (_, i) => (
              <th key={i}>K{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LAYERS.map((layer) => (
            <tr key={layer}>
              <th>{layer === "NORMAL" ? "Normal" : layer === "SHIFT" ? "SHIFT held" : "MODE held"}</th>
              {Array.from({ length: 7 }, (_, pot) => {
                const c = app.controls.find((x) => x.pot === pot && x.layer === layer);
                return (
                  <td key={pot} className={c ? (c.unused ? "dim" : c.owner === "platform" ? "platform" : "app") : "dim"} title={c?.description}>
                    {c ? c.label : layer === "MODE" ? "base" : "—"}
                    {c && !c.unused && (c.low || c.high) && (
                      <small>
                        {c.low} → {c.high}
                      </small>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="notes">
        {app.controls
          .filter((c) => !c.unused)
          .map((c) => (
            <li key={c.layer + c.key}>
              <b>
                {c.layer === "NORMAL" ? "" : c.layer === "SHIFT" ? "SHIFT+" : "MODE+"}K{c.pot + 1} {c.label}
              </b>{" "}
              — {c.description}
            </li>
          ))}
      </ul>
      <p className="hint">
        <b>SHIFT:</b> {app.buttons.shift} <b>MODE:</b> {app.buttons.mode} Moving a knob after a layer change picks it up again (the module freezes pots until they move by more than 48/4095).
      </p>

      {app.jacks.length > 0 && (
        <>
          <h4>Jacks</h4>
          <table className="stats compact">
            <tbody>
              {app.jacks.map((j) => (
                <tr key={j.input}>
                  <td><b>{j.label}</b></td>
                  <td>{j.description}</td>
                </tr>
              ))}
              <tr>
                <td><b>IN L / R, OUT L / R</b></td>
                <td>Stereo audio at 44 kHz, processed as Q15 integers by the real firmware.</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {app.leds.length > 0 && (
        <>
          <h4>LEDs</h4>
          <table className="stats compact">
            <tbody>
              {app.leds.map((l) => (
                <tr key={l.index}>
                  <td><b>{l.label}</b></td>
                  <td>{l.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
