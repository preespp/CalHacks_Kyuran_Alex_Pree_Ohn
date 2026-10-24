import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Mic, Send, Sparkles, Square, Volume2 } from 'lucide-react';
import { api } from '../api';
import type { ChatMessage, ChatResponse, Health, MemoryObject, PlainChatResponse } from '../types';
import { useSpeechOutput, useVoiceInput } from '../voice';
import { useWakePhrase } from '../wake';
import { mediaDefault, saveMediaPreference } from '../mediaPreferences';

export const WAKE_GREETING = 'Hi I am Muse how can I help you today with household stuff';

type Turn = ChatMessage & { evidence?: ChatResponse };

export default function AssistantPanel({
  token,
  health,
  onSelect,
  mode = 'memory',
  compact = false,
  onOpen,
}: {
  token?: string;
  health: Pick<Health, 'assistant_provider'> | null;
  onSelect?: (item: MemoryObject) => void;
  mode?: 'memory' | 'plain';
  compact?: boolean;
  onOpen?: () => void;
}) {
  const autoAttempted = useRef(false);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const enabled = health?.assistant_provider === 'muse' || health?.assistant_provider === 'gemini';
  const name = health?.assistant_provider === 'gemini' ? 'Gemini' : 'Muse';
  const [readAloud, setReadAloud] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const conversationRef = useRef(false);
  const generation = useRef(0);
  const sendRef = useRef<(text: string, voiceTurn?: boolean) => Promise<void>>(async () => {});
  const speech = useSpeechOutput();
  const voice = useVoiceInput(
    mode === 'plain' ? '/api/lab/transcribe' : '/api/voice/transcribe',
    token,
    (text, automatic) => {
      setQuestion(text);
      if (automatic && conversationRef.current) {
        if (/^(stop|stop listening|stop voice session|cancel)[.!?]*$/i.test(text.trim())) {
          stopRef.current();
          void speech.speak('Voice stopped.');
        } else void sendRef.current(text, true);
      }
    },
  );
  const wake = useWakePhrase(
    (command) => {
      void activateWake(command);
    },
    !enabled ||
      name !== 'Muse' ||
      conversation ||
      acknowledging ||
      voice.state !== 'idle' ||
      !!pending ||
      speech.speaking,
  );
  const wakeEnabled = useRef(false);
  wakeEnabled.current = wake.enabled;

  function stopConversation() {
    wake.disable();
    conversationRef.current = false;
    generation.current += 1;
    setConversation(false);
    setAcknowledging(false);
    voice.cancel();
    speech.stop();
    controller.current?.abort();
    controller.current = null;
    setPending('');
  }

  function startConversation() {
    voice.clearError();
    speech.clearError();
    setError('');
    conversationRef.current = true;
    generation.current += 1;
    setConversation(true);
    setReadAloud(true);
    speech.stop();
    void voice.start({ automatic: true });
  }

  async function activateWake(command: string) {
    voice.clearError();
    speech.clearError();
    setError('');
    conversationRef.current = true;
    const turn = ++generation.current;
    setConversation(true);
    setReadAloud(true);
    setAcknowledging(true);
    const outcome = await speech.speak(WAKE_GREETING);
    if (generation.current !== turn || !conversationRef.current) return;
    if (outcome !== 'ended' || document.hidden) {
      stopConversation();
      return;
    }
    // An inline command ("Hello, where are my keys?") is already transcribed
    // by the browser. Otherwise, record the question using Meta ASR after the cue.
    if (command) void sendRef.current(command, true);
    else void voice.start({ automatic: true });
    setAcknowledging(false);
  }

  const stopRef = useRef(stopConversation);
  stopRef.current = stopConversation;
  const voiceActiveRef = useRef(false);
  voiceActiveRef.current = conversation || voice.state !== 'idle' || speech.speaking;
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && voiceActiveRef.current) stopRef.current();
    };
    const leave = () => stopRef.current();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopRef.current();
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('keydown', escape);
      conversationRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!conversation) return;
    if (!enabled || voice.error || speech.error) {
      stopRef.current();
      return;
    }
    if (
      !acknowledging &&
      voice.state === 'idle' &&
      !pending &&
      !speech.speaking &&
      !controller.current
    ) {
      const timer = setTimeout(() => {
        if (conversationRef.current && !controller.current) void voice.start({ automatic: true });
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [
    conversation,
    acknowledging,
    enabled,
    voice.state,
    voice.error,
    pending,
    speech.speaking,
    speech.error,
  ]);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!compact && (messages.length || pending || error))
      end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages, pending, error, compact]);

  const enableWakeRef = useRef(wake.enable);
  enableWakeRef.current = wake.enable;
  useEffect(() => {
    if (
      !enabled ||
      name !== 'Muse' ||
      !wake.supported ||
      !voice.supported ||
      !speech.supported ||
      autoAttempted.current
    )
      return;
    const timer = setTimeout(() => {
      autoAttempted.current = true;
      if (mediaDefault('voice')) {
        setReadAloud(true);
        enableWakeRef.current();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [enabled, name, wake.supported, voice.supported, speech.supported]);

  function toggleVoice() {
    if (wake.enabled || conversation) {
      saveMediaPreference('voice', false);
      stopConversation();
    } else {
      saveMediaPreference('voice', true);
      setReadAloud(true);
      wake.enable();
      void speech.speak('Wake listening enabled.');
    }
  }

  async function send(text = question, voiceTurn = false) {
    const message = text.trim();
    if (!message || controller.current || !enabled) return;
    const turnGeneration = generation.current;
    const request = new AbortController();
    controller.current = request;
    speech.stop();
    setPending(message);
    setError('');
    try {
      const result = await api<ChatResponse | PlainChatResponse>(
        mode === 'plain' ? '/api/lab/chat' : '/api/chat',
        token,
        {
          method: 'POST',
          signal: request.signal,
          body: JSON.stringify({
            message,
            history: messages.slice(-8).map(({ role, content }) => ({ role, content })),
          }),
        },
      );
      if (request.signal.aborted) return;
      setMessages((previous) => [
        ...previous,
        { role: 'user', content: message },
        {
          role: 'assistant',
          content: result.answer,
          evidence: 'matches' in result ? result : undefined,
        },
      ]);
      setQuestion('');
      setPending('');
      if (controller.current === request) controller.current = null;
      if (readAloud || voiceTurn) {
        const outcome = await speech.speak(result.answer);
        if (voiceTurn && outcome !== 'ended' && generation.current === turnGeneration)
          stopConversation();
        else if (voiceTurn && wakeEnabled.current && generation.current === turnGeneration) {
          // A wake-triggered question is one turn, then return to wake standby.
          conversationRef.current = false;
          setConversation(false);
          voice.cancel();
        }
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'Could not ask the assistant.');
        if (voiceTurn && generation.current === turnGeneration) stopConversation();
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
        if (!request.signal.aborted) setPending('');
      }
    }
  }
  sendRef.current = send;

  return (
    <section
      className={`assistant-panel ${compact ? 'assistant-compact' : ''}`}
      aria-label={`${name} ${mode === 'plain' ? 'plain chat' : 'household assistant'}`}
    >
      <div className="voice-power">
        <span>
          <Mic size={17} /> Muse voice {wake.enabled || conversation ? 'on' : 'off'}
          {acknowledging ? ` · ${WAKE_GREETING}` : wake.listening ? ' · Say Hello' : ''}
        </span>
        <button
          className="secondary-button"
          aria-pressed={wake.enabled || conversation}
          disabled={
            !enabled || name !== 'Muse' || !wake.supported || !voice.supported || !speech.supported
          }
          onClick={toggleVoice}
        >
          {wake.enabled || conversation ? 'Turn off Muse voice' : 'Turn on Muse voice'}
        </button>
        {compact && onOpen && (
          <button className="secondary-button" onClick={onOpen}>
            Open chat
          </button>
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>
            <Sparkles size={20} /> Ask {name}
          </h2>
          <p>
            {mode === 'plain'
              ? 'Type or speak. Chat directly with Muse.'
              : 'A fresh look at what your household has remembered.'}
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={conversation || !!pending || voice.state !== 'idle' || messages.length === 0}
          onClick={() => {
            setMessages([]);
            setError('');
            speech.stop();
          }}
        >
          Clear chat
        </button>
      </div>
      <p className="fine-print">
        {mode === 'plain'
          ? 'Isolated chat: no database, household memory, camera, or Gemini vision is connected.'
          : 'Answers use last-seen locations and timestamps. Start a room scan to update memory automatically.'}
      </p>
      {!enabled && (
        <div className="notice" role="status">
          <strong>
            {health ? `${name} assistant is not enabled yet.` : 'Checking assistant availability…'}
          </strong>
          <p>
            {health
              ? mode === 'plain'
                ? 'Set MODEL_API_KEY and META_MODEL in the root .env, then restart make muse-api.'
                : 'You can still search, view evidence, and share location updates in Our memory. See the setup guide to enable chat.'
              : 'Your saved household memory will remain available.'}
          </p>
        </div>
      )}
      <div
        className="assistant-transcript"
        role="log"
        aria-label="Assistant conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && !pending && (
          <div className="assistant-welcome">
            <Sparkles size={28} />
            <h3>
              {mode === 'plain'
                ? 'A little conversation with Muse.'
                : 'Someone remembers. Just ask.'}
            </h3>
            <p>
              {mode === 'plain'
                ? 'Try “Introduce yourself in one sentence.”'
                : 'Try “Where did we leave the HDMI adapter?”'}
            </p>
            <button
              className="secondary-button"
              disabled={!enabled}
              onClick={() =>
                setQuestion(
                  mode === 'plain'
                    ? 'Introduce yourself in one sentence.'
                    : 'Where did we leave the HDMI adapter?',
                )
              }
            >
              {mode === 'plain' ? 'Try a first question' : 'Ask about the adapter'}
            </button>
          </div>
        )}
        {messages.map((message, index) => (
          <article className={`assistant-message assistant-message-${message.role}`} key={index}>
            <strong>{message.role === 'user' ? 'You' : name}</strong>
            <p>{message.content}</p>
            {message.role === 'assistant' && speech.supported && (
              <button
                className="speech-reply"
                onClick={() => {
                  if (conversationRef.current) stopConversation();
                  void speech.speak(message.content);
                }}
              >
                <Volume2 size={15} />
                Read reply
              </button>
            )}
            {message.evidence && (
              <div className="assistant-evidence">
                <small>
                  Searched shared memory: {message.evidence.query} ·{' '}
                  {message.evidence.total_matches}{' '}
                  {message.evidence.total_matches === 1 ? 'match' : 'matches'}
                </small>
                {message.evidence.matches.map((item) => (
                  <button
                    className="assistant-record"
                    key={item.id}
                    onClick={() => onSelect?.(item)}
                  >
                    <strong>
                      {item.label}
                      <ArrowUpRight size={16} />
                    </strong>
                    <span>
                      {item.latest.room} · {item.latest.location}
                    </span>
                    <small>
                      {item.latest.source === 'reported'
                        ? 'Location report'
                        : item.latest.source === 'sample'
                          ? 'Sample illustration'
                          : 'Camera observation'}{' '}
                      ·{' '}
                      <time dateTime={item.latest.observed_at}>
                        {new Date(item.latest.observed_at).toLocaleString()}
                      </time>
                    </small>
                    <small>Open saved evidence</small>
                  </button>
                ))}
                {message.evidence.total_matches > message.evidence.matches.length && (
                  <small>
                    Showing the first {message.evidence.matches.length} records. Narrow your search
                    to see more.
                  </small>
                )}
              </div>
            )}
          </article>
        ))}
        {pending && (
          <>
            <article className="assistant-message assistant-message-user">
              <strong>You</strong>
              <p>{pending}</p>
            </article>
            <p className="assistant-pending" role="status">
              <LoaderCircle className="spin" size={17} />{' '}
              {mode === 'plain' ? 'Muse is replying…' : 'Checking shared memory…'}
            </p>
          </>
        )}
        <div ref={end} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="assistant-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="field-label" htmlFor="assistant-question">
          {mode === 'plain' ? 'Message Muse' : 'Ask about a shared object'}
        </label>
        <div className="assistant-compose">
          <input
            id="assistant-question"
            value={question}
            maxLength={1000}
            required
            placeholder={mode === 'plain' ? 'Type a message…' : 'Where is our HDMI adapter?'}
            disabled={!enabled || !!pending || voice.state !== 'idle' || conversation}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            className="primary-button"
            type="submit"
            disabled={
              !enabled || !!pending || voice.state !== 'idle' || conversation || !question.trim()
            }
          >
            {pending ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} Send
          </button>
        </div>
      </form>
      <div className={`voice-session ${conversation ? 'voice-session-active' : ''}`}>
        <span className="voice-orb" aria-hidden="true">
          <Mic size={23} />
        </span>
        <div className="voice-session-copy">
          <strong>
            {conversation
              ? speech.speaking
                ? 'Muse is speaking'
                : pending
                  ? 'Muse is thinking'
                  : voice.state === 'transcribing'
                    ? 'Understanding you'
                    : voice.state === 'requesting'
                      ? 'Opening microphone'
                      : 'Listening…'
              : 'Talk to Muse'}
          </strong>
          <p>
            {conversation
              ? 'Pause after speaking. Muse will answer and listen again.'
              : 'Tap once, speak naturally, and pause to send. Typing stays available.'}
          </p>
          {conversation && voice.state === 'recording' && (
            <meter
              min={0}
              max={100}
              value={Math.round(voice.level * 100)}
              aria-label="Microphone level"
            />
          )}
        </div>
        {conversation ? (
          <button className="primary-button" onClick={stopConversation}>
            <Square size={16} />
            Stop voice session
          </button>
        ) : (
          <button
            className="primary-button"
            onClick={() => startConversation()}
            disabled={
              !enabled ||
              !!pending ||
              voice.state !== 'idle' ||
              !voice.supported ||
              !speech.supported ||
              name !== 'Muse'
            }
          >
            <Mic size={17} />
            Talk to Muse
          </button>
        )}
      </div>
      <div className="wake-controls">
        <button
          className="secondary-button"
          aria-pressed={wake.enabled}
          aria-describedby="wake-explanation"
          disabled={
            !wake.enabled &&
            (!enabled ||
              name !== 'Muse' ||
              !wake.supported ||
              !voice.supported ||
              !speech.supported ||
              conversation ||
              !!pending ||
              voice.state !== 'idle' ||
              speech.speaking)
          }
          onClick={() => {
            if (wake.enabled) {
              saveMediaPreference('voice', false);
              stopConversation();
            } else {
              saveMediaPreference('voice', true);
              setReadAloud(true);
              wake.enable();
              void speech.speak('Wake listening enabled.');
            }
          }}
        >
          <Mic size={17} />
          {wake.enabled ? 'Disable Hello' : 'Enable Hello'}
        </button>
        <p id="wake-explanation" className="fine-print">
          {wake.supported
            ? 'Optional: say “Hello”, wait for Muse’s greeting, then ask. Keep this page visible. Your browser’s speech service may process wake-listening audio remotely.'
            : 'Hello is unavailable in this browser. Use Talk to Muse, dictation, or typing.'}
        </p>
        <p className="fine-print" role="status" aria-live="polite">
          {wake.enabled
            ? wake.listening
              ? 'Wake listening is on. Say Hello.'
              : 'Wake listening is paused during your voice turn or spoken reply.'
            : 'Wake listening is off.'}
        </p>
      </div>
      <div className="voice-controls">
        {!conversation && voice.state === 'recording' ? (
          <>
            <button className="secondary-button" onClick={voice.stop}>
              <Square size={16} />
              Stop and transcribe
            </button>
            <button className="secondary-button" onClick={voice.cancel}>
              Cancel recording
            </button>
          </>
        ) : !conversation ? (
          <button
            className="secondary-button"
            disabled={
              !enabled || !!pending || voice.state !== 'idle' || !voice.supported || name !== 'Muse'
            }
            onClick={() => {
              speech.stop();
              setReadAloud(true);
              void voice.start();
            }}
          >
            {voice.state === 'idle' ? (
              <Mic size={17} />
            ) : (
              <LoaderCircle className="spin" size={17} />
            )}{' '}
            {voice.state === 'transcribing'
              ? 'Transcribing…'
              : voice.state === 'requesting'
                ? 'Opening microphone…'
                : 'Dictate a message'}
          </button>
        ) : null}
        {!conversation && (voice.state === 'requesting' || voice.state === 'transcribing') && (
          <button className="secondary-button" onClick={voice.cancel}>
            Cancel voice input
          </button>
        )}
        <label className="voice-toggle">
          <input
            type="checkbox"
            checked={readAloud}
            disabled={!speech.supported || conversation}
            onChange={(event) => {
              setReadAloud(event.target.checked);
              if (!event.target.checked) speech.stop();
            }}
          />
          Read replies aloud
        </label>
        {speech.speaking && (
          <button
            className="secondary-button"
            onClick={() => {
              if (conversation) stopConversation();
              else speech.stop();
            }}
          >
            <Square size={15} />
            Stop speaking
          </button>
        )}
      </div>
      {!conversation && voice.state !== 'idle' && (
        <p className="fine-print" role="status">
          {voice.state === 'recording'
            ? 'Recording (up to 30 seconds). Stop to transcribe, review the text, then press Send.'
            : voice.state === 'transcribing'
              ? 'Sending this recording to Muse Voice Transcribe…'
              : 'Waiting for microphone permission…'}
        </p>
      )}
      {conversation && (
        <p className="fine-print" role="status">
          {speech.speaking
            ? 'Speaking. The microphone is off until the reply finishes.'
            : pending
              ? 'Thinking. The microphone is off while Muse replies.'
              : voice.state === 'transcribing'
                ? 'Transcribing your question…'
                : 'Listening for your question. Stop the session to type instead.'}
        </p>
      )}
      {!voice.supported && (
        <p className="fine-print">
          Microphone recording is unavailable here. Use a supported browser on localhost or HTTPS;
          typing still works.
        </p>
      )}
      {(voice.error || speech.error || wake.error) && (
        <p className="error" role="alert">
          {voice.error || speech.error || wake.error}
        </p>
      )}
      <p className="fine-print">
        {mode === 'plain'
          ? 'Messages are sent to Meta. This temporary conversation clears when you reload or leave this page.'
          : `Questions and matching record text are sent to ${name}. Earlier answers are snapshots; ask again for a fresh search. This chat persists across household screens and clears on reload or profile switch.`}{' '}
        Microphone audio is sent to Meta for transcription; spoken replies use your browser/device
        voice.
      </p>
    </section>
  );
}
