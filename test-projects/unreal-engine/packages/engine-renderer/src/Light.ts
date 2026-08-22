import type { Vec3 } from "@web-engine/engine-core";

export enum LightType {
  Directional = "directional",
  Point = "point",
  Spot = "spot",
  Ambient = "ambient",
}

export class Light {
  readonly id: string;
  name: string;
  type: LightType;
  color: Vec3;
  intensity: number;

  position: Vec3;
  direction: Vec3;
  range: number;
  innerConeAngle: number;
  outerConeAngle: number;
  castShadow: boolean;

  constructor(
    id: string,
    type: LightType,
    name = "Light",
    color: Vec3 = [1, 1, 1],
    intensity = 1,
  ) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.color = color;
    this.intensity = intensity;
    this.position = [0, 0, 0];
    this.direction = [0, -1, 0];
    this.range = 10;
    this.innerConeAngle = 0.3;
    this.outerConeAngle = 0.5;
    this.castShadow = false;
  }

  static directional(id: string, color: Vec3 = [1, 1, 1], intensity = 1): Light {
    return new Light(id, LightType.Directional, "Directional Light", color, intensity);
  }

  static point(id: string, color: Vec3 = [1, 1, 1], intensity = 1): Light {
    return new Light(id, LightType.Point, "Point Light", color, intensity);
  }

  static spot(id: string, color: Vec3 = [1, 1, 1], intensity = 1): Light {
    return new Light(id, LightType.Spot, "Spot Light", color, intensity);
  }

  static ambient(id: string, color: Vec3 = [1, 1, 1], intensity = 1): Light {
    return new Light(id, LightType.Ambient, "Ambient Light", color, intensity);
  }
}
