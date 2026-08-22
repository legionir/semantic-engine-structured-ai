export type RigidBodyType = "static" | "dynamic" | "kinematic";

export type ColliderShape =
  | { kind: "box"; halfExtents: [number, number, number] }
  | { kind: "sphere"; radius: number }
  | { kind: "capsule"; halfHeight: number; radius: number };

export interface ColliderDesc {
  shape: ColliderShape;
  friction?: number;
  restitution?: number;
  isSensor?: boolean;
}

export interface RigidBodyDesc {
  type: RigidBodyType;
  position: [number, number, number];
  rotation: [number, number, number, number];
  colliders: ColliderDesc[];
  gravityScale?: number;
}

export interface BodyTransform {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface RaycastHit {
  body: number;
  distance: number;
  point: [number, number, number];
  normal?: [number, number, number];
}

export type JointType = "fixed" | "hinge" | "spring" | "ball";

export interface JointDesc {
  jointType: JointType;
  /** Anchor on first body, in local space */
  anchor1: [number, number, number];
  /** Anchor on second body, in local space */
  anchor2: [number, number, number];
  /** Axis for hinge joints */
  axis?: [number, number, number];
  /** Spring properties */
  stiffness?: number;
  damping?: number;
  restLength?: number;
}

export interface ConstraintDesc {
  /** Lock translation on specific axes */
  lockTranslationX?: boolean;
  lockTranslationY?: boolean;
  lockTranslationZ?: boolean;
  /** Lock rotation on specific axes */
  lockRotationX?: boolean;
  lockRotationY?: boolean;
  lockRotationZ?: boolean;
}

export interface TriggerEvent {
  type: "enter" | "exit" | "stay";
  entityA: string;
  entityB: string;
}

export interface PhysicsWorld {
  init(): Promise<void>;
  step(delta: number): void;
  createBody(desc: RigidBodyDesc): number;
  removeBody(body: number): void;
  getBodyTransform(body: number): BodyTransform | null;
  setBodyTransform(body: number, transform: BodyTransform): void;
  setBodyEnabled(body: number, enabled: boolean): void;
  setLinearVelocity(body: number, velocity: [number, number, number]): void;
  applyImpulse(body: number, impulse: [number, number, number]): void;
  raycast(origin: [number, number, number], direction: [number, number, number], maxDistance: number): RaycastHit | null;

  /** Joint API */
  createJoint(bodyA: number, bodyB: number, desc: JointDesc): number;
  removeJoint(joint: number): void;

  /** Constraint API */
  setBodyConstraints(body: number, constraint: ConstraintDesc): void;

  /** Trigger / collision events */
  drainCollisionEvents(): TriggerEvent[];

  /** Collider debug vertices */
  getColliderVertices(body: number): Float32Array | null;

  clear(): void;
}
