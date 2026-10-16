import { useState } from "react";
import manifests from "../firmware/uf2-manifest.json";

interface Uf2Entry {
  file: string;
  bytes: number;
  sha256: string;
  builtAt: string;
  sourceHash: string;
}
const MANIFESTS = manifests.apps as Record<string, Uf2Entry>;

/** What to say about each app after flashing. Only apps with a published .uf2 can be delivered. */
const APP_NOTES: Record<string, { name: string; npmTarget: string; firstBoot: string; checks: string[] }> = {
  masterblaster: {
    name: "MasterBlaster",
    npmTarget: "master-blaster",
    firstBoot: "Start with the output turned down: the defaults are about 10 dB louder than the input.",
    checks: [
      "LED 1 shows input level, LED 2 shows compressor gain reduction (yellow/orange), LED 3 shows limiter (red) over mix (blue). Both LED 2 and 3 turn grey when bypassed.",
      "Tap MODE to bypass: the level should match the input. Hold SHIFT to reach comp speed, wow and width. CV on PARAM 1 / 2 / 3 drives Drive / Comp / Lo-Fi.",
      "Raise Vinyl (K4), then flip the left switch (CV): up = low-pitched noise, middle = high-pitched, down = off. The right switch (GATE) sets the wow speed (up slow, middle medium, down fast); SHIFT+K4 sets the wow depth. Keep the C IN and G IN jacks unpatched: a cable there will most likely override the switches (untested on hardware).",
      "The emulator shows the firmware's behaviour and a cycle estimate of about 27 % of the audio budget; the real CPU load and the analogue level at your jacks haven't been measured on hardware, so listen and compare with the bench's graphs.",
    ],
  },
  beads: {
    name: "Beads",
    npmTarget: "beads",
    firstBoot: "Start with the output turned down and BLEND (K6) low: with density, size and feedback up the grain cloud can get loud.",
    checks: [
      "Feed audio in, turn BLEND (K6) up and DENSITY (K4) away from its centre: grains should appear. LED 3 flashes once per grain, coloured by the recording quality (SHIFT+K2).",
      "Tap MODE to freeze the buffer (LED 2 blue); the sound should keep looping after the input stops. Tap SHIFT for a single seed grain, or set MODE+K4 above 50 % for seeded mode where TRIG makes the grains.",
      "This is a fixed-point Beads-style re-implementation, not Mutable Instruments' code: no synth mode, a shorter buffer (0.7–3 s), 10–16 grains. See Beads.md for the full list.",
      "The cycle estimate is about 64 % of one core's audio budget in the worst case. That is an instruction-level estimate, not a hardware measurement: if you hear crackles or dropouts on dense clouds, tell me.",
    ],
  },
};

type FsDirectoryHandle = {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ getFile(): Promise<File>; createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }> }>;
};
type PickerWindow = Window & { showDirectoryPicker?: (opts?: { mode?: "readwrite" }) => Promise<FsDirectoryHandle> };

/** Instructions and buttons to get the selected app's firmware onto a physical Citadel through the RP2040 USB bootloader. */
export function DeliverDialog({ appId, onClose }: { appId: string; onClose: () => void }) {
  const manifest = MANIFESTS[appId];
  const notes = APP_NOTES[appId];
  if (!manifest || !notes) return <UnavailableDialog onClose={onClose} />;
  return <DeliverDialogBody manifest={manifest} notes={notes} onClose={onClose} />;
}

function UnavailableDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Deliver firmware to the Citadel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>No firmware file for this app</h2>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hint">Only MasterBlaster and Beads have a published .uf2. Run <code>npm run uf2</code> after adding a target.</p>
      </div>
    </div>
  );
}

function DeliverDialogBody({ manifest, notes, onClose }: { manifest: Uf2Entry; notes: (typeof APP_NOTES)[string]; onClose: () => void }) {
  const uf2Url = `${import.meta.env.BASE_URL}firmware/${manifest.file}`;
  const [ack, setAck] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "error"; text: string } | null>(null);
  const canWrite = typeof (window as PickerWindow).showDirectoryPicker === "function";

  const download = async () => {
    const blob = await (await fetch(uf2Url)).blob();
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
      const data = await (await fetch(uf2Url)).blob();
      setStatus({ kind: "info", text: "Writing…" });
      const handle = await dir.getFileHandle(manifest.file, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(data);
        await writable.close();
      } catch {
        // The bootloader reboots into the new firmware as soon as the last block lands, so the drive may vanish mid-close
      }
      setStatus({ kind: "ok", text: `Sent. The Citadel should reboot by itself into ${notes.name} (the drive disappears). If it didn't, copy the file manually.` });
    } catch (error) {
      if ((error as Error).name !== "AbortError") setStatus({ kind: "error", text: String(error) });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Deliver firmware to the Citadel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Deliver {notes.name} to your Citadel</h2>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="hint">
          The file below is the real RP2040 build of this repo's {notes.name} app, not the browser model: <code>{manifest.file}</code>,{" "}
          {(manifest.bytes / 1024).toFixed(0)} KB, built {new Date(manifest.builtAt).toLocaleString()}, source hash <code>{manifest.sourceHash}</code>, SHA-256{" "}
          <code title={manifest.sha256}>{manifest.sha256.slice(0, 16)}…</code>. Rebuild it any time with <code>npm run uf2 -- {notes.npmTarget}</code>.
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
            <b>It reboots by itself.</b> The first boot of a different app clears the app's settings area (the LEDs flash cyan), then {notes.name} runs. {notes.firstBoot}
          </li>
        </ol>

        <label className="check ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I understand this replaces the app currently on the Citadel (for example another Bastl app). To go back, flash Bastl's official firmware the same way.
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
          {notes.checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>Settings are not saved across power cycles yet.</li>
        </ul>
      </div>
    </div>
  );
}
