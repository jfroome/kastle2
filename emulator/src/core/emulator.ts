import { analyze, averageSpectrum, waveformPeaks, type SignalStats, type WaveformPeaks } from "../audio/analysis";
import { demoBeat } from "../audio/generators";
import type { Track } from "../audio/track";
import { encodeWav, type WavBits } from "../audio/wav";
import { APPS } from "../apps/registry";
import { runBench, type BenchEnv, type BenchResult } from "../bench/suite";
import { runParamSweep, type SweepPoint } from "../bench/sweep";
import { loadDsp } from "../dsp/loader";
import type { DspInstance } from "../dsp/types";
import { AudioEngine, EMPTY_METERS, type EngineBoardState } from "../engine/audio";
import type { StereoSignal } from "../engine/offline";
import { FirmwareBoard, type BoardState, type ButtonName, type Layer, type PanelInputs } from "../firmware/board";
import { DEFAULT_ANALOG, type AnalogOptions } from "../firmware/codec";
import type { JackName } from "../firmware/frontend";
import { loadFirmwareWasm, loadUserData } from "../firmware/loader";
import { knobScript } from "../firmware/panelScript";
import { PERFORMANCES, type Performance } from "../firmware/performance";
import { getFirmwareInfo, type FirmwareInfo } from "../firmware/registry";
import { renderFirmware } from "../firmware/runner";
import { cvVoltsAt, defaultCv, type CvChannel } from "./cv";
import type { ControlSpec, FirmwareApp, Preset, SwitchPosition } from "./app";
import { controlDefaults, switchVolts } from "./app";
import { PARAM_MAX } from "./constants";

export interface RenderReport {
  result: StereoSignal;
  appName: string;
  inputStats: SignalStats | null;
  outputStats: SignalStats;
  inputSpectrum: Float32Array | null;
  outputSpectrum: Float32Array;
  outputPeaks: WaveformPeaks;
  settings: Record<string, number>;
  renderedAt: number;
}

const USER_PRESETS_KEY = "citadel-emulator/presets/";
const FREEZE_THRESHOLD = 48 / 4058; // POT_MOVE_THRESHOLD in normalised pot travel

const layerFromButtons = (b: Record<ButtonName, boolean>): Layer =>
  b.SHIFT && b.MODE ? "SETTINGS" : b.MODE ? "MODE" : b.SHIFT ? "SHIFT" : "NORMAL";

/**
 * Glue between the virtual Citadel panel and the firmware running on the audio thread. The panel (pots, CV, buttons,
 * gates) is sent to the worklet; the firmware does all the work. `knobs` is only a UI shadow of what each control
 * was last set to, so labels and rings can show values.
 */
export class Emulator {
  readonly engine = new AudioEngine();
  readonly panel: PanelInputs = {
    pots: new Array(7).fill(0.5),
    volts: {},
    buttons: { SHIFT: false, MODE: false },
    trig: false,
    resetIn: false,
    syncIn: false,
    audioInPlugged: true,
  };
  cv: Record<string, CvChannel> = {};
  /** Positions of the 3-pole panel switches by FEED input. Missing = middle. */
  switches: Partial<Record<"FEED_1" | "FEED_3", SwitchPosition>> = {};

  app!: FirmwareApp;
  info!: FirmwareInfo;
  knobs: Record<string, number> = {};
  frozenAt: (number | null)[] = new Array(7).fill(null);
  analog: AnalogOptions = { ...DEFAULT_ANALOG };
  track: Track | null = null;
  trackFormat = "";
  inputPeaks: WaveformPeaks | null = null;
  /** Direct knobs: layer changes park each pot on the new layer's value so a drag takes over without a jump */
  directMode = true;
  autoRender = false;
  report: RenderReport | null = null;
  rendering: number | null = null;
  benchResults: BenchResult[] = [];
  benchRunning = false;
  sweepResult: { control: ControlSpec; points: SweepPoint[] } | null = null;
  sweepRunning: number | null = null;
  status = "";
  missingUserData: string | null = null;
  performanceId = PERFORMANCES[0].id;
  renderSeconds = 8;
  heldNotes = new Set<number>();

  private listeners = new Set<() => void>();
  private version = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private lastPanel = "";
  private panelHoldUntil = 0;
  private startTime = performance.now();
  private autoRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private renderToken = 0;
  private userData: Uint8Array | undefined;

  get boardState(): BoardState | null {
    return this.engine.meters.board;
  }

  get meters(): EngineBoardState {
    return this.engine.meters ?? EMPTY_METERS;
  }

  get layer(): Layer {
    return layerFromButtons(this.panel.buttons);
  }

  async init(): Promise<void> {
    this.engine.onChange = () => this.emit();
    await this.selectApp(APPS[0].id);
    this.setTrack(demoBeat());
    this.timers.push(setInterval(() => this.tick(), 5));
    this.timers.push(setInterval(() => this.emit(), 33));
  }

  dispose(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.engine.dispose();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------- apps

  async selectApp(id: string): Promise<void> {
    const entry = APPS.find((a) => a.id === id) ?? APPS[0];
    this.app = entry.create();
    this.info = getFirmwareInfo(this.app.firmwareId);
    this.knobs = controlDefaults(this.app);
    this.report = null;
    this.benchResults = [];
    this.sweepResult = null;
    this.heldNotes.clear();
    this.cv = {};
    for (const j of this.app.jacks) this.cv[j.input] = defaultCv();
    this.panel.volts = {};
    this.switches = {};
    this.panel.buttons = { SHIFT: false, MODE: false };
    this.panel.trig = false;
    this.frozenAt = new Array(7).fill(null);
    this.userData = undefined;
    this.missingUserData = null;
    if (this.info.userData) {
      this.userData = await loadUserData(this.info.userData.file);
      if (!this.userData) this.missingUserData = this.info.userData.label;
    }
    await this.launch();
    this.emit();
  }

  /** Supply the user data a firmware needs (e.g. a Wave Bard SAMPLES.bin) */
  async setUserData(data: Uint8Array): Promise<void> {
    this.userData = data;
    this.missingUserData = null;
    await this.launch();
    this.emit();
  }

  private async launch(): Promise<void> {
    if (this.info.userData && !this.userData) {
      // The app would wait forever for its samples (as the module does), so don't boot it
      this.engine.setFirmware({ firmwareId: "", wasm: new ArrayBuffer(0), analog: this.analog, panel: this.panel, script: [] });
      return;
    }
    const wasm = await loadFirmwareWasm(this.info.id);
    this.parkPots("NORMAL");
    this.engine.setFirmware({
      firmwareId: this.info.id,
      wasm,
      userData: this.userData,
      analog: this.analog,
      panel: structuredClone(this.panel),
      script: knobScript(this.app.controls, this.knobs, this.panel.pots),
    });
    this.panelHoldUntil = performance.now() + 400;
  }

  async newBoard(knobs: Record<string, number> = this.knobs, analog: AnalogOptions = this.analog): Promise<FirmwareBoard> {
    if (this.info.userData && !this.userData) throw new Error(`${this.info.userData.label} not loaded`);
    const board = await FirmwareBoard.create({ wasm: await loadFirmwareWasm(this.info.id), userData: this.userData, analog });
    for (const c of this.app.controls) {
      if (c.layer === "NORMAL" && !c.unused) board.setPot(c.pot, (knobs[c.key] ?? c.default) / PARAM_MAX);
    }
    board.boot();
    board.queue(knobScript(this.app.controls, knobs, board.panel.pots));
    return board;
  }

  async newDsp(): Promise<DspInstance> {
    return loadDsp(this.app.dspId ?? "masterblaster");
  }

  benchEnv(): BenchEnv {
    const entry = APPS.find((a) => a.id === this.app.id)!;
    return {
      app: this.app,
      freshApp: () => entry.create(),
      newDsp: () => this.newDsp(),
      newBoard: (knobs, analog) => this.newBoard(knobs ?? controlDefaults(this.app), analog),
      latencySamples: this.info.latencySamples,
      generatesSound: this.info.generatesSound,
    };
  }

  // ---------------------------------------------------------------- panel

  controlFor(pot: number, layer: Layer): ControlSpec | undefined {
    return this.app.controls.find((c) => c.pot === pot && c.layer === layer);
  }

  getValue(control: ControlSpec): number {
    return this.knobs[control.key] ?? control.default;
  }

  isFrozen(pot: number): boolean {
    return this.frozenAt[pot] !== null;
  }

  /** Put the physical pots where a layer's controls currently are. */
  private parkPots(layer: Layer): void {
    const pots = this.panel.pots;
    for (const c of this.app.controls) {
      if (c.layer === layer && !c.unused) pots[c.pot] = this.getValue(c) / PARAM_MAX;
    }
  }

  /** User turns a knob. `norm` is 0..1. */
  turnKnob(pot: number, norm: number): void {
    this.panel.pots[pot] = Math.max(0, Math.min(1, norm));
    const frozen = this.frozenAt[pot];
    if (frozen !== null && Math.abs(this.panel.pots[pot] - frozen) > FREEZE_THRESHOLD) this.frozenAt[pot] = null;
    if (this.frozenAt[pot] === null) {
      const control = this.controlFor(pot, this.layer);
      if (control && !control.unused) this.knobs[control.key] = Math.round(this.panel.pots[pot] * PARAM_MAX);
    }
    this.scheduleAutoRender();
    this.pushPanel();
  }

  resetKnob(pot: number): void {
    const control = this.controlFor(pot, this.layer);
    if (control && !control.unused) {
      this.frozenAt[pot] = null;
      this.turnKnob(pot, control.default / PARAM_MAX);
    }
  }

  private parkToken = 0;

  setButton(button: ButtonName, down: boolean): void {
    if (this.panel.buttons[button] === down) return;
    this.panel.buttons[button] = down;
    const layer = this.layer;
    this.frozenAt = this.panel.pots.map((p) => p);
    this.pushPanel();
    this.emit();
    if (!this.directMode) return;
    // Direct knobs park the pots on the new layer's values, but only once the firmware has switched layers: it reads
    // buttons every 10 ms, so pots moved at the same instant would be read as NORMAL-layer movements (the sound jumps).
    const token = ++this.parkToken;
    const started = performance.now();
    const waitForLayer = () => {
      if (token !== this.parkToken || !this.directMode) return;
      const reported = this.engine.meters.board?.layer;
      if (reported === layer || performance.now() - started > 600) {
        this.parkPots(layer);
        this.frozenAt = this.panel.pots.map((p) => p);
        this.pushPanel();
        this.emit();
      } else {
        setTimeout(waitForLayer, 5);
      }
    };
    waitForLayer();
  }

  /** Quick MODE press and release (bypass tap). Runs inside the firmware loop so the press lasts long enough to debounce. */
  tapMode(): void {
    this.engine.sendActions([
      { type: "button", button: "MODE", down: true },
      { type: "wait", blocks: 20 },
      { type: "button", button: "MODE", down: false },
      { type: "wait", blocks: 4 },
    ]);
    this.scheduleAutoRender();
  }

  setTrig(down: boolean): void {
    this.panel.trig = down;
    this.pushPanel();
  }

  noteOn(note: number, velocity = 100): void {
    if (this.heldNotes.has(note)) return;
    this.heldNotes.add(note);
    this.engine.sendMidi([0x90, note, velocity]);
    this.emit();
  }

  noteOff(note: number): void {
    if (!this.heldNotes.delete(note)) return;
    this.engine.sendMidi([0x80, note, 0]);
    this.emit();
  }

  setCv(jack: JackName, patch: Partial<CvChannel>): void {
    Object.assign(this.cv[jack], patch);
    this.scheduleAutoRender();
    this.emit();
  }

  switchPosition(input: "FEED_1" | "FEED_3"): SwitchPosition {
    return this.switches[input] ?? 1;
  }

  setSwitch(input: "FEED_1" | "FEED_3", position: SwitchPosition): void {
    this.switches[input] = position;
    this.scheduleAutoRender();
    this.emit();
  }

  setAnalog(patch: Partial<AnalogOptions>): void {
    this.analog = { ...this.analog, ...patch };
    this.engine.sendAnalog(this.analog);
    this.scheduleAutoRender();
    this.emit();
  }

  private pushPanel(): void {
    if (performance.now() < this.panelHoldUntil) return;
    const key = JSON.stringify(this.panel);
    if (key === this.lastPanel) return;
    this.lastPanel = key;
    this.engine.sendPanel(this.panel);
  }

  private tick(): void {
    if (!this.app) return;
    const t = (performance.now() - this.startTime) / 1000;
    for (const [jack, ch] of Object.entries(this.cv)) {
      const j = jack as JackName;
      if (ch.patched) this.panel.volts[j] = cvVoltsAt(ch, t);
      else delete this.panel.volts[j];
    }
    for (const sw of this.app.switches ?? []) {
      const volts = switchVolts(this.switchPosition(sw.input));
      if (volts === undefined) delete this.panel.volts[sw.input];
      else this.panel.volts[sw.input] = volts;
    }
    this.pushPanel();
  }

  // ---------------------------------------------------------------- presets

  factoryPresets(): Preset[] {
    return this.app.presets;
  }

  userPresets(): Preset[] {
    try {
      return JSON.parse(localStorage.getItem(USER_PRESETS_KEY + this.app.id) ?? "[]") as Preset[];
    } catch {
      return [];
    }
  }

  /** Plays the preset into the running firmware as knob gestures (SHIFT held, pots wiggled, ...). */
  loadPreset(preset: Preset): void {
    this.knobs = { ...controlDefaults(this.app), ...preset.values };
    const actions = knobScript(this.app.controls, this.knobs, this.panel.pots);
    this.parkPots("NORMAL");
    this.frozenAt = new Array(7).fill(null);
    this.engine.sendActions(actions);
    const blocks = actions.reduce((n, a) => n + (a.type === "wait" ? a.blocks : 0), 0);
    const ms = (blocks * 48000) / 44000 + 150;
    this.panelHoldUntil = performance.now() + ms;
    setTimeout(() => this.pushPanel(), ms + 20);
    this.scheduleAutoRender();
    this.emit();
  }

  saveUserPreset(name: string): void {
    const presets = this.userPresets().filter((p) => p.name !== name);
    presets.push({ name, values: { ...this.knobs } });
    localStorage.setItem(USER_PRESETS_KEY + this.app.id, JSON.stringify(presets));
    this.emit();
  }

  deleteUserPreset(name: string): void {
    localStorage.setItem(USER_PRESETS_KEY + this.app.id, JSON.stringify(this.userPresets().filter((p) => p.name !== name)));
    this.emit();
  }

  exportPresetJson(): string {
    return JSON.stringify({ app: this.app.id, values: this.knobs, analog: this.analog }, null, 2);
  }

  importPresetJson(text: string): void {
    const data = JSON.parse(text) as { app?: string; values?: Record<string, number> };
    if (data.app && data.app !== this.app.id) throw new Error(`Preset is for '${data.app}', current app is '${this.app.id}'`);
    this.loadPreset({ name: "Imported", values: data.values ?? {} });
  }

  // ---------------------------------------------------------------- audio source

  setTrack(track: Track, format = "generated"): void {
    this.track = track;
    this.trackFormat = format;
    this.inputPeaks = waveformPeaks(track, 1200);
    this.report = null;
    this.engine.setTrack(track);
    this.scheduleAutoRender();
    this.emit();
  }

  // ---------------------------------------------------------------- offline rendering

  get performance(): Performance {
    return (PERFORMANCES.find((p) => p.id === this.performanceId) ?? PERFORMANCES[0]).make();
  }

  /** Renders the current settings offline through a fresh boot of the same firmware. */
  async renderOffline(opts: { seconds?: number } = {}): Promise<StereoSignal> {
    const board = await this.newBoard();
    const cv = this.cv;
    const switches = (this.app.switches ?? []).map((sw) => ({ input: sw.input, volts: switchVolts(this.switchPosition(sw.input)) }));
    const performanceRun = this.info.generatesSound ? this.performance : null;
    const input = this.info.generatesSound ? null : this.track;
    return renderFirmware(board, input, {
      frames: input ? undefined : Math.round((opts.seconds ?? this.renderSeconds) * 44000),
      warmupSec: 4,
      latencySamples: this.info.latencySamples,
      sampleRate: 44000,
      beforeBlock: (t, b) => {
        for (const [jack, ch] of Object.entries(cv)) {
          if (ch.patched) b.setVolts(jack as JackName, cvVoltsAt(ch, t));
        }
        for (const sw of switches) b.setVolts(sw.input, sw.volts);
        performanceRun?.beforeBlock(t, b);
      },
      onProgress: (f) => {
        this.rendering = f;
        this.emit();
      },
    });
  }

  async renderAndAnalyze(): Promise<void> {
    if (!this.track && !this.info.generatesSound) return;
    const token = ++this.renderToken;
    const track = this.info.generatesSound ? null : this.track;
    this.rendering = 0;
    this.emit();
    try {
      const result = await this.renderOffline();
      if (token !== this.renderToken) return;
      this.report = {
        result,
        appName: this.app.name,
        inputStats: track ? analyze(track) : null,
        outputStats: analyze(result),
        inputSpectrum: track ? averageSpectrum(track) : null,
        outputSpectrum: averageSpectrum(result),
        outputPeaks: waveformPeaks(result, 1200),
        settings: { ...this.knobs },
        renderedAt: Date.now(),
      };
    } catch (error) {
      this.status = String(error);
    } finally {
      if (token === this.renderToken) this.rendering = null;
      this.emit();
    }
  }

  private scheduleAutoRender(): void {
    if (!this.autoRender) return;
    if (this.autoRenderTimer) clearTimeout(this.autoRenderTimer);
    this.autoRenderTimer = setTimeout(() => void this.renderAndAnalyze(), 800);
  }

  setAutoRender(on: boolean): void {
    this.autoRender = on;
    if (on) void this.renderAndAnalyze();
    this.emit();
  }

  async exportWav(bits: WavBits): Promise<Blob> {
    const result = this.report?.result ?? (await this.renderOffline());
    return new Blob([encodeWav(result, bits)], { type: "audio/wav" });
  }

  // ---------------------------------------------------------------- bench

  async runBench(): Promise<void> {
    this.benchRunning = true;
    this.benchResults = [];
    this.emit();
    try {
      await runBench(this.benchEnv(), (result) => {
        this.benchResults = [...this.benchResults, result];
        this.emit();
      });
    } finally {
      this.benchRunning = false;
      this.emit();
    }
  }

  async runSweep(control: ControlSpec, steps = 17): Promise<void> {
    this.sweepRunning = 0;
    this.emit();
    try {
      const input = this.info.generatesSound ? null : this.track;
      const points = await runParamSweep(
        this.benchEnv(),
        control,
        input,
        this.knobs,
        steps,
        (f) => {
          this.sweepRunning = f;
          this.emit();
        },
        this.performance,
      );
      this.sweepResult = { control, points };
    } finally {
      this.sweepRunning = null;
      this.emit();
    }
  }
}
