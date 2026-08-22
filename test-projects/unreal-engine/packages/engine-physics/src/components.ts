import { BaseComponent, type Entity } from "@web-engine/engine-core";
import type { ColliderShape, RigidBodyType, JointType, ConstraintDesc } from "./types.js";

export class RigidBodyComponent extends BaseComponent {
  override readonly type = "rigidbody";
  bodyType: RigidBodyType;
  gravityScale: number;

  constructor(entity: Entity, bodyType: RigidBodyType = "dynamic", gravityScale = 1) {
    super(entity);
    this.bodyType = bodyType;
    this.gravityScale = gravityScale;
  }
}

export class ColliderComponent extends BaseComponent {
  override readonly type = "collider";
  shape: ColliderShape;
  friction: number;
  restitution: number;
  isSensor: boolean;

  constructor(
    entity: Entity,
    shape: ColliderShape = { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
    options: { friction?: number; restitution?: number; isSensor?: boolean } = {},
  ) {
    super(entity);
    this.shape = shape;
    this.friction = options.friction ?? 0.5;
    this.restitution = options.restitution ?? 0;
    this.isSensor = options.isSensor ?? false;
  }
}

export class JointComponent extends BaseComponent {
  override readonly type = "joint";
  jointType: JointType;
  /** Target entity id to connect to */
  targetEntity: string;
  anchor1: [number, number, number];
  anchor2: [number, number, number];
  axis?: [number, number, number];
  stiffness?: number;
  damping?: number;
  restLength?: number;

  constructor(
    entity: Entity,
    jointType: JointType,
    targetEntity: string,
    options: {
      anchor1?: [number, number, number];
      anchor2?: [number, number, number];
      axis?: [number, number, number];
      stiffness?: number;
      damping?: number;
      restLength?: number;
    } = {},
  ) {
    super(entity);
    this.jointType = jointType;
    this.targetEntity = targetEntity;
    this.anchor1 = options.anchor1 ?? [0, 0, 0];
    this.anchor2 = options.anchor2 ?? [0, 0, 0];
    this.axis = options.axis;
    this.stiffness = options.stiffness;
    this.damping = options.damping;
    this.restLength = options.restLength;
  }
}

export class TriggerComponent extends BaseComponent {
  override readonly type = "trigger";
  /** Callbacks for trigger events */
  onEnter?: (otherEntity: string) => void;
  onExit?: (otherEntity: string) => void;
  onStay?: (otherEntity: string) => void;

  /** Currently overlapping entities tracked by the system */
  readonly overlapping = new Set<string>();

  constructor(entity: Entity, callbacks?: {
    onEnter?: (otherEntity: string) => void;
    onExit?: (otherEntity: string) => void;
    onStay?: (otherEntity: string) => void;
  }) {
    super(entity);
    this.onEnter = callbacks?.onEnter;
    this.onExit = callbacks?.onExit;
    this.onStay = callbacks?.onStay;
  }
}

export class ConstraintComponent extends BaseComponent {
  override readonly type = "constraint";
  lockTranslationX: boolean;
  lockTranslationY: boolean;
  lockTranslationZ: boolean;
  lockRotationX: boolean;
  lockRotationY: boolean;
  lockRotationZ: boolean;

  constructor(
    entity: Entity,
    constraint: Partial<ConstraintDesc> = {},
  ) {
    super(entity);
    this.lockTranslationX = constraint.lockTranslationX ?? false;
    this.lockTranslationY = constraint.lockTranslationY ?? false;
    this.lockTranslationZ = constraint.lockTranslationZ ?? false;
    this.lockRotationX = constraint.lockRotationX ?? false;
    this.lockRotationY = constraint.lockRotationY ?? false;
    this.lockRotationZ = constraint.lockRotationZ ?? false;
  }
}
