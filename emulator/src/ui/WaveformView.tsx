import { useEffect, useRef } from "react";
import type { WaveformPeaks } from "../audio/analysis";
import { useEmuRef } from "./useEmu";

function drawPeaks(ctx: CanvasRenderingContext2D, peaks: WaveformPeaks, w: number, h: number, mid: number, amp: number, color: string) {
  ctx.fillStyle = color;
  const n = peaks.min.length;
  for (let x = 0; x < w; x++) {
    const i = Math.min(n - 1, Math.floor((x / w) * n));
    const top = mid - peaks.max[i] * amp;
    const bottom = mid - peaks.min[i] * amp;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
  void h;
}

/** Overview of the loaded track (input) overlaid with the offline-rendered output, with a seekable playhead. */
export function WaveformView() {
  const emu = useEmuRef();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const el = canvas.current;
      if (el) {
        const dpr = window.devicePixelRatio || 1;
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (el.width !== Math.round(w * dpr)) {
          el.width = Math.round(w * dpr);
          el.height = Math.round(h * dpr);
        }
        const ctx = el.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#12161c";
        ctx.fillRect(0, 0, w, h);
        const mid = h / 2;
        ctx.fillStyle = "#222a34";
        ctx.fillRect(0, mid, w, 1);
        if (emu.inputPeaks) drawPeaks(ctx, emu.inputPeaks, w, h, mid, mid * 0.92, "#5d6b7e");
        if (emu.report) drawPeaks(ctx, emu.report.outputPeaks, w, h, mid, mid * 0.92, "rgba(255,170,60,0.75)");
        const dur = emu.engine.duration;
        if (dur > 0) {
          const x = (emu.engine.position / dur) * w;
          ctx.fillStyle = "#fff";
          ctx.fillRect(x, 0, 1.5, h);
        }
        if (emu.rendering !== null) {
          ctx.fillStyle = "rgba(255,170,60,0.9)";
          ctx.fillRect(0, h - 3, w * emu.rendering, 3);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [emu]);

  return (
    <div className="viz">
      <div className="viz-title">
        Waveform <span className="legend-chip in">input</span> <span className="legend-chip out">processed (offline render)</span>
      </div>
      <canvas
        ref={canvas}
        className="waveform"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          emu.engine.seek(((e.clientX - rect.left) / rect.width) * emu.engine.duration);
        }}
      />
    </div>
  );
}
