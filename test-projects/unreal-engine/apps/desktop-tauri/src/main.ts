import { invoke } from '@tauri-apps/api/tauri';
import { open, save } from '@tauri-apps/api/dialog';
import { readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/api/fs';
import { appDataDir, documentDir, downloadDir } from '@tauri-apps/api/path';

// Tauri API wrapper for the editor
const tauriAPI = {
  // File dialogs
  async openFileDialog(options?: { filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean }): Promise<string | string[] | null> {
    return await open({
      multiple: options?.multiple ?? false,
      filters: options?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    });
  },

  async saveFileDialog(options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> {
    return await save({
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });
  },

  // File system
  async readFile(path: string): Promise<string> {
    return await readTextFile(path);
  },

  async writeFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  },

  // Paths
  async getAppDataDir(): Promise<string> {
    return await appDataDir();
  },

  async getDocumentDir(): Promise<string> {
    return await documentDir();
  },

  async getDownloadDir(): Promise<string> {
    return await downloadDir();
  },

  // App info
  async getVersion(): Promise<string> {
    return await invoke('get_app_version');
  },
};

// Expose to window for use by the Angular editor
(window as any).__TAURI__ = tauriAPI;

export { tauriAPI };
