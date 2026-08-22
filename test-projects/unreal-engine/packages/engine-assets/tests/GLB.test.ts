import { describe, expect, it } from "vitest";
import { parseGLB, InvalidGLBError, decodeAccessor, decodeIndices } from "../src/gltf/GLBParser.js";
import { GLTFComponentType } from "../src/gltf/types.js";
import { loadGLB, loadGLBIntoScene } from "../src/gltf/GLTFLoader.js";
import { Scene, TransformComponent } from "@web-engine/engine-core";

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

describe("GLBParser", () => {
  it("parses a minimal GLB container", () => {
    const json = { asset: { version: "2.0" }, scenes: [{ nodes: [0] }], nodes: [{ name: "Cube" }] };
    const buffer = buildGLB(json, new Uint8Array(0));
    const parsed = parseGLB(buffer);
    expect(parsed.json.asset.version).toBe("2.0");
    expect(parsed.json.nodes?.[0].name).toBe("Cube");
  });

  it("rejects invalid magic numbers", () => {
    const buffer = new ArrayBuffer(12);
    new DataView(buffer).setUint32(0, 0xdeadbeef, true);
    expect(() => parseGLB(buffer)).toThrow(InvalidGLBError);
  });

  it("decodes accessor data", () => {
    const floatData = new Float32Array([1, 2, 3, 4, 5, 6]);
    const decoded = decodeAccessor(floatData.buffer, GLTFComponentType.FLOAT, "VEC3");
    expect(decoded).toEqual(new Float32Array([1, 2, 3, 4, 5, 6]));
  });

  it("decodes uint16 indices", () => {
    const indices = new Uint16Array([0, 1, 2, 2, 1, 3]);
    const decoded = decodeIndices(indices.buffer, GLTFComponentType.UNSIGNED_SHORT);
    expect(decoded).toBeInstanceOf(Uint16Array);
    expect([...decoded]).toEqual([0, 1, 2, 2, 1, 3]);
  });
});

describe("GLTFLoader", () => {
  it("loads meshes, materials, and node hierarchy from a GLB", async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);

    const json = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 72 }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      ],
      meshes: [
        {
          name: "Triangle",
          primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: undefined }],
        },
      ],
      nodes: [
        { name: "Root", children: [1] },
        { name: "Child", mesh: 0, translation: [5, 0, 0] },
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };

    const binary = new Uint8Array(72);
    binary.set(new Uint8Array(positions.buffer), 0);
    binary.set(new Uint8Array(normals.buffer), 36);

    const glb = buildGLB(json, binary);
    const result = await loadGLB(glb);

    expect(result.meshes).toHaveLength(1);
    expect(result.meshes[0].name).toBe("Triangle");
    expect(result.meshes[0].primitives[0].positions).toHaveLength(9);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].children).toEqual([1]);
    expect(result.nodes[1].parent).toBe(0);
    expect(result.nodes[1].translation).toEqual([5, 0, 0]);
  });

  it("imports a GLB into a scene with hierarchy and transforms", async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const json = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      meshes: [
        {
          name: "Triangle",
          primitives: [{ attributes: { POSITION: 0 }, indices: undefined }],
        },
      ],
      nodes: [
        { name: "Root", children: [1] },
        { name: "Child", mesh: 0, translation: [5, 0, 0], scale: [2, 2, 2] },
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };

    const glb = buildGLB(json, new Uint8Array(36));
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPaddedLen = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
    new Uint8Array(glb).set(new Uint8Array(positions.buffer), 28 + jsonPaddedLen);
    const scene = new Scene({ name: "Imported" });
    const { entities } = await loadGLBIntoScene(glb, scene);

    expect(entities).toHaveLength(2);
    const root = entities.find((e) => e.name === "Root")!;
    const child = entities.find((e) => e.name === "Child")!;
    const rootTransform = root.getComponent<TransformComponent>("transform")!;
    const childTransform = child.getComponent<TransformComponent>("transform")!;
    expect(rootTransform.getParentId()).toBeUndefined();
    expect(childTransform.getParentId()).toBe(root.id);
    expect(Array.from(childTransform.scale)).toEqual([2, 2, 2]);
    expect(Array.from(childTransform.position)).toEqual([5, 0, 0]);
  });
});
