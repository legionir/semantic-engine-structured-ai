import { Shader } from './Shader';

export interface MaterialProperties {
  albedo?: [number, number, number];
  metallic?: number;
  roughness?: number;
  emissive?: [number, number, number];
  alpha?: number;
}

export class Material {
  public properties: MaterialProperties = {};
  public shader: Shader | null = null;

  constructor(properties: MaterialProperties = {}) {
    this.properties = { ...this.properties, ...properties };
  }

  setProperty(key: keyof MaterialProperties, value: any) {
    this.properties[key] = value;
  }

  getProperty(key: keyof MaterialProperties) {
    return this.properties[key];
  }

  bind() {
    // Bind material properties to shader uniforms
    if (this.shader) {
      Object.entries(this.properties).forEach(([key, value]) => {
        if (value !== undefined) {
          this.shader.setUniform(`u_${key}`, value);
        }
      });
    }
  }
}
