import { describe, expect, it } from "vitest";
import { Scene } from "../src/scene/Scene.js";
import type { TransformComponent } from "../src/transform/TransformComponent.js";
import { createTransformSystem } from "../src/transform/TransformSystem.js";
import { Vec3 } from "../src/math/math.js";

describe("TransformComponent", () => {
  it("computes local matrix from position/rotation/scale", () => {
    const scene = new Scene();
    const entity = scene.createEntity();
    const transform = entity.getComponent<TransformComponent>("transform")!;
    transform.setPosition(1, 2, 3);
    transform.setScale(2, 2, 2);

    const worldPos = Vec3.create();
    transform.getWorldPosition(worldPos);
    expect(worldPos[0]).toBeCloseTo(1);
    expect(worldPos[1]).toBeCloseTo(2);
    expect(worldPos[2]).toBeCloseTo(3);
  });

  it("propagates world transform to children", () => {
    const scene = new Scene();
    const parent = scene.createEntity("Parent");
    const child = scene.createEntity("Child", parent);
    const parentTransform = parent.getComponent<TransformComponent>("transform")!;
    const childTransform = child.getComponent<TransformComponent>("transform")!;

    parentTransform.setPosition(10, 0, 0);
    childTransform.setPosition(5, 0, 0);

    createTransformSystem(scene.world).updateTransforms();

    const worldPos = Vec3.create();
    childTransform.getWorldPosition(worldPos);
    expect(worldPos[0]).toBeCloseTo(15);
    expect(worldPos[1]).toBeCloseTo(0);
    expect(worldPos[2]).toBeCloseTo(0);
  });

  it("serializes and restores transforms", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cube");
    const transform = entity.getComponent<TransformComponent>("transform")!;
    transform.setPosition(1, 2, 3);
    transform.setRotation(0, 45, 0);

    const snapshot = transform.toJSON();
    expect(snapshot.position).toEqual([1, 2, 3]);
    expect(snapshot.rotation[1]).toBeCloseTo(Math.sin(22.5 * Math.PI / 180));
  });
});
