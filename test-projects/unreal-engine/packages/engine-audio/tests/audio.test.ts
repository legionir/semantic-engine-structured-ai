import { describe, it, expect, beforeEach, vi } from "vitest";
import { AudioClip } from "../src/AudioClip.js";
import { AudioSource } from "../src/AudioSource.js";
import { Listener } from "../src/Listener.js";
import { SpatialAudio } from "../src/SpatialAudio.js";
import { AudioSourceComponent } from "../src/AudioSourceComponent.js";
import { AudioSystem } from "../src/AudioSystem.js";
import { Scene } from "@web-engine/engine-core";

// ---------------------------------------------------------------------------
// Mock Web Audio API
// ---------------------------------------------------------------------------
function createMockAudioContext(): AudioContext {
  const mockNode: Partial<AudioNode> = {
    connect: vi.fn(() => mockNode as unknown as AudioNode),
    disconnect: vi.fn(),
    numberOfOutputs: 0,
  };

  const mockAudioParam: Partial<AudioParam> = {
    value: 0,
  };

  const mockPanner: Partial<PannerNode> = {
    ...mockNode,
    positionX: { value: 0 } as unknown as AudioParam,
    positionY: { value: 0 } as unknown as AudioParam,
    positionZ: { value: 0 } as unknown as AudioParam,
    orientationX: { value: 0 } as unknown as AudioParam,
    orientationY: { value: 0 } as unknown as AudioParam,
    orientationZ: { value: 0 } as unknown as AudioParam,
    distanceModel: "inverse" as DistanceModel,
    refDistance: 1,
    maxDistance: 10000,
    rolloffFactor: 1,
    coneInnerAngle: 360,
    coneOuterAngle: 360,
    coneOuterGain: 0,
  };

  const mockListener: Partial<AudioListener> = {
    positionX: { value: 0 } as unknown as AudioParam,
    positionY: { value: 0 } as unknown as AudioParam,
    positionZ: { value: 0 } as unknown as AudioParam,
    forwardX: { value: 0 } as unknown as AudioParam,
    forwardY: { value: 0 } as unknown as AudioParam,
    forwardZ: { value: -1 } as unknown as AudioParam,
    upX: { value: 0 } as unknown as AudioParam,
    upY: { value: 1 } as unknown as AudioParam,
    upZ: { value: 0 } as unknown as AudioParam,
  };

  let currentTime = 0;

  const ctx: Partial<AudioContext> = {
    currentTime: 0,
    destination: mockNode as unknown as AudioDestinationNode,
    listener: mockListener as unknown as AudioListener,
    createBufferSource: vi.fn(() => ({
      buffer: null,
      loop: false,
      playbackRate: { value: 1 } as unknown as AudioParam,
      connect: vi.fn(() => mockNode as unknown as AudioNode),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    } as unknown as AudioBufferSourceNode)),
    createGain: vi.fn(() => ({
      ...mockNode,
      gain: { value: 1 } as unknown as AudioParam,
    } as unknown as GainNode)),
    createPanner: vi.fn(() => mockPanner as unknown as PannerNode),
    decodeAudioData: vi.fn(async () => ({
      duration: 2.5,
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 110250,
      getChannelData: vi.fn(() => new Float32Array(110250)),
    } as unknown as AudioBuffer)),
    get currentTime() { return currentTime; },
    set currentTime(v: number) { currentTime = v; },
  };

  return ctx as unknown as AudioContext;
}

type DistanceModel = "linear" | "inverse" | "exponential";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AudioClip", () => {
  it("creates a clip from a buffer", () => {
    const ctx = createMockAudioContext();
    const buf = ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer;
    const clip = AudioClip.fromBuffer(buf, "test");
    expect(clip.url).toBe("test");
    expect(clip.buffer).toBe(buf);
  });

  it("creates a source node from the buffer", () => {
    const ctx = createMockAudioContext();
    const buf = ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer;
    const clip = AudioClip.fromBuffer(buf, "test");
    const source = clip.createSource(ctx);
    expect(source.buffer).toBe(buf);
  });

  it("throws when creating source without buffer", () => {
    const ctx = createMockAudioContext();
    // Access the private constructor via a loophole: create via load without fetch
    // We'll just test the method directly
    const clip = new (AudioClip as any)("nope", null);
    expect(() => clip.createSource(ctx)).toThrow("no decoded buffer");
  });

  it("playOnce connects and starts a source", async () => {
    const ctx = createMockAudioContext();
    const buf = await ctx.decodeAudioData(new ArrayBuffer(0));
    const clip = AudioClip.fromBuffer(buf, "test");
    const { source, gainNode } = clip.playOnce(ctx);
    expect(source.start).toHaveBeenCalled();
    expect(gainNode.gain.value).toBe(1);
  });
});

describe("AudioSource", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = createMockAudioContext();
  });

  it("creates with default values", () => {
    const source = new AudioSource(ctx);
    expect(source.volume).toBe(1);
    expect(source.pitch).toBe(1);
    expect(source.loop).toBe(false);
    expect(source.state).toBe("stopped");
    expect(source.currentTime).toBe(0);
  });

  it("creates with custom options", () => {
    const source = new AudioSource(ctx, { volume: 0.5, pitch: 2, loop: true });
    expect(source.volume).toBe(0.5);
    expect(source.pitch).toBe(2);
    expect(source.loop).toBe(true);
  });

  it("play requires a clip with buffer", () => {
    const source = new AudioSource(ctx);
    // Should warn but not crash
    expect(() => source.play()).not.toThrow();
    expect(source.state).toBe("stopped");
  });

  it("play transitions to playing state with a clip", () => {
    const source = new AudioSource(ctx);
    const buf = ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer;
    const clip = AudioClip.fromBuffer(buf, "test");
    source.clip = clip;
    source.play();
    expect(source.state).toBe("playing");
  });

  it("pause and stop control playback state", () => {
    const source = new AudioSource(ctx);
    const buf = ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer;
    source.clip = AudioClip.fromBuffer(buf, "test");

    source.play();
    expect(source.state).toBe("playing");

    source.pause();
    expect(source.state).toBe("paused");

    source.play(); // resume
    expect(source.state).toBe("playing");

    source.stop();
    expect(source.state).toBe("stopped");
    expect(source.currentTime).toBe(0);
  });

  it("volume and pitch are reflected in gain node", () => {
    const source = new AudioSource(ctx, { volume: 0.3, pitch: 1.5 });
    expect(source.volume).toBe(0.3);
    expect(source.pitch).toBe(1.5);
  });

  it("setPanner and removePanner control spatial audio", () => {
    const source = new AudioSource(ctx);
    expect(source.getPanner()).toBeNull();

    const panner = ctx.createPanner();
    source.setPanner(panner);
    expect(source.getPanner()).toBe(panner);

    source.removePanner();
    expect(source.getPanner()).toBeNull();
  });

  it("dispose cleans up resources", () => {
    const source = new AudioSource(ctx);
    const buf = ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer;
    source.clip = AudioClip.fromBuffer(buf, "test");
    source.play();

    source.dispose();
    expect(source.clip).toBeNull();
    // Should not throw on double dispose
    expect(() => source.dispose()).not.toThrow();
  });
});

describe("Listener", () => {
  it("updates the Web Audio API listener", () => {
    const ctx = createMockAudioContext();
    const listener = new Listener(ctx.listener);

    listener.setPosition(1, 2, 3);
    listener.setOrientation(0, 0, -1, 0, 1, 0);
    listener.update();

    expect(ctx.listener.positionX.value).toBe(1);
    expect(ctx.listener.positionY.value).toBe(2);
    expect(ctx.listener.positionZ.value).toBe(3);
    expect(ctx.listener.forwardZ.value).toBe(-1);
  });

  it("lookAt points the listener toward a target", () => {
    const ctx = createMockAudioContext();
    const listener = new Listener(ctx.listener);

    listener.setPosition(0, 0, 0);
    listener.lookAt(10, 0, 0);

    expect(listener.forward[0]).toBeCloseTo(1);
    expect(listener.forward[1]).toBeCloseTo(0);
    expect(listener.forward[2]).toBeCloseTo(0);
  });
});

describe("SpatialAudio", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = createMockAudioContext();
  });

  it("creates with default options", () => {
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source);

    expect(spatial.position).toEqual([0, 0, 0]);
    expect(spatial.orientation).toEqual([0, 0, -1]);
    expect(spatial.panner).toBeDefined();
    expect(source.getPanner()).toBe(spatial.panner);
  });

  it("creates with custom options", () => {
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source, {
      position: [10, 5, -3],
      orientation: [1, 0, 0],
      distanceModel: "exponential",
      refDistance: 2,
      maxDistance: 50,
      rolloffFactor: 2,
    });

    expect(spatial.position).toEqual([10, 5, -3]);
    expect(spatial.orientation).toEqual([1, 0, 0]);
    expect(spatial.panner.distanceModel).toBe("exponential");
    expect(spatial.panner.refDistance).toBe(2);
    expect(spatial.panner.maxDistance).toBe(50);
    expect(spatial.panner.rolloffFactor).toBe(2);
  });

  it("setPosition updates panner params", () => {
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source);

    spatial.setPosition(3, 4, 5);
    expect(spatial.panner.positionX.value).toBe(3);
    expect(spatial.panner.positionY.value).toBe(4);
    expect(spatial.panner.positionZ.value).toBe(5);
  });

  it("setOrientation updates panner params", () => {
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source);

    spatial.setOrientation(1, 0, 0);
    expect(spatial.panner.orientationX.value).toBe(1);
  });

  it("update pushes stored position to panner", () => {
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source);

    spatial.position = [7, 8, 9];
    spatial.orientation = [0, 1, 0];
    spatial.update();

    expect(spatial.panner.positionX.value).toBe(7);
    expect(spatial.panner.positionY.value).toBe(8);
    expect(spatial.panner.positionZ.value).toBe(9);
    expect(spatial.panner.orientationY.value).toBe(1);
  });

  it("setCone configures cone parameters", () => {
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source);

    spatial.setCone(90, 180, 0.5);
    expect(spatial.panner.coneInnerAngle).toBe(90);
    expect(spatial.panner.coneOuterAngle).toBe(180);
    expect(spatial.panner.coneOuterGain).toBe(0.5);
  });

  it("detach removes panner from source", () => {
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source);

    expect(source.getPanner()).toBe(spatial.panner);
    spatial.detach();
    expect(source.getPanner()).toBeNull();
  });
});

describe("AudioSourceComponent", () => {
  it("creates and attaches to an entity", () => {
    const scene = new Scene();
    const entity = scene.createEntity("AudioEnt");
    const ctx = createMockAudioContext();
    const source = new AudioSource(ctx);

    const comp = new AudioSourceComponent(entity, source);
    entity.addComponent(comp);

    expect(entity.hasComponent("audio_source")).toBe(true);
    expect(entity.getComponent<AudioSourceComponent>("audio_source")!.source).toBe(source);
  });

  it("play/pause/stop convenience methods work", () => {
    const scene = new Scene();
    const entity = scene.createEntity("AudioEnt");
    const ctx = createMockAudioContext();
    const buf = ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer;
    const clip = AudioClip.fromBuffer(buf, "test");
    const source = new AudioSource(ctx, { clip });

    const comp = new AudioSourceComponent(entity, source);
    entity.addComponent(comp);

    comp.play();
    expect(source.state).toBe("playing");

    comp.pause();
    expect(source.state).toBe("paused");

    comp.stop();
    expect(source.state).toBe("stopped");
  });

  it("onDestroy disposes the source", () => {
    const scene = new Scene();
    const entity = scene.createEntity("AudioEnt");
    const ctx = createMockAudioContext();
    const source = new AudioSource(ctx);
    const clip = AudioClip.fromBuffer(
      ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer, "test"
    );
    source.clip = clip;

    const comp = new AudioSourceComponent(entity, source);
    entity.addComponent(comp);

    comp.onDestroy();
    expect(source.clip).toBeNull();
  });

  it("toJSON serialises state", () => {
    const scene = new Scene();
    const entity = scene.createEntity("AudioEnt");
    const ctx = createMockAudioContext();
    const buf = ctx.decodeAudioData(new ArrayBuffer(0)) as unknown as AudioBuffer;
    const clip = AudioClip.fromBuffer(buf, "test.mp3");
    const source = new AudioSource(ctx, { clip, volume: 0.5, pitch: 2, loop: true });

    const comp = new AudioSourceComponent(entity, source);
    entity.addComponent(comp);

    const json = comp.toJSON();
    expect(json.volume).toBe(0.5);
    expect(json.pitch).toBe(2);
    expect(json.loop).toBe(true);
    expect(json.url).toBe("test.mp3");
    expect(json.spatial).toBeNull();
  });
});

describe("AudioSystem", () => {
  it("creates with a listener", () => {
    const ctx = createMockAudioContext();
    const scene = new Scene();
    const system = new AudioSystem(scene.world, ctx);

    expect(system.listener).toBeDefined();
    system.dispose();
  });

  it("update does not crash with no audio entities", () => {
    const ctx = createMockAudioContext();
    const scene = new Scene();
    const system = new AudioSystem(scene.world, ctx);

    expect(() => system.update(0.016, 0)).not.toThrow();
    system.dispose();
  });

  it("update syncs spatial positions from transform", () => {
    const ctx = createMockAudioContext();
    const scene = new Scene();
    const entity = scene.createEntity("AudioEnt");
    const source = new AudioSource(ctx);
    const spatial = new SpatialAudio(ctx, source, { position: [0, 0, 0] });
    const comp = new AudioSourceComponent(entity, source, spatial);
    entity.addComponent(comp);

    // Set transform position
    const transform = entity.getComponent("transform")!;
    (transform as any).position = [10, 20, 30];

    const system = new AudioSystem(scene.world, ctx);
    system.update(0.016, 0.016);

    // Spatial position should now match transform position
    expect(spatial.position[0]).toBe(10);
    expect(spatial.position[1]).toBe(20);
    expect(spatial.position[2]).toBe(30);

    system.dispose();
  });

  it("dispose clears listener", () => {
    const ctx = createMockAudioContext();
    const scene = new Scene();
    const system = new AudioSystem(scene.world, ctx);

    system.dispose();
    expect(system.listener).toBeNull();
  });
});
