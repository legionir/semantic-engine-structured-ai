import type { World } from "@web-engine/engine-core";
import { AudioSourceComponent } from "./AudioSourceComponent.js";
import { Listener } from "./Listener.js";

/**
 * AudioSystem updates spatial audio positions each frame.
 * It synchronises the AudioSourceComponent's spatial audio position
 * from the entity's TransformComponent and updates the listener.
 */
export class AudioSystem {
  readonly priority = 15;

  /** The global audio listener. */
  listener: Listener | null = null;

  constructor(
    private readonly world: World,
    context: AudioContext,
  ) {
    this.listener = new Listener(context.listener);
  }

  update(_deltaTime: number, _time: number): void {
    // Update spatial audio positions for all entities with audio_source
    const entities = this.world.queryAll("audio_source");
    for (const entity of entities) {
      const audioComp = entity.getComponent<AudioSourceComponent>("audio_source");
      if (!audioComp || !audioComp.spatial) continue;

      // Sync position from transform component
      const transform = entity.getComponent("transform") as TransformLike | undefined;
      if (transform) {
        const pos = transform.position as readonly [number, number, number];
        audioComp.spatial.setPosition(pos[0], pos[1], pos[2]);
      }

      audioComp.spatial.update();
    }

    // Update the listener
    this.listener?.update();
  }

  /** Release resources. */
  dispose(): void {
    this.listener = null;
  }
}

/** Minimal interface to avoid depending on engine-core's transform types. */
interface TransformLike {
  position: [number, number, number] | Float32Array;
}
