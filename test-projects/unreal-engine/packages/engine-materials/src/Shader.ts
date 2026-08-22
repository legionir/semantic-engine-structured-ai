export class Shader {
  private vertexSource: string;
  private fragmentSource: string;
  private program: WebGLProgram | null = null;

  constructor(vertexSource: string, fragmentSource: string) {
    this.vertexSource = vertexSource;
    this.fragmentSource = fragmentSource;
  }

  compile(gl: WebGLRenderingContext) {
    const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, this.vertexSource);
    const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, this.fragmentSource);
    
    if (!vertexShader || !fragmentShader) {
      return false;
    }
    
    this.program = gl.createProgram();
    if (!this.program) {
      return false;
    }
    
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    const linked = gl.getProgramParameter(this.program, gl.LINK_STATUS);
    if (!linked) {
      console.error('Error linking program:', gl.getProgramInfoLog(this.program));
      gl.deleteProgram(this.program);
      this.program = null;
      return false;
    }
    
    return true;
  }

  private createShader(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) {
      return null;
    }
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) {
      console.error('Error compiling shader:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }

  setUniform(name: string, value: any) {
    // Placeholder for setting uniform values
    // Implementation will depend on WebGL context
  }

  use(gl: WebGLRenderingContext) {
    if (this.program) {
      gl.useProgram(this.program);
    }
  }
}
