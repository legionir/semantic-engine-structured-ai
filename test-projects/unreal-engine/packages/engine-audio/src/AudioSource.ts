import type { AudioClip } from "./AudioClip.js";

/**
 * AudioSource manages playback of an AudioClip with volume, pitch, loop
 * and spatial audio controls.
 */
export class AudioSource {
  /** Volume (0 = silent, 1 = normal). Defaults to 1. */
  volume: number;

  /** Playback speed multiplier. 1 = normal speed. */
  pitch: number;

  /** Whether the source loops when it reaches the end. */
  loop: boolean;

  /** The currently assigned clip, or null if none. */
  clip: AudioClip | null = null;

  /** Reference time when playback started (in context currentTime seconds). */
  private startTime = 0;

  /** Accumulated time paused at (in seconds). */
  private pauseOffset = 0;

  private _state: "stopped" | "playing" | "paused" = "stopped";

  // Audio graph nodes
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private pannerNode: PannerNode | null = null;

  constructor(
    private readonly context: AudioContext,
    options: {
      volume?: number;
      pitch?: number;
      loop?: boolean;
      clip?: AudioClip | null;
    } = {},
  ) {
    this.volume = options.volume ?? 1;
    this.pitch = options.pitch ?? 1;
    this.loop = options.loop ?? false;
    this.clip = options.clip ?? null;

    this.gainNode = context.createGain();
  }

  /** Current playback state. */
  get state(): "stopped" | "playing" | "paused" {
    return this._state;
  }

  /**
   * Current playback position in seconds.
   * Only accurate while playing or paused; returns 0 when stopped.
   */
  get currentTime(): number {
    if (this._state === "playing") {
      return this.pauseOffset + (this.context.currentTime - this.startTime);
    }
    if (this._state === "paused") {
      return this.pauseOffset;
    }
    return 0;
  }

  /**
   * Assign a PannerNode for spatial audio.
   * Call this before play() if spatial audio is desired.
   */
  setPanner(panner: PannerNode): void {
    this.pannerNode = panner;
  }

  /** Remove the panner node; audio becomes non-spatial. */
  removePanner(): void {
    this.pannerNode = null;
  }

  /** Get the current panner node, if any. */
  getPanner(): PannerNode | null {
    return this.pannerNode;
  }

  /**
   * Get the output node to connect downstream (e.g. to the listener).
   * Returns the gain node which is always the last in the chain.
   */
  getOutputNode(): GainNode {
    return this.gainNode!;
  }

  /** Start or resume playback. */
  play(): void {
    if (!this.clip || !this.clip.buffer) {
      console.warn("AudioSource.play: no clip or buffer assigned");
      return;
    }

    // If paused, resume without creating a new source
    if (this._state === "paused") {
      this._state = "playing";
      this.startTime = this.context.currentTime;
      return;
    }

    // Stop any existing playback
    this.stopInternal();

    const source = this.context.createBufferSource();
    source.buffer = this.clip.buffer;
    source.loop = this.loop;
    source.playbackRate.value = this.pitch;

    this.gainNode!.gain.value = this.volume;

    // Build chain: source -> (panner?) -> gain -> destination
    if (this.pannerNode) {
      source.connect(this.pannerNode);
      this.pannerNode.connect(this.gainNode!);
    } else {
      source.connect(this.gainNode!);
    }

    // Connect gain to destination by default; the caller can override
    if (!this.gainNode!.numberOfOutputs) {
      this.gainNode!.connect(this.context.destination);
    }

    source.start(0, this.pauseOffset);

    this.sourceNode = source;
    this._state = "playing";
    this.startTime = this.context.currentTime;

    source.onended = () => {
      if (this._state === "playing") {
        this._state = "stopped";
        this.pauseOffset = 0;
      }
    };
  }

  /** Pause playback, keeping the current position. */
  pause(): void {
    if (this._state !== "playing") return;
    this.pauseOffset += this.context.currentTime - this.startTime;
    this._state = "paused";
    this.stopInternal();
  }

  /** Stop playback and reset position to 0. */
  stop(): void {
    this.pauseOffset = 0;
    this._state = "stopped";
    this.stopInternal();
  }

  /** Connect the gain output to a destination node. */
  connect(destination: AudioNode): void {
    this.gainNode!.connect(destination);
  }

  /** Disconnect the gain output. */
  disconnect(): void {
    this.gainNode!.disconnect();
  }

  /** Release all audio resources. */
  dispose(): void {
    this.stopInternal();
    this.gainNode?.disconnect();
    this.gainNode = null;
    this.pannerNode = null;
    this.clip = null;
  }

  private stopInternal(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // already stopped
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }
}
