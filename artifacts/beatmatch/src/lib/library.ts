export type ImportedTrack = {
  title: string;
  artist: string;
  album?: string;
};

export type BeatMap = {
  id: string;
  name: string;
  metadata: { songName?: string; songAuthorName?: string; levelAuthorName?: string };
  stats?: {
    downloads?: number;
    rating?: number;
    score?: number;
    scoreOneDP?: number;
    plays?: number;
    upvotes?: number;
    downvotes?: number;
    sentiment?: string;
  };
  tags?: string[];
  versions?: Array<{
    hash?: string;
    state?: string;
    createdAt?: string;
    downloadURL?: string;
    diffs?: Array<{ difficulty?: string; characteristic?: string }>;
  }>;
};

export type ResultsFilter = 'all' | 'exact' | 'other' | 'missing';
export type DifficultyMatchMode = 'or' | 'and';
export type SongSortOrder = 'title' | 'artist' | 'rating';

export type SavedSearchFile = {
  format: 'beatmatch-search';
  version: 1;
  savedAt: string;
  libraryFileName: string;
  tracks: ImportedTrack[];
  artistMaps: BeatMap[];
  scannedArtists: string[];
  filter: ResultsFilter;
  query: string;
  includedDifficulties: string[];
  difficultyMatchMode: DifficultyMatchMode;
  minimumRating: string;
  selectedGenres: string[];
  sortOrder: SongSortOrder;
  selectedMapIds: Record<string, string>;
};

const DIFFICULTY_NAMES: Record<string, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  expert: 'Expert',
  expertplus: 'ExpertPlus',
};

export function getMapDifficulties(map: BeatMap): string[] {
  const difficulties = new Set<string>();
  for (const version of map.versions ?? []) {
    for (const diff of version.diffs ?? []) {
      const key = diff.difficulty?.toLowerCase().replace(/[^a-z]/g, '');
      const name = key ? DIFFICULTY_NAMES[key] : undefined;
      if (name) difficulties.add(name);
    }
  }
  return Array.from(difficulties);
}

export function getMapRatingPercent(map: BeatMap): number | undefined {
  const value = map.stats?.score ?? map.stats?.scoreOneDP ?? map.stats?.rating;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

export function normalizeLibraryText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(feat|ft|featuring)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function getImportedTrackKey(track: ImportedTrack) {
  return `${normalizeLibraryText(track.title)}\u0000${normalizeLibraryText(track.artist)}`;
}

export function getBeatMapTrackKey(map: BeatMap) {
  return `${normalizeLibraryText(map.metadata?.songName ?? '')}\u0000${normalizeLibraryText(map.metadata?.songAuthorName ?? '')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isImportedTrack(value: unknown): value is ImportedTrack {
  if (!isRecord(value)) return false;
  return typeof value.title === 'string' && value.title.length > 0
    && typeof value.artist === 'string' && value.artist.length > 0
    && (value.album === undefined || typeof value.album === 'string');
}

function isBeatMap(value: unknown): value is BeatMap {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !isRecord(value.metadata)) return false;
  for (const field of ['songName', 'songAuthorName', 'levelAuthorName']) {
    if (value.metadata[field] !== undefined && typeof value.metadata[field] !== 'string') return false;
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string'))) return false;
  if (value.versions !== undefined && (!Array.isArray(value.versions) || !value.versions.every(version => {
    if (!isRecord(version)) return false;
    if (version.downloadURL !== undefined && typeof version.downloadURL !== 'string') return false;
    if (version.diffs !== undefined && (!Array.isArray(version.diffs) || !version.diffs.every(diff => {
      if (!isRecord(diff)) return false;
      return (diff.difficulty === undefined || typeof diff.difficulty === 'string')
        && (diff.characteristic === undefined || typeof diff.characteristic === 'string');
    }))) return false;
    return true;
  }))) return false;
  return value.stats === undefined || isRecord(value.stats);
}

export function parseSavedSearch(text: string): SavedSearchFile {
  if (text.length > 25_000_000) throw new Error('This saved search is too large to open in the browser.');

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. Choose a BeatMatch saved search file.');
  }
  if (!isRecord(value) || value.format !== 'beatmatch-search' || value.version !== 1) {
    throw new Error('This is not a supported BeatMatch saved search file.');
  }
  if (!Array.isArray(value.tracks) || value.tracks.length === 0 || !value.tracks.every(isImportedTrack)) {
    throw new Error('The saved search does not contain a valid music library.');
  }
  if (!Array.isArray(value.artistMaps) || !value.artistMaps.every(isBeatMap)) {
    throw new Error('The saved search contains invalid BeatSaver results.');
  }
  if (!Array.isArray(value.scannedArtists) || !value.scannedArtists.every(artist => typeof artist === 'string')) {
    throw new Error('The saved search contains an invalid artist scan list.');
  }
  const validFilters: ResultsFilter[] = ['all', 'exact', 'other', 'missing'];
  if (!validFilters.includes(value.filter as ResultsFilter)) throw new Error('The saved search has an invalid results filter.');
  if (typeof value.query !== 'string') throw new Error('The saved search has an invalid search phrase.');
  if (!Array.isArray(value.includedDifficulties) || !value.includedDifficulties.every(item => typeof item === 'string')) {
    throw new Error('The saved search has invalid difficulty filters.');
  }
  const difficultyMatchMode = value.difficultyMatchMode ?? 'or';
  if (difficultyMatchMode !== 'or' && difficultyMatchMode !== 'and') {
    throw new Error('The saved search has an invalid difficulty match mode.');
  }
  if (!Array.isArray(value.selectedGenres) || !value.selectedGenres.every(item => typeof item === 'string')) {
    throw new Error('The saved search has invalid genre filters.');
  }
  const sortOrder = value.sortOrder ?? 'title';
  if (sortOrder !== 'title' && sortOrder !== 'artist' && sortOrder !== 'rating') {
    throw new Error('The saved search has an invalid song sort order.');
  }
  if (!['any', '60', '70', '80', '90', '95'].includes(String(value.minimumRating))) {
    throw new Error('The saved search has an invalid minimum rating.');
  }
  if (!isRecord(value.selectedMapIds) || !Object.values(value.selectedMapIds).every(id => typeof id === 'string')) {
    throw new Error('The saved search has invalid selected map versions.');
  }

  const uniqueTracks = Array.from(new Map(value.tracks.map(track => [getImportedTrackKey(track), track])).values());
  const uniqueMaps = Array.from(new Map(value.artistMaps.map(map => [map.id, map])).values());
  const selectedMapIds = Object.fromEntries(
    Object.entries(value.selectedMapIds).map(([key, id]) => [key, id as string]),
  );
  return {
    format: 'beatmatch-search',
    version: 1,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    libraryFileName: typeof value.libraryFileName === 'string' ? value.libraryFileName : 'Saved library',
    tracks: uniqueTracks,
    artistMaps: uniqueMaps,
    scannedArtists: Array.from(new Set(value.scannedArtists)),
    filter: value.filter as ResultsFilter,
    query: value.query,
    includedDifficulties: Array.from(new Set(value.includedDifficulties)),
    difficultyMatchMode,
    minimumRating: String(value.minimumRating),
    selectedGenres: Array.from(new Set(value.selectedGenres)),
    sortOrder,
    selectedMapIds,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value); value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value); value = '';
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else value += char;
  }
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export function parseLibrary(text: string, fileName: string): ImportedTrack[] {
  const isXml = /\.xml$/i.test(fileName) || /^\s*</.test(text);
  const tracks: ImportedTrack[] = [];
  if (isXml) {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error('This XML file could not be read. Try exporting your library again.');
    document.querySelectorAll('dict').forEach(dict => {
      const children = Array.from(dict.children);
      if (!children.some(node => node.tagName === 'key' && node.textContent === 'Track ID')) return;
      const values: Record<string, string> = {};
      for (let i = 0; i < children.length - 1; i++) {
        if (children[i].tagName === 'key') values[children[i].textContent ?? ''] = children[i + 1].textContent?.trim() ?? '';
      }
      const title = values.Name ?? '';
      const artist = values.Artist ?? '';
      if (title && artist && values['Podcast'] !== 'true') tracks.push({ title, artist, album: values.Album });
    });
  } else {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error('This CSV is empty.');
    const header = rows[0].map(cell => normalizeLibraryText(cell));
    const titleIndex = header.findIndex(item => ['title', 'song', 'track', 'name'].includes(item));
    const artistIndex = header.findIndex(item => ['artist', 'song artist', 'performer'].includes(item));
    if (titleIndex < 0 || artistIndex < 0) throw new Error('CSV needs column headers named title and artist.');
    const albumIndex = header.findIndex(item => item === 'album');
    rows.slice(1).forEach(row => {
      const title = row[titleIndex]?.trim() ?? '';
      const artist = row[artistIndex]?.trim() ?? '';
      if (title && artist) tracks.push({ title, artist, album: albumIndex >= 0 ? row[albumIndex]?.trim() : undefined });
    });
  }
  const seen = new Set<string>();
  return tracks.filter(track => {
    const key = getImportedTrackKey(track);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type BeatSaverSearchResponse = {
  docs?: BeatMap[];
  info?: { total?: number };
};

export type ArtistSearchCallbacks = {
  shouldContinue: () => boolean;
  waitUntilActive: () => Promise<boolean>;
  signal: AbortSignal;
  onProgress: (page: number, totalPages: number) => void;
  onRateLimit?: (retryInMs: number) => void;
  onMaps: (maps: BeatMap[]) => void;
};

const MAX_RATE_LIMIT_RETRIES = 5;
let beatSaverRateLimitedUntil = 0;

function getRetryAfterMs(response: Response) {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

function delayWithAbort(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The search was cancelled.', 'AbortError'));
      return;
    }

    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('The search was cancelled.', 'AbortError'));
    };
    const timer = window.setTimeout(finish, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function waitForRateLimit(callbacks: ArtistSearchCallbacks) {
  while (beatSaverRateLimitedUntil > Date.now()) {
    if (!callbacks.shouldContinue() || !(await callbacks.waitUntilActive())) return false;
    await delayWithAbort(
      Math.min(250, beatSaverRateLimitedUntil - Date.now()),
      callbacks.signal,
    );
  }
  return callbacks.shouldContinue();
}

async function fetchSearchPage(url: string, callbacks: ArtistSearchCallbacks) {
  let retries = 0;
  while (callbacks.shouldContinue()) {
    if (!(await callbacks.waitUntilActive()) || !(await waitForRateLimit(callbacks))) return null;

    const requestStartedAt = Date.now();
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: callbacks.signal,
    });

    if (response.status !== 429) {
      if (response.ok && requestStartedAt >= beatSaverRateLimitedUntil) {
        beatSaverRateLimitedUntil = 0;
      }
      return response;
    }

    retries += 1;
    const backoffMs = Math.min(60_000, 1_000 * (2 ** (retries - 1)));
    const retryAfterMs = getRetryAfterMs(response);
    const waitMs = Math.max(1_000, retryAfterMs ?? backoffMs);
    beatSaverRateLimitedUntil = Math.max(beatSaverRateLimitedUntil, Date.now() + waitMs);
    callbacks.onRateLimit?.(beatSaverRateLimitedUntil - Date.now());

    if (retries > MAX_RATE_LIMIT_RETRIES) {
      throw new Error('BeatSaver is still rate-limiting requests. The scan stopped after several retries; completed artist results are safe to save and resume.');
    }
  }
  return null;
}

export async function searchArtistMaps(artist: string, callbacks: ArtistSearchCallbacks): Promise<BeatMap[]> {
  const pageSize = 100;
  const artistKey = normalizeLibraryText(artist);
  const maps = new Map<string, BeatMap>();
  let totalPages = 1;

  for (let page = 0; page < totalPages; page++) {
    if (!callbacks.shouldContinue() || !(await callbacks.waitUntilActive())) return Array.from(maps.values());
    const params = new URLSearchParams({ q: artist, pageSize: String(pageSize) });
    const response = await fetchSearchPage(`https://api.beatsaver.com/search/text/${page}?${params}`, callbacks);
    if (!response) return Array.from(maps.values());
    if (!response.ok) throw new Error(`BeatSaver returned a network error (${response.status}).`);

    const body = await response.json() as BeatSaverSearchResponse;
    if (!callbacks.shouldContinue()) return Array.from(maps.values());
    const docs = Array.isArray(body.docs) ? body.docs : [];
    if (page === 0) {
      const total = Number(body.info?.total);
      totalPages = Number.isFinite(total) && total > 0
        ? Math.ceil(total / pageSize)
        : docs.length >= pageSize ? 2 : 1;
    }
    if (docs.length < pageSize) totalPages = page + 1;
    callbacks.onProgress(page + 1, totalPages);
    const pageMaps: BeatMap[] = [];
    for (const map of docs) {
      if (normalizeLibraryText(map.metadata?.songAuthorName ?? '') === artistKey) {
        maps.set(map.id, map);
        pageMaps.push(map);
      }
    }
    if (pageMaps.length) callbacks.onMaps(pageMaps);

    if (page + 1 < totalPages) {
      await new Promise(resolve => window.setTimeout(resolve, 420));
    }
  }

  return Array.from(maps.values());
}

