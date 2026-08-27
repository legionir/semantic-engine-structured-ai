export const SERVICE_WORKER_META = 'web-engine:service-worker';

/**
 * The service worker URL, when the host page opts in.
 *
 * `apps/server` generates the worker (`src/pwa/pwa.service.ts`) and serves it at
 * `/sw.js`. Registering it from the Vite dev server would cache unbundled
 * modules, so the client only registers what the page declares — the dev shell
 * ships no tag, `apps/server` serving `apps/web/dist` can add one.
 */
export function readServiceWorkerSrc(read: (name: string) => string | null): string | null {
  const value = (read(SERVICE_WORKER_META) ?? '').trim();
  return value === '' || value === 'off' || value === 'false' ? null : value;
}

export interface ServiceWorkerContainerLike {
  readonly controller?: unknown;
  register(scriptURL: string, options?: { scope?: string }): Promise<unknown>;
}

/** Returns true when a registration was attempted successfully. */
export async function registerServiceWorker(
  src: string | null,
  container: ServiceWorkerContainerLike | undefined,
  scope = '/'
): Promise<boolean> {
  if (!src || !container || typeof container.register !== 'function') return false;
  try {
    await container.register(src, { scope });
    return true;
  } catch {
    /* A refused registration (insecure context, blocked storage) must not stop
       the app from booting — the canvas is the product here. */
    return false;
  }
}
