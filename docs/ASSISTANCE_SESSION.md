# Persistent camera and Muse assistance

The household app now keeps one camera controller and one Muse assistant mounted for the signed-in guest. Camera, Our memory, Recent activity, and Ask Muse use navigation without reloading the browser document. Switching these screens changes the displayed controls, not the media session. Chat stays available across these household screens; switching guests or reloading clears it.

## Enable, pause, and stop

Camera and Hello listening default to enabled when their providers/browser capabilities are available. Existing explicit on/off choices are remembered in this browser tab's session storage. Start/Stop on Camera and the persistent camera summary control the same camera; Turn on/off Muse voice controls the same voice session everywhere. The camera preview and voice status remain visible in a compact panel outside their detailed pages.

Browsers still control device permissions. An enabled default cannot bypass a camera/microphone prompt, speech-recognition support, or an autoplay/user-gesture requirement. If automatic activation is blocked, grant permission and use the corresponding Start/Turn on button. Actual on/off state and errors are shown; the app does not pretend a denied device is running.

Say **Hello** after listening is active. Muse replies **“Hi I am Muse how can I help you today with household stuff”**, then records the question after that greeting finishes. An inline “Hello, where are my keys?” uses the recognized question directly. Questions go through backend Muse chat and household-scoped memory tools; microphone clips use Meta transcription and spoken output uses the browser/device voice. Typing, dictation, Talk to Muse, and existing evidence cards remain available.

The camera continues while microphone recording pauses for transcription or spoken playback. Turning off voice leaves the camera running; turning off the camera leaves voice/chat available. Leaving the guest session stops both. Switching guests stops the prior camera/voice controllers; the new guest's controllers follow the stored enabled preferences with new sessions.

Hiding the tab, leaving the website, locking/suspending the phone, or reloading can interrupt capture. Our visibility handler stops camera and voice; return and explicitly re-enable them. An already-received frame may still finish. Persistent _within the app_ does not mean a hosted server can access a phone after its browser stops supplying frames. For observation while a phone is unavailable, use another active household device or a separately provisioned camera source; native/platform capabilities would need separate evaluation.

## Capture and analysis timing

| Work                   | Default                                                              | Purpose                                           |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Local video preview    | Device-dependent, requested up to 30 FPS                             | Show a live view                                  |
| JPEG uploads           | Every 5 seconds; choices 3, 4, 5 seconds                             | Feed backend quality checks and the latest frame  |
| Gemini memory analysis | At least the selected capture interval after each completed analysis | Recognize objects and save last-seen observations |

The first frame is captured on start, followed by one frame every 5 seconds by default. Select 3, 4, or 5 seconds in Camera while stopped. Local video preview remains smooth; this setting controls JPEG capture/uploads. JPEG encoding, networking, and model latency can slow updates. Only one upload is in flight; busy ticks are skipped. Sharpness/exposure scores and top-three diagnostics still use the original camera module.

`POST /api/camera/frames` accepts `image`, `scan_id`, `room`, `memory_enabled`, and `analysis_interval`. Camera-only mode makes no model calls or object-memory writes. Memory mode offers the frame to an in-process backend vision worker and immediately returns quality/job status. The worker retains at most one active inference and one pending latest frame per scan, replacing older pending frames. At most 16 stream states are retained; inactive states are pruned on later ingestion. `GET /api/camera/streams/{scan_id}` reads status; `DELETE` cancels that stream's pending processing. Workers stop on API shutdown and are not a durable job queue.

Memory uses the latest available frame, not the sharpest frame from earlier in the scan. Source/time and saved-image coordinates remain truthful. Absence does not prove removal, and association remains provisional; see [scan limitations](LIVE_SCAN.md).

A quota/model failure stops that worker and is surfaced to the UI, which stops capture. It does not repeatedly call a failed model; explicitly restart with a new scan after resolving the error. Stopping aborts uploads and requests backend cancellation, although an in-progress storage/commit operation can already have completed.

## Setup and testing

Keep the existing `.env`. Run `make api` and `make web` separately. Enable `VISION_PROVIDER=gemini` and the vision key/model for automatic memory updates; otherwise the camera defaults to preview-only. Enable `ASSISTANT_PROVIDER=muse`, `MODEL_API_KEY`, `META_MODEL`, and the supported voice model for Muse. Restart the API after changing settings.

1. Join by name and grant camera/speech permissions when prompted. If activation is blocked, press Start/Turn on.
2. Open Camera, confirm the live preview, default five-second capture interval, 3/4/5-second options, and quality metrics.
3. Move to Ask Muse and say Hello. Hear the exact greeting, ask a question, and hear an evidence-backed last-seen answer. Confirm the camera summary is still on.
4. Navigate to Our memory and back. Verify that the camera did not reopen and the chat did not clear. Test browser Back/Forward too.
5. Turn off Muse voice and confirm camera uploads continue. Restart voice, stop the camera, and confirm typed/voice lookup still works against saved observations.
6. Hide/return to the page and verify stopped statuses and explicit recovery. Test denied permissions and quota errors.
7. Test a short desktop window/zoom: the sidebar scrolls and the user name remains reachable. Test phone layouts, keyboard focus, and VoiceOver, including whether status announcements overlap replies.

Browser tests set `VITE_MEDIA_AUTOSTART=false` for deterministic manual cases and explicitly enable session preferences in automatic-start cases. Normal development/deployment defaults to automatic activation attempts. Tests mock camera/audio/model responses; one preview check uses the actual OpenCV backend. Actual iPhone capture plus recognition/playback must still be tested on the target device.

## SpacetimeDB and hosting

The team's public database is `home-object-finder-i72wg` on `https://maincloud.spacetimedb.com`. The existing `user` table now works with `SPACETIMEDB_PROFILE_TABLE=user`; see [saved-user setup](USERS.md). No module publication or runtime CLI login is needed. New guests receive separate anonymous identities; the uploader's credential is never used to rename users.

The separate camera connector appends frames to `image_stream_binary`; see [image delivery](IMAGE_PIPELINE.md). Public uploads are accepted by the current module, while acknowledgement/deletion remains restricted to the teammate's consumer. The database identity is a destination, not a login token.

[Vultr deployment](DEPLOYMENT.md) runs the API behind HTTPS with backend-only model keys. Local session hashes remain in DATA_DIR. With MEMORY_PROVIDER=spacetimedb, Onyu’s connected worker saves object observations and evidence to the team database; both the page and Muse read those records. See [the full workflow](LIVE_WORKFLOW.md).
