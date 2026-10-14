import { useRef, useState } from "react";
import { useEmu } from "./useEmu";

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function PresetBar() {
  const emu = useEmu();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const user = emu.userPresets();
  return (
    <section className="panel">
      <h3>Presets</h3>
      <div className="preset-list">
        {emu.factoryPresets().map((p) => (
          <button key={p.name} title={p.description} onClick={() => emu.loadPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>
      {user.length > 0 && (
        <div className="preset-list user">
          {user.map((p) => (
            <span className="chip" key={p.name}>
              <button onClick={() => emu.loadPreset(p)}>{p.name}</button>
              <button className="x" title="Delete" onClick={() => emu.deleteUserPreset(p.name)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="preset-save">
        <input placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          disabled={!name.trim()}
          onClick={() => {
            emu.saveUserPreset(name.trim());
            setName("");
          }}
        >
          Save
        </button>
        <button onClick={() => download(`${emu.app.id}-preset.json`, new Blob([emu.exportPresetJson()], { type: "application/json" }))}>Export</button>
        <button onClick={() => file.current?.click()}>Import</button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              emu.importPresetJson(await f.text());
              setError("");
            } catch (err) {
              setError(String(err instanceof Error ? err.message : err));
            }
          }}
        />
      </div>
      {error && <p className="warn">{error}</p>}
    </section>
  );
}

export { download };
