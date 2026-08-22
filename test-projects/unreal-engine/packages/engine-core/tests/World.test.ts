import { describe, expect, it } from "vitest";
import { Scene } from "../src/scene/Scene.js";
import { TransformComponent } from "../src/transform/TransformComponent.js";
import { BaseComponent, type Entity, type System } from "../src/ecs/index.js";

class HealthComponent extends BaseComponent {
  override readonly type = "health";
  hp: number;
  constructor(entity: Entity, hp = 100) {
    super(entity);
    this.hp = hp;
  }
}

describe("World", () => {
  it("creates and destroys entities", () => {
    const scene = new Scene();
    const entity = scene.world.createEntity("Player");
    expect(scene.world.size).toBe(1);
    expect(scene.world.hasEntity(entity.id)).toBe(true);

    entity.destroy();
    expect(scene.world.size).toBe(0);
  });

  it("rejects duplicate component types", () => {
    const scene = new Scene();
    const entity = scene.world.createEntity();
    entity.addComponent(new TransformComponent(entity));
    expect(() => entity.addComponent(new TransformComponent(entity))).toThrow();
  });

  it("emits entity created/destroyed events", () => {
    const scene = new Scene();
    let created = 0;
    let destroyed = 0;
    scene.world.onEntityCreated(() => created++);
    scene.world.onEntityDestroyed(() => destroyed++);

    const entity = scene.world.createEntity();
    entity.destroy();
    expect(created).toBe(1);
    expect(destroyed).toBe(1);
  });

  it("queries entities by component presence", () => {
    const scene = new Scene();
    const withHealth = scene.world.createEntity("H");
    withHealth.addComponent(new HealthComponent(withHealth, 50));
    scene.world.createEntity("Plain");

    const matches = scene.world.queryAll("health");
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(withHealth.id);

    const components = scene.world.query<HealthComponent>("health");
    expect(components[0].hp).toBe(50);
  });

  it("runs systems in priority order with time", () => {
    const scene = new Scene();
    const order: string[] = [];
    const makeSystem = (name: string, priority: number): System => ({
      priority,
      update: () => order.push(name),
    });
    scene.world.addSystem(makeSystem("b", 20));
    scene.world.addSystem(makeSystem("a", 10));
    scene.world.addSystem(makeSystem("c", 30));

    scene.world.update(0.016);
    expect(order).toEqual(["a", "b", "c"]);
    expect(scene.world.currentTime).toBeCloseTo(0.016);
  });

  it("removes systems", () => {
    const scene = new Scene();
    const sys: System = { priority: 1, update: () => {} };
    scene.world.addSystem(sys);
    expect(scene.world.size).toBe(0);
    scene.world.removeSystem(sys);
    scene.world.update(0.1);
  });

  it("clears all entities", () => {
    const scene = new Scene();
    scene.world.createEntity();
    scene.world.createEntity();
    scene.clear();
    expect(scene.world.size).toBe(0);
  });

  it("calls onDestroy on components during entity destruction", () => {
    class DisposableComponent extends BaseComponent {
      override readonly type = "disposable";
      destroyed = false;
      override onDestroy(): void {
        this.destroyed = true;
      }
    }

    const scene = new Scene();
    const entity = scene.world.createEntity();
    const component = new DisposableComponent(entity);
    entity.addComponent(component);
    entity.destroy();
    expect(component.destroyed).toBe(true);
  });
});
