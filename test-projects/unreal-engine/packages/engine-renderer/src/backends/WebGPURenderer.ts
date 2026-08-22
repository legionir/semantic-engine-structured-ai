import type { Vec3 } from "@web-engine/engine-core";
import type { Camera } from "../Camera.js";
import type { Light } from "../Light.js";
import { LightType } from "../Light.js";
import type { Material } from "../Material.js";
import type { Mesh, MeshPrimitive } from "../Mesh.js";
import type { Renderable, Renderer, RendererInfo, RenderStats } from "../Renderer.js";

const MAX_LIGHTS = 8;

interface MeshBuffers {
  vertexBuffer: GPUBuffer;
  indexBuffer?: GPUBuffer;
  indexCount: number;
  indexFormat: GPUIndexFormat;
}

interface MaterialPipeline {
  pipeline: GPURenderPipeline;
  uniformBindGroup: GPUBindGroup;
  textureBindGroup: GPUBindGroup | null;
  buffer: GPUBuffer;
}

export class WebGPURenderer implements Renderer {
  readonly name = "WebGPURenderer";
  readonly kind = "webgpu";

  private canvas!: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format: GPUTextureFormat = "bgra8unorm";
  private readonly meshCache = new Map<string, MeshBuffers>();
  private readonly pipelineCache = new Map<string, MaterialPipeline>();
  private readonly textureCache = new Map<string, GPUTexture>();
  private readonly uniformBufferSize = 704;
  private width = 1;
  private height = 1;
  private uniformBindGroupLayout!: GPUBindGroupLayout;
  private textureBindGroupLayout!: GPUBindGroupLayout;
  private ready = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!("gpu" in navigator)) {
      throw new Error("WebGPU is not supported in this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No suitable WebGPU adapter found.");
    }
    this.device = await adapter.requestDevice();
    this.canvas = canvas;
    this.context = canvas.getContext("webgpu") as GPUCanvasContext;
    if (!this.context) {
      throw new Error("Could not acquire WebGPU canvas context.");
    }
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    this.uniformBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.textureBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        },
      ],
    });

    this.ready = true;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  createMeshResources(mesh: Mesh): void {
    mesh.primitives.forEach((primitive) => this.ensureMeshBuffers(primitive));
  }

  destroyMeshResources(mesh: Mesh): void {
    mesh.primitives.forEach((primitive) => {
      const key = primitiveKey(primitive);
      const buffers = this.meshCache.get(key);
      if (buffers) {
        buffers.vertexBuffer.destroy();
        buffers.indexBuffer?.destroy();
      }
      this.meshCache.delete(key);
    });
  }

  createMaterialResources(material: Material): void {
    if (!this.ready) return;
    this.getPipeline(material);
    material.textures.forEach((data, usage) => {
      if (!data.image) return;
      const key = `${material.id}:${usage}`;
      if (this.textureCache.has(key)) return;
      const texture = this.createTexture(data.image);
      this.textureCache.set(key, texture);
    });
  }

  destroyMaterialResources(material: Material): void {
    material.textures.forEach((_data, usage) => {
      const key = `${material.id}:${usage}`;
      const texture = this.textureCache.get(key);
      if (texture) texture.destroy();
      this.textureCache.delete(key);
    });
    const pipeline = this.pipelineCache.get(material.shaderKey);
    if (pipeline) {
      pipeline.buffer.destroy();
    }
    this.pipelineCache.delete(material.shaderKey);
  }

  render(renderables: Renderable[], camera: Camera, lights: Light[], clearColor: Vec3 = [0.1, 0.12, 0.16]): RenderStats {
    if (!this.ready) return { drawCalls: 0, triangles: 0, vertices: 0 };

    camera.updateProjectionMatrix(this.width / this.height);

    const filteredLights = lights.slice(0, MAX_LIGHTS);
    const uniforms = this.buildUniforms(renderables, camera, filteredLights);

    const encoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.getDepthTexture().createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    const stats: RenderStats = { drawCalls: 0, triangles: 0, vertices: 0 };
    const filteredRenderables = renderables.filter((r) => r.visible);

    for (const renderable of filteredRenderables) {
      const pipeline = this.getPipeline(renderable.material);
      renderPass.setPipeline(pipeline.pipeline);
      renderPass.setBindGroup(0, pipeline.uniformBindGroup);
      if (pipeline.textureBindGroup) {
        renderPass.setBindGroup(1, pipeline.textureBindGroup);
      }

      const model = uniforms.get(renderable.id);
      if (!model) continue;
      this.device.queue.writeBuffer(pipeline.buffer, 0, model);

      for (const primitive of renderable.mesh.primitives) {
        const buffers = this.ensureMeshBuffers(primitive);
        renderPass.setVertexBuffer(0, buffers.vertexBuffer);
        if (buffers.indexBuffer && buffers.indexCount > 0) {
          renderPass.setIndexBuffer(buffers.indexBuffer, buffers.indexFormat);
          renderPass.drawIndexed(buffers.indexCount);
          stats.triangles += buffers.indexCount / 3;
        } else {
          renderPass.draw(primitive.positions.length / 3);
          stats.triangles += primitive.positions.length / 3;
        }
        stats.drawCalls++;
        stats.vertices += primitive.positions.length / 3;
      }
    }

    renderPass.end();
    this.device.queue.submit([encoder.finish()]);
    return stats;
  }

  getInfo(): RendererInfo {
    return {
      name: this.name,
      renderer: "webgpu",
      capabilities: {
        maxTextureSize: this.ready ? (this.device.limits.maxTextureDimension2D as number) : 0,
        maxUniformBuffers: 8,
        webgl2: false,
        webgpu: true,
      },
    };
  }

  dispose(): void {
    this.meshCache.forEach((b) => {
      b.vertexBuffer.destroy();
      b.indexBuffer?.destroy();
    });
    this.meshCache.clear();
    this.pipelineCache.forEach((p) => p.buffer.destroy());
    this.pipelineCache.clear();
    this.textureCache.forEach((t) => t.destroy());
    this.textureCache.clear();
  }

  private getDepthTexture(): GPUTexture {
    const key = `depth:${this.width}x${this.height}`;
    const existing = this.textureCache.get(key);
    if (existing) return existing;
    const texture = this.device.createTexture({
      size: [this.width, this.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.textureCache.set(key, texture);
    return texture;
  }

  private buildUniforms(renderables: Renderable[], camera: Camera, lights: Light[]): Map<string, ArrayBuffer> {
    const result = new Map<string, ArrayBuffer>();
    const buffer = new ArrayBuffer(this.uniformBufferSize);
    const view = new DataView(buffer);
    const vec3 = (offset: number, value: Vec3) => {
      view.setFloat32(offset, value[0]);
      view.setFloat32(offset + 4, value[1]);
      view.setFloat32(offset + 8, value[2]);
    };

    const modelOffset = 0;
    const viewOffset = 64;
    const projectionOffset = 128;
    const cameraOffset = 192;
    const lightPositionsOffset = 208;
    const lightColorsOffset = 336;
    const lightDirectionsOffset = 464;
    const lightTypesOffset = 592;
    const lightIntensitiesOffset = 624;
    const lightCountOffset = 656;
    const metallicOffset = 660;
    const roughnessOffset = 664;

    for (const renderable of renderables) {
      new Float32Array(buffer, modelOffset, 16).set(renderable.worldMatrix);
      new Float32Array(buffer, viewOffset, 16).set(camera.getViewMatrix());
      new Float32Array(buffer, projectionOffset, 16).set(camera.getProjectionMatrix());
      vec3(cameraOffset, camera.getPosition());
      lights.forEach((light, i) => {
        vec3(lightPositionsOffset + i * 16, light.position);
        vec3(lightColorsOffset + i * 16, light.color);
        vec3(lightDirectionsOffset + i * 16, light.direction);
        view.setFloat32(lightTypesOffset + i * 4, light.type === LightType.Point ? 1 : light.type === LightType.Spot ? 2 : 0);
        view.setFloat32(lightIntensitiesOffset + i * 4, light.intensity);
      });
      view.setUint32(lightCountOffset, lights.length);
      view.setFloat32(metallicOffset, renderable.material.metallic);
      view.setFloat32(roughnessOffset, renderable.material.roughness);
      result.set(renderable.id, buffer.slice(0));
    }
    return result;
  }

  private getPipeline(material: Material): MaterialPipeline {
    const key = material.shaderKey;
    const cached = this.pipelineCache.get(key);
    if (cached) return cached;

    const buffer = this.device.createBuffer({
      size: this.uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const layout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformBindGroupLayout, this.textureBindGroupLayout],
    });

    const pipeline = this.device.createRenderPipeline({
      layout,
      vertex: {
        module: this.device.createShaderModule({ code: WGSL_VERTEX_SOURCE }),
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 32,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
              { shaderLocation: 2, offset: 24, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: {
        module: this.device.createShaderModule({ code: buildFragmentShader(material) }),
        entryPoint: "fs_main",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
      multisample: { count: 1 },
    });

    const pipelineEntry: MaterialPipeline = { pipeline, uniformBindGroup: this.createUniformBindGroup(buffer), textureBindGroup: this.createTextureBindGroup(material), buffer };
    this.pipelineCache.set(key, pipelineEntry);
    return pipelineEntry;
  }

  private createUniformBindGroup(buffer: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.uniformBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer } }],
    });
  }

  private createTextureBindGroup(material: Material): GPUBindGroup | null {
    const entries: GPUBindGroupEntry[] = [];
    const sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });

    const baseTexture = material.textures.has("baseColor") ? this.textureCache.get(`${material.id}:baseColor`) : undefined;
    const normalTexture = material.textures.has("normalMap") ? this.textureCache.get(`${material.id}:normalMap`) : undefined;

    if (baseTexture) {
      entries.push({ binding: 0, resource: baseTexture.createView() });
      entries.push({ binding: 1, resource: sampler });
    }
    if (normalTexture) {
      entries.push({ binding: 2, resource: normalTexture.createView() });
      entries.push({ binding: 3, resource: sampler });
    }

    if (entries.length === 0) return null;

    return this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries,
    });
  }

  private createTexture(image: TexImageSource): GPUTexture {
    const bitmap = image instanceof ImageBitmap ? image : null;
    let source: ImageBitmap | HTMLImageElement | HTMLCanvasElement = image as HTMLImageElement | HTMLCanvasElement;
    if (bitmap) source = bitmap;
    const width = bitmap ? bitmap.width : (image as HTMLImageElement).width || 1;
    const height = bitmap ? bitmap.height : (image as HTMLImageElement).height || 1;
    const texture = this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture },
      [width, height],
    );
    return texture;
  }

  private ensureMeshBuffers(primitive: MeshPrimitive): MeshBuffers {
    const key = primitiveKey(primitive);
    const existing = this.meshCache.get(key);
    if (existing) return existing;

    const interleaved = new Float32Array(primitive.positions.length + (primitive.normals?.length ?? 0) + (primitive.uvs?.length ?? 0));
    const stride = 8;
    const count = primitive.positions.length / 3;
    for (let i = 0; i < count; i++) {
      interleaved[i * stride] = primitive.positions[i * 3];
      interleaved[i * stride + 1] = primitive.positions[i * 3 + 1];
      interleaved[i * stride + 2] = primitive.positions[i * 3 + 2];
      interleaved[i * stride + 3] = primitive.normals?.[i * 3] ?? 0;
      interleaved[i * stride + 4] = primitive.normals?.[i * 3 + 1] ?? 0;
      interleaved[i * stride + 5] = primitive.normals?.[i * 3 + 2] ?? 0;
      interleaved[i * stride + 6] = primitive.uvs?.[i * 2] ?? 0;
      interleaved[i * stride + 7] = primitive.uvs?.[i * 2 + 1] ?? 0;
    }

    const vertexBuffer = this.device.createBuffer({
      size: interleaved.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(interleaved);
    vertexBuffer.unmap();

    let indexBuffer: GPUBuffer | undefined;
    let indexCount = 0;
    let indexFormat: GPUIndexFormat = "uint32";
    if (primitive.indices) {
      indexCount = primitive.indices.length;
      indexFormat = primitive.indices instanceof Uint32Array ? "uint32" : "uint16";
      indexBuffer = this.device.createBuffer({
        size: primitive.indices.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true,
      });
      new Uint8Array(indexBuffer.getMappedRange()).set(new Uint8Array(primitive.indices.buffer, primitive.indices.byteOffset, primitive.indices.byteLength));
      indexBuffer.unmap();
    }

    const buffers: MeshBuffers = { vertexBuffer, indexBuffer, indexCount, indexFormat };
    this.meshCache.set(key, buffers);
    return buffers;
  }
}

function primitiveKey(primitive: MeshPrimitive): string {
  const existing = (primitive as unknown as { __engineWgpuKey?: string }).__engineWgpuKey;
  if (existing) return existing;
  const key = `wgpu:${primitive.positions.byteOffset}:${primitive.positions.length}`;
  (primitive as unknown as { __engineWgpuKey?: string }).__engineWgpuKey = key;
  return key;
}

const WGSL_VERTEX_SOURCE = `
struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
};

struct Uniforms {
    model: mat4x4f,
    view: mat4x4f,
    projection: mat4x4f,
    cameraPosition: vec3f,
    lightPositions: array<vec3f, 8>,
    lightColors: array<vec3f, 8>,
    lightDirections: array<vec3f, 8>,
    lightTypes: array<f32, 8>,
    lightIntensities: array<f32, 8>,
    lightCount: u32,
    metallic: f32,
    roughness: f32,
};

struct VertexOutput {
    @builtin(position) clipPosition: vec4f,
    @location(0) worldPosition: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let worldPos = uniforms.model * vec4f(input.position, 1.0);
    output.worldPosition = worldPos.xyz;
    output.normal = (uniforms.model * vec4f(input.normal, 0.0)).xyz;
    output.uv = input.uv;
    output.clipPosition = uniforms.projection * uniforms.view * worldPos;
    return output;
}
`;

function buildFragmentShader(material: Material): string {
  const hasBaseColorTexture = material.textures.has("baseColor");
  const hasNormalMap = material.textures.has("normalMap");
  return `
struct Uniforms {
    model: mat4x4f,
    view: mat4x4f,
    projection: mat4x4f,
    cameraPosition: vec3f,
    lightPositions: array<vec3f, 8>,
    lightColors: array<vec3f, 8>,
    lightDirections: array<vec3f, 8>,
    lightTypes: array<f32, 8>,
    lightIntensities: array<f32, 8>,
    lightCount: u32,
    metallic: f32,
    roughness: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
${hasBaseColorTexture ? "@group(1) @binding(0) var baseColorTexture: texture_2d<f32>;\n@group(1) @binding(1) var baseColorSampler: sampler;" : ""}
${hasNormalMap ? "@group(1) @binding(2) var normalTexture: texture_2d<f32>;\n@group(1) @binding(3) var normalSampler: sampler;" : ""}

struct FragmentInput {
    @location(0) worldPosition: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
};

struct FragmentOutput {
    @location(0) color: vec4f,
};

fn tonemapACES(color: vec3f) -> vec3f {
    return clamp(color / (color + vec3f(1.0)), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_main(input: FragmentInput) -> FragmentOutput {
    var baseColor = vec3f(1.0, 1.0, 1.0);
    ${hasBaseColorTexture ? "baseColor = textureSample(baseColorTexture, baseColorSampler, input.uv).rgb;" : ""}
    var N = normalize(input.normal);
    ${hasNormalMap ? `let nTex = textureSample(normalTexture, normalSampler, input.uv).xyz * 2.0 - 1.0;
    N = normalize(N + nTex * 0.5);` : ""}
    let V = normalize(uniforms.cameraPosition - input.worldPosition);

    var diffuse = baseColor * 0.1;
    var specular = vec3f(0.0);

    for (var i = 0u; i < 8u; i = i + 1u) {
        if (i >= uniforms.lightCount) { break; }
        let type = uniforms.lightTypes[i];
        var L: vec3f;
        var attenuation = 1.0;
        if (type < 0.5) {
            L = normalize(-uniforms.lightDirections[i]);
        } else {
            let toLight = uniforms.lightPositions[i] - input.worldPosition;
            let dist = length(toLight);
            L = toLight / max(dist, 0.0001);
            attenuation = 1.0 / (1.0 + dist * dist);
        }
        let ndotl = max(dot(N, L), 0.0);
        let lightColor = uniforms.lightColors[i] * uniforms.lightIntensities[i] * attenuation;
        diffuse = diffuse + baseColor * lightColor * ndotl;

        let H = normalize(L + V);
        let spec = pow(max(dot(N, H), 0.0), 32.0);
        specular = specular + lightColor * spec * uniforms.metallic;
    }

    var color = diffuse + specular;
    color = tonemapACES(color);
    return FragmentOutput(color);
}
`;
}
