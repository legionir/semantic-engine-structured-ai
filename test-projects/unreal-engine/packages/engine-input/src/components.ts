import { BaseComponent, type Entity } from "@web-engine/engine-core";
import type { ActionBinding } from "./actions.js";

export class InputBindingsComponent extends BaseComponent {
  override readonly type = "inputBindings";
  bindings: ActionBinding[];

  constructor(entity: Entity, bindings: ActionBinding[] = []) {
    super(entity);
    this.bindings = bindings;
  }

  override toJSON(): unknown {
    return { bindings: this.bindings };
  }
}
