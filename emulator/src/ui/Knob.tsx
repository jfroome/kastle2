import { useEffect, useRef } from "react";

interface KnobProps {
  label: string;
  /** App value, 0..1 */
  value: number;
  /** Physical pot position 0..1; shown as a ghost marker when it differs from the value (pickup mode) */
  ghost?: number | null;
  frozen?: boolean;
  text: string;
  low?: string;
  high?: string;
  disabled?: boolean;
  /** Dial diameter in px */
  size?: number;
  /** Extra caption under the label (e.g. other-layer functions) */
  children?: React.ReactNode;
  /** Current value to start a drag / step from; must read live state, not render-time props */
  dragStart: () => number;
  onChange: (norm: number) => void;
  onReset: () => void;
}

const START = -135;
const SWEEP = 270;

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
};

const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};

export function Knob({ label, value, ghost, frozen, text, low, high, disabled, size = 80, children, dragStart, onChange, onReset }: KnobProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; start: number } | null>(null);
  const latest = useRef({ dragStart, onChange });
  latest.current = { dragStart, onChange };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.altKey ? 0.002 : 0.01;
      latest.current.onChange(Math.max(0, Math.min(1, latest.current.dragStart() - Math.sign(e.deltaY) * step)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const angle = START + SWEEP * value;
  const [ix, iy] = polar(40, 40, 22, angle);
  const [ox, oy] = polar(40, 40, 30, angle);
  const showGhost = ghost !== null && ghost !== undefined && Math.abs(ghost - value) > 0.012;

  return (
    <div className={`knob ${disabled ? "disabled" : ""}`} style={{ ["--knob-size" as string]: `${size}px` }}>
      <div
        ref={ref}
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={text}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, start: dragStart() };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const range = e.altKey ? 800 : 180;
          onChange(Math.max(0, Math.min(1, drag.current.start + (drag.current.y - e.clientY) / range)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={onReset}
        onKeyDown={(e) => {
          const step = e.altKey ? 0.1 : 0.01;
          const current = dragStart();
          if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(Math.min(1, current + step));
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(Math.max(0, current - step));
          else if (e.key === "Home") onChange(0);
          else if (e.key === "End") onChange(1);
          else return;
          e.preventDefault();
        }}
      >
        <svg viewBox="0 0 80 80" width="80" height="80">
          <path d={arc(40, 40, 34, START, START + SWEEP)} className="knob-track" />
          {value > 0.003 && <path d={arc(40, 40, 34, START, angle)} className="knob-fill" />}
          <circle cx="40" cy="40" r="25" className="knob-body" />
          <line x1={ix} y1={iy} x2={ox} y2={oy} className="knob-pointer" />
          {showGhost && (() => {
            const [gx, gy] = polar(40, 40, 38, START + SWEEP * ghost!);
            return <circle cx={gx} cy={gy} r="3" className={`knob-ghost ${frozen ? "frozen" : ""}`} />;
          })()}
        </svg>
      </div>
      <div className="knob-label">{label}</div>
      <div className="knob-value">{text}</div>
      <div className="knob-range">
        <span>{low ?? ""}</span>
        <span>{high ?? ""}</span>
      </div>
      {children}
    </div>
  );
}
