import { World } from "../ecs/index.js";
import { generateUUID } from "../util/uuid.js";
import type { Entity } from "../ecs/types.js";
import { TransformComponent } from "../transform/TransformComponent.js";

export interface SceneOptions {
  id?: string;
  name?: string;
}

export class Scene {
  readonly id: string;
  name: string;
  readonly world: World;

  constructor(options: SceneOptions = {}) {
    this.id = options.id ?? generateUUID();
    this.name = options.name ?? "Untitled Scene";
    this.world = new World();
  }

  createEntity(name?: string, parent?: Entity, id?: string): Entity {
    const entity = this.world.createEntity(name, id);
    const transform = new TransformComponent(entity);
    entity.addComponent(transform);
    if (parent) {
      const parentTransform = parent.getComponent<TransformComponent>("transform");
      if (parentTransform) parentTransform.addChild(transform);
    }
    return entity;
  }

  getRootEntities(): Entity[] {
    const result: Entity[] = [];
    this.world.query<TransformComponent>("transform").forEach((transform) => {
      if (!transform.getParentId()) result.push(transform.entity);
    });
    return result;
  }

  clear(): void {
    this.world.clear();
  }
}
