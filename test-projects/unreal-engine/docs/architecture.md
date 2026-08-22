# Architecture Overview

This document describes the high-level architecture of the Web Engine — a modular, browser-based 3D creation platform.

## Design Principles

1. **Modularity** — Each capability lives in its own package with a clear public API
2. **ECS (Entity-Component-System)** — The core architectural pattern for game objects
3. **Abstraction Layers** — Renderer, physics, and input are behind interfaces
4. **Local-First** — IndexedDB persistence with optional cloud sync
5. **Extensibility** — Plugin architecture for custom systems and components

## Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Applications                       │
│  apps/server  apps/desktop  apps/desktop-tauri  apps/mobile │
├─────────────────────────────────────────────────────┤
│                   Engine Packages                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │engine-core│ │engine-runtime│ │engine-blueprint  │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │engine-renderer│engine-physics│engine-animation  │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │engine-audio│engine-input│engine-particles    │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │engine-ai  │engine-assets│engine-performance │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
│  ┌──────────┐ ┌──────────┐                        │
│  │engine-workers│ai-assistant│                     │
│  └──────────┘ └──────────┘                        │
├─────────────────────────────────────────────────────┤
│                   Infrastructure                     │
│  PostgreSQL   Redis   S3/MinIO   WebSocket          │
└─────────────────────────────────────────────────────┘
```

## 1. Core Engine (`engine-core`)

### ECS (Entity-Component-System)

The foundation of the engine. Everything in a scene is an **Entity** (a unique ID), which has **Components** (data), processed by **Systems** (logic).

- **Entity** — A lightweight identifier (UUID) with a list of component types
- **Component** — Pure data (e.g., TransformComponent, MeshComponent)
- **System** — Logic that runs on entities with specific component combinations
- **World** — The container that manages entities, components, and systems

### Scene Graph

Entities form a hierarchy (parent-child). Each entity has a `TransformComponent` with:
- Local position, rotation, scale
- World matrix computed from parent chain

### Serialization

`SceneSerializer` converts the entire scene to/from JSON with schema versioning. Supports:
- Entity hierarchy
- All component types
- Mesh geometry references

### Command System

`CommandManager` provides undo/redo with:
- `CreateEntityCommand`
- `DeleteEntityCommand`
- `TransformCommand`
- `AddComponentCommand`
- `RemoveComponentCommand`
- `ChangePropertyCommand`
- `RenameEntityCommand`
- `DuplicateEntityCommand`

## 2. Renderer (`engine-renderer`)

### Abstraction

`Renderer` interface with two backends:

- **WebGL2Renderer** — Full implementation using WebGL2
- **WebGPURenderer** — Implementation using WebGPU (next-gen API)

### Core Types

- **Mesh** — Geometry data (positions, normals, UVs, indices)
- **Material** — PBR material properties (baseColor, metallic, roughness, normal, emissive)
- **Camera** — Perspective and orthographic cameras
- **Light** — Directional, point, spot, and ambient lights
- **MeshRegistry** — Central registry for all mesh geometry

## 3. Runtime (`engine-runtime`)

`SceneRuntime` manages the game loop with:

- **Lifecycle** — Start, stop, tick, pause, resume, restart, dispose
- **Systems** — `RenderSystem`, `CameraSyncSystem`, `InputSystem`, `PhysicsSystem`
- **Play Mode** — Creates a snapshot of the scene, runs it independently, restores on stop
- **GLB Import** — Parses GLB/glTF files and creates entities with proper components

## 4. Physics (`engine-physics`)

Abstracted behind interfaces:

- **RapierPhysicsWorld** — Implementation using the Rapier physics engine
- **RigidBodyComponent** — Dynamic, static, or kinematic bodies
- **ColliderComponent** — Box, sphere, capsule, and trimesh colliders
- **PhysicsSystem** — Syncs transform between ECS and physics world

## 5. Input (`engine-input`)

Multi-device input system:

- **InputManager** — Unified manager for all input devices
- **InputSystem** — ECS system that reads input state each frame
- **Action Mapping** — Map input events to named actions
- **Devices** — Keyboard, Mouse, Touch, Gamepad

## 6. Animation (`engine-animation`)

- **AnimationClip** — Keyframe data with interpolation (linear, step, cubic, catmull-rom)
- **AnimationController** — Plays and crossfades between clips
- **StateMachine** — State-based animation with transitions and conditions
- **BlendTree** — 1D and 2D blend trees for smooth blending
- **SkeletalAnimation** — Skeleton, skinning, bone matrices
- **GLTFAnimationLoader** — Loads animations from glTF files

## 7. Audio (`engine-audio`)

- **AudioClip** — Loaded audio buffer
- **AudioSource** — Playback control (play, pause, stop, loop, volume, pitch)
- **Listener** — 3D audio listener position/orientation
- **SpatialAudio** — 3D positional audio with distance attenuation
- **AudioSystem** — ECS system managing audio lifecycle

## 8. Blueprint System (`engine-blueprint`)

Visual programming system:

- **GraphModel** — Node graph with ports and connections
- **GraphSerializer** — Serialize/deserialize graphs to JSON
- **BlueprintCompiler** — Compiles graph → Intermediate Representation → Runtime Graph
- **ExecutionEngine** — Executes compiled graphs
- **Node Types:**
  - VariablesNode, FunctionsNode, EventsNode
  - ConditionsNode, LoopsNode
  - EntityComponentNodes, MathNodes

## 9. Material System (`engine-materials`)

- **Material** — PBR material properties
- **Shader** — Shader program generation
- **MaterialGraph** — Node-based material graph for visual shader editing
- **PostProcessingChain** — Post-processing effects pipeline

## 10. Particle System (`engine-particles`)

- **ParticleEmitter** — Emitter configuration (rate, burst, shape, lifetime)
- **ParticleRenderer** — Billboard rendering
- **GPUParticleSystem** — GPU-accelerated particle simulation

## 11. AI System (`engine-ai`)

- **AIController** — Base controller for AI entities
- **Navigation** — Pathfinding and navigation
- **BehaviorTree** — Behavior tree with Sequence, Selector, Condition, Action nodes
- **Blackboard** — Shared data store for AI agents
- **Perception** — Sense system (vision, hearing)

### AI Assistant (`ai-assistant`)

- **StructuredOperations** — Abstract operations for AI-driven scene editing
- **Validator** — Validation of operations
- **SceneGenerator** — AI scene generation
- **BlueprintGenerator** — AI blueprint generation

## 12. Backend Server (`apps/server`)

- **Fastify** — HTTP server framework
- **Auth** — JWT + OAuth authentication
- **Projects** — Project CRUD API
- **Assets** — Asset upload/download with S3/MinIO
- **Builds** — Build pipeline for publishing
- **PWA** — Progressive Web App manifest and service worker
- **WebSocket** — Real-time collaboration
- **CRDT/OT** — Conflict resolution for collaborative editing
- **Presence** — User presence tracking
- **Multi-cursor** — Cursor sharing
- **Revision History** — Versioned scene history

## 13. Performance (`engine-performance` & `engine-workers`)

- **Frustum Culling** — Web Worker-based culling
- **LOD** — Level-of-detail selection
- **Instancing** — GPU instancing optimization
- **WorkerPoolManager** — Generic Web Worker pool
- **PerformanceManager** — Coordinated performance optimization

## Data Flow

```
User Input → InputManager → InputSystem
                              ↓
Systems (Physics, Animation, AI, Blueprint) → World.update()
                              ↓
                    RenderSystem → Renderer → GPU
```

## Collaboration Flow

```
Client A ←→ WebSocket ←→ Server ←→ WebSocket ←→ Client B
                ↓
          CRDT/OT Service
                ↓
          Revision Service
                ↓
          PostgreSQL
```
