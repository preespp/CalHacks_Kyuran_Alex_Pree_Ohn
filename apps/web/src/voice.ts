import { useEffect, useRef, useState } from 'react';
import { api } from './api';

async function wavFromRecording(blob: Blob): Promise<Blob> {
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.duration || decoded.duration > 30)
      throw new Error('Record up to 30 seconds at a time.');
    const rate = 24000;
    const context = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start();
    const samples = (await context.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string) =>
      [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, i) => {
      const clipped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
    });
    return new Blob([buffer], { type: 'audio/wav' });
  } finally {
    await decoder.close();
  }
}

export function useVoiceInput(
  path: string,
  token: string | undefined,
  onTranscript: (text: string, automatic: boolean) => void,
) {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const current = useRef<{
    id: number;
    active: boolean;
    recorder?: MediaRecorder;
    stream?: MediaStream;
    timer?: ReturnType<typeof setTimeout>;
    monitor?: ReturnType<typeof setInterval>;
    context?: AudioContext;
    source?: MediaStreamAudioSourceNode;
    request?: AbortController;
  }>({ id: 0, active: false });
  const supported =
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined';

  function endAnalysis() {
    const task = current.current;
    clearInterval(task.monitor);
    task.monitor = undefined;
    task.source?.disconnect();
    task.source = undefined;
    if (task.context) {
      void task.context.close().catch(() => {});
      task.context = undefined;
    }
  }
  function cancel() {
    const task = current.current;
    task.id += 1;
    task.active = false;
    clearTimeout(task.timer);
    endAnalysis();
    task.request?.abort();
    task.request = undefined;
    if (task.recorder) {
      task.recorder.onstop = null;
      task.recorder.ondataavailable = null;
      task.recorder.onerror = null;
      if (task.recorder.state !== 'inactive') task.recorder.stop();
    }
    task.stream?.getTracks().forEach((track) => track.stop());
    task.recorder = undefined;
    task.stream = undefined;
  }
  useEffect(() => () => cancel(), []);

  function stop() {
    clearTimeout(current.current.timer);
    endAnalysis();
    setLevel(0);
    if (current.current.recorder?.state === 'recording') current.current.recorder.stop();
  }
  function fail(message: string) {
    cancel();
    setState('idle');
    setLevel(0);
    setError(message);
  }

  async function start(options: { automatic?: boolean } = {}) {
    if (!supported || current.current.active) return;
    const automatic = !!options.automatic;
    setError('');
    setLevel(0);
    setState('requesting');
    const task = current.current;
    const id = ++task.id;
    task.active = true;
    try {
      // Construct/resume the analyser context from the user's start gesture when possible.
      if (automatic) {
        task.context = new AudioContext();
        await task.context.resume();
      }
      if (id !== task.id) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (id !== task.id) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      task.stream = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      task.recorder = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      recorder.ondataavailable = (event) => {
        if (id !== task.id) return;
        chunks.push(event.data);
        size += event.data.size;
        if (size > 2 * 1024 * 1024) fail('Recording is too large. Use a shorter question.');
      };
      recorder.onerror = () =>
        fail('Microphone recording failed. Try again or type your question.');
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        clearTimeout(task.timer);
        endAnalysis();
        if (id !== task.id) return;
        setLevel(0);
        setState('transcribing');
        const request = new AbortController();
        task.request = request;
        try {
          const wav = await wavFromRecording(new Blob(chunks, { type: recorder.mimeType }));
          if (id !== task.id) return;
          const body = new FormData();
          body.append('audio', wav, 'speech.wav');
          const transcript = await api<{ text: string }>(path, token, {
            method: 'POST',
            body,
            signal: request.signal,
          });
          if (id === task.id) {
            task.active = false;
            setState('idle');
            callback.current(transcript.text, automatic);
          }
        } catch (failure) {
          if (id === task.id)
            setError(
              failure instanceof Error
                ? failure.message
                : 'Could not transcribe speech. You can still type.',
            );
        } finally {
          if (id === task.id) {
            task.active = false;
            task.recorder = undefined;
            task.stream = undefined;
            task.request = undefined;
            setState('idle');
          }
        }
      };
      recorder.start();
      setState('recording');
      if (automatic) {
        const context = task.context!;
        const source = context.createMediaStreamSource(stream);
        task.source = source;
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const began = performance.now();
        let previous = began;
        let lastSound = began;
        let speechMs = 0;
        const observe = () => {
          if (id !== task.id || recorder.state !== 'recording') return;
          const now = performance.now();
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
          setLevel(Math.min(1, rms * 8));
          if (rms >= 0.02) {
            speechMs += Math.min(200, now - previous);
            lastSound = now;
          } else if (speechMs < 200 && now - lastSound > 200) speechMs = 0;
          previous = now;
          if (speechMs >= 200 && now - lastSound >= 1300) stop();
          else if (speechMs < 200 && now - began >= 8000)
            fail(
              'No speech detected. Check the selected microphone, speak closer, or use dictation/typing.',
            );
        };
        task.monitor = setInterval(observe, 50);
        task.timer = setTimeout(() => {
          if (speechMs >= 200) stop();
          else fail('No speech detected. Try again or type your question.');
        }, 29000);
      } else task.timer = setTimeout(stop, 29000);
    } catch (failure) {
      if (id !== task.id) return;
      const name = failure instanceof DOMException ? failure.name : '';
      fail(
        name === 'NotFoundError'
          ? 'No microphone was found. Connect or select a microphone, or type your question.'
          : name === 'NotReadableError'
            ? 'The microphone is busy or unavailable. Check system audio settings and try again.'
            : name === 'NotAllowedError' || name === 'SecurityError'
              ? 'Microphone permission denied. Allow microphone access in your browser, or type your question.'
              : 'Microphone unavailable or permission denied. Check microphone permissions and browser audio support, or type your question.',
      );
    }
  }
  return {
    state,
    error,
    level,
    supported,
    start,
    stop,
    clearError: () => setError(''),
    cancel: () => {
      cancel();
      setState('idle');
      setLevel(0);
    },
  };
}

export type SpeechOutcome = 'ended' | 'blocked' | 'canceled';
export function useSpeechOutput() {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const current = useRef<{
    message: SpeechSynthesisUtterance;
    resolve: (outcome: SpeechOutcome) => void;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const supported =
    typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  function stop() {
    const task = current.current;
    current.current = null;
    if (task) {
      clearTimeout(task.timer);
      task.message.onstart = null;
      task.message.onend = null;
      task.message.onerror = null;
      task.resolve('canceled');
    }
    if (supported) speechSynthesis.cancel();
  }
  useEffect(() => () => stop(), []);
  function speak(text: string): Promise<SpeechOutcome> {
    if (!supported) return Promise.resolve('blocked');
    stop();
    setError('');
    setSpeaking(true);
    return new Promise((resolve) => {
      const message = new SpeechSynthesisUtterance(text);
      const task = {
        message,
        resolve,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      current.current = task;
      const finish = (outcome: SpeechOutcome) => {
        if (current.current !== task) return;
        clearTimeout(task.timer);
        current.current = null;
        message.onstart = null;
        message.onend = null;
        message.onerror = null;
        setSpeaking(false);
        if (outcome === 'blocked') {
          speechSynthesis.cancel();
          setError('Audio playback was blocked or unavailable. Tap Read reply to try again.');
        }
        resolve(outcome);
      };
      message.onstart = () => clearTimeout(task.timer);
      message.onend = () => finish('ended');
      message.onerror = () => finish('blocked');
      task.timer = setTimeout(() => finish('blocked'), 8000);
      try {
        speechSynthesis.speak(message);
      } catch {
        finish('blocked');
      }
    });
  }
  return {
    supported,
    speaking,
    error,
    speak,
    clearError: () => setError(''),
    stop: () => {
      stop();
      setSpeaking(false);
    },
  };
}
