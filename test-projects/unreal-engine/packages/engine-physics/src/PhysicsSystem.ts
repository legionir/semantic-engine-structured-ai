import { Quat, Vec3, type TransformComponent, type World } from "@web-engine/engine-core";
import type { JointDesc, PhysicsWorld, TriggerEvent } from "./types.js";
import { ColliderComponent, ConstraintComponent, JointComponent, RigidBodyComponent, TriggerComponent } from "./components.js";

export class PhysicsSystem {
  readonly priority = 5;
  private readonly bodyByEntity = new Map<string, number>();
  private readonly entityByBody = new Map<number, string>();
  private readonly jointsByEntity = new Map<string, number[]>();
  private initialized = false;

  constructor(
    private readonly world: World,
    private readonly physics: PhysicsWorld,
  ) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.physics.init();
    this.initialized = true;
  }

  getBodyHandle(entityId: string): number | undefined {
    return this.bodyByEntity.get(entityId);
  }

  getEntityIdByBody(bodyHandle: number): string | undefined {
    return this.entityByBody.get(bodyHandle);
  }

  syncBodyFromTransform(entityId: string): void {
    const handle = this.bodyByEntity.get(entityId);
    if (handle === undefined) return;
    const transform = this.world.getEntity(entityId)?.getComponent<TransformComponent>("transform");
    if (!transform) return;
    const position = Vec3.create();
    transform.getWorldPosition(position);
    const rotation = Quat.create() as Quat;
    transform.getWorldQuaternion(rotation);
    this.physics.setBodyTransform(handle, {
      position: [position[0], position[1], position[2]],
      rotation: [rotation[0], rotation[1], rotation[2], rotation[3]],
    });
  }

  update(deltaTime: number): void {
    if (!this.initialized) return;

    // --- Create physics bodies for entities with rigidbody + collider ---
    this.world.queryAll("rigidbody").forEach((entity) => {
      const rigidBody = entity.getComponent<RigidBodyComponent>("rigidbody");
      const collider = entity.getComponent<ColliderComponent>("collider");
      const transform = entity.getComponent<TransformComponent>("transform");
      if (!rigidBody || !collider || !transform) return;

      if (this.bodyByEntity.has(entity.id)) return;

      const position = Vec3.create();
      transform.getWorldPosition(position);
      const rotation = Quat.create() as Quat;
      transform.getWorldQuaternion(rotation);

      const handle = this.physics.createBody({
        type: rigidBody.bodyType,
        position: [position[0], position[1], position[2]],
        rotation: [rotation[0], rotation[1], rotation[2], rotation[3]],
        gravityScale: rigidBody.gravityScale,
        colliders: [
          {
            shape: collider.shape,
            friction: collider.friction,
            restitution: collider.restitution,
            isSensor: collider.isSensor,
          },
        ],
      });
      this.bodyByEntity.set(entity.id, handle);
      this.entityByBody.set(handle, entity.id);
    });

    // --- Create joints for entities with JointComponent ---
    this.world.queryAll("joint").forEach((entity) => {
      const jointComp = entity.getComponent<JointComponent>("joint");
      if (!jointComp) return;

      const handleA = this.bodyByEntity.get(entity.id);
      const handleB = this.bodyByEntity.get(jointComp.targetEntity);
      if (handleA === undefined || handleB === undefined) return;

      // Check if we already created this joint
      const existing = this.jointsByEntity.get(entity.id);
      if (existing && existing.length > 0) return;

      const jointDesc: JointDesc = {
        jointType: jointComp.jointType,
        anchor1: jointComp.anchor1,
        anchor2: jointComp.anchor2,
        axis: jointComp.axis,
        stiffness: jointComp.stiffness,
        damping: jointComp.damping,
        restLength: jointComp.restLength,
      };

      const jointHandle = this.physics.createJoint(handleA, handleB, jointDesc);
      this.jointsByEntity.set(entity.id, [jointHandle]);
    });

    // --- Apply constraints for entities with ConstraintComponent ---
    this.world.queryAll("constraint").forEach((entity) => {
      const constraintComp = entity.getComponent<ConstraintComponent>("constraint");
      if (!constraintComp) return;

      const handle = this.bodyByEntity.get(entity.id);
      if (handle === undefined) return;

      this.physics.setBodyConstraints(handle, {
        lockTranslationX: constraintComp.lockTranslationX,
        lockTranslationY: constraintComp.lockTranslationY,
        lockTranslationZ: constraintComp.lockTranslationZ,
        lockRotationX: constraintComp.lockRotationX,
        lockRotationY: constraintComp.lockRotationY,
        lockRotationZ: constraintComp.lockRotationZ,
      });
    });

    // --- Step physics ---
    this.physics.step(deltaTime);

    // --- Update transforms from physics bodies ---
    this.bodyByEntity.forEach((handle, entityId) => {
      const entity = this.world.getEntity(entityId);
      if (!entity) return;
      const rigidBody = entity.getComponent<RigidBodyComponent>("rigidbody");
      const transform = entity.getComponent<TransformComponent>("transform");
      if (!rigidBody || !transform) return;

      const bodyTransform = this.physics.getBodyTransform(handle);
      if (!bodyTransform) return;

      if (rigidBody.bodyType === "dynamic") {
        transform.setPosition(bodyTransform.position[0], bodyTransform.position[1], bodyTransform.position[2]);
        transform.rotation = Quat.fromValues(bodyTransform.rotation[0], bodyTransform.rotation[1], bodyTransform.rotation[2], bodyTransform.rotation[3]);
        transform.updateLocalMatrix();
      }
    });

    // --- Handle trigger events ---
    const triggerEvents = this.physics.drainCollisionEvents();
    if (triggerEvents.length > 0) {
      this.handleTriggerEvents(triggerEvents);
    }
  }

  private handleTriggerEvents(events: TriggerEvent[]): void {
    for (const event of events) {
      const entityAId = this.entityByBody.get(Number(event.entityA));
      const entityBId = this.entityByBody.get(Number(event.entityB));
      if (!entityAId || !entityBId) continue;

      // Find which entity has a TriggerComponent
      const entityA = this.world.getEntity(entityAId);
      const entityB = this.world.getEntity(entityBId);

      if (entityA) {
        const triggerA = entityA.getComponent<TriggerComponent>("trigger");
        if (triggerA) {
          switch (event.type) {
            case "enter":
              triggerA.overlapping.add(entityBId);
              triggerA.onEnter?.(entityBId);
              break;
            case "exit":
              triggerA.overlapping.delete(entityBId);
              triggerA.onExit?.(entityBId);
              break;
            case "stay":
              triggerA.onStay?.(entityBId);
              break;
          }
        }
      }

      if (entityB) {
        const triggerB = entityB.getComponent<TriggerComponent>("trigger");
        if (triggerB) {
          switch (event.type) {
            case "enter":
              triggerB.overlapping.add(entityAId);
              triggerB.onEnter?.(entityAId);
              break;
            case "exit":
              triggerB.overlapping.delete(entityAId);
              triggerB.onExit?.(entityAId);
              break;
            case "stay":
              triggerB.onStay?.(entityAId);
              break;
          }
        }
      }
    }
  }

  dispose(): void {
    this.physics.clear();
    this.bodyByEntity.clear();
    this.entityByBody.clear();
    this.jointsByEntity.clear();
    this.initialized = false;
  }
}
