import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle, ScanLine } from 'lucide-react';
import { api } from '../api';
import type { Health } from '../types';

export default function CapturePanel({
  token,
  health,
  onSaved,
}: {
  token: string;
  health: Health | null;
  onSaved: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const [room, setRoom] = useState('Living room');
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<File | null>(null);
  const isLive = health?.vision_provider === 'gemini';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => setError('Tap the video to start the camera.'));
    }
  }, [camera]);

  async function startCamera() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access requires HTTPS or localhost. You can upload a photo instead.');
      return;
    }
    try {
      const result = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (!mounted.current) {
        result.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = result;
      setCamera(true);
    } catch {
      setError(
        'Camera access was unavailable. Allow camera access in browser settings, or upload a photo.',
      );
    }
  }

  async function savePhoto(file: File) {
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('image', file);
    form.set('room', room);
    form.set('request_id', crypto.randomUUID());
    try {
      const result = await api<{ count: number }>('/api/captures', token, {
        method: 'POST',
        body: form,
      });
      if (result.count === 0) {
        setError('No clearly visible objects were found. Try a closer or clearer view.');
        return;
      }
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the capture.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function capture() {
    const element = video.current;
    if (!element?.videoWidth) {
      setError('Wait for the camera preview to load.');
      return;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / element.videoWidth);
    canvas.width = Math.round(element.videoWidth * scale);
    canvas.height = Math.round(element.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(element, 0, 0, canvas.width, canvas.height);
    setBusy(true);
    canvas.toBlob(
      (blob) => {
        if (blob) void savePhoto(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
        else {
          setBusy(false);
          setError('Could not capture this frame. Try again or choose a photo.');
        }
      },
      'image/jpeg',
      0.85,
    );
  }

  async function sample() {
    setBusy(true);
    setError('');
    try {
      await api('/api/demo/captures', token, { method: 'POST' });
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save sample.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="capture-panel">
      <p className="muted">A clear photo is all it takes to remember a little more.</p>
      <label className="field-label">
        Room
        <select value={room} onChange={(event) => setRoom(event.target.value)}>
          {['Living room', 'Kitchen', 'Bedroom', 'Office', 'Entryway'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      {camera ? (
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          controls={false}
          className="camera-preview"
          onClick={() => void video.current?.play()}
        />
      ) : (
        <button className="camera-launch" onClick={() => void startCamera()}>
          <Camera size={36} />
          <strong>Open your camera</strong>
          <span>Or choose a photo below</span>
        </button>
      )}
      <label className="upload-button">
        <ImagePlus size={19} />
        {selected?.name ?? 'Choose a photo'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setSelected(event.target.files?.[0] ?? null)}
        />
      </label>
      {!isLive && (
        <div className="notice">
          <strong>Sample mode</strong>
          <p>
            Real photo analysis needs Gemini credentials. You can preview your camera or add the
            illustrated sample scene to try the memory flow.
          </p>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="capture-actions">
        {isLive ? (
          <button
            className="primary-button"
            disabled={busy || (!selected && !camera)}
            onClick={() => (selected ? void savePhoto(selected) : capture())}
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : <ScanLine size={18} />}
            {busy ? 'Understanding your scene…' : 'Remember this scene'}
          </button>
        ) : (
          <button className="primary-button" disabled={busy} onClick={() => void sample()}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <ScanLine size={18} />}Add sample
            observation
          </button>
        )}
      </div>
      <p className="fine-print">
        Capture runs only when you press the button. Your camera stops when this dialog closes.
      </p>
    </div>
  );
}
