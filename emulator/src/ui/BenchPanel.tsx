import { useState } from "react";
import { BENCH_TESTS } from "../bench/suite";
import type { SweepPoint } from "../bench/sweep";
import { useEmu } from "./useEmu";

interface Series {
  name: string;
  color: string;
  values: number[];
}

function LineChart({ points, series, yLabel }: { points: SweepPoint[]; series: Series[]; yLabel: string }) {
  const W = 560;
  const H = 180;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(1e-6, hi - lo);
  const x = (i: number) => 40 + (i / (points.length - 1)) * (W - 50);
  const y = (v: number) => 10 + (1 - (v - lo) / span) * (H - 35);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`}>
      <text x="4" y="14" className="chart-text">{hi.toFixed(1)}</text>
      <text x="4" y={H - 22} className="chart-text">{lo.toFixed(1)}</text>
      <text x={W / 2} y={H - 4} className="chart-text" textAnchor="middle">knob 0 → 100%   ({yLabel})</text>
      {series.map((s) => (
        <polyline
          key={s.name}
          fill="none"
          stroke={s.color}
          strokeWidth="2"
          points={s.values.map((v, i) => `${x(i)},${y(Number.isFinite(v) ? v : lo)}`).join(" ")}
        />
      ))}
      {series.map((s, i) => (
        <text key={s.name} x={50 + i * 120} y="14" fill={s.color} className="chart-text">
          ● {s.name}
        </text>
      ))}
    </svg>
  );
}

export function BenchPanel() {
  const emu = useEmu();
  const controls = emu.app.controls.filter((c) => c.owner === "app");
  const [key, setKey] = useState(controls[0]?.key ?? "");
  const control = controls.find((c) => c.key === key) ?? controls[0];
  const applicable = BENCH_TESTS.filter((t) => t.appliesTo(emu.benchEnv()));
  const sweep = emu.sweepResult;
  return (
    <div className="bench">
      <div className="bench-section">
        <div className="render-actions">
          <button className="primary" disabled={emu.benchRunning} onClick={() => void emu.runBench()}>
            {emu.benchRunning ? "Running…" : `Run ${applicable.length} firmware tests`}
          </button>
          <span className="hint">
            Cold-boots the real firmware (and, for MasterBlaster, its DSP on its own) with synthetic signals. Tests use fixed settings and don't touch your knobs.
          </span>
        </div>
        <table className="tests">
          <tbody>
            {applicable.map((t) => {
              const r = emu.benchResults.find((x) => x.id === t.id);
              const state = !r ? "pending" : !r.pass ? "fail" : r.warn ? "warn" : "pass";
              return (
                <tr key={t.id} className={state}>
                  <td className="status">{state === "pending" ? "·" : state === "pass" ? "✔" : state === "warn" ? "⚠" : "✘"}</td>
                  <td>
                    <b title={t.description}>{t.name}</b>
                    <div className="detail">{r ? r.detail : t.description}</div>
                  </td>
                  <td className="ms">{r ? `${r.durationMs.toFixed(0)} ms` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {emu.benchResults.length > 0 && !emu.benchRunning && (
          <p className="summary">
            {emu.benchResults.filter((r) => r.pass).length}/{emu.benchResults.length} passed
            {emu.benchResults.some((r) => r.warn) ? `, ${emu.benchResults.filter((r) => r.warn).length} with warnings` : ""}
          </p>
        )}
      </div>

      <div className="bench-section">
        <div className="render-actions">
          <b>Parameter sweep</b>
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {controls.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <button disabled={(!emu.track && !emu.info.generatesSound) || emu.sweepRunning !== null || !control} onClick={() => control && void emu.runSweep(control)}>
            {emu.sweepRunning !== null ? `Sweeping ${Math.round(emu.sweepRunning * 100)}%…` : "Sweep over the loaded track"}
          </button>
          <span className="hint">Cold-boots the firmware at 17 positions of one knob (others as set now) and renders the first ≤6 s of the track, or a performance for synths.</span>
        </div>
        {sweep && (
          <>
            <h4>{sweep.control.label}: output level</h4>
            <LineChart
              points={sweep.points}
              yLabel="dB"
              series={[
                { name: "RMS", color: "#ffaa3c", values: sweep.points.map((p) => p.outRmsDb) },
                { name: "Peak", color: "#7fb4ff", values: sweep.points.map((p) => p.outPeakDb) },
                { name: "LUFS", color: "#8fe388", values: sweep.points.map((p) => p.lufs) },
              ]}
            />
            <table className="stats compact">
              <thead>
                <tr>
                  <th>{sweep.control.label}</th>
                  <th>RMS</th>
                  <th>Peak</th>
                  <th>LUFS</th>
                </tr>
              </thead>
              <tbody>
                {sweep.points.map((p) => (
                  <tr key={p.value}>
                    <td>{p.label}</td>
                    <td>{p.outRmsDb.toFixed(1)}</td>
                    <td>{p.outPeakDb.toFixed(1)}</td>
                    <td>{Number.isFinite(p.lufs) ? p.lufs.toFixed(1) : "-∞"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
