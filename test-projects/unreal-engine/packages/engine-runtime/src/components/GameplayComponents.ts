import { BaseComponent, Quat, type Entity, type TransformComponent, type World } from "@web-engine/engine-core";

export class RotatingComponent extends BaseComponent {
  override readonly type = "rotating";
  speed: number;

  constructor(entity: Entity, speed = 30) {
    super(entity);
    this.speed = speed;
  }

  override toJSON(): Record<string, unknown> {
    return { speed: this.speed };
  }
}

export class RotationSystem {
  readonly priority = 20;

  constructor(private readonly world: World) {}

  update(deltaTime: number, _time: number): void {
    for (const component of this.world.query<RotatingComponent>("rotating")) {
      const transform = component.entity.getComponent<TransformComponent>("transform");
      if (!transform) continue;
      Quat.rotateY(transform.rotation, transform.rotation, (component.speed * deltaTime * Math.PI) / 180);
      transform.markDirty();
    }
  }
}
