import { useEffect, useRef, useState } from 'react';

// The browser recognition service is optional and may process audio remotely.
// This is foreground phrase recognition, not an OS-level wake-word detector.
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>;
      }) => void)
    | null;
  start(): void;
  abort(): void;
}
type RecognitionWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useWakePhrase(onWake: (command: string) => void, paused: boolean) {
  const browser = window as RecognitionWindow;
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  const [enabled, setEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const callback = useRef(onWake);
  callback.current = onWake;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const active = useRef(false);
  const recognizer = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rapidEnds = useRef(0);

  function halt() {
    clearTimeout(timer.current);
    timer.current = undefined;
    const current = recognizer.current;
    recognizer.current = null;
    if (current) {
      current.onstart = current.onend = current.onresult = current.onerror = null;
      current.abort();
    }
  }

  function disable() {
    active.current = false;
    halt();
    setEnabled(false);
    setListening(false);
  }

  function fail(message: string) {
    disable();
    setError(message);
  }

  function launch() {
    if (
      !Constructor ||
      !active.current ||
      pausedRef.current ||
      document.hidden ||
      recognizer.current
    )
      return;
    clearTimeout(timer.current);
    timer.current = undefined;
    const recognition = new Constructor();
    recognizer.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    const started = Date.now();
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (!result.isFinal) continue;
        const text = result[0].transcript;
        const match = /^\s*hello\b[,.!?:;\s-]*/i.exec(text);
        if (!match) continue;
        halt();
        setListening(false);
        callback.current(text.slice(match[0].length).trim().slice(0, 1000));
        break;
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech') return; // Normal end handles a bounded restart.
      fail(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Wake listening permission was denied. Enable speech recognition in your browser, or use Talk to Muse or typing.'
          : 'Wake listening stopped because the browser speech service is unavailable. Try enabling it again, or use Talk to Muse.',
      );
    };
    recognition.onend = () => {
      if (recognizer.current !== recognition) return;
      recognizer.current = null;
      setListening(false);
      rapidEnds.current = Date.now() - started < 1000 ? rapidEnds.current + 1 : 0;
      if (rapidEnds.current >= 3) {
        fail('Your browser keeps ending wake listening. Use Talk to Muse or typing.');
      } else if (active.current && !pausedRef.current && !document.hidden) {
        timer.current = setTimeout(launch, 500);
      }
    };
    try {
      recognition.start();
    } catch {
      fail('Could not start wake listening. Use Talk to Muse or typing.');
    }
  }

  function enable() {
    if (!Constructor || document.hidden) return;
    setError('');
    rapidEnds.current = 0;
    active.current = true;
    setEnabled(true);
    launch(); // Start inside the enabling user gesture where possible.
  }

  const launchRef = useRef(launch);
  launchRef.current = launch;
  const disableRef = useRef(disable);
  disableRef.current = disable;
  useEffect(() => {
    if (enabled && !paused) launchRef.current();
    else {
      halt();
      setListening(false);
    }
  }, [enabled, paused]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) disableRef.current();
    };
    const leave = () => disableRef.current();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      active.current = false;
      halt();
    };
  }, []);
  return { supported: !!Constructor, enabled, listening, error, enable, disable };
}
