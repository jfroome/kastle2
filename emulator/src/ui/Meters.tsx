import { useRef } from "react";
import { useEmu } from "./useEmu";

const toDb = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
const pctOf = (db: number, min = -60) => `${Math.max(0, Math.min(100, ((db - min) / -min) * 100))}%`;

function Bar({ label, db, hold, danger }: { label: string; db: number; hold: number; danger?: boolean }) {
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-bar">
        <div className={`meter-fill ${danger ? "danger" : ""}`} style={{ width: pctOf(db) }} />
        <div className="meter-hold" style={{ left: pctOf(hold) }} />
      </div>
      <span className="meter-num">{db > -100 ? db.toFixed(1) : "-∞"}</span>
    </div>
  );
}

/** Levels at the jacks (after the codec model): what goes into the firmware and what comes out. */
export function Meters() {
  const emu = useEmu();
  const m = emu.meters;
  const hold = useRef({ in: -120, out: -120, t: 0 });
  const now = performance.now();
  const inDb = toDb(m.inPeak);
  const outDb = toDb(m.outPeak);
  if (now - hold.current.t > 1500 || inDb > hold.current.in) hold.current.in = inDb;
  if (now - hold.current.t > 1500 || outDb > hold.current.out) hold.current.out = outDb;
  if (now - hold.current.t > 1500) hold.current.t = now;
  return (
    <div className="meters">
      <Bar label="IN peak" db={inDb} hold={hold.current.in} />
      <Bar label="OUT peak" db={outDb} hold={hold.current.out} danger={outDb > -1} />
      <Bar label="IN rms" db={toDb(m.inRms)} hold={-120} />
      <Bar label="OUT rms" db={toDb(m.outRms)} hold={-120} />
    </div>
  );
}
