export interface PostProcessEffect {
  name: string;
  enabled: boolean;
  parameters: Record<string, any>;
}

class PostProcessingChain {
  private effects: PostProcessEffect[] = [];

  addEffect(effect: PostProcessEffect) {
    this.effects.push(effect);
  }

  removeEffect(name: string) {
    this.effects = this.effects.filter(e => e.name !== name);
  }

  getEffects(): PostProcessEffect[] {
    return [...this.effects];
  }

  process(inputTexture: WebGLTexture, outputFramebuffer: WebGLFramebuffer) {
    // Apply post-processing effects in sequence
    let currentInput = inputTexture;
    
    for (const effect of this.effects) {
      if (effect.enabled) {
        // Apply the effect using its shader
        this.applyEffect(effect, currentInput, outputFramebuffer);
        // Update currentInput for the next effect
        currentInput = outputFramebuffer as unknown as WebGLTexture;
      }
    }
  }

  private applyEffect(effect: PostProcessEffect, input: WebGLTexture, output: WebGLFramebuffer) {
    // Implementation for applying a post-process effect
    // This would typically involve binding shaders and rendering full-screen quads
  }
}

export { PostProcessingChain };