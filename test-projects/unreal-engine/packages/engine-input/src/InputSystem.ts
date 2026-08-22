import { type World } from "@web-engine/engine-core";
import { InputManager } from "./InputManager.js";

export class InputSystem {
  readonly priority = 1;
  private readonly inputManager: InputManager;

  constructor(_world: World) {
    this.inputManager = new InputManager();
  }

  get manager(): InputManager {
    return this.inputManager;
  }

  update(_deltaTime: number, _time: number): void {
    // Update gamepad state before action updates
    this.inputManager.updateGamepads();
    this.inputManager.updateActions();
  }

  reset(): void {
    this.inputManager.reset();
  }

  /**
   * Connect DOM event listeners to the given element.
   */
  attachToElement(element: HTMLElement | Document): () => void {
    return this.inputManager.attachToElement(element);
  }

  /**
   * Setup default action bindings.
   */
  setupDefaultBindings(): void {
    this.inputManager.setBindings(this.inputManager.getDefaultBindings());
  }
}
