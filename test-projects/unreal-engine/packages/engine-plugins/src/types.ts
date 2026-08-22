/**
 * Plugin manifest — the metadata every plugin must provide.
 */
export interface PluginManifest {
  /** Globally unique plugin identifier (e.g. "@web-engine/plugin-stats"). */
  readonly id: string;

  /** Human-readable name. */
  readonly name: string;

  /** SemVer version string. */
  readonly version: string;

  /** Optional description. */
  readonly description?: string;

  /** Plugins that must be loaded before this one. */
  readonly dependencies?: readonly string[];

  /** Plugins that are loaded before this one if available, but not required. */
  readonly optionalDependencies?: readonly string[];

  /** Module path or identifier for the plugin entry point. */
  readonly main?: string;
}

/**
 * Lifecycle state of a plugin.
 */
export enum PluginLifecycleState {
  /** Created but not yet initialised. */
  CREATED = "created",
  /** init() has completed successfully. */
  INITIALIZED = "initialized",
  /** start() has completed successfully. */
  STARTED = "started",
  /** stop() has completed successfully. */
  STOPPED = "stopped",
  /** destroy() has completed, or the plugin failed to initialise. */
  DESTROYED = "destroyed",
  /** An error occurred during a lifecycle hook. */
  ERROR = "error",
}

/**
 * Dependency resolution result for a single plugin.
 */
export interface DependencyInfo {
  readonly id: string;
  readonly missing: readonly string[];
  readonly cycles: readonly string[][];
  readonly order: number;
}
