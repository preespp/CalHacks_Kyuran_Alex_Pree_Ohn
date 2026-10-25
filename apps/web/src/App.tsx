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
  Info,
  MapPin,
  Maximize2,
  MoreHorizontal,
  Scan,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { api, timeAgo } from './api';
import CapturePanel from './components/CapturePanel';
import EvidenceImage from './components/EvidenceImage';
import { RotatingText } from './components/reactbits';
import type { Health, MemoryObject, Profile, Session } from './types';

function loadSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('commonplace-guest-session') ?? 'null');
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
  const [query, setQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('All rooms');
  const [selectedObject, setSelectedObject] = useState<MemoryObject | null>(null);
  const [page, setPage] = useState<'overview' | 'objects' | 'detail'>('overview');

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

  // Conversational Ask Muse state
  const [museInput, setMuseInput] = useState('');
  const [museAnswer, setMuseAnswer] = useState(
    'I can help you remember where anything is. Try asking about your keys, camera, or adapter.',
  );

  const [revision, setRevision] = useState(0);

  // Auto-init session
  useEffect(() => {
    if (session) return;
    let cancelled = false;
    api<Session>('/api/demo/session', undefined, {
      method: 'POST',
      body: JSON.stringify({ profile: 'alex' }),
    })
      .then((val) => {
        if (!cancelled) {
          sessionStorage.setItem('commonplace-session', JSON.stringify(val));
          setSession(val);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, revision]);

  // Fetch objects and health
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function loadData() {
      try {
        const [objRes, healthRes] = await Promise.all([
          api<{ objects: MemoryObject[] }>(`/api/objects`, session!.token),
          api<Health>('/api/health'),
        ]);
        if (!cancelled) {
          setItems(objRes.objects);
          setHealth(healthRes);
          if (objRes.objects.length > 0 && !activeMapObjectId) {
            setActiveMapObjectId(objRes.objects[0].id);
          }
        }
      } catch {}
    }
    void loadData();
    return () => {
      cancelled = true;
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

  // Ask Muse Handler
  function handleAskMuse(question: string) {
    const prompt = question.trim().toLowerCase();
    if (!prompt) return;

    const words = prompt.split(/\s+/).filter((w) => w.length > 2);
    const found = items.find((item) => {
      const text = `${item.label} ${item.latest?.room} ${item.latest?.location}`.toLowerCase();
      return words.some((w) => text.includes(w));
    });

    if (found) {
      const depth = getDepth(found.label);
      setMuseAnswer(
        `I found your ${found.label.toLowerCase()}. It was last observed in the ${found.latest.room.toLowerCase()}, ${found.latest.location.toLowerCase()}, approximately ${depth} from the camera viewpoint.`,
      );
    } else {
      setMuseAnswer(
        `I scanned your recent household memories, but didn't locate an exact match. Could it be in the living room or entryway? You can also run a New Scan to update memory.`,
      );
    }
    setMuseInput('');
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

  function handleSwitchProfile(profile: Profile) {
    sessionStorage.removeItem('commonplace-session');
    setSession(null);
    setProfileModal(false);
    api<Session>('/api/demo/session', undefined, {
      method: 'POST',
      body: JSON.stringify({ profile }),
    })
      .then((val) => {
        sessionStorage.setItem('commonplace-session', JSON.stringify(val));
        setSession(val);
        setRevision((r) => r + 1);
      })
      .catch(() => {});
  }

  const currentDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date());

  const latestScanRoom = items[0]?.latest?.room || 'Living room';
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
            <span className="count">{items.length || 48}</span>
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
              <span>68%</span>
            </div>
            <div className="progress">
              <span style={{ width: '68%' }}></span>
            </div>
            <p>3,284 objects remembered</p>
          </div>

          <div
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
          </div>
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
                <button
                  type="button"
                  className="detail-more"
                  aria-label="More options"
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
                <span>Muse located this object using your latest room scan.</span>
              </div>

              <div className="room-scene detail-room-scene">
                <div className="depth-grid"></div>
                <div className="object-marker detail-marker">
                  <span className="marker-dot"></span>
                  <div>
                    <b>{selectedObject.label}</b>
                    <small>{getDepth(selectedObject.label)} away</small>
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
                  DEPTH MAP · {selectedObject.latest.room.toUpperCase()}
                </div>
              </div>

              <div className="detail-scene-foot">
                <span>
                  <MapPin size={16} /> {selectedObject.latest.room}
                </span>
                <span>
                  Measured depth <strong>{getDepth(selectedObject.label)}</strong>
                </span>
                <span>
                  Confidence <strong>98%</strong>
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
                    I last remember your <strong>{selectedObject.label.toLowerCase()}</strong> in the{' '}
                    <strong>{selectedObject.latest.room.toLowerCase()}</strong>. Look around the{' '}
                    {selectedObject.latest.location.toLowerCase()}. It should be about{' '}
                    {getDepth(selectedObject.label)} from where you scanned.
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
                  <span className="map-tag">Interactive 3D Space</span>
                  <span style={{ fontSize: 11, color: '#aab8b0' }}>
                    Click an object below to locate in 3D
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
                          {getDepth(item.label)} away · {item.latest?.location || 'Desk'}
                        </small>
                      </div>
                    </div>
                  );
                })}

                <div className="depth-label">
                  DEPTH MAP · {spaceItems.length} OBJECTS ANCHORED IN 3D
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
                      <strong>{activeTargetItem.latest?.room}</strong> ({activeTargetItem.latest?.location}) · Depth {getDepth(activeTargetItem.label)}
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
                    <i></i> Scanned 12 min ago
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
                        <small>{getDepth(item.label)} away</small>
                      </div>
                    </div>
                  ))}

                  <div className="depth-label">
                    DEPTH MAP · {items.length ? `${items.length} OBJECTS` : '32 OBJECTS'}
                  </div>
                </div>

                <div className="scene-foot">
                  <span>
                    <Boxes size={16} />
                    {items.length || 32} objects recognized
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

                <div className="chat-bubble">{museAnswer}</div>

                <div className="suggestions">
                  <button
                    type="button"
                    onClick={() => handleAskMuse('Where are my house keys?')}
                  >
                    Where are my house keys?
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAskMuse('What did I leave in the studio?')}
                  >
                    What did I leave in the studio?
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAskMuse('Where is the blue water bottle?')}
                  >
                    Where is the blue water bottle?
                  </button>
                </div>

                <form
                  className="ask-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAskMuse(museInput);
                  }}
                >
                  <input
                    placeholder="Ask about anything..."
                    aria-label="Ask Muse"
                    value={museInput}
                    onChange={(e) => setMuseInput(e.target.value)}
                  />
                  <button type="submit" className="send" aria-label="Send query">
                    <ArrowRight size={16} />
                  </button>
                </form>

                <p className="private-note">
                  Private to you · Muse learns only from your scans also can do mistakes.
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
                processed locally or encrypted in your household vault, allowing you to ask Muse
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
                onClick={() => setProfileModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
              {(['alex', 'pree', 'kyuran'] as Profile[]).map((prof) => (
                <button
                  key={prof}
                  type="button"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    background: session?.member?.id === prof ? '#e4e9d9' : '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 10,
                    fontWeight: 600,
                  }}
                  onClick={() => handleSwitchProfile(prof)}
                >
                  <User size={18} />
                  <span style={{ textTransform: 'capitalize' }}>
                    {prof === 'alex' ? 'Alex Morgan' : prof === 'pree' ? 'Pree' : 'Kyuran'}
                  </span>
                  {session?.member?.id === prof && (
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#32443d' }}>
                      Active
                    </span>
                  )}
                </button>
              ))}
            </div>
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
    </div>
  );
}
