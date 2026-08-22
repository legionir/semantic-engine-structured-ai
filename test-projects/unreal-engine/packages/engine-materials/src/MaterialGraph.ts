import { Material } from './Material';

export interface MaterialNode {
  id: string;
  type: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
}

export interface MaterialEdge {
  fromNodeId: string;
  fromOutput: string;
  toNodeId: string;
  toInput: string;
}

export class MaterialGraph {
  public nodes: MaterialNode[] = [];
  public edges: MaterialEdge[] = [];
  public material: Material;

  constructor(material: Material) {
    this.material = material;
  }

  addNode(node: MaterialNode) {
    this.nodes.push(node);
  }

  addEdge(edge: MaterialEdge) {
    this.edges.push(edge);
  }

  generateShader(): string {
    // This method will traverse the graph and generate shader code
    // based on the connected nodes and their properties.
    // For now, we'll return a placeholder shader.
    
    let vertexShader = `#version 300 es\n\nin vec4 a_position;\nuniform mat4 u_worldViewProjection;\nout vec2 v_texCoord;\n\nvoid main() {\n  gl_Position = u_worldViewProjection * a_position;\n  v_texCoord = a_position.xy * 0.5 + 0.5;\n}`;
    
    let fragmentShader = `#version 300 es\n\nprecision highp float;\n\nin vec2 v_texCoord;\nout vec4 o_color;\n\nuniform vec3 u_albedo;\nuniform float u_metallic;\nuniform float u_roughness;\nuniform vec3 u_emissive;\nuniform float u_alpha;\n\nvoid main() {\n  // Simple PBR-like lighting calculation
  vec3 color = u_albedo * (1.0 - u_metallic) + u_emissive;
  color = mix(color, u_albedo, u_metallic);
  
  // Roughness affects specular highlight
  float specular = pow(max(0.0, dot(normalize(vec3(0.5, 0.5, 1.0)), normalize(vec3(0.0, 0.0, 1.0)))), 1.0 / (u_roughness + 0.001));
  color += specular * 0.5;
  
  o_color = vec4(color, u_alpha);
}`;
    
    return vertexShader + '\n' + fragmentShader;
  }
}