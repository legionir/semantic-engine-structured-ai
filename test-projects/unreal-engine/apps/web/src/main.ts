import { readConfigFromDocument } from './config';
import { collectElements, mountWebApp, type WebAppHandle } from './app/create-web-app';

/**
 * Web Engine — web client entry point.
 *
 * The mount point stays deliberately small: read the `<meta>` configuration,
 * find the canvas, hand both to {@link mountWebApp}. Everything else (renderer
 * choice, scene, HUD, presence, storage) lives behind that call so it can be
 * mounted by a test, an embedder, or the desktop shells without importing this
 * file.
 */
function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  if (!canvas) {
    throw new Error('apps/web: #viewport canvas not found — index.html was modified');
  }

  const config = readConfigFromDocument(document);
  const loading = document.querySelector<HTMLElement>('#loading-screen');
  const subtitle = loading?.querySelector('.sub');

  void mountWebApp({ config, elements: collectElements(document, canvas), document, window })
    .then((handle: WebAppHandle) => {
      /* Expose the running app for the console and for the desktop shells that
         embed this document (Electron's webview, Tauri's window). */
      (window as Window & { __WEB_ENGINE_APP__?: WebAppHandle }).__WEB_ENGINE_APP__ = handle;
      if (subtitle) subtitle.textContent = 'ready';
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (loading) {
        loading.dataset['done'] = 'false';
        if (subtitle) subtitle.textContent = message;
      }
      console.error('[Web Engine] web client failed to start:', error);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
