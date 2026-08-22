import type { Vec4 } from "@web-engine/engine-core";

export type TextureUsage = "color" | "normalMap" | "emissive";

export interface TextureData {
  image: TexImageSource;
  usage: TextureUsage;
  srgb?: boolean;
  generateMipmaps?: boolean;
}

export interface MaterialParams {
  name?: string;
  baseColor?: Vec4;
  metallic?: number;
  roughness?: number;
  emissive?: Vec4;
  opacity?: number;
  textures?: Map<string, TextureData>;
}

export class Material {
  readonly id: string;
  name: string;
  baseColor: Vec4;
  metallic: number;
  roughness: number;
  emissive: Vec4;
  opacity: number;
  readonly textures = new Map<string, TextureData>();
  /** Optional JSON blob for the renderer backend to cache compiled state. */
  shaderKey: string;

  constructor(id: string, params: MaterialParams = {}) {
    this.id = id;
    this.name = params.name ?? "Material";
    this.baseColor = params.baseColor ?? [1, 1, 1, 1];
    this.metallic = params.metallic ?? 0;
    this.roughness = params.roughness ?? 0.8;
    this.emissive = params.emissive ?? [0, 0, 0, 1];
    this.opacity = params.opacity ?? 1;
    params.textures?.forEach((value, key) => this.textures.set(key, value));
    this.shaderKey = this.computeShaderKey();
  }

  private computeShaderKey(): string {
    const hasNormalMap = this.textures.has("normalMap");
    const hasEmissive = this.textures.has("emissive");
    const transparent = this.opacity < 1;
    return `${hasNormalMap ? "N" : ""}${hasEmissive ? "E" : ""}${transparent ? "T" : ""}${this.textures.has("baseColor") ? "B" : ""}`;
  }

  setTexture(usage: string, data: TextureData): void {
    this.textures.set(usage, data);
    this.shaderKey = this.computeShaderKey();
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      baseColor: [...this.baseColor],
      metallic: this.metallic,
      roughness: this.roughness,
      emissive: [...this.emissive],
      opacity: this.opacity,
    };
  }

  static fromJSON(id: string, data: Record<string, unknown>): Material {
    return new Material(id, {
      name: data["name"] as string | undefined,
      baseColor: data["baseColor"] as Vec4 | undefined,
      metallic: data["metallic"] as number | undefined,
      roughness: data["roughness"] as number | undefined,
      emissive: data["emissive"] as Vec4 | undefined,
      opacity: data["opacity"] as number | undefined,
    });
  }
}
