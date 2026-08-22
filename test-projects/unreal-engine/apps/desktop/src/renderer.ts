// Electron renderer process entry point
// In production, this loads the Angular editor build output
// For development, it connects to the Angular dev server

export {}; // make this file a module so the global augmentation below is valid

console.log('[Web Engine] Electron renderer started');

// Load Angular editor in production mode
if (window.location.protocol === 'file:') {
  const script = document.createElement('script');
  script.src = 'editor/main.js';
  script.onload = () => console.log('[Web Engine] Editor loaded');
  script.onerror = (err) => console.error('[Web Engine] Failed to load editor:', err);
  document.head.appendChild(script);
}

// Expose Electron API type for TypeScript
// This is extended by preload.ts via contextBridge
declare global {
  interface Window {
    electronAPI?: {
      openFileDialog: (options: any) => Promise<any>;
      saveFileDialog: (options: any) => Promise<any>;
      getVersion: () => Promise<string>;
      getPaths: () => Promise<Record<string, string>>;
      onMenuNewProject: (cb: () => void) => () => void;
      onMenuOpenProject: (cb: () => void) => () => void;
      onMenuSave: (cb: () => void) => () => void;
      onMenuSaveAs: (cb: () => void) => () => void;
      onMenuExportBuild: (cb: () => void) => () => void;
      onMenuPlay: (cb: () => void) => () => void;
      onMenuStop: (cb: () => void) => () => void;
    };
  }
}
