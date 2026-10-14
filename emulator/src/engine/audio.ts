import type { Track } from "../audio/track";
import { trackDuration } from "../audio/track";
import { SAMPLE_RATE } from "../core/constants";
import type { BoardState, PanelAction, PanelInputs } from "../firmware/board";
import type { AnalogOptions } from "../firmware/codec";
import type { FromWorklet, ToWorklet } from "./messages";
import { PROCESSOR_NAME } from "./messages";
import { binsToBands } from "./spectrum";
import workletUrl from "./worklet.ts?worker&url";

export type TransportState = "stopped" | "playing" | "paused";

export interface EngineBoardState {
  inPeak: number;
  outPeak: number;
  inRms: number;
  outRms: number;
  board: BoardState | null;
}

export const EMPTY_METERS: EngineBoardState = { inPeak: 0, outPeak: 0, inRms: 0, outRms: 0, board: null };

export interface FirmwareLaunch {
  firmwareId: string;
  wasm: ArrayBuffer;
  userData?: Uint8Array;
  eeprom?: Uint8Array;
  analog: AnalogOptions;
  panel: PanelInputs;
  script: PanelAction[];
}

/**
 * Real-time audio path: source → input analyser → firmware AudioWorklet → output analyser → speakers.
 * The AudioContext runs at the firmware sample rate (44 kHz) so the firmware's time constants are exact.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  meters: EngineBoardState = EMPTY_METERS;
  transport: TransportState = "stopped";
  loop = true;
  workletReady = false;
  lastError: string | null = null;
  liveInput = false;
  onEeprom: ((firmwareId: string, data: Uint8Array) => void) | null = null;

  private node: AudioWorkletNode | null = null;
  private analyserIn: AnalyserNode | null = null;
  private analyserOut: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private liveSource: MediaStreamAudioSourceNode | null = null;
  private liveStream: MediaStream | null = null;
  private buffer: AudioBuffer | null = null;
  private track: Track | null = null;
  private startedAt = 0;
  private startOffset = 0;
  private pausedAt = 0;
  private launch: FirmwareLaunch | null = null;
  private fftIn = new Float32Array(2048);
  private fftOut = new Float32Array(2048);
  onChange: (() => void) | null = null;

  get sampleRateMismatch(): boolean {
    return !!this.ctx && this.ctx.sampleRate !== SAMPLE_RATE;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  /** Must be called from a user gesture the first time. */
  async ensure(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    } catch {
      ctx = new AudioContext({ latencyHint: "interactive" });
    }
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    this.analyserIn = ctx.createAnalyser();
    this.analyserOut = ctx.createAnalyser();
    for (const a of [this.analyserIn, this.analyserOut]) {
      a.fftSize = 4096;
      a.smoothingTimeConstant = 0.75;
      a.minDecibels = -120;
    }
    this.fftIn = new Float32Array(this.analyserIn.frequencyBinCount);
    this.fftOut = new Float32Array(this.analyserOut.frequencyBinCount);
    this.analyserOut.connect(ctx.destination);
    if (this.launch) {
      this.startFirmware(this.launch);
    }
    return ctx;
  }

  /** Boots a firmware on the audio thread (or remembers it until the context exists). */
  setFirmware(launch: FirmwareLaunch): void {
    this.launch = launch;
    this.workletReady = false;
    this.lastError = null;
    this.meters = EMPTY_METERS;
    if (this.ctx && this.analyserIn && this.analyserOut) this.startFirmware(launch);
  }

  private startFirmware(launch: FirmwareLaunch): void {
    if (!this.ctx || !this.analyserIn || !this.analyserOut) return;
    this.node?.disconnect();
    this.node?.port.close();
    const node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (event: MessageEvent<FromWorklet>) => {
      const msg = event.data;
      if (msg.type === "meters") {
        this.meters = msg;
      } else if (msg.type === "ready") {
        this.workletReady = true;
        this.onChange?.();
      } else if (msg.type === "error") {
        this.lastError = msg.message;
        this.onChange?.();
      } else if (msg.type === "eeprom") {
        this.onEeprom?.(launch.firmwareId, msg.data);
      }
    };
    this.analyserIn.disconnect();
    this.analyserIn.connect(node);
    node.connect(this.analyserOut);
    this.node = node;
    const message: ToWorklet = {
      type: "init",
      firmwareId: launch.firmwareId,
      wasm: launch.wasm.slice(0),
      userData: launch.userData?.slice().buffer as ArrayBuffer | undefined,
      eeprom: launch.eeprom,
      analog: launch.analog,
      panel: launch.panel,
      script: launch.script,
    };
    node.port.postMessage(message);
  }

  private send(message: ToWorklet): void {
    this.node?.port.postMessage(message);
  }

  sendPanel(panel: PanelInputs): void {
    this.send({ type: "panel", panel });
  }

  sendAnalog(analog: AnalogOptions): void {
    this.send({ type: "analog", analog });
  }

  sendActions(actions: PanelAction[]): void {
    this.send({ type: "actions", actions });
  }

  sendMidi(bytes: number[]): void {
    this.send({ type: "midi", bytes });
  }

  setTrack(track: Track | null): void {
    const wasPlaying = this.transport === "playing";
    this.stopSource();
    this.track = track;
    this.buffer = null;
    this.startOffset = 0;
    this.pausedAt = 0;
    this.transport = "stopped";
    if (wasPlaying && track) void this.play();
    this.onChange?.();
  }

  private ensureBuffer(): AudioBuffer | null {
    if (!this.ctx || !this.track) return null;
    if (!this.buffer) {
      const buffer = this.ctx.createBuffer(2, this.track.left.length, this.track.sampleRate);
      buffer.copyToChannel(this.track.left as Float32Array<ArrayBuffer>, 0);
      buffer.copyToChannel(this.track.right as Float32Array<ArrayBuffer>, 1);
      this.buffer = buffer;
    }
    return this.buffer;
  }

  get duration(): number {
    return this.track ? trackDuration(this.track) : 0;
  }

  get position(): number {
    if (!this.ctx || !this.track) return 0;
    if (this.transport === "playing") {
      const elapsed = this.ctx.currentTime - this.startedAt + this.startOffset;
      return this.loop ? elapsed % this.duration : Math.min(elapsed, this.duration);
    }
    return this.pausedAt;
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  async play(from?: number): Promise<void> {
    await this.ensure();
    if (this.liveInput) await this.setLiveInput(false);
    const ctx = this.ctx!;
    const buffer = this.ensureBuffer();
    if (!buffer || !this.analyserIn) return;
    this.stopSource();
    const offset = from ?? (this.transport === "paused" ? this.pausedAt : 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = this.loop;
    source.connect(this.analyserIn);
    source.onended = () => {
      if (this.source === source && !this.loop) {
        this.transport = "stopped";
        this.pausedAt = 0;
        this.onChange?.();
      }
    };
    source.start(0, Math.min(offset, Math.max(0, this.duration - 0.001)));
    this.source = source;
    this.startedAt = ctx.currentTime;
    this.startOffset = offset;
    this.transport = "playing";
    this.onChange?.();
  }

  pause(): void {
    if (this.transport !== "playing") return;
    this.pausedAt = this.position;
    this.stopSource();
    this.transport = "paused";
    this.onChange?.();
  }

  stop(): void {
    this.stopSource();
    this.pausedAt = 0;
    this.transport = "stopped";
    this.onChange?.();
  }

  seek(seconds: number): void {
    const t = Math.max(0, Math.min(this.duration, seconds));
    if (this.transport === "playing") {
      void this.play(t);
    } else {
      this.pausedAt = t;
      this.transport = this.track ? "paused" : "stopped";
      this.onChange?.();
    }
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.source) this.source.loop = loop;
    if (loop && this.transport === "stopped") this.onChange?.();
  }

  async setLiveInput(enabled: boolean): Promise<void> {
    if (enabled === this.liveInput) return;
    if (!enabled) {
      this.liveSource?.disconnect();
      this.liveStream?.getTracks().forEach((t) => t.stop());
      this.liveSource = null;
      this.liveStream = null;
      this.liveInput = false;
      this.onChange?.();
      return;
    }
    await this.ensure();
    this.stopSource();
    this.transport = "stopped";
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
    });
    this.liveStream = stream;
    this.liveSource = this.ctx!.createMediaStreamSource(stream);
    this.liveSource.connect(this.analyserIn!);
    this.liveInput = true;
    this.onChange?.();
  }

  /** Live spectra (dB per log band) of what goes into and comes out of the firmware DSP. */
  getSpectra(bands = 64): { input: Float32Array; output: Float32Array } | null {
    if (!this.analyserIn || !this.analyserOut || !this.ctx) return null;
    this.analyserIn.getFloatFrequencyData(this.fftIn as Float32Array<ArrayBuffer>);
    this.analyserOut.getFloatFrequencyData(this.fftOut as Float32Array<ArrayBuffer>);
    return {
      input: binsToBands(this.fftIn, this.ctx.sampleRate, bands),
      output: binsToBands(this.fftOut, this.ctx.sampleRate, bands),
    };
  }

  dispose(): void {
    this.stopSource();
    void this.setLiveInput(false);
    void this.ctx?.close();
    this.ctx = null;
  }
}
