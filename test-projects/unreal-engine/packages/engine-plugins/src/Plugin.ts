import type { PluginManifest } from "./types.js";

/**
 * Abstract base class for all engine plugins.
 *
 * Subclasses must implement `manifest` and may override any lifecycle hook.
 */
export abstract class Plugin {
  /** The plugin manifest — must be provided by every subclass. */
  abstract readonly manifest: PluginManifest;

  /**
   * Called once after the plugin is constructed and registered, before any
   * dependency is resolved. Use this to set up internal structures that do
   * not depend on other plugins.
   */
  init(): void | Promise<void> {
    // optional hook
  }

  /**
   * Called after all dependencies have been started. Use this to begin
   * active work (e.g. spawning systems, attaching listeners).
   */
  start(): void | Promise<void> {
    // optional hook
  }

  /**
   * Called when the runtime is paused or the plugin is being deactivated.
   * Should suspend active work without releasing resources.
   */
  stop(): void | Promise<void> {
    // optional hook
  }

  /**
   * Called when the plugin is being permanently removed. Release all
   * resources, remove listeners, and clean up.
   */
  destroy(): void | Promise<void> {
    // optional hook
  }
}
