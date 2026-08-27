import { describe, expect, it } from 'vitest';
import {
  describeRenderer,
  hasWebGpu,
  pickRendererKind,
  shouldFallBackToWebGL2,
} from '../src/app/engine/renderer-choice';

describe('hasWebGpu', () => {
  it('is false without a navigator or without the gpu entry point', () => {
    expect(hasWebGpu(undefined)).toBe(false);
    expect(hasWebGpu({})).toBe(false);
    expect(hasWebGpu({ gpu: {} })).toBe(false);
  });

  it('is true when requestAdapter can be called', () => {
    expect(hasWebGpu({ gpu: { requestAdapter: () => undefined } })).toBe(true);
  });
});

describe('pickRendererKind', () => {
  it('honours an explicit preference over availability', () => {
    expect(pickRendererKind('webgl2', true)).toBe('webgl2');
    /* Asking for WebGPU on a machine without it must fail loudly rather than
       silently render something else. */
    expect(pickRendererKind('webgpu', false)).toBe('webgpu');
  });

  it('prefers WebGPU under auto and degrades to WebGL2', () => {
    expect(pickRendererKind('auto', true)).toBe('webgpu');
    expect(pickRendererKind('auto', false)).toBe('webgl2');
  });
});

describe('shouldFallBackToWebGL2', () => {
  it('only retries on WebGL2 when nothing was asked for explicitly', () => {
    expect(shouldFallBackToWebGL2('webgpu', 'auto')).toBe(true);
    expect(shouldFallBackToWebGL2('webgpu', 'webgpu')).toBe(false);
    expect(shouldFallBackToWebGL2('webgl2', 'auto')).toBe(false);
  });
});

describe('describeRenderer', () => {
  it('says so when the backend never initialized', () => {
    expect(describeRenderer(null)).toBe('not initialized');
  });

  it('names the backend and the capability that was picked up', () => {
    expect(
      describeRenderer({
        name: 'WebGL2Renderer',
        renderer: 'webgl2',
        capabilities: { maxTextureSize: 4096, maxUniformBuffers: 4, webgl2: true, webgpu: false },
      })
    ).toBe('WebGL2Renderer · webgl2 · webgl2 only');
  });
});
