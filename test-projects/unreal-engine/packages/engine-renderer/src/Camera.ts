import { Mat4, Vec3, createMat4, createVec3 } from "@web-engine/engine-core";

export enum ProjectionType {
  Perspective = "perspective",
  Orthographic = "orthographic",
}

export class Camera {
  readonly id: string;
  name: string;
  projectionType: ProjectionType = ProjectionType.Perspective;
  fov = 60;
  near = 0.1;
  far = 1000;

  readonly viewMatrix: Mat4;
  readonly projectionMatrix: Mat4;
  readonly position: Vec3;
  readonly target: Vec3;

  constructor(id: string, name = "Camera") {
    this.id = id;
    this.name = name;
    this.viewMatrix = createMat4();
    this.projectionMatrix = createMat4();
    this.position = createVec3(0, 0, 5);
    this.target = createVec3(0, 0, 0);
    this.updateViewMatrix();
    this.updateProjectionMatrix(1);
  }

  setPerspective(fov: number, aspect: number, near = 0.1, far = 1000): void {
    this.projectionType = ProjectionType.Perspective;
    this.fov = fov;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix(aspect);
  }

  setOrthographic(left: number, right: number, bottom: number, top: number, near = 0.1, far = 1000): void {
    this.projectionType = ProjectionType.Orthographic;
    this.near = near;
    this.far = far;
    Mat4.ortho(this.projectionMatrix, left, right, bottom, top, near, far);
  }

  updateProjectionMatrix(aspect: number): void {
    if (this.projectionType === ProjectionType.Orthographic) {
      const halfH = Math.tan(((this.fov * Math.PI) / 180) / 2) * this.near * 4;
      const halfW = halfH * aspect;
      Mat4.ortho(this.projectionMatrix, -halfW, halfW, -halfH, halfH, this.near, this.far);
    } else {
      Mat4.perspective(this.projectionMatrix, (this.fov * Math.PI) / 180, aspect, this.near, this.far);
    }
  }

  lookAt(position: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): void {
    Vec3.copy(this.position, position);
    Vec3.copy(this.target, target);
    this.updateViewMatrix(up);
  }

  setViewMatrix(view: Mat4): void {
    Mat4.copy(this.viewMatrix, view);
    Mat4.getTranslation(this.position, view);
  }

  private updateViewMatrix(up: Vec3 = [0, 1, 0]): void {
    Mat4.lookAt(this.viewMatrix, this.position, this.target, up);
  }

  getViewMatrix(): Mat4 {
    return this.viewMatrix;
  }

  getProjectionMatrix(): Mat4 {
    return this.projectionMatrix;
  }

  getPosition(): Vec3 {
    return this.position;
  }
}
