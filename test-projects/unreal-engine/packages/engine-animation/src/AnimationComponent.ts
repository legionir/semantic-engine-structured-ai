import { BaseComponent, type Entity } from "@web-engine/engine-core";
import { AnimationController } from "./AnimationController.js";

export class AnimationComponent extends BaseComponent {
  override readonly type = "animation";

  /** The animation controller that manages clip playback. */
  readonly controller: AnimationController;

  /** The currently active clip id (convenience reference). */
  currentClipId: string | null = null;

  /** Playback speed multiplier. */
  speed: number = 1;

  /** Whether the animation should loop. */
  loop: boolean = true;

  /** Whether the animation should start playing automatically. */
  autoPlay: boolean = false;

  constructor(entity: Entity, controller?: AnimationController) {
    super(entity);
    this.controller = controller ?? new AnimationController();
  }

  override onDestroy(): void {
    this.controller.stop();
  }
}
