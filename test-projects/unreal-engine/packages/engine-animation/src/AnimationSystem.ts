import type { System, Entity } from "@web-engine/engine-core";
import { TransformComponent } from "@web-engine/engine-core";
import { AnimationComponent } from "./AnimationComponent.js";
import { Vec3, Quat } from "@web-engine/engine-core";

export class AnimationSystem implements System {
  readonly priority = 10;

  private readonly entities: Entity[] = [];

  /**
   * @param getEntities  A function that returns all entities with AnimationComponent
   *                     and TransformComponent. This avoids coupling to a specific
   *                     World implementation.
   */
  constructor(
    private readonly getEntities: () => Entity[] = () => this.entities,
  ) {}

  /**
   * Set the list of entities to process (used when not using a World).
   */
  setEntities(entities: Entity[]): void {
    this.entities.length = 0;
    this.entities.push(...entities);
  }

  update(deltaTime: number, _time: number): void {
    const entities = this.getEntities();

    for (const entity of entities) {
      const animComp = entity.getComponent<AnimationComponent>("animation");
      const transformComp = entity.getComponent<TransformComponent>("transform");

      if (!animComp || !transformComp) continue;

      // Update the controller
      const result = animComp.controller.update(deltaTime * animComp.speed);

      if (!result) continue;

      // Apply the sampled animation to the transform component
      // The result is a map of targetNode -> property -> values
      // Use the entity's id as the target node
      const nodeData = result.get(entity.id);
      if (!nodeData) continue;

      const translation = nodeData.get("translation");
      const rotation = nodeData.get("rotation");
      const scale = nodeData.get("scale");

      if (translation && translation.length >= 3) {
        Vec3.set(transformComp.localPosition, translation[0], translation[1], translation[2]);
      }

      if (rotation && rotation.length >= 4) {
        Quat.set(transformComp.localRotation, rotation[0], rotation[1], rotation[2], rotation[3]);
      }

      if (scale && scale.length >= 3) {
        Vec3.set(transformComp.localScale, scale[0], scale[1], scale[2]);
      }

      // Mark the transform as dirty
      transformComp.markDirty();
    }
  }
}
