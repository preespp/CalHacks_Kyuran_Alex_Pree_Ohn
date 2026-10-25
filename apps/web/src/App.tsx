import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  Compass,
  Grid,
  History,
  Info,
  LoaderCircle,
  MapPin,
  Maximize2,
  MoreHorizontal,
  Scan,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { api, ApiError, timeAgo, userFacingError } from './api';
import CapturePanel from './components/CapturePanel';
import EvidenceImage from './components/EvidenceImage';
import GuestEntry from './components/GuestEntry';
import { RotatingText } from './components/reactbits';
import type { ChatResponse, Health, MemoryObject, Observation, Session } from './types';

function sourceName(source: Observation['source']): string {
  switch (source) {
    case 'sample':
      return 'Sample illustration';
    case 'gemini':
      return 'Camera observation';
    case 'reported':
      return 'Location report';
  }
}

function loadSession(): Session | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem('commonplace-guest-session') ??
        sessionStorage.getItem('commonplace-session') ??
        'null',
    );
    return value?.token && value?.member ? value : null;
  } catch {
    return null;
  }
}

// Preset room choices for Pre-Scan step
const PRESET_ROOMS = [
  { name: 'Living room', emoji: '🛋️', hint: 'Sofa, coffee table, media center' },
  { name: 'Kitchen', emoji: '🍳', hint: 'Countertops, island, dining table' },
  { name: 'Bathroom', emoji: '🛁', hint: 'Vanity, mirror shelf, cabinet' },
  { name: 'Bedroom', emoji: '🛏️', hint: 'Nightstand, desk, wardrobe' },
  { name: 'Office', emoji: '💼', hint: 'Desk, monitor, electronics' },
  { name: 'Entryway', emoji: '🚪', hint: 'Console table, key tray, hooks' },
  { name: 'Dining room', emoji: '🍽️', hint: 'Dining table, sideboard' },
  { name: 'Studio', emoji: '🎨', hint: 'Work station, camera equipment' },
];

function getSourceBadge(item: MemoryObject): { text: string; color: 'lime' | 'blue' | 'pink' } {
  switch (item.latest.source) {
    case 'sample':
      return { text: 'Sample illustration', color: 'blue' };
    case 'gemini':
      return { text: 'Camera observation', color: 'lime' };
    case 'reported':
      return { text: 'Location report', color: 'pink' };
  }
}

function getDepth(item: MemoryObject): string {
  const rank = item.latest.spatial?.depth_rank;
  return typeof rank === 'number' ? `Relative rank ${rank}` : 'Not available';
}

// Deterministic coordinates for markers inside the embedded 3D map
function getMarkerPosition(index: number) {
  const defaultPositions = [
    { top: '34%', left: '26%' },
    { top: '28%', left: '68%' },
    { top: '42%', left: '48%' },
    { top: '24%', left: '38%' },
    { top: '48%', left: '76%' },
  ];
  return defaultPositions[index % defaultPositions.length];
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<MemoryObject[]>([]);
  const [events, setEvents] = useState<Observation[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('All rooms');
  const [selectedObject, setSelectedObject] = useState<MemoryObject | null>(null);
  const [page, setPage] = useState<'overview' | 'objects' | 'activity' | 'detail'>('overview');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [switchingProfile, setSwitchingProfile] = useState(false);

  // Space categorization & Interactive 3D map in My Objects page
  const [activeSpace, setActiveSpace] = useState<string>('All');
  const [activeMapObjectId, setActiveMapObjectId] = useState<string | null>(null);

  // Scan modal state: Step 1 (Room Selection) -> Step 2 (Capture)
  const [scanModal, setScanModal] = useState(false);
  const [scanStep, setScanStep] = useState<'select-room' | 'capture'>('select-room');
  const [scanRoom, setScanRoom] = useState('Living room');
  const [customRoom, setCustomRoom] = useState('');
  const [photoMode, setPhotoMode] = useState<'original' | 'depth'>('original');
  const [photoViewer, setPhotoViewer] = useState(false);

  // Modals
  const [infoModal, setInfoModal] = useState(false);
  const [profileModal, setProfileModal] = useState(() => !loadSession());

  // Conversational Ask Muse state
  const [museInput, setMuseInput] = useState('');
  const [museAnswer, setMuseAnswer] = useState(
    'I can help you remember where anything is. Try asking about your keys, camera, or adapter.',
  );
  const [museMatches, setMuseMatches] = useState<MemoryObject[]>([]);
  const [museError, setMuseError] = useState('');
  const [museBusy, setMuseBusy] = useState(false);

  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<Observation[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [roomDraft, setRoomDraft] = useState('');
  const [locationDraft, setLocationDraft] = useState('');
  const [noteKind, setNoteKind] = useState<'moved' | 'found' | 'correction'>('moved');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 220);
    return () => clearTimeout(timer);
  }, [query]);

  // Keep the page synchronized with the household memory store.
  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    const activeSession = session;
    let cancelled = false;
    let running = false;
    const controller = new AbortController();
    async function loadData() {
      if (running) return;
      running = true;
      try {
        const params = new URLSearchParams({ q: search });
        if (roomFilter !== 'All rooms') params.set('room', roomFilter);
        const [objRes, healthRes, activityRes] = await Promise.all([
          api<{ objects: MemoryObject[] }>(`/api/objects?${params}`, activeSession.token, {
            signal: controller.signal,
          }),
          api<Health>('/api/health', undefined, { signal: controller.signal }),
          api<{ events: Observation[] }>('/api/activity', activeSession.token, {
            signal: controller.signal,
          }),
        ]);
        if (!cancelled) {
          setItems(objRes.objects);
          setHealth(healthRes);
          setEvents(activityRes.events);
          setError('');
          setLoading(false);
          setSelectedObject((current) =>
            current ? (objRes.objects.find((item) => item.id === current.id) ?? current) : null,
          );
          if (objRes.objects.length > 0 && !activeMapObjectId) {
            setActiveMapObjectId(objRes.objects[0].id);
          }
        }
      } catch (failure) {
        if (!cancelled && !controller.signal.aborted) {
          setError(
            failure instanceof ApiError && failure.status === 404
              ? 'Household memory is unavailable right now. Please try again shortly.'
              : failure instanceof Error
                ? failure.message
                : 'Could not load household memory.',
          );
          setLoading(false);
          if (failure instanceof ApiError && failure.status === 401) {
            sessionStorage.removeItem('commonplace-guest-session');
            sessionStorage.removeItem('commonplace-session');
            setSession(null);
            setProfileModal(true);
          }
        }
      } finally {
        running = false;
      }
    }
    void loadData();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadData();
    }, 5000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [session, revision, search, roomFilter]);

  useEffect(() => {
    if (!selectedObject || !session) {
      setHistory([]);
      setHistoryError('');
      return;
    }
    const controller = new AbortController();
    setRoomDraft(selectedObject.latest.room);
    setLocationDraft(selectedObject.latest.location);
    api<{ observations: Observation[] }>(
      `/api/objects/${encodeURIComponent(selectedObject.id)}/history`,
      session.token,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setHistory(result.observations);
          setHistoryError('');
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setHistoryError(
            failure instanceof Error ? failure.message : 'Could not load observation history.',
          );
        }
      });
    return () => controller.abort();
  }, [selectedObject?.id, selectedObject?.latest.id, session]);

  // Unique rooms
  const rooms = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.latest?.room) set.add(item.latest.room);
    });
    events.forEach((event) => {
      if (event.room) set.add(event.room);
    });
    return ['All rooms', ...Array.from(set)];
  }, [items, events]);

  // Objects filtered for overview query & filter
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesRoom = roomFilter === 'All rooms' || item.latest?.room === roomFilter;
      const q = query.toLowerCase().trim();
      const matchesQuery =
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.latest?.room.toLowerCase().includes(q) ||
        item.latest?.location.toLowerCase().includes(q) ||
        item.appearance.toLowerCase().includes(q);
      return matchesRoom && matchesQuery;
    });
  }, [items, roomFilter, query]);

  // Objects grouped by room for "My Objects" space categorization
  const spaceCategories = useMemo(() => {
    const map = new Map<string, MemoryObject[]>();
    items.forEach((item) => {
      const room = item.latest?.room || 'Living room';
      if (!map.has(room)) map.set(room, []);
      map.get(room)!.push(item);
    });
    return map;
  }, [items]);

  // Active items for "My Objects" 3D Map
  const spaceItems = useMemo(() => {
    if (activeSpace === 'All') return items;
    return items.filter((item) => (item.latest?.room || 'Living room') === activeSpace);
  }, [items, activeSpace]);

  // Keep active map object aligned with space
  useEffect(() => {
    if (spaceItems.length > 0) {
      if (!spaceItems.some((it) => it.id === activeMapObjectId)) {
        setActiveMapObjectId(spaceItems[0].id);
      }
    } else {
      setActiveMapObjectId(null);
    }
  }, [spaceItems, activeMapObjectId]);

  async function handleAskMuse(question: string) {
    const message = question.trim();
    if (!message || !session || museBusy) return;
    setMuseInput('');
    setMuseError('');
    setMuseMatches([]);
    setMuseBusy(true);
    try {
      if (health?.assistant_provider === 'muse' || health?.assistant_provider === 'gemini') {
        const result = await api<ChatResponse>('/api/chat', session.token, {
          method: 'POST',
          body: JSON.stringify({ message }),
        });
        setMuseAnswer(result.answer);
        setMuseMatches(result.matches);
      } else {
        const result = await api<{
          matches: MemoryObject[];
          needs_disambiguation: boolean;
          guidance: string;
        }>(`/api/connector/search?${new URLSearchParams({ q: message })}`, session.token);
        setMuseMatches(result.matches);
        setMuseAnswer(
          result.matches.length
            ? `${result.guidance} I found ${result.matches.length} matching ${result.matches.length === 1 ? 'memory' : 'memories'} in your household.`
            : result.guidance,
        );
      }
    } catch (failure) {
      setMuseError(
        failure instanceof Error
          ? userFacingError(failure.message, '/api/chat')
          : 'Could not search household memory.',
      );
    } finally {
      setMuseBusy(false);
    }
  }

  function handleOpenScanModal() {
    setScanStep('select-room');
    setScanModal(true);
  }

  function handleConfirmRoom() {
    if (customRoom.trim()) {
      setScanRoom(customRoom.trim());
      setCustomRoom('');
    }
    setScanStep('capture');
  }

  async function joinGuest(name: string, userId?: string) {
    if (switchingProfile) return;
    setSwitchingProfile(true);
    setError('');
    try {
      const val = await api<Session>('/api/guest/session', session?.token, {
        method: 'POST',
        body: JSON.stringify(userId ? { user_id: userId } : { name }),
      });
      sessionStorage.setItem('commonplace-guest-session', JSON.stringify(val));
      sessionStorage.removeItem('commonplace-session');
      setSession(val);
      setItems([]);
      setEvents([]);
      setHealth(null);
      setSelectedObject(null);
      setLoading(true);
      setQuery('');
      setSearch('');
      setRoomFilter('All rooms');
      setRevision((value) => value + 1);
      setProfileModal(false);
    } finally {
      setSwitchingProfile(false);
    }
  }

  async function leaveGuest() {
    if (!session || switchingProfile) return;
    setSwitchingProfile(true);
    setError('');
    try {
      await api<void>('/api/guest/session', session.token, { method: 'DELETE' });
      sessionStorage.removeItem('commonplace-guest-session');
      sessionStorage.removeItem('commonplace-session');
      setSession(null);
      setItems([]);
      setEvents([]);
      setHealth(null);
      setSelectedObject(null);
      setProfileModal(true);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        sessionStorage.removeItem('commonplace-guest-session');
        sessionStorage.removeItem('commonplace-session');
        setSession(null);
        setProfileModal(true);
      } else {
        setError(
          failure instanceof Error ? failure.message : 'Could not leave this household session.',
        );
      }
    } finally {
      setSwitchingProfile(false);
    }
  }

  async function handleSaveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedObject || savingNote) return;
    setSavingNote(true);
    setError('');
    try {
      const result = await api<{ observations: Observation[] }>(
        `/api/objects/${encodeURIComponent(selectedObject.id)}/notes`,
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            room: roomDraft.trim(),
            location: locationDraft.trim(),
            kind: noteKind,
          }),
        },
      );
      setHistory(result.observations);
      setHistoryError('');
      setRevision((value) => value + 1);
    } catch (failure) {
      setHistoryError(
        failure instanceof Error
          ? userFacingError(failure.message, '/api/objects/notes')
          : 'Could not update this location.',
      );
    } finally {
      setSavingNote(false);
    }
  }

  async function handleOpenActivity(event: Observation) {
    const item = items.find((candidate) => candidate.id === event.object_id);
    if (item) {
      setSelectedObject(item);
      setPage('detail');
      return;
    }
    if (!session) return;
    try {
      const queryText = event.label || event.location;
      const result = await api<{ objects: MemoryObject[] }>(
        `/api/objects?${new URLSearchParams({ q: queryText })}`,
        session.token,
      );
      const match = result.objects.find((candidate) => candidate.id === event.object_id);
      if (match) {
        setSelectedObject(match);
        setPage('detail');
      } else {
        setError('That memory is no longer available in the current household.');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open this memory.');
    }
  }

  const currentDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date());

  const latestMemory = items.reduce<MemoryObject | null>(
    (latest, item) =>
      !latest || Date.parse(item.latest.observed_at) > Date.parse(latest.latest.observed_at)
        ? item
        : latest,
    null,
  );
  const latestScanRoom = latestMemory?.latest.room || 'No memories yet';
  const activeTargetItem = items.find((it) => it.id === activeMapObjectId);

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={17} strokeWidth={2.2} />
          </span>
          <span>Muse</span>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          <button
            type="button"
            className={`nav-item ${page === 'overview' ? 'active' : ''}`}
            onClick={() => {
              setPage('overview');
              setSelectedObject(null);
            }}
          >
            <Grid size={18} />
            <span>Overview</span>
          </button>
          <button
            type="button"
            className={`nav-item ${page === 'objects' ? 'active' : ''}`}
            onClick={() => {
              setPage('objects');
              setSelectedObject(null);
            }}
          >
            <Boxes size={18} />
            <span>My objects</span>
            <span className="count">{items.length}</span>
          </button>
          <button
            type="button"
            className={`nav-item ${page === 'activity' ? 'active' : ''}`}
            onClick={() => {
              setPage('activity');
              setSelectedObject(null);
            }}
          >
            <History size={18} />
            <span>Recent activity</span>
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => setInfoModal(true)}
          >
            <Info size={18} />
            <span>How it works</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="storage">
            <div className="storage-row">
              <span>Memory space</span>
              <span>{items.length} items</span>
            </div>
            <div className="progress">
              <span style={{ width: `${Math.min(items.length * 4, 100)}%` }}></span>
            </div>
            <p>Remembered in your household</p>
          </div>

          <button
            type="button"
            className="profile"
            onClick={() => setProfileModal(true)}
            title="Click to switch profile"
          >
            <div className="avatar">
              {session?.member?.name?.slice(0, 2).toUpperCase() || 'AM'}
            </div>
            <div>
              <strong>{session?.member?.name || 'Alex Morgan'}</strong>
              <span>Personal space</span>
            </div>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main">
        {/* Topbar: Rendered on all pages EXCEPT object detail page */}
        {!(selectedObject && page === 'detail') && (
          <header className="topbar">
            <div>
              <p className="eyebrow">{currentDate.toUpperCase()}</p>
              <h1>
                Good memory,{' '}
                <RotatingText
                  words={[
                    'key.',
                    'paint blush.',
                    'nail clipper.',
                    'eye drops.',
                  ]}
                  interval={3200}
                />
              </h1>
            </div>

            <div className="top-actions">
              <label className="search">
                <Search size={18} />
                <input
                  placeholder="Search your memory"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>

              {/* Native clean scan button without StarBorder */}
              <button
                type="button"
                className="scan-button"
                onClick={handleOpenScanModal}
                disabled={!session || !health}
              >
                <Camera size={18} />
                <span>New scan</span>
              </button>
            </div>
          </header>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              Retry
            </button>
          </div>
        )}

        {/* View Router */}
        {selectedObject && page === 'detail' ? (
          /* ========================================================================= */
          /* Object Detail Page (Matching Figma Design)                                */
          /* ========================================================================= */
          <div className="detail-view">
            <header className="detail-topbar">
              <button
                type="button"
                className="back-button"
                onClick={() => {
                  setPage('objects');
                  setSelectedObject(null);
                }}
              >
                <ArrowLeft size={16} />
                <span>All objects</span>
              </button>
              <div className="detail-actions">
                <span className="remembered-status">
                  <i></i> Remembered
                </span>
                <button
                  type="button"
                  className="detail-more"
                  aria-label="More options"
                  onClick={() => setInfoModal(true)}
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
            </header>

            <section className="detail-heading">
              <div>
                <p className="eyebrow">
                  {selectedObject.latest.room.toUpperCase()} · LAST SEEN {timeAgo(selectedObject.latest.observed_at).toUpperCase()}
                </p>
                <h1>{selectedObject.label}</h1>
              </div>
              <button
                type="button"
                className="update-memory-button"
                onClick={handleOpenScanModal}
              >
                <Scan size={18} />
                <span>Update memory</span>
              </button>
            </section>

            {/* 3D Spatial Room Visualizer (Top Full-Width Card) */}
            <section className="detail-scene-card">
              <div className="detail-room-copy">
                <p className="eyebrow light">SPATIAL MEMORY</p>
                <h2>{selectedObject.latest.location}</h2>
                <span>Illustrative room view. Use the saved evidence below for the last-seen image.</span>
              </div>

              <div className="room-scene detail-room-scene">
                <div className="depth-grid"></div>
                <div className="object-marker detail-marker">
                  <span className="marker-dot"></span>
                  <div>
                    <b>{selectedObject.label}</b>
                    <small>{getDepth(selectedObject)}</small>
                  </div>
                </div>
                <div className="sofa">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <svg
                  className="plant-vine"
                  viewBox="0 0 32 140"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M16 4C7 24 7 44 16 64C25 84 25 104 16 124C12 131 14 136 16 138"
                    stroke="#5d8270"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="console-table">
                  <i></i>
                </div>
                <div className="depth-label">
                  ROOM MAP · {selectedObject.latest.room.toUpperCase()}
                </div>
              </div>

              <div className="detail-scene-foot">
                <span>
                  <MapPin size={16} /> {selectedObject.latest.room}
                </span>
                <span>
                  Evidence <strong>{sourceName(selectedObject.latest.source)}</strong>
                </span>
              </div>
            </section>

            {/* Bottom 2-Column Section: Evidence Card + Muse Explains & Metadata */}
            <section className="detail-content">
              {/* Left Column: LAST-SEEN EVIDENCE / What Muse saw */}
              <article className="evidence-card">
                <div className="detail-section-title">
                  <div>
                    <p className="eyebrow">LAST-SEEN EVIDENCE</p>
                    <h2>What Muse saw</h2>
                  </div>
                  <span>{timeAgo(selectedObject.latest.observed_at)}</span>
                </div>

                <div className="photo-viewer">
                  <div className="photo-toolbar">
                    <div className="photo-tabs">
                      <button
                        type="button"
                        className={photoMode === 'original' ? 'active' : ''}
                        onClick={() => setPhotoMode('original')}
                      >
                        Original
                      </button>
                      <button
                        type="button"
                        className={photoMode === 'depth' ? 'active' : ''}
                        onClick={() => setPhotoMode('depth')}
                      >
                        Depth map
                      </button>
                    </div>

                    <button
                      type="button"
                      className="expand-photo"
                      onClick={() => setPhotoViewer(true)}
                    >
                      <Maximize2 size={13} />
                      <span>Expand</span>
                    </button>
                  </div>

                  <div
                    className={`photo-stage ${photoMode}`}
                    onClick={() => setPhotoViewer(true)}
                  >
                    {session?.token ? (
                      <EvidenceImage
                        observation={selectedObject.last_visual}
                        token={session.token}
                        highlight={true}
                        depthMode={photoMode === 'depth'}
                      />
                    ) : (
                      <div className="image-placeholder">Photo unavailable</div>
                    )}
                  </div>
                </div>
              </article>

              {/* Right Column: Muse Explains + Object Metadata */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Card 1: MUSE EXPLAINS / Where to look */}
                <div className="muse-explains">
                  <div className="muse-explains-head">
                    <span className="muse-orb">
                      <Sparkles size={18} strokeWidth={2.2} />
                    </span>
                    <div>
                      <p className="eyebrow">MUSE EXPLAINS</p>
                      <h2>Where to look</h2>
                    </div>
                  </div>

                  <p>
                    The latest saved observation places your{' '}
                    <strong>{selectedObject.label.toLowerCase()}</strong> in the{' '}
                    <strong>{selectedObject.latest.room.toLowerCase()}</strong>, at{' '}
                    {selectedObject.latest.location.toLowerCase()}. This record describes where it
                    was last seen; it does not confirm the object is still there.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setPage('overview');
                      handleAskMuse(`Where is my ${selectedObject.label}?`);
                    }}
                  >
                    <span>Ask Muse a follow-up</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                {/* Card 2: OBJECT METADATA */}
                <div className="metadata-card">
                  <p className="eyebrow">OBJECT METADATA</p>
                  <dl>
                    <div>
                      <dt>Room</dt>
                      <dd>{selectedObject.latest.room}</dd>
                    </div>
                    <div>
                      <dt>Specific location</dt>
                      <dd>{selectedObject.latest.location}</dd>
                    </div>
                    <div>
                      <dt>Spatial estimate</dt>
                      <dd>{getDepth(selectedObject)}</dd>
                    </div>
                    <div>
                      <dt>Evidence</dt>
                      <dd>{sourceName(selectedObject.latest.source)}</dd>
                    </div>
                    <div>
                      <dt>Last seen</dt>
                      <dd>{timeAgo(selectedObject.latest.observed_at)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="metadata-card location-update-card">
                  <p className="eyebrow">UPDATE LOCATION</p>
                  <form className="location-update-form" onSubmit={(event) => void handleSaveLocation(event)}>
                    <label>
                      Room
                      <input
                        required
                        maxLength={80}
                        value={roomDraft}
                        onChange={(event) => setRoomDraft(event.target.value)}
                      />
                    </label>
                    <label>
                      Specific location
                      <input
                        required
                        maxLength={300}
                        value={locationDraft}
                        onChange={(event) => setLocationDraft(event.target.value)}
                      />
                    </label>
                    <label>
                      Update type
                      <select
                        value={noteKind}
                        onChange={(event) =>
                          setNoteKind(event.target.value as 'moved' | 'found' | 'correction')
                        }
                      >
                        <option value="moved">I moved it</option>
                        <option value="found">I found it here</option>
                        <option value="correction">Correct the last location</option>
                      </select>
                    </label>
                    {historyError && (
                      <p className="error" role="alert">
                        {historyError}
                      </p>
                    )}
                    <button className="primary-button" type="submit" disabled={savingNote}>
                      {savingNote ? 'Saving…' : 'Update location'}
                    </button>
                  </form>
                  <details className="history-details">
                    <summary>Observation history ({history.length})</summary>
                    {history.map((observation) => (
                      <div className="history-entry" key={observation.id}>
                        <strong>{observation.room}</strong>
                        <span>{observation.location}</span>
                        <small>
                          {sourceName(observation.source)} · {timeAgo(observation.observed_at)}
                        </small>
                      </div>
                    ))}
                    {!history.length && !historyError && <p>No earlier observations.</p>}
                  </details>
                </div>
              </div>
            </section>
          </div>
        ) : page === 'objects' ? (
          /* ========================================================================= */
          /* 2. "My Objects" Page: Room Categorization & Interactive 3D Embedded Map     */
          /* ========================================================================= */
          <div className="objects-page">
            <div className="section-head">
              <div>
                <p className="eyebrow">SPACE & ROOM CATEGORIES</p>
                <h2>My objects</h2>
              </div>
            </div>

            {/* Space/Room Category Selector Pills */}
            <div className="space-category-pills">
              <button
                type="button"
                className={`space-pill ${activeSpace === 'All' ? 'active' : ''}`}
                onClick={() => setActiveSpace('All')}
              >
                <span>🏠 All Spaces</span>
                <span className="pill-count">{items.length}</span>
              </button>

              {Array.from(spaceCategories.entries()).map(([roomName, roomItems]) => (
                <button
                  key={roomName}
                  type="button"
                  className={`space-pill ${activeSpace === roomName ? 'active' : ''}`}
                  onClick={() => setActiveSpace(roomName)}
                >
                  <span>
                    {roomName.toLowerCase().includes('kitchen')
                      ? '🍳'
                      : roomName.toLowerCase().includes('bath')
                        ? '🛁'
                        : roomName.toLowerCase().includes('bed')
                          ? '🛏️'
                          : roomName.toLowerCase().includes('entry')
                            ? '🚪'
                            : roomName.toLowerCase().includes('office')
                              ? '💼'
                              : '🛋️'}{' '}
                    {roomName}
                  </span>
                  <span className="pill-count">{roomItems.length}</span>
                </button>
              ))}
            </div>

            {/* Embedded 3D Map Space Container */}
            <div className="embedded-map-space">
              <div className="map-space-header">
                <h2>
                  <Compass size={20} />
                  <span>
                    {activeSpace === 'All' ? 'Whole Household 3D Map' : `${activeSpace} 3D Mapped Space`}
                  </span>
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="map-tag">Room visualization</span>
                  <span style={{ fontSize: 11, color: '#aab8b0' }}>
                    Marker positions are illustrative
                  </span>
                </div>
              </div>

              {/* 3D Scene Viewport with interactive markers */}
              <div className="interactive-3d-scene">
                <div className="depth-grid"></div>
                <div className="sofa">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div className="plant">⌇</div>
                <div className="console-table"></div>

                {/* Render pins for objects in this space */}
                {spaceItems.map((item, idx) => {
                  const pos = getMarkerPosition(idx);
                  const isSelected = item.id === activeMapObjectId;
                  return (
                    <div
                      key={item.id}
                      className={`object-marker ${isSelected ? 'active-marker' : ''}`}
                      style={{ top: pos.top, left: pos.left, zIndex: isSelected ? 10 : 3 }}
                      onClick={() => setActiveMapObjectId(item.id)}
                    >
                      {/* Beacon ripple ring when highlighted */}
                      {isSelected && <span className="marker-beacon"></span>}
                      <span className="marker-dot"></span>
                      <div>
                        <b>{item.label}</b>
                        <small>
                          {getDepth(item)} · {item.latest.location}
                        </small>
                      </div>
                    </div>
                  );
                })}

                <div className="depth-label">
                  ROOM MAP · {spaceItems.length} OBJECTS
                </div>
              </div>

              {/* Banner showing the currently marked target */}
              {activeTargetItem && (
                <div
                  className="map-active-bar"
                  style={{
                    background: '#1d2c26',
                    padding: '12px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        background: '#c7ed68',
                        color: '#1a2e26',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontWeight: 700,
                        fontSize: 10,
                      }}
                    >
                      3D MARKER ACTIVE
                    </span>
                    <span>
                      Locating: <strong>{activeTargetItem.label}</strong> in{' '}
                      <strong>{activeTargetItem.latest.room}</strong> ({activeTargetItem.latest.location}) · Spatial estimate: {getDepth(activeTargetItem)}
                    </span>
                  </div>
                  <button
                    type="button"
                    style={{
                      color: '#d9f697',
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    onClick={() => {
                      setSelectedObject(activeTargetItem);
                      setPage('detail');
                    }}
                  >
                    Inspect Description & Depth <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* List of Objects under this Room / Space */}
            <div className="section-head" style={{ marginTop: 20 }}>
              <div>
                <p className="eyebrow">OBJECTS UNDER THIS SPACE</p>
                <h2>
                  {activeSpace === 'All' ? 'All Recognized Objects' : `${activeSpace} Inventory`} (
                  {spaceItems.length})
                </h2>
              </div>
            </div>

            <div className="object-grid">
              {spaceItems.map((item) => {
                const badge = getSourceBadge(item);
                const depth = getDepth(item);
                const isSelected = item.id === activeMapObjectId;
                return (
                  <article
                    key={item.id}
                    className={`object-card map-object-card ${isSelected ? 'active-target' : ''}`}
                    onClick={() => setActiveMapObjectId(item.id)}
                  >
                    <div className="image-wrap">
                      {session?.token ? (
                        <EvidenceImage
                          observation={item.last_visual}
                          token={session.token}
                          highlight={false}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: '#e2dfd5' }} />
                      )}
                      <span className={`confidence ${badge.color}`}>{badge.text}</span>
                    </div>

                    <div className="object-info">
                      {isSelected && (
                        <span className="active-indicator-tag">
                          <Check size={12} strokeWidth={3} /> Marked on 3D Map
                        </span>
                      )}

                      <div className="object-title">
                        <h3>{item.label}</h3>
                        <ChevronRight size={16} />
                      </div>

                      <p>
                        <MapPin size={13} />
                        {item.latest?.room || 'Living room'}
                      </p>
                      <span>{item.latest?.location || 'On the desk surface'}</span>

                      <div className="object-meta">
                        <span>
                          <i className={badge.color}></i>
                          Spatial: {depth}
                        </span>
                        <span>{timeAgo(item.latest?.observed_at || new Date().toISOString())}</span>
                      </div>

                      <button
                        type="button"
                        style={{
                          marginTop: 12,
                          padding: '7px 12px',
                          background: isSelected ? '#263730' : '#f0ece3',
                          color: isSelected ? '#fff' : '#4f4a44',
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          width: '100%',
                          transition: 'all 0.15s',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedObject(item);
                          setPage('detail');
                        }}
                      >
                        <span>View description & evidence</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {!loading && spaceItems.length === 0 && (
              <div className="empty-state">
                <Boxes size={28} />
                <h3>No objects in this space yet</h3>
                <p>Scan a room to add saved observations to your household memory.</p>
                <button className="secondary-button" onClick={handleOpenScanModal}>
                  Scan a room
                </button>
              </div>
            )}
          </div>
        ) : page === 'activity' ? (
          <section className="objects-section activity-section">
            <div className="section-head">
              <div>
                <p className="eyebrow">HOUSEHOLD TIMELINE</p>
                <h2>Recent activity</h2>
              </div>
            </div>
            {loading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={24} />
                <p>Loading household activity…</p>
              </div>
            ) : events.length ? (
              <div className="timeline">
                {events.map((event) => (
                  <button
                    type="button"
                    className="timeline-row"
                    key={event.id}
                    onClick={() => void handleOpenActivity(event)}
                  >
                    <span className="avatar">
                      <Camera size={18} />
                    </span>
                    <span className="timeline-copy">
                      <strong>{event.label || 'Remembered object'}</strong>
                      <span>{event.kind === 'seen' ? 'was seen' : 'location updated'}</span>
                      <small>
                        {event.room} · {event.location}
                      </small>
                      <small className="timeline-source">{sourceName(event.source)}</small>
                    </span>
                    <time dateTime={event.observed_at}>{timeAgo(event.observed_at)}</time>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <History size={28} />
                <h3>No activity yet</h3>
                <p>Scan a room or update an object location to start your household timeline.</p>
              </div>
            )}
          </section>
        ) : (
          /* ========================================================================= */
          /* Overview View (Default)                                                  */
          /* ========================================================================= */
          <>
            {/* Hero Grid */}
            <section className="hero-grid">
              {/* Scene Card */}
              <div className="scene-card">
                <div className="scene-head">
                  <div>
                    <p className="eyebrow light">LATEST MEMORY</p>
                    <h2>{latestScanRoom}</h2>
                  </div>
                  <span className="live-dot">
                    <i></i> {latestMemory ? `Updated ${timeAgo(latestMemory.latest.observed_at)}` : 'No scans yet'}
                  </span>
                </div>

                <div className="room-scene">
                  <div className="depth-grid"></div>
                  <div className="sofa">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="plant">⌇</div>
                  <div className="console-table"></div>

                  {/* Dynamic Markers */}
                  {items.slice(0, 2).map((item, idx) => (
                    <div
                      key={item.id}
                      className={`object-marker ${idx === 0 ? 'key-marker' : 'camera-marker'}`}
                      onClick={() => {
                        setSelectedObject(item);
                        setPage('detail');
                      }}
                    >
                      <span className="marker-dot"></span>
                      <div>
                        <b>{item.label}</b>
                        <small>{getDepth(item)}</small>
                      </div>
                    </div>
                  ))}

                  <div className="depth-label">
                    SPATIAL MAP · {items.length} OBJECTS
                  </div>
                </div>

                <div className="scene-foot">
                  <span>
                    <Boxes size={16} />
                    {items.length} objects remembered
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPage('objects');
                    }}
                  >
                    Explore all spaces <ArrowRight size={14} />
                  </button>
                </div>
              </div>

              {/* Ask Muse Card */}
              <aside className="muse-card">
                <div className="muse-title">
                  <span className="muse-orb">
                    <Sparkles size={20} strokeWidth={2.2} />
                  </span>
                  <div>
                    <p className="eyebrow">YOUR MEMORY COMPANION</p>
                    <h2>Ask Muse</h2>
                  </div>
                </div>

                <div className="chat-bubble" aria-live="polite">
                  {museBusy ? 'Checking your household memories…' : museAnswer}
                </div>
                {museError && (
                  <p className="error" role="alert">
                    {museError}
                  </p>
                )}
                {!!museMatches.length && (
                  <div className="muse-results" aria-label="Matching memories">
                    {museMatches.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          setSelectedObject(item);
                          setPage('detail');
                        }}
                      >
                        <strong>{item.label}</strong>
                        <span>
                          {item.latest.room} · {item.latest.location}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="suggestions">
                  <button
                    type="button"
                    disabled={!session || museBusy}
                    onClick={() => handleAskMuse('Where are my house keys?')}
                  >
                    Where are my house keys?
                  </button>
                  <button
                    type="button"
                    disabled={!session || museBusy}
                    onClick={() => handleAskMuse('What did I leave in the studio?')}
                  >
                    What did I leave in the studio?
                  </button>
                  <button
                    type="button"
                    disabled={!session || museBusy}
                    onClick={() => handleAskMuse('Where is the blue water bottle?')}
                  >
                    Where is the blue water bottle?
                  </button>
                </div>

                <form
                  className="ask-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleAskMuse(museInput);
                  }}
                >
                  <input
                    placeholder="Ask about anything..."
                    aria-label="Ask Muse"
                    value={museInput}
                    onChange={(e) => setMuseInput(e.target.value)}
                    disabled={!session || museBusy}
                  />
                  <button
                    type="submit"
                    className="send"
                    aria-label="Send query"
                    disabled={!session || museBusy || !museInput.trim()}
                  >
                    {museBusy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                  </button>
                </form>

                <p className="private-note">
                  Shared with your household · memories describe the last saved observation.
                </p>
              </aside>
            </section>

            {/* Objects Section */}
            <section className="objects-section">
              <div className="section-head">
                <div>
                  <p className="eyebrow">RECENTLY REMEMBERED</p>
                  <h2>Your objects</h2>
                </div>

                <div className="room-filters">
                  {rooms.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={roomFilter === r ? 'selected' : ''}
                      onClick={() => setRoomFilter(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="object-grid">
                {filteredItems.map((item) => {
                  const badge = getSourceBadge(item);
                  const depth = getDepth(item);
                  return (
                    <article
                      key={item.id}
                      className="object-card"
                      onClick={() => {
                        setSelectedObject(item);
                        setPage('detail');
                      }}
                    >
                      <div className="image-wrap">
                        {session?.token ? (
                          <EvidenceImage
                            observation={item.last_visual}
                            token={session.token}
                            highlight={false}
                          />
                        ) : (
                          <div style={{ width: '100%', height: '100%', background: '#e2dfd5' }} />
                        )}
                        <span className={`confidence ${badge.color}`}>{badge.text}</span>
                      </div>

                      <div className="object-info">
                        <div className="object-title">
                          <h3>{item.label}</h3>
                          <ChevronRight size={16} />
                        </div>
                        <p>
                          <MapPin size={13} />
                          {item.latest?.room || 'Living room'}
                        </p>
                        <span>{item.latest?.location || 'On the desk surface'}</span>

                        <div className="object-meta">
                          <span>
                            <i className={badge.color}></i>
                            Spatial: {depth}
                          </span>
                          <span>{timeAgo(item.latest?.observed_at || new Date().toISOString())}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!loading && filteredItems.length === 0 && (
                <div className="empty-state">
                  <Search size={28} />
                  <h3>{query || roomFilter !== 'All rooms' ? 'No matching memories' : 'No memories yet'}</h3>
                  <p>
                    {query || roomFilter !== 'All rooms'
                      ? 'Try another search or clear the room filter.'
                      : 'Scan a room to begin building your household memory.'}
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setQuery('');
                      setRoomFilter('All rooms');
                      if (!health?.vision_provider || !session) setError('Start the API to scan and save memories.');
                      else handleOpenScanModal();
                    }}
                  >
                    {query || roomFilter !== 'All rooms' ? 'Clear filters' : 'Scan a room'}
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {/* Site Footer */}
        <footer className="site-footer">
          <div className="footer-brand">
            <div className="footer-logo">
              <span className="brand-mark">
                <Sparkles size={16} strokeWidth={2.2} />
              </span>
              <div>
                <strong>Muse</strong>
                <span>by Team Memory Makers</span>
              </div>
            </div>
            <p>Helping you find the little things, one shared memory at a time.</p>
          </div>

          <div className="partner-band">
            <p className="eyebrow">SUPPORTED BY & POWERED WITH</p>
            <div className="partner-logos" aria-label="Sponsors and technology partners">
              <span className="factory-mark">
                <i>F</i> FACTORY
              </span>
              <span className="mercor-mark">
                <i>M</i> MERCOR
              </span>
              <span className="hugging-mark">
                <i>HF</i> Hugging Face
              </span>
              <span className="fireworks-mark">
                <i>AI</i> Fireworks AI
              </span>
              <span className="anthropic-mark">ANTHROPIC</span>
              <span className="coinbase-mark">coinbase</span>
            </div>
          </div>

          <div className="footer-bottom">
            <span>© 2025 Team Memory Makers. Built with care for CalHacks 13.0.</span>
            <nav aria-label="Footer navigation">
              <button type="button" onClick={() => setInfoModal(true)}>
                Privacy
              </button>
              <button type="button" onClick={() => setInfoModal(true)}>
                Terms
              </button>
              <button type="button" onClick={() => setInfoModal(true)}>
                Accessibility
              </button>
              <button type="button" onClick={() => setInfoModal(true)}>
                How it works
              </button>
            </nav>
          </div>
        </footer>
      </main>

      {/* ========================================================================= */}
      {/* 1. New Scan Modal: Pre-Scan Room Selection Step -> Camera Capture Step      */}
      {/* ========================================================================= */}
      {scanModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setScanModal(false)}
        >
          <div
            className="scan-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ width: scanStep === 'select-room' ? 'min(540px, 100%)' : 'min(500px, 100%)' }}
          >
            {scanStep === 'select-room' ? (
              /* Step 1: Pre-Scan Room Selection */
              <div>
                <div className="modal-head">
                  <div>
                    <div className="step-indicator">
                      <span className="step-pill">Step 1 of 2</span>
                      <span>Room Selection</span>
                    </div>
                    <h2>Where are you scanning?</h2>
                  </div>
                  <button
                    type="button"
                    className="close-button"
                    onClick={() => setScanModal(false)}
                  >
                    <X size={18} />
                  </button>
                </div>

                <p className="modal-copy">
                  Select the part of the house before taking the video or photo scan so objects are accurately categorized.
                </p>

                {/* Grid of Room Choices */}
                <div className="room-select-grid">
                  {PRESET_ROOMS.map((r) => {
                    const isSelected = scanRoom === r.name && !customRoom;
                    return (
                      <button
                        key={r.name}
                        type="button"
                        className={`room-choice-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setScanRoom(r.name);
                          setCustomRoom('');
                        }}
                      >
                        <span className="room-emoji">{r.emoji}</span>
                        <div>
                          <strong>{r.name}</strong>
                          <small>{r.hint}</small>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Custom room name input */}
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 6 }}>
                    Or specify a custom room / space:
                  </label>
                  <div className="custom-room-wrap">
                    <input
                      type="text"
                      className="custom-room-input"
                      placeholder="e.g. Garage, Guest Room, Attic..."
                      value={customRoom}
                      onChange={(e) => {
                        setCustomRoom(e.target.value);
                        if (e.target.value.trim()) setScanRoom(e.target.value.trim());
                      }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="primary-button continue-scan-btn"
                  style={{ marginTop: 16 }}
                  onClick={handleConfirmRoom}
                >
                  <span>Continue with {scanRoom}</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              /* Step 2: Camera Stream / Capture Viewfinder */
              <div>
                <div className="modal-head">
                  <div>
                    <div className="step-indicator">
                      <span className="step-pill">Step 2 of 2</span>
                      <span>Scanning: {scanRoom}</span>
                    </div>
                    <h2>Choose your camera</h2>
                  </div>
                  <button
                    type="button"
                    className="close-button"
                    onClick={() => setScanModal(false)}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                    padding: '8px 12px',
                    background: '#edf4e4',
                    borderRadius: 10,
                    fontSize: 12,
                    color: '#2d4b23',
                  }}
                >
                  <span>
                    Area: <strong>{scanRoom}</strong>
                  </span>
                  <button
                    type="button"
                    style={{ color: '#567e37', fontWeight: 600, textDecoration: 'underline' }}
                    onClick={() => setScanStep('select-room')}
                  >
                    Change room
                  </button>
                </div>

                {session?.token && (
                  <CapturePanel
                    token={session.token}
                    health={health}
                    selectedRoom={scanRoom}
                    onSaved={() => setRevision((r) => r + 1)}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* How It Works Modal */}
      {infoModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setInfoModal(false)}
        >
          <div
            className="scan-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">ARCHITECTURE</p>
                <h2>How Muse Works</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setInfoModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: 14, fontSize: 13, color: '#555', marginTop: 10 }}>
              <p>
                <strong>1. Save an observation:</strong> Camera mode can preview frames or analyze
                a room when vision is configured. The sample observation is labeled as an
                illustration.
              </p>
              <p>
                <strong>2. Search saved evidence:</strong> Search and Ask Muse use household
                observations. Optional assistant configuration enables conversational responses.
              </p>
              <p>
                <strong>3. Shared household memory:</strong> Records are stored in the configured
                SQLite or SpacetimeDB memory backend. A saved location is where an item was last
                observed, not proof that it is still there.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Profile Switcher Modal */}
      {profileModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (session) setProfileModal(false);
          }}
        >
          <div
            className="scan-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">HOUSEHOLD SPACE</p>
                <h2>{session ? 'Switch household member' : 'Join the household'}</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setProfileModal(false)}
                disabled={!session}
              >
                <X size={18} />
              </button>
            </div>

            <GuestEntry
              onJoin={(name) => joinGuest(name)}
              onSelect={(id) => joinGuest('', id)}
              currentUserId={session?.member.id}
              switching={switchingProfile}
            />
            {session && (
              <button
                className="secondary-button"
                type="button"
                disabled={switchingProfile}
                onClick={() => void leaveGuest()}
              >
                Leave guest session
              </button>
            )}
          </div>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {photoViewer && selectedObject && (
        <div
          className="photo-lightbox"
          role="presentation"
          onClick={() => setPhotoViewer(false)}
        >
          <div
            className="lightbox-shell"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lightbox-head">
              <strong>{selectedObject.label} · {photoMode === 'depth' ? 'Depth Map' : 'Original Photo'}</strong>
              <button
                type="button"
                className="close-button lightbox-close"
                onClick={() => setPhotoViewer(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ height: '580px', background: '#0d1511', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {session?.token && (
                <EvidenceImage
                  observation={selectedObject.last_visual}
                  token={session.token}
                  highlight={true}
                  depthMode={photoMode === 'depth'}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
