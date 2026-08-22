import * as glMatrix from "gl-matrix";

export { glMatrix };

export type Vec3 = glMatrix.vec3;
export type Vec4 = glMatrix.vec4;
export type Quat = glMatrix.quat;
export type Mat3 = glMatrix.mat3;
export type Mat4 = glMatrix.mat4;

export const Vec3 = glMatrix.vec3;
export const Vec4 = glMatrix.vec4;
export const Quat = glMatrix.quat;
export const Mat3 = glMatrix.mat3;
export const Mat4 = glMatrix.mat4;

export function createVec3(x = 0, y = 0, z = 0): Vec3 {
  return Vec3.fromValues(x, y, z);
}

export function createQuat(x = 0, y = 0, z = 0, w = 1): Quat {
  return Quat.fromValues(x, y, z, w);
}

export function createMat4(): Mat4 {
  return Mat4.create() as Mat4;
}

export function quatFromEulerXYZ(out: Quat, x: number, y: number, z: number): Quat {
  return Quat.fromEuler(out, x, y, z);
}

export function decomposeMat4(m: Mat4, position: Vec3, quaternion: Quat, scale: Vec3): void {
  Mat4.getTranslation(position, m);

  const sx = Vec3.length(Vec3.fromValues(m[0], m[1], m[2]));
  const sy = Vec3.length(Vec3.fromValues(m[4], m[5], m[6]));
  const sz = Vec3.length(Vec3.fromValues(m[8], m[9], m[10]));
  scale[0] = sx;
  scale[1] = sy;
  scale[2] = sz;

  if (sx === 0 || sy === 0 || sz === 0) {
    Quat.identity(quaternion);
    return;
  }

  const rot3 = Mat3.create() as glMatrix.mat3;
  const m4 = Mat4.clone(m);
  m4[0] /= sx;
  m4[1] /= sx;
  m4[2] /= sx;
  m4[4] /= sy;
  m4[5] /= sy;
  m4[6] /= sy;
  m4[8] /= sz;
  m4[9] /= sz;
  m4[10] /= sz;
  Mat3.fromMat4(rot3, m4);
  Quat.fromMat3(quaternion, rot3);
}

export function composeMat4(out: Mat4, position: Vec3, quaternion: Quat, scale: Vec3): Mat4 {
  return Mat4.fromRotationTranslationScale(out, quaternion, position, scale);
}
