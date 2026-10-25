import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Square } from 'lucide-react';
import { api, userFacingError } from '../api';
import type { Health } from '../types';
import { mediaDefault, saveMediaPreference } from '../mediaPreferences';

type Quality = {
  frame_id: number;
  width: number;
  height: number;
  sharpness: number;
  brightness: number;
  quality_score: number;
};
type CameraStats = {
  received_frames: number;
  received_fps: number;
  quality: Quality;
  top_frames: Quality[];
  image_upload?: {
    provider: 'spacetimedb';
    state: 'uploaded';
    session: string;
    sequence: number;
  } | null;
  analysis?: {
    state: string;
    processed_frames: number;
    count: number;
    observed_at: string | null;
    error: string | null;
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isQuality(value: unknown): value is Quality {
  return (
    isRecord(value) &&
    ['frame_id', 'width', 'height', 'sharpness', 'brightness', 'quality_score'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    )
  );
}

function isCameraStats(value: unknown): value is CameraStats {
  if (
    !isRecord(value) ||
    typeof value.received_frames !== 'number' ||
    typeof value.received_fps !== 'number' ||
    !isQuality(value.quality) ||
    !Array.isArray(value.top_frames) ||
    !value.top_frames.every(isQuality)
  )
    return false;
  const analysis = value.analysis;
  return (
    analysis === undefined ||
    analysis === null ||
    (isRecord(analysis) &&
      typeof analysis.state === 'string' &&
      typeof analysis.processed_frames === 'number' &&
      typeof analysis.count === 'number' &&
      (analysis.observed_at === null || typeof analysis.observed_at === 'string') &&
      (analysis.error === null || typeof analysis.error === 'string'))
  );
}

export default function CapturePanel({
  token,
  health,
  onSaved,
  selectedRoom = 'Living room',
  compact = false,
}: {
  token: string;
  health: Health | null;
  onSaved: () => void;
  selectedRoom?: string;
  compact?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const mounted = useRef(true);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const task = useRef<{
    id: number;
    active: boolean;
    opening: boolean;
    busy: boolean;
    stream?: MediaStream;
    timer?: ReturnType<typeof setInterval>;
    request?: AbortController;
    scanId?: string;
    processed?: number;
  }>({ id: 0, active: false, opening: false, busy: false });
  const [room, setRoom] = useState(selectedRoom);
  const [seconds, setSeconds] = useState(5);
  const autoAttempted = useRef(false);
  const modeChosen = useRef(false);
  const [mode, setMode] = useState<'memory' | 'preview'>(
    health?.vision_provider === 'gemini' ? 'memory' : 'preview',
  );
  const [facing, setFacing] = useState('environment');
  const [jpegQuality, setJpegQuality] = useState(78);
  const [resolution, setResolution] = useState('Camera is off');
  const [stats, setStats] = useState<CameraStats | null>(null);
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Choose how you’d like to use the camera, then turn it on.');
  const [frames, setFrames] = useState(0);
  const [lastUpdate, setLastUpdate] = useState('');
  const enabled = health?.vision_provider === 'gemini';
  const uploadEnabled = health?.camera_frame_sink === 'spacetimedb';
  useEffect(() => setRoom(selectedRoom), [selectedRoom]);

  useEffect(() => {
    if (!modeChosen.current && !task.current.active && !task.current.opening)
      setMode(enabled ? 'memory' : 'preview');
  }, [enabled]);

  // Inference finishes after upload. Poll completion independently so a last
  // frame can update the page even when no subsequent camera frame is sent.
  useEffect(() => {
    if (!active || mode !== 'memory') return;
    const id = task.current.id;
    const scanId = task.current.scanId;
    const controller = new AbortController();
    let running = false;
    const timer = setInterval(async () => {
      if (running || document.hidden || !scanId) return;
      running = true;
      try {
        const analysis = await api<NonNullable<CameraStats['analysis']>>(
          `/api/camera/streams/${scanId}`,
          token,
          { signal: controller.signal },
        );
        if (task.current.id !== id || controller.signal.aborted) return;
        if (!isRecord(analysis) || typeof analysis.processed_frames !== 'number')
          throw new Error(
            'We couldn’t check your latest memory update. Please restart the camera.',
          );
        setStats((previous) => (previous ? { ...previous, analysis } : previous));
        if (analysis.error) {
          stop();
          setError(userFacingError(analysis.error, '/api/camera/frames'));
        } else if (analysis.processed_frames > (task.current.processed ?? 0)) {
          task.current.processed = analysis.processed_frames;
          setLastUpdate(
            analysis.observed_at ? new Date(analysis.observed_at).toLocaleTimeString() : '',
          );
          setStatus(
            analysis.count
              ? `Updated ${analysis.count} visible ${analysis.count === 1 ? 'object' : 'objects'} in shared memory.`
              : 'No items were clear enough to remember. Your saved items are still available.',
          );
          saved.current();
        }
      } catch (failure) {
        if (task.current.id === id && !controller.signal.aborted) {
          stop();
          setError(
            failure instanceof Error ? failure.message : 'Your latest update could not be checked.',
          );
        }
      } finally {
        running = false;
      }
    }, 1500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [active, mode, token]);

  function stop(update = true) {
    const current = task.current;
    current.id++;
    current.active = current.opening = current.busy = false;
    clearInterval(current.timer);
    current.request?.abort();
    if (current.scanId) {
      void fetch(`/api/camera/streams/${current.scanId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
      current.scanId = undefined;
    }
    current.stream?.getTracks().forEach((track) => track.stop());
    current.stream = undefined;
    current.request = undefined;
    if (video.current) video.current.srcObject = null;
    if (update && mounted.current) {
      setActive(false);
      setOpening(false);
      setBusy(false);
      setResolution('Camera is off');
      setStatus('Camera paused. You can still find your saved items.');
    }
  }

  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      if (document.hidden) stop();
    };
    const leave = () => stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      stop(false);
    };
  }, []);

  async function frame(id: number, scanId: string) {
    const current = task.current;
    const element = video.current;
    if (
      !current.active ||
      current.id !== id ||
      current.busy ||
      document.hidden ||
      !element?.videoWidth ||
      !element.videoHeight
    )
      return;
    current.busy = true;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / element.videoWidth, 720 / element.videoHeight);
      canvas.width = Math.round(element.videoWidth * scale);
      canvas.height = Math.round(element.videoHeight * scale);
      const context = canvas.getContext('2d');
      if (!context)
        throw new Error('We couldn’t take a picture. Please try starting the camera again.');
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (image) =>
            image
              ? resolve(image)
              : reject(new Error('Could not capture this frame. Restart scanning to try again.')),
          'image/jpeg',
          jpegQuality / 100,
        ),
      );
      if (current.id !== id || !current.active || document.hidden) return;
      const form = new FormData();
      form.set('image', blob, 'camera-frame.jpg');
      form.set('room', room);
      form.set('request_id', crypto.randomUUID());
      form.set('scan_id', scanId);
      const request = new AbortController();
      current.request = request;
      form.set('memory_enabled', String(mode === 'memory'));
      form.set('analysis_interval', String(seconds));
      const response = await api<unknown>('/api/camera/frames', token, {
        method: 'POST',
        body: form,
        signal: request.signal,
      });
      if (current.id !== id || request.signal.aborted || !current.active) return;
      if (!isCameraStats(response))
        throw new Error(
          'We couldn’t update the camera view. Please stop the camera and try again.',
        );
      setFrames((count) => count + 1);
      setStats(response);
      const analysis = response.analysis;
      if (analysis?.error) {
        stop();
        setError(userFacingError(analysis.error, '/api/camera/frames'));
        return;
      }
      if (mode === 'preview') {
        setStatus(
          response.image_upload?.state === 'uploaded'
            ? 'Your latest view has been shared. Item recognition is off in this mode.'
            : 'Your camera is ready. Preview mode won’t add items to your memory.',
        );
      } else if (analysis && analysis.processed_frames > (current.processed ?? 0)) {
        current.processed = analysis.processed_frames;
        setLastUpdate(
          analysis.observed_at ? new Date(analysis.observed_at).toLocaleTimeString() : '',
        );
        setStatus(
          analysis.count
            ? `Updated ${analysis.count} visible ${analysis.count === 1 ? 'object' : 'objects'} in shared memory.`
            : 'No items were clear enough to remember. Your saved items are still available.',
        );
        saved.current();
      }
    } catch (failure) {
      if (current.id === id && mounted.current) {
        stop();
        setError(
          failure instanceof Error
            ? failure.message
            : 'We couldn’t update this view. Please start the camera again.',
        );
      }
    } finally {
      if (current.id === id) {
        current.busy = false;
        current.request = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  }

  async function start() {
    const current = task.current;
    if (current.active || current.opening || (mode === 'memory' && !enabled) || document.hidden)
      return;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera access isn’t available here. Open the secure website in a supported browser and try again.',
      );
      return;
    }
    const id = ++current.id;
    current.opening = true;
    setOpening(true);
    setFrames(0);
    setLastUpdate('');
    setStats(null);
    setStatus('Opening your camera…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (!mounted.current || current.id !== id || document.hidden) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      const element = video.current;
      if (!element) throw new Error('The camera preview is unavailable. Try again.');
      element.srcObject = stream;
      await element.play();
      if (!mounted.current || current.id !== id || document.hidden) return;
      current.opening = false;
      current.active = true;
      setOpening(false);
      setActive(true);
      setResolution(`${element.videoWidth} × ${element.videoHeight}`);
      setStatus(
        mode === 'memory'
          ? 'Looking for items to remember. Move slowly and keep them in view.'
          : uploadEnabled
            ? 'Sharing your camera view. Item recognition is off in this mode.'
            : 'Camera preview is on. Look around to check your view.',
      );
      const scanId = crypto.randomUUID();
      current.scanId = scanId;
      current.processed = 0;
      current.timer = setInterval(() => void frame(id, scanId), seconds * 1000);
      void frame(id, scanId);
    } catch (failure) {
      if (current.id === id && mounted.current) {
        stop();
        setError(
          failure instanceof DOMException && failure.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access, then start scanning again.'
            : failure instanceof Error
              ? failure.message
              : 'Camera access was unavailable. Check browser permissions.',
        );
      }
    }
  }

  async function addSample() {
    if (busy || active || opening) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/demo/captures', token, { method: 'POST' });
      saved.current();
      setStatus('Added the labeled sample observation to household memory.');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? userFacingError(failure.message, '/api/demo/captures')
          : 'Could not add the sample observation.',
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!health || autoAttempted.current) return;
    const timer = setTimeout(() => {
      autoAttempted.current = true;
      if (mediaDefault('camera')) void startRef.current();
    }, 0);
    return () => clearTimeout(timer);
  }, [health?.vision_provider]);

  return (
    <div className={`capture-panel ${compact ? 'camera-compact' : ''}`}>
      <p className="capture-brief">
        Camera {active ? 'on' : opening ? 'requesting permission' : 'off'} · Capture every {seconds}{' '}
        seconds
        {uploadEnabled ? ' · Sharing with your household' : ''}
      </p>
      <p className="muted">
        {uploadEnabled
          ? 'Share your camera view with your household. Choose “Update shared memory” to also remember visible items.'
          : 'Look around the room to remember where things are, or preview your camera first.'}
      </p>
      <div className="camera-settings">
        <label className="field-label">
          Camera mode
          <select
            value={mode}
            disabled={active || opening}
            onChange={(event) => {
              modeChosen.current = true;
              setMode(event.target.value as 'memory' | 'preview');
            }}
          >
            <option value="memory" disabled={!enabled}>
              Update shared memory
            </option>
            <option value="preview">
              {uploadEnabled ? 'Share camera view only' : 'Camera preview only'}
            </option>
          </select>
        </label>
        <label className="field-label">
          Choose camera
          <select
            value={facing}
            disabled={active || opening}
            onChange={(event) => setFacing(event.target.value)}
          >
            <option value="environment">Back camera</option>
            <option value="user">Front camera</option>
          </select>
        </label>
        <label className="field-label">
          Room
          <select
            value={room}
            disabled={active || opening || mode === 'preview'}
            onChange={(event) => setRoom(event.target.value)}
          >
            {Array.from(
              new Set([
                'Living room',
                'Kitchen',
                'Bedroom',
                'Office',
                'Entryway',
                selectedRoom,
              ]),
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field-label camera-quality-control">
        Photo quality: {jpegQuality}%
        <input
          aria-label="Photo quality"
          type="range"
          min="30"
          max="95"
          value={jpegQuality}
          disabled={active || opening}
          onChange={(event) => setJpegQuality(Number(event.target.value))}
        />
      </label>
      <p className="fine-print">
        Higher photo quality keeps more detail. Good lighting and a steady hand help too.
      </p>
      <label className="field-label">
        Update frequency
        <select
          value={seconds}
          disabled={active || opening}
          onChange={(event) => setSeconds(Number(event.target.value))}
        >
          {[3, 4, 5].map((value) => (
            <option key={value} value={value}>
              Every {value} seconds
            </option>
          ))}
        </select>
      </label>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        controls={false}
        className="camera-preview"
        aria-label={compact ? 'Background camera preview' : 'Live room camera'}
        hidden={!active && !opening}
      />
      {!active && !opening && (
        <div className="camera-launch">
          <Camera size={36} />
          <strong>Live room scan</strong>
          <span>
            {mode === 'memory'
              ? 'Only the objects and their last-seen locations are remembered.'
              : 'Check your camera before scanning objects into shared memory.'}
          </span>
        </div>
      )}
      {!enabled && (
        <div className="notice">
          <strong>Remembering new items isn’t available yet</strong>
          <p>
            You can still use the camera and explore saved items. New items won’t be added to your
            memory until recognition is available.
          </p>
        </div>
      )}
      <div className="capture-actions">
        {active || opening ? (
          <button
            className="primary-button"
            onClick={() => {
              saveMediaPreference('camera', false);
              stop();
            }}
          >
            <Square size={18} />
            {mode === 'memory'
              ? 'Stop scanning'
              : uploadEnabled
                ? 'Stop sharing camera'
                : 'Stop camera preview'}
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={mode === 'memory' && !enabled}
            onClick={() => {
              saveMediaPreference('camera', true);
              void start();
            }}
          >
            <Camera size={18} />
            {mode === 'memory'
              ? 'Start scanning'
              : uploadEnabled
                ? 'Share camera view'
                : 'Start camera preview'}
          </button>
        )}
        {busy && (
          <span>
            <LoaderCircle className="spin" size={16} /> Updating your view…
          </span>
        )}
        {health?.vision_provider === 'demo' &&
          health.sample_data &&
          health.memory_provider === 'sqlite' && (
          <button
            className="secondary-button"
            type="button"
            disabled={busy || active || opening}
            onClick={() => void addSample()}
          >
            Add sample observation
          </button>
        )}
      </div>
      <p role="status">{status}</p>
      <p className="fine-print">
        Views captured: {frames}
        {lastUpdate ? ` · Last update: ${lastUpdate}` : ''}
      </p>
      {stats?.image_upload?.state === 'uploaded' && (
        <p className="fine-print">
          {mode === 'memory'
            ? 'Your latest view has been shared. New items appear after they’ve been recognized.'
            : 'Your latest view has been shared. This mode doesn’t add items to your memory.'}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {stats && (
        <section className="camera-diagnostics" aria-label="Picture quality">
          <p>Move slowly and keep items well lit for a clearer view.</p>
          <details>
            <summary>View camera details</summary>
            <p className="fine-print">Camera resolution: {resolution}</p>
            <dl className="camera-metrics">
              <div>
                <dt>Clarity</dt>
                <dd>{stats.quality.sharpness}</dd>
              </div>
              <div>
                <dt>Brightness</dt>
                <dd>{Math.round((stats.quality.brightness / 255) * 100)}%</dd>
              </div>
              <div>
                <dt>Photo rate</dt>
                <dd>{stats.received_fps} FPS</dd>
              </div>
            </dl>
            <p className="fine-print">Clearest views from this scan: {stats.top_frames.length}</p>
            <ol>
              {stats.top_frames.map((frame) => (
                <li key={frame.frame_id}>
                  Photo {frame.frame_id} · {frame.width} × {frame.height}
                </li>
              ))}
            </ol>
            <p className="fine-print">
              These are the clearest views from this scan. New memories use your latest view.
            </p>
          </details>
        </section>
      )}
      <p className="fine-print">
        Your view refreshes every {seconds} seconds. You can visit other screens in Commonplace
        while the camera stays on. Switching away from this website or locking your phone pauses it.
      </p>
      <p className="fine-print">
        {mode === 'memory'
          ? 'Recognized items and their last-seen photos are shared with your household. Highlighted boxes show items in the saved photo, not a walking direction.'
          : uploadEnabled
            ? 'This mode shares your camera view without adding items to your memory here.'
            : 'Preview helps you check your view. Photos aren’t saved or added to your shared memory in this mode.'}
      </p>
    </div>
  );
}
