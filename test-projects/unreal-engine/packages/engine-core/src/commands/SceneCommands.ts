import type { Scene } from "../scene/Scene.js";
import type { World } from "../ecs/types.js";
import { serializeEntity, type EntitySnapshot } from "../ecs/serialization.js";
import { deserializeEntityInto, type ComponentFactory } from "../scene/SceneSerializer.js";
import type { Component, Entity } from "../ecs/types.js";
import { Quat } from "../math/math.js";
import { generateUUID } from "../util/uuid.js";
import type { TransformComponent, TransformSnapshot } from "../transform/TransformComponent.js";
import type { Command } from "./CommandManager.js";

export type ComponentInstantiator = (entity: Entity) => Component;

export class CreateEntityCommand implements Command {
  readonly label = "Create Entity";
  private createdId: string | undefined;

  constructor(
    private readonly scene: Scene,
    private readonly name: string,
    private readonly id?: string,
    private readonly parentId?: string,
  ) {}

  execute(): void {
    const parent = this.parentId ? this.scene.world.getEntity(this.parentId) : undefined;
    const entity = this.scene.createEntity(this.name, parent, this.id ?? this.createdId);
    this.createdId = entity.id;
  }

  undo(): void {
    if (this.createdId) {
      this.scene.world.destroyEntity(this.createdId);
    }
  }

  redo(): void {
    this.execute();
  }
}

export class DeleteEntityCommand implements Command {
  readonly label = "Delete Entity";
  private snapshots: EntitySnapshot[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly entityId: string,
    private readonly factories: Map<string, ComponentFactory> = new Map(),
  ) {}

  execute(): void {
    const entity = this.scene.world.getEntity(this.entityId);
    if (!entity) return;

    this.snapshots = collectSubtree(this.scene.world, this.entityId).map((e) => serializeEntity(e));
    this.snapshots.forEach((snapshot) => {
      this.scene.world.destroyEntity(snapshot.id);
    });
  }

  undo(): void {
    this.snapshots.forEach((snapshot) => {
      deserializeEntityInto(this.scene.world, snapshot, this.factories);
    });
  }

  redo(): void {
    this.snapshots.forEach((snapshot) => {
      const entity = this.scene.world.getEntity(snapshot.id);
      if (entity) {
        this.scene.world.destroyEntity(snapshot.id);
      }
    });
  }
}

export interface TransformDiff {
  before: TransformSnapshot;
  after: TransformSnapshot;
}

export class TransformCommand implements Command {
  readonly label = "Transform";
  private readonly before: TransformSnapshot;
  private readonly after: TransformSnapshot;

  constructor(
    private readonly scene: Scene,
    private readonly entityId: string,
    diff: TransformDiff,
  ) {
    this.before = diff.before;
    this.after = diff.after;
  }

  execute(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  redo(): void {
    this.apply(this.after);
  }

  private apply(snapshot: TransformSnapshot): void {
    const transform = this.scene.world.getEntity(this.entityId)?.getComponent<TransformComponent>("transform");
    if (!transform) return;
    transform.setPosition(snapshot.position[0], snapshot.position[1], snapshot.position[2]);
    transform.rotation = Quat.fromValues(snapshot.rotation[0], snapshot.rotation[1], snapshot.rotation[2], snapshot.rotation[3]);
    transform.updateLocalMatrix();
    transform.setScale(snapshot.scale[0], snapshot.scale[1], snapshot.scale[2]);
  }
}

export class AddComponentCommand implements Command {
  readonly label = "Add Component";
  private component: Component | undefined;

  constructor(
    private readonly scene: Scene,
    private readonly entityId: string,
    private readonly instantiator: ComponentInstantiator,
  ) {}

  execute(): void {
    const entity = this.scene.world.getEntity(this.entityId);
    if (!entity || this.component) return;
    this.component = this.instantiator(entity);
    entity.addComponent(this.component);
  }

  undo(): void {
    if (!this.component) return;
    this.scene.world.getEntity(this.entityId)?.removeComponent(this.component.type);
  }

  redo(): void {
    if (!this.component) return;
    this.scene.world.getEntity(this.entityId)?.addComponent(this.component);
  }
}

export class RemoveComponentCommand implements Command {
  readonly label = "Remove Component";
  private snapshot: EntitySnapshot["components"][number] | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly entityId: string,
    private readonly type: string,
    private readonly factories: Map<string, ComponentFactory> = new Map(),
  ) {}

  execute(): void {
    const entity = this.scene.world.getEntity(this.entityId);
    if (!entity) return;
    const component = entity.getComponent(this.type);
    if (!component) return;

    const serializable = component as Component & { toJSON?(): Record<string, unknown> };
    const data = typeof serializable.toJSON === "function" ? serializable.toJSON() : {};
    this.snapshot = { type: this.type, data };
    entity.removeComponent(this.type);
  }

  undo(): void {
    const entity = this.scene.world.getEntity(this.entityId);
    if (!entity || !this.snapshot) return;
    const factory = this.factories.get(this.type);
    if (factory) {
      factory(entity, this.snapshot.data);
    }
  }

  redo(): void {
    this.scene.world.getEntity(this.entityId)?.removeComponent(this.type);
  }
}

export class ChangePropertyCommand<T = unknown> implements Command {
  readonly label = "Change Property";

  constructor(
    private readonly apply: (value: T) => void,
    private readonly oldValue: T,
    private readonly newValue: T,
  ) {}

  execute(): void {
    this.apply(this.newValue);
  }

  undo(): void {
    this.apply(this.oldValue);
  }

  redo(): void {
    this.apply(this.newValue);
  }
}

export class RenameEntityCommand implements Command {
  readonly label = "Rename Entity";
  private oldName: string | undefined;

  constructor(
    private readonly scene: Scene,
    private readonly entityId: string,
    private readonly newName: string,
  ) {}

  execute(): void {
    const entity = this.scene.world.getEntity(this.entityId);
    if (!entity) return;
    this.oldName = entity.name;
    entity.name = this.newName;
  }

  undo(): void {
    const entity = this.scene.world.getEntity(this.entityId);
    if (entity && this.oldName !== undefined) {
      entity.name = this.oldName;
    }
  }

  redo(): void {
    const entity = this.scene.world.getEntity(this.entityId);
    if (entity) {
      entity.name = this.newName;
    }
  }
}

export class DuplicateEntityCommand implements Command {
  readonly label = "Duplicate Entity";
  private createdIds: string[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly entityId: string,
    private readonly factories: Map<string, ComponentFactory> = new Map(),
  ) {}

  getCreatedId(): string | undefined {
    return this.createdIds[0];
  }

  execute(): void {
    const root = this.scene.world.getEntity(this.entityId);
    if (!root) return;

    const subtree = collectSubtree(this.scene.world, this.entityId);
    const idMap = new Map<string, string>();
    subtree.forEach((entity) => idMap.set(entity.id, generateUUID()));

    const clones = subtree.map((entity) => {
      const snapshot = serializeEntity(entity);
      const isRoot = entity.id === this.entityId;
      const name = isRoot ? `${snapshot.name ?? "Entity"} Copy` : snapshot.name;
      const cloneSnapshot: EntitySnapshot = {
        ...snapshot,
        id: idMap.get(snapshot.id)!,
        name,
        components: snapshot.components.map((c) => ({
          ...c,
          data: { ...c.data, parent: undefined },
        })),
      };
      return deserializeEntityInto(this.scene.world, cloneSnapshot, this.factories);
    });

    subtree.forEach((entity, index) => {
      const clone = clones[index];
      const snapshot = serializeEntity(entity);
      const transform = clone.getComponent<TransformComponent>("transform");
      const parentId = (snapshot.components.find((c) => c.type === "transform")?.data as TransformSnapshot | undefined)?.parent;
      if (parentId && transform) {
        const targetParentId = idMap.get(parentId) ?? parentId;
        const parentTransform = this.scene.world.getEntity(targetParentId)?.getComponent<TransformComponent>("transform");
        if (parentTransform) parentTransform.addChild(transform);
      }
    });

    this.createdIds = clones.map((clone) => clone.id);
  }

  undo(): void {
    this.createdIds.forEach((id) => this.scene.world.destroyEntity(id));
    this.createdIds = [];
  }

  redo(): void {
    this.execute();
  }
}

function collectSubtree(world: World, entityId: string): Entity[] {
  const result: Entity[] = [];
  const visit = (id: string): void => {
    const entity = world.getEntity(id);
    if (!entity) return;
    result.push(entity);
    const transform = entity.getComponent<TransformComponent>("transform");
    if (transform) {
      transform.getChildIds().forEach(visit);
    }
  };
  visit(entityId);
  return result;
}
