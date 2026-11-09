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

export async function searchArtistMaps(
  artist: string,
  shouldContinue: () => boolean,
  onProgress: (page: number, totalPages: number) => void,
): Promise<BeatMap[]> {
  const pageSize = 100;
  const artistKey = normalizeLibraryText(artist);
  const maps = new Map<string, BeatMap>();
  let totalPages = 1;

  for (let page = 0; page < totalPages; page++) {
    if (!shouldContinue()) return [];
    const params = new URLSearchParams({ q: artist, pageSize: String(pageSize) });
    const response = await fetch(`https://api.beatsaver.com/search/text/${page}?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (response.status === 429) {
      throw new Error('BeatSaver is rate-limiting searches right now (429). Your completed artist results are safe.');
    }
    if (!response.ok) throw new Error(`BeatSaver returned a network error (${response.status}).`);

    const body = await response.json() as BeatSaverSearchResponse;
    if (!shouldContinue()) return [];
    const docs = Array.isArray(body.docs) ? body.docs : [];
    if (page === 0) {
      const total = Number(body.info?.total);
      totalPages = Number.isFinite(total) && total > 0
        ? Math.ceil(total / pageSize)
        : docs.length >= pageSize ? 2 : 1;
    }
    if (docs.length < pageSize) totalPages = page + 1;
    onProgress(page + 1, totalPages);

    for (const map of docs) {
      if (normalizeLibraryText(map.metadata?.songAuthorName ?? '') === artistKey) {
        maps.set(map.id, map);
      }
    }

    if (page + 1 < totalPages) {
      await new Promise(resolve => window.setTimeout(resolve, 420));
    }
  }

  return Array.from(maps.values());
}

