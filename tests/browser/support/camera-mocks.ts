import type { Page } from '@playwright/test';

export async function installCameraMocks(page: Page) {
  await page.addInitScript(() => {
    const previousMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    const state = {
      streams: 0,
      stopped: 0,
      denied: false,
      constraints: [] as MediaStreamConstraints[],
      jpegQuality: 0,
    };
    Object.defineProperty(window, '__cameraTest', { value: state });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async (options: MediaStreamConstraints) => {
          if (!options.video && previousMedia) return previousMedia(options);
          if (options.audio !== false || !options.video)
            throw new Error('Only camera video is requested');
          if (state.denied) throw new DOMException('Denied', 'NotAllowedError');
          state.constraints.push(options);
          state.streams++;
          let stopped = false;
          const track = {
            stop: () => {
              if (!stopped) {
                stopped = true;
                state.stopped++;
              }
            },
          };
          return { getTracks: () => [track] };
        },
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      writable: true,
      value: null,
    });
    HTMLMediaElement.prototype.play = async () => {};
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      state.jpegQuality = Number(quality);
      return encode.call(this, callback, type, quality);
    };
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 480,
    });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: Parameters<typeof draw>) {
      if (args[0] instanceof HTMLVideoElement) return;
      return draw.apply(this, args);
    };
  });
}
