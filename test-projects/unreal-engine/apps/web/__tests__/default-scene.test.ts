import { describe, expect, it } from 'vitest';
import { serializeScene } from '@web-engine/engine-core';
import type { CameraComponent, MaterialComponent } from '@web-engine/engine-runtime';
import {
  DEMO_MESH_IDS,
  DEMO_SCENE_NAME,
  TURNTABLE_NAME,
  createDemoLights,
  createDemoMeshes,
  createDemoScene,
  createSceneModel,
  normalizeSnapshot,
  summarizeScene,
} from '../src/app/engine/default-scene';

describe('createDemoMeshes', () => {
  it('keys every mesh by the id the serializer will write', () => {
    const meshes = createDemoMeshes();
    expect([...meshes.keys()]).toEqual([DEMO_MESH_IDS.ground, DEMO_MESH_IDS.box, DEMO_MESH_IDS.sphere]);
    expect(meshes.get(DEMO_MESH_IDS.box)?.id).toBe(DEMO_MESH_IDS.box);
  });

  it('drops the ground plane when it is turned off', () => {
    expect(createDemoMeshes({ showGround: false }).has(DEMO_MESH_IDS.ground)).toBe(false);
  });
});

describe('createDemoScene', () => {
  it('builds the authored hierarchy', () => {
    const { scene } = createDemoScene();
    const names = scene.world.queryAll('transform').map((entity) => entity.name);
    expect(names).toContain('Ground');
    expect(names).toContain(TURNTABLE_NAME);
    expect(names).toContain('Cube');
    expect(names).toContain('Sphere');
    expect(names).toContain('Camera');
  });

  it('parents the animated objects to the turntable', () => {
    const { turntable } = createDemoScene();
    expect(turntable).not.toBeNull();
    const childNames = turntable!.getChildren().map((child) => child.entity.name);
    expect(childNames).toEqual(['Cube', 'Sphere']);
  });

  it('marks its camera primary so SceneRuntime adopts it', () => {
    const { scene } = createDemoScene();
    const primaries = scene.world.query<CameraComponent>('camera').filter((camera) => camera.isPrimary);
    expect(primaries).toHaveLength(1);
  });

  it('reports the entity and mesh counts the HUD shows', () => {
    const { scene } = createDemoScene();
    expect(summarizeScene(scene)).toEqual({ entities: 5, meshes: 3 });
  });

  it('names the scene after the demo', () => {
    expect(createDemoScene().scene.name).toBe(DEMO_SCENE_NAME);
  });
});

describe('createDemoLights', () => {
  it('provides a key, a fill and an ambient light', () => {
    const lights = createDemoLights();
    expect(lights.map((light) => light.type)).toEqual(['directional', 'point', 'ambient']);
  });
});

describe('createSceneModel', () => {
  it('returns the demo scene when there is nothing to restore', () => {
    const model = createSceneModel();
    expect(model.source).toBe('demo');
    expect(model.turntable).not.toBeNull();
  });

  it('restores a serialized demo scene without losing entities', () => {
    const original = createDemoScene();
    const snapshot = serializeScene(original.scene);

    const restored = createSceneModel({ snapshot });

    expect(restored.source).toBe('snapshot');
    expect(restored.scene.name).toBe(DEMO_SCENE_NAME);
    const summary = summarizeScene(restored.scene);
    expect(summary.entities).toBe(summarizeScene(original.scene).entities);
    expect(summary.meshes).toBe(summarizeScene(original.scene).meshes);
  });

  it('rebuilds materials on restore so RenderSystem still has something to draw', () => {
    const snapshot = serializeScene(createDemoScene().scene);
    const restored = createSceneModel({ snapshot });
    const materials = restored.scene.world.query<MaterialComponent>('material');
    expect(materials.length).toBeGreaterThan(0);
    expect(materials[0]!.material.baseColor).toHaveLength(4);
  });

  it('re-adds a camera when a restored scene has none', () => {
    const snapshot: ReturnType<typeof serializeScene> = {
      version: 1,
      id: 'scene-no-camera',
      name: 'No Camera',
      entities: [],
    };
    const restored = createSceneModel({ snapshot });
    expect(restored.scene.world.query('camera')).toHaveLength(1);
    expect(restored.camera.fov).toBe(55);
  });

  it('leaves the spin control without a target when there is no turntable', () => {
    /* The turntable is found by entity name, so a scene authored elsewhere —
       and saved without one — must simply disable the control. */
    const snapshot = serializeScene(createDemoScene().scene);
    snapshot.entities.forEach((entity) => {
      if (entity.name === TURNTABLE_NAME) entity.name = 'Rubble';
    });

    expect(createSceneModel({ snapshot }).turntable).toBeNull();
  });
});

describe('normalizeSnapshot', () => {
  it('accepts a JSON string out of a jsonb column', () => {
    const snapshot = normalizeSnapshot(JSON.stringify({ name: 'x' }));
    expect(snapshot).toEqual({ version: 1, id: 'web-restored', name: 'x', entities: [] });
  });

  it('fills in the fields a hand-written document omits', () => {
    const snapshot = normalizeSnapshot({ name: 'Partial', entities: [{ id: 'a' }] });
    expect(snapshot.version).toBe(1);
    expect(snapshot.entities).toHaveLength(1);
  });

  it('survives a null document', () => {
    expect(normalizeSnapshot(null).entities).toEqual([]);
  });
});
