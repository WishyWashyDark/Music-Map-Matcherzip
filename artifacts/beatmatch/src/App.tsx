import { type ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { ArrowUpRight, AudioLines, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Download, FileMusic, FolderOpen, Headphones, LockKeyhole, Music2, Pause, Play, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, Square, Star, Upload, X } from 'lucide-react';
import { type BeatMap, type DifficultyMatchMode, type ImportedTrack, type ResultsFilter, type SavedSearchFile, type SongSortOrder, getBeatMapTrackKey, getImportedTrackKey, getMapDifficulties, getMapRatingPercent, normalizeLibraryText, parseLibrary, parseSavedSearch, searchArtistMaps } from '@/lib/library';
import { ARTIST_MAP_CACHE_TTL_DAYS, getCachedArtistMaps, saveCachedArtistMaps } from '@/lib/artist-map-cache';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

const DIFFICULTY_OPTIONS = [
  { value: 'Easy', label: 'Easy' },
  { value: 'Normal', label: 'Normal' },
  { value: 'Hard', label: 'Hard' },
  { value: 'Expert', label: 'Expert' },
  { value: 'ExpertPlus', label: 'Expert+' },
] as const;

const RATING_OPTIONS = [
  { value: 'any', label: 'Any rating' },
  { value: '60', label: '60% or higher' },
  { value: '70', label: '70% or higher' },
  { value: '80', label: '80% or higher' },
  { value: '90', label: '90% or higher' },
  { value: '95', label: '95% or higher' },
] as const;

function formatMapTag(tag: string) {
  const specialLabels: Record<string, string> = {
    'j-rock': 'J-Rock',
    'j-pop': 'J-Pop',
    'k-pop': 'K-Pop',
    rb: 'R&B',
  };
  return specialLabels[tag] ?? tag.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

type ArtistMapResult = { map: BeatMap; matchedTrack?: ImportedTrack };
type SongMapGroup = {
  key: string;
  maps: ArtistMapResult[];
  selected: ArtistMapResult;
  selectedIndex: number;
  matchedTrack?: ImportedTrack;
};

function groupMapsBySong(results: ArtistMapResult[], selectedMapIds: Record<string, string>, sortOrder: SongSortOrder): SongMapGroup[] {
  const groups = new Map<string, ArtistMapResult[]>();
  for (const result of results) {
    const songKey = getBeatMapTrackKey(result.map);
    const key = songKey === '\u0000' ? `map:${result.map.id}` : songKey;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return Array.from(groups, ([key, maps]) => {
    const ranked = [...maps].sort((a, b) => {
      const ratingA = getMapRatingPercent(a.map) ?? -1;
      const ratingB = getMapRatingPercent(b.map) ?? -1;
      return ratingB - ratingA || a.map.id.localeCompare(b.map.id);
    });
    const selected = selectedMapIds[key];
    const selectedIndex = Math.max(0, ranked.findIndex(result => result.map.id === selected));
    return {
      key,
      maps: ranked,
      selected: ranked[selectedIndex],
      selectedIndex,
      matchedTrack: ranked[0]?.matchedTrack,
    };
  }).sort((a, b) => {
    const mapA = a.selected.map;
    const mapB = b.selected.map;
    if (sortOrder === 'artist') {
      const artistA = mapA.metadata.songAuthorName ?? '';
      const artistB = mapB.metadata.songAuthorName ?? '';
      return artistA.localeCompare(artistB) || (mapA.metadata.songName || mapA.name).localeCompare(mapB.metadata.songName || mapB.name);
    }
    if (sortOrder === 'rating') {
      const ratingA = getMapRatingPercent(mapA) ?? -1;
      const ratingB = getMapRatingPercent(mapB) ?? -1;
      return ratingB - ratingA
        || (mapA.metadata.songName || mapA.name).localeCompare(mapB.metadata.songName || mapB.name)
        || (mapA.metadata.songAuthorName ?? '').localeCompare(mapB.metadata.songAuthorName ?? '');
    }
    const titleA = mapA.metadata.songName || mapA.name;
    const titleB = mapB.metadata.songName || mapB.name;
    return titleA.localeCompare(titleB) || (mapA.metadata.songAuthorName ?? '').localeCompare(mapB.metadata.songAuthorName ?? '');
  });
}

function Home() {
  const [tracks, setTracks] = useState<ImportedTrack[]>([]);
  const [fileName, setFileName] = useState('');
  const [artistMaps, setArtistMaps] = useState<BeatMap[]>([]);
  const [scannedArtists, setScannedArtists] = useState<string[]>([]);
  const [filter, setFilter] = useState<ResultsFilter>('all');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [includedDifficulties, setIncludedDifficulties] = useState<string[]>([]);
  const [difficultyMatchMode, setDifficultyMatchMode] = useState<DifficultyMatchMode>('or');
  const [minimumRating, setMinimumRating] = useState('any');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SongSortOrder>('title');
  const [dragging, setDragging] = useState(false);
  const [importError, setImportError] = useState('');
  const [scanError, setScanError] = useState('');
  const [savedSearchError, setSavedSearchError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanPaused, setScanPaused] = useState(false);
  const [scanCurrent, setScanCurrent] = useState('');
  const [cacheNotice, setCacheNotice] = useState('');
  const [cacheHitCount, setCacheHitCount] = useState(0);
  const [selectedMapIds, setSelectedMapIds] = useState<Record<string, string>>({});
  const scanRun = useRef(0);
  const scanAbortController = useRef<AbortController | null>(null);
  const stopRequested = useRef(false);
  const scanPausedRef = useRef(false);
  const pauseWaiters = useRef(new Set<() => void>());
  const cacheUnavailable = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedSearchFileRef = useRef<HTMLInputElement>(null);

  const artists = useMemo(() => {
    const names = new Map<string, string>();
    tracks.forEach(track => {
      const key = normalizeLibraryText(track.artist);
      if (key && !names.has(key)) names.set(key, track.artist);
    });
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
  }, [tracks]);
  const scannedArtistKeys = useMemo(() => new Set(scannedArtists), [scannedArtists]);
  const tracksByKey = useMemo(() => new Map(tracks.map(track => [getImportedTrackKey(track), track])), [tracks]);
  const mapResults = useMemo<ArtistMapResult[]>(() => artistMaps.map(map => ({
    map,
    matchedTrack: tracksByKey.get(getBeatMapTrackKey(map)),
  })), [artistMaps, tracksByKey]);
  const availableGenres = useMemo(() => Array.from(new Set(artistMaps.flatMap(map => map.tags ?? [])))
    .sort((a, b) => formatMapTag(a).localeCompare(formatMapTag(b))), [artistMaps]);
  const exactTrackKeys = useMemo(() => new Set(mapResults.flatMap(result => result.matchedTrack ? [getImportedTrackKey(result.matchedTrack)] : [])), [mapResults]);
  const exactTrackCount = exactTrackKeys.size;
  const hasAdvancedFilters = includedDifficulties.length > 0 || minimumRating !== 'any' || selectedGenres.length > 0;
  const activeAdvancedFilterCount = Number(includedDifficulties.length > 0) + Number(minimumRating !== 'any') + Number(selectedGenres.length > 0);
  const filteredMapResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return mapResults.filter(({ map, matchedTrack }) => {
      if (filter === 'exact' && !matchedTrack) return false;
      if (filter === 'other' && matchedTrack) return false;
      if (filter === 'missing') return false;
      if (hasAdvancedFilters) {
        if (includedDifficulties.length > 0) {
          const mapDifficulties = getMapDifficulties(map);
          const matchesDifficulty = difficultyMatchMode === 'and'
            ? includedDifficulties.every(difficulty => mapDifficulties.includes(difficulty))
            : includedDifficulties.some(difficulty => mapDifficulties.includes(difficulty));
          if (!matchesDifficulty) return false;
        }
        if (minimumRating !== 'any') {
          const rating = getMapRatingPercent(map);
          if (rating === undefined || rating < Number(minimumRating)) return false;
        }
        if (selectedGenres.length > 0 && !selectedGenres.some(genre => map.tags?.includes(genre))) return false;
      }
      return !needle || `${map.name} ${map.metadata.songName ?? ''} ${map.metadata.songAuthorName ?? ''} ${map.metadata.levelAuthorName ?? ''} ${(map.tags ?? []).join(' ')} ${matchedTrack?.title ?? ''}`.toLowerCase().includes(needle);
    });
  }, [difficultyMatchMode, filter, hasAdvancedFilters, includedDifficulties, mapResults, minimumRating, query, selectedGenres]);
  const allSongGroups = useMemo(() => groupMapsBySong(mapResults, selectedMapIds, sortOrder), [mapResults, selectedMapIds, sortOrder]);
  const filteredSongGroups = useMemo(() => groupMapsBySong(filteredMapResults, selectedMapIds, sortOrder), [filteredMapResults, selectedMapIds, sortOrder]);
  const exactSongCount = allSongGroups.filter(group => group.matchedTrack).length;
  const otherSongCount = Math.max(0, allSongGroups.length - exactSongCount);
  const missingTracks = tracks.filter(track => scannedArtistKeys.has(normalizeLibraryText(track.artist)) && !exactTrackKeys.has(getImportedTrackKey(track)));
  const scannedArtistCount = artists.length - artists.filter(artist => !scannedArtistKeys.has(normalizeLibraryText(artist))).length;
  const pendingArtistCount = Math.max(0, artists.length - scannedArtistCount);
  const filteredMissingTracks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return missingTracks.filter(track => !needle || `${track.title} ${track.artist} ${track.album ?? ''}`.toLowerCase().includes(needle));
  }, [missingTracks, query]);
  const scopedSongCount = filter === 'exact' ? exactSongCount : filter === 'other' ? otherSongCount : allSongGroups.length;
  const resultCount = filter === 'missing' ? filteredMissingTracks.length : filteredSongGroups.length;
  const resultScopeCount = filter === 'missing' ? missingTracks.length : scopedSongCount;
  const resultsCountLabel = filter === 'missing'
    ? query.trim() ? `Showing ${resultCount} of ${resultScopeCount} unmatched songs` : `${resultCount} unmatched songs`
    : query.trim() || hasAdvancedFilters ? `Showing ${resultCount} of ${resultScopeCount} songs` : `${resultCount} songs`;

  function resolvePauseWaiters() {
    pauseWaiters.current.forEach(resolve => resolve());
    pauseWaiters.current.clear();
  }

  function setPauseState(paused: boolean) {
    scanPausedRef.current = paused;
    setScanPaused(paused);
    if (!paused) resolvePauseWaiters();
  }

  async function waitUntilScanResumes(runId: number) {
    while (runId === scanRun.current && !stopRequested.current && scanPausedRef.current) {
      await new Promise<void>(resolve => pauseWaiters.current.add(resolve));
    }
    return runId === scanRun.current && !stopRequested.current;
  }

  function invalidateScan() {
    scanRun.current++;
    stopRequested.current = true;
    scanAbortController.current?.abort();
    scanAbortController.current = null;
    setPauseState(false);
    setScanning(false);
  }

  async function loadFile(file?: File) {
    if (!file) return;
    setImportError('');
    setScanError('');
    setSavedSearchError('');
    try {
      const text = await file.text();
      const parsed = parseLibrary(text, file.name);
      if (!parsed.length) throw new Error('No tracks with both a title and artist were found in this file.');
      invalidateScan();
      setTracks(parsed);
      setArtistMaps([]);
      setScannedArtists([]);
      setSelectedMapIds({});
      setFileName(file.name);
      setFilter('all');
      setQuery('');
      setScanCurrent('');
      clearAdvancedFilters();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'We could not read that library file.');
    }
  }

  async function loadSavedSearch(file?: File) {
    if (!file) return;
    setSavedSearchError('');
    try {
      const snapshot = parseSavedSearch(await file.text());
      invalidateScan();
      const knownArtists = new Set(snapshot.tracks.map(track => normalizeLibraryText(track.artist)));
      setTracks(snapshot.tracks);
      setArtistMaps(snapshot.artistMaps);
      setScannedArtists(snapshot.scannedArtists.filter(artist => knownArtists.has(artist)));
      setSelectedMapIds(snapshot.selectedMapIds);
      setFileName(snapshot.libraryFileName || file.name);
      setFilter(snapshot.filter);
      setQuery(snapshot.query);
      setIncludedDifficulties(snapshot.includedDifficulties);
      setDifficultyMatchMode(snapshot.difficultyMatchMode);
      setMinimumRating(snapshot.minimumRating);
      setSelectedGenres(snapshot.selectedGenres);
      setSortOrder(snapshot.sortOrder);
      setScanCurrent('');
      setScanError('');
      setImportError('');
      setFiltersOpen(false);
    } catch (error) {
      setSavedSearchError(error instanceof Error ? error.message : 'We could not open that saved search.');
    } finally {
      if (savedSearchFileRef.current) savedSearchFileRef.current.value = '';
    }
  }

  function saveSearch() {
    if (!tracks.length) return;
    const snapshot: SavedSearchFile = {
      format: 'beatmatch-search',
      version: 1,
      savedAt: new Date().toISOString(),
      libraryFileName: fileName,
      tracks,
      artistMaps,
      scannedArtists,
      filter,
      query,
      includedDifficulties,
      difficultyMatchMode,
      minimumRating,
      selectedGenres,
      sortOrder,
      selectedMapIds,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `beatmatch-search-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function scanLibrary() {
    if (scanning || !tracks.length || pendingArtistCount === 0) return;
    const runId = ++scanRun.current;
    const controller = new AbortController();
    scanAbortController.current = controller;
    stopRequested.current = false;
    setPauseState(false);
    setScanning(true);
    setScanError('');
    setCacheHitCount(0);
    const completed = new Set(scannedArtists);
    const queue = artists.filter(artist => !completed.has(normalizeLibraryText(artist)));
    let cursor = 0;
    let stopped: string | null = null;
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (cursor < queue.length && !stopped && !stopRequested.current && scanRun.current === runId) {
        if (!(await waitUntilScanResumes(runId))) return;
        const artist = queue[cursor++];
        const artistKey = normalizeLibraryText(artist);
        setScanCurrent(artist);
        let usedCache = false;
        try {
          let cachedMaps: BeatMap[] | null = null;
          if (!cacheUnavailable.current) {
            try {
              cachedMaps = await getCachedArtistMaps(artist);
            } catch {
              cacheUnavailable.current = true;
              setCacheNotice('The local artist cache is unavailable. This scan will continue, but future scans may need to fetch these artists again.');
            }
          }
          if (scanRun.current !== runId || stopRequested.current) return;

          const addMaps = (maps: BeatMap[]) => {
            if (scanRun.current !== runId) return;
            setArtistMaps(current => {
              const byId = new Map(current.map(map => [map.id, map]));
              maps.forEach(map => byId.set(map.id, map));
              return Array.from(byId.values());
            });
          };

          if (cachedMaps !== null) {
            usedCache = true;
            setCacheHitCount(current => current + 1);
            addMaps(cachedMaps);
          } else {
            const maps = await searchArtistMaps(artist, {
              shouldContinue: () => scanRun.current === runId && !stopRequested.current,
              waitUntilActive: () => waitUntilScanResumes(runId),
              signal: controller.signal,
              onProgress: (page, totalPages) => setScanCurrent(`${artist} · page ${page} of ${totalPages}`),
              onRateLimit: retryInMs => setScanCurrent(`${artist} · BeatSaver asked us to wait ${Math.ceil(retryInMs / 1000)}s`),
              onMaps: addMaps,
            });
            if (scanRun.current !== runId || stopRequested.current) return;
            if (!cacheUnavailable.current) {
              try {
                await saveCachedArtistMaps(artist, maps);
              } catch {
                cacheUnavailable.current = true;
                setCacheNotice('The local artist cache is unavailable. This scan will continue, but future scans may need to fetch these artists again.');
              }
            }
          }
          if (scanRun.current !== runId || stopRequested.current) return;
          setScannedArtists(current => current.includes(artistKey) ? current : [...current, artistKey]);
          if (!usedCache) await new Promise(resolve => window.setTimeout(resolve, 500));
        } catch (error) {
          if (scanRun.current !== runId || stopRequested.current || (error instanceof DOMException && error.name === 'AbortError')) break;
          stopped = error instanceof Error ? error.message : 'The connection to BeatSaver was interrupted.';
          stopRequested.current = true;
          controller.abort();
          break;
        }
      }
    });
    await Promise.all(workers);
    if (scanRun.current !== runId) return;
    scanAbortController.current = null;
    setScanning(false);
    setPauseState(false);
    setScanCurrent('');
    if (stopped) setScanError(stopped);
    else if (stopRequested.current) setScanError('Search stopped. Results collected so far are preserved. Continue later or reset to clear them.');
    else setScanError('');
    stopRequested.current = false;
  }

  function pauseOrResumeScan() {
    if (scanning) setPauseState(!scanPausedRef.current);
  }

  function stopScan() {
    if (!scanning) return;
    stopRequested.current = true;
    scanAbortController.current?.abort();
    setPauseState(false);
    setScanError('Stopping search. Results collected so far will be preserved.');
  }

  function selectAlternative(group: SongMapGroup, direction: -1 | 1) {
    const nextIndex = group.selectedIndex + direction;
    const nextMap = group.maps[nextIndex]?.map;
    if (!nextMap) return;
    setSelectedMapIds(current => ({ ...current, [group.key]: nextMap.id }));
  }

  function resetLibrary() {
    invalidateScan();
    setScanning(false); setTracks([]); setArtistMaps([]); setScannedArtists([]); setFileName('');
    setScanCurrent(''); setScanError(''); setImportError('');
    setSavedSearchError(''); setSelectedMapIds({});
    setFilter('all'); setQuery(''); setFiltersOpen(false); clearAdvancedFilters();
    if (fileRef.current) fileRef.current.value = '';
    if (savedSearchFileRef.current) savedSearchFileRef.current.value = '';
  }

  function clearAdvancedFilters() {
    setIncludedDifficulties([]);
    setDifficultyMatchMode('or');
    setMinimumRating('any');
    setSelectedGenres([]);
    setSelectedMapIds({});
  }

  function toggleDifficulty(difficulty: string) {
    setSelectedMapIds({});
    setIncludedDifficulties(current => current.includes(difficulty)
      ? current.filter(item => item !== difficulty)
      : [...current, difficulty]);
  }

  function toggleGenre(genre: string) {
    setSelectedMapIds({});
    setSelectedGenres(current => current.includes(genre)
      ? current.filter(item => item !== genre)
      : [...current, genre]);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span className="brand-icon"><AudioLines size={19} strokeWidth={2.3} /></span>beatmatch</div>
        <div className="top-note"><i /> YOUR LIBRARY, REIMAGINED</div>
      </header>
      <main className="main-wrap">
        <section className="hero-row">
          <div>
            <div className="eyebrow"><Sparkles size={13} /> YOUR NEXT FAVORITE MAP IS IN HERE</div>
            <h1 className="hero-title">Songs you love.<br /><span>Maps to move to.</span></h1>
            <p className="hero-copy">Find every BeatSaver map made for artists in your music library. Exact song-and-artist matches stand out.</p>
          </div>
          <aside className="hero-aside"><strong>A little music archaeology.</strong>BeatMatch searches BeatSaver for each artist in your library. Songs already in Apple Music are highlighted when both artist and title match. Your library file stays on this device.</aside>
        </section>
        <section className="workspace">
          <aside className="panel import-panel">
            <h2 className="panel-title">Bring your library</h2>
            <p className="panel-kicker">01 / LOCAL IMPORT</p>
            <div className={`drop-zone${dragging ? ' dragging' : ''}`}
              onDragOver={event => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]); }}>
              <div className="upload-symbol"><Upload size={19} /></div>
              <strong>Drop a library export here</strong>
              <span>Apple Music XML or a title + artist CSV</span>
              <input ref={fileRef} className="file-button" data-testid="input-library-file" type="file" accept=".xml,.csv,text/csv,application/xml,text/xml" aria-label="Choose an Apple Music XML or CSV library file" onChange={event => void loadFile(event.target.files?.[0])} />
            </div>
            <div className="privacy-note"><LockKeyhole size={14} /><span>Your file stays on this device. Only artist names are sent to BeatSaver to search.</span></div>
            {fileName && <div className="file-meta" data-testid="text-imported-file"><FileMusic size={14} /><span>{fileName} · {tracks.length} unique tracks</span><button onClick={resetLibrary} aria-label="Remove imported library" data-testid="button-clear-library"><X size={14} /></button></div>}
            <button className="primary-button" onClick={() => void scanLibrary()} disabled={!tracks.length || scanning || pendingArtistCount === 0} data-testid="button-scan-library">
              {scanning ? <><span className="scan-spin" /> Searching BeatSaver by artist</> : pendingArtistCount === 0 && scannedArtistCount > 0 ? <><Check size={15} /> Artist scan complete</> : <><Headphones size={15} /> {scannedArtistCount ? `Continue scan · ${pendingArtistCount} artists left` : 'Find maps by my artists'}<ArrowUpRight size={14} /></>}
            </button>
            <p className="format-help">CSV needs a header row with columns named <b>title</b> and <b>artist</b>. Duplicate tracks are quietly removed.</p>
            <a className="sample-download-link" href={`${import.meta.env.BASE_URL}sample-artist-matches-library.xml`} download="sample-artist-matches-library.xml" data-testid="link-download-sample-library">
              <Download size={13} /> Download artist-match sample XML
            </a>
            {importError && <div className="alert-box error" role="alert" data-testid="status-import-error"><CircleAlert size={15} />{importError}</div>}
          </aside>
          <div className="right-column">
            <div className="stats-strip">
              <div className="stat-box"><div className="stat-label">IN YOUR LIBRARY</div><div className="stat-number">{tracks.length}</div></div>
              <div className="stat-box"><div className="stat-label">BEATSAVER SONGS</div><div className="stat-number mint">{allSongGroups.length}</div></div>
              <div className="stat-box"><div className="stat-label">EXACT MATCHES</div><div className="stat-number mint">{exactTrackCount}</div></div>
            </div>
            <section className="panel results-panel">
              <div className="results-head">
                <div><h2 className="results-title">BeatSaver songs from your artists</h2><div className="results-sub">{tracks.length ? `${allSongGroups.length} songs · ${artistMaps.length} maps from ${scannedArtistCount} of ${artists.length} artists · ${exactTrackCount} exact matches` : 'A good place to start your next session'}</div></div>
                <div className="result-tools">
                  <div className="search-wrap"><Search size={13} /><input className="search-input" type="search" placeholder="Filter BeatSaver songs…" value={query} onChange={event => { setSelectedMapIds({}); setQuery(event.target.value); }} data-testid="input-filter-tracks" aria-label="Filter BeatSaver songs" /></div>
                  <div className="saved-search-actions">
                    <button className="saved-search-button" onClick={saveSearch} disabled={!tracks.length} data-testid="button-save-search"><Save size={13} /> Save search</button>
                    <button className="saved-search-button secondary" onClick={() => savedSearchFileRef.current?.click()} data-testid="button-open-search"><FolderOpen size={13} /> Open file</button>
                    <input ref={savedSearchFileRef} className="hidden-file-input" type="file" accept=".json,application/json" aria-label="Open a saved BeatMatch search" onChange={event => void loadSavedSearch(event.target.files?.[0])} />
                  </div>
                  {tracks.length > 0 && <button className="ghost-button" onClick={resetLibrary} data-testid="button-reset-library">Reset</button>}
                </div>
              </div>
              {savedSearchError && <div className="alert-box error" role="alert" data-testid="status-saved-search-error"><CircleAlert size={15} />{savedSearchError}</div>}
              {tracks.length > 0 && <>
                <div className="filter-row">
                  <div className="filter-tabs" role="tablist" aria-label="Filter results">
                    {([['all', `All songs ${allSongGroups.length}`], ['exact', `In Apple Music ${exactSongCount}`], ['other', `More by artists ${otherSongCount}`], ['missing', `No exact track ${missingTracks.length}`]] as const).map(([key, label]) =>
                      <button key={key} role="tab" aria-selected={filter === key} className={`filter-tab${filter === key ? ' active' : ''}`} onClick={() => { setSelectedMapIds({}); setFilter(key); }} data-testid={`tab-filter-${key}`}>{label}</button>)}
                  </div>
                  <button className={`refinement-toggle${filtersOpen ? ' is-open' : ''}`} type="button" onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen} aria-controls="map-refinement-filters" data-testid="button-open-map-filters">
                    <SlidersHorizontal size={13} /> Filters{activeAdvancedFilterCount > 0 && <span className="filter-count">{activeAdvancedFilterCount}</span>}<ChevronDown size={13} className="filter-chevron" />
                  </button>
                  {filter !== 'missing' && <label className="sort-control"><span>Sort</span><select className="sort-select" aria-label="Sort songs" value={sortOrder} onChange={event => setSortOrder(event.target.value as SongSortOrder)} data-testid="select-sort-songs">
                    <option value="artist">Band name A–Z</option>
                    <option value="title">Song name A–Z</option>
                    <option value="rating">Rating high–low</option>
                  </select></label>}
                </div>
                {filtersOpen && <div className="refinement-panel" id="map-refinement-filters">
                  <div className="refinement-group">
                    <div className="difficulty-heading-row">
                      <div className="refinement-heading">Included difficulties <span>{includedDifficulties.length ? `${includedDifficulties.length} selected` : 'Any'}</span></div>
                      <div className="difficulty-mode-toggle" role="group" aria-label="Difficulty match mode">
                        <button type="button" aria-pressed={difficultyMatchMode === 'or'} className={difficultyMatchMode === 'or' ? 'active' : ''} onClick={() => setDifficultyMatchMode('or')} data-testid="button-difficulty-mode-or">OR</button>
                        <button type="button" aria-pressed={difficultyMatchMode === 'and'} className={difficultyMatchMode === 'and' ? 'active' : ''} onClick={() => setDifficultyMatchMode('and')} data-testid="button-difficulty-mode-and">AND</button>
                      </div>
                    </div>
                    <p className="refinement-help">Show maps that include {difficultyMatchMode === 'and' ? 'all' : 'any'} selected levels. Leave all unchecked for any difficulty.</p>
                    <div className="checkbox-options difficulty-options">
                      {DIFFICULTY_OPTIONS.map(option => <label className="filter-checkbox" key={option.value}>
                        <input type="checkbox" checked={includedDifficulties.includes(option.value)} onChange={() => toggleDifficulty(option.value)} />
                        <span>{option.label}</span>
                      </label>)}
                    </div>
                  </div>
                  <div className="refinement-group rating-group">
                    <label className="refinement-heading" htmlFor="minimum-map-rating">Minimum rating</label>
                    <select id="minimum-map-rating" className="rating-select" value={minimumRating} onChange={event => { setSelectedMapIds({}); setMinimumRating(event.target.value); }} data-testid="select-minimum-map-rating">
                      {RATING_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <p className="refinement-help">BeatSaver score, shown as a percentage.</p>
                  </div>
                  <div className="refinement-group genre-group">
                    <div className="refinement-heading">Genre / style <span>{selectedGenres.length ? `${selectedGenres.length} selected` : 'Any'}</span></div>
                    <p className="refinement-help">Choose one or more BeatSaver tags.</p>
                    {availableGenres.length > 0 ? <div className="checkbox-options genre-options">
                      {availableGenres.map(genre => <label className="filter-checkbox" key={genre}>
                        <input type="checkbox" checked={selectedGenres.includes(genre)} onChange={() => toggleGenre(genre)} />
                        <span>{formatMapTag(genre)}</span>
                      </label>)}
                    </div> : <div className="genre-empty">Tags appear as map results are found.</div>}
                  </div>
                  <div className="refinement-actions">
                    <span>{filter === 'missing' ? 'Map filters apply to BeatSaver results, not unmatched library songs.' : `Difficulty uses ${difficultyMatchMode.toUpperCase()} matching; any selected genre can match.`}</span>
                    <button className="link-button" type="button" onClick={clearAdvancedFilters} disabled={!hasAdvancedFilters}>Clear filters</button>
                  </div>
                </div>}
              </>}
              {scanning && <div className={`scan-banner${scanPaused ? ' is-paused' : ''}`} role="status" data-testid="status-scan-progress">
                {scanPaused ? <Pause size={19} className="scan-paused-icon" /> : <span className="scan-spin" />}
                <div className="scan-copy">
                  <strong>{scanPaused ? 'Search paused' : 'Searching for your artists'}</strong>
                  <span>Checking {scanCurrent || 'the next artist'} · {scannedArtistCount} of {artists.length} artists complete{cacheHitCount > 0 ? ` · ${cacheHitCount} reused from the ${ARTIST_MAP_CACHE_TTL_DAYS}-day cache` : ''}</span>
                  <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={artists.length ? Math.round(scannedArtistCount / artists.length * 100) : 0}>
                    <div className="progress-fill" style={{ width: `${artists.length ? Math.min(100, scannedArtistCount / artists.length * 100) : 0}%` }} />
                  </div>
                </div>
                <span className="confidence">{artists.length ? Math.round(scannedArtistCount / artists.length * 100) : 0}%</span>
                <div className="scan-controls">
                  <button className="scan-control-button" type="button" onClick={pauseOrResumeScan} aria-label={scanPaused ? 'Resume search' : 'Pause search'} title={scanPaused ? 'Resume search' : 'Pause search'} data-testid="button-pause-scan">{scanPaused ? <Play size={14} /> : <Pause size={14} />}</button>
                  <button className="scan-control-button stop" type="button" onClick={stopScan} aria-label="Stop search and keep results" title="Stop and keep results" data-testid="button-stop-scan"><Square size={13} fill="currentColor" /></button>
                </div>
              </div>}
              {scanError && <div className="alert-box warning" role="alert" data-testid="status-scan-partial"><CircleAlert size={15} /><span>{scanError} {pendingArtistCount > 0 && !scanError.startsWith('Search stopped') && 'You can continue once the catalog is ready.'}</span></div>}
              {cacheNotice && <div className="alert-box warning" role="status" data-testid="status-cache-warning"><CircleAlert size={15} /><span>{cacheNotice}</span></div>}
              {tracks.length > 0 && <div className="results-count" role="status" data-testid="text-filtered-song-count">{resultsCountLabel}</div>}
              {tracks.length === 0 ? <div className="empty-state">
                <div className="empty-orbit"><Music2 size={24} /></div><strong>Your library is the setlist.</strong>
                <p>Import an Apple Music XML export or a simple CSV to see which songs have maps waiting for you.</p>
                <p>{`Scan BeatSaver to discover every map by the artists in your library.`}</p>
              </div> : filter === 'missing' ? filteredMissingTracks.length === 0 ? <div className="empty-state">
                <div className="empty-orbit"><Check size={22} /></div><strong>No unmatched songs here.</strong><p>{scannedArtistCount ? 'Every scanned library song has an exact artist-and-title match.' : 'Scan your artists first to check for exact song matches.'}</p>
              </div> : <div>
                <div className="table-head missing-table-head"><span>APPLE MUSIC SONG</span><span>MATCH STATUS</span><span>STATUS</span></div>
                {filteredMissingTracks.map((track, index) => <div className="track-row" key={getImportedTrackKey(track)} data-testid={`row-unmatched-track-${index}`}>
                  <div className="track-main track-cell"><div className="track-title">{track.title}</div><div className="track-artist">{track.artist}{track.album ? ` · ${track.album}` : ''}</div></div>
                  <div className="track-main map-cell"><span className="map-by">No exact song-and-artist match on BeatSaver</span></div>
                  <div className="status-cell"><span className="status-pill missing">Not matched</span></div>
                </div>)}
              </div> : filteredSongGroups.length === 0 ? <div className="empty-state">
                <div className="empty-orbit">{scanning ? <span className="scan-spin" /> : <Search size={22} />}</div>
                <strong>{scanning ? 'Looking through artist maps.' : mapResults.length ? 'No maps in this corner.' : pendingArtistCount ? 'Ready to search your artists.' : 'No BeatSaver maps found for these artists.'}</strong>
                <p>{scanning ? 'New BeatSaver tracks appear as each artist finishes.' : mapResults.length ? 'Try another filter or search phrase.' : pendingArtistCount ? 'Start the scan to load every matching artist catalog.' : 'Try scanning again later or import another library.'}</p>
              </div> : <div>
                <div className="table-head"><span>SONG</span><span>MAP DETAILS</span><span>BEATSAVER / DOWNLOAD</span></div>
                {filteredSongGroups.map((group, index) => {
                  const { map, matchedTrack } = group.selected;
                  const songTitle = map.metadata.songName || map.name;
                  const songArtist = map.metadata.songAuthorName || 'Artist not listed';
                  const ratingPercent = getMapRatingPercent(map);
                  const downloadUrl = map.versions?.find(version => version.downloadURL)?.downloadURL;
                  const difficulties = getMapDifficulties(map);
                  const genres = map.tags ?? [];
                  return <div className={`track-row${matchedTrack ? ' exact-match-row' : ''}`} key={group.key} data-testid={`row-song-${index}`}>
                    <div className="track-main track-cell song-cell">
                      <div className="song-cell-top">
                        <div className="song-labels">
                          <div className="track-title" title={songTitle}>{songTitle}</div>
                          <div className="track-artist">{songArtist}</div>
                        </div>
                        <span className={`song-rating${ratingPercent === undefined ? ' unrated' : ''}`} aria-label={ratingPercent === undefined ? 'Unrated map' : `Rating ${Math.round(ratingPercent)} percent`}>
                          <Star size={13} fill={ratingPercent === undefined ? 'none' : 'currentColor'} /> {ratingPercent === undefined ? 'Unrated' : `${Math.round(ratingPercent)}%`}
                        </span>
                      </div>
                      {matchedTrack ? <div className="exact-match-note"><Check size={11} /> In your Apple Music library</div> : <div className="artist-only-note">Same artist as your library</div>}
                    </div>
                    <div className="track-main map-cell">
                      <a className="map-title" href={`https://beatsaver.com/maps/${map.id}`} target="_blank" rel="noreferrer" data-testid={`link-map-${index}`}>{map.name} <ArrowUpRight size={10} style={{ display: 'inline' }} /></a>
                      <div className="map-by">Mapped by {map.metadata.levelAuthorName || 'community'}</div>
                      <div className="map-fact-lines">
                        <div className="map-fact-line" aria-label="Map difficulties">
                          <span className="map-fact-label">Difficulty</span>
                          <div className="map-fact-chips">{difficulties.length ? difficulties.map(difficulty => <span className="difficulty-fact" key={difficulty}>{difficulty === 'ExpertPlus' ? 'Expert+' : difficulty}</span>) : <span className="map-fact-empty">Not listed</span>}</div>
                        </div>
                        <div className="map-fact-line" aria-label="Map genres">
                          <span className="map-fact-label">Genres</span>
                          <div className="map-fact-chips">{genres.length ? genres.map(tag => <span className="genre-fact" key={tag}>{formatMapTag(tag)}</span>) : <span className="map-fact-empty">Not listed</span>}</div>
                        </div>
                      </div>
                      {group.maps.length > 1 && <div className="version-switcher">
                        <span className="version-position">Map {group.selectedIndex + 1} of {group.maps.length}{group.selectedIndex === 0 ? ' · Best rated' : ''}</span>
                        <div className="version-controls">
                          <button type="button" onClick={() => selectAlternative(group, -1)} disabled={group.selectedIndex === 0} aria-label={`Show higher-rated map for ${songTitle}`} title="Higher-rated map" data-testid={`button-previous-map-${index}`}><ChevronLeft size={15} /></button>
                          <button type="button" onClick={() => selectAlternative(group, 1)} disabled={group.selectedIndex >= group.maps.length - 1} aria-label={`Show lower-rated map for ${songTitle}`} title="Lower-rated map" data-testid={`button-next-map-${index}`}><ChevronRight size={15} /></button>
                        </div>
                      </div>}
                    </div>
                    <div className="map-actions-cell">
                      <span className="map-id"><span>BeatSaver ID</span><code>{map.id}</code></span>
                      {downloadUrl ? <a className="map-download-link" href={downloadUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-download-map-${index}`}><Download size={14} /> Download map</a> : <span className="download-unavailable">No download link</span>}
                    </div>
                  </div>;
                })}
                {filteredSongGroups.length < allSongGroups.length && <div className="results-foot"><span></span><button className="link-button" onClick={() => { setQuery(''); setFilter('all'); clearAdvancedFilters(); }}>Show all songs</button></div>}
              </div>}
              {tracks.length > 0 && scannedArtistCount === artists.length && artists.length > 0 && !scanning && !scanError && <div className="results-foot" data-testid="status-scan-complete"><span><ShieldCheck size={13} style={{ verticalAlign: 'middle', marginRight: 5, color: '#368267' }} />All artists checked · every map by those artists is included</span><span>{exactTrackCount} exact song matches</span></div>}
            </section>
            <div className="bottom-note"><ShieldCheck size={13} /> Private by design <span>·</span> Only artist names reach BeatSaver <span>·</span> No account needed</div>
          </div>
        </section>
    </main>
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const routerBase = import.meta.env.BASE_URL.startsWith('/')
    ? import.meta.env.BASE_URL.replace(/\/$/, '')
    : window.location.pathname.replace(/\/$/, '');

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={routerBase}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
