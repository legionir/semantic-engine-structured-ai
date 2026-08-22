import { BaseComponent } from "../ecs/index.js";
import { Mat3, Mat4, Quat, Vec3, composeMat4, createMat4, createQuat, createVec3, decomposeMat4 } from "../math/math.js";
import type { Entity } from "../ecs/types.js";
import type { PropertyGroup } from "../properties/PropertyDescriptors.js";

export interface TransformSnapshot {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  parent?: string;
}

export class TransformComponent extends BaseComponent {
  override readonly type = "transform";

  readonly localPosition: Vec3;
  readonly localRotation: Quat;
  readonly localScale: Vec3;
  readonly localMatrix: Mat4;
  readonly worldMatrix: Mat4;

  private parentId: string | undefined;
  private readonly childIds = new Set<string>();

  constructor(entity: Entity, position: Vec3 = createVec3(), rotation: Quat = createQuat(), scale: Vec3 = createVec3(1, 1, 1)) {
    super(entity);
    this.localPosition = position;
    this.localRotation = rotation;
    this.localScale = scale;
    this.localMatrix = createMat4();
    this.worldMatrix = createMat4();
    this.updateLocalMatrix();
    this.updateWorldMatrix(undefined);
  }

  get position(): Vec3 {
    return this.localPosition;
  }

  set position(value: Vec3) {
    Vec3.copy(this.localPosition, value);
    this.refreshWorldTree();
  }

  get rotation(): Quat {
    return this.localRotation;
  }

  set rotation(value: Quat) {
    Quat.copy(this.localRotation, value);
    this.refreshWorldTree();
  }

  get scale(): Vec3 {
    return this.localScale;
  }

  set scale(value: Vec3) {
    Vec3.copy(this.localScale, value);
    this.refreshWorldTree();
  }

  setPosition(x: number, y: number, z: number): void {
    this.localPosition[0] = x;
    this.localPosition[1] = y;
    this.localPosition[2] = z;
    this.refreshWorldTree();
  }

  setRotation(x: number, y: number, z: number): void {
    Quat.fromEuler(this.localRotation, x, y, z);
    this.refreshWorldTree();
  }

  setScale(x: number, y: number, z: number): void {
    this.localScale[0] = x;
    this.localScale[1] = y;
    this.localScale[2] = z;
    this.refreshWorldTree();
  }

  setParent(parent: TransformComponent | null): void {
    this.parentId = parent ? parent.entity.id : undefined;
    this.updateWorldMatrix(parent ? parent.getWorldMatrix() : undefined);
    this.invalidateChildren();
  }

  getParent(): TransformComponent | undefined {
    if (!this.parentId) return undefined;
    const parentEntity = this.entity.world.getEntity(this.parentId);
    return parentEntity?.getComponent<TransformComponent>("transform");
  }

  getParentId(): string | undefined {
    return this.parentId;
  }

  addChild(child: TransformComponent): void {
    this.childIds.add(child.entity.id);
    child.setParent(this);
  }

  removeChild(child: TransformComponent): void {
    this.childIds.delete(child.entity.id);
    child.setParent(null);
  }

  getChildren(): TransformComponent[] {
    const result: TransformComponent[] = [];
    this.childIds.forEach((id) => {
      const childEntity = this.entity.world.getEntity(id);
      const childTransform = childEntity?.getComponent<TransformComponent>("transform");
      if (childTransform) result.push(childTransform);
    });
    return result;
  }

  getChildIds(): ReadonlySet<string> {
    return this.childIds;
  }

  markDirty(): void {
    this.refreshWorldTree();
  }

  updateLocalMatrix(): void {
    composeMat4(this.localMatrix, this.localPosition, this.localRotation, this.localScale);
  }

  updateWorldMatrix(parentWorldMatrix: Mat4 | undefined): void {
    if (parentWorldMatrix) {
      Mat4.multiply(this.worldMatrix, parentWorldMatrix, this.localMatrix);
    } else {
      Mat4.copy(this.worldMatrix, this.localMatrix);
    }
  }

  private refreshWorldTree(): void {
    this.updateLocalMatrix();
    this.updateWorldMatrix(this.getParent()?.getWorldMatrix());
    this.getChildren().forEach((child) => child.updateWorldMatrix(this.worldMatrix));
  }

  private invalidateChildren(): void {
    this.getChildren().forEach((child) => child.updateWorldMatrix(this.worldMatrix));
  }

  getWorldPosition(out: Vec3): Vec3 {
    return Mat4.getTranslation(out, this.worldMatrix);
  }

  getWorldQuaternion(out: Quat): Quat {
    const rot3 = Mat3.create() as Mat3;
    Mat3.fromMat4(rot3, this.worldMatrix);
    return Quat.fromMat3(out, rot3);
  }

  getWorldScale(out: Vec3): Vec3 {
    decomposeMat4(this.worldMatrix, createVec3(), createQuat(), out);
    return out;
  }

  getWorldMatrix(): Mat4 {
    return this.worldMatrix;
  }

  override toJSON(): TransformSnapshot {
    return {
      position: [this.localPosition[0], this.localPosition[1], this.localPosition[2]],
      rotation: [this.localRotation[0], this.localRotation[1], this.localRotation[2], this.localRotation[3]],
      scale: [this.localScale[0], this.localScale[1], this.localScale[2]],
      parent: this.parentId,
    };
  }

  getProperties(): PropertyGroup[] {
    return [
      {
        label: "Transform",
        properties: [
          {
            key: "position",
            label: "Position",
            type: "vector3",
            get: () => [...this.localPosition],
            set: (value) => {
              const v = value as Vec3;
              this.setPosition(v[0], v[1], v[2]);
            },
            step: 0.01,
          },
          {
            key: "rotation",
            label: "Rotation (deg)",
            type: "vector3",
            get: () => quatToEulerDeg(this.localRotation),
            set: (value) => {
              const v = value as Vec3;
              this.setRotation(v[0], v[1], v[2]);
            },
            step: 0.1,
          },
          {
            key: "scale",
            label: "Scale",
            type: "vector3",
            get: () => [...this.localScale],
            set: (value) => {
              const v = value as Vec3;
              this.setScale(v[0], v[1], v[2]);
            },
            step: 0.01,
          },
        ],
      },
    ];
  }
}

function quatToEulerDeg(q: Quat): [number, number, number] {
  const toDeg = 180 / Math.PI;
  const sinr = 2 * (q[3] * q[0] + q[1] * q[2]);
  const cosr = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
  const rx = Math.atan2(sinr, cosr) * toDeg;
  const sinp = 2 * (q[3] * q[1] - q[2] * q[0]);
  const ry = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 * toDeg : Math.asin(sinp) * toDeg;
  const siny = 2 * (q[3] * q[2] + q[0] * q[1]);
  const cosy = 1 - 2 * (q[1] * q[1] + q[2] * q[2]);
  const rz = Math.atan2(siny, cosy) * toDeg;
  return [rx, ry, rz];
}
