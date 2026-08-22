import { describe, it, expect, beforeEach } from "vitest";

import { AnimationClip, type Channel, type Keyframe } from "../src/AnimationClip.js";
import { AnimationController } from "../src/AnimationController.js";
import { StateMachine } from "../src/StateMachine.js";
import { BlendTree1D, BlendTree2D } from "../src/BlendTree.js";
import { AnimationComponent } from "../src/AnimationComponent.js";
import { AnimationSystem } from "../src/AnimationSystem.js";
import { Skeleton, Skin, applySkeletalAnimation, computeSkinningMatrices } from "../src/SkeletalAnimation.js";
import { GLTFAnimationLoader } from "../src/gltf/GLTFAnimationLoader.js";
import type { Entity, World, Component } from "@web-engine/engine-core";
import { TransformComponent } from "@web-engine/engine-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannel(
  targetNode: string,
  property: "translation" | "rotation" | "scale" | "weights",
  keyframes: Keyframe[],
  interpolation: "step" | "linear" | "catmullrom" = "linear",
): Channel {
  return { targetNode, property, keyframes, interpolation };
}

function makeKeyframe(time: number, value: number[]): Keyframe {
  return { time, value };
}

// ---------------------------------------------------------------------------
// Test: AnimationClip
// ---------------------------------------------------------------------------

describe("AnimationClip", () => {
  it("should create a clip with computed duration", () => {
    const channel = makeChannel("bone1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [1, 1, 1]),
    ]);
    const clip = new AnimationClip("walk", [channel]);
    expect(clip.name).toBe("walk");
    expect(clip.duration).toBe(1);
    expect(clip.channels).toHaveLength(1);
  });

  it("should use explicit duration when provided", () => {
    const clip = new AnimationClip("test", [], 5);
    expect(clip.duration).toBe(5);
  });

  it("should sample at time 0 and return first keyframe", () => {
    const channel = makeChannel("node1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [10, 20, 30]),
    ]);
    const clip = new AnimationClip("test", [channel]);
    const result = clip.sample(0);
    expect(result.size).toBe(1);
    const nodeMap = result.get("node1")!;
    expect(nodeMap.get("translation")).toEqual([0, 0, 0]);
  });

  it("should linearly interpolate between keyframes", () => {
    const channel = makeChannel("node1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [10, 20, 30]),
    ]);
    const clip = new AnimationClip("test", [channel]);
    const result = clip.sample(0.5);
    const values = result.get("node1")!.get("translation")!;
    expect(values[0]).toBeCloseTo(5);
    expect(values[1]).toBeCloseTo(10);
    expect(values[2]).toBeCloseTo(15);
  });

  it("should use step interpolation", () => {
    const channel = makeChannel("node1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [10, 20, 30]),
    ], "step");
    const clip = new AnimationClip("test", [channel]);
    // At t=0.5, step returns the first value
    const result = clip.sample(0.5);
    const values = result.get("node1")!.get("translation")!;
    expect(values).toEqual([0, 0, 0]);
  });

  it("should use catmull-rom interpolation", () => {
    const channel = makeChannel("node1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [10, 10, 10]),
      makeKeyframe(2, [20, 20, 20]),
    ], "catmullrom");
    const clip = new AnimationClip("test", [channel]);
    const result = clip.sample(1);
    const values = result.get("node1")!.get("translation")!;
    // Catmull-Rom passes through the keyframe at t=1
    expect(values[0]).toBeCloseTo(10);
    expect(values[1]).toBeCloseTo(10);
    expect(values[2]).toBeCloseTo(10);
  });

  it("should loop when time exceeds duration", () => {
    const channel = makeChannel("node1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [10, 10, 10]),
    ]);
    const clip = new AnimationClip("test", [channel]);
    // time=1.5 should wrap to 0.5
    const result = clip.sample(1.5, true);
    const values = result.get("node1")!.get("translation")!;
    expect(values[0]).toBeCloseTo(5);
  });

  it("should not loop when loop=false", () => {
    const channel = makeChannel("node1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [10, 10, 10]),
    ]);
    const clip = new AnimationClip("test", [channel]);
    const result = clip.sample(5, false);
    const values = result.get("node1")!.get("translation")!;
    expect(values).toEqual([10, 10, 10]);
  });

  it("should sample rotation (quaternion) channels", () => {
    const channel = makeChannel("node1", "rotation", [
      makeKeyframe(0, [0, 0, 0, 1]),
      makeKeyframe(1, [0, 0, 1, 0]),
    ]);
    const clip = new AnimationClip("test", [channel]);
    const result = clip.sample(0.5);
    const values = result.get("node1")!.get("rotation")!;
    expect(values).toHaveLength(4);
  });

  it("should handle empty channels gracefully", () => {
    const clip = new AnimationClip("empty", []);
    const result = clip.sample(0);
    expect(result.size).toBe(0);
  });

  it("should handle single keyframe", () => {
    const channel = makeChannel("node1", "translation", [
      makeKeyframe(0, [42, 42, 42]),
    ]);
    const clip = new AnimationClip("test", [channel]);
    const result = clip.sample(100);
    const values = result.get("node1")!.get("translation")!;
    expect(values).toEqual([42, 42, 42]);
  });
});

// ---------------------------------------------------------------------------
// Test: AnimationController
// ---------------------------------------------------------------------------

describe("AnimationController", () => {
  let controller: AnimationController;
  let clip: AnimationClip;

  beforeEach(() => {
    controller = new AnimationController();
    const channel = makeChannel("bone1", "translation", [
      makeKeyframe(0, [0, 0, 0]),
      makeKeyframe(1, [10, 20, 30]),
    ]);
    clip = new AnimationClip("walk", [channel], 1);
  });

  it("should add and retrieve a clip", () => {
    controller.addClip("walk", clip);
    expect(controller.hasClip("walk")).toBe(true);
    const state = controller.getClip("walk");
    expect(state).toBeDefined();
    expect(state!.clip).toBe(clip);
  });

  it("should not have a clip that was not added", () => {
    expect(controller.hasClip("nonexistent")).toBe(false);
  });

  it("should return clip ids", () => {
    controller.addClip("walk", clip);
    controller.addClip("run", clip);
    const ids = controller.getClipIds();
    expect(ids).toContain("walk");
    expect(ids).toContain("run");
  });

  it("should play a clip and return sampled data on update", () => {
    controller.addClip("walk", clip);
    controller.play("walk");
    const result = controller.update(0);
    expect(result).not.toBeNull();
    expect(result!.get("bone1")!.get("translation")).toEqual([0, 0, 0]);
  });

  it("should return null if no clip is playing", () => {
    const result = controller.update(0.1);
    expect(result).toBeNull();
  });

  it("should advance time when updating", () => {
    controller.addClip("walk", clip);
    controller.play("walk");
    controller.update(0.5);
    const result = controller.update(0);
    const values = result!.get("bone1")!.get("translation")!;
    expect(values[0]).toBeCloseTo(5);
  });

  it("should stop a playing clip", () => {
    controller.addClip("walk", clip);
    controller.play("walk");
    controller.stop("walk");
    const result = controller.update(0.1);
    expect(result).toBeNull();
  });

  it("should stop all clips", () => {
    controller.addClip("walk", clip);
    controller.play("walk");
    controller.stop();
    expect(controller.activeClipId).toBeNull();
  });

  it("should crossfade between clips", () => {
    const clip2 = new AnimationClip("run", [
      makeChannel("bone1", "translation", [
        makeKeyframe(0, [100, 100, 100]),
        makeKeyframe(1, [200, 200, 200]),
      ]),
    ], 1);

    controller.addClip("walk", clip);
    controller.addClip("run", clip2);
    controller.play("walk");
    controller.update(0);

    // Start crossfade to run over 0.5 seconds
    controller.play("run", { duration: 0.5 });

    // At t=0.25 of crossfade, blend factor should be 0.5
    const result = controller.update(0.25);
    expect(result).not.toBeNull();
    const values = result!.get("bone1")!.get("translation")!;
    // Should be blended: walk(0,0,0) * 0.5 + run(100,100,100) * 0.5 = (50,50,50)
    expect(values[0]).toBeCloseTo(50);
  });

  it("should throw when playing a non-existent clip", () => {
    expect(() => controller.play("nonexistent")).toThrow();
  });

  it("should remove a clip", () => {
    controller.addClip("walk", clip);
    controller.removeClip("walk");
    expect(controller.hasClip("walk")).toBe(false);
  });

  it("should respect global speed multiplier", () => {
    controller.addClip("walk", clip);
    controller.play("walk");
    controller.globalSpeed = 2;
    controller.update(0.5);
    const result = controller.update(0);
    const values = result!.get("bone1")!.get("translation")!;
    // After 0.5s * 2x speed = 1s -> should be at keyframe 1
    expect(values[0]).toBeCloseTo(10);
  });

  it("should return active clip id", () => {
    controller.addClip("walk", clip);
    expect(controller.activeClipId).toBeNull();
    controller.play("walk");
    expect(controller.activeClipId).toBe("walk");
  });

  it("should return active state", () => {
    controller.addClip("walk", clip);
    controller.play("walk");
    const state = controller.activeState;
    expect(state).not.toBeNull();
    expect(state!.clip).toBe(clip);
    expect(state!.playing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: StateMachine
// ---------------------------------------------------------------------------

describe("StateMachine", () => {
  let clipWalk: AnimationClip;
  let clipRun: AnimationClip;
  let clipIdle: AnimationClip;
  const clipMap = new Map<string, AnimationClip>();

  function getClip(id: string): AnimationClip | undefined {
    return clipMap.get(id);
  }

  beforeEach(() => {
    clipMap.clear();

    clipIdle = new AnimationClip("idle", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [0, 0, 0])]),
    ]);
    clipWalk = new AnimationClip("walk", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [1, 0, 0]), makeKeyframe(1, [2, 0, 0])]),
    ]);
    clipRun = new AnimationClip("run", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [3, 0, 0]), makeKeyframe(1, [6, 0, 0])]),
    ]);

    clipMap.set("idle", clipIdle);
    clipMap.set("walk", clipWalk);
    clipMap.set("run", clipRun);
  });

  it("should create a state machine with initial state", () => {
    const sm = new StateMachine(getClip, [
      { name: "idle", clipId: "idle" },
      { name: "walk", clipId: "walk" },
    ], "idle");
    expect(sm.currentState).toBe("idle");
    expect(sm.currentClipId).toBe("idle");
  });

  it("should default to first state when no initial state given", () => {
    const sm = new StateMachine(getClip, [
      { name: "idle", clipId: "idle" },
    ]);
    expect(sm.currentState).toBe("idle");
  });

  it("should add and remove states", () => {
    const sm = new StateMachine(getClip);
    sm.addState({ name: "idle", clipId: "idle" });
    expect(sm.getState("idle")).toBeDefined();
    sm.removeState("idle");
    expect(sm.getState("idle")).toBeUndefined();
  });

  it("should set and get parameters", () => {
    const sm = new StateMachine(getClip);
    sm.setParameter("speed", 0.5);
    expect(sm.getParameter("speed")).toBe(0.5);
    sm.setParameter("jump", true);
    expect(sm.getParameter("jump")).toBe(true);
  });

  it("should transition based on conditions", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "idle",
        clipId: "idle",
        transitions: [
          { to: "walk", conditions: [{ parameter: "speed", type: "greater", value: 0 }], immediate: true, crossfadeDuration: 0 },
        ],
      },
      { name: "walk", clipId: "walk" },
    ], "idle");

    sm.setParameter("speed", 0);
    let result = sm.update(0);
    expect(result).toBeNull();
    expect(sm.currentState).toBe("idle");

    sm.setParameter("speed", 1);
    result = sm.update(0);
    expect(result).toBe("walk");
    expect(sm.currentState).toBe("walk");
  });

  it("should evaluate 'less' condition", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "run",
        clipId: "run",
        transitions: [
          { to: "walk", conditions: [{ parameter: "speed", type: "less", value: 3 }], immediate: true, crossfadeDuration: 0 },
        ],
      },
      { name: "walk", clipId: "walk" },
    ], "run");

    sm.setParameter("speed", 2);
    const result = sm.update(0);
    expect(result).toBe("walk");
  });

  it("should evaluate 'equal' condition", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "idle",
        clipId: "idle",
        transitions: [
          { to: "walk", conditions: [{ parameter: "state", type: "equal", value: 1 }], immediate: true, crossfadeDuration: 0 },
        ],
      },
      { name: "walk", clipId: "walk" },
    ], "idle");

    sm.setParameter("state", 1);
    const result = sm.update(0);
    expect(result).toBe("walk");
  });

  it("should evaluate 'not_equal' condition", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "idle",
        clipId: "idle",
        transitions: [
          { to: "walk", conditions: [{ parameter: "state", type: "not_equal", value: 0 }], immediate: true, crossfadeDuration: 0 },
        ],
      },
      { name: "walk", clipId: "walk" },
    ], "idle");

    sm.setParameter("state", 1);
    const result = sm.update(0);
    expect(result).toBe("walk");
  });

  it("should evaluate boolean 'true' condition", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "idle",
        clipId: "idle",
        transitions: [
          { to: "walk", conditions: [{ parameter: "isMoving", type: "true" }], immediate: true, crossfadeDuration: 0 },
        ],
      },
      { name: "walk", clipId: "walk" },
    ], "idle");

    sm.setParameter("isMoving", true);
    const result = sm.update(0);
    expect(result).toBe("walk");
  });

  it("should evaluate boolean 'false' condition", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "walk",
        clipId: "walk",
        transitions: [
          { to: "idle", conditions: [{ parameter: "isMoving", type: "false" }], immediate: true, crossfadeDuration: 0 },
        ],
      },
      { name: "idle", clipId: "idle" },
    ], "walk");

    sm.setParameter("isMoving", false);
    const result = sm.update(0);
    expect(result).toBe("idle");
  });

  it("should force transition to a state", () => {
    const sm = new StateMachine(getClip, [
      { name: "idle", clipId: "idle" },
      { name: "walk", clipId: "walk" },
    ], "idle");

    const success = sm.forceTransition("walk");
    expect(success).toBe(true);
    expect(sm.currentState).toBe("walk");
  });

  it("should return false for force transition to non-existent state", () => {
    const sm = new StateMachine(getClip, [
      { name: "idle", clipId: "idle" },
    ], "idle");
    expect(sm.forceTransition("nonexistent")).toBe(false);
  });

  it("should return crossfade duration for a transition", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "idle",
        clipId: "idle",
        transitions: [
          { to: "walk", conditions: [{ parameter: "speed", type: "greater", value: 0 }], immediate: true, crossfadeDuration: 0.3 },
        ],
      },
      { name: "walk", clipId: "walk" },
    ], "idle");

    const duration = sm.getTransitionCrossfadeDuration("idle", "walk");
    expect(duration).toBe(0.3);
  });

  it("should return previous state after transition", () => {
    const sm = new StateMachine(getClip, [
      {
        name: "idle",
        clipId: "idle",
        transitions: [
          { to: "walk", conditions: [{ parameter: "speed", type: "greater", value: 0 }], immediate: true, crossfadeDuration: 0 },
        ],
      },
      { name: "walk", clipId: "walk" },
    ], "idle");

    expect(sm.previousState).toBeNull();
    sm.setParameter("speed", 1);
    sm.update(0);
    expect(sm.previousState).toBe("idle");
  });

  it("should return all states", () => {
    const sm = new StateMachine(getClip, [
      { name: "idle", clipId: "idle" },
      { name: "walk", clipId: "walk" },
    ]);
    const states = sm.getStates();
    expect(states).toHaveLength(2);
  });

  it("should return current clip", () => {
    const sm = new StateMachine(getClip, [
      { name: "idle", clipId: "idle" },
    ], "idle");
    expect(sm.currentClip).toBe(clipIdle);
  });

  it("should return null for currentState and currentClipId when no state", () => {
    const sm = new StateMachine(getClip);
    expect(sm.currentState).toBeNull();
    expect(sm.currentClipId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: BlendTree1D
// ---------------------------------------------------------------------------

describe("BlendTree1D", () => {
  let clipSlow: AnimationClip;
  let clipFast: AnimationClip;

  beforeEach(() => {
    clipSlow = new AnimationClip("slow", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [0, 0, 0]), makeKeyframe(1, [1, 1, 1])]),
    ], 1);
    clipFast = new AnimationClip("fast", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [10, 10, 10]), makeKeyframe(1, [20, 20, 20])]),
    ], 1);
  });

  it("should throw when no children", () => {
    expect(() => new BlendTree1D("speed", [])).toThrow();
  });

  it("should return child clip when parameter equals threshold", () => {
    const tree = new BlendTree1D("speed", [
      { clip: clipSlow, threshold: 0 },
      { clip: clipFast, threshold: 1 },
    ]);
    const result = tree.sample(0, 0);
    const values = result.get("bone1")!.get("translation")!;
    expect(values[0]).toBe(0);
  });

  it("should blend between two children at intermediate parameter", () => {
    const tree = new BlendTree1D("speed", [
      { clip: clipSlow, threshold: 0 },
      { clip: clipFast, threshold: 1 },
    ]);
    const result = tree.sample(0.5, 0);
    const values = result.get("bone1")!.get("translation")!;
    // 0 * 0.5 + 10 * 0.5 = 5
    expect(values[0]).toBeCloseTo(5);
  });

  it("should clamp to first child when below min threshold", () => {
    const tree = new BlendTree1D("speed", [
      { clip: clipSlow, threshold: 0 },
      { clip: clipFast, threshold: 1 },
    ]);
    const result = tree.sample(-1, 0);
    const values = result.get("bone1")!.get("translation")!;
    expect(values[0]).toBe(0);
  });

  it("should clamp to last child when above max threshold", () => {
    const tree = new BlendTree1D("speed", [
      { clip: clipSlow, threshold: 0 },
      { clip: clipFast, threshold: 1 },
    ]);
    const result = tree.sample(5, 0);
    const values = result.get("bone1")!.get("translation")!;
    expect(values[0]).toBe(10);
  });

  it("should sort children by threshold", () => {
    const tree = new BlendTree1D("speed", [
      { clip: clipFast, threshold: 1 },
      { clip: clipSlow, threshold: 0 },
    ]);
    expect(tree.children[0].threshold).toBe(0);
    expect(tree.children[1].threshold).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test: BlendTree2D
// ---------------------------------------------------------------------------

describe("BlendTree2D", () => {
  let clipNW: AnimationClip;
  let clipNE: AnimationClip;
  let clipSW: AnimationClip;

  beforeEach(() => {
    clipNW = new AnimationClip("nw", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [0, 0, 0])]),
    ]);
    clipNE = new AnimationClip("ne", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [10, 0, 0])]),
    ]);
    clipSW = new AnimationClip("sw", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [0, 10, 0])]),
    ]);
  });

  it("should throw when no children", () => {
    expect(() => new BlendTree2D("x", "y", [])).toThrow();
  });

  it("should return single child clip when only one child", () => {
    const tree = new BlendTree2D("x", "y", [
      { clip: clipNW, x: 0, y: 0 },
    ]);
    const result = tree.sample(5, 5, 0);
    const values = result.get("bone1")!.get("translation")!;
    expect(values[0]).toBe(0);
  });

  it("should return nearest child when exactly at its position", () => {
    const tree = new BlendTree2D("x", "y", [
      { clip: clipNW, x: 0, y: 0 },
      { clip: clipNE, x: 10, y: 0 },
      { clip: clipSW, x: 0, y: 10 },
    ]);
    const result = tree.sample(0, 0, 0);
    const values = result.get("bone1")!.get("translation")!;
    expect(values[0]).toBe(0);
  });

  it("should blend between three closest points", () => {
    const tree = new BlendTree2D("x", "y", [
      { clip: clipNW, x: 0, y: 0 },
      { clip: clipNE, x: 10, y: 0 },
      { clip: clipSW, x: 0, y: 10 },
    ]);
    // Point (3, 3) is inside the triangle
    const result = tree.sample(3, 3, 0);
    const values = result.get("bone1")!.get("translation")!;
    // Should be a blend of all three
    expect(values[0]).toBeGreaterThan(0);
    expect(values[1]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test: AnimationComponent
// ---------------------------------------------------------------------------

describe("AnimationComponent", () => {
  it("should create with correct type", () => {
    const entity = createMockEntity();
    const comp = new AnimationComponent(entity);
    expect(comp.type).toBe("animation");
  });

  it("should hold a reference to the entity", () => {
    const entity = createMockEntity();
    const comp = new AnimationComponent(entity);
    expect(comp.entity).toBe(entity);
  });

  it("should create with a controller", () => {
    const entity = createMockEntity();
    const controller = new AnimationController();
    const comp = new AnimationComponent(entity, controller);
    expect(comp.controller).toBe(controller);
  });

  it("should create a default controller when none provided", () => {
    const entity = createMockEntity();
    const comp = new AnimationComponent(entity);
    expect(comp.controller).toBeInstanceOf(AnimationController);
  });

  it("should have default property values", () => {
    const entity = createMockEntity();
    const comp = new AnimationComponent(entity);
    expect(comp.speed).toBe(1);
    expect(comp.loop).toBe(true);
    expect(comp.autoPlay).toBe(false);
    expect(comp.currentClipId).toBeNull();
  });

  it("should stop controller on destroy", () => {
    const entity = createMockEntity();
    const comp = new AnimationComponent(entity);
    const clip = new AnimationClip("test", [
      makeChannel("bone1", "translation", [makeKeyframe(0, [0, 0, 0])]),
    ]);
    comp.controller.addClip("test", clip);
    comp.controller.play("test");
    expect(comp.controller.activeClipId).toBe("test");
    comp.onDestroy();
    expect(comp.controller.activeClipId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: AnimationSystem
// ---------------------------------------------------------------------------

describe("AnimationSystem", () => {
  it("should have priority 10", () => {
    const system = new AnimationSystem();
    expect(system.priority).toBe(10);
  });

  it("should update controller and apply transforms to entities", () => {
    const entity = createMockEntity();
    const animComp = new AnimationComponent(entity);
    const transformComp = new TransformComponent(entity);

    // Add a clip that animates translation
    const clip = new AnimationClip("test", [
      makeChannel(entity.id, "translation", [
        makeKeyframe(0, [0, 0, 0]),
        makeKeyframe(1, [10, 20, 30]),
      ]),
    ], 1);

    animComp.controller.addClip("test", clip);
    animComp.controller.play("test");

    // Add components to entity
    entity.components.set("animation", animComp);
    entity.components.set("transform", transformComp);

    const system = new AnimationSystem();
    system.setEntities([entity]);

    // Update with 0.5s delta
    system.update(0.5, 0);

    expect(transformComp.localPosition[0]).toBeCloseTo(5);
    expect(transformComp.localPosition[1]).toBeCloseTo(10);
    expect(transformComp.localPosition[2]).toBeCloseTo(15);
  });

  it("should apply rotation animation", () => {
    const entity = createMockEntity();
    const animComp = new AnimationComponent(entity);
    const transformComp = new TransformComponent(entity);

    const clip = new AnimationClip("test", [
      makeChannel(entity.id, "rotation", [
        makeKeyframe(0, [0, 0, 0, 1]),
        makeKeyframe(1, [0, 0, 1, 0]),
      ]),
    ], 1);

    animComp.controller.addClip("test", clip);
    animComp.controller.play("test");

    entity.components.set("animation", animComp);
    entity.components.set("transform", transformComp);

    const system = new AnimationSystem();
    system.setEntities([entity]);
    system.update(0.5, 0);

    // Halfway between identity and full rotation around Z
    expect(transformComp.localRotation[2]).not.toBe(0);
  });

  it("should continue if entity has no animation component", () => {
    const entity = createMockEntity();
    const transformComp = new TransformComponent(entity);
    entity.components.set("transform", transformComp);

    const system = new AnimationSystem();
    system.setEntities([entity]);
    // Should not throw
    expect(() => system.update(0.1, 0)).not.toThrow();
  });

  it("should continue if entity has no transform component", () => {
    const entity = createMockEntity();
    const animComp = new AnimationComponent(entity);
    entity.components.set("animation", animComp);

    const system = new AnimationSystem();
    system.setEntities([entity]);
    expect(() => system.update(0.1, 0)).not.toThrow();
  });

  it("should handle empty entity list", () => {
    const system = new AnimationSystem();
    expect(() => system.update(0.1, 0)).not.toThrow();
  });

  it("should respect entity speed multiplier", () => {
    const entity = createMockEntity();
    const animComp = new AnimationComponent(entity);
    animComp.speed = 2;
    const transformComp = new TransformComponent(entity);

    const clip = new AnimationClip("test", [
      makeChannel(entity.id, "translation", [
        makeKeyframe(0, [0, 0, 0]),
        makeKeyframe(1, [10, 10, 10]),
      ]),
    ], 1);

    animComp.controller.addClip("test", clip);
    animComp.controller.play("test");

    entity.components.set("animation", animComp);
    entity.components.set("transform", transformComp);

    const system = new AnimationSystem();
    system.setEntities([entity]);
    system.update(0.5, 0);
    system.update(0, 0);

    // 2x speed so 0.5s = 1s of animation time -> should be at keyframe 1
    expect(transformComp.localPosition[0]).toBeCloseTo(10);
  });
});

// ---------------------------------------------------------------------------
// Test: SkeletalAnimation
// ---------------------------------------------------------------------------

describe("Skeleton", () => {
  it("should create a skeleton from hierarchy", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root", "hip", "thigh"],
      [-1, 0, 1],
    );
    expect(skeleton.bones).toHaveLength(3);
    expect(skeleton.bones[0].name).toBe("root");
    expect(skeleton.bones[0].parentIndex).toBe(-1);
    expect(skeleton.bones[1].parentIndex).toBe(0);
    expect(skeleton.bones[2].parentIndex).toBe(1);
  });

  it("should build child lists", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root", "child1", "child2"],
      [-1, 0, 0],
    );
    expect(skeleton.bones[0].children).toContain(1);
    expect(skeleton.bones[0].children).toContain(2);
  });

  it("should compute world matrices for a hierarchy", () => {
    const rootLocal = new Float32Array(16);
    rootLocal[0] = 1; rootLocal[5] = 1; rootLocal[10] = 1; rootLocal[15] = 1;
    rootLocal[12] = 1; // tx = 1

    const childLocal = new Float32Array(16);
    childLocal[0] = 1; childLocal[5] = 1; childLocal[10] = 1; childLocal[15] = 1;
    childLocal[13] = 1; // ty = 1

    const skeleton = Skeleton.fromHierarchy(
      ["root", "child"],
      [-1, 0],
      [rootLocal, childLocal],
    );

    // Child world = parent.world * child.local
    // Root world = root.local = translation(1,0,0)
    // Child local = translation(0,1,0)
    // Child world = translation(1,1,0)
    expect(skeleton.bones[0].worldMatrix[12]).toBe(1);
    expect(skeleton.bones[0].worldMatrix[13]).toBe(0);
    expect(skeleton.bones[1].worldMatrix[12]).toBe(1);
    expect(skeleton.bones[1].worldMatrix[13]).toBe(1);
  });

  it("should find bone by name", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root", "hip", "knee"],
      [-1, 0, 1],
    );
    expect(skeleton.getBoneIndex("knee")).toBe(2);
    expect(skeleton.getBoneIndex("nonexistent")).toBe(-1);
    const bone = skeleton.getBone("hip");
    expect(bone).toBeDefined();
    expect(bone!.name).toBe("hip");
  });

  it("should return undefined for non-existent bone", () => {
    const skeleton = Skeleton.fromHierarchy(["root"], [-1]);
    expect(skeleton.getBone("nonexistent")).toBeUndefined();
  });
});

describe("Skin", () => {
  it("should create a skin with joints and inverse bind matrices", () => {
    const ibm = new Float32Array(16);
    const skin = new Skin([0, 1], [ibm]);
    expect(skin.joints).toEqual([0, 1]);
    expect(skin.inverseBindMatrices).toHaveLength(1);
  });
});

describe("applySkeletalAnimation", () => {
  it("should apply clip to skeleton bones", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root", "bone1"],
      [-1, 0],
    );

    const clip = new AnimationClip("test", [
      makeChannel("bone1", "translation", [
        makeKeyframe(0, [5, 10, 15]),
      ]),
    ]);

    applySkeletalAnimation(clip, 0, skeleton);

    // bone1's local matrix should now have translation (5, 10, 15)
    expect(skeleton.bones[1].localMatrix[12]).toBe(5);
    expect(skeleton.bones[1].localMatrix[13]).toBe(10);
    expect(skeleton.bones[1].localMatrix[14]).toBe(15);
  });

  it("should update world matrices after applying animation", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root", "bone1"],
      [-1, 0],
    );

    const clip = new AnimationClip("test", [
      makeChannel("bone1", "translation", [
        makeKeyframe(0, [0, 5, 0]),
      ]),
    ]);

    applySkeletalAnimation(clip, 0, skeleton);

    // child world should include root's translation plus child's
    expect(skeleton.bones[1].worldMatrix[13]).toBe(5);
  });

  it("should skip bones not in the clip", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root", "bone1", "bone2"],
      [-1, 0, 1],
    );

    const clip = new AnimationClip("test", [
      makeChannel("bone2", "translation", [
        makeKeyframe(0, [1, 2, 3]),
      ]),
    ]);

    expect(() => applySkeletalAnimation(clip, 0, skeleton)).not.toThrow();
    // bone1 should remain unchanged
    expect(skeleton.bones[1].localMatrix[12]).toBe(0);
    // bone2 should be updated
    expect(skeleton.bones[2].localMatrix[12]).toBe(1);
  });
});

describe("computeSkinningMatrices", () => {
  it("should compute skinning matrices for each joint", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root", "joint1"],
      [-1, 0],
    );

    const ibm = new Float32Array(16);
    ibm[0] = 1; ibm[5] = 1; ibm[10] = 1; ibm[15] = 1;

    const skin = new Skin([0, 1], [ibm, ibm]);

    const matrices = computeSkinningMatrices(skeleton, skin);
    expect(matrices).toHaveLength(2);
    expect(matrices[0]).toBeInstanceOf(Float32Array);
    expect(matrices[0].length).toBe(16);
  });

  it("should return identity-like matrices for identity inverse bind", () => {
    const skeleton = Skeleton.fromHierarchy(
      ["root"],
      [-1],
    );

    const ibm = new Float32Array(16);
    ibm[0] = 1; ibm[5] = 1; ibm[10] = 1; ibm[15] = 1;

    const skin = new Skin([0], [ibm]);

    const matrices = computeSkinningMatrices(skeleton, skin);
    // root world * ibm = identity * identity = identity
    expect(matrices[0][0]).toBe(1);
    expect(matrices[0][5]).toBe(1);
    expect(matrices[0][10]).toBe(1);
    expect(matrices[0][15]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test: GLTFAnimationLoader
// ---------------------------------------------------------------------------

describe("GLTFAnimationLoader", () => {
  it("should return empty array when no animations", () => {
    const result = GLTFAnimationLoader.load({});
    expect(result).toEqual([]);
  });

  it("should load a simple animation with translation", () => {
    const gltf = {
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: "SCALAR" as const, min: [0], max: [1] },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 2, type: "VEC3" as const, min: [0, 0, 0], max: [10, 20, 30] },
      ],
      animations: [
        {
          name: "TestAnim",
          channels: [
            { sampler: 0, target: { node: 0, path: "translation" as const } },
          ],
          samplers: [
            { input: 0, interpolation: "LINEAR" as const, output: 1 },
          ],
        },
      ],
      nodes: [
        { name: "Cube" },
      ],
    };

    const clips = GLTFAnimationLoader.load(gltf);
    expect(clips).toHaveLength(1);
    expect(clips[0].name).toBe("TestAnim");
    expect(clips[0].channels).toHaveLength(1);
    expect(clips[0].channels[0].targetNode).toBe("Cube");
    expect(clips[0].channels[0].property).toBe("translation");
  });

  it("should handle step interpolation", () => {
    const gltf = {
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: "SCALAR" as const, min: [0], max: [1] },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 2, type: "VEC3" as const, min: [0, 0, 0], max: [10, 20, 30] },
      ],
      animations: [
        {
          channels: [
            { sampler: 0, target: { node: 0, path: "translation" as const } },
          ],
          samplers: [
            { input: 0, interpolation: "STEP" as const, output: 1 },
          ],
        },
      ],
      nodes: [
        { name: "Node" },
      ],
    };

    const clips = GLTFAnimationLoader.load(gltf);
    expect(clips[0].channels[0].interpolation).toBe("step");
  });

  it("should handle cubic spline interpolation", () => {
    const gltf = {
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: "SCALAR" as const, min: [0], max: [1] },
        // CUBICSPLINE: 3 values per keyframe (inTangent, value, outTangent) * 3 components
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 2, type: "VEC3" as const, min: [0, 0, 0], max: [10, 10, 10] },
      ],
      animations: [
        {
          channels: [
            { sampler: 0, target: { node: 0, path: "translation" as const } },
          ],
          samplers: [
            { input: 0, interpolation: "CUBICSPLINE" as const, output: 1 },
          ],
        },
      ],
      nodes: [
        { name: "Node" },
      ],
    };

    const clips = GLTFAnimationLoader.load(gltf);
    expect(clips[0].channels[0].interpolation).toBe("catmullrom");
  });

  it("should use node index as fallback name when node has no name", () => {
    const gltf = {
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 1, type: "SCALAR" as const, min: [0], max: [0] },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 1, type: "VEC3" as const, min: [0, 0, 0], max: [0, 0, 0] },
      ],
      animations: [
        {
          channels: [
            { sampler: 0, target: { node: 0, path: "translation" as const } },
          ],
          samplers: [
            { input: 0, interpolation: "LINEAR" as const, output: 1 },
          ],
        },
      ],
      nodes: [{}],
    };

    const clips = GLTFAnimationLoader.load(gltf);
    expect(clips[0].channels[0].targetNode).toBe("node_0");
  });

  it("should use nodeNames map when provided", () => {
    const gltf = {
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 1, type: "SCALAR" as const, min: [0], max: [0] },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 1, type: "VEC3" as const, min: [0, 0, 0], max: [0, 0, 0] },
      ],
      animations: [
        {
          channels: [
            { sampler: 0, target: { node: 0, path: "translation" as const } },
          ],
          samplers: [
            { input: 0, interpolation: "LINEAR" as const, output: 1 },
          ],
        },
      ],
      nodes: [{}],
    };

    const nodeNames = new Map<number, string>([[0, "MyCustomNode"]]);
    const clips = GLTFAnimationLoader.load(gltf, nodeNames);
    expect(clips[0].channels[0].targetNode).toBe("MyCustomNode");
  });

  it("should handle rotation and scale channels", () => {
    const gltf = {
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 1, type: "SCALAR" as const, min: [0], max: [0] },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 1, type: "VEC4" as const, min: [0, 0, 0, 1], max: [0, 0, 0, 1] },
        { bufferView: 2, byteOffset: 0, componentType: 5126, count: 1, type: "VEC3" as const, min: [1, 1, 1], max: [1, 1, 1] },
      ],
      animations: [
        {
          channels: [
            { sampler: 0, target: { node: 0, path: "rotation" as const } },
            { sampler: 1, target: { node: 0, path: "scale" as const } },
          ],
          samplers: [
            { input: 0, interpolation: "LINEAR" as const, output: 1 },
            { input: 0, interpolation: "LINEAR" as const, output: 2 },
          ],
        },
      ],
      nodes: [{ name: "Bone" }],
    };

    const clips = GLTFAnimationLoader.load(gltf);
    expect(clips).toHaveLength(1);
    expect(clips[0].channels).toHaveLength(2);
    expect(clips[0].channels[0].property).toBe("rotation");
    expect(clips[0].channels[1].property).toBe("scale");
  });
});

// ---------------------------------------------------------------------------
// Mock Entity for testing
// ---------------------------------------------------------------------------

function createMockEntity(): Entity {
  const components = new Map<string, Component>();
  return {
    id: `entity_${Math.random().toString(36).slice(2, 8)}`,
    world: null as unknown as World,
    components,
    name: "TestEntity",
    addComponent(component: Component) {
      components.set(component.type, component);
      return component;
    },
    removeComponent(type: string) {
      components.delete(type);
    },
    getComponent<T extends Component>(type: string): T | undefined {
      return components.get(type) as T | undefined;
    },
    hasComponent(type: string): boolean {
      return components.has(type);
    },
    destroy() {
      components.clear();
    },
  };
}
