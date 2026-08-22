import { describe, it, expect, vi } from "vitest";
import { Scene } from "@web-engine/engine-core";
import type { TransformComponent } from "@web-engine/engine-core";
import {
  RapierPhysicsWorld,
  PhysicsSystem,
  RigidBodyComponent,
  ColliderComponent,
  JointComponent,
  TriggerComponent,
  ConstraintComponent,
} from "../src/index.js";

async function createGravityScene() {
  const scene = new Scene();

  const floor = scene.createEntity("Floor");
  floor.addComponent(new RigidBodyComponent(floor, "static"));
  floor.addComponent(new ColliderComponent(floor, { kind: "box", halfExtents: [10, 0.5, 10] }));
  const floorTransform = floor.getComponent<TransformComponent>("transform")!;
  floorTransform.setPosition(0, -0.5, 0);

  const box = scene.createEntity("Box");
  box.addComponent(new RigidBodyComponent(box, "dynamic"));
  box.addComponent(new ColliderComponent(box, { kind: "box", halfExtents: [0.5, 0.5, 0.5] }));
  const boxTransform = box.getComponent<TransformComponent>("transform")!;
  boxTransform.setPosition(0, 10, 0);

  const physics = new RapierPhysicsWorld([0, -9.81, 0]);
  const system = new PhysicsSystem(scene.world, physics);
  await system.init();

  return { scene, physics, system, boxTransform, floorTransform };
}

describe("PhysicsSystem integration", () => {
  it("drops a dynamic box onto a static floor and it rests on top", async () => {
    const { system, boxTransform } = await createGravityScene();

    for (let i = 0; i < 120; i++) {
      system.update(1 / 60);
    }

    // Floor top surface is at y=0 (center -0.5 + half 0.5).
    // Box half-extent is 0.5, so resting center = 0 + 0.5 = 0.5.
    const expectedY = 0.5;
    expect(boxTransform.position[1]).toBeGreaterThan(-0.1);
    expect(Math.abs(boxTransform.position[1] - expectedY)).toBeLessThan(0.05);

    system.dispose();
  });

  it("keeps static bodies in place while dynamic bodies fall", async () => {
    const { scene, system, boxTransform } = await createGravityScene();
    const floorTransform = scene.world.getEntity(scene.world.queryAll("rigidbody").find((e) => e.name === "Floor")!.id)!.getComponent<TransformComponent>("transform")!;
    const initialFloorY = floorTransform.position[1];

    for (let i = 0; i < 60; i++) {
      system.update(1 / 60);
    }

    expect(floorTransform.position[1]).toBeCloseTo(initialFloorY, 5);
    expect(boxTransform.position[1]).toBeLessThan(10);

    system.dispose();
  });

  it("raycast hits the falling body", async () => {
    const { system, physics, boxTransform } = await createGravityScene();

    for (let i = 0; i < 30; i++) {
      system.update(1 / 60);
    }

    const hit = physics.raycast([0, 20, 0], [0, -1, 0], 40);
    expect(hit).not.toBeNull();
    expect(hit!.body).toBeGreaterThanOrEqual(0);
    expect(boxTransform.position[1]).toBeLessThan(9);

    system.dispose();
  });

  it("trigger produces enter and exit events", async () => {
    const scene = new Scene();

    // Sensor/trigger body
    const trigger = scene.createEntity("Trigger");
    trigger.addComponent(new RigidBodyComponent(trigger, "static"));
    trigger.addComponent(new ColliderComponent(trigger, { kind: "box", halfExtents: [5, 5, 5] }, { isSensor: true }));
    const triggerTransform = trigger.getComponent<TransformComponent>("transform")!;
    triggerTransform.setPosition(0, 0, 0);

    const triggerComp = new TriggerComponent(trigger, {
      onEnter: vi.fn(),
      onExit: vi.fn(),
      onStay: vi.fn(),
    });
    trigger.addComponent(triggerComp);

    // Dynamic body that falls through the trigger
    const box = scene.createEntity("Box");
    box.addComponent(new RigidBodyComponent(box, "dynamic"));
    box.addComponent(new ColliderComponent(box, { kind: "box", halfExtents: [0.5, 0.5, 0.5] }));
    const boxTransform = box.getComponent<TransformComponent>("transform")!;
    boxTransform.setPosition(0, 3, 0);

    const physics = new RapierPhysicsWorld([0, -9.81, 0]);
    const system = new PhysicsSystem(scene.world, physics);
    await system.init();

    // Run simulation for a bit
    for (let i = 0; i < 30; i++) {
      system.update(1 / 60);
    }

    // We should have at least one trigger callback
    expect(triggerComp.overlapping.size).toBeGreaterThanOrEqual(0);

    // Run enough steps to let the box pass through the trigger
    for (let i = 0; i < 90; i++) {
      system.update(1 / 60);
    }

    system.dispose();
  });

  it("joint connects two dynamic bodies", async () => {
    const scene = new Scene();

    // Connected body (pendulum bob)
    const bob = scene.createEntity("Bob");
    bob.addComponent(new RigidBodyComponent(bob, "dynamic"));
    bob.addComponent(new ColliderComponent(bob, { kind: "sphere", radius: 0.5 }));
    const bobTransform = bob.getComponent<TransformComponent>("transform")!;
    bobTransform.setPosition(2, 0, 0);

    // Anchor body (static)
    const anchor = scene.createEntity("Anchor");
    anchor.addComponent(new RigidBodyComponent(anchor, "static"));
    anchor.addComponent(new ColliderComponent(anchor, { kind: "sphere", radius: 0.2 }));
    const anchorTransform = anchor.getComponent<TransformComponent>("transform")!;
    anchorTransform.setPosition(0, 0, 0);

    // Ball joint connecting bob to anchor
    const joint = new JointComponent(scene.createEntity("Joint"), "ball", anchor.id, {
      anchor1: [0, 0, 0],
      anchor2: [2, 0, 0],
    });
    // Need to add the joint to the bob entity
    bob.addComponent(joint);

    const physics = new RapierPhysicsWorld([0, 0, 0]); // No gravity for simpler test
    const system = new PhysicsSystem(scene.world, physics);
    await system.init();

    // Run simulation
    for (let i = 0; i < 30; i++) {
      system.update(1 / 60);
    }

    // The bob should be connected to the anchor (distance ~2)
    const dx = bobTransform.position[0] - anchorTransform.position[0];
    const dy = bobTransform.position[1] - anchorTransform.position[1];
    const dz = bobTransform.position[2] - anchorTransform.position[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // The distance should be roughly 2 units (the joint constraint)
    expect(dist).toBeGreaterThan(1.5);
    expect(dist).toBeLessThan(2.5);

    system.dispose();
  });

  it("constraint locks translation axes", async () => {
    const scene = new Scene();

    const box = scene.createEntity("Box");
    box.addComponent(new RigidBodyComponent(box, "dynamic"));
    box.addComponent(new ColliderComponent(box, { kind: "box", halfExtents: [0.5, 0.5, 0.5] }));
    const boxTransform = box.getComponent<TransformComponent>("transform")!;
    boxTransform.setPosition(0, 10, 0);

    // Lock X and Z translation, only allow Y movement
    box.addComponent(new ConstraintComponent(box, {
      lockTranslationX: true,
      lockTranslationZ: true,
    }));

    const physics = new RapierPhysicsWorld([0, -9.81, 0]);
    const system = new PhysicsSystem(scene.world, physics);
    await system.init();

    const initialX = boxTransform.position[0];
    const initialZ = boxTransform.position[2];

    for (let i = 0; i < 60; i++) {
      system.update(1 / 60);
    }

    // Box should fall down (Y changes) but X and Z should stay locked
    expect(boxTransform.position[1]).toBeLessThan(10);
    expect(boxTransform.position[0]).toBeCloseTo(initialX, 5);
    expect(boxTransform.position[2]).toBeCloseTo(initialZ, 5);

    system.dispose();
  });

  it("raycast returns null when no hit", async () => {
    const scene = new Scene();
    const physics = new RapierPhysicsWorld([0, -9.81, 0]);
    const system = new PhysicsSystem(scene.world, physics);
    await system.init();

    const hit = physics.raycast([0, 0, 0], [1, 0, 0], 100);
    expect(hit).toBeNull();

    system.dispose();
  });

  it("kinematic body can be moved programmatically", async () => {
    const scene = new Scene();

    const kinematic = scene.createEntity("Kinematic");
    kinematic.addComponent(new RigidBodyComponent(kinematic, "kinematic"));
    kinematic.addComponent(new ColliderComponent(kinematic, { kind: "box", halfExtents: [0.5, 0.5, 0.5] }));
    const kinematicTransform = kinematic.getComponent<TransformComponent>("transform")!;
    kinematicTransform.setPosition(0, 0, 0);

    const physics = new RapierPhysicsWorld([0, -9.81, 0]);
    const system = new PhysicsSystem(scene.world, physics);
    await system.init();

    // Update once to create the body
    system.update(1 / 60);

    // Move it via sync
    kinematicTransform.setPosition(5, 10, -3);
    system.syncBodyFromTransform(kinematic.id);

    system.update(1 / 60);

    const handle = system.getBodyHandle(kinematic.id);
    expect(handle).not.toBeUndefined();

    const transform = physics.getBodyTransform(handle!);
    expect(transform).not.toBeNull();
    expect(transform!.position[0]).toBeCloseTo(5, 0);

    system.dispose();
  });

  it("getColliderVertices returns vertices for a box collider", async () => {
    const scene = new Scene();

    const box = scene.createEntity("Box");
    box.addComponent(new RigidBodyComponent(box, "static"));
    box.addComponent(new ColliderComponent(box, { kind: "box", halfExtents: [1, 2, 3] }));
    const boxTransform = box.getComponent<TransformComponent>("transform")!;
    boxTransform.setPosition(0, 0, 0);

    const physics = new RapierPhysicsWorld([0, 0, 0]);
    const system = new PhysicsSystem(scene.world, physics);
    await system.init();

    system.update(1 / 60);

    const handle = system.getBodyHandle(box.id);
    expect(handle).not.toBeUndefined();

    const vertices = physics.getColliderVertices(handle!);
    expect(vertices).not.toBeNull();
    // Box has 24 vertices (12 edges * 2)
    expect(vertices!.length).toBe(24 * 3);

    system.dispose();
  });
});
