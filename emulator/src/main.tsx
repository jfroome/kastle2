import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Emulator } from "./core/emulator";
import { App } from "./ui/App";
import { EmuContext } from "./ui/useEmu";
import "./ui/styles.css";

function Root() {
  const [emu, setEmu] = useState<Emulator | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const instance = new Emulator();
    let disposed = false;
    instance
      .init()
      .then(() => {
        (window as unknown as { emulator: Emulator }).emulator = instance; // handy for debugging in the console
        if (!disposed) setEmu(instance);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      instance.dispose();
    };
  }, []);

  if (error) return <pre className="fatal">Failed to start: {error}</pre>;
  if (!emu) return <div className="loading">Loading firmware…</div>;
  return (
    <EmuContext.Provider value={emu}>
      <App />
    </EmuContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
