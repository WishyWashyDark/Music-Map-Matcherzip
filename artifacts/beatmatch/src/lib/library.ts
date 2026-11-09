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

export type TrackMatch = {
  track: ImportedTrack;
  map?: BeatMap;
  confidence: number;
  status: 'matched' | 'uncertain' | 'missing';
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

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(feat|ft|featuring)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
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
    const header = rows[0].map(cell => normalize(cell));
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
    const key = `${normalize(track.title)}|${normalize(track.artist)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.2 + 0.78;
  const left = a.split(' ');
  const right = b.split(' ');
  const overlap = left.filter(token => right.includes(token)).length;
  const tokenScore = (2 * overlap) / (left.length + right.length || 1);
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const editScore = 1 - matrix[a.length][b.length] / Math.max(a.length, b.length);
  return Math.max(tokenScore, editScore * 0.72 + tokenScore * 0.28);
}

export function rankMap(track: ImportedTrack, maps: BeatMap[]): TrackMatch {
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  const ranked = maps.map(map => {
    const song = normalize(map.metadata?.songName || map.name || '');
    const author = normalize(map.metadata?.songAuthorName || '');
    const titleScore = similarity(title, song);
    const artistScore = similarity(artist, author);
    return { map, score: titleScore * 0.72 + artistScore * 0.28, titleScore, artistScore };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.titleScore < 0.47 || best.score < 0.52) return { track, confidence: best?.score ?? 0, status: 'missing' };
  const confidence = Math.round(best.score * 100);
  if (best.titleScore >= 0.76 && best.score >= 0.78) return { track, map: best.map, confidence, status: 'matched' };
  return { track, map: best.map, confidence, status: 'uncertain' };
}

