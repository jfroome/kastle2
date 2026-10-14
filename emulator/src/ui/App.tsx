import { useState } from "react";
import { BenchPanel } from "./BenchPanel";
import { AnalogPanel } from "./AnalogPanel";
import { CpuPanel } from "./CpuPanel";
import { CvPanel } from "./CvPanel";
import { useEmu } from "./useEmu";
import { Keys } from "./Keys";
import { Faceplate } from "./Faceplate";
import { Meters } from "./Meters";
import { PresetBar } from "./PresetBar";
import { ReferencePanel } from "./ReferencePanel";
import { RenderPanel } from "./RenderPanel";
import { SpectrumView } from "./SpectrumView";
import { Transport } from "./Transport";
import { WaveformView } from "./WaveformView";

type Tab = "render" | "bench" | "reference";

export function App() {
  const emu = useEmu();
  const [tab, setTab] = useState<Tab>("render");
  return (
    <div className="app">
      <Transport />
      <main className="layout">
        <div className="col left">
          <Faceplate />
          {emu.info.generatesSound && <Keys />}
          <CvPanel />
          <AnalogPanel />
          <CpuPanel />
          <PresetBar />
        </div>
        <div className="col right">
          <section className="panel">
            <WaveformView />
            <Meters />
            <SpectrumView />
          </section>
          <section className="panel">
            <div className="tabs">
              <button className={tab === "render" ? "tab on" : "tab"} onClick={() => setTab("render")}>
                Render &amp; export
              </button>
              <button className={tab === "bench" ? "tab on" : "tab"} onClick={() => setTab("bench")}>
                Bench &amp; sweeps
              </button>
              <button className={tab === "reference" ? "tab on" : "tab"} onClick={() => setTab("reference")}>
                Knob map
              </button>
            </div>
            {tab === "render" && <RenderPanel />}
            {tab === "bench" && <BenchPanel />}
            {tab === "reference" && <ReferencePanel />}
          </section>
        </div>
      </main>
    </div>
  );
}
