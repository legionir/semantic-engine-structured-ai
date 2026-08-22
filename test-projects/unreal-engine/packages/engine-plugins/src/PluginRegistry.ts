import { Plugin } from "./Plugin.js";
import {
  type DependencyInfo,
  type PluginManifest,
  PluginLifecycleState,
} from "./types.js";

/**
 * Plugin registry — manages registration, dependency resolution, and
 * lifecycle orchestration of all plugins.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();
  private readonly states = new WeakMap<Plugin, PluginLifecycleState>();
  private resolutionOrder: readonly string[] | null = null;

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  /**
   * Register one or more plugins. Throws if a plugin with the same id already
   * exists.
   */
  register(...plugins: Plugin[]): this {
    for (const plugin of plugins) {
      const id = plugin.manifest.id;
      if (this.plugins.has(id)) {
        throw new Error(`Plugin "${id}" is already registered.`);
      }
      this.plugins.set(id, plugin);
      this.states.set(plugin, PluginLifecycleState.CREATED);
    }
    this.resolutionOrder = null; // invalidate cache
    return this;
  }

  /**
   * Register multiple plugins at once.
   */
  registerAll(...plugins: Plugin[]): this {
    for (const p of plugins) {
      this.register(p);
    }
    return this;
  }

  /**
   * Remove a plugin by id. Throws if the plugin is not registered.
   */
  unregister(id: string): this {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin "${id}" is not registered.`);
    }
    this.plugins.delete(id);
    this.states.delete(plugin);
    this.resolutionOrder = null;
    return this;
  }

  // --------------------------------------------------------------------------
  // Query
  // --------------------------------------------------------------------------

  /**
   * Get a registered plugin by id.
   */
  get<T extends Plugin = Plugin>(id: string): T | undefined {
    return this.plugins.get(id) as T | undefined;
  }

  /**
   * Check whether a plugin is registered.
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * All registered plugins, iterable.
   */
  all(): IterableIterator<Plugin> {
    return this.plugins.values();
  }

  /**
   * Number of registered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Get the current lifecycle state of a plugin.
   */
  getState(id: string): PluginLifecycleState | undefined {
    const plugin = this.plugins.get(id);
    if (!plugin) return undefined;
    return this.states.get(plugin);
  }

  // --------------------------------------------------------------------------
  // Dependency resolution (topological sort via Kahn's algorithm)
  // --------------------------------------------------------------------------

  /**
   * Resolve dependencies and return the ordered list of plugin ids.
   *
   * The result is cached until a plugin is registered or unregistered.
   *
   * Throws `DependencyError` when:
   *  - a required dependency is missing
   *  - a cycle is detected
   */
  resolve(): readonly string[] {
    if (this.resolutionOrder) return this.resolutionOrder;

    const allIds = new Set(this.plugins.keys());

    // Build adjacency: for each plugin, list the ids it depends on.
    const deps = new Map<string, string[]>();
    const revDeps = new Map<string, string[]>();

    for (const [id, plugin] of this.plugins) {
      const manifest = plugin.manifest;
      const required = [...(manifest.dependencies ?? [])];
      deps.set(id, required);

      for (const depId of required) {
        if (!revDeps.has(depId)) revDeps.set(depId, []);
        revDeps.get(depId)!.push(id);
      }

      // Optional deps: if present, add as dependency; otherwise skip.
      for (const optId of manifest.optionalDependencies ?? []) {
        if (this.plugins.has(optId)) {
          deps.get(id)!.push(optId);
          if (!revDeps.has(optId)) revDeps.set(optId, []);
          revDeps.get(optId)!.push(id);
        }
      }
    }

    // Gather missing dependencies.
    const missing: string[] = [];
    for (const [id, required] of deps) {
      for (const depId of required) {
        if (!allIds.has(depId)) {
          missing.push(`${id} -> ${depId}`);
        }
      }
    }
    if (missing.length > 0) {
      throw new DependencyError(
        `Missing required plugin(s): ${missing.join("; ")}`,
        missing,
        [],
      );
    }

    // Kahn's algorithm for topological sort.
    // inDeg[id] = number of dependencies id has (edges coming IN to id).
    const inDeg = new Map<string, number>();
    for (const id of allIds) {
      inDeg.set(id, 0);
    }
    for (const [id, required] of deps) {
      inDeg.set(id, required.length);
    }

    const queue: string[] = [];
    for (const id of allIds) {
      if (inDeg.get(id) === 0) {
        queue.push(id);
      }
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);

      const dependents = revDeps.get(id) ?? [];
      for (const depId of dependents) {
        const deg = inDeg.get(depId)! - 1;
        inDeg.set(depId, deg);
        if (deg === 0) {
          queue.push(depId);
        }
      }
    }

    // Cycle detection.
    if (order.length < allIds.size) {
      const unresolved = [...allIds].filter((id) => !order.includes(id));
      throw new DependencyError(
        `Dependency cycle detected among: ${unresolved.join(", ")}`,
        [],
        [unresolved],
      );
    }

    this.resolutionOrder = order;
    return order;
  }

  /**
   * Get dependency info for a single plugin (for diagnostics).
   */
  getDependencyInfo(id: string): DependencyInfo | undefined {
    const plugin = this.plugins.get(id);
    if (!plugin) return undefined;

    const manifest = plugin.manifest;
    const required = manifest.dependencies ?? [];
    const missing: string[] = [];
    for (const depId of required) {
      if (!this.plugins.has(depId)) missing.push(depId);
    }

    let order = -1;
    try {
      const resolved = this.resolve();
      order = resolved.indexOf(id);
    } catch {
      // cycle or missing
    }

    return {
      id,
      missing,
      cycles: [],
      order,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle orchestration
  // --------------------------------------------------------------------------

  /**
   * Call init() on every plugin in dependency order.
   */
  async initAll(): Promise<void> {
    const order = this.resolve();
    for (const id of order) {
      const plugin = this.plugins.get(id)!;
      const state = this.states.get(plugin)!;
      if (state !== PluginLifecycleState.CREATED) continue;
      try {
        await plugin.init();
        this.states.set(plugin, PluginLifecycleState.INITIALIZED);
      } catch (err) {
        this.states.set(plugin, PluginLifecycleState.ERROR);
        throw new LifecycleError(
          `Plugin "${id}" failed during init(): ${err}`,
          id,
          "init",
          err as Error,
        );
      }
    }
  }

  /**
   * Call start() on every plugin in dependency order.
   */
  async startAll(): Promise<void> {
    const order = this.resolve();
    for (const id of order) {
      const plugin = this.plugins.get(id)!;
      const state = this.states.get(plugin)!;
      if (state !== PluginLifecycleState.INITIALIZED) {
        // Allow calling startAll without initAll if the plugin's init was a no-op
        if (state === PluginLifecycleState.CREATED) {
          await plugin.init();
          this.states.set(plugin, PluginLifecycleState.INITIALIZED);
        } else {
          continue;
        }
      }
      try {
        await plugin.start();
        this.states.set(plugin, PluginLifecycleState.STARTED);
      } catch (err) {
        this.states.set(plugin, PluginLifecycleState.ERROR);
        throw new LifecycleError(
          `Plugin "${id}" failed during start(): ${err}`,
          id,
          "start",
          err as Error,
        );
      }
    }
  }

  /**
   * Call stop() on every plugin in reverse dependency order.
   */
  async stopAll(): Promise<void> {
    const order = [...this.resolve()].reverse();
    for (const id of order) {
      const plugin = this.plugins.get(id)!;
      const state = this.states.get(plugin)!;
      if (state !== PluginLifecycleState.STARTED) continue;
      try {
        await plugin.stop();
        this.states.set(plugin, PluginLifecycleState.STOPPED);
      } catch (err) {
        this.states.set(plugin, PluginLifecycleState.ERROR);
        throw new LifecycleError(
          `Plugin "${id}" failed during stop(): ${err}`,
          id,
          "stop",
          err as Error,
        );
      }
    }
  }

  /**
   * Call destroy() on every plugin in reverse dependency order.
   */
  async destroyAll(): Promise<void> {
    const order = [...this.resolve()].reverse();
    for (const id of order) {
      const plugin = this.plugins.get(id)!;
      const state = this.states.get(plugin)!;
      if (state === PluginLifecycleState.DESTROYED) continue;
      try {
        await plugin.destroy();
        this.states.set(plugin, PluginLifecycleState.DESTROYED);
      } catch (err) {
        this.states.set(plugin, PluginLifecycleState.ERROR);
        throw new LifecycleError(
          `Plugin "${id}" failed during destroy(): ${err}`,
          id,
          "destroy",
          err as Error,
        );
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Error types
// ----------------------------------------------------------------------------

/**
 * Thrown when a required dependency is missing or a cycle is detected.
 */
export class DependencyError extends Error {
  constructor(
    message: string,
    readonly missing: readonly string[],
    readonly cycles: readonly string[][],
  ) {
    super(message);
    this.name = "DependencyError";
  }
}

/**
 * Thrown when a lifecycle hook (init/start/stop/destroy) throws.
 */
export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly pluginId: string,
    readonly hook: "init" | "start" | "stop" | "destroy",
    readonly cause: Error,
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}
