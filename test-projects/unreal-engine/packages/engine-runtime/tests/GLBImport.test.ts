import { describe, expect, it } from "vitest";
import { Scene, TransformComponent } from "@web-engine/engine-core";
import { importGLBIntoScene } from "../src/imports/GLBImport.js";
import { MeshComponent } from "../src/components/RenderComponents.js";
import { MaterialComponent } from "../src/components/RenderComponents.js";

function buildGLB(json: unknown, binary: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = padTo4(jsonBytes, 0x20);
  const binPadded = padTo4(binary, 0x00);

  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonPadded, 20);
  view.setUint32(20 + jsonPadded.length, binPadded.length, true);
  view.setUint32(24 + jsonPadded.length, 0x004e4942, true);
  bytes.set(binPadded, 28 + jsonPadded.length);
  return buffer;
}

function padTo4(data: Uint8Array, padChar = 0x20): Uint8Array {
  const padding = (4 - (data.length % 4)) % 4;
  if (padding === 0) return data;
  const result = new Uint8Array(data.length + padding);
  result.set(data);
  for (let i = data.length; i < result.length; i++) result[i] = padChar;
  return result;
}

describe("importGLBIntoScene", () => {
  it("creates renderable entities with mesh and material components", async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const json = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      materials: [{ name: "Red", pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
      meshes: [
        {
          name: "Triangle",
          primitives: [{ attributes: { POSITION: 0 }, indices: undefined, material: 0 }],
        },
      ],
      nodes: [
        { name: "Root", children: [1] },
        { name: "Child", mesh: 0 },
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };

    const glb = buildGLB(json, new Uint8Array(36));
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPaddedLen = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
    new Uint8Array(glb).set(new Uint8Array(positions.buffer), 28 + jsonPaddedLen);

    const scene = new Scene({ name: "GLB Scene" });
    const result = await importGLBIntoScene(glb, scene);

    expect(result.entities).toHaveLength(2);
    expect(result.meshes).toHaveLength(1);
    expect(result.materials).toHaveLength(1);

    const child = result.entities.find((e) => e.name === "Child")!;
    const meshComponent = child.getComponent<MeshComponent>("mesh");
    const materialComponent = child.getComponent<MaterialComponent>("material");

    expect(meshComponent).toBeDefined();
    expect(meshComponent!.mesh).not.toBeNull();
    expect(materialComponent).toBeDefined();
    expect(materialComponent!.material.name).toBe("Red");
  });

  it("preserves hierarchy and transform data", async () => {
    const json = {
      asset: { version: "2.0" },
      nodes: [
        { name: "Root", children: [1] },
        { name: "Child", translation: [5, 0, 0] },
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };
    const glb = buildGLB(json, new Uint8Array(0));
    const scene = new Scene();
    const { entities } = await importGLBIntoScene(glb, scene);

    const root = entities.find((e) => e.name === "Root")!;
    const child = entities.find((e) => e.name === "Child")!;
    const rootTransform = root.getComponent<TransformComponent>("transform")!;
    const childTransform = child.getComponent<TransformComponent>("transform")!;
    expect(rootTransform.getParentId()).toBeUndefined();
    expect(childTransform.getParentId()).toBe(root.id);
    expect(Array.from(childTransform.position)).toEqual([5, 0, 0]);
  });
});
