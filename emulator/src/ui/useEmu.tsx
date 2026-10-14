import { createContext, useContext, useSyncExternalStore } from "react";
import type { Emulator } from "../core/emulator";

export const EmuContext = createContext<Emulator | null>(null);

/** Returns the emulator and re-renders the caller whenever it emits (~30 fps). */
export function useEmu(): Emulator {
  const emu = useContext(EmuContext);
  if (!emu) throw new Error("EmuContext missing");
  useSyncExternalStore(emu.subscribe, emu.getVersion);
  return emu;
}

/** Same as useEmu but never re-renders (for canvas components that run their own animation loop). */
export function useEmuRef(): Emulator {
  const emu = useContext(EmuContext);
  if (!emu) throw new Error("EmuContext missing");
  return emu;
}
