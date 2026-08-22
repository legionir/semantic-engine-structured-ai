import RAPIER from "@dimforge/rapier3d-compat";
import type {
  BodyTransform,
  ColliderDesc,
  ConstraintDesc,
  JointDesc,
  PhysicsWorld,
  RaycastHit,
  RigidBodyDesc,
  RigidBodyType,
  TriggerEvent,
} from "../types.js";

function createRigidBodyDesc(type: RigidBodyType): RAPIER.RigidBodyDesc {
  switch (type) {
    case "static":
      return RAPIER.RigidBodyDesc.fixed();
    case "kinematic":
      return RAPIER.RigidBodyDesc.kinematicPositionBased();
    default:
      return RAPIER.RigidBodyDesc.dynamic();
  }
}

interface ColliderRecord {
  collider: RAPIER.Collider;
  isSensor: boolean;
}

interface BodyRecord {
  body: RAPIER.RigidBody;
  colliders: ColliderRecord[];
}

export class RapierPhysicsWorld implements PhysicsWorld {
  private world: RAPIER.World | null = null;
  private readonly bodies: Array<BodyRecord | undefined> = [];
  private readonly freeIndices: number[] = [];
  private readonly bodyToIndex = new Map<RAPIER.RigidBody, number>();
  private readonly joints: Array<RAPIER.ImpulseJoint | undefined> = [];
  private readonly jointFreeIndices: number[] = [];
  private readonly colliderToBody = new Map<RAPIER.ColliderHandle, number>();
  private eventQueue: RAPIER.EventQueue | null = null;
  private pendingEvents: TriggerEvent[] = [];
  private initialized = false;

  constructor(private readonly gravity: [number, number, number] = [0, -9.81, 0]) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: this.gravity[0], y: this.gravity[1], z: this.gravity[2] });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.initialized = true;
  }

  step(delta: number): void {
    if (!this.world || !this.eventQueue) return;
    this.world.timestep = delta;
    this.world.step(this.eventQueue);

    // Drain collision events from the event queue
    this.pendingEvents = [];
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const body1 = this.colliderToBody.get(handle1);
      const body2 = this.colliderToBody.get(handle2);
      if (body1 === undefined || body2 === undefined) return;

      // Check if either collider is a sensor
      const record1 = this.bodies[body1];
      const record2 = this.bodies[body2];
      if (!record1 || !record2) return;

      const isSensor1 = record1.colliders.some((c) => c.collider.handle === handle1 && c.isSensor);
      const isSensor2 = record2.colliders.some((c) => c.collider.handle === handle2 && c.isSensor);

      if (!isSensor1 && !isSensor2) return;

      // Only emit events from the sensor side
      const sensorBody = isSensor1 ? body1 : body2;
      const otherBody = isSensor1 ? body2 : body1;

      this.pendingEvents.push({
        type: started ? "enter" : "exit",
        entityA: String(sensorBody),
        entityB: String(otherBody),
      });
    });

    // Also check sensor intersections (for sensors that are overlapping)
    for (let i = 0; i < this.bodies.length; i++) {
      const record = this.bodies[i];
      if (!record) continue;
      for (const cr of record.colliders) {
        if (!cr.isSensor) continue;
        this.world!.intersectionPairsWith(cr.collider, (otherCollider) => {
          const otherBodyIdx = this.colliderToBody.get(otherCollider.handle);
          if (otherBodyIdx === undefined || otherBodyIdx === i) return true;
          // Check if we already have a contact event for this pair
          const alreadyEmitted = this.pendingEvents.some(
            (e) => e.type === "enter" && e.entityA === String(i) && e.entityB === String(otherBodyIdx),
          );
          if (!alreadyEmitted) {
            this.pendingEvents.push({
              type: "stay",
              entityA: String(i),
              entityB: String(otherBodyIdx),
            });
          }
          return true;
        });
      }
    }
  }

  createBody(desc: RigidBodyDesc): number {
    if (!this.world) throw new Error("PhysicsWorld not initialized");
    const bodyDesc = createRigidBodyDesc(desc.type)
      .setTranslation(desc.position[0], desc.position[1], desc.position[2])
      .setRotation({ x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] });
    if (desc.gravityScale !== undefined) {
      bodyDesc.setGravityScale(desc.gravityScale);
    }

    const body = this.world.createRigidBody(bodyDesc);
    const colliders: ColliderRecord[] = [];

    desc.colliders.forEach((colliderDesc) => {
      const c = this.createCollider(colliderDesc, body);
      colliders.push({ collider: c, isSensor: colliderDesc.isSensor ?? false });
    });

    const handle = this.allocateHandle(body);
    this.bodies[handle] = { body, colliders };

    // Register collider -> body mapping
    for (const cr of colliders) {
      this.colliderToBody.set(cr.collider.handle, handle);
    }

    return handle;
  }

  removeBody(body: number): void {
    if (!this.world) return;
    const record = this.bodies[body];
    if (!record) return;

    // Remove collider mappings
    for (const cr of record.colliders) {
      this.colliderToBody.delete(cr.collider.handle);
    }

    this.world.removeRigidBody(record.body);
    this.bodyToIndex.delete(record.body);
    this.bodies[body] = undefined;
    this.freeIndices.push(body);
  }

  getBodyTransform(body: number): BodyTransform | null {
    const record = this.bodies[body];
    if (!record) return null;
    const position = record.body.translation();
    const rotation = record.body.rotation();
    return {
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    };
  }

  setBodyTransform(body: number, transform: BodyTransform): void {
    const record = this.bodies[body];
    if (!record) return;
    record.body.setTranslation({ x: transform.position[0], y: transform.position[1], z: transform.position[2] }, true);
    record.body.setRotation({ x: transform.rotation[0], y: transform.rotation[1], z: transform.rotation[2], w: transform.rotation[3] }, true);
  }

  setBodyEnabled(body: number, enabled: boolean): void {
    const record = this.bodies[body];
    if (!record) return;
    record.body.setEnabled(enabled);
  }

  setLinearVelocity(body: number, velocity: [number, number, number]): void {
    const record = this.bodies[body];
    if (!record) return;
    record.body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  }

  applyImpulse(body: number, impulse: [number, number, number]): void {
    const record = this.bodies[body];
    if (!record) return;
    record.body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
  }

  raycast(origin: [number, number, number], direction: [number, number, number], maxDistance: number): RaycastHit | null {
    if (!this.world) return null;
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: direction[0], y: direction[1], z: direction[2] },
    );
    const hit = this.world.castRay(ray, maxDistance, true);
    if (!hit) return null;
    const parent = hit.collider.parent();
    if (!parent) return null;
    const body = this.bodyToIndex.get(parent);
    if (body === undefined) return null;
    const distance = hit.timeOfImpact;
    return {
      body,
      distance,
      point: [
        origin[0] + direction[0] * distance,
        origin[1] + direction[1] * distance,
        origin[2] + direction[2] * distance,
      ],
    };
  }

  createJoint(bodyA: number, bodyB: number, desc: JointDesc): number {
    if (!this.world) throw new Error("PhysicsWorld not initialized");
    const recordA = this.bodies[bodyA];
    const recordB = this.bodies[bodyB];
    if (!recordA || !recordB) throw new Error("Body not found");

    const anchor1 = { x: desc.anchor1[0], y: desc.anchor1[1], z: desc.anchor1[2] };
    const anchor2 = { x: desc.anchor2[0], y: desc.anchor2[1], z: desc.anchor2[2] };
    const identity = { x: 0, y: 0, z: 0, w: 1 };

    let jointData: RAPIER.JointData;
    switch (desc.jointType) {
      case "fixed": {
        jointData = RAPIER.JointData.fixed(anchor1, identity, anchor2, identity);
        break;
      }
      case "hinge": {
        const axis = desc.axis ?? [0, 1, 0];
        const axisVec = { x: axis[0], y: axis[1], z: axis[2] };
        jointData = RAPIER.JointData.revolute(anchor1, anchor2, axisVec);
        break;
      }
      case "spring": {
        const stiffness = desc.stiffness ?? 100;
        const damping = desc.damping ?? 10;
        const restLength = desc.restLength ?? 1;
        jointData = RAPIER.JointData.spring(restLength, stiffness, damping, anchor1, anchor2);
        break;
      }
      case "ball": {
        jointData = RAPIER.JointData.spherical(anchor1, anchor2);
        break;
      }
    }

    const joint = this.world.createImpulseJoint(jointData, recordA.body, recordB.body, true);
    const handle = this.allocateJointHandle(joint);
    return handle;
  }

  removeJoint(joint: number): void {
    if (!this.world) return;
    const j = this.joints[joint];
    if (!j) return;
    this.world.removeImpulseJoint(j, true);
    this.joints[joint] = undefined;
    this.jointFreeIndices.push(joint);
  }

  setBodyConstraints(body: number, constraint: ConstraintDesc): void {
    const record = this.bodies[body];
    if (!record) return;
    record.body.setEnabledTranslations(
      !constraint.lockTranslationX,
      !constraint.lockTranslationY,
      !constraint.lockTranslationZ,
      true,
    );
    record.body.setEnabledRotations(
      !constraint.lockRotationX,
      !constraint.lockRotationY,
      !constraint.lockRotationZ,
      true,
    );
  }

  drainCollisionEvents(): TriggerEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  getColliderVertices(body: number): Float32Array | null {
    const record = this.bodies[body];
    if (!record || record.colliders.length === 0) return null;

    const cr = record.colliders[0];
    const shape = cr.collider.shape;
    const shapeType = shape.type;

    // For each shape type, generate wireframe vertices
    // Box: 8 corners -> 12 edges (24 vertices for lines)
    // Sphere: approximated as 3 rings
    // Capsule: 2 hemispheres + cylinder
    if (shapeType === RAPIER.ShapeType.Cuboid) {
      const halfExtents = cr.collider.halfExtents();
      const hx = halfExtents.x;
      const hy = halfExtents.y;
      const hz = halfExtents.z;

      // 8 corners of the box
      const corners = [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
        [-hx, -hy, hz],
        [-hx, hy, -hz],
        [hx, hy, -hz],
        [hx, hy, hz],
        [-hx, hy, hz],
      ];

      // 12 edges as line segments (start, end pairs)
      const edges = [
        0, 1, 1, 2, 2, 3, 3, 0, // bottom face
        4, 5, 5, 6, 6, 7, 7, 4, // top face
        0, 4, 1, 5, 2, 6, 3, 7, // vertical
      ];

      const result = new Float32Array(edges.length * 3);
      for (let i = 0; i < edges.length; i++) {
        const corner = corners[edges[i]];
        result[i * 3] = corner[0];
        result[i * 3 + 1] = corner[1];
        result[i * 3 + 2] = corner[2];
      }
      return result;
    }

    if (shapeType === RAPIER.ShapeType.Ball) {
      const radius = (shape as RAPIER.Ball).radius;
      const segments = 16;
      const result: number[] = [];

      // Three rings: XY, XZ, YZ
      for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < segments; i++) {
          const angle1 = (i / segments) * Math.PI * 2;
          const angle2 = ((i + 1) / segments) * Math.PI * 2;
          let x1: number, y1: number, z1: number;
          let x2: number, y2: number, z2: number;

          if (ring === 0) {
            // XY ring
            x1 = Math.cos(angle1) * radius;
            y1 = Math.sin(angle1) * radius;
            z1 = 0;
            x2 = Math.cos(angle2) * radius;
            y2 = Math.sin(angle2) * radius;
            z2 = 0;
          } else if (ring === 1) {
            // XZ ring
            x1 = Math.cos(angle1) * radius;
            y1 = 0;
            z1 = Math.sin(angle1) * radius;
            x2 = Math.cos(angle2) * radius;
            y2 = 0;
            z2 = Math.sin(angle2) * radius;
          } else {
            // YZ ring
            x1 = 0;
            y1 = Math.cos(angle1) * radius;
            z1 = Math.sin(angle1) * radius;
            x2 = 0;
            y2 = Math.cos(angle2) * radius;
            z2 = Math.sin(angle2) * radius;
          }

          result.push(x1, y1, z1, x2, y2, z2);
        }
      }

      return new Float32Array(result);
    }

    if (shapeType === RAPIER.ShapeType.Capsule) {
      const capsule = shape as RAPIER.Capsule;
      const halfHeight = capsule.halfHeight;
      const radius = capsule.radius;
      const segments = 12;
      const result: number[] = [];

      // Top hemisphere ring
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const nextAngle = ((i + 1) / segments) * Math.PI * 2;
        const x1 = Math.cos(angle) * radius;
        const z1 = Math.sin(angle) * radius;
        const x2 = Math.cos(nextAngle) * radius;
        const z2 = Math.sin(nextAngle) * radius;
        // Top ring
        result.push(x1, halfHeight, z1, x2, halfHeight, z2);
        // Bottom ring
        result.push(x1, -halfHeight, z1, x2, -halfHeight, z2);
      }

      // Vertical lines connecting top and bottom
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        result.push(x, halfHeight, z, x, -halfHeight, z);
      }

      return new Float32Array(result);
    }

    return null;
  }

  clear(): void {
    if (!this.world) return;
    this.bodies.forEach((record) => {
      if (record) this.world!.removeRigidBody(record.body);
    });
    this.bodies.length = 0;
    this.freeIndices.length = 0;
    this.bodyToIndex.clear();
    this.colliderToBody.clear();
    this.joints.length = 0;
    this.jointFreeIndices.length = 0;
    this.pendingEvents = [];
  }

  private createCollider(desc: ColliderDesc, body: RAPIER.RigidBody): RAPIER.Collider {
    if (!this.world) throw new Error("PhysicsWorld not initialized");
    let colliderDesc: RAPIER.ColliderDesc;
    switch (desc.shape.kind) {
      case "box":
        colliderDesc = RAPIER.ColliderDesc.cuboid(desc.shape.halfExtents[0], desc.shape.halfExtents[1], desc.shape.halfExtents[2]);
        break;
      case "sphere":
        colliderDesc = RAPIER.ColliderDesc.ball(desc.shape.radius);
        break;
      case "capsule":
        colliderDesc = RAPIER.ColliderDesc.capsule(desc.shape.halfHeight, desc.shape.radius);
        break;
    }
    if (desc.friction !== undefined) colliderDesc.setFriction(desc.friction);
    if (desc.restitution !== undefined) colliderDesc.setRestitution(desc.restitution);
    if (desc.isSensor) colliderDesc.setSensor(true);
    return this.world.createCollider(colliderDesc, body);
  }

  private allocateHandle(body: RAPIER.RigidBody): number {
    if (this.freeIndices.length > 0) {
      const index = this.freeIndices.pop()!;
      this.bodies[index] = undefined;
      this.bodyToIndex.set(body, index);
      return index;
    }
    this.bodies.push(undefined);
    const index = this.bodies.length - 1;
    this.bodyToIndex.set(body, index);
    return index;
  }

  private allocateJointHandle(joint: RAPIER.ImpulseJoint): number {
    if (this.jointFreeIndices.length > 0) {
      const index = this.jointFreeIndices.pop()!;
      this.joints[index] = joint;
      return index;
    }
    this.joints.push(joint);
    return this.joints.length - 1;
  }
}
