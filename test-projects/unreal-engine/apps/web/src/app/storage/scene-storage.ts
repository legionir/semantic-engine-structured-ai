import { serializeScene, type Scene, type SceneSnapshot } from '@web-engine/engine-core';

export const DATABASE_NAME = 'web-engine-web';
export const OBJECT_STORE = 'scenes';
export const SCENE_KEY_PREFIX = 'scene:';

export interface StoredScene {
  readonly projectId: string;
  /** `Date.now()` at save time. */
  readonly savedAt: number;
  readonly snapshot: SceneSnapshot;
}

/** Key/value surface the storage layer needs; IndexedDB and memory both fit. */
export interface KvStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  close?(): void;
}

export function sceneKeyFor(projectId: string): string {
  return `${SCENE_KEY_PREFIX}${projectId}`;
}

export function isStoredScene(value: unknown): value is StoredScene {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['projectId'] === 'string' &&
    typeof record['savedAt'] === 'number' &&
    isSceneSnapshot(record['snapshot'])
  );
}

/** Structural check only — a corrupt record must not become a thrown TypeError later. */
export function isSceneSnapshot(value: unknown): value is SceneSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['version'] === 'number' &&
    typeof record['id'] === 'string' &&
    typeof record['name'] === 'string' &&
    Array.isArray(record['entities'])
  );
}

export function createMemoryKvStore(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, structuredCloneSafe(value));
    },
    async remove(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

function structuredCloneSafe(value: unknown): unknown {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** IndexedDB-backed store, resolving to a memory store when IDB is unavailable. */
export function openKvStore(globalObject: { indexedDB?: IDBFactory } = globalThis): Promise<KvStore> {
  return new Promise<KvStore>((resolve) => {
    /* Reading the property can itself throw in a sandboxed iframe, so the access
       is inside the guard rather than in front of it. */
    let factory: IDBFactory | undefined;
    let request: IDBOpenDBRequest;
    try {
      factory = globalObject.indexedDB;
      if (!factory) {
        resolve(createMemoryKvStore());
        return;
      }
      request = factory.open(DATABASE_NAME, 1);
    } catch {
      resolve(createMemoryKvStore());
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE);
      resolve(createIdbKvStore(db));
    };
    /* Private browsing, a disabled storage quota or a blocked upgrade all land
       here; the local-first guarantee then degrades to "this session only". */
    request.onerror = () => resolve(createMemoryKvStore());
    request.onblocked = () => resolve(createMemoryKvStore());
  });
}

function createIdbKvStore(db: IDBDatabase): KvStore {
  const run = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      try {
        const transaction = db.transaction(OBJECT_STORE, mode);
        const request = action(transaction.objectStore(OBJECT_STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  return {
    get: (key) => run<unknown>('readonly', (store) => store.get(key)),
    set: (key, value) => run<void>('readwrite', (store) => store.put(value, key)),
    remove: (key) => run<void>('readwrite', (store) => store.delete(key)),
    keys: () => run<string[]>('readonly', (store) => store.getAllKeys()),
    close: () => db.close(),
  };
}

export interface SceneStorage {
  save(projectId: string, scene: Scene): Promise<StoredScene>;
  /** `null` when nothing is stored or the record failed validation. */
  load(projectId: string): Promise<StoredScene | null>;
  list(): Promise<StoredScene[]>;
  remove(projectId: string): Promise<void>;
}

/**
 * Local-first scene persistence (`docs/architecture.md`, principle 4).
 *
 * Only the serialized scene is stored — meshes and materials are rebuilt by the
 * engine, exactly like `apps/server`'s project record does it.
 */
export function createSceneStorage(store: KvStore): SceneStorage {
  return {
    async save(projectId, scene) {
      const record: StoredScene = {
        projectId,
        savedAt: Date.now(),
        snapshot: serializeScene(scene),
      };
      await store.set(sceneKeyFor(projectId), record);
      return record;
    },

    async load(projectId) {
      const raw = await store.get(sceneKeyFor(projectId));
      return isStoredScene(raw) ? raw : null;
    },

    async list() {
      const keys = await store.keys();
      const records = await Promise.all(
        keys.filter((key) => key.startsWith(SCENE_KEY_PREFIX)).map((key) => store.get(key))
      );
      return records
        .filter(isStoredScene)
        .sort((a, b) => b.savedAt - a.savedAt);
    },

    async remove(projectId) {
      await store.remove(sceneKeyFor(projectId));
    },
  };
}
