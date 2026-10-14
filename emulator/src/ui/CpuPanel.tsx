import profile from "../cpu/profile.json";
import { useEmu } from "./useEmu";

interface Stats { mean: number; p99: number; max: number }
interface Scenario { name: string; description: string; core0_audio: Stats; ui_loop_iteration: Stats }
type Profile = { budget_cycles_per_block: number; clock_hz: number; model: string; apps: Record<string, { scenarios: Scenario[] }> };

/** Cycle counts of the real firmware on the RP2040, from cpu/profile.py (instruction-set simulation of the ARM build). */
export function CpuPanel() {
  const emu = useEmu();
  const data = profile as unknown as Profile;
  const app = data.apps[emu.app.firmwareId];
  if (!app) return null;
  const budget = data.budget_cycles_per_block;
  const worst = Math.max(...app.scenarios.map((s) => s.core0_audio.max));
  return (
    <section className="panel">
      <h3>CPU headroom (estimate)</h3>
      <p className="summary">
        Worst case {Math.round(worst).toLocaleString()} cycles per 48-sample block = {((100 * worst) / budget).toFixed(1)} % of the {budget.toLocaleString()} available at {data.clock_hz / 1e6} MHz
      </p>
      <table className="stats compact">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Audio mean</th>
            <th>Audio max</th>
            <th>% of budget</th>
            <th>UI loop pass</th>
          </tr>
        </thead>
        <tbody>
          {app.scenarios.map((s) => (
            <tr key={s.name} title={s.description}>
              <td>{s.name}</td>
              <td>{Math.round(s.core0_audio.mean).toLocaleString()}</td>
              <td>{Math.round(s.core0_audio.max).toLocaleString()}</td>
              <td>{((100 * s.core0_audio.max) / budget).toFixed(1)} %</td>
              <td>{Math.round(s.ui_loop_iteration.mean).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Includes the whole audio interrupt (Base gain stages, MasterBlaster chain, limiter). {data.model}. Regenerate with <code>cpu/build_arm.sh</code> and <code>cpu/profile.py</code>.</p>
    </section>
  );
}
