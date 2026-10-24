# Voice access and blind-user testing

Commonplace should let someone ask about a shared object and hear its last recorded location without needing to inspect a photograph. The current implementation is a prototype; it has not yet been evaluated with blind users or certified for accessibility.

## Current interaction

The household **Ask Muse** screen uses `AssistantPanel` and the shared voice hooks to search saved household records. The temporary standalone assistant has been retired.

```text
Explicitly enable Hello and grant browser permission
  → browser listens for “Hello” while this page is visible
  → wake recognizer stops; app speaks the household greeting
  → user asks a question, then pauses
  → local speech/pause detection ends the recording
  → Meta ASR transcribes the clip
  → Muse answers (with an authorized memory lookup in the household app)
  → browser voice reads the answer
  → return to wake standby for the next “Hello”
```

If the browser recognizes an entire inline command, such as “Hello, where are my keys?”, the app uses that transcript directly after the acknowledgement instead of asking Meta to transcribe it again. Unrelated wake-listening transcripts are ignored by the app and never sent to our API. Browser recognition itself may send audio to the browser vendor.

**Talk to Muse** is the fallback when wake recognition is unavailable: one tap starts a conversation, a pause sends the question, and the app listens for follow-ups after spoken replies. **Dictate a message** lets someone review/edit a transcript before Send. Typing remains available. Hello listening now attempts to start by default when Muse and browser capabilities are available, subject to permissions and the stored voice toggle. If blocked, use Turn on Muse voice. Automated browser tests can disable automatic activation; see [the assistance-session guide](ASSISTANCE_SESSION.md).

**Stop voice session**, **Disable Hello**, and **Escape** cancel voice activity and pending requests. During a question-recording turn, saying “stop”, “stop listening”, “stop voice session”, or “cancel” also stops the session after transcription, without a chat request. Voice stop cannot interrupt playback because recording is off while Muse speaks. A canceled request already received by Meta can still consume usage.

Leaving or hiding the page disables wake listening and stops the active conversation. Returning requires explicit re-enabling. Permission errors, unavailable recognition services, and repeated immediate recognition shutdowns stop wake mode instead of restarting indefinitely. Silence in a question turn ends that session after about eight seconds, without uploading an empty recording.

## What users should hear

- Activation acknowledgement: “Hi I am Muse how can I help you today with household stuff”. Wait for it to finish before asking a separate question.
- A concise answer with the room, landmark/surface description, source, and recorded time when available. For example: “The adapter was last seen beside the monitor in the office at 2:15. I cannot confirm it is still there.” No claim about who placed, moved, or owns it.
- A spoken clarification when two objects match, or a clear explanation when no observation exists. The integrated assistant already requests fresh scoped records and is instructed to preserve their source and timestamp; verify the actual spoken output in the live test.
- Recoverable status and error messages exposed to a screen reader. Listening, transcription, thinking, playback, and wake standby have text statuses. Errors use alerts; the conversation uses an accessible log. A skip link, labeled controls, visible keyboard focus, Escape stop, and reduced-motion support are included.

The app does not determine safe walking routes, obstacle clearance, or metric distance from stored photographs. It must not invent directions or say an item is currently present based only on an earlier observation. Image bounding boxes and relative depth are not physical localization. Use this as a memory aid, not a navigation system.

## Browser limits and privacy

The wake prototype uses `SpeechRecognition` / `webkitSpeechRecognition` in English, with “Hello” as the current phrase. It is not a dedicated on-device wake-word model. Browser support is limited, and some implementations use a remote speech service. Explain that before enabling it. See [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

The site cannot provide Siri's system-level activation while the browser is closed or the phone is locked. This implementation deliberately disables listening when hidden. For a future background experience, evaluate native iOS integrations and their supported activation/permission lifecycle separately; installing this site as a PWA does not establish that capability.

Question recordings go through our backend to Meta ASR. The backend validates a maximum 30-second, 2 MiB mono PCM WAV and does not persist the audio. Muse text generation and ASR are separate requests. Spoken output uses the browser/device voice, whose availability and playback permissions vary. Browser detection or automated mocks do not prove recognition quality or real iPhone support.

## Manual acceptance checks

Start with [the Ask Muse testing guide](MUSE_TESTING.md).

1. **Keyboard only:** Tab from the top to Skip to main content, activate it, and reach chat and voice controls. Confirm visible focus, descriptive names, no focus trap, and Escape stops playback/listening. Check desktop and narrow/mobile layouts.
2. **VoiceOver:** Use macOS Safari and the actual target iPhone with VoiceOver enabled. Verify navigation order, headings, message log, errors, and recording/standby statuses. Check whether screen-reader announcements overlap spoken replies; typed mode with Read replies aloud off is available to avoid duplicate answer narration.
3. **Wake permission:** Enable Hello, grant recognition/microphone permissions, and speak the wake phrase in a quiet room. Hear the cue before asking. Confirm only one question is submitted and standby resumes after the reply. Test an inline question too. Test permission denial and unavailable recognition with manual/typed fallback.
4. **Interruptions:** Use Stop and Escape during acknowledgement, recording, transcription, model processing, and playback. Confirm no late transcript submits a canceled question. Hide/return to the page and verify that listening stays off. Do not expect voice interruption during playback.
5. **Audio conditions:** Try silence, ordinary conversation without the wake phrase, different accents, background speech, headphones, speaker output, and low volume. Check false activation and missed activation rather than judging only one successful attempt. Unsupported browsers must keep typing usable.
6. **Actual evidence:** In the full app, ask about a known object, an unknown object, two similarly named objects, and an object whose location was refreshed by a new camera frame. Listen for source/time and uncertainty. Verify no invented directions. Keep sample evidence labeled when using seeded records.
7. **Blind-user review:** Invite representative users to try finding a remembered item with the display unneeded. Record where they need help, how easily they stop the assistant, whether spoken locations are actionable, and whether repeated confirmations/status announcements become distracting. Fix those issues before claiming the blind-user use case is complete.

Programmatic status announcements help users receive updates without moving focus; see [W3C guidance on status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). This checklist is an evaluation plan, not a statement of WCAG compliance.
