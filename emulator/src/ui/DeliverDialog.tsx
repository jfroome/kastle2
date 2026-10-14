import { useState } from "react";
import manifest from "../firmware/uf2-manifest.json";

const UF2_URL = `${import.meta.env.BASE_URL}firmware/${manifest.file}`;

type FsDirectoryHandle = {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ getFile(): Promise<File>; createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }> }>;
};
type PickerWindow = Window & { showDirectoryPicker?: (opts?: { mode?: "readwrite" }) => Promise<FsDirectoryHandle> };

/** Instructions and buttons to get the MasterBlaster firmware onto a physical Citadel through the RP2040 USB bootloader. */
export function DeliverDialog({ onClose }: { onClose: () => void }) {
  const [ack, setAck] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "error"; text: string } | null>(null);
  const canWrite = typeof (window as PickerWindow).showDirectoryPicker === "function";

  const download = async () => {
    const blob = await (await fetch(UF2_URL)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = manifest.file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus({ kind: "info", text: `Downloaded ${manifest.file}. Now copy it onto the RPI-RP2 drive (step 3).` });
  };

  const flash = async () => {
    try {
      const dir = await (window as PickerWindow).showDirectoryPicker!({ mode: "readwrite" });
      // The RP2040 bootloader drive always contains INFO_UF2.TXT; refuse anything else so we never write into a random folder
      let isBootloader = false;
      try {
        const info = await (await dir.getFileHandle("INFO_UF2.TXT")).getFile();
        isBootloader = (await info.text()).includes("RP2");
      } catch {
        isBootloader = false;
      }
      if (!isBootloader) {
        setStatus({ kind: "error", text: `"${dir.name}" doesn't look like the RP2040 bootloader drive (no INFO_UF2.TXT). Put the Citadel in bootloader mode and pick the RPI-RP2 drive.` });
        return;
      }
      const data = await (await fetch(UF2_URL)).blob();
      setStatus({ kind: "info", text: "Writing…" });
      const handle = await dir.getFileHandle(manifest.file, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(data);
        await writable.close();
      } catch {
        // The bootloader reboots into the new firmware as soon as the last block lands, so the drive may vanish mid-close
      }
      setStatus({ kind: "ok", text: "Sent. The Citadel should reboot by itself into MasterBlaster (the drive disappears). If it didn't, copy the file manually." });
    } catch (error) {
      if ((error as Error).name !== "AbortError") setStatus({ kind: "error", text: String(error) });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Deliver firmware to the Citadel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Deliver MasterBlaster to your Citadel</h2>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="hint">
          The file below is the real RP2040 build of this repo's MasterBlaster app, not the browser model: <code>{manifest.file}</code>,{" "}
          {(manifest.bytes / 1024).toFixed(0)} KB, built {new Date(manifest.builtAt).toLocaleString()}, source hash <code>{manifest.sourceHash}</code>, SHA-256{" "}
          <code title={manifest.sha256}>{manifest.sha256.slice(0, 16)}…</code>. Rebuild it any time with <code>npm run uf2</code>.
        </p>

        <ol className="steps">
          <li>
            <b>Get the unit ready.</b> Connect a USB-C cable to the computer (use a data cable, not charge-only). Power the Citadel down and keep the other
            cables off the audio outputs.
          </li>
          <li>
            <b>Enter the bootloader.</b> Hold the <b>SHIFT</b> button while the module powers up (plug in the USB cable, or switch on the rack, while holding it) — this is the
            method in the repo's <code>TOOLCHAIN_INSTALL.md</code>. A drive named <b>RPI-RP2</b> appears on the computer. If it doesn't, unplug, hold SHIFT again and retry; Bastl's Citadel
            manual is the reference for your hardware revision.
          </li>
          <li>
            <b>Send the firmware.</b> Either use the button below (Chrome / Edge: pick the RPI-RP2 drive), or download the file and drag it onto the RPI-RP2 drive.
          </li>
          <li>
            <b>It reboots by itself.</b> The first boot of a different app clears the app's settings area (the LEDs flash cyan), then MasterBlaster runs. Start with the output turned
            down: the defaults are about 10 dB louder than the input.
          </li>
        </ol>

        <label className="check ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I understand this replaces the app currently on the Citadel (e.g. Wave Bard). To go back, flash Bastl's official firmware the same way.
        </label>

        <div className="modal-actions">
          <button className="primary" disabled={!ack} onClick={() => void download()}>
            ⬇ Download {manifest.file}
          </button>
          <button disabled={!ack || !canWrite} onClick={() => void flash()} title={canWrite ? "Writes the file onto the RPI-RP2 drive you pick" : "Needs a Chromium browser (File System Access API)"}>
            ⚡ Flash directly to the RPI-RP2 drive…
          </button>
        </div>
        {status && <p className={`status ${status.kind}`}>{status.text}</p>}

        <h4>After flashing: quick check on the real unit</h4>
        <ul className="notes">
          <li>LED 1 shows input level, LED 2 shows compressor gain reduction (yellow/orange), LED 3 shows limiter (red) over mix (blue). Both LED 2 and 3 turn grey when bypassed.</li>
          <li>Tap <b>MODE</b> to bypass: the level should match the input. Hold <b>SHIFT</b> to reach comp speed, wow and width. CV on PARAM 1 / 2 / 3 drives Drive / Comp / Lo-Fi.</li>
          <li>The emulator shows the firmware's behaviour and a cycle estimate of about 27 % of the audio budget; the real CPU load and the analogue level at your jacks haven't been measured on hardware, so listen and compare with the bench's graphs.</li>
          <li>Settings are not saved across power cycles yet.</li>
        </ul>
      </div>
    </div>
  );
}
