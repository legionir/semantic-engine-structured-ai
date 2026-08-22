import { AnimationClip } from "./AnimationClip.js";

// ---------------------------------------------------------------------------
// Bone
// ---------------------------------------------------------------------------

export interface Bone {
  name: string;
  parentIndex: number; // -1 for root bone
  localMatrix: Float32Array; // 4x4 matrix, 16 floats
  worldMatrix: Float32Array; // 4x4 matrix, 16 floats
  children: number[]; // indices of child bones
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export class Skeleton {
  readonly bones: Bone[];

  constructor(bones: Bone[]) {
    this.bones = bones;
    this.updateWorldMatrices();
  }

  /**
   * Create a skeleton from a bone hierarchy defined by parent indices.
   * @param names  Bone names.
   * @param parentIndices  Parent index for each bone (-1 for root).
   * @param localMatrices  Optional 4x4 local matrices (identity if not provided).
   */
  static fromHierarchy(
    names: string[],
    parentIndices: number[],
    localMatrices?: Float32Array[],
  ): Skeleton {
    const bones: Bone[] = [];
    for (let i = 0; i < names.length; i++) {
      const local = localMatrices?.[i] ?? new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
      bones.push({
        name: names[i],
        parentIndex: parentIndices[i],
        localMatrix: local,
        worldMatrix: new Float32Array(16),
        children: [],
      });
    }

    // Build child lists
    for (let i = 0; i < bones.length; i++) {
      const parent = bones[i].parentIndex;
      if (parent >= 0 && parent < bones.length) {
        bones[parent].children.push(i);
      }
    }

    return new Skeleton(bones);
  }

  /**
   * Update all world matrices by traversing the hierarchy.
   */
  updateWorldMatrices(): void {
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      if (bone.parentIndex < 0) {
        // Root: world = local
        bone.worldMatrix.set(bone.localMatrix);
      } else {
        // Child: world = parent.world * local
        const parentWorld = this.bones[bone.parentIndex].worldMatrix;
        multiplyMat4(bone.worldMatrix, parentWorld, bone.localMatrix);
      }
    }
  }

  /**
   * Find a bone by name.
   */
  getBoneIndex(name: string): number {
    return this.bones.findIndex((b) => b.name === name);
  }

  /**
   * Get a bone by name.
   */
  getBone(name: string): Bone | undefined {
    return this.bones.find((b) => b.name === name);
  }
}

// ---------------------------------------------------------------------------
// Skin
// ---------------------------------------------------------------------------

export class Skin {
  /**
   * @param joints  Bone indices that influence this skin.
   * @param inverseBindMatrices  Inverse bind matrices (one per joint).
   */
  constructor(
    readonly joints: number[],
    readonly inverseBindMatrices: Float32Array[],
  ) {}
}

// ---------------------------------------------------------------------------
// applySkeletalAnimation
// ---------------------------------------------------------------------------

/**
 * Apply an animation clip to a skeleton at the given time.
 * Modifies the local matrices of the skeleton's bones.
 */
export function applySkeletalAnimation(
  clip: AnimationClip,
  time: number,
  skeleton: Skeleton,
  loop = true,
): void {
  const result = clip.sample(time, loop);

  for (const [boneName, props] of result) {
    const boneIndex = skeleton.getBoneIndex(boneName);
    if (boneIndex < 0) continue;

    const bone = skeleton.bones[boneIndex];
    const translation = props.get("translation");
    const rotation = props.get("rotation");
    const scale = props.get("scale");

    // Build the local matrix from TRS components
    // We need to compose a matrix from translation, rotation (quat), and scale
    // If all three are present, compose them
    if (translation || rotation || scale) {
      composeTRSInto(bone.localMatrix, translation, rotation, scale);
    }
  }

  // Update world matrices after modifying bones
  skeleton.updateWorldMatrices();
}

// ---------------------------------------------------------------------------
// computeSkinningMatrices
// ---------------------------------------------------------------------------

/**
 * Compute the skinning matrices for GPU skinning.
 * Each matrix is: joint.worldMatrix * inverseBindMatrix
 */
export function computeSkinningMatrices(
  skeleton: Skeleton,
  skin: Skin,
): Float32Array[] {
  const result: Float32Array[] = [];

  for (let i = 0; i < skin.joints.length; i++) {
    const jointIndex = skin.joints[i];
    const bone = skeleton.bones[jointIndex];
    const ibm = skin.inverseBindMatrices[i];

    const skinMatrix = new Float32Array(16);
    multiplyMat4(skinMatrix, bone.worldMatrix, ibm);
    result.push(skinMatrix);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Math helpers (4x4 matrix multiplication)
// ---------------------------------------------------------------------------

function multiplyMat4(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i];
    const ai1 = a[i + 4];
    const ai2 = a[i + 8];
    const ai3 = a[i + 12];
    out[i]      = ai0 * b[0]  + ai1 * b[1]  + ai2 * b[2]  + ai3 * b[3];
    out[i + 4]  = ai0 * b[4]  + ai1 * b[5]  + ai2 * b[6]  + ai3 * b[7];
    out[i + 8]  = ai0 * b[8]  + ai1 * b[9]  + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
}

function composeTRSInto(
  out: Float32Array,
  translation: number[] | undefined,
  rotation: number[] | undefined,
  scale: number[] | undefined,
): void {
  // Start with identity
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;

  if (scale) {
    out[0]  *= scale[0];
    out[5]  *= scale[1];
    out[10] *= scale[2];
  }

  if (rotation && rotation.length >= 4) {
    // Convert quat to matrix and apply
    const qx = rotation[0], qy = rotation[1], qz = rotation[2], qw = rotation[3];
    const tx = scale?.[0] ?? 1, ty = scale?.[1] ?? 1, tz = scale?.[2] ?? 1;

    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;

    out[0] = (1 - (yy + zz)) * (tx);
    out[1] = (xy + wz) * (tx);
    out[2] = (xz - wy) * (tx);
    out[4] = (xy - wz) * (ty);
    out[5] = (1 - (xx + zz)) * (ty);
    out[6] = (yz + wx) * (ty);
    out[8] = (xz + wy) * (tz);
    out[9] = (yz - wx) * (tz);
    out[10] = (1 - (xx + yy)) * (tz);
  }

  if (translation) {
    out[12] = translation[0];
    out[13] = translation[1];
    out[14] = translation[2];
  }
}
