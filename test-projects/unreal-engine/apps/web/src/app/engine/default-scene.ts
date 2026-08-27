import {
  Scene,
  TransformComponent,
  deserializeScene,
  serializeScene,
  type SceneSnapshot,
} from '@web-engine/engine-core';
import {
  Camera,
  Light,
  Material,
  createBoxMesh,
  createPlaneMesh,
  createSphereMesh,
  type Mesh,
} from '@web-engine/engine-renderer';
import {
  CameraComponent,
  MaterialComponent,
  MeshComponent,
  createRuntimeComponentFactories,
} from '@web-engine/engine-runtime';

export const DEMO_SCENE_NAME = 'Web Engine Demo';
export const TURNTABLE_NAME = 'Turntable';
export const CAMERA_FOV = 55;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 200;

/** Mesh ids are fixed so a serialized scene can be rebuilt against them. */
export const DEMO_MESH_IDS = {
  ground: 'web-ground-mesh',
  box: 'web-box-mesh',
  sphere: 'web-sphere-mesh',
} as const;

export interface DemoSceneOptions {
  /** Add the large plane under the objects. Defaults to true. */
  readonly showGround?: boolean;
  readonly boxSize?: number;
  readonly sphereRadius?: number;
  /** Eye position of the primary camera. */
  readonly cameraPosition?: readonly [number, number, number];
  /** Pitch of the primary camera in degrees; negative looks down. */
  readonly cameraPitchDegrees?: number;
}

export interface DemoSceneModel {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly lights: Light[];
  /**
   * Parent of the animated objects; `null` when a restored scene has no
   * turntable, which simply leaves the spin control without a target.
   */
  readonly turntable: TransformComponent | null;
  /** Meshes the client owns, kept so they can be released on unmount. */
  readonly meshes: readonly Mesh[];
  /** Where the model came from — drives the HUD's `scene` row. */
  readonly source: 'demo' | 'snapshot';
}

const DEFAULT_OPTIONS: Required<DemoSceneOptions> = {
  showGround: true,
  boxSize: 1.2,
  sphereRadius: 0.6,
  cameraPosition: [0, 2.6, 7.5],
  cameraPitchDegrees: -16,
};

function withDefaults(options: DemoSceneOptions): Required<DemoSceneOptions> {
  return {
    showGround: options.showGround ?? DEFAULT_OPTIONS.showGround,
    boxSize: options.boxSize ?? DEFAULT_OPTIONS.boxSize,
    sphereRadius: options.sphereRadius ?? DEFAULT_OPTIONS.sphereRadius,
    cameraPosition: options.cameraPosition ?? DEFAULT_OPTIONS.cameraPosition,
    cameraPitchDegrees: options.cameraPitchDegrees ?? DEFAULT_OPTIONS.cameraPitchDegrees,
  };
}

/** The three meshes the web client owns; shared by the demo and restored scenes. */
export function createDemoMeshes(options: DemoSceneOptions = {}): Map<string, Mesh> {
  const resolved = withDefaults(options);
  const meshes = new Map<string, Mesh>();
  if (resolved.showGround) {
    meshes.set(DEMO_MESH_IDS.ground, createPlaneMesh(DEMO_MESH_IDS.ground, 16, 16));
  }
  meshes.set(DEMO_MESH_IDS.box, createBoxMesh(DEMO_MESH_IDS.box, resolved.boxSize));
  meshes.set(DEMO_MESH_IDS.sphere, createSphereMesh(DEMO_MESH_IDS.sphere, resolved.sphereRadius, 24, 16));
  return meshes;
}

/** Key light, cool fill and a low ambient — lights live outside the scene graph. */
export function createDemoLights(): Light[] {
  const key = Light.directional('web-key-light', [1, 0.97, 0.92], 1.15);
  key.direction = [0.35, -1, 0.4];
  const fill = Light.point('web-fill-light', [0.55, 0.68, 1], 0.7);
  fill.position = [-3.5, 3, 3];
  const ambient = Light.ambient('web-ambient', [0.22, 0.26, 0.34], 0.6);
  return [key, fill, ambient];
}

/** The camera the web client falls back to: same framing as the demo scene. */
export function createDemoCamera(): Camera {
  const camera = new Camera('web-camera', 'Web Camera');
  camera.fov = CAMERA_FOV;
  camera.near = CAMERA_NEAR;
  camera.far = CAMERA_FAR;
  return camera;
}

function addCameraEntity(
  scene: Scene,
  camera: Camera,
  options: Required<DemoSceneOptions>,
  isPrimary: boolean
): void {
  const entity = scene.createEntity('Camera');
  entity.addComponent(new CameraComponent(entity, camera, isPrimary));
  const transform = entity.getComponent<TransformComponent>('transform');
  transform?.setPosition(options.cameraPosition[0], options.cameraPosition[1], options.cameraPosition[2]);
  transform?.setRotation(options.cameraPitchDegrees, 0, 0);
}

/**
 * Build the scene the web client shows on a cold boot: a ground plane, a cube
 * and a sphere on a turntable, lit by a key directional plus a fill.
 *
 * It goes through the same component API an editor uses
 * (`MeshComponent` / `MaterialComponent` / `CameraComponent`), so the demo also
 * exercises `RenderSystem` and `CameraSyncSystem` instead of a bespoke path.
 */
export function createDemoScene(options: DemoSceneOptions = {}): DemoSceneModel {
  const resolved = withDefaults(options);
  const scene = new Scene({ name: DEMO_SCENE_NAME });
  const meshes = createDemoMeshes(resolved);

  const ground = meshes.get(DEMO_MESH_IDS.ground);
  if (ground) {
    const groundEntity = scene.createEntity('Ground');
    groundEntity.addComponent(new MeshComponent(groundEntity, ground, true, false));
    groundEntity.addComponent(
      new MaterialComponent(
        groundEntity,
        new Material('web-ground-material', {
          name: 'Ground',
          baseColor: [0.16, 0.19, 0.26, 1],
          metallic: 0,
          roughness: 0.95,
        })
      )
    );
    /* The plane is authored in the XY plane, so lay it flat under the objects. */
    groundEntity.getComponent<TransformComponent>('transform')?.setRotation(-90, 0, 0);
  }

  const turntableEntity = scene.createEntity(TURNTABLE_NAME);
  const turntable = turntableEntity.getComponent<TransformComponent>('transform') ?? null;

  const box = meshes.get(DEMO_MESH_IDS.box)!;
  const sphere = meshes.get(DEMO_MESH_IDS.sphere)!;

  /* Parented through `createEntity`, so `TransformSystem` propagates the
     turntable's rotation to the children. */
  const boxEntity = scene.createEntity('Cube', turntable?.entity);
  boxEntity.addComponent(new MeshComponent(boxEntity, box, true, true));
  boxEntity.addComponent(
    new MaterialComponent(
      boxEntity,
      new Material('web-box-material', {
        name: 'Accent',
        baseColor: [0.91, 0.27, 0.38, 1],
        metallic: 0.15,
        roughness: 0.45,
      })
    )
  );
  boxEntity.getComponent<TransformComponent>('transform')?.setPosition(-0.95, resolved.boxSize / 2, 0);

  const sphereEntity = scene.createEntity('Sphere', turntable?.entity);
  sphereEntity.addComponent(new MeshComponent(sphereEntity, sphere, true, true));
  sphereEntity.addComponent(
    new MaterialComponent(
      sphereEntity,
      new Material('web-sphere-material', {
        name: 'Metal',
        baseColor: [0.35, 0.62, 1, 1],
        metallic: 0.85,
        roughness: 0.2,
      })
    )
  );
  sphereEntity.getComponent<TransformComponent>('transform')?.setPosition(1.15, resolved.sphereRadius, 0);

  const camera = createDemoCamera();
  addCameraEntity(scene, camera, resolved, true);

  return {
    scene,
    camera,
    lights: createDemoLights(),
    turntable,
    meshes: [...meshes.values()],
    source: 'demo',
  };
}

export interface SceneModelOptions {
  /** Scene document from local storage or `apps/server`; `null` means "demo". */
  readonly snapshot?: SceneSnapshot | null;
  readonly demo?: DemoSceneOptions;
}

/**
 * Resolve the scene to render: restore a serialized document when there is
 * one, otherwise show the demo scene.
 *
 * Restoration reuses the engine's own component factories, so only the entities
 * and transforms come back from storage and the meshes/materials are rebuilt
 * locally — the same contract `packages/engine-runtime` documents.
 */
export function createSceneModel({ snapshot = null, demo = {} }: SceneModelOptions = {}): DemoSceneModel {
  if (!snapshot) return createDemoScene(demo);

  const resolved = withDefaults(demo);
  const meshes = createDemoMeshes(resolved);
  const scene = deserializeScene(normalizeSnapshot(snapshot), createRuntimeComponentFactories(meshes));
  const cameraComponent = scene.world.query<CameraComponent>('camera').find((component) => component.isPrimary);
  const camera = cameraComponent?.camera ?? createDemoCamera();

  if (!cameraComponent) addCameraEntity(scene, camera, resolved, true);

  const turntable = scene.world
    .queryAll('transform')
    .find((entity) => entity.name === TURNTABLE_NAME)
    ?.getComponent<TransformComponent>('transform') ?? null;

  return {
    scene,
    camera,
    lights: createDemoLights(),
    turntable,
    meshes: [...meshes.values()],
    source: 'snapshot',
  };
}

/**
 * `apps/server` keeps `project.scenes` in a jsonb column, so a document can
 * arrive as a JSON string, or without the `version` the serializer writes.
 */
export function normalizeSnapshot(raw: unknown): SceneSnapshot {
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  const record = (parsed ?? {}) as Record<string, unknown>;
  return {
    version: typeof record['version'] === 'number' ? record['version'] : 1,
    id: typeof record['id'] === 'string' ? record['id'] : 'web-restored',
    name: typeof record['name'] === 'string' ? record['name'] : DEMO_SCENE_NAME,
    entities: Array.isArray(record['entities']) ? record['entities'] : [],
  };
}

/** Convenience for the push-to-server path. */
export function snapshotOf(scene: Scene): SceneSnapshot {
  return serializeScene(scene);
}

/** Entity/mesh counts for the HUD. */
export function summarizeScene(scene: Scene): { entities: number; meshes: number } {
  let meshes = 0;
  scene.world.query<MeshComponent>('mesh').forEach((meshComponent) => {
    if (meshComponent.mesh) meshes += 1;
  });
  return { entities: scene.world.size, meshes };
}
