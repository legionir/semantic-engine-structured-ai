import { BaseComponent, type Entity } from "@web-engine/engine-core";
import { AudioSource } from "./AudioSource.js";
import { SpatialAudio } from "./SpatialAudio.js";

/**
 * AudioSourceComponent attaches an AudioSource (and optionally SpatialAudio)
 * to an ECS entity.
 */
export class AudioSourceComponent extends BaseComponent {
  override readonly type = "audio_source";

  /** The AudioSource instance. */
  readonly source: AudioSource;

  /** Optional spatial audio wrapper. */
  spatial: SpatialAudio | null = null;

  constructor(
    entity: Entity,
    source: AudioSource,
    spatial: SpatialAudio | null = null,
  ) {
    super(entity);
    this.source = source;
    this.spatial = spatial;
  }

  /** Convenience: play the source. */
  play(): void {
    this.source.play();
  }

  /** Convenience: pause the source. */
  pause(): void {
    this.source.pause();
  }

  /** Convenience: stop the source. */
  stop(): void {
    this.source.stop();
  }

  override onDestroy(): void {
    this.source.dispose();
  }

  override toJSON(): Record<string, unknown> {
    return {
      volume: this.source.volume,
      pitch: this.source.pitch,
      loop: this.source.loop,
      url: this.source.clip?.url ?? null,
      spatial: this.spatial
        ? {
            position: [...this.spatial.position],
            orientation: [...this.spatial.orientation],
            distanceModel: this.spatial.panner.distanceModel,
            refDistance: this.spatial.panner.refDistance,
            maxDistance: this.spatial.panner.maxDistance,
            rolloffFactor: this.spatial.panner.rolloffFactor,
            coneInnerAngle: this.spatial.panner.coneInnerAngle,
            coneOuterAngle: this.spatial.panner.coneOuterAngle,
            coneOuterGain: this.spatial.panner.coneOuterGain,
          }
        : null,
    };
  }
}
