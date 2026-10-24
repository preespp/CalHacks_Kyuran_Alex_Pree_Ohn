import type { Page } from '@playwright/test';

export async function installVoiceMocks(page: Page) {
  await page.addInitScript(() => {
    type Utterance = {
      text: string;
      onstart?: (() => void) | null;
      onend?: (() => void) | null;
      onerror?: (() => void) | null;
    };
    const state = {
      stopped: 0,
      streams: 0,
      recordings: 0,
      spoken: [] as string[],
      canceled: 0,
      denied: false,
      amplitude: 0,
      blocked: false,
      utterance: null as Utterance | null,
      wakeStarts: 0,
      wakeStops: 0,
      wake: null as Recognition | null,
      recognize(text: string) {
        this.wake?.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: text } }],
        });
      },
      wakeError(error: string) {
        this.wake?.onerror?.({ error });
      },
      endWake() {
        const current = this.wake;
        this.wake = null;
        current?.onend?.();
      },
      finishSpeech() {
        const message = this.utterance;
        this.utterance = null;
        message?.onend?.();
      },
    };
    Object.defineProperty(window, '__voiceTest', { value: state });
    class Recognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onresult:
        | ((event: {
            resultIndex: number;
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void)
        | null = null;
      start() {
        state.wakeStarts++;
        state.wake = this;
        this.onstart?.();
      }
      abort() {
        state.wakeStops++;
        if (state.wake === this) state.wake = null;
        this.onend?.();
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (state.denied) throw new DOMException('Denied', 'NotAllowedError');
          state.streams++;
          let stopped = false;
          return {
            getTracks: () => [
              {
                stop: () => {
                  if (!stopped) {
                    state.stopped++;
                    stopped = true;
                  }
                },
              },
            ],
          };
        },
      },
    });
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
        state.recordings++;
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['test compressed bytes']) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: Recorder });
    Object.defineProperty(window, 'AudioContext', {
      value: class {
        async resume() {}
        async decodeAudioData() {
          return { duration: 0.2 };
        }
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createAnalyser() {
          return {
            fftSize: 2048,
            getFloatTimeDomainData: (samples: Float32Array) => samples.fill(state.amplitude),
          };
        }
        async close() {}
      },
    });
    Object.defineProperty(window, 'OfflineAudioContext', {
      value: class {
        destination = {};
        createBufferSource() {
          return { buffer: null, connect() {}, start() {} };
        }
        async startRendering() {
          return { getChannelData: () => new Float32Array(4800) };
        }
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(public text: string) {}
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speak: (utterance: Utterance) => {
          state.spoken.push(utterance.text);
          state.utterance = utterance;
          if (state.blocked) utterance.onerror?.();
          else utterance.onstart?.();
        },
        cancel: () => {
          state.canceled++;
          state.utterance = null;
        },
      },
    });
  });
}

export interface VoiceTestState {
  stopped: number;
  streams: number;
  recordings: number;
  spoken: string[];
  denied: boolean;
  amplitude: number;
  blocked: boolean;
  finishSpeech: () => void;
  wakeStarts: number;
  wakeStops: number;
  wake: object | null;
  recognize: (text: string) => void;
  wakeError: (error: string) => void;
  endWake: () => void;
}

declare global {
  interface Window {
    __voiceTest: VoiceTestState;
  }
}
