import { describe, it, expect, vi } from "vitest";
import { Plugin } from "../src/Plugin.js";
import {
  PluginRegistry,
  DependencyError,
  LifecycleError,
} from "../src/PluginRegistry.js";
import { PluginLifecycleState } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TestPlugin extends Plugin {
  readonly manifest;
  readonly events: string[] = [];

  constructor(
    id: string,
    deps?: string[],
    optDeps?: string[],
  ) {
    super();
    this.manifest = {
      id,
      name: `Test ${id}`,
      version: "1.0.0",
      dependencies: deps,
      optionalDependencies: optDeps,
    };
  }

  override init(): void {
    this.events.push("init");
  }
  override start(): void {
    this.events.push("start");
  }
  override stop(): void {
    this.events.push("stop");
  }
  override destroy(): void {
    this.events.push("destroy");
  }
}

class AsyncPlugin extends Plugin {
  readonly manifest;
  readonly events: string[] = [];

  constructor(id: string) {
    super();
    this.manifest = { id, name: `Async ${id}`, version: "1.0.0" };
  }

  override async init(): Promise<void> {
    await Promise.resolve();
    this.events.push("init");
  }

  override async start(): Promise<void> {
    await Promise.resolve();
    this.events.push("start");
  }

  override async stop(): Promise<void> {
    await Promise.resolve();
    this.events.push("stop");
  }

  override async destroy(): Promise<void> {
    await Promise.resolve();
    this.events.push("destroy");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PluginRegistry", () => {
  describe("register / unregister", () => {
    it("registers a plugin", () => {
      const registry = new PluginRegistry();
      const p = new TestPlugin("test");
      registry.register(p);
      expect(registry.has("test")).toBe(true);
      expect(registry.get("test")).toBe(p);
      expect(registry.size).toBe(1);
    });

    it("throws on duplicate id", () => {
      const registry = new PluginRegistry();
      registry.register(new TestPlugin("dup"));
      expect(() => registry.register(new TestPlugin("dup"))).toThrow(
        /already registered/,
      );
    });

    it("unregisters a plugin", () => {
      const registry = new PluginRegistry();
      registry.register(new TestPlugin("a"));
      registry.unregister("a");
      expect(registry.has("a")).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("registers multiple at once", () => {
      const registry = new PluginRegistry();
      registry.registerAll(
        new TestPlugin("a"),
        new TestPlugin("b"),
      );
      expect(registry.size).toBe(2);
    });
  });

  describe("dependency resolution", () => {
    it("resolves flat order with no dependencies", () => {
      const registry = new PluginRegistry();
      registry.register(new TestPlugin("a"), new TestPlugin("b"));
      const order = registry.resolve();
      expect(order).toContain("a");
      expect(order).toContain("b");
    });

    it("resolves a simple dependency chain", () => {
      const registry = new PluginRegistry();
      registry.register(
        new TestPlugin("leaf"),
        new TestPlugin("middle", ["leaf"]),
        new TestPlugin("root", ["middle"]),
      );
      const order = registry.resolve();
      expect(order.indexOf("leaf")).toBeLessThan(
        order.indexOf("middle"),
      );
      expect(order.indexOf("middle")).toBeLessThan(
        order.indexOf("root"),
      );
    });

    it("throws DependencyError on missing dependency", () => {
      const registry = new PluginRegistry();
      registry.register(new TestPlugin("a", ["nonexistent"]));
      expect(() => registry.resolve()).toThrow(DependencyError);
    });

    it("throws DependencyError on cycle", () => {
      const registry = new PluginRegistry();
      registry.register(
        new TestPlugin("a", ["b"]),
        new TestPlugin("b", ["a"]),
      );
      expect(() => registry.resolve()).toThrow(DependencyError);
    });

    it("resolves optional dependencies when present", () => {
      const registry = new PluginRegistry();
      registry.register(
        new TestPlugin("base"),
        new TestPlugin("user", undefined, ["base"]),
      );
      const order = registry.resolve();
      expect(order.indexOf("base")).toBeLessThan(
        order.indexOf("user"),
      );
    });

    it("skips optional dependencies when absent", () => {
      const registry = new PluginRegistry();
      registry.register(
        new TestPlugin("user", undefined, ["missing"]),
      );
      expect(() => registry.resolve()).not.toThrow();
    });

    it("returns dependency info", () => {
      const registry = new PluginRegistry();
      registry.register(
        new TestPlugin("a", ["missing"]),
      );
      const info = registry.getDependencyInfo("a");
      expect(info).toBeDefined();
      expect(info!.missing).toContain("missing");
    });
  });

  describe("lifecycle hooks", () => {
    it("calls init on all in dependency order", async () => {
      const registry = new PluginRegistry();
      const leaf = new TestPlugin("leaf");
      const root = new TestPlugin("root", ["leaf"]);
      registry.register(leaf, root);

      await registry.initAll();

      expect(leaf.events).toEqual(["init"]);
      expect(root.events).toEqual(["init"]);
      expect(registry.getState("leaf")).toBe(
        PluginLifecycleState.INITIALIZED,
      );
      expect(registry.getState("root")).toBe(
        PluginLifecycleState.INITIALIZED,
      );
    });

    it("calls start after init", async () => {
      const registry = new PluginRegistry();
      const p = new TestPlugin("p");
      registry.register(p);

      await registry.initAll();
      await registry.startAll();

      expect(p.events).toEqual(["init", "start"]);
      expect(registry.getState("p")).toBe(
        PluginLifecycleState.STARTED,
      );
    });

    it("calls stop in reverse order", async () => {
      const registry = new PluginRegistry();
      const leaf = new TestPlugin("leaf");
      const root = new TestPlugin("root", ["leaf"]);
      registry.register(leaf, root);

      await registry.initAll();
      await registry.startAll();
      await registry.stopAll();

      // root was started last, so stopped first
      expect(root.events).toEqual(["init", "start", "stop"]);
      expect(leaf.events).toEqual(["init", "start", "stop"]);
      expect(registry.getState("root")).toBe(
        PluginLifecycleState.STOPPED,
      );
      expect(registry.getState("leaf")).toBe(
        PluginLifecycleState.STOPPED,
      );
    });

    it("calls destroy in reverse order", async () => {
      const registry = new PluginRegistry();
      const leaf = new TestPlugin("leaf");
      const root = new TestPlugin("root", ["leaf"]);
      registry.register(leaf, root);

      await registry.initAll();
      await registry.startAll();
      await registry.stopAll();
      await registry.destroyAll();

      expect(root.events).toEqual([
        "init",
        "start",
        "stop",
        "destroy",
      ]);
      expect(leaf.events).toEqual([
        "init",
        "start",
        "stop",
        "destroy",
      ]);
      expect(registry.getState("leaf")).toBe(
        PluginLifecycleState.DESTROYED,
      );
    });

    it("handles async lifecycle hooks", async () => {
      const registry = new PluginRegistry();
      const p = new AsyncPlugin("async");
      registry.register(p);

      await registry.initAll();
      await registry.startAll();
      await registry.stopAll();
      await registry.destroyAll();

      expect(p.events).toEqual(["init", "start", "stop", "destroy"]);
    });

    it("throws LifecycleError when init fails", async () => {
      const registry = new PluginRegistry();
      const p = new (class extends Plugin {
        readonly manifest = {
          id: "bad",
          name: "bad",
          version: "1.0.0",
        };
        override init(): void {
          throw new Error("oops");
        }
      })();
      registry.register(p);
      await expect(registry.initAll()).rejects.toThrow(LifecycleError);
      expect(registry.getState("bad")).toBe(
        PluginLifecycleState.ERROR,
      );
    });

    it("throws LifecycleError when start fails", async () => {
      const registry = new PluginRegistry();
      const p = new (class extends Plugin {
        readonly manifest = {
          id: "bad",
          name: "bad",
          version: "1.0.0",
        };
        override start(): void {
          throw new Error("oops");
        }
      })();
      registry.register(p);
      await expect(registry.startAll()).rejects.toThrow(LifecycleError);
    });
  });

  describe("getState", () => {
    it("returns undefined for unknown plugin", () => {
      const registry = new PluginRegistry();
      expect(registry.getState("nope")).toBeUndefined();
    });

    it("returns CREATED after registration", () => {
      const registry = new PluginRegistry();
      registry.register(new TestPlugin("p"));
      expect(registry.getState("p")).toBe(
        PluginLifecycleState.CREATED,
      );
    });
  });

  describe("all()", () => {
    it("iterates all registered plugins", () => {
      const registry = new PluginRegistry();
      registry.registerAll(
        new TestPlugin("a"),
        new TestPlugin("b"),
      );
      const ids = [...registry.all()].map(
        (p) => p.manifest.id,
      );
      expect(ids).toEqual(expect.arrayContaining(["a", "b"]));
    });
  });
});
