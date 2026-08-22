# Development Guide

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
# Clone and install
npm install

# Verify TypeScript builds
npm run typecheck

# Run tests
npm test

# Lint
npm run lint
```

## Project Structure

```
.
├── package.json           # Root workspace config
├── tsconfig.base.json     # Shared TypeScript config
├── tsconfig.json          # Root references to all packages
├── eslint.config.mjs      # ESLint flat config
├── packages/              # Engine packages
│   ├── engine-core/       # ECS, scene, transforms, commands
│   ├── engine-renderer/   # WebGPU/WebGL2 renderer
│   ├── engine-assets/     # GLB/glTF loader
│   ├── engine-runtime/    # Scene runtime, game loop
│   ├── engine-physics/    # Physics (Rapier)
│   ├── engine-input/      # Input management
│   ├── engine-animation/  # Animation system
│   ├── engine-audio/      # Audio system
│   ├── engine-blueprint/  # Visual programming
│   ├── engine-materials/  # Material graph & shaders
│   ├── engine-particles/  # Particle system
│   ├── engine-ai/         # AI system
│   ├── engine-performance/ # Performance optimization
│   ├── engine-workers/    # Web Workers
│   └── ai-assistant/      # AI generation tools
├── apps/                  # Applications
│   ├── server/            # Backend server
│   ├── desktop/           # Electron wrapper
│   ├── desktop-tauri/     # Tauri wrapper
│   └── mobile/            # Capacitor wrapper
└── docs/                  # Documentation
```

## Package Conventions

### Package Structure

Each `packages/*` follows this convention:

```
package-name/
├── package.json          # name: @web-engine/package-name
├── tsconfig.json         # extends ../../tsconfig.base.json
├── vitest.config.ts      # (if tests exist)
├── src/
│   ├── index.ts          # Public API exports
│   └── ...               # Implementation files
├── tests/                # Test files
│   └── *.test.ts
└── __tests__/            # Alternative test directory
    └── *.test.ts
```

### TypeScript Configuration

- All packages use `tsconfig.base.json` with `strict: true`
- Module system: `NodeNext`
- Target: `ES2022`
- Composite projects for incremental builds
- All imports use `.js` extension (NodeNext convention)

### Adding a New Package

1. Create the directory under `packages/`
2. Create `package.json` with `@web-engine/name` scope
3. Create `tsconfig.json` extending `../../tsconfig.base.json`
4. Add `src/index.ts` with public exports
5. Add to root `tsconfig.json` references
6. Run `npm run typecheck` to verify

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Run specific package tests
npx vitest run packages/engine-core
```

### Test Framework

- **Vitest** — Test runner
- Tests are colocated in `tests/` or `__tests__/` directories
- File naming: `*.test.ts`

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/World';

describe('World', () => {
  it('creates entities', () => {
    const world = new World();
    const entity = world.createEntity();
    expect(entity).toBeDefined();
  });

  it('adds components', () => {
    const world = new World();
    const entity = world.createEntity();
    world.addComponent(entity, { type: 'transform', position: { x: 0, y: 0, z: 0 } });
    const component = world.getComponent(entity, 'transform');
    expect(component).toBeDefined();
  });
});
```

## Building

```bash
# Full TypeScript build
npm run typecheck

# Build specific package
cd packages/engine-core && npx tsc --build
```

## Linting

```bash
# ESLint
npm run lint

# ESLint config is in eslint.config.mjs (flat config)
# Uses typescript-eslint for type-aware linting
```

## Common Tasks

### Adding a New Component

```typescript
// packages/engine-core/src/components/MyComponent.ts
import { Component } from '../ecs/types';

export interface MyComponent extends Component {
  type: 'my_component';
  value: number;
}

// Export from index.ts
export * from './components/MyComponent';
```

### Adding a New System

```typescript
// packages/engine-runtime/src/systems/MySystem.ts
import { System, World } from '@web-engine/engine-core';

export class MySystem implements System {
  update(world: World, dt: number): void {
    const entities = world.query(['transform', 'my_component']);
    for (const entity of entities) {
      // Process entity
    }
  }
}
```

### Adding a New API Route (Server)

```typescript
// apps/server/src/routes/my.routes.ts
import { FastifyInstance } from 'fastify';

export function registerMyRoutes(server: FastifyInstance): void {
  server.get('/my-resource', async (request, reply) => {
    return { data: [] };
  });
}

// Register in routes.ts
import { registerMyRoutes } from './routes/my.routes';
// Inside registerRoutes:
registerMyRoutes(server);
```

## Architecture Decision Records

| Decision | Choice |
|----------|--------|
| Language | TypeScript with `strict: true` |
| Module | ES Modules (NodeNext) |
| Testing | Vitest |
| ECS | Custom ECS implementation |
| Physics | Rapier (abstracted behind interface) |
| Rendering | WebGPU + WebGL2 fallback |
| Backend | Fastify |
| Database | PostgreSQL |
| Cache | Redis |
| Storage | S3/MinIO |
| Auth | JWT + OAuth |
| Desktop | Electron + Tauri |
| Mobile | Capacitor |
| Collaboration | WebSocket + CRDT/OT |

## Code Style

- TypeScript with strict mode
- Prefer interfaces over type aliases for public APIs
- Use `.js` extension in imports (NodeNext convention)
- ESM modules (`"type": "module"`)
- PascalCase for classes and types
- camelCase for functions and variables
- UPPER_CASE for constants

## Debugging

- Use `console.log` for quick debugging
- Server uses Fastify logger (enabled in development)
- Tests run with Vitest (watch mode for TDD)

## Performance Considerations

- Use Web Workers for CPU-intensive operations (culling, instancing)
- GPU instancing for many objects with the same mesh
- LOD system for distant objects
- Frustum culling to skip off-screen objects
- IndexedDB for local caching
