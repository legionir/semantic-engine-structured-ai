import type { Component, Entity } from "./types.js";

export abstract class BaseComponent implements Component {
  abstract readonly type: string;

  protected constructor(protected readonly owner: Entity) {}

  get entity(): Entity {
    return this.owner;
  }

  onDestroy?(): void;

  toJSON?(): unknown;
}
