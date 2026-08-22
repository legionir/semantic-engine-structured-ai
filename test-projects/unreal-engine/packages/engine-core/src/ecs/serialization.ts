import type { Component, Entity } from "./types.js";

export interface ComponentSnapshot {
  type: string;
  data: Record<string, unknown>;
}

export interface EntitySnapshot {
  id: string;
  name?: string;
  components: ComponentSnapshot[];
}

export function serializeEntity(entity: Entity): EntitySnapshot {
  const components: ComponentSnapshot[] = [];
  entity.components.forEach((component) => {
    const serializable = component as Component & { toJSON?(): Record<string, unknown> };
    if (typeof serializable.toJSON === "function") {
      components.push({ type: component.type, data: serializable.toJSON() });
    }
  });
  return {
    id: entity.id,
    name: entity.name,
    components,
  };
}
