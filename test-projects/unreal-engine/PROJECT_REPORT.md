# Web Engine - Project Report

## Overview

**Web Engine** is a web-native 3D engine and visual editor - a modular, browser-based 3D creation platform built with TypeScript. It combines features of Figma for 3D, a game engine, visual programming, and AI assistance.

- **Version:** 0.1.0
- **Type:** Private monorepo
- **Language:** TypeScript (strict mode, ES2022)
- **Runtime:** Node.js 20+

---

## Repository Status

- **Branch:** `arena/01a0295c-semantic-engine-structured-ai`
- **Head Commit:** `03e6df2` - "replace tool"
- **Recent Commits:** 4 commits visible
- **Working Tree:** Has uncommitted changes (`.agent/mcp.json` modified, some untracked files)

---

## Project Structure

### Root Configuration
- **Package Manager:** npm workspaces
- **Build System:** TypeScript composite projects
- **Testing:** Vitest
- **Linting:** ESLint with typescript-eslint

### Packages (15 core engine packages)

| Package | Description |
|---------|-------------|
| `engine-core` | ECS, World, Scene, Transform, Commands, Serialization |
| `engine-renderer` | WebGPU/WebGL2 renderer, Camera, Light, Mesh, Material |
| `engine-assets` | GLB/glTF parser and loader |
| `engine-runtime` | SceneRuntime, Systems, GLB import |
| `engine-physics` | Rapier physics integration |
| `engine-input` | Keyboard, Mouse, Touch, Gamepad input |
| `engine-animation` | Animation clips, controllers, state machines, blend trees |
| `engine-audio` | Web Audio API integration |
| `engine-blueprint` | Visual programming: graph model, editor, compiler, runtime |
| `engine-materials` | Material graph, shader generator, post-processing |
| `engine-particles` | Particle emitter, renderer, GPU particles |
| `engine-ai` | AI controller, navigation, behavior trees, perception |
| `engine-performance` | Performance manager, culling, LOD, instancing |
| `engine-workers` | Worker pool, frustum culling, LOD, instancing workers |
| `ai-assistant` | Scene/blueprint generation, structured operations |

### Applications (4 app shells)

| App | Description |
|-----|-------------|
| `apps/server` | Node.js + Fastify backend (PostgreSQL, Auth, S3, WebSocket) |
| `apps/desktop` | Electron desktop wrapper |
| `apps/desktop-tauri` | Tauri desktop wrapper |
| `apps/mobile` | Capacitor mobile wrapper |

---

## Key Features (All Marked Complete)

1. **ECS Architecture** - Entity/Component/System with hierarchy & queries
2. **Scene Graph** - Parent-child transforms, local/world matrices
3. **Renderer** - WebGPU + WebGL2 backends, PBR materials
4. **GLB Import** - glTF/GLB parser and scene import
5. **Transform Gizmos** - Translate/Rotate/Scale with snap
6. **Play Mode** - Snapshot-based runtime with pause/resume
7. **Physics** - Rapier integration, rigid bodies, colliders
8. **Input System** - Keyboard, Mouse, Touch, Gamepad, action mapping
9. **Animation** - Clips, controllers, state machines, blend trees, skeletal
10. **Audio** - Web Audio, spatial audio, 3D listener
11. **Blueprint (Visual Programming)** - Graph editor, compiler, runtime
12. **Material Graph** - Node-based material editing, shader generation
13. **Particle System** - CPU/GPU particles, emitters, renderers
14. **AI System** - Behavior trees, navigation, perception, blackboard
15. **AI Assistant** - Scene/blueprint generation, structured ops
16. **Backend Server** - Fastify, PostgreSQL, JWT/OAuth, S3, WebSocket
17. **Collaboration** - WebSocket, CRDT/OT, presence, multi-cursor
18. **Publishing** - PWA, Electron, Tauri, Capacitor wrappers
19. **Performance** - Web Workers, frustum culling, LOD, instancing

---

## Architecture

### Design Principles
1. **Modularity** - Each capability lives in its own package with a clear public API
2. **ECS (Entity-Component-System)** - The core architectural pattern for game objects
3. **Abstraction Layers** - Renderer, physics, and input are behind interfaces
4. **Local-First** - IndexedDB persistence with optional cloud sync
5. **Extensibility** - Plugin architecture for custom systems and components

### Layer Diagram
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

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (strict mode, ES2022) |
| Runtime | Node.js 20+ |
| Rendering | WebGPU (primary) + WebGL2 (fallback) |
| Physics | Rapier |
| Build | TypeScript composite projects |
| Testing | Vitest |
| Linting | ESLint with typescript-eslint |
| Backend | Fastify, PostgreSQL, Redis, MinIO/S3 |
| Desktop | Electron, Tauri |
| Mobile | Capacitor |

---

## Data Flow

```
User Input → InputManager → InputSystem
              ↓
Systems (Physics, Animation, AI, Blueprint) → World.update()
              ↓
    RenderSystem → Renderer → GPU
```

---

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

---

## Semantic Analysis (MCP Tools)

### Core ECS Symbols
- **World** class (`packages/engine-core/src/ecs/World.ts`):
  - AI Score: Importance 84, Hotness 64, Read Priority 79
  - 13 test files mapped
  - Public API: createEntity, destroyEntity, getEntity, hasEntity, addSystem, removeSystem, update, clear
  - Events: onEntityCreated, onEntityDestroyed

### Architecture Violations
- **1 Circular Dependency** detected (3-node cycle)
- No layer violations found

### Git Hotspots (High-Risk Files)
| File | Hotspot Score | Commits | Churn |
|------|---------------|---------|-------|
| `apps/desktop-tauri/src-tauri/icons/icon.svg` | 200 | 1 | 20 |
| `apps/desktop-tauri/src-tauri/src/main.rs` | 200 | 1 | 20 |
| `apps/desktop-tauri/src-tauri/Cargo.toml` | 160 | 1 | 20 |
| `apps/desktop-tauri/src-tauri/build.rs` | 160 | 1 | 20 |

---

## Quick Start Commands

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

---

## Documentation

- [README](docs/README.md) - Project overview
- [Architecture](docs/architecture.md) - Detailed architecture
- [API Reference](docs/api.md) - API documentation
- [Development Guide](docs/development.md) - Development guidelines

---

## License

Private — internal project.

---

*Report generated on 2026-08-22 with MCP Semantic analysis*