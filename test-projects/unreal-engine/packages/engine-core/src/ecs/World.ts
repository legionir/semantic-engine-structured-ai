import { v4 as uuidv4 } from "uuid";
import type { Component, Entity, EntityCreatedEvent, EntityDestroyedEvent, System } from "./types.js";

export interface WorldOptions {
  onEntityCreated?: (event: EntityCreatedEvent) => void;
  onEntityDestroyed?: (event: EntityDestroyedEvent) => void;
}

export class World {
  private readonly entities = new Map<string, Entity>();
  private readonly systems: System[] = [];
  private readonly createdListeners = new Set<(event: EntityCreatedEvent) => void>();
  private readonly destroyedListeners = new Set<(event: EntityDestroyedEvent) => void>();
  private time = 0;

  constructor(private readonly options: WorldOptions = {}) {}

  get size(): number {
    return this.entities.size;
  }

  get currentTime(): number {
    return this.time;
  }

  createEntity(name?: string, id?: string): Entity {
    const entityId = id ?? uuidv4();
    const entity = new EntityImpl(entityId, this, name);
    this.entities.set(entityId, entity);
    const event: EntityCreatedEvent = { entity };
    this.options.onEntityCreated?.(event);
    this.createdListeners.forEach((l) => l(event));
    return entity;
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  hasEntity(id: string): boolean {
    return this.entities.has(id);
  }

  destroyEntity(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;

    entity.components.forEach((component) => {
      const disposable = component as Component & { onDestroy?(): void };
      disposable.onDestroy?.();
    });
    entity.components.clear();
    this.entities.delete(id);

    const event: EntityDestroyedEvent = { entity };
    this.options.onEntityDestroyed?.(event);
    this.destroyedListeners.forEach((l) => l(event));
  }

  query<T extends Component>(type: string): T[] {
    const result: T[] = [];
    this.entities.forEach((entity) => {
      const component = entity.getComponent<T>(type);
      if (component) result.push(component);
    });
    return result;
  }

  queryAll(...types: string[]): Entity[] {
    const result: Entity[] = [];
    this.entities.forEach((entity) => {
      const matches = types.every((t) => entity.hasComponent(t));
      if (matches) result.push(entity);
    });
    return result;
  }

  addSystem(system: System): void {
    this.systems.push(system);
    this.systems.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  removeSystem(system: System): void {
    const index = this.systems.indexOf(system);
    if (index >= 0) this.systems.splice(index, 1);
  }

  onEntityCreated(listener: (event: EntityCreatedEvent) => void): () => void {
    this.createdListeners.add(listener);
    return () => this.createdListeners.delete(listener);
  }

  onEntityDestroyed(listener: (event: EntityDestroyedEvent) => void): () => void {
    this.destroyedListeners.add(listener);
    return () => this.destroyedListeners.delete(listener);
  }

  update(deltaTime: number): void {
    this.time += deltaTime;
    for (const system of this.systems) {
      system.update(deltaTime, this.time);
    }
  }

  clear(): void {
    [...this.entities.keys()].forEach((id) => this.destroyEntity(id));
  }
}

class EntityImpl implements Entity {
  readonly id: string;
  readonly components = new Map<string, Component>();
  readonly world: World;
  name?: string;

  constructor(id: string, world: World, name?: string) {
    this.id = id;
    this.world = world;
    this.name = name;
  }

  addComponent(component: Component): Component {
    if (this.components.has(component.type)) {
      throw new Error(`Entity ${this.id} already has a component of type "${component.type}"`);
    }
    this.components.set(component.type, component);
    return component;
  }

  removeComponent(type: string): void {
    this.components.delete(type);
  }

  getComponent<T extends Component>(type: string): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  hasComponent(type: string): boolean {
    return this.components.has(type);
  }

  destroy(): void {
    this.world.destroyEntity(this.id);
  }
}
