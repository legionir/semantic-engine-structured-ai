export type PropertyType =
  | "number"
  | "string"
  | "boolean"
  | "enum"
  | "color"
  | "vector3"
  | "entityRef"
  | "array"
  | "object";

export interface PropertyOption {
  label: string;
  value: string;
}

export interface PropertyDescriptor {
  key: string;
  label: string;
  type: PropertyType;
  get: () => unknown;
  set: (value: unknown) => void;
  min?: number;
  max?: number;
  step?: number;
  options?: PropertyOption[];
}

export interface PropertyGroup {
  label: string;
  properties: PropertyDescriptor[];
}

export interface PropertyProvider {
  getProperties?(): PropertyGroup[];
}

export function getPropertyGroups(component: unknown): PropertyGroup[] | null {
  const provider = component as PropertyProvider;
  if (typeof provider?.getProperties === "function") {
    return provider.getProperties();
  }
  return null;
}

export function isPropertyProvider(value: unknown): boolean {
  return typeof (value as PropertyProvider)?.getProperties === "function";
}
