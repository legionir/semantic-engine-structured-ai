import type { TouchPoint } from "./types.js";
import type { ActionName, ActionState, ActionBinding } from "./actions.js";

interface DeviceState {
  keys: Map<string, boolean>;
  justPressed: Map<string, boolean>;
  justReleased: Map<string, boolean>;
}

interface MouseState {
  buttons: Map<number, boolean>;
  justPressed: Map<number, boolean>;
  justReleased: Map<number, boolean>;
  position: [number, number];
  delta: [number, number];
  wheelDelta: number;
}

interface TouchState {
  points: TouchPoint[];
  justStarted: boolean;
  justEnded: boolean;
}

interface GamepadState {
  connected: boolean;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
  prevButtons: boolean[];
  justPressed: boolean[];
  justReleased: boolean[];
}

export class InputManager {
  private readonly keyboardState: DeviceState = {
    keys: new Map(),
    justPressed: new Map(),
    justReleased: new Map(),
  };

  private readonly mouseState: MouseState = {
    buttons: new Map(),
    justPressed: new Map(),
    justReleased: new Map(),
    position: [0, 0],
    delta: [0, 0],
    wheelDelta: 0,
  };

  private readonly touchState: TouchState = {
    points: [],
    justStarted: false,
    justEnded: false,
  };

  private readonly gamepadStates: GamepadState[] = [];

  private bindings: ActionBinding[] = [];
  private readonly actionStates = new Map<ActionName, ActionState>();

  constructor() {
    for (let i = 0; i < 4; i++) {
      this.gamepadStates.push({
        connected: false,
        axes: [],
        buttons: [],
        prevButtons: [],
        justPressed: [],
        justReleased: [],
      });
    }
  }

  // --- Keyboard ---

  isKeyDown(key: string): boolean {
    return this.keyboardState.keys.get(key) === true;
  }

  isKeyJustPressed(key: string): boolean {
    return this.keyboardState.justPressed.get(key) === true;
  }

  isKeyJustReleased(key: string): boolean {
    return this.keyboardState.justReleased.get(key) === true;
  }

  // --- Mouse ---

  isMouseButtonDown(button: number): boolean {
    return this.mouseState.buttons.get(button) === true;
  }

  isMouseButtonJustPressed(button: number): boolean {
    return this.mouseState.justPressed.get(button) === true;
  }

  isMouseButtonJustReleased(button: number): boolean {
    return this.mouseState.justReleased.get(button) === true;
  }

  getMousePosition(): [number, number] {
    return [this.mouseState.position[0], this.mouseState.position[1]];
  }

  getMouseDelta(): [number, number] {
    return [this.mouseState.delta[0], this.mouseState.delta[1]];
  }

  getScrollDelta(): number {
    return this.mouseState.wheelDelta;
  }

  // --- Touch ---

  getTouchPoints(): TouchPoint[] {
    return this.touchState.points;
  }

  isTouching(): boolean {
    return this.touchState.points.length > 0;
  }

  // --- Gamepad ---

  updateGamepads(): void {
    const gamepads = navigator.getGamepads();
    if (!gamepads) return;

    for (let i = 0; i < 4; i++) {
      const gp = gamepads[i];
      const state = this.gamepadStates[i];

      if (gp) {
        state.connected = true;

        // Update axes
        state.axes = [];
        for (let a = 0; a < gp.axes.length; a++) {
          state.axes.push(gp.axes[a]);
        }

        // Update buttons with justPressed/justReleased tracking
        state.justPressed = [];
        state.justReleased = [];
        for (let b = 0; b < gp.buttons.length; b++) {
          const wasPressed = state.prevButtons[b] ?? false;
          const isPressed = gp.buttons[b].pressed;
          state.justPressed.push(isPressed && !wasPressed);
          state.justReleased.push(!isPressed && wasPressed);
          state.buttons[b] = { pressed: isPressed, value: gp.buttons[b].value };
          state.prevButtons[b] = isPressed;
        }
      } else {
        state.connected = false;
        state.axes = [];
        state.buttons = [];
        state.prevButtons = [];
        state.justPressed = [];
        state.justReleased = [];
      }
    }
  }

  isGamepadConnected(index: number): boolean {
    return this.gamepadStates[index]?.connected === true;
  }

  isGamepadButtonDown(index: number, button: number): boolean {
    return this.gamepadStates[index]?.buttons[button]?.pressed === true;
  }

  isGamepadButtonJustPressed(index: number, button: number): boolean {
    return this.gamepadStates[index]?.justPressed[button] === true;
  }

  isGamepadButtonJustReleased(index: number, button: number): boolean {
    return this.gamepadStates[index]?.justReleased[button] === true;
  }

  getGamepadAxis(index: number, axis: number): number {
    return this.gamepadStates[index]?.axes[axis] ?? 0;
  }

  // --- DOM Event Handlers ---

  handleKeyDown(event: KeyboardEvent): void {
    const code = event.code;
    if (!this.keyboardState.keys.get(code)) {
      this.keyboardState.justPressed.set(code, true);
    }
    this.keyboardState.keys.set(code, true);
  }

  handleKeyUp(event: KeyboardEvent): void {
    const code = event.code;
    if (this.keyboardState.keys.get(code)) {
      this.keyboardState.justReleased.set(code, true);
    }
    this.keyboardState.keys.set(code, false);
  }

  handleMouseDown(event: MouseEvent): void {
    const button = event.button;
    if (!this.mouseState.buttons.get(button)) {
      this.mouseState.justPressed.set(button, true);
    }
    this.mouseState.buttons.set(button, true);
  }

  handleMouseUp(event: MouseEvent): void {
    const button = event.button;
    if (this.mouseState.buttons.get(button)) {
      this.mouseState.justReleased.set(button, true);
    }
    this.mouseState.buttons.set(button, false);
  }

  handleMouseMove(event: MouseEvent): void {
    const prevX = this.mouseState.position[0];
    const prevY = this.mouseState.position[1];
    this.mouseState.position = [event.clientX, event.clientY];
    this.mouseState.delta = [event.clientX - prevX, event.clientY - prevY];
  }

  handleWheel(event: WheelEvent): void {
    this.mouseState.wheelDelta += event.deltaY;
  }

  handleTouchStart(event: TouchEvent): void {
    this.touchState.justStarted = true;
    this.touchState.points = [];
    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i];
      this.touchState.points.push({
        id: touch.identifier,
        position: [touch.clientX, touch.clientY],
        radius: [touch.radiusX || 0, touch.radiusY || 0],
        force: touch.force || 0,
      });
    }
  }

  handleTouchMove(event: TouchEvent): void {
    this.touchState.points = [];
    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i];
      this.touchState.points.push({
        id: touch.identifier,
        position: [touch.clientX, touch.clientY],
        radius: [touch.radiusX || 0, touch.radiusY || 0],
        force: touch.force || 0,
      });
    }
  }

  handleTouchEnd(event: TouchEvent): void {
    this.touchState.justEnded = true;
    this.touchState.points = [];
    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i];
      this.touchState.points.push({
        id: touch.identifier,
        position: [touch.clientX, touch.clientY],
        radius: [touch.radiusX || 0, touch.radiusY || 0],
        force: touch.force || 0,
      });
    }
  }

  // --- Actions ---

  setBindings(bindings: ActionBinding[]): void {
    this.bindings = bindings;
  }

  getAction(name: ActionName): ActionState | undefined {
    return this.actionStates.get(name);
  }

  isActionPressed(name: ActionName): boolean {
    const state = this.actionStates.get(name);
    return state ? state.pressed || state.value > 0.5 : false;
  }

  isActionReleased(name: ActionName): boolean {
    const state = this.actionStates.get(name);
    return state ? state.released : false;
  }

  getActionValue(name: ActionName): number {
    return this.actionStates.get(name)?.value ?? 0;
  }

  /**
   * Update action states based on current device state and bindings.
   * Called once per frame before reading actions.
   */
  updateActions(): void {
    this.actionStates.clear();

    for (const binding of this.bindings) {
      const action = binding.action;
      let value = 0;
      let pressed = false;

      switch (binding.deviceType) {
        case "keyboard": {
          pressed = this.isKeyDown(binding.inputId);
          value = pressed ? 1 : 0;
          break;
        }
        case "mouse": {
          const buttonNum = parseInt(binding.inputId, 10);
          if (!isNaN(buttonNum)) {
            pressed = this.isMouseButtonDown(buttonNum);
            value = pressed ? 1 : 0;
          }
          break;
        }
        case "gamepad": {
          // binding.inputId format: "axis:0:1" or "button:0"
          const parts = binding.inputId.split(":");
          if (parts[0] === "axis" && parts.length >= 3) {
            const gpIndex = parseInt(parts[1], 10);
            const axisIndex = parseInt(parts[2], 10);
            const axisVal = this.getGamepadAxis(gpIndex, axisIndex);
            value = Math.abs(axisVal);
            pressed = Math.abs(axisVal) > 0.5;
          } else if (parts[0] === "button" && parts.length >= 2) {
            const gpIndex = parseInt(parts[1], 10);
            const btnIndex = parseInt(parts[2], 10);
            pressed = this.isGamepadButtonDown(gpIndex, btnIndex);
            value = pressed ? 1 : 0;
          }
          break;
        }
        case "touch": {
          pressed = this.isTouching();
          value = pressed ? 1 : 0;
          break;
        }
      }

      const existing = this.actionStates.get(action);
      if (existing) {
        existing.value = Math.max(existing.value, value);
        existing.pressed = existing.pressed || pressed;
      } else {
        this.actionStates.set(action, {
          name: action,
          value,
          pressed,
          released: false,
          timestamp: performance.now(),
        });
      }
    }

    // Calculate released state for each action
    // An action is "released" if it was pressed last frame but not pressed this frame
    // We track this via the justPressed/justReleased mechanism
    for (const [name, state] of this.actionStates) {
      // Check if any binding for this action has justReleased
      const actionBindings = this.bindings.filter((b) => b.action === name);
      for (const binding of actionBindings) {
        let released = false;
        switch (binding.deviceType) {
          case "keyboard":
            released = this.keyboardState.justReleased.get(binding.inputId) === true;
            break;
          case "mouse": {
            const btn = parseInt(binding.inputId, 10);
            if (!isNaN(btn)) released = this.mouseState.justReleased.get(btn) === true;
            break;
          }
          case "gamepad": {
            const parts = binding.inputId.split(":");
            if (parts[0] === "button" && parts.length >= 3) {
              const btnIndex = parseInt(parts[2], 10);
              released = this.isGamepadButtonJustReleased(parseInt(parts[1], 10), btnIndex);
            }
            break;
          }
        }
        if (released) {
          state.released = true;
          break;
        }
      }
    }
  }

  /**
   * Reset per-frame state (justPressed, justReleased, delta, wheelDelta).
   * Call at the end of each frame.
   */
  reset(): void {
    // Keyboard
    this.keyboardState.justPressed.clear();
    this.keyboardState.justReleased.clear();

    // Mouse
    this.mouseState.justPressed.clear();
    this.mouseState.justReleased.clear();
    this.mouseState.delta = [0, 0];
    this.mouseState.wheelDelta = 0;

    // Touch
    this.touchState.justStarted = false;
    this.touchState.justEnded = false;
  }

  /**
   * Connect DOM event listeners to the given element.
   * Returns a cleanup function that removes all listeners.
   */
  attachToElement(element: HTMLElement | Document): () => void {
    const keyDownHandler = this.handleKeyDown.bind(this);
    const keyUpHandler = this.handleKeyUp.bind(this);
    const mouseDownHandler = this.handleMouseDown.bind(this);
    const mouseUpHandler = this.handleMouseUp.bind(this);
    const mouseMoveHandler = this.handleMouseMove.bind(this);
    const wheelHandler = this.handleWheel.bind(this);
    const touchStartHandler = this.handleTouchStart.bind(this);
    const touchMoveHandler = this.handleTouchMove.bind(this);
    const touchEndHandler = this.handleTouchEnd.bind(this);

    element.addEventListener("keydown", keyDownHandler as EventListener);
    element.addEventListener("keyup", keyUpHandler as EventListener);
    element.addEventListener("mousedown", mouseDownHandler as EventListener);
    element.addEventListener("mouseup", mouseUpHandler as EventListener);
    element.addEventListener("mousemove", mouseMoveHandler as EventListener);
    element.addEventListener("wheel", wheelHandler as EventListener);
    element.addEventListener("touchstart", touchStartHandler as EventListener);
    element.addEventListener("touchmove", touchMoveHandler as EventListener);
    element.addEventListener("touchend", touchEndHandler as EventListener);

    return () => {
      element.removeEventListener("keydown", keyDownHandler as EventListener);
      element.removeEventListener("keyup", keyUpHandler as EventListener);
      element.removeEventListener("mousedown", mouseDownHandler as EventListener);
      element.removeEventListener("mouseup", mouseUpHandler as EventListener);
      element.removeEventListener("mousemove", mouseMoveHandler as EventListener);
      element.removeEventListener("wheel", wheelHandler as EventListener);
      element.removeEventListener("touchstart", touchStartHandler as EventListener);
      element.removeEventListener("touchmove", touchMoveHandler as EventListener);
      element.removeEventListener("touchend", touchEndHandler as EventListener);
    };
  }

  /**
   * Get default action bindings for a typical game configuration.
   */
  getDefaultBindings(): ActionBinding[] {
    return [
      { action: "MoveForward", deviceType: "keyboard", inputId: "KeyW" },
      { action: "MoveForward", deviceType: "gamepad", inputId: "axis:0:1" },
      { action: "MoveBackward", deviceType: "keyboard", inputId: "KeyS" },
      { action: "MoveBackward", deviceType: "gamepad", inputId: "axis:0:1" },
      { action: "Jump", deviceType: "keyboard", inputId: "Space" },
      { action: "Jump", deviceType: "gamepad", inputId: "button:0:0" },
      { action: "Attack", deviceType: "mouse", inputId: "0" },
      { action: "Attack", deviceType: "gamepad", inputId: "button:0:7" },
      { action: "Interact", deviceType: "keyboard", inputId: "KeyE" },
      { action: "Interact", deviceType: "gamepad", inputId: "button:0:2" },
    ];
  }
}
