# Web Engine

**Web-native 3D engine & visual editor** — "Figma for 3D + Game Engine + Visual Programming + AI"

A modular, browser-based 3D creation platform built with TypeScript. Create 3D scenes, import assets, configure materials, build visual logic with Blueprints, add physics/animation/audio/AI, and publish projects — all in the browser.

## Architecture Overview

```
packages/          # Core engine packages (monorepo workspaces)
  engine-core       ECS, World, Scene, Transform, Commands, Serialization
  engine-renderer   WebGPU/WebGL2 renderer, Camera, Light, Mesh, Material
  engine-assets     GLB/glTF parser and loader
  engine-runtime    SceneRuntime, Systems, GLB import
  engine-physics    Rapier physics integration
  engine-input      Keyboard, Mouse, Touch, Gamepad input
  engine-animation  Animation clips, controllers, state machines, blend trees
  engine-audio      Web Audio API integration
  engine-blueprint  Visual programming: graph model, editor, compiler, runtime
  engine-materials  Material graph, shader generator, post-processing
  engine-particles  Particle emitter, renderer, GPU particles
  engine-ai         AI controller, navigation, behavior trees, perception
  engine-performance Performance manager, culling, LOD, instancing
  engine-workers    Worker pool, frustum culling, LOD, instancing workers
  ai-assistant      Scene/blueprint generation, structured operations

apps/              # Application shells
  server            Node.js + Fastify backend (PostgreSQL, Auth, S3, WebSocket)
  desktop           Electron desktop wrapper
  desktop-tauri     Tauri desktop wrapper
  mobile            Capacitor mobile wrapper
```

## Quick Start

```bash
# Install dependencies
npm install

# TypeScript build check
npm run typecheck

# Run all tests
npm test

# Lint
npm run lint
```

## Key Features

| Feature | Status |
|---------|--------|
| **ECS Architecture** — Entity/Component/System with hierarchy & queries | ✅ Complete |
| **Scene Graph** — Parent-child transforms, local/world matrices | ✅ Complete |
| **Renderer** — WebGPU + WebGL2 backends, PBR materials | ✅ Complete |
| **GLB Import** — glTF/GLB parser and scene import | ✅ Complete |
| **Transform Gizmos** — Translate/Rotate/Scale with snap | ✅ Complete |
| **Play Mode** — Snapshot-based runtime with pause/resume | ✅ Complete |
| **Physics** — Rapier integration, rigid bodies, colliders | ✅ Complete |
| **Input System** — Keyboard, Mouse, Touch, Gamepad, action mapping | ✅ Complete |
| **Animation** — Clips, controllers, state machines, blend trees, skeletal | ✅ Complete |
| **Audio** — Web Audio, spatial audio, 3D listener | ✅ Complete |
| **Blueprint (Visual Programming)** — Graph editor, compiler, runtime | ✅ Complete |
| **Material Graph** — Node-based material editing, shader generation | ✅ Complete |
| **Particle System** — CPU/GPU particles, emitters, renderers | ✅ Complete |
| **AI System** — Behavior trees, navigation, perception, blackboard | ✅ Complete |
| **AI Assistant** — Scene/blueprint generation, structured ops | ✅ Complete |
| **Backend Server** — Fastify, PostgreSQL, JWT/OAuth, S3, WebSocket | ✅ Complete |
| **Collaboration** — WebSocket, CRDT/OT, presence, multi-cursor | ✅ Complete |
| **Publishing** — PWA, Electron, Tauri, Capacitor wrappers | ✅ Complete |
| **Performance** — Web Workers, frustum culling, LOD, instancing | ✅ Complete |

## Documentation

- [Architecture Overview](docs/architecture.md)
- [API Reference](docs/api.md)
- [Development Guide](docs/development.md)

## Tech Stack

- **Language:** TypeScript (strict mode, ES2022)
- **Runtime:** Node.js 20+
- **Rendering:** WebGPU (primary) + WebGL2 (fallback)
- **Physics:** Rapier
- **Build:** TypeScript composite projects
- **Testing:** Vitest
- **Linting:** ESLint with typescript-eslint
- **Backend:** Fastify, PostgreSQL, Redis, MinIO/S3
- **Desktop:** Electron, Tauri
- **Mobile:** Capacitor

## Project Structure

```
package.json          # Root workspace config
packages/
  engine-core/        # ECS, transform, scene, commands, serialization
  engine-renderer/    # Renderer abstraction, WebGPU/WebGL2 backends
  engine-assets/      # GLB/glTF asset loading
  engine-runtime/     # Scene runtime, game loop
  engine-physics/     # Physics engine abstraction
  engine-input/       # Input handling
  engine-animation/   # Animation system
  engine-audio/       # Audio system
  engine-blueprint/   # Visual programming
  engine-materials/   # Material graph & shaders
  engine-particles/   # Particle effects
  engine-ai/          # AI system
  engine-performance/ # Performance optimization
  engine-workers/     # Web Worker management
  ai-assistant/       # AI generation tools
apps/
  server/             # Backend server
  desktop/            # Electron wrapper
  desktop-tauri/      # Tauri wrapper
  mobile/             # Capacitor wrapper
```

## License

Private — internal project.
