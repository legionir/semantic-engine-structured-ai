import { WebGL2Renderer, WebGPURenderer, type Renderer, type RendererInfo } from '@web-engine/engine-renderer';
import type { RendererPreference } from '../../config';

export type RendererKind = 'webgpu' | 'webgl2';

/**
 * Everything this module needs from `navigator`.
 *
 * Typed structurally on purpose: `@webengine/web` must keep compiling (and be
 * unit-testable under a runner without a DOM) without pulling the WebGPU
 * globals into its own code.
 */
export interface NavigatorLike {
  readonly gpu?: { readonly requestAdapter?: unknown };
}

/** Does this environment expose a usable WebGPU entry point? */
export function hasWebGpu(navigatorLike: NavigatorLike | undefined): boolean {
  return typeof navigatorLike?.gpu?.requestAdapter === 'function';
}

/**
 * Decide which backend to try first.
 *
 * `auto` prefers WebGPU and degrades to WebGL2 — the engine's WebGL2 path is
 * the baseline every target (desktop, tauri, mobile shell) already renders
 * through, so falling back must never be an error.
 */
export function pickRendererKind(
  preference: RendererPreference,
  webgpuAvailable: boolean
): RendererKind {
  switch (preference) {
    case 'webgl2':
      return 'webgl2';
    case 'webgpu':
      return 'webgpu';
    default:
      return webgpuAvailable ? 'webgpu' : 'webgl2';
  }
}

/**
 * A failed WebGPU init is only retryable when the caller did not *ask* for
 * WebGPU explicitly. `renderer=webgpu` failing loudly is the whole point of the
 * preference.
 */
export function shouldFallBackToWebGL2(
  kind: RendererKind,
  preference: RendererPreference
): boolean {
  return kind === 'webgpu' && preference === 'auto';
}

export function createRenderer(kind: RendererKind): Renderer {
  return kind === 'webgpu' ? new WebGPURenderer() : new WebGL2Renderer({ antialias: true });
}

export function describeRenderer(info: RendererInfo | null): string {
  if (!info) return 'not initialized';
  const caps = info.capabilities.webgpu ? 'webgpu' : 'webgl2 only';
  return `${info.name} · ${info.renderer} · ${caps}`;
}
