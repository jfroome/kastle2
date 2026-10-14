import { useEffect, useRef, useState } from "react";
import { bandFrequencies } from "../audio/analysis";
import { useEmuRef } from "./useEmu";

const DB_MIN = -100;
const DB_MAX = 0;
const BANDS = 64;
const FREQS = bandFrequencies(BANDS);

function path(ctx: CanvasRenderingContext2D, values: ArrayLike<number>, w: number, h: number, offsetDb: number) {
  ctx.beginPath();
  for (let i = 0; i < BANDS; i++) {
    const x = (i / (BANDS - 1)) * w;
    const y = h - ((Math.max(DB_MIN, Math.min(DB_MAX, values[i] + offsetDb)) - DB_MIN) / (DB_MAX - DB_MIN)) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Input vs output spectrum: live from the AudioWorklet taps while playing, or the average of the offline render. */
export function SpectrumView() {
  const emu = useEmuRef();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"live" | "render">("live");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    let raf = 0;
    const smoothIn = new Float32Array(BANDS).fill(-120);
    const smoothOut = new Float32Array(BANDS).fill(-120);
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
        ctx.fillStyle = "#12161c";
        ctx.fillRect(0, 0, w, h);
        ctx.font = "10px system-ui";
        ctx.lineWidth = 1;
        for (let db = -20; db > DB_MIN; db -= 20) {
          const y = h - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * h;
          ctx.strokeStyle = "#1f2630";
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.fillStyle = "#5b6676";
          ctx.fillText(`${db}`, 3, y - 2);
        }
        for (const f of [100, 1000, 10000]) {
          const x = (Math.log(f / FREQS[0]) / Math.log(FREQS[BANDS - 1] / FREQS[0])) * w;
          ctx.strokeStyle = "#1f2630";
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
          ctx.fillStyle = "#5b6676";
          ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, h - 3);
        }

        let input: ArrayLike<number> | null = null;
        let output: ArrayLike<number> | null = null;
        let offset = 0;
        if (modeRef.current === "live") {
          const live = emu.engine.getSpectra(BANDS);
          if (live) {
            for (let i = 0; i < BANDS; i++) {
              smoothIn[i] = Math.max(live.input[i], smoothIn[i] - 1.5);
              smoothOut[i] = Math.max(live.output[i], smoothOut[i] - 1.5);
            }
            input = smoothIn;
            output = smoothOut;
          }
        } else if (emu.report) {
          input = emu.report.inputSpectrum;
          output = emu.report.outputSpectrum;
          offset = 18; // average power is lower than peak-per-band; shift for similar scale
        }
        if (input && output) {
          path(ctx, input, w, h, offset);
          ctx.strokeStyle = "#7f8da1";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          path(ctx, output, w, h, offset);
          ctx.strokeStyle = "#ffaa3c";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else {
          ctx.fillStyle = "#5b6676";
          ctx.fillText(modeRef.current === "live" ? "Press play to see the live spectrum" : "Render the track to see the average spectrum", 12, 20);
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
        Spectrum <span className="legend-chip in">input</span> <span className="legend-chip out">output</span>
        <span className="spacer" />
        <button className={mode === "live" ? "tab on" : "tab"} onClick={() => setMode("live")}>live</button>
        <button className={mode === "render" ? "tab on" : "tab"} onClick={() => setMode("render")}>rendered avg</button>
      </div>
      <canvas ref={canvas} className="spectrum" />
    </div>
  );
}
