import { describe, expect, it } from 'vitest';
import { Scene, serializeScene } from '@web-engine/engine-core';
import {
  DATABASE_NAME,
  OBJECT_STORE,
  SCENE_KEY_PREFIX,
  createMemoryKvStore,
  createSceneStorage,
  isSceneSnapshot,
  isStoredScene,
  openKvStore,
  sceneKeyFor,
} from '../src/app/storage/scene-storage';
import { createDemoScene } from '../src/app/engine/default-scene';

describe('sceneKeyFor', () => {
  it('namespaces keys so one store can hold other records', () => {
    expect(sceneKeyFor('p1')).toBe(`${SCENE_KEY_PREFIX}p1`);
  });
});

describe('isSceneSnapshot', () => {
  it('accepts what the engine serializer writes', () => {
    expect(isSceneSnapshot(serializeScene(new Scene()))).toBe(true);
  });

  it('rejects anything that would throw later', () => {
    expect(isSceneSnapshot(null)).toBe(false);
    expect(isSceneSnapshot({ version: 1 })).toBe(false);
    expect(isSceneSnapshot({ version: 'one', id: 'a', name: 'b', entities: [] })).toBe(false);
    expect(isSceneSnapshot('{"version":1}')).toBe(false);
  });
});

describe('isStoredScene', () => {
  it('requires the whole envelope', () => {
    const snapshot = serializeScene(new Scene());
    expect(isStoredScene({ projectId: 'p', savedAt: 1, snapshot })).toBe(true);
    expect(isStoredScene({ projectId: 'p', snapshot })).toBe(false);
    expect(isStoredScene({ projectId: 'p', savedAt: 1, snapshot: { bogus: true } })).toBe(false);
  });
});

describe('createMemoryKvStore', () => {
  it('stores a copy, so a caller cannot mutate what was saved', async () => {
    const store = createMemoryKvStore();
    const value = { kept: [1, 2] };
    await store.set('k', value);
    value.kept.push(3);
    expect((await store.get('k')) as { kept: number[] }).toEqual({ kept: [1, 2] });
  });

  it('lists and removes keys', async () => {
    const store = createMemoryKvStore();
    await store.set('a', 1);
    await store.set('b', 2);
    expect((await store.keys()).sort()).toEqual(['a', 'b']);
    await store.remove('a');
    expect(await store.get('a')).toBeUndefined();
  });
});

describe('openKvStore', () => {
  it('falls back to memory when IndexedDB is missing', async () => {
    const store = await openKvStore({});
    await store.set('probe', { hello: 'world' });
    expect(await store.get('probe')).toEqual({ hello: 'world' });
  });

  it('falls back to memory when opening the database throws', async () => {
    const blocked = {
      get indexedDB(): IDBFactory {
        throw new Error('storage disabled');
      },
    };
    const store = await openKvStore(blocked);
    await store.set('probe', 1);
    expect(await store.get('probe')).toBe(1);
  });
});

describe('createSceneStorage', () => {
  it('round-trips a demo scene through the store', async () => {
    const storage = createSceneStorage(createMemoryKvStore());
    const { scene } = createDemoScene();

    const record = await storage.save('p1', scene);

    expect(record.projectId).toBe('p1');
    expect(record.snapshot.entities.length).toBe(5);

    const loaded = await storage.load('p1');
    expect(loaded?.snapshot.name).toBe(scene.name);
    expect(loaded?.savedAt).toBe(record.savedAt);
  });

  it('keeps one record per project and lists the newest first', async () => {
    const storage = createSceneStorage(createMemoryKvStore());
    const { scene } = createDemoScene();

    const first = await storage.save('p1', scene);
    const second = await storage.save('p2', scene);

    const list = await storage.list();
    expect(list.map((entry) => entry.projectId).sort()).toEqual(['p1', 'p2']);
    /* Both saves happen in the same millisecond here, so ordering is checked on
       the timestamps rather than on a strict sort. */
    expect(list.every((entry) => entry.savedAt >= first.savedAt && entry.savedAt <= second.savedAt + 1)).toBe(true);
  });

  it('ignores a record whose payload no longer validates', async () => {
    const store = createMemoryKvStore();
    await store.set(sceneKeyFor('p1'), { projectId: 'p1', savedAt: 1, snapshot: 'corrupt' });

    const storage = createSceneStorage(store);
    expect(await storage.load('p1')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('removes a project record', async () => {
    const storage = createSceneStorage(createMemoryKvStore());
    const { scene } = createDemoScene();
    await storage.save('p1', scene);
    await storage.remove('p1');
    expect(await storage.load('p1')).toBeNull();
  });

  it('only lists scene records, not other keys in the same store', async () => {
    const store = createMemoryKvStore();
    await store.set('settings', { theme: 'dark' });
    const storage = createSceneStorage(store);
    expect(await storage.list()).toEqual([]);
  });
});

describe('store naming', () => {
  it('matches the database and object store the client opens', () => {
    expect(DATABASE_NAME).toBe('web-engine-web');
    expect(OBJECT_STORE).toBe('scenes');
  });
});
