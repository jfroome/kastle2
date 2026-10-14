import { useEmu } from "./useEmu";

const dbText = (d: number) => (Number.isFinite(d) ? `${d >= 0 ? "+" : ""}${d.toFixed(2)} dB` : "mute");

/** Codec registers the firmware programmed and the analogue level calibration around them. */
export function AnalogPanel() {
  const emu = useEmu();
  const c = emu.boardState?.codec;
  return (
    <section className="panel">
      <h3>Codec &amp; gain staging</h3>
      <table className="stats compact">
        <tbody>
          <tr><td>Input PGA (NAU88C22)</td><td>{c ? dbText(c.pgaDb[0]) : "—"}</td><td className="muted">-12…+35.25 dB, 0.75 dB steps, set by SHIFT+K1</td></tr>
          <tr><td>ADC digital volume</td><td>{c ? dbText(c.adcDigitalDb[0]) : "—"}</td><td className="muted">firmware writes 0xF0</td></tr>
          <tr><td>DAC digital volume</td><td>{c ? dbText(c.dacDigitalDb[0]) : "—"}</td><td className="muted">0xFF = 0 dB</td></tr>
          <tr><td>Headphone / line-out volume</td><td>{c ? dbText(c.hpDb[0]) : "—"}</td><td className="muted">1 dB steps, set by SHIFT+K5</td></tr>
        </tbody>
      </table>
      <div className="analog-controls">
        <label>
          Input level trim {emu.analog.inputTrimDb.toFixed(1)} dB
          <input type="range" min={-60} max={0} step={0.5} value={emu.analog.inputTrimDb} onChange={(e) => emu.setAnalog({ inputTrimDb: Number(e.target.value) })} />
        </label>
        <label>
          Output level trim {emu.analog.outputTrimDb.toFixed(1)} dB
          <input type="range" min={0} max={48} step={0.5} value={emu.analog.outputTrimDb} onChange={(e) => emu.setAnalog({ outputTrimDb: Number(e.target.value) })} />
        </label>
        <label className="check" title="Converter noise (ADC SNR 89 dB, DAC ~98 dB) and about -78 dB THD, from the codec datasheet">
          <input type="checkbox" checked={emu.analog.nonIdeal} onChange={(e) => emu.setAnalog({ nonIdeal: e.target.checked })} />
          converter noise &amp; distortion (datasheet)
        </label>
        <button onClick={() => emu.setAnalog({ inputTrimDb: -24.48, outputTrimDb: 24 })}>Calibrate: factory knobs = unity</button>
      </div>
      <p className="hint">
        The firmware programs the real codec registers; the emulator turns them into gains. The level at the jacks is not in the firmware, so the trims are calibrated so factory gain knobs (EEPROM default 160) pass a full-scale file at unity. The analogue DC offsets that the firmware removes (+0.01 in, -0.008 out) are modelled.
      </p>
    </section>
  );
}
