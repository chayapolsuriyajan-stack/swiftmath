// Tiny promisified IndexedDB wrapper.
const DB_NAME = 'swiftmath';
const VERSION = 1;

export type StoreName = 'kv' | 'samples' | 'progress' | 'queue';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv');
      db.createObjectStore('samples', { autoIncrement: true }).createIndex('profile', 'profile');
      db.createObjectStore('progress', { keyPath: 'key' }).createIndex('profile', 'profile');
      db.createObjectStore('queue', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name: StoreName, mode: IDBTransactionMode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const db = {
  async get<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return wrap((await store(name)).get(key));
  },
  async put(name: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return wrap((await store(name, 'readwrite')).put(value, key));
  },
  async del(name: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
    await wrap((await store(name, 'readwrite')).delete(key));
  },
  async all<T>(name: StoreName): Promise<T[]> {
    return wrap((await store(name)).getAll());
  },
  async allKeys(name: StoreName): Promise<IDBValidKey[]> {
    return wrap((await store(name)).getAllKeys());
  },
  async byProfile<T>(name: 'samples' | 'progress', profile: string): Promise<{ key: IDBValidKey; value: T }[]> {
    const idx = (await store(name)).index('profile');
    const [keys, values] = await Promise.all([
      wrap(idx.getAllKeys(IDBKeyRange.only(profile))),
      wrap(idx.getAll(IDBKeyRange.only(profile))),
    ]);
    return keys.map((key, i) => ({ key, value: values[i] as T }));
  },
};
