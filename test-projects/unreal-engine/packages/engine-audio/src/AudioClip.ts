/**
 * AudioClip wraps an AudioBuffer loaded from a URL or provided directly.
 * It can play itself back via a one-shot AudioBufferSourceNode.
 */
export class AudioClip {
  public readonly buffer: AudioBuffer | null = null;
  public readonly url: string;

  private constructor(url: string, buffer: AudioBuffer | null) {
    this.url = url;
    this.buffer = buffer;
  }

  /** Create a clip from a pre-existing AudioBuffer (e.g. generated tones). */
  static fromBuffer(buffer: AudioBuffer, name = "generated"): AudioClip {
    return new AudioClip(name, buffer);
  }

  /** Load an audio file from a URL. Returns a promise that resolves once decoded. */
  static async load(context: AudioContext, url: string): Promise<AudioClip> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`AudioClip: failed to fetch "${url}" — ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    return new AudioClip(url, audioBuffer);
  }

  /**
   * Create a BufferSource from this clip ready to be connected and started.
   * The caller is responsible for stopping the source when done.
   */
  createSource(context: AudioContext): AudioBufferSourceNode {
    if (!this.buffer) {
      throw new Error(`AudioClip "${this.url}" has no decoded buffer`);
    }
    const source = context.createBufferSource();
    source.buffer = this.buffer;
    return source;
  }

  /**
   * Convenience: play the clip once through the given destination, disconnecting
   * automatically when the sound finishes.
   */
  playOnce(
    context: AudioContext,
    destination: AudioNode = context.destination,
    options: { loop?: boolean; playbackRate?: number; gain?: number } = {},
  ): { source: AudioBufferSourceNode; gainNode: GainNode } {
    const source = this.createSource(context);
    const gainNode = context.createGain();

    source.loop = options.loop ?? false;
    source.playbackRate.value = options.playbackRate ?? 1;
    gainNode.gain.value = options.gain ?? 1;

    source.connect(gainNode);
    gainNode.connect(destination);
    source.start();

    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
    };

    return { source, gainNode };
  }
}
