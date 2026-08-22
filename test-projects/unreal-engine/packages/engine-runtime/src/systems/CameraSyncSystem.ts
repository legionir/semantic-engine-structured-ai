import { Quat, Vec3, type World } from "@web-engine/engine-core";
import type { TransformComponent } from "@web-engine/engine-core";
import type { CameraComponent } from "../components/CameraComponent.js";

const FORWARD = [0, 0, -1] as Vec3;

export class CameraSyncSystem {
  readonly priority = 5;

  constructor(private readonly world: World) {}

  update(_deltaTime: number): void {
    this.world.queryAll("camera").forEach((entity) => {
      const cameraComp = entity.getComponent<CameraComponent>("camera");
      const transform = entity.getComponent<TransformComponent>("transform");
      if (!cameraComp || !transform) return;

      const position = Vec3.create();
      transform.getWorldPosition(position);

      const quaternion = Quat.create() as Quat;
      transform.getWorldQuaternion(quaternion);
      const forward = Vec3.create();
      Vec3.transformQuat(forward, FORWARD, quaternion);
      const target = Vec3.create();
      Vec3.add(target, position, forward);

      cameraComp.camera.lookAt(position, target);
    });
  }
}
