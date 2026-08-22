import { describe, it, expect, beforeEach, vi } from "vitest";
import { Scene, serializeScene, deserializeScene } from "@web-engine/engine-core";
import { createBoxMesh } from "@web-engine/engine-renderer";
import { CameraComponent } from "../src/components/CameraComponent.js";
import { MeshComponent, MaterialComponent } from "../src/components/RenderComponents.js";
import { createRuntimeComponentFactories } from "../src/serialization.js";
import { SceneRuntime } from "../src/SceneRuntime.js";
import { CameraSyncSystem } from "../src/systems/CameraSyncSystem.js";
import type { Renderer, RenderStats, Mesh } from "@web-engine/engine-renderer";

function createMockRenderer(): Renderer {
  return {
    name: "mock",
    kind: "webgl2",
    init: vi.fn(async () => undefined),
    resize: vi.fn(),
    createMeshResources: vi.fn(),
    destroyMeshResources: vi.fn(),
    createMaterialResources: vi.fn(),
    destroyMaterialResources: vi.fn(),
    render: vi.fn((): RenderStats => ({ drawCalls: 0, triangles: 0, vertices: 0 })),
    getInfo: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockCanvas(): HTMLCanvasElement {
  return {
    width: 100, height: 100, clientWidth: 100, clientHeight: 100,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

let rafStub: ReturnType<typeof vi.fn>;
let cafStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rafStub = vi.fn(() => 1);
  cafStub = vi.fn();
  vi.stubGlobal("requestAnimationFrame", rafStub);
  vi.stubGlobal("cancelAnimationFrame", cafStub);
});

describe("CameraComponent", () => {
  it("round-trips through toJSON/fromJSON", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cam");
    const component = new CameraComponent(entity, null, true);
    component.camera.setPerspective(45, 1.5, 0.05, 500);

    const json = component.toJSON();
    expect(json["isPrimary"]).toBe(true);
    expect(json["fov"]).toBe(45);
    expect(json["near"]).toBe(0.05);
    expect(json["far"]).toBe(500);

    const restored = CameraComponent.fromJSON(entity, json);
    expect(restored.isPrimary).toBe(true);
    expect(restored.camera.fov).toBe(45);
    expect(restored.camera.near).toBe(0.05);
    expect(restored.camera.far).toBe(500);
  });
});

describe("createRuntimeComponentFactories", () => {
  it("reconstructs camera, mesh and material components on deserialize", () => {
    const scene = new Scene();
    const cameraEntity = scene.createEntity("Cam");
    cameraEntity.addComponent(new CameraComponent(cameraEntity, undefined, true));

    const mesh = createBoxMesh("test:mesh");
    const meshEntity = scene.createEntity("Cube");
    meshEntity.addComponent(new MeshComponent(meshEntity, mesh, true, true));
    meshEntity.addComponent(new MaterialComponent(meshEntity));

    const snapshot = serializeScene(scene);
    const lookup = new Map<string, Mesh>();
    lookup.set(mesh.id, mesh);

    const restored = deserializeScene(snapshot, createRuntimeComponentFactories(lookup));

    const cam = restored.world.query<CameraComponent>("camera")[0];
    expect(cam).toBeDefined();
    expect(cam.isPrimary).toBe(true);

    const meshComp = restored.world.queryAll("mesh")[0]?.getComponent<MeshComponent>("mesh");
    expect(meshComp).toBeDefined();
    expect(meshComp?.mesh?.id).toBe(mesh.id);
    expect(meshComp?.castShadow).toBe(true);

    const materialComp = restored.world.queryAll("material")[0]?.getComponent<MaterialComponent>("material");
    expect(materialComp).toBeDefined();
    expect(materialComp?.material.roughness).toBeCloseTo(0.8);
  });

  it("keeps IDs stable across round-trip", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Thing");
    entity.addComponent(new MeshComponent(entity, createBoxMesh("thing:mesh")));

    const snapshot = serializeScene(scene);
    const restored = deserializeScene(snapshot, createRuntimeComponentFactories(new Map()));
    const restoredEntity = restored.world.queryAll("mesh")[0];
    expect(restoredEntity.id).toBe(entity.id);
  });
});

describe("CameraSyncSystem", () => {
  it("positions the camera from the entity transform", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cam");
    const component = new CameraComponent(entity, undefined, true);
    entity.addComponent(component);
    const transform = entity.getComponent("transform")!;
    transform.setPosition(3, 5, 7);

    const system = new CameraSyncSystem(scene.world);
    system.update(0.016);

    expect(component.camera.position[0]).toBeCloseTo(3);
    expect(component.camera.position[1]).toBeCloseTo(5);
    expect(component.camera.position[2]).toBeCloseTo(7);
  });
});

describe("SceneRuntime", () => {
  it("uses the primary camera from the scene", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cam");
    entity.addComponent(new CameraComponent(entity, undefined, true));

    const renderer = createMockRenderer();
    const runtime = new SceneRuntime(scene, renderer, createMockCanvas());
    expect(runtime.camera).toBe(entity.getComponent<CameraComponent>("camera")!.camera);
    runtime.dispose();
  });

  it("pause/resume/stop toggle the running state", () => {
    const scene = new Scene();
    const renderer = createMockRenderer();
    const runtime = new SceneRuntime(scene, renderer, createMockCanvas());

    runtime.start();
    expect(runtime.isRunning).toBe(true);
    expect(rafStub).toHaveBeenCalled();

    runtime.pause();
    expect(runtime.isPaused).toBe(true);
    expect(cafStub).toHaveBeenCalled();

    runtime.resume();
    expect(runtime.isPaused).toBe(false);
    expect(runtime.isRunning).toBe(true);

    runtime.stop();
    expect(runtime.isRunning).toBe(false);
    runtime.dispose();
  });

  it("renders on update and disposes renderable resources", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cube");
    entity.addComponent(new MeshComponent(entity, createBoxMesh("cube:mesh")));

    const renderer = createMockRenderer();
    const runtime = new SceneRuntime(scene, renderer, createMockCanvas());
    runtime.setLights([]);
    runtime.update(0.016);

    expect(renderer.render).toHaveBeenCalled();
    expect(renderer.createMeshResources).toHaveBeenCalledWith(expect.objectContaining({ id: "cube:mesh" }));

    runtime.dispose();
    expect(renderer.destroyMeshResources).toHaveBeenCalledWith(expect.objectContaining({ id: "cube:mesh" }));
    expect(scene.world.queryAll("transform").length).toBe(0);
  });

  it("does not run the loop while paused", () => {
    const scene = new Scene();
    const renderer = createMockRenderer();
    const runtime = new SceneRuntime(scene, renderer, createMockCanvas());

    runtime.start();
    runtime.pause();
    expect(runtime.isPaused).toBe(true);
    runtime.dispose();
  });
});
