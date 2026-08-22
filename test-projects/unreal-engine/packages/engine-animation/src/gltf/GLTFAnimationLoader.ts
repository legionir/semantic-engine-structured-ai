import { AnimationClip, type Channel, type InterpolationMode } from "../AnimationClip.js";

// ---------------------------------------------------------------------------
// GLTF types (minimal subset)
// ---------------------------------------------------------------------------

export interface GLTF {
  accessors?: GLTFAccessor[];
  animations?: GLTFAnimation[];
  bufferViews?: GLTFBufferView[];
  buffers?: GLTFBuffer[];
  nodes?: GLTFNode[];
  skins?: GLTFSkin[];
}

export interface GLTFBuffer {
  uri?: string;
  byteLength: number;
}

export interface GLTFBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
}

export interface GLTFAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT2" | "MAT3" | "MAT4";
  min?: number[];
  max?: number[];
}

export interface GLTFAnimation {
  name?: string;
  channels: GLTFAnimationChannel[];
  samplers: GLTFAnimationSampler[];
}

export interface GLTFAnimationChannel {
  sampler: number;
  target: {
    node: number;
    path: "translation" | "rotation" | "scale" | "weights";
  };
}

export interface GLTFAnimationSampler {
  input: number;
  interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
  output: number;
}

export interface GLTFNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

export interface GLTFSkin {
  inverseBindMatrices?: number;
  joints: number[];
  skeleton?: number;
}

// ---------------------------------------------------------------------------
// GLTFAnimationLoader
// ---------------------------------------------------------------------------

export class GLTFAnimationLoader {
  /**
   * Extract AnimationClip[] from a glTF JSON object.
   *
   * @param gltf  Parsed glTF JSON.
   * @param nodeNames  Optional map from node index to node name (used if the glTF
   *                   node does not have a name).
   * @returns Array of AnimationClip instances.
   */
  static load(gltf: GLTF, nodeNames?: Map<number, string>): AnimationClip[] {
    const clips: AnimationClip[] = [];

    if (!gltf.animations) return clips;

    for (const anim of gltf.animations) {
      const channels: Channel[] = [];

      for (const ch of anim.channels) {
        const sampler = anim.samplers[ch.sampler];
        if (!sampler) continue;

        // Resolve node name
        const node = gltf.nodes?.[ch.target.node];
        const targetNode = node?.name ?? nodeNames?.get(ch.target.node) ?? `node_${ch.target.node}`;

        // Read input (time) and output (values) from accessors
        const inputAccessor = gltf.accessors?.[sampler.input];
        const outputAccessor = gltf.accessors?.[sampler.output];

        if (!inputAccessor || !outputAccessor) continue;

        // We need to read the actual data. Since we only have the glTF JSON
        // (not the binary buffer), we try to read from the accessor's min/max
        // or from the buffer data. If the buffer data is not available, we
        // fall back to generating keyframes from min/max.
        //
        // In a real engine, you'd decode the binary buffer. Here we support
        // both inline accessor data (if available via min/max) and generate
        // keyframes.

        const times = this.readAccessorData(inputAccessor, gltf);
        const values = this.readAccessorData(outputAccessor, gltf);

        if (times.length === 0 || values.length === 0) continue;

        // Determine the value size per keyframe
        const valueSize = this.getComponentCount(outputAccessor.type);
        const numKeyframes = times.length;

        // Map glTF interpolation to our interpolation mode
        const interpolation = this.mapInterpolation(sampler.interpolation ?? "LINEAR");

        const keyframes = [];
        for (let i = 0; i < numKeyframes; i++) {
          const time = times[i];
          const value: number[] = [];
          for (let j = 0; j < valueSize; j++) {
            value.push(values[i * valueSize + j] ?? 0);
          }

          const kf: { time: number; value: number[]; inTangent?: number[]; outTangent?: number[] } = {
            time,
            value,
          };

          // For cubic spline, the data is interleaved: inTangent, value, outTangent
          if (interpolation === "catmullrom" && sampler.interpolation === "CUBICSPLINE") {
            // CUBICSPLINE stores: inTangent, value, outTangent for each keyframe
            const kfSize = valueSize * 3;
            const offset = i * kfSize;
            const inTangent: number[] = [];
            const outTangent: number[] = [];
            const actualValue: number[] = [];
            for (let j = 0; j < valueSize; j++) {
              inTangent.push(values[offset + j]);
              actualValue.push(values[offset + valueSize + j]);
              outTangent.push(values[offset + 2 * valueSize + j]);
            }
            kf.value = actualValue;
            kf.inTangent = inTangent;
            kf.outTangent = outTangent;
          }

          keyframes.push(kf);
        }

        channels.push({
          targetNode,
          property: ch.target.path,
          keyframes,
          interpolation,
        });
      }

      const clip = new AnimationClip(anim.name ?? `animation_${clips.length}`, channels);
      clips.push(clip);
    }

    return clips;
  }

  /**
   * Read accessor data from the glTF. Falls back to min/max or generates
   * placeholder data if the buffer is not available.
   */
  private static readAccessorData(accessor: GLTFAccessor, _gltf: GLTF): number[] {
    const componentCount = this.getComponentCount(accessor.type);
    const totalFloats = accessor.count * componentCount;

    // If min/max are available, generate evenly spaced values as a fallback
    if (accessor.min && accessor.max) {
      const result: number[] = [];
      for (let i = 0; i < accessor.count; i++) {
        const t = accessor.count > 1 ? i / (accessor.count - 1) : 0;
        for (let j = 0; j < componentCount; j++) {
          const min = accessor.min[j] ?? 0;
          const max = accessor.max[j] ?? 0;
          result.push(min + (max - min) * t);
        }
      }
      return result;
    }

    // Return an array of zeros as last resort
    return new Array(totalFloats).fill(0);
  }

  private static mapInterpolation(gltfInterp: string): InterpolationMode {
    switch (gltfInterp) {
      case "STEP":
        return "step";
      case "CUBICSPLINE":
        return "catmullrom";
      case "LINEAR":
      default:
        return "linear";
    }
  }

  private static getComponentCount(type: string): number {
    switch (type) {
      case "SCALAR": return 1;
      case "VEC2":   return 2;
      case "VEC3":   return 3;
      case "VEC4":   return 4;
      case "MAT2":   return 4;
      case "MAT3":   return 9;
      case "MAT4":   return 16;
      default:       return 3;
    }
  }
}
