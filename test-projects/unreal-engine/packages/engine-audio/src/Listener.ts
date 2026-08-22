/**
 * Listener represents the position and orientation of the audio listener
 * in the 3D scene. It wraps the Web Audio API AudioListener.
 */
export class Listener {
  /** Position in 3D space. */
  position: [number, number, number] = [0, 0, 0];

  /** Forward direction vector (must be normalised). */
  forward: [number, number, number] = [0, 0, -1];

  /** Up direction vector (must be normalised). */
  up: [number, number, number] = [0, 1, 0];

  constructor(private readonly listener: AudioListener) {}

  /** Update the Web Audio API listener from the current position/orientation. */
  update(): void {
    const { listener, position, forward, up } = this;
    listener.positionX.value = position[0];
    listener.positionY.value = position[1];
    listener.positionZ.value = position[2];
    listener.forwardX.value = forward[0];
    listener.forwardY.value = forward[1];
    listener.forwardZ.value = forward[2];
    listener.upX.value = up[0];
    listener.upY.value = up[1];
    listener.upZ.value = up[2];
  }

  /**
   * Set the position from a 3-component array.
   */
  setPosition(x: number, y: number, z: number): void {
    this.position = [x, y, z];
  }

  /**
   * Set the orientation from forward and up vectors.
   */
  setOrientation(
    forwardX: number, forwardY: number, forwardZ: number,
    upX: number, upY: number, upZ: number,
  ): void {
    this.forward = [forwardX, forwardY, forwardZ];
    this.up = [upX, upY, upZ];
  }

  /**
   * Convenience: point the listener towards a target position.
   */
  lookAt(targetX: number, targetY: number, targetZ: number): void {
    const dx = targetX - this.position[0];
    const dy = targetY - this.position[1];
    const dz = targetZ - this.position[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 0) {
      this.forward = [dx / len, dy / len, dz / len];
    }
  }
}
