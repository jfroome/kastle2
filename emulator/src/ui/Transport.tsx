import { useRef, useState } from "react";
import { decodeAudioFile } from "../audio/decode";
import { DEMO_SOURCES } from "../audio/generators";
import { APPS } from "../apps/registry";
import { DeliverDialog } from "./DeliverDialog";
import { useEmu } from "./useEmu";

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function Transport() {
  const emu = useEmu();
  const { engine } = emu;
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [deliver, setDeliver] = useState(false);

  const load = async (file: File) => {
    setMessage(`Decoding ${file.name}…`);
    try {
      const ctx = await engine.ensure();
      const decoded = await decodeAudioFile(file, ctx);
      emu.setTrack(decoded.track, decoded.originalRate ? `${decoded.format}, ${(decoded.originalRate / 1000).toFixed(1)} kHz → 44 kHz` : decoded.format);
      setMessage("");
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const playing = engine.transport === "playing";
  return (
    <header
      className={`topbar ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void load(file);
      }}
    >
      <div className="brand">
        <strong>Citadel Firmware Test Bench</strong>
        <span>the real Citadel firmware (Base + app) as WebAssembly @ 44 kHz</span>
      </div>

      {APPS.length > 1 && (
      <label className="field">
        Firmware
        <select value={emu.app.id} onChange={(e) => void emu.selectApp(e.target.value)}>
          {APPS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      )}

      <div className="transport">
        {!engine.running && (
          <button className="primary" onClick={() => void engine.ensure().then(() => emu.emit())} title="Browsers need a click before they allow audio">
            🔊 Start audio
          </button>
        )}
        <button className={engine.running ? "primary" : ""} onClick={() => (playing ? engine.pause() : void engine.play())} disabled={!emu.track && !engine.liveInput}>
          {playing ? "⏸ Pause" : "▶ Play source"}
        </button>
        <button onClick={() => engine.stop()}>⏹</button>
        <label className="check">
          <input type="checkbox" checked={engine.loop} onChange={(e) => engine.setLoop(e.target.checked)} />
          loop
        </label>
        <span className="time">
          {fmtTime(engine.position)} / {fmtTime(engine.duration)}
        </span>
      </div>

      <div className="source">
        <button onClick={() => input.current?.click()}>Load audio…</button>
        <input
          ref={input}
          type="file"
          accept=".wav,.aif,.aiff,.aifc,.mp3,.flac,.ogg,.m4a,audio/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
            e.target.value = "";
          }}
        />
        <select
          value=""
          onChange={(e) => {
            const demo = DEMO_SOURCES.find((d) => d.id === e.target.value);
            if (demo) emu.setTrack(demo.make());
          }}
        >
          <option value="">Test signals…</option>
          {DEMO_SOURCES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <label className="check" title="Use the microphone / line input as the source. Use headphones to avoid feedback.">
          <input
            type="checkbox"
            checked={engine.liveInput}
            onChange={(e) =>
              void engine.setLiveInput(e.target.checked).catch((err: unknown) => setMessage(`Live input failed: ${String(err)}`))
            }
          />
          live in
        </label>
      </div>

      <button className="deliver" onClick={() => setDeliver(true)} title="Flash this firmware onto a physical Citadel">
        📟 Deliver to Citadel
      </button>
      {deliver && <DeliverDialog appId={emu.app.id} onClose={() => setDeliver(false)} />}

      <div className="now">
        {emu.track ? (
          <>
            <b>{emu.track.name}</b> <span className="muted">{emu.trackFormat}{emu.info.generatesSound ? " · audio input (this firmware makes its own sound)" : ""}</span>
          </>
        ) : (
          <span className="muted">Drop a WAV / AIFF / MP3 anywhere on this bar</span>
        )}
        {message && <span className="warn"> {message}</span>}
        {emu.missingUserData && (
          <span className="warn">
            {" "}
            {emu.missingUserData} not found. Run <code>npm run assets</code> or{" "}
            <label className="link">
              load a SAMPLES.bin
              <input type="file" accept=".bin" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await emu.setUserData(new Uint8Array(await f.arrayBuffer())); }} />
            </label>
          </span>
        )}
        {!engine.workletReady && engine.running && !emu.missingUserData && <span className="muted"> booting firmware…</span>}
        {engine.sampleRateMismatch && (
          <span className="warn"> Browser forced {engine.ctx?.sampleRate} Hz instead of 44 kHz; time constants will be off.</span>
        )}
        {engine.lastError && <span className="warn"> {engine.lastError}</span>}
      </div>
    </header>
  );
}
