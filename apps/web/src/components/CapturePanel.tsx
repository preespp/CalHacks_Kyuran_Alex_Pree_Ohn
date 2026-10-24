import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Square } from 'lucide-react';
import { api } from '../api';
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
  compact = false,
}: {
  token: string;
  health: Health | null;
  onSaved: () => void;
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
  const [room, setRoom] = useState('Living room');
  const [seconds, setSeconds] = useState(5);
  const autoAttempted = useRef(false);
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
  const [status, setStatus] = useState('Choose a camera mode, then start the camera.');
  const [frames, setFrames] = useState(0);
  const [lastUpdate, setLastUpdate] = useState('');
  const enabled = health?.vision_provider === 'gemini';

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
      setStatus('Camera stopped. Last-seen records remain available to your household.');
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
      if (!context) throw new Error('This browser could not capture a camera frame.');
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
          'The camera API returned an unexpected response. Restart make api and try again.',
        );
      setFrames((count) => count + 1);
      setStats(response);
      const analysis = response.analysis;
      if (analysis?.error) {
        stop();
        setError(analysis.error);
        return;
      }
      if (mode === 'preview') {
        setStatus(
          'Camera frame checked. Preview does not call Gemini or save object observations.',
        );
      } else if (analysis && analysis.processed_frames > (current.processed ?? 0)) {
        current.processed = analysis.processed_frames;
        setLastUpdate(
          analysis.observed_at ? new Date(analysis.observed_at).toLocaleTimeString() : '',
        );
        setStatus(
          analysis.count
            ? `Updated ${analysis.count} visible ${analysis.count === 1 ? 'object' : 'objects'} in shared memory.`
            : 'No clearly visible objects in this frame. Previous last-seen records are kept.',
        );
        saved.current();
      }
    } catch (failure) {
      if (current.id === id && mounted.current) {
        stop();
        setError(
          failure instanceof Error
            ? failure.message
            : 'Frame processing failed. Restart scanning to try again.',
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
      setError('Camera access needs a supported browser on HTTPS or localhost.');
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
          ? 'Scanning. Frames update your household’s shared location memory.'
          : 'Previewing. Frames go to backend quality checks only.',
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
      </p>
      <p className="muted">
        Preview your camera and check frame quality, or scan visible objects into shared memory.
      </p>
      <div className="camera-settings">
        <label className="field-label">
          Camera mode
          <select
            value={mode}
            disabled={active || opening}
            onChange={(event) => setMode(event.target.value as 'memory' | 'preview')}
          >
            <option value="memory" disabled={!enabled}>
              Update shared memory
            </option>
            <option value="preview">Camera preview only</option>
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
            {['Living room', 'Kitchen', 'Bedroom', 'Office', 'Entryway'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field-label camera-quality-control">
        JPEG quality: {jpegQuality}%
        <input
          aria-label="JPEG compression quality"
          type="range"
          min="30"
          max="95"
          value={jpegQuality}
          disabled={active || opening}
          onChange={(event) => setJpegQuality(Number(event.target.value))}
        />
      </label>
      <p className="fine-print">
        {resolution} · 720p preview target · JPEG quality controls compression, not focus.
      </p>
      <label className="field-label">
        Camera capture interval
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
          <strong>Shared-memory scanning needs Gemini vision</strong>
          <p>
            Enable the vision integration to process camera frames. Existing sample records remain
            available for search. Camera preview and quality checks work without a Gemini key and do
            not write object memory.
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
            {mode === 'memory' ? 'Stop scanning' : 'Stop camera preview'}
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
            {mode === 'memory' ? 'Start scanning' : 'Start camera preview'}
          </button>
        )}
        {busy && (
          <span>
            <LoaderCircle className="spin" size={16} /> Processing a frame…
          </span>
        )}
      </div>
      <p role="status">{status}</p>
      <p className="fine-print">
        Processed frames: {frames}
        {lastUpdate ? ` · Last update: ${lastUpdate}` : ''}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {stats && (
        <section className="camera-diagnostics" aria-label="Backend frame quality">
          <h3>Backend frame quality</h3>
          <dl className="camera-metrics">
            <div>
              <dt>Sharpness</dt>
              <dd>{stats.quality.sharpness}</dd>
            </div>
            <div>
              <dt>Brightness</dt>
              <dd>{stats.quality.brightness} / 255</dd>
            </div>
            <div>
              <dt>Receive rate</dt>
              <dd>{stats.received_fps} FPS</dd>
            </div>
          </dl>
          <p className="fine-print">
            Top candidates: {stats.top_frames.length} / 3 · ranked within this scan
          </p>
          <ol>
            {stats.top_frames.map((frame) => (
              <li key={frame.frame_id}>
                Frame {frame.frame_id}: score {frame.quality_score} · {frame.width} × {frame.height}
              </li>
            ))}
          </ol>
          <p className="fine-print">
            Quality ranking is a sharpness/exposure heuristic. Older top frames are diagnostics;
            memory uses the newly captured frame.
          </p>
        </section>
      )}
      <p className="fine-print">
        Capture one frame on start, then every {seconds} seconds, with one upload at a time. The
        backend waits at least {seconds} seconds after each analysis result before analyzing the
        latest frame; older queued frames are replaced. Camera capture continues across app screens.
        Hiding or closing the website stops capture; a received frame may still finish processing.
      </p>
      <p className="fine-print">
        {mode === 'memory'
          ? 'Frames go to Gemini vision; saved evidence is shared with this prototype household. Boxes are image coordinates, not room coordinates.'
          : 'Preview frames go to the backend for quality checks. Up to three JPEGs are held temporarily in memory; no object observations or photos are saved to disk or cloud storage.'}
      </p>
    </div>
  );
}
