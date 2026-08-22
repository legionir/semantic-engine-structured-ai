import { AnimationTrack } from './types';

export interface AnimationClipData {
  name: string;
  duration: number;
  tracks: AnimationTrack[];
}

export class AnimationClip {
  readonly name: string;
  readonly duration: number;
  readonly tracks: AnimationTrack[];

  constructor(data: AnimationClipData) {
    this.name = data.name;
    this.duration = data.duration;
    this.tracks = data.tracks;
  }

  static fromJSON(json: any): AnimationClip {
    return new AnimationClip(json);
  }

  toJSON(): AnimationClipData {
    return {
      name: this.name,
      duration: this.duration,
      tracks: this.tracks
    };
  }
}
