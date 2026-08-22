export type InputDeviceType = "keyboard" | "mouse" | "touch" | "gamepad";

export interface InputDevice {
  readonly type: InputDeviceType;
  readonly id: string;
  readonly name: string;
  enabled: boolean;
}

export interface Keyboard extends InputDevice {
  readonly type: "keyboard";
  readonly keys: Map<string, boolean>;
}

export interface Mouse extends InputDevice {
  readonly type: "mouse";
  readonly buttons: Map<string, boolean>;
  position: [number, number];
  wheelDelta: number;
}

export interface TouchPoint {
  id: number;
  position: [number, number];
  radius: [number, number];
  force: number;
}

export interface Touch extends InputDevice {
  readonly type: "touch";
  readonly points: TouchPoint[];
}

export interface GamepadAxis {
  value: number;
  timestamp: number;
}

export interface GamepadButton {
  pressed: boolean;
  value: number;
  timestamp: number;
}

export interface Gamepad extends InputDevice {
  readonly type: "gamepad";
  readonly axes: GamepadAxis[];
  readonly buttons: GamepadButton[];
  connected: boolean;
}
