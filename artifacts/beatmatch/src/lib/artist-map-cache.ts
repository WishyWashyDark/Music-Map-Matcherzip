import type { BeatMap } from './library';
import { normalizeLibraryText } from './library';

const DATABASE_NAME = 'beatmatch-artist-map-cache';
const STORE_NAME = 'artists';
export const ARTIST_MAP_CACHE_TTL_DAYS = 14;
const CACHE_TTL_MS = ARTIST_MAP_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

type ArtistMapCacheEntry = {
  artistKey: string;
  fetchedAt: number;
  maps: BeatMap[];
};

let databasePromise: Promise<IDBDatabase> | null = null;
let cleanupPromise: Promise<void> | null = null;

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser does not support IndexedDB.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'artistKey' });
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open the local artist cache.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
        cleanupPromise = null;
      };
      resolve(database);
    };
  }).catch(error => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

function pruneExpiredEntries(database: IDBDatabase) {
  if (cleanupPromise) return cleanupPromise;

  cleanupPromise = new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const request = transaction.objectStore(STORE_NAME).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value as Partial<ArtistMapCacheEntry>;
      if (
        typeof entry.fetchedAt !== 'number' ||
        !Number.isFinite(entry.fetchedAt) ||
        Date.now() - entry.fetchedAt > CACHE_TTL_MS
      ) {
        cursor.delete();
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clean the local artist cache.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local artist cache cleanup was cancelled.'));
  }).catch(error => {
    cleanupPromise = null;
    throw error;
  });

  return cleanupPromise;
}

function isStoredMap(value: unknown): value is BeatMap {
  if (!value || typeof value !== 'object') return false;
  const map = value as Partial<BeatMap>;
  return typeof map.id === 'string' &&
    typeof map.name === 'string' &&
    !!map.metadata &&
    typeof map.metadata === 'object';
}

function isCacheEntry(value: unknown): value is ArtistMapCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ArtistMapCacheEntry>;
  return typeof entry.artistKey === 'string' &&
    typeof entry.fetchedAt === 'number' &&
    Number.isFinite(entry.fetchedAt) &&
    Array.isArray(entry.maps) &&
    entry.maps.every(isStoredMap);
}

export async function getCachedArtistMaps(artist: string): Promise<BeatMap[] | null> {
  const artistKey = normalizeLibraryText(artist);
  if (!artistKey) return null;

  const database = await openDatabase();
  await pruneExpiredEntries(database);

  return new Promise<BeatMap[] | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(artistKey);
    request.onsuccess = () => {
      const entry: unknown = request.result;
      resolve(isCacheEntry(entry) ? entry.maps : null);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not read the local artist cache.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not read the local artist cache.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local artist cache read was cancelled.'));
  });
}

export async function saveCachedArtistMaps(artist: string, maps: BeatMap[]): Promise<void> {
  const artistKey = normalizeLibraryText(artist);
  if (!artistKey) return;

  const database = await openDatabase();
  await pruneExpiredEntries(database);

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      artistKey,
      fetchedAt: Date.now(),
      maps,
    } satisfies ArtistMapCacheEntry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the local artist cache.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local artist cache write was cancelled.'));
  });
}
