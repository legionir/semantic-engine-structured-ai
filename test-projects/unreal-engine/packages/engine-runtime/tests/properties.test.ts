import { describe, it, expect } from "vitest";
import { Scene, getPropertyGroups } from "@web-engine/engine-core";
import type { TransformComponent } from "@web-engine/engine-core";
import { createBoxMesh } from "@web-engine/engine-renderer";
import { CameraComponent, MaterialComponent, MeshComponent } from "../src/index.js";

describe("TransformComponent properties", () => {
  it("exposes position, rotation and scale as vector3 properties", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cube");
    const transform = entity.getComponent<TransformComponent>("transform")!;
    transform.setPosition(1, 2, 3);
    transform.setScale(2, 2, 2);

    const groups = getPropertyGroups(transform);
    expect(groups).not.toBeNull();
    expect(groups![0].label).toBe("Transform");
    expect(groups![0].properties).toHaveLength(3);

    const position = groups![0].properties.find((p) => p.key === "position")!;
    expect(position.type).toBe("vector3");
    expect(position.get()).toEqual([1, 2, 3]);

    position.set([4, 5, 6]);
    expect(transform.position[0]).toBe(4);
    expect(transform.position[2]).toBe(6);
  });

  it("converts rotation through euler degrees", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cube");
    const transform = entity.getComponent<TransformComponent>("transform")!;

    const groups = getPropertyGroups(transform)!;
    const rotation = groups[0].properties.find((p) => p.key === "rotation")!;
    rotation.set([0, 90, 0]);

    const value = rotation.get() as number[];
    expect(value[1]).toBeCloseTo(90, 1);
  });
});

describe("Runtime component properties", () => {
  it("exposes mesh properties", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cube");
    const mesh = new MeshComponent(entity, createBoxMesh("c:mesh"), true, true);
    entity.addComponent(mesh);

    const groups = getPropertyGroups(mesh);
    expect(groups![0].label).toBe("Mesh");
    const visible = groups![0].properties.find((p) => p.key === "visible")!;
    expect(visible.get()).toBe(true);
    visible.set(false);
    expect(mesh.visible).toBe(false);
  });

  it("exposes material properties and applies changes", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cube");
    const material = new MaterialComponent(entity);
    entity.addComponent(material);

    const groups = getPropertyGroups(material);
    expect(groups![0].label).toBe("Material");

    const baseColor = groups![0].properties.find((p) => p.key === "baseColor")!;
    baseColor.set([1, 0, 0, 1]);
    expect(material.material.baseColor[0]).toBe(1);
    expect(material.material.baseColor[1]).toBe(0);

    const roughness = groups![0].properties.find((p) => p.key === "roughness")!;
    roughness.set(0.25);
    expect(material.material.roughness).toBeCloseTo(0.25);
  });

  it("exposes camera properties", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cam");
    const camera = new CameraComponent(entity, undefined, true);
    camera.camera.setPerspective(45, 1.5, 0.1, 500);
    entity.addComponent(camera);

    const groups = getPropertyGroups(camera);
    const fov = groups![0].properties.find((p) => p.key === "fov")!;
    expect(fov.get()).toBe(45);
    fov.set(70);
    expect(camera.camera.fov).toBe(70);

    const projection = groups![0].properties.find((p) => p.key === "projectionType")!;
    projection.set("orthographic");
    expect(camera.camera.projectionType).toBe("orthographic");
  });
});

describe("getPropertyGroups", () => {
  it("returns null for non-provider values", () => {
    expect(getPropertyGroups(42)).toBeNull();
    expect(getPropertyGroups({})).toBeNull();
  });
});
