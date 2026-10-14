import type { StereoSignal } from "../engine/offline";

export interface Track extends StereoSignal {
  name: string;
}

export function trackDuration(track: StereoSignal): number {
  return track.left.length / track.sampleRate;
}
