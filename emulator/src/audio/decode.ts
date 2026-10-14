import { SAMPLE_RATE } from "../core/constants";
import { resample } from "./resample";
import type { Track } from "./track";

export interface ParsedAudio {
  channels: Float32Array[];
  sampleRate: number;
  format: string;
}

const text = (view: DataView, offset: number, length: number): string => {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
};

function readSample(view: DataView, offset: number, bits: number, float: boolean, little: boolean): number {
  if (float) {
    return bits === 64 ? view.getFloat64(offset, little) : view.getFloat32(offset, little);
  }
  switch (bits) {
    case 8:
      return (view.getUint8(offset) - 128) / 128; // WAV 8-bit is unsigned
    case 16:
      return view.getInt16(offset, little) / 32768;
    case 24: {
      const b0 = view.getUint8(offset + (little ? 0 : 2));
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getUint8(offset + (little ? 2 : 0));
      let v = (b2 << 16) | (b1 << 8) | b0;
      if (v & 0x800000) v -= 0x1000000;
      return v / 8388608;
    }
    case 32:
      return view.getInt32(offset, little) / 2147483648;
    default:
      throw new Error(`Unsupported bit depth ${bits}`);
  }
}

export function parseWav(buffer: ArrayBuffer): ParsedAudio {
  const view = new DataView(buffer);
  if (text(view, 0, 4) !== "RIFF" || text(view, 8, 4) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let pos = 12;
  let fmt: { tag: number; channels: number; rate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (pos + 8 <= view.byteLength) {
    const id = text(view, pos, 4);
    let size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      let tag = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (tag === 0xfffe && size >= 26) {
        tag = view.getUint16(body + 24, true); // sub-format GUID starts with the format tag
      }
      fmt = { tag, channels, rate, bits };
    } else if (id === "data") {
      dataOffset = body;
      if (body + size > view.byteLength) size = view.byteLength - body; // streamed / truncated files
      dataLength = size;
      break;
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || dataOffset < 0) {
    throw new Error("WAV is missing fmt or data chunk");
  }
  if (fmt.tag !== 1 && fmt.tag !== 3) {
    throw new Error(`Unsupported WAV format tag ${fmt.tag}`);
  }
  const bytes = fmt.bits / 8;
  const frames = Math.floor(dataLength / (bytes * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      channels[c][i] = readSample(view, dataOffset + (i * fmt.channels + c) * bytes, fmt.bits, fmt.tag === 3, true);
    }
  }
  return { channels, sampleRate: fmt.rate, format: `WAV ${fmt.bits}-bit${fmt.tag === 3 ? " float" : ""}` };
}

function readExtended80(view: DataView, offset: number): number {
  const expon = view.getUint16(offset, false);
  const hi = view.getUint32(offset + 2, false);
  const lo = view.getUint32(offset + 6, false);
  const sign = expon & 0x8000 ? -1 : 1;
  const e = expon & 0x7fff;
  if (e === 0 && hi === 0 && lo === 0) return 0;
  return sign * (hi * Math.pow(2, e - 16383 - 31) + lo * Math.pow(2, e - 16383 - 63));
}

export function parseAiff(buffer: ArrayBuffer): ParsedAudio {
  const view = new DataView(buffer);
  const form = text(view, 0, 4);
  const type = text(view, 8, 4);
  if (form !== "FORM" || (type !== "AIFF" && type !== "AIFC")) {
    throw new Error("Not an AIFF file");
  }
  let pos = 12;
  let comm: { channels: number; frames: number; bits: number; rate: number; compression: string } | null = null;
  let ssnd = -1;
  let ssndLength = 0;
  while (pos + 8 <= view.byteLength) {
    const id = text(view, pos, 4);
    let size = view.getUint32(pos + 4, false);
    const body = pos + 8;
    if (id === "COMM") {
      comm = {
        channels: view.getUint16(body, false),
        frames: view.getUint32(body + 2, false),
        bits: view.getUint16(body + 6, false),
        rate: readExtended80(view, body + 8),
        compression: type === "AIFC" ? text(view, body + 18, 4) : "NONE",
      };
    } else if (id === "SSND") {
      const offset = view.getUint32(body, false);
      ssnd = body + 8 + offset;
      if (body + size > view.byteLength) size = view.byteLength - body;
      ssndLength = size - 8 - offset;
    }
    pos = body + size + (size & 1);
  }
  if (!comm || ssnd < 0) {
    throw new Error("AIFF is missing COMM or SSND chunk");
  }
  const little = comm.compression === "sowt";
  const float = comm.compression === "fl32" || comm.compression === "FL32" || comm.compression === "fl64";
  if (!["NONE", "none", "sowt", "fl32", "FL32", "fl64"].includes(comm.compression)) {
    throw new Error(`Unsupported AIFF-C compression '${comm.compression}'`);
  }
  const bits = comm.compression === "fl64" ? 64 : float ? 32 : comm.bits;
  const bytes = Math.ceil(bits / 8);
  const frames = Math.min(comm.frames, Math.floor(ssndLength / (bytes * comm.channels)));
  const channels = Array.from({ length: comm.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < comm.channels; c++) {
      const offset = ssnd + (i * comm.channels + c) * bytes;
      channels[c][i] =
        bits === 8 ? view.getInt8(offset) / 128 : readSample(view, offset, bits, float, little);
    }
  }
  return {
    channels,
    sampleRate: comm.rate,
    format: `AIFF${type === "AIFC" ? "-C" : ""} ${bits}-bit${float ? " float" : ""}`,
  };
}

/** Normalises any parsed audio to a stereo track at the firmware sample rate. */
export function toTrack(parsed: ParsedAudio, name: string): Track {
  const first = parsed.channels[0] ?? new Float32Array(0);
  const second = parsed.channels[1] ?? first;
  const left = resample(first, parsed.sampleRate, SAMPLE_RATE);
  const right = second === first ? left.slice() : resample(second, parsed.sampleRate, SAMPLE_RATE);
  return { name, sampleRate: SAMPLE_RATE, left, right };
}

export function sniffFormat(buffer: ArrayBuffer): "wav" | "aiff" | "other" {
  if (buffer.byteLength < 12) return "other";
  const view = new DataView(buffer);
  const head = text(view, 0, 4);
  if (head === "RIFF" && text(view, 8, 4) === "WAVE") return "wav";
  if (head === "FORM" && ["AIFF", "AIFC"].includes(text(view, 8, 4))) return "aiff";
  return "other";
}

export interface DecodedFile {
  track: Track;
  format: string;
  /** 0 when the browser decoder already resampled to the firmware rate */
  originalRate: number;
}

/** WAV/AIFF are parsed here (any bit depth/rate); MP3 and everything else goes through the browser decoder. */
export async function decodeAudioFile(file: File, ctx: BaseAudioContext): Promise<DecodedFile> {
  const bytes = await file.arrayBuffer();
  const kind = sniffFormat(bytes);
  const name = file.name.replace(/\.[^.]+$/, "");
  if (kind !== "other") {
    try {
      const parsed = kind === "wav" ? parseWav(bytes) : parseAiff(bytes);
      return { track: toTrack(parsed, name), format: parsed.format, originalRate: parsed.sampleRate };
    } catch (error) {
      console.warn("Built-in parser failed, falling back to browser decoder", error);
    }
  }
  const decoded = await ctx.decodeAudioData(bytes.slice(0));
  const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, c) => decoded.getChannelData(c).slice());
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "audio";
  return {
    track: toTrack({ channels, sampleRate: decoded.sampleRate, format: ext }, name),
    format: `${ext} (browser decoder)`,
    originalRate: 0,
  };
}
