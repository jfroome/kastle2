import type { StereoSignal } from "../engine/offline";

export type WavBits = 16 | 24 | 32;

/** Encodes a stereo signal as a WAV file. 16/24-bit use TPDF-free rounding with clipping, 32 is float. */
export function encodeWav(signal: StereoSignal, bits: WavBits = 24): ArrayBuffer {
  const frames = signal.left.length;
  const bytes = bits / 8;
  const dataSize = frames * 2 * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, bits === 32 ? 3 : 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, signal.sampleRate, true);
  view.setUint32(28, signal.sampleRate * 2 * bytes, true);
  view.setUint16(32, 2 * bytes, true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of [signal.left, signal.right]) {
      const x = channel[i];
      if (bits === 32) {
        view.setFloat32(offset, x, true);
      } else if (bits === 16) {
        view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(x * 32768))), true);
      } else {
        const v = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388608)));
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
      }
      offset += bytes;
    }
  }
  return buffer;
}
