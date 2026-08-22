export interface AnimationKeyframe {
  time: number;
  value: any;
}

export interface AnimationTrack {
  targetProperty: string;
  keyframes: AnimationKeyframe[];
}
