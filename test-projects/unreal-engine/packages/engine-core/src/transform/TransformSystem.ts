import type { World } from "../ecs/index.js";

import type { Mat4 } from "../math/math.js";
import type { TransformComponent } from "./TransformComponent.js";

export class TransformSystem {
  readonly priority = 0;

  constructor(private readonly world: World) {}

  update(_deltaTime: number, _time: number): void {
    this.updateTransforms();
  }

  updateTransforms(): void {
    const roots = this.world.query<TransformComponent>("transform").filter((t) => !t.getParentId());
    roots.forEach((root) => {
      root.updateWorldMatrix(undefined);
      this.updateChildren(root, root.getWorldMatrix());
    });
  }

  private updateChildren(parent: TransformComponent, parentWorldMatrix: Mat4): void {
    parent.getChildren().forEach((child) => {
      child.updateWorldMatrix(parentWorldMatrix);
      this.updateChildren(child, child.getWorldMatrix());
    });
  }
}

export function createTransformSystem(world: World): TransformSystem {
  const system = new TransformSystem(world);
  world.addSystem(system);
  return system;
}
