import { describe, expect, it } from "vitest";
import { Scene } from "../src/scene/Scene.js";
import type { TransformComponent } from "../src/transform/TransformComponent.js";
import {
  serializeScene,
  deserializeScene,
  deserializeSceneFromJSON,
  serializeSceneToJSON,
  SCENE_SCHEMA_VERSION,
  type ComponentFactory,
} from "../src/scene/SceneSerializer.js";
import { serializeEntity } from "../src/ecs/serialization.js";
import { Vec3, Quat } from "../src/math/math.js";
import { createTransformSystem } from "../src/transform/TransformSystem.js";
import { BaseComponent, type Entity } from "../src/ecs/index.js";

class TestComponent extends BaseComponent {
  override readonly type = "test";
  value: string;
  count: number;

  constructor(entity: Entity, value = "default", count = 0) {
    super(entity);
    this.value = value;
    this.count = count;
  }

  override toJSON(): Record<string, unknown> {
    return { value: this.value, count: this.count };
  }
}

describe("Serialization", () => {
  it("round-trips component data via component factories", () => {
    const scene = new Scene({ name: "Factory Scene" });
    const entity = scene.createEntity("WithComponent");
    entity.addComponent(new TestComponent(entity, "hello", 42));

    const snapshot = serializeScene(scene);
    const factories = new Map<string, ComponentFactory>();
    factories.set("test", (e, data) => {
      e.addComponent(new TestComponent(e, data["value"] as string, data["count"] as number));
    });

    const restored = deserializeScene(snapshot, factories);
    const restoredEntity = restored.world.queryAll("test")[0];
    expect(restoredEntity).toBeDefined();
    const component = restoredEntity.getComponent<TestComponent>("test")!;
    expect(component.value).toBe("hello");
    expect(component.count).toBe(42);
  });

  it("preserves entity ids and names across round-trip", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Player");
    const originalId = entity.id;

    const json = serializeSceneToJSON(scene);
    const restored = deserializeSceneFromJSON(json);

    expect(restored.world.getEntity(originalId)).toBeDefined();
    expect(restored.world.getEntity(originalId)!.name).toBe("Player");
  });

  it("round-trips deep hierarchies with world transforms intact", () => {
    const scene = new Scene();
    const root = scene.createEntity("Root");
    const child = scene.createEntity("Child", root);
    const grandChild = scene.createEntity("GrandChild", child);

    const rootT = root.getComponent<TransformComponent>("transform")!;
    const childT = child.getComponent<TransformComponent>("transform")!;
    const grandT = grandChild.getComponent<TransformComponent>("transform")!;

    rootT.setPosition(1, 0, 0);
    childT.setPosition(0, 2, 0);
    grandT.setPosition(0, 0, 3);

    const json = serializeSceneToJSON(scene);
    const restored = deserializeSceneFromJSON(json);

    const byName = (name: string) => restored.world.queryAll("transform").find((e) => e.name === name)!;
    const restoredGrand = byName("GrandChild").getComponent<TransformComponent>("transform")!;
    const worldPos = Vec3.create();
    restoredGrand.getWorldPosition(worldPos);
    expect(Array.from(worldPos)).toEqual([1, 2, 3]);
  });

  it("restores rotation and scale values", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Tilted");
    const transform = entity.getComponent<TransformComponent>("transform")!;
    transform.setRotation(0, 90, 0);
    transform.setScale(2, 3, 4);

    const json = serializeSceneToJSON(scene);
    const restored = deserializeSceneFromJSON(json);
    const restoredTransform = restored.world.queryAll("transform")[0].getComponent<TransformComponent>("transform")!;

    expect(Array.from(restoredTransform.scale)).toEqual([2, 3, 4]);

    const expected = Quat.fromEuler(Quat.create(), 0, 90, 0);
    expect(restoredTransform.rotation[0]).toBeCloseTo(expected[0]);
    expect(restoredTransform.rotation[1]).toBeCloseTo(expected[1]);
    expect(restoredTransform.rotation[2]).toBeCloseTo(expected[2]);
    expect(restoredTransform.rotation[3]).toBeCloseTo(expected[3]);
  });

  it("emits a stable schema version for migrations", () => {
    expect(SCENE_SCHEMA_VERSION).toBe(1);
    const snapshot = { version: SCENE_SCHEMA_VERSION, id: "x", name: "y", entities: [] };
    const restored = deserializeScene(snapshot);
    expect(restored.world.size).toBe(0);
  });

  it("creates a transform system on the restored scene", () => {
    const scene = new Scene();
    const parent = scene.createEntity("P");
    const child = scene.createEntity("C", parent);
    parent.getComponent<TransformComponent>("transform")!.setPosition(5, 0, 0);
    child.getComponent<TransformComponent>("transform")!.setPosition(5, 0, 0);

    const json = serializeSceneToJSON(scene);
    const restored = deserializeSceneFromJSON(json);
    const restoredChild = restored.world.queryAll("transform").find((e) => e.name === "C")!;
    const worldPos = Vec3.create();
    restoredChild.getComponent<TransformComponent>("transform")!.getWorldPosition(worldPos);
    expect(worldPos[0]).toBeCloseTo(10);
  });

  it("ignores non-serializable components without failing", () => {
    class NonSerializable extends BaseComponent {
      override readonly type = "nonserializable";
    }

    const scene = new Scene();
    const entity = scene.createEntity("NoJSON");
    entity.addComponent(new NonSerializable(entity));
    const snapshot = serializeEntity(entity);
    const types = snapshot.components.map((c) => c.type);
    expect(types).not.toContain("nonserializable");
  });
});

describe("TransformComponent", () => {
  it("computes world scale including parent scaling", () => {
    const scene = new Scene();
    const parent = scene.createEntity("P");
    const child = scene.createEntity("C", parent);
    parent.getComponent<TransformComponent>("transform")!.setScale(2, 2, 2);
    child.getComponent<TransformComponent>("transform")!.setScale(3, 3, 3);

    createTransformSystem(scene.world).updateTransforms();

    const worldScale = Vec3.create();
    child.getComponent<TransformComponent>("transform")!.getWorldScale(worldScale);
    expect(worldScale[0]).toBeCloseTo(6);
    expect(worldScale[1]).toBeCloseTo(6);
    expect(worldScale[2]).toBeCloseTo(6);
  });

  it("marks the world tree dirty after direct mutation", () => {
    const scene = new Scene();
    const parent = scene.createEntity("P");
    const child = scene.createEntity("C", parent);
    const parentT = parent.getComponent<TransformComponent>("transform")!;
    const childT = child.getComponent<TransformComponent>("transform")!;

    childT.position[1] = 2;
    childT.markDirty();

    parentT.setPosition(10, 0, 0);
    const worldPos = Vec3.create();
    childT.getWorldPosition(worldPos);
    expect(worldPos[0]).toBeCloseTo(10);
    expect(worldPos[1]).toBeCloseTo(2);
  });

  it("detaches a child when setParent(null) is called", () => {
    const scene = new Scene();
    const parent = scene.createEntity("P");
    const child = scene.createEntity("C", parent);
    const parentT = parent.getComponent<TransformComponent>("transform")!;
    const childT = child.getComponent<TransformComponent>("transform")!;

    parentT.setPosition(10, 0, 0);
    childT.setParent(null);

    const worldPos = Vec3.create();
    childT.getWorldPosition(worldPos);
    expect(worldPos[0]).toBeCloseTo(0);
  });
});
