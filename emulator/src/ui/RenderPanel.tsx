import type { SignalStats } from "../audio/analysis";
import { PERFORMANCES } from "../firmware/performance";
import { download } from "./PresetBar";
import { useEmu } from "./useEmu";

const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-∞");

interface Row {
  label: string;
  a: string;
  b: string;
  delta?: string;
  warn?: boolean;
}

function rows(a: SignalStats | null, b: SignalStats): Row[] {
  const delta = (x: number, y: number) => (Number.isFinite(x) && Number.isFinite(y) ? `${y - x >= 0 ? "+" : ""}${(y - x).toFixed(1)}` : "");
  if (!a) {
    return [
      { label: "Integrated loudness (LUFS)", a: "", b: f(b.lufs) },
      { label: "Sample peak (dBFS)", a: "", b: f(b.peakDb), warn: b.peakDb > -0.3 },
      { label: "RMS (dBFS)", a: "", b: f(b.rmsDb) },
      { label: "Crest factor (dB)", a: "", b: f(b.crestDb) },
      { label: "Stereo correlation", a: "", b: f(b.correlation, 3) },
      { label: "DC offset", a: "", b: b.dcOffset.toExponential(1) },
      { label: "Clipped samples", a: "", b: String(b.clippedSamples), warn: b.clippedSamples > 0 },
    ];
  }
  return [
    { label: "Integrated loudness (LUFS)", a: f(a.lufs), b: f(b.lufs), delta: delta(a.lufs, b.lufs) },
    { label: "Sample peak (dBFS)", a: f(a.peakDb), b: f(b.peakDb), delta: delta(a.peakDb, b.peakDb), warn: b.peakDb > -0.3 },
    { label: "RMS (dBFS)", a: f(a.rmsDb), b: f(b.rmsDb), delta: delta(a.rmsDb, b.rmsDb) },
    { label: "Crest factor (dB)", a: f(a.crestDb), b: f(b.crestDb), delta: delta(a.crestDb, b.crestDb) },
    { label: "Stereo correlation", a: f(a.correlation, 3), b: f(b.correlation, 3) },
    { label: "DC offset", a: a.dcOffset.toExponential(1), b: b.dcOffset.toExponential(1) },
    { label: "Clipped samples", a: String(a.clippedSamples), b: String(b.clippedSamples), warn: b.clippedSamples > 0 },
  ];
}

/** Offline render of the whole loaded file through the firmware DSP, with before/after statistics and export. */
export function RenderPanel() {
  const emu = useEmu();
  const report = emu.report;
  return (
    <div className="render-panel">
      <div className="render-actions">
        {emu.info.generatesSound && (
          <>
            <select value={emu.performanceId} onChange={(e) => ((emu.performanceId = e.target.value), emu.emit())}>
              {PERFORMANCES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <label className="check">
              seconds
              <input type="number" min={1} max={60} value={emu.renderSeconds} style={{ width: 52 }} onChange={(e) => ((emu.renderSeconds = Math.max(1, Math.min(60, Number(e.target.value)))), emu.emit())} />
            </label>
          </>
        )}
        <button className="primary" disabled={(!emu.track && !emu.info.generatesSound) || emu.rendering !== null} onClick={() => void emu.renderAndAnalyze()}>
          {emu.rendering !== null ? `Rendering ${Math.round(emu.rendering * 100)}%…` : "Render & analyze"}
        </button>
        <label className="check">
          <input type="checkbox" checked={emu.autoRender} onChange={(e) => emu.setAutoRender(e.target.checked)} />
          auto re-render on changes
        </label>
        <span className="spacer" />
        {([16, 24, 32] as const).map((bits) => (
          <button
            key={bits}
            disabled={!emu.track && !emu.info.generatesSound}
            onClick={async () => download(`${emu.track?.name ?? "track"}-${emu.app.id}.wav`, await emu.exportWav(bits))}
            title="Render the whole track and download it as WAV"
          >
            Export WAV {bits === 32 ? "32f" : bits}
          </button>
        ))}
      </div>
      {!report && <p className="hint">Cold-boots the same firmware in the background, replays your knob positions as panel gestures and renders {emu.info.generatesSound ? "a MIDI/TRIG performance" : "the whole track"}, faster than real time. CV automation and the codec gain model are included.</p>}
      {report && (
        <table className="stats">
          <thead>
            <tr>
              <th>Measurement</th>
              <th>Input</th>
              <th>Output ({report.appName})</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows(report.inputStats, report.outputStats).map((r) => (
              <tr key={r.label} className={r.warn ? "warn-row" : ""}>
                <td>{r.label}</td>
                <td>{r.a}</td>
                <td>{r.b}</td>
                <td>{r.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
