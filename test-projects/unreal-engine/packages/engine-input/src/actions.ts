import type { InputDeviceType } from "./types.js";

export type ActionName =
  | "MoveForward"
  | "MoveBackward"
  | "Jump"
  | "Attack"
  | "Interact";

export interface ActionState {
  name: ActionName;
  value: number;
  pressed: boolean;
  released: boolean;
  timestamp: number;
}

export interface ActionBinding {
  action: ActionName;
  deviceType: InputDeviceType;
  inputId: string;
}
