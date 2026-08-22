export interface Entity {
  readonly id: string;
  readonly world: World;
  readonly components: Map<string, Component>;
  name?: string;

  addComponent(component: Component): Component;
  removeComponent(type: string): void;
  getComponent<T extends Component>(type: string): T | undefined;
  hasComponent(type: string): boolean;
  destroy(): void;
}

export interface World {
  readonly size: number;
  readonly currentTime: number;

  createEntity(name?: string, id?: string): Entity;
  getEntity(id: string): Entity | undefined;
  hasEntity(id: string): boolean;
  destroyEntity(id: string): void;
  query<T extends Component>(type: string): T[];
  queryAll(...types: string[]): Entity[];
  addSystem(system: System): void;
  removeSystem(system: System): void;
  onEntityCreated(listener: (event: EntityCreatedEvent) => void): () => void;
  onEntityDestroyed(listener: (event: EntityDestroyedEvent) => void): () => void;
  update(deltaTime: number): void;
  clear(): void;
}

export interface Component {
  readonly type: string;
}

export interface System {
  readonly priority?: number;
  update(deltaTime: number, time: number): void;
}

export interface EntityCreatedEvent {
  entity: Entity;
}

export interface EntityDestroyedEvent {
  entity: Entity;
}
