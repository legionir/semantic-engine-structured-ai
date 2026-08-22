import type { Scene } from "./Scene.js";
import { serializeEntity } from "../ecs/serialization.js";
import type { EntitySnapshot } from "../ecs/serialization.js";
import { TransformComponent } from "../transform/TransformComponent.js";
import { Scene as SceneImpl } from "./Scene.js";
import { Quat } from "../math/math.js";
import { createTransformSystem } from "../transform/TransformSystem.js";
import type { Entity, World } from "../ecs/types.js";

export const SCENE_SCHEMA_VERSION = 1;

export interface SceneSnapshot {
  version: number;
  id: string;
  name: string;
  entities: EntitySnapshot[];
}

export function serializeScene(scene: Scene): SceneSnapshot {
  const entities: EntitySnapshot[] = [];
  scene.world.queryAll("transform").forEach((entity) => {
    entities.push(serializeEntity(entity));
  });
  return {
    version: SCENE_SCHEMA_VERSION,
    id: scene.id,
    name: scene.name,
    entities,
  };
}

export interface ComponentFactory {
  (entity: Entity, data: Record<string, unknown>): void;
}

export function deserializeScene(snapshot: SceneSnapshot, componentFactories: Map<string, ComponentFactory> = new Map()): Scene {
  const scene: Scene = new SceneImpl({ id: snapshot.id, name: snapshot.name });

  const entityById = new Map<string, Entity>();
  const transformData = new Map<string, Record<string, unknown>>();

  snapshot.entities.forEach((entitySnapshot) => {
    const entity = scene.createEntity(entitySnapshot.name, undefined, entitySnapshot.id);
    entityById.set(entitySnapshot.id, entity);

    entitySnapshot.components.forEach((componentSnapshot) => {
      if (componentSnapshot.type === "transform") {
        transformData.set(entitySnapshot.id, componentSnapshot.data);
      }
    });
  });

  snapshot.entities.forEach((entitySnapshot) => {
    const entity = entityById.get(entitySnapshot.id);
    if (!entity) return;

    entitySnapshot.components.forEach((componentSnapshot) => {
      const factory = componentFactories.get(componentSnapshot.type);
      if (factory) {
        factory(entity, componentSnapshot.data);
      }
    });
  });

  snapshot.entities.forEach((entitySnapshot) => {
    const entity = entityById.get(entitySnapshot.id);
    if (!entity) return;
    const data = transformData.get(entitySnapshot.id);
    if (!data) return;

    const transform = entity.getComponent<TransformComponent>("transform");
    if (!transform) return;

    const pos = data["position"] as [number, number, number];
    const rot = data["rotation"] as [number, number, number, number];
    const scale = data["scale"] as [number, number, number];
    const parent = data["parent"] as string | undefined;

    if (pos) transform.setPosition(pos[0], pos[1], pos[2]);
    if (rot) {
      transform.rotation = Quat.fromValues(rot[0], rot[1], rot[2], rot[3]);
      transform.updateLocalMatrix();
    }
    if (scale) transform.setScale(scale[0], scale[1], scale[2]);

    if (parent && entityById.has(parent)) {
      const parentTransform = entityById.get(parent)!.getComponent<TransformComponent>("transform");
      if (parentTransform) parentTransform.addChild(transform);
    }
  });

  createTransformSystem(scene.world);

  return scene;
}

export function serializeSceneToJSON(scene: Scene): string {
  return JSON.stringify(serializeScene(scene), null, 2);
}

export function deserializeSceneFromJSON(json: string, componentFactories?: Map<string, ComponentFactory>): Scene {
  const snapshot = JSON.parse(json) as SceneSnapshot;
  return deserializeScene(snapshot, componentFactories);
}

export function deserializeEntityInto(world: World, snapshot: EntitySnapshot, componentFactories: Map<string, ComponentFactory> = new Map()): Entity {
  const entity = world.createEntity(snapshot.name, snapshot.id);
  entity.addComponent(new TransformComponent(entity));

  let transformData: Record<string, unknown> | undefined;
  snapshot.components.forEach((componentSnapshot) => {
    if (componentSnapshot.type === "transform") {
      transformData = componentSnapshot.data;
      return;
    }
    const factory = componentFactories.get(componentSnapshot.type);
    if (factory) {
      factory(entity, componentSnapshot.data);
    }
  });

  if (transformData) {
    const transform = entity.getComponent<TransformComponent>("transform");
    if (transform) {
      const pos = transformData["position"] as [number, number, number] | undefined;
      const rot = transformData["rotation"] as [number, number, number, number] | undefined;
      const scale = transformData["scale"] as [number, number, number] | undefined;
      const parent = transformData["parent"] as string | undefined;

      if (pos) transform.setPosition(pos[0], pos[1], pos[2]);
      if (rot) {
        transform.rotation = Quat.fromValues(rot[0], rot[1], rot[2], rot[3]);
        transform.updateLocalMatrix();
      }
      if (scale) transform.setScale(scale[0], scale[1], scale[2]);
      if (parent) {
        const parentTransform = world.getEntity(parent)?.getComponent<TransformComponent>("transform");
        if (parentTransform) parentTransform.addChild(transform);
      }
    }
  }

  return entity;
}
