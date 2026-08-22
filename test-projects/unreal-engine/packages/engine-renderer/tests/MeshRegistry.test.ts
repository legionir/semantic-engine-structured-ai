import { describe, it, expect } from "vitest";
import { MeshRegistry, createBoxMesh, createSphereMesh } from "../src/index.js";

describe("MeshRegistry", () => {
  it("registers and retrieves meshes by id", () => {
    const registry = new MeshRegistry();
    const box = createBoxMesh("box:mesh");
    registry.register(box);
    expect(registry.get("box:mesh")).toBe(box);
    expect(registry.getMesh("box:mesh")).toBe(box);
    expect(registry.has("box:mesh")).toBe(true);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("round-trips meshes through JSON preserving geometry", () => {
    const registry = new MeshRegistry();
    registry.register(createBoxMesh("box:mesh", 2));
    registry.register(createSphereMesh("sphere:mesh", 0.5, 16, 12));

    const json = registry.toJSON();
    expect(json).toHaveLength(2);

    const restored = new MeshRegistry();
    const meshes = restored.fromJSON(json);
    expect(meshes).toHaveLength(2);

    const box = restored.get("box:mesh")!;
    expect(box).toBeDefined();
    expect(box.primitives[0].positions.length).toBeGreaterThan(0);
    expect(box.bounds.max[0]).toBeCloseTo(1);

    const sphere = restored.get("sphere:mesh")!;
    expect(sphere.primitives[0].positions.length).toBeGreaterThan(0);
  });

  it("clears all meshes", () => {
    const registry = new MeshRegistry();
    registry.register(createBoxMesh("box:mesh"));
    expect(registry.size()).toBe(1);
    registry.clear();
    expect(registry.size()).toBe(0);
  });
});
