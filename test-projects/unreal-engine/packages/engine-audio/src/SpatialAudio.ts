import { AudioSource } from "./AudioSource.js";

/** Distance model for the panner node. */
export type DistanceModel = "linear" | "inverse" | "exponential";

/**
 * SpatialAudio attaches a PannerNode to an AudioSource and provides
 * controls for 3D spatial positioning, distance attenuation, and
 * directional cones.
 */
export class SpatialAudio {
  /** The PannerNode instance. */
  readonly panner: PannerNode;

  /** Position in 3D space. */
  position: [number, number, number] = [0, 0, 0];

  /** Orientation direction for the cone. */
  orientation: [number, number, number] = [0, 0, -1];

  constructor(
    context: AudioContext,
    private readonly source: AudioSource,
    options?: SpatialAudioOptions,
  ) {
    this.panner = context.createPanner();
    this.applyOptions(options);

    // Attach the panner to the source
    this.source.setPanner(this.panner);
  }

  /** Update the panner position and orientation from the stored values. */
  update(): void {
    const { panner, position, orientation } = this;
    panner.positionX.value = position[0];
    panner.positionY.value = position[1];
    panner.positionZ.value = position[2];
    panner.orientationX.value = orientation[0];
    panner.orientationY.value = orientation[1];
    panner.orientationZ.value = orientation[2];
  }

  /**
   * Set the 3D position of the audio source.
   */
  setPosition(x: number, y: number, z: number): void {
    this.position = [x, y, z];
    this.panner.positionX.value = x;
    this.panner.positionY.value = y;
    this.panner.positionZ.value = z;
  }

  /**
   * Set the orientation of the audio source (used for cone direction).
   */
  setOrientation(x: number, y: number, z: number): void {
    this.orientation = [x, y, z];
    this.panner.orientationX.value = x;
    this.panner.orientationY.value = y;
    this.panner.orientationZ.value = z;
  }

  /**
   * Configure the distance attenuation model.
   */
  setDistanceModel(model: DistanceModel): void {
    this.panner.distanceModel = model;
  }

  /**
   * Set the reference distance (the distance at which the volume is at the
   * original level). Default is 1.
   */
  setRefDistance(value: number): void {
    this.panner.refDistance = value;
  }

  /**
   * Set the maximum distance beyond which the audio is silent.
   */
  setMaxDistance(value: number): void {
    this.panner.maxDistance = value;
  }

  /**
   * Set the rolloff factor (how quickly the volume decreases).
   */
  setRolloffFactor(value: number): void {
    this.panner.rolloffFactor = value;
  }

  /**
   * Configure the directional cone.
   * @param innerAngle  Inner cone angle in degrees (default 360).
   * @param outerAngle  Outer cone angle in degrees (default 360).
   * @param outerGain   Volume outside the outer cone (0 to 1, default 0).
   */
  setCone(innerAngle: number, outerAngle: number, outerGain: number): void {
    this.panner.coneInnerAngle = innerAngle;
    this.panner.coneOuterAngle = outerAngle;
    this.panner.coneOuterGain = outerGain;
  }

  /** Remove the panner from the source (audio becomes non-spatial). */
  detach(): void {
    this.source.removePanner();
  }

  private applyOptions(options?: SpatialAudioOptions): void {
    if (!options) return;
    if (options.position) this.position = [...options.position];
    if (options.orientation) this.orientation = [...options.orientation];
    if (options.distanceModel !== undefined) this.panner.distanceModel = options.distanceModel;
    if (options.refDistance !== undefined) this.panner.refDistance = options.refDistance;
    if (options.maxDistance !== undefined) this.panner.maxDistance = options.maxDistance;
    if (options.rolloffFactor !== undefined) this.panner.rolloffFactor = options.rolloffFactor;
    if (options.coneInnerAngle !== undefined) this.panner.coneInnerAngle = options.coneInnerAngle;
    if (options.coneOuterAngle !== undefined) this.panner.coneOuterAngle = options.coneOuterAngle;
    if (options.coneOuterGain !== undefined) this.panner.coneOuterGain = options.coneOuterGain;
  }
}

export interface SpatialAudioOptions {
  position?: [number, number, number];
  orientation?: [number, number, number];
  distanceModel?: DistanceModel;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
}
