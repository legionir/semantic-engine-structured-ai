# API Reference

## Engine Packages

### `engine-core`

Core ECS, scene graph, commands, and serialization.

```typescript
import { World, Entity, Component, System } from '@web-engine/engine-core';
```

#### World

The central container for all entities and systems.

```typescript
const world = new World();

// Create an entity
const entity = world.createEntity();

// Add a component
world.addComponent(entity, new TransformComponent({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 }
}));

// Get a component
const transform = world.getComponent<TransformComponent>(entity, 'transform');

// Remove a component
world.removeComponent(entity, 'transform');

// Destroy an entity
world.destroyEntity(entity);

// Query entities with specific components
const renderables = world.query(['transform', 'mesh']);

// Register and run a system
class MySystem extends System {
  update(world: World, dt: number) {
    // Called every frame
  }
}
world.addSystem(new MySystem());
world.update(deltaTime);
```

#### Scene

```typescript
import { Scene } from '@web-engine/engine-core';

const scene = new Scene(world);
scene.setActive(true);
```

#### SceneSerializer

```typescript
import { SceneSerializer } from '@web-engine/engine-core';

const json = SceneSerializer.serialize(world);
SceneSerializer.deserialize(json, world);
```

#### CommandManager

```typescript
import { CommandManager } from '@web-engine/engine-core';

const cmd = new CommandManager();
cmd.executeCommand(new CreateEntityCommand(world, 'My Entity'));
cmd.undo();
cmd.redo();
```

---

### `engine-renderer`

```typescript
import { WebGL2Renderer, Camera, Mesh, Material } from '@web-engine/engine-renderer';
```

```typescript
// Create a renderer
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new WebGL2Renderer(canvas);

// Create a camera
const camera = new Camera();
camera.position = { x: 5, y: 5, z: 5 };
camera.lookAt({ x: 0, y: 0, z: 0 });

// Create a mesh
const mesh = createBoxMesh(1, 1, 1);

// Create a material
const material = new Material({
  baseColor: { r: 1, g: 0, b: 0, a: 1 },
  metallic: 0.5,
  roughness: 0.3
});

// Render
renderer.beginFrame(camera);
renderer.renderMesh(mesh, material, worldMatrix);
renderer.endFrame();
```

---

### `engine-runtime`

```typescript
import { SceneRuntime } from '@web-engine/engine-runtime';
```

```typescript
const runtime = new SceneRuntime(world, canvas);
runtime.start();

// Control
runtime.pause();
runtime.resume();
runtime.restart();
runtime.stop();
runtime.dispose();

// Events
runtime.on('start', () => {});
runtime.on('stop', () => {});
runtime.on('error', (err) => {});
```

---

### `engine-physics`

```typescript
import { RapierPhysicsWorld, RigidBodyComponent, ColliderComponent } from '@web-engine/engine-physics';
```

```typescript
const physicsWorld = new RapierPhysicsWorld({ x: 0, y: -9.81, z: 0 });

// Add a rigid body
world.addComponent(entity, new RigidBodyComponent({
  type: 'dynamic',  // 'dynamic' | 'static' | 'kinematic'
  mass: 1
}));

// Add a collider
world.addComponent(entity, new ColliderComponent({
  shape: 'box',     // 'box' | 'sphere' | 'capsule' | 'trimesh'
  size: { x: 1, y: 1, z: 1 }
}));
```

---

### `engine-input`

```typescript
import { InputManager, InputSystem } from '@web-engine/engine-input';
```

```typescript
const inputManager = new InputManager();
inputManager.attach(canvas);

// Check input state
if (inputManager.isKeyDown('KeyW')) { /* move forward */ }
if (inputManager.isMouseButtonDown(0)) { /* left click */ }

// Action mapping
inputManager.mapAction('jump', ['Space']);
inputManager.onAction('jump', () => { /* jump logic */ });

// Touch / Gamepad support
const touchState = inputManager.getTouchState();
const gamepadState = inputManager.getGamepadState(0);

// ECS integration
const inputSystem = new InputSystem(inputManager);
world.addSystem(inputSystem);
```

---

### `engine-animation`

```typescript
import { AnimationClip, AnimationController, StateMachine, BlendTree1D } from '@web-engine/engine-animation';
```

```typescript
// Create a clip
const clip = new AnimationClip({
  name: 'walk',
  duration: 1.0,
  channels: [{
    target: 'transform.position',
    keyframes: [
      { time: 0, value: { x: 0, y: 0, z: 0 } },
      { time: 0.5, value: { x: 1, y: 0, z: 0 } },
      { time: 1, value: { x: 0, y: 0, z: 0 } }
    ]
  }]
});

// Controller
const controller = new AnimationController();
controller.addClip(clip);
controller.play('walk', { crossfade: 0.2 });
controller.update(deltaTime);

// State Machine
const stateMachine = new StateMachine();
stateMachine.addState('idle', clip);
stateMachine.addState('walk', clip);
stateMachine.addTransition('idle', 'walk', { speed: 0.5 });
stateMachine.update(deltaTime);

// Blend Tree
const blendTree = new BlendTree1D('speed', 0, 4);
blendTree.addChild('idle', clip, 0);
blendTree.addChild('walk', clip, 2);
blendTree.addChild('run', clip, 4);
blendTree.setParameter('speed', 3);

// ECS component
world.addComponent(entity, new AnimationComponent({
  controller,
  stateMachine
}));
```

---

### `engine-audio`

```typescript
import { AudioClip, AudioSource, Listener, SpatialAudio, AudioSystem } from '@web-engine/engine-audio';
```

```typescript
const clip = await AudioClip.load('audio/explosion.wav');

const source = new AudioSource(clip);
source.volume = 0.8;
source.loop = false;
source.play();

// 3D spatial audio
const spatial = new SpatialAudio(source, {
  position: { x: 0, y: 0, z: 0 },
  rolloffFactor: 1,
  maxDistance: 50
});

// Listener (attached to camera)
const listener = new Listener();
listener.update(cameraPosition, cameraForward);

// ECS integration
world.addComponent(entity, new AudioSourceComponent({
  clipUrl: 'audio/ambient.wav',
  spatial: true,
  autoPlay: true
}));
```

---

### `engine-blueprint`

```typescript
import { Graph, BlueprintCompiler, ExecutionEngine } from '@web-engine/engine-blueprint';
```

```typescript
// Create a graph
const graph = new Graph();
const startNode = graph.addNode('event_beginplay', { x: 100, y: 100 });
const printNode = graph.addNode('print_string', { x: 300, y: 100 });
graph.connect(startNode, 'out', printNode, 'in');

// Compile
const compiler = new BlueprintCompiler();
const ir = compiler.compile(graph);
const runtimeGraph = compiler.toRuntime(ir);

// Execute
const engine = new ExecutionEngine();
engine.load(runtimeGraph);
engine.execute();
```

---

### `engine-materials`

```typescript
import { Material, MaterialGraph, Shader, PostProcessingChain } from '@web-engine/engine-materials';
```

```typescript
const material = new Material({
  baseColor: { r: 1, g: 1, b: 1, a: 1 },
  metallic: 0,
  roughness: 0.5,
  normalMap: texture,
  emissive: { r: 0, g: 0, b: 0 }
});

// Material Graph (visual shader)
const matGraph = new MaterialGraph();
const texNode = matGraph.addNode('texture_sample', { x: 0, y: 0 });
const outputNode = matGraph.addNode('material_output', { x: 200, y: 0 });
matGraph.connect(texNode, 'rgb', outputNode, 'baseColor');

// Post-processing
const postProcess = new PostProcessingChain();
postProcess.addEffect('bloom', { intensity: 0.5 });
postProcess.addEffect('toneMap', { method: 'aces' });
```

---

### `engine-particles`

```typescript
import { ParticleEmitter, ParticleRenderer, GPUParticleSystem } from '@web-engine/engine-particles';
```

```typescript
const emitter = new ParticleEmitter({
  rate: 100,
  lifetime: { min: 1, max: 3 },
  speed: { min: 1, max: 5 },
  size: { start: 1, end: 0 },
  color: { start: { r: 1, g: 0.5, b: 0, a: 1 }, end: { r: 1, g: 0, b: 0, a: 0 } },
  spawnShape: 'cone',
  duration: -1 // looping
});

emitter.update(deltaTime);

const renderer = new ParticleRenderer();
renderer.render(emitter.getParticles(), camera);

// GPU Particles
const gpuSystem = new GPUParticleSystem({ maxParticles: 10000 });
gpuSystem.emit(500);
gpuSystem.update(deltaTime);
gpuSystem.render(renderer, camera);
```

---

### `engine-ai`

```typescript
import { AIController, Navigation, BehaviorTree, Blackboard, Perception } from '@web-engine/engine-ai';
```

```typescript
// Behavior Tree
const tree = new BehaviorTree();
const root = new SelectorNode([
  new SequenceNode([
    new ConditionNode(() => blackboard.get('health') < 30),
    new ActionNode(() => { /* flee */ return NodeStatus.Success; })
  ]),
  new ActionNode(() => { /* patrol */ return NodeStatus.Success; })
]);
tree.setRoot(root);
tree.tick(blackboard);

// Navigation
const nav = new Navigation();
const path = nav.findPath(start, end, navMesh);

// Perception
const perception = new Perception();
perception.setVisionCone(angle, range);
const detected = perception.update(allEntities);

// Blackboard
const blackboard = new Blackboard();
blackboard.set('health', 100);
blackboard.set('target', entityId);
const health = blackboard.get('health');
```

---

### `engine-performance` & `engine-workers`

```typescript
import { PerformanceManager } from '@web-engine/engine-performance';
import { WorkerPoolManager } from '@web-engine/engine-workers';
```

```typescript
const perfManager = new PerformanceManager();
perfManager.setCullingCamera(camera);
const visible = perfManager.cull(renderables);
const lod = perfManager.selectLOD(renderable, cameraPosition);
const instanceGroups = perfManager.buildInstances(renderables);

// Worker pool
const pool = new WorkerPoolManager();
const cullingWorker = pool.getWorker('culling');
const result = await cullingWorker.postMessage({ input });
```

---

### `ai-assistant`

```typescript
import { SceneGenerator, BlueprintGenerator, Validator } from '@web-engine/ai-assistant';
```

```typescript
const generator = new SceneGenerator();
const scene = await generator.generate('forest scene with trees and rocks');

const bpGenerator = new BlueprintGenerator();
const blueprint = await bpGenerator.generate('open door when player approaches');

const validator = new Validator();
const errors = validator.validateOperation(operation);
```

---

## Backend API (`apps/server`)

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/auth/register` | Register user |
| POST | `/auth/login` | Login (JWT) |
| POST | `/auth/oauth/:provider` | OAuth login |
| GET | `/projects` | List projects |
| POST | `/projects` | Create project |
| GET | `/projects/:id` | Get project |
| PUT | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |
| GET | `/projects/:id/assets` | List project assets |
| POST | `/projects/:id/assets` | Upload asset |
| GET | `/assets/:id` | Download asset |
| POST | `/projects/:id/build` | Start build |
| GET | `/builds/:id` | Build status |

### WebSocket API

Connect to `ws://host/ws` with JWT token.

```typescript
// Messages
{
  type: 'cursor_update',
  data: { position: { x, y, z }, selection: entityId }
}

{
  type: 'operation',
  data: {
    type: 'create_entity' | 'delete_entity' | 'update_component',
    payload: { ... }
  }
}

{
  type: 'presence',
  data: { userId: string, status: 'online' | 'away' | 'offline' }
}

{
  type: 'revision',
  data: {
    id: string,
    timestamp: string,
    changes: [...]
  }
}
```

### Database Migrations

Located at `apps/server/database/migrations/`:

1. `001_create_users_table.sql` — Users
2. `002_create_projects_table.sql` — Projects
3. `003_create_assets_table.sql` — Assets
4. `004_create_scenes_table.sql` — Scenes
5. `005_create_revisions_table.sql` — Revisions
6. `006_create_builds_table.sql` — Builds
