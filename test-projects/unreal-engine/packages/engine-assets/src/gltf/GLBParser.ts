import type { GLTFDocument } from "./types.js";
import { GLTFComponentType } from "./types.js";

const GLB_HEADER_SIZE = 12;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

export class InvalidGLBError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGLBError";
  }
}

export interface ParsedGLB {
  json: GLTFDocument;
  binaryChunk: ArrayBuffer | null;
}

export function parseGLB(data: ArrayBuffer): ParsedGLB {
  const view = new DataView(data);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    throw new InvalidGLBError("Invalid GLB magic number. Expected 'glTF'.");
  }

  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new InvalidGLBError(`Unsupported GLB version: ${version}. Only version 2 is supported.`);
  }

  const totalLength = view.getUint32(8, true);
  if (data.byteLength < totalLength) {
    throw new InvalidGLBError("GLB file is truncated.");
  }

  let offset = GLB_HEADER_SIZE;
  let json: GLTFDocument | null = null;
  let binaryChunk: ArrayBuffer | null = null;

  while (offset < totalLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkLength;

    if (chunkDataEnd > totalLength) {
      throw new InvalidGLBError("Chunk extends beyond the declared GLB length.");
    }

    if (chunkType === JSON_CHUNK_TYPE) {
      const textDecoder = new TextDecoder("utf-8");
      const jsonString = textDecoder.decode(new Uint8Array(data, chunkDataStart, chunkLength));
      json = JSON.parse(jsonString) as GLTFDocument;
    } else if (chunkType === BIN_CHUNK_TYPE) {
      binaryChunk = data.slice(chunkDataStart, chunkDataEnd);
    }

    offset = chunkDataEnd;
  }

  if (!json) {
    throw new InvalidGLBError("GLB file does not contain a JSON chunk.");
  }

  return { json, binaryChunk };
}

export function getAccessorData(doc: GLTFDocument, accessorIndex: number, binaryChunk: ArrayBuffer | null): { data: ArrayBuffer; componentType: number; count: number; type: string } {
  const accessor = doc.accessors?.[accessorIndex];
  if (!accessor) {
    throw new InvalidGLBError(`Accessor ${accessorIndex} not found.`);
  }
  const bufferViewIndex = accessor.bufferView;
  const bufferView = bufferViewIndex === undefined ? undefined : doc.bufferViews?.[bufferViewIndex];
  if (!bufferView) {
    throw new InvalidGLBError(`Buffer view for accessor ${accessorIndex} not found.`);
  }
  const bufferIndex = bufferView.buffer;
  const buffer = doc.buffers?.[bufferIndex];
  if (!buffer || buffer.byteLength === 0) {
    if (!binaryChunk) {
      throw new InvalidGLBError("Referenced buffer is missing. GLB with external buffers is not supported.");
    }
    return getAccessorDataFromChunk(doc, accessorIndex, binaryChunk);
  }

  const componentByteSize = componentTypeSize(accessor.componentType);
  const componentCount = attributeComponentCount(accessor.type);
  const byteOffset = (accessor.byteOffset ?? 0) + (bufferView.byteOffset ?? 0);
  const byteLength = accessor.count * componentCount * componentByteSize;
  const src = new Uint8Array(binaryChunk ?? new ArrayBuffer(0));
  const copy = new ArrayBuffer(byteLength);
  new Uint8Array(copy).set(src.subarray(byteOffset, byteOffset + byteLength));
  return {
    data: copy,
    componentType: accessor.componentType,
    count: accessor.count,
    type: accessor.type,
  };
}

function getAccessorDataFromChunk(doc: GLTFDocument, accessorIndex: number, binaryChunk: ArrayBuffer): { data: ArrayBuffer; componentType: number; count: number; type: string } {
  const accessor = doc.accessors?.[accessorIndex];
  if (!accessor) throw new InvalidGLBError(`Accessor ${accessorIndex} not found.`);
  const bufferViewIndex = accessor.bufferView;
  const bufferView = bufferViewIndex === undefined ? undefined : doc.bufferViews?.[bufferViewIndex];
  if (!bufferView) throw new InvalidGLBError(`Buffer view for accessor ${accessorIndex} not found.`);

  const componentByteSize = componentTypeSize(accessor.componentType);
  const componentCount = attributeComponentCount(accessor.type);
  const byteOffset = (accessor.byteOffset ?? 0) + (bufferView.byteOffset ?? 0);
  const byteLength = accessor.count * componentCount * componentByteSize;
  const src = new Uint8Array(binaryChunk);
  const copy = new ArrayBuffer(byteLength);
  new Uint8Array(copy).set(src.subarray(byteOffset, byteOffset + byteLength));
  return {
    data: copy,
    componentType: accessor.componentType,
    count: accessor.count,
    type: accessor.type,
  };
}

function componentTypeSize(componentType: number): number {
  switch (componentType) {
    case GLTFComponentType.BYTE:
    case GLTFComponentType.UNSIGNED_BYTE:
      return 1;
    case GLTFComponentType.SHORT:
    case GLTFComponentType.UNSIGNED_SHORT:
      return 2;
    case GLTFComponentType.UNSIGNED_INT:
    case GLTFComponentType.FLOAT:
      return 4;
    default:
      throw new InvalidGLBError(`Unknown component type: ${componentType}`);
  }
}

function attributeComponentCount(type: string): number {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
      return 4;
    case "MAT4":
      return 16;
    default:
      throw new InvalidGLBError(`Unknown attribute type: ${type}`);
  }
}

export function decodeAccessor(raw: ArrayBuffer, componentType: number, type: string): Float32Array {
  const componentCount = attributeComponentCount(type);
  const count = raw.byteLength / componentTypeSize(componentType) / componentCount;
  const result = new Float32Array(count * componentCount);

  if (componentType === GLTFComponentType.FLOAT) {
    result.set(new Float32Array(raw));
    return result;
  }

  const convert = (value: number): number => {
    switch (componentType) {
      case GLTFComponentType.BYTE:
        return (new Int8Array([value])[0]) / 127;
      case GLTFComponentType.UNSIGNED_BYTE:
        return value / 255;
      case GLTFComponentType.SHORT:
        return (new Int16Array([value])[0]) / 32767;
      case GLTFComponentType.UNSIGNED_SHORT:
        return value / 65535;
      case GLTFComponentType.UNSIGNED_INT:
        return value;
      default:
        return value;
    }
  };

  const byteView = new Uint8Array(raw);
  const intView = new Int32Array(raw);
  const uintView = new Uint32Array(raw);
  const isSigned16 = componentType === GLTFComponentType.SHORT;
  const isSigned8 = componentType === GLTFComponentType.BYTE;

  for (let i = 0; i < count * componentCount; i++) {
    let value: number;
    if (componentType === GLTFComponentType.UNSIGNED_INT) {
      value = uintView[i];
    } else if (componentType === GLTFComponentType.UNSIGNED_SHORT || componentType === GLTFComponentType.UNSIGNED_BYTE) {
      value = byteView[i * (componentType === GLTFComponentType.UNSIGNED_SHORT ? 2 : 1)];
    } else {
      value = isSigned16 ? intView[i] & 0xffff : isSigned8 ? intView[i] & 0xff : intView[i];
    }
    result[i] = convert(value);
  }
  return result;
}

export function decodeIndices(raw: ArrayBuffer, componentType: number): Uint32Array | Uint16Array {
  if (componentType === GLTFComponentType.UNSIGNED_INT) {
    return new Uint32Array(raw);
  }
  return new Uint16Array(raw);
}
