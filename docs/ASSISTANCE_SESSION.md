# Camera and assistant lifetime

The current UI has two different lifetimes:

| Component      | Lifetime                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Remi assistant | Remains mounted across app screens and while its chat dialog is closed. Profile changes reset the conversation. |
| Camera         | Mounted inside the scan dialog. Closing it, including after a completed memory update, stops the stream.        |

This replaces the earlier persistent-camera design; there is no separate Camera menu or fixed compact camera dock. The backend processes accepted frames but cannot keep a closed browser recording. Both device functions require permission and a visible site.

See [live scan](LIVE_SCAN.md), [Remi voice](REMI_VOICE.md), [architecture](ARCHITECTURE.md) and [testing](TESTING.md) for the current instructions.
