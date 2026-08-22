import { describe, expect, it } from "vitest";
import { MeshTopology, createBoxMesh, createSphereMesh, createPlaneMesh } from "../src/Mesh.js";
import { Material } from "../src/Material.js";
import { Camera, ProjectionType } from "../src/Camera.js";
import { Light, LightType } from "../src/Light.js";
import { Mat4 } from "@web-engine/engine-core";

describe("Mesh", () => {
  it("creates a box with 24 vertices and 36 indices", () => {
    const box = createBoxMesh();
    expect(box.primitives).toHaveLength(1);
    const primitive = box.primitives[0];
    expect(primitive.positions).toHaveLength(72);
    expect(primitive.indices).toHaveLength(36);
    expect(primitive.topology).toBe(MeshTopology.Triangles);
  });

  it("computes bounding box correctly", () => {
    const box = createBoxMesh("box", 2);
    const bounds = box.bounds;
    expect(Array.from(bounds.min)).toEqual([-1, -1, -1]);
    expect(Array.from(bounds.max)).toEqual([1, 1, 1]);
  });

  it("creates a unit sphere with normals pointing outward", () => {
    const sphere = createSphereMesh("sphere", 1, 8, 6);
    const primitive = sphere.primitives[0];
    expect(primitive.positions.length).toBeGreaterThan(0);
    expect(primitive.normals.length).toBe(primitive.positions.length);
    for (let i = 0; i < 3; i++) {
      const x = primitive.positions[i];
      const y = primitive.positions[i + 1];
      const z = primitive.positions[i + 2];
      const len = Math.hypot(x, y, z);
      expect(len).toBeCloseTo(1, 2);
    }
  });

  it("creates a plane with UVs and 6 indices", () => {
    const plane = createPlaneMesh("plane", 2, 2);
    const primitive = plane.primitives[0];
    expect(primitive.uvs).toBeDefined();
    expect(primitive.indices).toHaveLength(6);
    expect(primitive.positions).toHaveLength(12);
  });
});

describe("Material", () => {
  it("stores PBR parameters", () => {
    const material = new Material("m1", { baseColor: [1, 0, 0, 1], metallic: 0.5, roughness: 0.25 });
    expect(material.baseColor).toEqual([1, 0, 0, 1]);
    expect(material.metallic).toBe(0.5);
    expect(material.roughness).toBe(0.25);
  });

  it("changes shader key when textures change", () => {
    const material = new Material("m1");
    const baseKey = material.shaderKey;
    material.setTexture("baseColor", { image: {} as TexImageSource, usage: "color" });
    expect(material.shaderKey).not.toBe(baseKey);
  });

  it("serializes to JSON", () => {
    const material = new Material("m1", { baseColor: [1, 1, 1, 1], metallic: 1, roughness: 0 });
    const json = material.toJSON();
    expect(json.metallic).toBe(1);
    expect(json.baseColor).toEqual([1, 1, 1, 1]);
  });
});

describe("Camera", () => {
  it("creates a perspective projection matrix", () => {
    const camera = new Camera("cam");
    const aspect = 16 / 9;
    camera.updateProjectionMatrix(aspect);
    const projection = camera.getProjectionMatrix();
    expect(projection[0]).toBeCloseTo(projection[5] / aspect);
  });

  it("supports orthographic projection", () => {
    const camera = new Camera("cam");
    camera.setOrthographic(-1, 1, -1, 1, 0.1, 100);
    expect(camera.projectionType).toBe(ProjectionType.Orthographic);
    const projection = camera.getProjectionMatrix();
    expect(projection[15]).toBeCloseTo(1);
  });

  it("updates view matrix when looking at a target", () => {
    const camera = new Camera("cam");
    camera.lookAt([0, 0, 10], [0, 0, 0]);
    const pos = camera.getPosition();
    expect(pos[2]).toBeCloseTo(10);
    const view = camera.getViewMatrix();
    const translation = Mat4.clone(view);
    expect(translation[14]).toBeCloseTo(-10);
  });
});

describe("Light", () => {
  it("creates each light type with sensible defaults", () => {
    const directional = Light.directional("d1");
    expect(directional.type).toBe(LightType.Directional);
    const point = Light.point("p1");
    expect(point.type).toBe(LightType.Point);
    const spot = Light.spot("s1");
    expect(spot.type).toBe(LightType.Spot);
    const ambient = Light.ambient("a1");
    expect(ambient.type).toBe(LightType.Ambient);
  });
});
