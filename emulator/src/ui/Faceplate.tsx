import { useEffect, useRef, useState } from "react";
import { PARAM_MAX } from "../core/constants";
import type { Layer } from "../firmware/board";
import type { JackName } from "../firmware/frontend";
import { Knob } from "./Knob";
import { useEmu } from "./useEmu";

const LAYER_LABEL: Partial<Record<Layer, string>> = { NORMAL: "NORMAL", SHIFT: "SHIFT held", MODE: "MODE held", SETTINGS: "SHIFT+MODE" };

function Led({ r, g, b, label }: { r: number; g: number; b: number; label: string }) {
  const level = Math.max(r, g, b) / 255;
  const boost = (v: number) => Math.min(255, Math.round(v * 2.2));
  return (
    <div className="led-wrap" title={label}>
      <div
        className="led"
        style={{
          background: `rgb(${boost(r)},${boost(g)},${boost(b)})`,
          boxShadow: level > 0.05 ? `0 0 ${6 + level * 14}px rgba(${boost(r)},${boost(g)},${boost(b)},${0.3 + level * 0.6})` : "none",
        }}
      />
    </div>
  );
}

interface JackProps {
  label: string;
  /** Firmware input this jack feeds (omit for outputs / decorative jacks) */
  input?: JackName;
  sub?: string;
  /** Output indicator 0..1 */
  level?: number;
  kind?: "in" | "out";
  /** Momentary gate */
  gate?: boolean;
}

function Jack({ label, input, sub, level, kind = "in", gate }: JackProps) {
  const emu = useEmu();
  const spec = input ? emu.app.jacks.find((j) => j.input === input) : undefined;
  const patched = input ? !!emu.cv[input]?.patched : false;
  const interactive = !!spec || gate;
  const onDown = () => {
    if (gate) emu.setTrig(true);
    else if (spec && input) emu.setCv(input, { patched: !patched });
  };
  const lit = level !== undefined && level > 0.02;
  return (
    <div className={`jack ${interactive ? "live" : ""} ${patched ? "patched" : ""} ${kind}`} title={spec ? `${spec.label}: ${spec.description}` : label}>
      <button
        className="jack-socket"
        style={lit ? { boxShadow: `0 0 ${4 + (level ?? 0) * 12}px rgba(255,170,60,${0.3 + (level ?? 0) * 0.6})` } : undefined}
        disabled={!interactive}
        onPointerDown={onDown}
        onPointerUp={() => gate && emu.setTrig(false)}
        onPointerLeave={() => gate && emu.panel.trig && emu.setTrig(false)}
        aria-label={label}
      />
      <span className="jack-label">{label}</span>
      {sub && <span className="jack-sub">{sub}</span>}
    </div>
  );
}

export function Faceplate() {
  const emu = useEmu();
  const [latch, setLatch] = useState(false);
  const latchRef = useRef(latch);
  latchRef.current = latch;
  const { app } = emu;
  const layer = emu.layer;
  const state = emu.boardState;
  const shiftDown = emu.panel.buttons.SHIFT;
  const bypassed = state && app.isBypassed ? app.isBypassed(state) : false;

  // Keyboard: hold Shift = SHIFT button, B = MODE tap, Space = play/pause
  useEffect(() => {
    const typing = (e: KeyboardEvent) => ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName);
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.repeat) return;
      if (e.key === "Shift") emu.setButton("SHIFT", true);
      else if (e.key.toLowerCase() === "b" && !e.metaKey && !e.ctrlKey) emu.tapMode();
      else if (e.code === "Space") {
        e.preventDefault();
        emu.engine.transport === "playing" ? emu.engine.pause() : void emu.engine.play();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift" && !latchRef.current) emu.setButton("SHIFT", false);
    };
    const blur = () => !latchRef.current && emu.setButton("SHIFT", false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [emu]);

  const knob = (pot: number, size: number) => {
    const control = emu.controlFor(pot, layer);
    const others = app.controls.filter((c) => c.pot === pot && c.layer !== layer && !c.unused);
    const value = control ? emu.getValue(control) / PARAM_MAX : 0;
    return (
      <Knob
        label={control ? control.label : layer === "NORMAL" ? "—" : "Base"}
        value={value}
        ghost={emu.directMode ? null : emu.panel.pots[pot]}
        frozen={emu.isFrozen(pot)}
        text={control ? control.format(emu.getValue(control)) : "not used"}
        low={control?.low}
        high={control?.high}
        disabled={!control || !!control.unused}
        size={size}
        dragStart={() => {
          const live = emu.controlFor(pot, emu.layer);
          return emu.directMode && live ? emu.getValue(live) / PARAM_MAX : emu.panel.pots[pot];
        }}
        onChange={(n) => emu.turnKnob(pot, n)}
        onReset={() => emu.resetKnob(pot)}
      >
        <div className="knob-legend" aria-label="functions in other layers">
          {others.map((c) => (
            <span key={c.layer + c.key} className={`legend ${c.layer.toLowerCase()}`} title={c.description}>
              {c.layer === "SHIFT" ? "⇧" : c.layer === "MODE" ? "M" : "N"} {c.label}
            </span>
          ))}
        </div>
      </Knob>
    );
  };

  const o = state;
  return (
    <section className="panel faceplate">
      <div className="faceplate-head">
        <h2>
          {app.name} <small>Citadel panel</small>
        </h2>
        <div className="layer-badges">
          {(["NORMAL", "SHIFT", "MODE"] as Layer[]).map((l) => (
            <span key={l} className={`badge ${layer === l ? "on" : ""}`}>
              {l}
            </span>
          ))}
        </div>
      </div>
      <p className="tagline">{app.tagline}</p>

      <div className="citadel">
        <div className="jack-bank">
          <div className="jack-group clk">
            <h5>CLK</h5>
            <Jack label="IN" />
            <Jack label="OUT" kind="out" />
          </div>
          <div className="jack-group pattern">
            <h5>PATTERN</h5>
            <Jack label="RESET" input="FEED_2" />
            <Jack label="C IN" input="FEED_3" />
            <Jack label="G IN" input="FEED_1" />
            <Jack label="ENV" kind="out" level={o?.envOut} />
            <Jack label="CV" kind="out" level={o?.cvOut} />
            <Jack label="GATE" kind="out" level={o?.gateOut ? 1 : 0} />
          </div>
          <div className="jack-group lfo">
            <h5>LFO</h5>
            <Jack label="RESET" input="RESET" />
            <Jack label="MOD" input="PARAM_2" />
            <Jack label="⎍" kind="out" level={o?.pulseOut ? 1 : 0} />
            <Jack label="∧" kind="out" level={o?.lfoOut} />
          </div>
          <div className="jack-group audio">
            <h5>AUDIO</h5>
            <Jack label="L IN" />
            <Jack label="R IN" />
            <Jack label="L OUT" kind="out" level={emu.meters.outPeak} />
            <Jack label="R OUT" kind="out" level={emu.meters.outPeak} />
          </div>
          <div className="jack-row-bottom">
            <Jack label="MIDI IN" />
            <Jack label="TRIG" input="TRIG_IN" gate sub="hold" />
            <Jack label="BANK" input="MODE" />
            <Jack label="FREE" input="PITCH_1" sub="PITCH" />
            <Jack label="NOTE" input="PITCH_2" sub="PITCH" />
            <Jack label="SAMPLE" input="PARAM_1" />
            <Jack label="LENGTH" input="PARAM_3" />
            <Jack label="🎧" kind="out" level={emu.meters.outPeak} />
          </div>
        </div>

        <div className="knob-cell k1">{knob(0, 76)}</div>
        <div className="knob-cell k2">{knob(1, 76)}</div>
        <div className="knob-cell k3">{knob(2, 76)}</div>
        <div className="knob-cell k4">{knob(3, 124)}</div>
        <div className="knob-cell k5">{knob(4, 90)}</div>
        <div className="knob-cell k6">{knob(5, 90)}</div>
        <div className="knob-cell k7">{knob(6, 76)}</div>

        <div className="button-cell shift">
          <button
            className={`hw-button round ${shiftDown ? "down" : ""}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              if (latch) emu.setButton("SHIFT", !shiftDown);
              else emu.setButton("SHIFT", true);
            }}
            onPointerUp={() => !latch && emu.setButton("SHIFT", false)}
            onPointerCancel={() => !latch && emu.setButton("SHIFT", false)}
            title={app.buttons.shift}
            aria-label="SHIFT"
          />
          <span className="btn-label">SHIFT</span>
          <label className="check small">
            <input
              type="checkbox"
              checked={latch}
              onChange={(e) => {
                setLatch(e.target.checked);
                if (!e.target.checked) emu.setButton("SHIFT", false);
              }}
            />
            latch
          </label>
        </div>
        <div className="leds-cell">
          {[0, 1, 2].map((i) => {
            const led = state?.leds[i] ?? [0, 0, 0];
            return <Led key={i} r={led[0]} g={led[1]} b={led[2]} label={app.leds[i]?.description ?? `LED ${i + 1}`} />;
          })}
        </div>
        <div className="button-cell mode">
          <button
            className={`hw-button round ${emu.panel.buttons.MODE ? "down" : ""} ${app.hasBypass && bypassed ? "bypass-on" : ""}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              emu.setButton("MODE", true);
            }}
            onPointerUp={() => emu.setButton("MODE", false)}
            onPointerCancel={() => emu.setButton("MODE", false)}
            title={app.buttons.mode}
            aria-label="MODE"
          />
          <span className="btn-label">
            {app.hasBypass ? (bypassed ? "MODE · BYPASSED" : "MODE · bypass") : "MODE"}
          </span>
        </div>
      </div>

      <div className="mode-row">
        <label
          className="check"
          title="On: a dragged knob takes over instantly. Off: behaves like the module, where a knob is frozen after a layer change until you move it past the threshold."
        >
          <input type="checkbox" checked={emu.directMode} onChange={(e) => ((emu.directMode = e.target.checked), emu.emit())} />
          Direct knobs
        </label>
        <span className="hint">
          Layer: <b>{LAYER_LABEL[layer] ?? layer}</b> · drag / wheel / arrows to turn · double-click resets · hold <kbd>Shift</kbd> = SHIFT (Alt = fine knob), <kbd>B</kbd> = MODE tap, <kbd>Space</kbd> = play
        </span>
      </div>
    </section>
  );
}
