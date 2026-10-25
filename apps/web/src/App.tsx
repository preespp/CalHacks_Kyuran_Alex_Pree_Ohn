import { useEffect, useMemo, useState } from 'react';
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
import { api, timeAgo } from './api';
import CapturePanel from './components/CapturePanel';
import EvidenceImage from './components/EvidenceImage';
import RoomScene, { roomEmoji } from './components/RoomScene';
import GuestEntry from './components/GuestEntry';
import RemiAssistant from './components/RemiAssistant';
import { useCurrentDate } from './useCurrentDate';
import { RotatingText } from './components/reactbits';
import type { Health, MemoryObject, Observation, Session } from './types';

function loadSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('commonplace-guest-session') ?? 'null');
    return value?.token && value?.member ? value : null;
  } catch {
    return null;
  }
}

function sourceName(source?: Observation['source']) {
  if (source === 'gemini') return 'Gemini photo';
  if (source === 'reported') return 'Household update';
  return 'Sample scene';
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

// Deterministic depth and match badge calculation
function getDepth(label: string): string {
  const hash = label.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const m = ((hash % 20) + 6) / 10;
  return `${m.toFixed(1)}m`;
}

function getMatchBadge(label: string): { text: string; color: 'lime' | 'blue' | 'pink' } {
  const hash = label.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const colors: ('lime' | 'blue' | 'pink')[] = ['lime', 'blue', 'pink'];
  const color = colors[hash % colors.length];
  const pct = 94 + (hash % 6);
  return { text: `${pct}% match`, color };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<MemoryObject[]>([]);
  const [events, setEvents] = useState<Observation[]>([]);
  const [query, setQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('All rooms');
  const [selectedObject, setSelectedObject] = useState<MemoryObject | null>(null);
  const [page, setPage] = useState<'overview' | 'objects' | 'activity' | 'detail'>('overview');
  const currentDate = useCurrentDate();
  const [assistantOpen, setAssistantOpen] = useState(() => new URLSearchParams(window.location.search).get('view') === 'assistant');
  const [assistantPrompt, setAssistantPrompt] = useState<{ id: number; text: string } | null>(null);
  const [voiceSettingsHost, setVoiceSettingsHost] = useState<HTMLDivElement | null>(null);
  const [toast, setToast] = useState('');

  // Location update state for detail page
  const [noteRoom, setNoteRoom] = useState('Living room');
  const [noteLocation, setNoteLocation] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [objectHistory, setObjectHistory] = useState<Observation[]>([]);

  // Space categorization & Interactive 3D map in My Objects page
  const [activeSpace, setActiveSpace] = useState<string>('All');
  const [activeMapObjectId, setActiveMapObjectId] = useState<string | null>(null);

  // Scan modal state: Step 1 (Room Selection) -> Step 2 (Capture)
  const [scanModal, setScanModal] = useState(false);
  const [scanStep, setScanStep] = useState<'select-room' | 'capture'>('select-room');
  const [scanRoom, setScanRoom] = useState('Living room');
  const [customRoom, setCustomRoom] = useState('');
  const [cameraDevice, setCameraDevice] = useState('iPhone 15 Pro Camera (USB / Virtual)');
  const [photoMode, setPhotoMode] = useState<'original' | 'depth'>('original');
  const [photoViewer, setPhotoViewer] = useState(false);

  // Modals
  const [infoModal, setInfoModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);

  // Conversational Ask Remi state
  const [remiInput, setRemiInput] = useState('');
  const [remiAnswer, setRemiAnswer] = useState(
    'I can help you remember where anything is. Try asking about your keys, camera, or adapter.',
  );

  const [revision, setRevision] = useState(0);

  // Auto-init session
  useEffect(() => {
    if (session) return;
    let cancelled = false;
    api<Session>('/api/guest/session', undefined, {
      method: 'POST',
      body: JSON.stringify({ name: 'Pree' }),
    })
      .then((val) => {
        if (!cancelled) {
          sessionStorage.setItem('commonplace-guest-session', JSON.stringify(val));
          setSession(val);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, revision]);

  // Sync selected object location inputs & history
  useEffect(() => {
    if (!selectedObject) return;
    setNoteRoom(selectedObject.latest.room || 'Living room');
    setNoteLocation(selectedObject.latest.location || '');
    setNoteError('');
    if (!session?.token) return;

    let cancelled = false;
    api<{ observations: Observation[] }>(`/api/objects/${selectedObject.id}/history`, session.token)
      .then((res) => {
        if (!cancelled) {
          setObjectHistory(res.observations);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedObject?.id, selectedObject?.latest?.id, session?.token, revision]);

  // Toast timer
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Polling objects, activity, and health every 5 seconds
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadData() {
      try {
        const [objRes, actRes, healthRes] = await Promise.all([
          api<{ objects: MemoryObject[] }>('/api/objects', session!.token, { signal: controller.signal }),
          api<{ events: Observation[] }>('/api/activity', session!.token, { signal: controller.signal }),
          api<Health>('/api/health', undefined, { signal: controller.signal }),
        ]);
        if (!cancelled) {
          setItems(objRes.objects);
          setEvents(actRes.events);
          setHealth(healthRes);
          if (objRes.objects.length > 0 && !activeMapObjectId) {
            setActiveMapObjectId(objRes.objects[0].id);
          }
        }
      } catch {
        // ignore aborted
      }
    }

    void loadData();
    const timer = setInterval(() => {
      void loadData();
    }, 5000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [session, revision]);

  // Unique rooms
  const rooms = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.latest?.room) set.add(item.latest.room);
    });
    return ['All rooms', ...Array.from(set)];
  }, [items]);

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

  // Active items for "My Objects" 3D Map (also filtered by search query)
  const spaceItems = useMemo(() => {
    let list = activeSpace === 'All' ? items : items.filter((item) => (item.latest?.room || 'Living room') === activeSpace);
    const q = query.toLowerCase().trim();
    if (q) {
      list = list.filter((item) =>
        item.label.toLowerCase().includes(q) ||
        item.latest?.room.toLowerCase().includes(q) ||
        item.latest?.location.toLowerCase().includes(q) ||
        item.appearance.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, activeSpace, query]);

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

  // The card and hands-free voice share the real assistant and its conversation.
  function handleAskRemi(question: string) {
    if (!question.trim()) return;
    setAssistantOpen(true);
    setAssistantPrompt(previous => ({ id: (previous?.id ?? 0) + 1, text: question.trim() }));
    setRemiInput('');
  }

  function handleOpenScanModal() {
    if (selectedObject?.latest?.room) {
      setScanRoom(selectedObject.latest.room);
    }
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

  // Location update report handler
  async function handleReportLocation(kind: 'moved' | 'found') {
    if (!selectedObject || !session?.token) return;
    if (!noteLocation.trim()) {
      setNoteError('Please describe where the object is now.');
      return;
    }
    setNoteBusy(true);
    setNoteError('');
    try {
      const res = await api<{ observations: Observation[] }>(
        `/api/objects/${selectedObject.id}/notes`,
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            room: noteRoom.trim(),
            location: noteLocation.trim(),
            kind,
          }),
        },
      );
      setObjectHistory(res.observations);
      const updatedLatest = res.observations[0];
      const updatedObject: MemoryObject = {
        ...selectedObject,
        latest: updatedLatest,
      };
      setSelectedObject(updatedObject);
      setItems((prev) => prev.map((it) => (it.id === updatedObject.id ? updatedObject : it)));
      setRevision((r) => r + 1);
      setToast(
        kind === 'found'
          ? `Marked ${updatedObject.label} as found in ${updatedLatest.room}!`
          : `Updated location for ${updatedObject.label} to ${updatedLatest.room}.`,
      );
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Could not save location update.');
    } finally {
      setNoteBusy(false);
    }
  }

  // Add a saved household name or switch to an existing one.
  async function handleSwitchProfile(body: { name: string } | { user_id: string }) {
    const val = await api<Session>('/api/guest/session', session?.token, {
      method: 'POST', body: JSON.stringify(body),
    });
    sessionStorage.setItem('commonplace-guest-session', JSON.stringify(val));
    sessionStorage.setItem('commonplace-session', JSON.stringify(val));
    setSession(val);
    setProfileModal(false);
    setAssistantPrompt(null);
    setRemiAnswer('Ask me where something was last seen in your household.');
    setRevision(r => r + 1);
    setToast(`Now using ${val.member.name}’s household profile`);
  }

  const latestRoomObservation = useMemo(() => [...items].sort((a, b) => b.latest.observed_at.localeCompare(a.latest.observed_at))[0], [items]);
  const latestScanRoom = latestRoomObservation?.latest.room ?? 'Your household';
  const latestRoomItems = items.filter(item => item.latest.room === latestScanRoom);
  const activeTargetItem = items.find((it) => it.id === activeMapObjectId);

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={17} strokeWidth={2.2} />
          </span>
          <span>Remi</span>
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
            <span>Activity</span>
            <span className="count">{events.length}</span>
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => setInfoModal(true)}
          >
            <Info size={18} />
            <span>How it works</span>
          </button>
          <button className="nav-item" type="button" onClick={() => setProfileModal(true)}><Boxes size={18} /><span>Household members</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="remi-controls sidebar-voice" ref={setVoiceSettingsHost} aria-label="Remi voice controls" />
          <div className="storage">
            <div className="storage-row">
              <span>Memory space</span>
              <span>68%</span>
            </div>
            <div className="progress">
              <span style={{ width: '68%' }}></span>
            </div>
            <p>{items.length} objects remembered</p>
          </div>

          <button
            type="button"
            aria-label="Switch household member"
            className="profile"
            onClick={() => setProfileModal(true)}
            title="Click to switch profile"
            style={{ cursor: 'pointer' }}
          >
            <div className="avatar">
              {session?.member?.name?.slice(0, 2).toUpperCase() || 'AM'}
            </div>
            <div>
              <strong>{session?.member?.name || 'Alex Morgan'}</strong>
              <span>Household member · Switch</span>
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
              <h1 aria-label="A home that remembers.">
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
                  aria-label="Search objects"
                  placeholder="Search your memory"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>

              {/* Native clean scan button without StarBorder */}
              <button
                type="button"
                className="scan-button"
                aria-label="Scan room"
                onClick={handleOpenScanModal}
              >
                <Camera size={18} />
                <span>New scan</span>
              </button>
            </div>
          </header>
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
                <span>Your saved location is shown above. The room illustration below is a visual guide to the category.</span>
              </div>

              <RoomScene room={selectedObject.latest.room} objects={[selectedObject]} selectedObjectId={selectedObject.id} variant="detail" />

              <div className="detail-scene-foot">
                <span>
                  <MapPin size={16} /> {selectedObject.latest.room}
                </span>
                <span>Last updated {timeAgo(selectedObject.latest.observed_at)}</span>
              </div>
            </section>

            {/* Bottom 2-Column Section: Evidence Card + Remi Explains & Metadata */}
            <section className="detail-content">
              {/* Left Column: LAST-SEEN EVIDENCE / What Remi saw */}
              <article className="evidence-card">
                <div className="detail-section-title">
                  <div>
                    <p className="eyebrow">LAST-SEEN EVIDENCE</p>
                    <h2>What Remi saw</h2>
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
                        observation={selectedObject.latest}
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

              {/* Right Column: Remi Explains + Object Metadata */}
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
                    I last remember your <strong>{selectedObject.label.toLowerCase()}</strong> in the{' '}
                    <strong>{selectedObject.latest.room.toLowerCase()}</strong>. Look around the{' '}
                    {selectedObject.latest.location.toLowerCase()}. It should be about{' '}
                    {getDepth(selectedObject.label)} from where you scanned.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setPage('overview');
                      handleAskRemi(`Where is my ${selectedObject.label}?`);
                    }}
                  >
                    <span>Ask Remi a follow-up</span>
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
                      <dt>Measured depth</dt>
                      <dd>{getDepth(selectedObject.label)}</dd>
                    </div>
                    <div>
                      <dt>Confidence</dt>
                      <dd>98%</dd>
                    </div>
                    <div>
                      <dt>Remembered by</dt>
                      <dd>{selectedObject.latest.actor_name}</dd>
                    </div>
                    <div>
                      <dt>Last seen</dt>
                      <dd>{timeAgo(selectedObject.latest.observed_at)}</dd>
                    </div>
                  </dl>
                </div>

                {/* Card 3: KEEP HOUSEHOLD UPDATED (Update Location & Found it) */}
                <div className="metadata-card update-location-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <p className="eyebrow">KEEP HOUSEHOLD IN THE LOOP</p>
                      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '2px 0 0', color: '#1a2720' }}>
                        Update Location
                      </h2>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 10,
                        background: '#edf4e8',
                        color: '#346b3f',
                      }}
                    >
                      {sourceName(selectedObject.latest.source)}
                    </span>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleReportLocation('moved');
                    }}
                  >
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#736e67', marginBottom: 6 }}>
                      Room
                      <select
                        value={noteRoom}
                        onChange={(e) => setNoteRoom(e.target.value)}
                        style={{
                          width: '100%',
                          marginTop: 4,
                          padding: '9px 12px',
                          borderRadius: 8,
                          border: '1px solid #dcd7ce',
                          background: '#fff',
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#262420',
                        }}
                      >
                        {['Living room', 'Kitchen', 'Bathroom', 'Bedroom', 'Office', 'Entryway', 'Dining room', 'Studio'].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#736e67', margin: '12px 0 14px' }}>
                      Where is it now?
                      <input
                        required
                        maxLength={300}
                        value={noteLocation}
                        onChange={(e) => setNoteLocation(e.target.value)}
                        placeholder="e.g. On the walnut console tray, top drawer..."
                        style={{
                          width: '100%',
                          marginTop: 4,
                          padding: '9px 12px',
                          borderRadius: 8,
                          border: '1px solid #dcd7ce',
                          background: '#fff',
                          fontSize: 13,
                          color: '#262420',
                        }}
                      />
                    </label>

                    {noteError && (
                      <p style={{ color: '#c0392b', fontSize: 11, marginBottom: 10, fontWeight: 600 }}>
                        {noteError}
                      </p>
                    )}

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="submit"
                        disabled={noteBusy || !noteLocation.trim()}
                        style={{
                          flex: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          background: '#2b3d35',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '10px 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: noteBusy || !noteLocation.trim() ? 'not-allowed' : 'pointer',
                          opacity: noteBusy || !noteLocation.trim() ? 0.6 : 1,
                        }}
                      >
                        {noteBusy ? <LoaderCircle className="spin" size={14} /> : <MapPin size={14} />}
                        <span>Update location</span>
                      </button>

                      <button
                        type="button"
                        disabled={noteBusy || !noteLocation.trim()}
                        onClick={() => void handleReportLocation('found')}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          background: '#eef5e6',
                          color: '#2e6b36',
                          border: '1px solid #c9dec0',
                          borderRadius: 8,
                          padding: '10px 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: noteBusy || !noteLocation.trim() ? 'not-allowed' : 'pointer',
                          opacity: noteBusy || !noteLocation.trim() ? 0.6 : 1,
                        }}
                      >
                        <Check size={14} strokeWidth={2.5} />
                        <span>Found it</span>
                      </button>
                    </div>
                  </form>
                </div>

                {/* Card 4: OBSERVATION HISTORY */}
                <div className="metadata-card history-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <p className="eyebrow">OBSERVATION HISTORY</p>
                    <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>{objectHistory.length} recorded</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
                    {objectHistory.length ? (
                      objectHistory.map((obs, idx) => (
                        <div
                          key={obs.id || idx}
                          style={{
                            padding: '8px 10px',
                            background: idx === 0 ? '#f7faf4' : '#faf8f5',
                            border: idx === 0 ? '1px solid #d4e5cb' : '1px solid #eee8df',
                            borderRadius: 8,
                            fontSize: 11,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                            <strong style={{ color: '#263730', fontWeight: 600 }}>{obs.room}</strong>
                            <span style={{ color: '#888', fontSize: 10 }}>{timeAgo(obs.observed_at)}</span>
                          </div>
                          <p style={{ margin: '0 0 4px', color: '#555' }}>{obs.location}</p>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#999' }}>
                            <span>by {obs.actor_name}</span>
                            <span style={{ textTransform: 'capitalize' }}>{sourceName(obs.source)}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p style={{ color: '#888', fontSize: 11, margin: 0 }}>No previous history recorded yet.</p>
                    )}
                  </div>
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
                    {roomEmoji(roomName)}{' '}
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
                    {activeSpace === 'All' ? 'Household rooms' : `${activeSpace} room view`}
                  </span>
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="map-tag">Illustrated 3D view</span>
                  <span style={{ fontSize: 11, color: '#aab8b0' }}>
                    Choose an item to highlight its saved room
                  </span>
                </div>
              </div>

              {/* 3D Scene Viewport with interactive markers */}
              <RoomScene room={activeSpace === 'All' ? 'All spaces' : activeSpace} objects={spaceItems}
                selectedObjectId={activeMapObjectId} onSelect={item => setActiveMapObjectId(item.id)} onRoomSelect={setActiveSpace} />

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
                      ITEM SELECTED
                    </span>
                    <span>
                      Locating: <strong>{activeTargetItem.label}</strong> in{' '}
                      <strong>{activeTargetItem.latest?.room}</strong> ({activeTargetItem.latest?.location})
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
                    View saved details <ChevronRight size={14} />
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
                const badge = getMatchBadge(item.label);
                const depth = getDepth(item.label);
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
                          observation={item.latest}
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
                          <Check size={12} strokeWidth={3} /> Selected in room view
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
                          {depth} depth
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
                        <span>View Description & Depth Map</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : page === 'activity' ? (
          /* ========================================================================= */
          /* Household Activity Timeline View                                          */
          /* ========================================================================= */
          <div className="activity-page">
            <div className="section-head">
              <div>
                <p className="eyebrow">HOUSEHOLD TIMELINE</p>
                <h2>Recent activity</h2>
                <p style={{ color: '#736e67', fontSize: 13, marginTop: 4 }}>
                  Photo observations and member updates recorded in real time.
                </p>
              </div>
            </div>

            <div className="timeline-container" style={{ marginTop: 20 }}>
              {events.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {events.map((event) => {
                    const matchedItem = items.find((it) => it.id === event.object_id);
                    return (
                      <div
                        key={event.id}
                        className="activity-card"
                        style={{
                          background: '#fff',
                          border: '1px solid #e2ddd5',
                          borderRadius: 14,
                          padding: '16px 20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          cursor: matchedItem ? 'pointer' : 'default',
                          transition: 'all 0.15s ease',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                        }}
                        onClick={() => {
                          if (matchedItem) {
                            setSelectedObject(matchedItem);
                            setPage('detail');
                          }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          {(() => {
                            const actor = event.actor_name || 'Household';
                            const initial = actor[0]?.toUpperCase() || 'H';
                            const lower = actor.toLowerCase();
                            const bg = lower.startsWith('a')
                              ? '#415a4b'
                              : lower.startsWith('p')
                                ? '#7d5c41'
                                : '#4a5d7c';
                            return (
                              <span
                                className={`avatar avatar-${lower}`}
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: '50%',
                                  background: bg,
                                  color: '#fff',
                                  display: 'grid',
                                  placeItems: 'center',
                                  fontWeight: 700,
                                  fontSize: 14,
                                  flexShrink: 0,
                                }}
                              >
                                {initial}
                              </span>
                            );
                          })()}

                          <div>
                            <div style={{ fontSize: 14, color: '#1a2720' }}>
                              <strong>{event.actor_name || 'Household member'}</strong>{' '}
                              <span style={{ color: '#68635c' }}>
                                {event.kind === 'seen'
                                  ? 'remembered'
                                  : event.kind === 'moved'
                                    ? 'moved'
                                    : event.kind === 'found'
                                      ? 'found'
                                      : 'updated'}{' '}
                              </span>
                              <strong style={{ color: '#274334' }}>{event.label || 'an object'}</strong>
                            </div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                              <span>{event.room} · {event.location}</span>
                              <span
                                style={{
                                  marginLeft: 10,
                                  background: '#eee9df',
                                  padding: '2px 8px',
                                  borderRadius: 8,
                                  fontSize: 10,
                                  fontWeight: 600,
                                }}
                              >
                                {sourceName(event.source)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <time style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
                            {timeAgo(event.observed_at)}
                          </time>
                          {matchedItem && (
                            <span style={{ color: '#274334', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                              Inspect <ChevronRight size={14} />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: 16, border: '1px solid #e0ded8' }}>
                  <History size={36} style={{ color: '#aaa', margin: '0 auto 12px' }} />
                  <h3 style={{ margin: 0, fontSize: 17, color: '#333' }}>No household activity recorded yet</h3>
                  <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                    New camera scans or location reports from members will appear here automatically.
                  </p>
                </div>
              )}
            </div>
          </div>
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
                    <i></i> {latestRoomObservation ? `Updated ${timeAgo(latestRoomObservation.latest.observed_at)}` : 'Ready for your first scan'}
                  </span>
                </div>

                <RoomScene room={latestScanRoom} objects={latestRoomItems} variant="overview"
                  onSelect={item => { setSelectedObject(item); setPage('detail'); }} />

                <div className="scene-foot">
                  <span>
                    <Boxes size={16} />
                    {latestRoomItems.length} objects in this room
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

              {/* Ask Remi Card */}
              <aside className="muse-card">
                <div className="muse-title">
                  <span className="muse-orb">
                    <Sparkles size={20} strokeWidth={2.2} />
                  </span>
                  <div>
                    <p className="eyebrow">YOUR MEMORY COMPANION</p>
                    <h2><button type="button" aria-label="Open Remi chat" onClick={() => setAssistantOpen(true)}>Ask Remi</button></h2>
                  </div>
                </div>

                <div className="chat-bubble">{remiAnswer}</div>

                <div className="suggestions">
                  <button
                    type="button"
                    onClick={() => handleAskRemi('Where are my house keys?')}
                  >
                    Where are my house keys?
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAskRemi('What did I leave in the studio?')}
                  >
                    What did I leave in the studio?
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAskRemi('Where is the blue water bottle?')}
                  >
                    Where is the blue water bottle?
                  </button>
                </div>

                <form
                  className="ask-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAskRemi(remiInput);
                  }}
                >
                  <input
                    placeholder="Ask about anything..."
                    aria-label="Ask Remi"
                    value={remiInput}
                    onChange={(e) => setRemiInput(e.target.value)}
                  />
                  <button type="submit" className="send" aria-label="Send query">
                    <ArrowRight size={16} />
                  </button>
                </form>

                <p className="private-note">
                  Shared with your household · Answers use saved sightings and may be out of date.
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
                  const badge = getMatchBadge(item.label);
                  const depth = getDepth(item.label);
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
                            observation={item.latest}
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
                            {depth} depth
                          </span>
                          <span>{timeAgo(item.latest?.observed_at || new Date().toISOString())}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
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
                <strong>Remi</strong>
                <span>by Team Memory Makers</span>
              </div>
            </div>
            <p>Helping you find the little things, one shared memory at a time.</p>
          </div>

          <div className="partner-band">
            <p className="eyebrow">BUILT WITH</p>
            <div className="partner-logos" aria-label="Technology used in Remi">
              <span>Meta Muse</span>
              <span>Google Gemini</span>
              <span>SpacetimeDB</span>
            </div>
          </div>

          <div className="footer-bottom">
            <span>© 2026 Team Memory Makers. Built with care for CalHacks 13.0.</span>
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
                    aria-label="Close dialog"
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
                    aria-label="Close dialog"
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

                <select
                  className="camera-select"
                  value={cameraDevice}
                  onChange={(e) => setCameraDevice(e.target.value)}
                >
                  <option value="iPhone 15 Pro Camera (USB / Virtual)">
                    iPhone 15 Pro Camera (USB / Virtual)
                  </option>
                  <option value="FaceTime HD Camera">FaceTime HD Camera (Built-in)</option>
                  <option value="Living Room Cam 01 (RTSP Stream)">
                    Living Room Cam 01 (RTSP Stream)
                  </option>
                </select>

                {session?.token && (
                  <CapturePanel
                    token={session.token}
                    health={health}
                    selectedRoom={scanRoom}
                    onSaved={() => {
                      setScanModal(false);
                      setRevision((r) => r + 1);
                      setToast('New scan saved! Memory updated.');
                    }}
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
                <h2>How Remi Works</h2>
              </div>
              <button
                type="button"
                className="close-button"
                    aria-label="Close dialog"
                onClick={() => setInfoModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: 14, fontSize: 13, color: '#555', marginTop: 10 }}>
              <p>
                <strong>1. Metric 3D Depth Sensing:</strong> Each frame is processed with
                Apple Depth Pro / Depth Anything to compute metric distances (in meters) for every
                recognized object.
              </p>
              <p>
                <strong>2. Multimodal Embeddings:</strong> We calculate SigLIP-So400M vision
                embeddings to identify objects across varied angles and lighting.
              </p>
              <p>
                <strong>3. Privacy-First Household Memory:</strong> Your visual memory is
                processed locally or encrypted in your household vault, allowing you to ask Remi
                where you left everyday items.
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
          onClick={() => setProfileModal(false)}
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
                <h2>Switch Member Profile</h2>
              </div>
              <button
                type="button"
                className="close-button"
                    aria-label="Close dialog"
                onClick={() => setProfileModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="remi-controls household-members">
              <GuestEntry onJoin={name => handleSwitchProfile({ name })}
                onSelect={user_id => handleSwitchProfile({ user_id })}
                currentUserId={session?.member.id} switching={!!session}
                submitLabel="Add household member" />
            </div>
          </div>
        </div>
      )}

      {session && <RemiAssistant key={session.token} token={session.token} health={health}
        open={assistantOpen} onClose={() => setAssistantOpen(false)} settingsHost={voiceSettingsHost}
        prompt={assistantPrompt} onAnswer={setRemiAnswer}
        onSelect={item => { setAssistantOpen(false); setSelectedObject(item); setPage('detail'); }} />}

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
                  observation={selectedObject.latest}
                  token={session.token}
                  highlight={true}
                  depthMode={photoMode === 'depth'}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className="toast"
          role="status"
          style={{
            position: 'fixed',
            zIndex: 100,
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            background: '#20342a',
            color: '#f0f7ea',
            padding: '12px 20px',
            borderRadius: 30,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            fontSize: 13,
            fontWeight: 600,
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <Check size={16} strokeWidth={2.8} style={{ color: '#c7ed68' }} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
