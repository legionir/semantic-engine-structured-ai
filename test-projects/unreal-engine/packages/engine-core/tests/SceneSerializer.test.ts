import { describe, expect, it } from "vitest";
import { Scene } from "../src/scene/Scene.js";
import type { TransformComponent } from "../src/transform/TransformComponent.js";
import { serializeScene, deserializeSceneFromJSON, serializeSceneToJSON, SCENE_SCHEMA_VERSION } from "../src/scene/SceneSerializer.js";
import { Vec3 } from "../src/math/math.js";
import { createTransformSystem } from "../src/transform/TransformSystem.js";

describe("SceneSerializer", () => {
  it("serializes a scene to JSON and back with identical data", () => {
    const scene = new Scene({ name: "Test Scene" });
    const parent = scene.createEntity("Parent");
    const child = scene.createEntity("Child", parent);
    const parentTransform = parent.getComponent<TransformComponent>("transform")!;
    const childTransform = child.getComponent<TransformComponent>("transform")!;
    parentTransform.setPosition(10, 0, 0);
    childTransform.setPosition(0, 5, 0);

    createTransformSystem(scene.world).updateTransforms();

    const json = serializeSceneToJSON(scene);
    const restored = deserializeSceneFromJSON(json);

    expect(restored.name).toBe("Test Scene");
    expect(restored.world.size).toBe(2);

    const restoredParent = restored.world.queryAll("transform").find((e) => e.name === "Parent")!;
    const restoredChild = restored.world.queryAll("transform").find((e) => e.name === "Child")!;
    const restoredParentTransform = restoredParent.getComponent<TransformComponent>("transform")!;
    const restoredChildTransform = restoredChild.getComponent<TransformComponent>("transform")!;

    expect(restoredParentTransform.getParentId()).toBeUndefined();
    expect(restoredChildTransform.getParentId()).toBe(restoredParent.id);
    expect(restoredChildTransform.getParent()!.entity.id).toBe(restoredParent.id);

    const worldPos = Vec3.create();
    restoredChildTransform.getWorldPosition(worldPos);
    expect(worldPos[0]).toBeCloseTo(10);
    expect(worldPos[1]).toBeCloseTo(5);
  });

  it("uses schema versioning", () => {
    const scene = new Scene();
    scene.createEntity("Cube");
    const snapshot = serializeScene(scene);
    expect(snapshot.version).toBe(SCENE_SCHEMA_VERSION);
  });
});
