import { describe, it, expect, vi } from "vitest";
import {
  Scene,
  CommandManager,
  CreateEntityCommand,
  DeleteEntityCommand,
  TransformCommand,
  AddComponentCommand,
  RemoveComponentCommand,
  ChangePropertyCommand,
  RenameEntityCommand,
  DuplicateEntityCommand,
  BaseComponent,
  type ComponentFactory,
  type Entity,
} from "../src/index.js";

class TagComponent extends BaseComponent {
  override readonly type = "tag";
  label: string;

  constructor(entity: Entity, label = "tag") {
    super(entity);
    this.label = label;
  }

  override toJSON(): Record<string, unknown> {
    return { label: this.label };
  }
}

const tagFactory: ComponentFactory = (entity, data) => {
  entity.addComponent(new TagComponent(entity, data["label"] as string | undefined));
};

describe("CommandManager", () => {
  it("executes commands onto the undo stack", () => {
    const manager = new CommandManager();
    const command = { execute: vi.fn(), undo: vi.fn(), redo: vi.fn() };
    manager.execute(command);
    expect(command.execute).toHaveBeenCalledTimes(1);
    expect(manager.canUndo).toBe(true);
    expect(manager.canRedo).toBe(false);
  });

  it("undo/redo moves between stacks", () => {
    const manager = new CommandManager();
    const command = { execute: vi.fn(), undo: vi.fn(), redo: vi.fn() };
    manager.execute(command);
    manager.undo();
    expect(command.undo).toHaveBeenCalledTimes(1);
    expect(manager.canUndo).toBe(false);
    expect(manager.canRedo).toBe(true);
    manager.redo();
    expect(command.redo).toHaveBeenCalledTimes(1);
    expect(manager.canUndo).toBe(true);
    expect(manager.canRedo).toBe(false);
  });

  it("clears the redo stack on a new command", () => {
    const manager = new CommandManager();
    const first = { execute: vi.fn(), undo: vi.fn(), redo: vi.fn() };
    const second = { execute: vi.fn(), undo: vi.fn(), redo: vi.fn() };
    manager.execute(first);
    manager.undo();
    manager.execute(second);
    expect(manager.canRedo).toBe(false);
  });

  it("limits the undo stack size", () => {
    const manager = new CommandManager(2);
    for (let i = 0; i < 5; i++) {
      manager.execute({ execute: vi.fn(), undo: vi.fn(), redo: vi.fn() });
    }
    expect(manager.undoCount).toBe(2);
  });

  it("notifies listeners on change", () => {
    const manager = new CommandManager();
    const listener = vi.fn();
    manager.onChange(listener);
    manager.execute({ execute: vi.fn(), undo: vi.fn(), redo: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("CreateEntityCommand", () => {
  it("creates and destroys the entity with undo/redo", () => {
    const scene = new Scene();
    const command = new CreateEntityCommand(scene, "Thing");

    command.execute();
    expect(scene.world.size).toBe(1);

    command.undo();
    expect(scene.world.size).toBe(0);

    command.redo();
    expect(scene.world.size).toBe(1);
    expect(scene.world.queryAll("transform")[0].name).toBe("Thing");
  });

  it("keeps the same id across redo", () => {
    const scene = new Scene();
    const command = new CreateEntityCommand(scene, "Thing");
    command.execute();
    const firstId = scene.world.queryAll("transform")[0].id;
    command.undo();
    command.redo();
    expect(scene.world.queryAll("transform")[0].id).toBe(firstId);
  });
});

describe("DeleteEntityCommand", () => {
  it("restores the entity with components and hierarchy on undo", () => {
    const scene = new Scene();
    const parent = scene.createEntity("Parent");
    parent.addComponent(new TagComponent(parent, "root"));
    const child = scene.createEntity("Child", parent);
    child.addComponent(new TagComponent(child, "leaf"));

    const factories = new Map<string, ComponentFactory>([["tag", tagFactory]]);
    const command = new DeleteEntityCommand(scene, parent.id, factories);

    command.execute();
    expect(scene.world.size).toBe(0);

    command.undo();
    expect(scene.world.size).toBe(2);
    const restoredParent = scene.world.getEntity(parent.id)!;
    const restoredChild = scene.world.getEntity(child.id)!;
    expect(restoredParent.name).toBe("Parent");
    expect(restoredParent.getComponent<TagComponent>("tag")!.label).toBe("root");
    expect(restoredChild.name).toBe("Child");
    expect(restoredChild.getComponent<TagComponent>("tag")!.label).toBe("leaf");

    const childTransform = restoredChild.getComponent("transform")!;
    expect(childTransform.getParentId()).toBe(parent.id);

    command.redo();
    expect(scene.world.size).toBe(0);
  });
});

describe("TransformCommand", () => {
  it("moves between before and after snapshots", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Cube");

    const command = new TransformCommand(scene, entity.id, {
      before: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      after: { position: [5, 2, -1], rotation: [0, 0, 0, 1], scale: [2, 2, 2] },
    });

    command.execute();
    const transform = entity.getComponent("transform")!;
    expect(transform.position[0]).toBe(5);
    expect(transform.scale[0]).toBe(2);

    command.undo();
    expect(transform.position[0]).toBe(0);
    expect(transform.scale[0]).toBe(1);

    command.redo();
    expect(transform.position[1]).toBe(2);
  });
});

describe("AddComponentCommand", () => {
  it("adds and removes a component", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Thing");

    const command = new AddComponentCommand(scene, entity.id, (e) => new TagComponent(e, "added"));
    command.execute();
    expect(entity.hasComponent("tag")).toBe(true);

    command.undo();
    expect(entity.hasComponent("tag")).toBe(false);

    command.redo();
    expect(entity.getComponent<TagComponent>("tag")!.label).toBe("added");
  });
});

describe("RemoveComponentCommand", () => {
  it("removes and restores a component", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Thing");
    entity.addComponent(new TagComponent(entity, "keep"));
    const factories = new Map<string, ComponentFactory>([["tag", tagFactory]]);

    const command = new RemoveComponentCommand(scene, entity.id, "tag", factories);
    command.execute();
    expect(entity.hasComponent("tag")).toBe(false);

    command.undo();
    expect(entity.getComponent<TagComponent>("tag")!.label).toBe("keep");

    command.redo();
    expect(entity.hasComponent("tag")).toBe(false);
  });
});

describe("ChangePropertyCommand", () => {
  it("applies old and new values", () => {
    let value = 1;
    const set = (next: number): void => {
      value = next;
    };

    const command = new ChangePropertyCommand(set, 1, 7);
    command.execute();
    expect(value).toBe(7);
    command.undo();
    expect(value).toBe(1);
    command.redo();
    expect(value).toBe(7);
  });
});

describe("RenameEntityCommand", () => {
  it("renames the entity and restores on undo", () => {
    const scene = new Scene();
    const entity = scene.createEntity("Old");

    const command = new RenameEntityCommand(scene, entity.id, "New");
    command.execute();
    expect(entity.name).toBe("New");

    command.undo();
    expect(entity.name).toBe("Old");

    command.redo();
    expect(entity.name).toBe("New");
  });
});

describe("DuplicateEntityCommand", () => {
  it("duplicates an entity subtree under the same parent", () => {
    const scene = new Scene();
    const parent = scene.createEntity("Parent");
    const child = scene.createEntity("Child", parent);
    child.getComponent("transform")!.setPosition(1, 2, 3);

    const command = new DuplicateEntityCommand(scene, parent.id);
    command.execute();

    expect(scene.world.size).toBe(4);
    const clones = scene.world.queryAll("transform").filter((e) => e.name === "Parent Copy");
    expect(clones).toHaveLength(1);
    const clone = clones[0];
    expect(clone.getComponent("transform")!.getParentId()).toBeUndefined();

    const cloneChild = scene.world.queryAll("transform").find((e) => e.name === "Child" && e.id !== child.id)!;
    expect(cloneChild.getComponent("transform")!.getParentId()).toBe(clone.id);
    expect(cloneChild.getComponent("transform")!.position[0]).toBe(1);

    command.undo();
    expect(scene.world.size).toBe(2);

    command.redo();
    expect(scene.world.size).toBe(4);
  });
});
