import type { Vec3 } from "@web-engine/engine-core";
import type { Camera } from "../Camera.js";
import type { Light } from "../Light.js";
import { LightType } from "../Light.js";
import type { Material } from "../Material.js";
import type { Mesh, MeshPrimitive } from "../Mesh.js";
import type { Renderable, Renderer, RendererInfo, RenderStats } from "../Renderer.js";

const MAX_LIGHTS = 8;

interface ProgramBinding {
  program: WebGLProgram;
  uModel: WebGLUniformLocation | null;
  uView: WebGLUniformLocation | null;
  uProjection: WebGLUniformLocation | null;
  uCameraPosition: WebGLUniformLocation | null;
  uMetallic: WebGLUniformLocation | null;
  uRoughness: WebGLUniformLocation | null;
  uLightPositions: WebGLUniformLocation | null;
  uLightColors: WebGLUniformLocation | null;
  uLightDirections: WebGLUniformLocation | null;
  uLightTypes: WebGLUniformLocation | null;
  uLightIntensities: WebGLUniformLocation | null;
  uLightCount: WebGLUniformLocation | null;
  uBaseColorTexture: WebGLUniformLocation | null;
  uNormalMap: WebGLUniformLocation | null;
}

export interface WebGL2RendererOptions {
  antialias?: boolean;
}

export class WebGL2Renderer implements Renderer {
  readonly name = "WebGL2Renderer";
  readonly kind = "webgl2";

  private canvas!: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private readonly vaoCache = new Map<string, WebGLVertexArrayObject>();
  private readonly programCache = new Map<string, ProgramBinding>();
  private readonly textureCache = new Map<string, WebGLTexture>();
  private readonly options: WebGL2RendererOptions;
  private width = 1;
  private height = 1;

  constructor(options: WebGL2RendererOptions = {}) {
    this.options = { antialias: true, ...options };
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: this.options.antialias,
      powerPreference: "high-performance",
    });
    if (!gl) {
      throw new Error("WebGL2 is not supported in this browser.");
    }
    this.gl = gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    if (this.gl) {
      this.gl.viewport(0, 0, this.width, this.height);
    }
  }

  createMeshResources(mesh: Mesh): void {
    mesh.primitives.forEach((primitive) => this.ensureVAO(primitive));
  }

  destroyMeshResources(mesh: Mesh): void {
    mesh.primitives.forEach((primitive) => {
      const key = primitiveKey(primitive);
      const vao = this.vaoCache.get(key);
      if (vao) this.gl.deleteVertexArray(vao);
      this.vaoCache.delete(key);
    });
  }

  createMaterialResources(material: Material): void {
    this.getProgram(material);
    material.textures.forEach((data, usage) => {
      if (!data.image) return;
      const key = `${material.id}:${usage}`;
      if (this.textureCache.has(key)) return;
      const texture = this.createTexture(data.image, data.generateMipmaps !== false);
      this.textureCache.set(key, texture);
    });
  }

  destroyMaterialResources(material: Material): void {
    material.textures.forEach((_data, usage) => {
      const key = `${material.id}:${usage}`;
      const texture = this.textureCache.get(key);
      if (texture) this.gl.deleteTexture(texture);
      this.textureCache.delete(key);
    });
    const binding = this.programCache.get(material.shaderKey);
    if (binding) this.gl.deleteProgram(binding.program);
    this.programCache.delete(material.shaderKey);
  }

  render(renderables: Renderable[], camera: Camera, lights: Light[], clearColor: Vec3 = [0.1, 0.12, 0.16]): RenderStats {
    const gl = this.gl;
    if (!gl) return { drawCalls: 0, triangles: 0, vertices: 0 };

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    camera.updateProjectionMatrix(this.width / this.height);

    const stats: RenderStats = { drawCalls: 0, triangles: 0, vertices: 0 };
    const filteredLights = lights.slice(0, MAX_LIGHTS);
    const positions = new Float32Array(filteredLights.length * 3);
    const colors = new Float32Array(filteredLights.length * 3);
    const directions = new Float32Array(filteredLights.length * 3);
    const types = new Float32Array(filteredLights.length);
    const intensities = new Float32Array(filteredLights.length);

    filteredLights.forEach((light, i) => {
      positions.set(light.position, i * 3);
      colors.set(light.color, i * 3);
      directions.set(light.direction, i * 3);
      types[i] = light.type === LightType.Point ? 1 : light.type === LightType.Spot ? 2 : 0;
      intensities[i] = light.intensity;
    });

    for (const renderable of renderables) {
      if (!renderable.visible) continue;
      const binding = this.getProgram(renderable.material);
      gl.useProgram(binding.program);
      this.bindUniforms(binding, renderable, camera, filteredLights, positions, colors, directions, types, intensities);

      for (const primitive of renderable.mesh.primitives) {
        const vao = this.ensureVAO(primitive);
        gl.bindVertexArray(vao);
        this.bindMaterialTextures(binding, renderable.material);
        if (primitive.indices) {
          const count = primitive.indices.length;
          gl.drawElements(gl.TRIANGLES, count, primitive.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
          stats.triangles += count / 3;
        } else {
          const count = primitive.positions.length / 3;
          gl.drawArrays(gl.TRIANGLES, 0, count);
          stats.triangles += count / 3;
        }
        stats.drawCalls++;
        stats.vertices += primitive.positions.length / 3;
      }
    }
    gl.bindVertexArray(null);

    return stats;
  }

  getInfo(): RendererInfo {
    const gl = this.gl;
    return {
      name: this.name,
      renderer: "webgl2",
      capabilities: {
        maxTextureSize: gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0,
        maxUniformBuffers: gl ? (gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number) : 0,
        webgl2: true,
        webgpu: false,
      },
    };
  }

  dispose(): void {
    this.programCache.forEach((b) => this.gl.deleteProgram(b.program));
    this.programCache.clear();
    this.vaoCache.forEach((vao) => this.gl.deleteVertexArray(vao));
    this.vaoCache.clear();
    this.textureCache.forEach((t) => this.gl.deleteTexture(t));
    this.textureCache.clear();
  }

  private createTexture(image: TexImageSource, generateMipmaps: boolean): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as HTMLImageElement | HTMLCanvasElement | ImageBitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (generateMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private bindMaterialTextures(binding: ProgramBinding, material: Material): void {
    const gl = this.gl;
    let unit = 0;
    const baseColorKey = `${material.id}:baseColor`;
    const normalMapKey = `${material.id}:normalMap`;
    const baseTexture = this.textureCache.get(baseColorKey);
    const normalTexture = this.textureCache.get(normalMapKey);

    if (baseTexture) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture);
      gl.uniform1i(binding.uBaseColorTexture, unit);
      unit++;
    }
    if (normalTexture) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, normalTexture);
      gl.uniform1i(binding.uNormalMap, unit);
    }
  }

  private bindUniforms(
    binding: ProgramBinding,
    renderable: Renderable,
    camera: Camera,
    lights: Light[],
    positions: Float32Array,
    colors: Float32Array,
    directions: Float32Array,
    types: Float32Array,
    intensities: Float32Array,
  ): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(binding.uModel, false, renderable.worldMatrix);
    gl.uniformMatrix4fv(binding.uView, false, camera.getViewMatrix());
    gl.uniformMatrix4fv(binding.uProjection, false, camera.getProjectionMatrix());
    gl.uniform3fv(binding.uCameraPosition, camera.getPosition());
    gl.uniform1f(binding.uMetallic, renderable.material.metallic);
    gl.uniform1f(binding.uRoughness, renderable.material.roughness);
    gl.uniform3fv(binding.uLightPositions, positions);
    gl.uniform3fv(binding.uLightColors, colors);
    gl.uniform3fv(binding.uLightDirections, directions);
    gl.uniform1fv(binding.uLightTypes, types);
    gl.uniform1fv(binding.uLightIntensities, intensities);
    gl.uniform1i(binding.uLightCount, lights.length);
  }

  private ensureVAO(primitive: MeshPrimitive): WebGLVertexArrayObject {
    const gl = this.gl;
    const key = primitiveKey(primitive);
    const existing = this.vaoCache.get(key);
    if (existing) return existing;

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, primitive.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    if (primitive.normals) {
      const normalBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, primitive.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    }

    if (primitive.uvs) {
      const uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, primitive.uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    }

    if (primitive.indices) {
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, primitive.indices, gl.STATIC_DRAW);
    }

    gl.bindVertexArray(null);
    this.vaoCache.set(key, vao);
    return vao;
  }

  private getProgram(material: Material): ProgramBinding {
    const key = material.shaderKey;
    const cached = this.programCache.get(key);
    if (cached) return cached;
    const binding = this.compileProgram(material);
    this.programCache.set(key, binding);
    return binding;
  }

  private compileProgram(material: Material): ProgramBinding {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, buildFragmentShader(material));
    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Failed to link shader program: ${info}`);
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return {
      program,
      uModel: gl.getUniformLocation(program, "uModel"),
      uView: gl.getUniformLocation(program, "uView"),
      uProjection: gl.getUniformLocation(program, "uProjection"),
      uCameraPosition: gl.getUniformLocation(program, "uCameraPosition"),
      uMetallic: gl.getUniformLocation(program, "uMetallic"),
      uRoughness: gl.getUniformLocation(program, "uRoughness"),
      uLightPositions: gl.getUniformLocation(program, "uLightPositions"),
      uLightColors: gl.getUniformLocation(program, "uLightColors"),
      uLightDirections: gl.getUniformLocation(program, "uLightDirections"),
      uLightTypes: gl.getUniformLocation(program, "uLightTypes"),
      uLightIntensities: gl.getUniformLocation(program, "uLightIntensities"),
      uLightCount: gl.getUniformLocation(program, "uLightCount"),
      uBaseColorTexture: gl.getUniformLocation(program, "uBaseColorTexture"),
      uNormalMap: gl.getUniformLocation(program, "uNormalMap"),
    };
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
  }
}

function primitiveKey(primitive: MeshPrimitive): string {
  const existing = (primitive as unknown as { __engineVaoKey?: string }).__engineVaoKey;
  if (existing) return existing;
  const key = `vao:${primitive.positions.byteOffset}:${primitive.positions.length}`;
  (primitive as unknown as { __engineVaoKey?: string }).__engineVaoKey = key;
  return key;
}

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUv;

void main() {
    vec4 worldPos = uModel * vec4(aPosition, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormal = mat3(uModel) * aNormal;
    vUv = aUv;
    gl_Position = uProjection * uView * worldPos;
}
`;

function buildFragmentShader(material: Material): string {
  const hasBaseColorTexture = material.textures.has("baseColor");
  const hasNormalMap = material.textures.has("normalMap");
  return `#version 300 es
precision highp float;

uniform vec3 uCameraPosition;
uniform vec3 uLightPositions[${MAX_LIGHTS}];
uniform vec3 uLightColors[${MAX_LIGHTS}];
uniform vec3 uLightDirections[${MAX_LIGHTS}];
uniform float uLightTypes[${MAX_LIGHTS}];
uniform float uLightIntensities[${MAX_LIGHTS}];
uniform int uLightCount;
uniform float uMetallic;
uniform float uRoughness;
${hasBaseColorTexture ? "uniform sampler2D uBaseColorTexture;" : ""}
${hasNormalMap ? "uniform sampler2D uNormalMap;" : ""}

in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vUv;

out vec4 outColor;

vec3 tonemapACES(vec3 color) {
    return clamp(color / (color + vec3(1.0)), 0.0, 1.0);
}

void main() {
    vec3 baseColor = vec3(1.0, 1.0, 1.0);
    ${hasBaseColorTexture ? "baseColor = texture(uBaseColorTexture, vUv).rgb;" : ""}
    vec3 N = normalize(vNormal);
    ${hasNormalMap ? `vec3 nTex = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
    N = normalize(N + nTex * 0.5);` : ""}
    vec3 V = normalize(uCameraPosition - vWorldPosition);

    vec3 diffuse = baseColor * 0.1;
    vec3 specular = vec3(0.0);

    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
        if (i >= uLightCount) break;
        float type = uLightTypes[i];
        vec3 L;
        float attenuation = 1.0;
        if (type < 0.5) {
            L = normalize(-uLightDirections[i]);
        } else {
            vec3 toLight = uLightPositions[i] - vWorldPosition;
            float dist = length(toLight);
            L = toLight / max(dist, 0.0001);
            attenuation = 1.0 / (1.0 + dist * dist);
        }
        float ndotl = max(dot(N, L), 0.0);
        vec3 lightColor = uLightColors[i] * uLightIntensities[i] * attenuation;
        diffuse += baseColor * lightColor * ndotl;

        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 32.0);
        specular += lightColor * spec * uMetallic;
    }

    vec3 color = diffuse + specular;
    color = tonemapACES(color);
    outColor = vec4(color, 1.0);
}
`;
}
