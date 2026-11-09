import { type ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { ArrowUpRight, AudioLines, Check, CircleAlert, FileMusic, Headphones, LockKeyhole, Music2, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import { type BeatMap, type ImportedTrack, type TrackMatch, parseLibrary, rankMap } from '@/lib/library';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Home() {
  const [tracks, setTracks] = useState<ImportedTrack[]>([]);
  const [fileName, setFileName] = useState('');
  const [matches, setMatches] = useState<TrackMatch[]>([]);
  const [filter, setFilter] = useState<'all' | 'matched' | 'missing'>('all');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [importError, setImportError] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanCurrent, setScanCurrent] = useState('');
  const scanRun = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const matchByTrack = useMemo(() => new Map(matches.map(result => [`${result.track.title}\u0000${result.track.artist}`, result] as const)), [matches]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tracks.filter(track => {
      const result = matchByTrack.get(`${track.title}\u0000${track.artist}`);
      if (filter === 'matched' && result?.status !== 'matched' && result?.status !== 'uncertain') return false;
      if (filter === 'missing' && result?.status !== 'missing') return false;
      return !needle || `${track.title} ${track.artist} ${track.album ?? ''} ${result?.map?.metadata.songName ?? ''}`.toLowerCase().includes(needle);
    });
  }, [filter, matchByTrack, query, tracks]);
  const matchedCount = matches.filter(item => item.status === 'matched').length;
  const missingCount = matches.filter(item => item.status === 'missing').length;
  const uncertainCount = matches.filter(item => item.status === 'uncertain').length;
  const pendingCount = Math.max(0, tracks.length - matches.length);

  async function loadFile(file?: File) {
    if (!file) return;
    setImportError('');
    setScanError('');
    try {
      const text = await file.text();
      const parsed = parseLibrary(text, file.name);
      if (!parsed.length) throw new Error('No tracks with both a title and artist were found in this file.');
      scanRun.current++;
      setTracks(parsed);
      setMatches([]);
      setFileName(file.name);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'We could not read that library file.');
    }
  }

  async function scanLibrary() {
    if (scanning || !tracks.length) return;
    const runId = ++scanRun.current;
    setScanning(true);
    setScanError('');
    const completed = new Set(matches.map(item => `${item.track.title}\u0000${item.track.artist}`));
    const queue = tracks.filter(track => !completed.has(`${track.title}\u0000${track.artist}`));
    let cursor = 0;
    let stopped: string | null = null;
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (cursor < queue.length && !stopped && scanRun.current === runId) {
        const track = queue[cursor++];
        setScanCurrent(`${track.title} — ${track.artist}`);
        try {
          const phrase = `${track.title} ${track.artist}`;
          const response = await fetch(`https://api.beatsaver.com/search/text/0?q=${encodeURIComponent(phrase)}`, {
            headers: { Accept: 'application/json' },
          });
          if (response.status === 429) throw new Error('BeatSaver is rate-limiting searches right now (429). Your completed results are safe.');
          if (!response.ok) throw new Error(`BeatSaver returned a network error (${response.status}).`);
          const body = await response.json() as { docs?: BeatMap[] };
          const result = rankMap(track, Array.isArray(body.docs) ? body.docs : []);
          if (scanRun.current !== runId) return;
          setMatches(current => [...current.filter(item => item.track !== track), result]);
          await new Promise(resolve => window.setTimeout(resolve, 420));
        } catch (error) {
          stopped = error instanceof Error ? error.message : 'The connection to BeatSaver was interrupted.';
          break;
        }
      }
    });
    await Promise.all(workers);
    if (scanRun.current !== runId) return;
    setScanning(false);
    if (stopped) setScanError(stopped);
    else setScanCurrent('');
  }

  function resetLibrary() {
    scanRun.current++;
    setScanning(false); setTracks([]); setMatches([]); setFileName('');
    setScanCurrent(''); setScanError(''); setImportError('');
    if (fileRef.current) fileRef.current.value = '';
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
            <p className="hero-copy">Find the Beat Saber maps hiding in your music library. Bring a library export, and we’ll do the digging.</p>
          </div>
          <aside className="hero-aside"><strong>A little music archaeology.</strong>BeatMatch checks your tracks against the BeatSaver map catalog, then sorts the sure things from the maybes. Nothing in your library is uploaded.</aside>
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
            <div className="privacy-note"><LockKeyhole size={14} /><span>Your file stays on this device. Only song and artist names are sent to BeatSaver to search.</span></div>
            {fileName && <div className="file-meta" data-testid="text-imported-file"><FileMusic size={14} /><span>{fileName} · {tracks.length} unique tracks</span><button onClick={resetLibrary} aria-label="Remove imported library" data-testid="button-clear-library"><X size={14} /></button></div>}
            <button className="primary-button" onClick={() => void scanLibrary()} disabled={!tracks.length || scanning || pendingCount === 0} data-testid="button-scan-library">
              {scanning ? <><span className="scan-spin" /> Searching BeatSaver</> : pendingCount === 0 && matches.length ? <><Check size={15} /> Scan complete</> : <><Headphones size={15} /> {matches.length ? `Continue scan · ${pendingCount} left` : 'Find my Beat Saber maps'}<ArrowUpRight size={14} /></>}
            </button>
            <p className="format-help">CSV needs a header row with columns named <b>title</b> and <b>artist</b>. Duplicate tracks are quietly removed.</p>
            {importError && <div className="alert-box error" role="alert" data-testid="status-import-error"><CircleAlert size={15} />{importError}</div>}
          </aside>
          <div className="right-column">
            <div className="stats-strip">
              <div className="stat-box"><div className="stat-label">IN YOUR LIBRARY</div><div className="stat-number">{tracks.length}</div></div>
              <div className="stat-box"><div className="stat-label">MAP FOUND</div><div className="stat-number mint">{matchedCount + uncertainCount}</div></div>
              <div className="stat-box"><div className="stat-label">STILL HUNTING</div><div className="stat-number coral">{missingCount + pendingCount}</div></div>
            </div>
            <section className="panel results-panel">
              <div className="results-head">
                <div><h2 className="results-title">Your track list</h2><div className="results-sub">{tracks.length ? `${matches.length} of ${tracks.length} tracks checked` : 'A good place to start your next session'}</div></div>
                <div className="result-tools">
                  <div className="search-wrap"><Search size={13} /><input className="search-input" type="search" placeholder="Filter your tracks…" value={query} onChange={event => setQuery(event.target.value)} data-testid="input-filter-tracks" aria-label="Filter tracks" /></div>
                  {tracks.length > 0 && <button className="ghost-button" onClick={resetLibrary} data-testid="button-reset-library">Clear</button>}
                </div>
              </div>
              {tracks.length > 0 && <div className="filter-tabs" role="tablist" aria-label="Filter results">
                {([['all', `All ${tracks.length}`], ['matched', `Map found ${matchedCount + uncertainCount}`], ['missing', `No match ${missingCount}`]] as const).map(([key, label]) =>
                  <button key={key} role="tab" aria-selected={filter === key} className={`filter-tab${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)} data-testid={`tab-filter-${key}`}>{label}</button>)}
              </div>}
              {scanning && <div className="scan-banner" role="status" data-testid="status-scan-progress"><span className="scan-spin" /><div className="scan-copy"><strong>Listening through your library</strong><span>Checking {scanCurrent || 'your next track'} · {matches.length} of {tracks.length} complete</span><div className="progress-track"><div className="progress-fill" style={{ width: `${tracks.length ? Math.min(100, matches.length / tracks.length * 100) : 0}%` }} /></div></div><span className="confidence">{tracks.length ? Math.round(matches.length / tracks.length * 100) : 0}%</span></div>}
              {scanError && <div className="alert-box warning" role="alert" data-testid="status-scan-partial"><CircleAlert size={15} /><span>{scanError} {pendingCount > 0 && 'You can continue once the catalog is ready.'}</span></div>}
              {tracks.length === 0 ? <div className="empty-state">
                <div className="empty-orbit"><Music2 size={24} /></div><strong>Your library is the setlist.</strong>
                <p>Import an Apple Music XML export or a simple CSV to see which songs have maps waiting for you.</p>
              </div> : filtered.length === 0 ? <div className="empty-state">
                <div className="empty-orbit"><Search size={22} /></div><strong>No tracks in this corner.</strong><p>Try another filter or search phrase. Your library is still right here.</p>
              </div> : <div>
                <div className="table-head"><span>YOUR TRACK</span><span>BEATSAVER MAP</span><span>STATUS</span></div>
                <div>{filtered.map((track, index) => {
                  const result = matchByTrack.get(`${track.title}\u0000${track.artist}`);
                  const matched = result?.status === 'matched';
                  const uncertain = result?.status === 'uncertain';
                  const mapName = result?.map?.metadata.songName || result?.map?.name;
                  return <div className="track-row" key={`${track.title}-${track.artist}-${index}`} data-testid={`row-track-${index}`}>
                    <div className="track-main"><div className="track-title" title={track.title}>{track.title}</div><div className="track-artist">{track.artist}{track.album ? ` · ${track.album}` : ''}</div></div>
                    <div className="track-main">{mapName ? <><a className="map-title" href={`https://beatsaver.com/maps/${result?.map?.id}`} target="_blank" rel="noreferrer" data-testid={`link-map-${index}`}>{mapName} <ArrowUpRight size={10} style={{ display: 'inline' }} /></a><div className="map-by">{result?.map?.metadata.songAuthorName || 'Artist not listed'} · mapped by {result?.map?.metadata.levelAuthorName || 'community'}</div></> : <span className="map-by">{result ? 'No close map found' : scanning ? 'Waiting in queue…' : 'Not checked yet'}</span>}</div>
                    <div>{result ? matched ? <span className="status-pill matched"><Check size={10} /> Strong match</span> : uncertain ? <span className="status-pill uncertain"><Sparkles size={10} /> Maybe <span className="confidence">{result.confidence}%</span></span> : <span className="status-pill missing">No map found</span> : <span className="status-pill missing">Queued</span>}</div>
                  </div>;
                })}</div>
                {filtered.length < tracks.length && <div className="results-foot"><span>Showing {filtered.length} of {tracks.length} tracks</span><button className="link-button" onClick={() => { setQuery(''); setFilter('all'); }}>Show all tracks</button></div>}
              </div>}
              {tracks.length > 0 && matches.length === tracks.length && !scanning && !scanError && <div className="results-foot" data-testid="status-scan-complete"><span><ShieldCheck size={13} style={{ verticalAlign: 'middle', marginRight: 5, color: '#368267' }} />All tracks checked · matches ranked by title and artist</span><span>{matchedCount} confident · {uncertainCount} to review</span></div>}
              {tracks.length > 0 && tracks.length === matches.length && missingCount === tracks.length && !scanning && <div className="results-foot"><span>No BeatSaver maps surfaced for this selection.</span></div>}
            </section>
            <div className="bottom-note"><ShieldCheck size={13} /> Private by design <span>·</span> Only search terms reach BeatSaver <span>·</span> No account needed</div>
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
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
