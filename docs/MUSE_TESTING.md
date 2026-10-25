# Test Ask Muse in the household app

Ask Muse is the single assistant interface. The temporary standalone Muse page and backend have been removed. Old bookmarks open the integrated household assistant after guest entry.

## Install and configure

From the repository root, run `make setup` if dependencies are not installed. Copy `.env.example` to `.env` only if you do not already have an `.env`; keep existing team credentials private.

Set these backend variables:

```dotenv
ASSISTANT_PROVIDER=muse
MODEL_API_KEY=your-private-meta-api-key
META_MODEL=muse-spark-1.3
META_VOICE_MODEL=muse-voice-transcribe-1.0
```

Use model IDs available to your Meta project. Confirm the credit balance and eligible products in your Meta dashboard. The text model and transcription model may have different access permissions. Keys must never be stored in browser code or `VITE_*` variables.

To test locally without Gemini or hosted database services, use:

```dotenv
APP_ENV=development
GUEST_PROFILE_STORE=local
CAMERA_FRAME_SINK=disabled
VISION_PROVIDER=demo
STORAGE_PROVIDER=local
```

The API creates local SQLite object memory automatically and seeds clearly labeled sample records. The local guest list resets when the API restarts. This is the real household flow with local storage; it does not require a separate database process. Restore your team's cloud/vision settings when testing the full pipeline.

## Start the app

In two terminals at the repository root:

```bash
make api
```

```bash
make web
```

Open **http://localhost:5173/**, enter a guest name, and select **Ask Muse**. Restart the API after changing `.env`. Restart an older Vite process once so it picks up the simplified API proxy. Only the household API on port **8000** is needed; there is no separate Muse server.

Ask “Where are the house keys?” or ask about the HDMI adapter. Answers should use saved household evidence, with its source and recorded time. Sample illustrations remain labeled. An unknown item should produce an honest no-observation answer; multiple matches should request clarification. Muse does not infer current physical position or safe walking directions from an old photo.

In browser Network tools, look for authenticated `POST /api/chat` calls. Responses include `provider: "muse"`, `answer`, and memory matches. The backend holds the Meta key and calls the Meta Responses API. Household scope comes from the guest session, not model arguments. Earlier chat messages are context; each new question searches current saved memory.

## Test voice

1. Grant microphone access on localhost or HTTPS. Keep the page visible.
2. Use **Talk to Muse**, ask a question, and pause. The app records, sends a validated WAV to authenticated `/api/voice/transcribe`, submits the text to household chat, reads the reply, and listens for a follow-up.
3. Use **Stop voice session** to return to typing. **Dictate a message** records text for review before Send. **Read reply** plays a saved answer.
4. Enable **Hello** or **Turn on Muse voice** if automatic activation was blocked. Say “Hello”, wait for “Hi I am Muse how can I help you today with household stuff”, then ask. After the spoken answer, it returns to Hello standby.
5. Check **Escape**, permission denial, silence, hiding the tab, and unsupported recognition. Typing must remain available. Voice cannot activate with the website closed or the phone locked.

Question audio goes to Meta for transcription. Hello recognition may use the browser vendor's speech service. Spoken replies use your device/browser voice, rather than a Meta speech-generation model. Automated audio mocks do not establish real iPhone recognition quality. See [accessible voice testing](ACCESSIBILITY.md).

### Choose a different speaking voice

1. Open **Ask Muse**, then expand **Voice settings** below the voice controls.
2. Choose a **Speaking voice** and press **Preview voice** to listen. Stop any voice session first.
3. Adjust **Speaking speed** (0.5×–1.5×) and preview again. **Device default** restores the browser's automatic voice choice.
4. Use **Read reply**, **Talk to Muse**, or **Hello**: greetings and answers use the selected voice and speed.

These preferences are saved in this browser on this device, including after refresh or guest switching. No API key, database, or additional voice service is needed for the preview. Available voices vary by browser/device and may take a moment to load. If a saved voice is no longer available, the app uses the device default until it becomes available again or you choose another. If browser storage is blocked, preferences last only while the app is open. Device voices may themselves use an online speech service.

## Test shared memory with two guests

Open a second browser session and enter another name. Both guests use the prototype household. Update an object's location through a working room scan, or use a location report on an existing record when testing without Gemini. Ask about that object from the first session and confirm a fresh answer reflects the latest saved evidence. It should not claim who placed the object. Earlier answers remain snapshots; ask again after an update.

Camera analysis needs its own Gemini vision credentials. Uploading to the teammate's image database additionally needs an authorized capture-backend identity. Those connections are separate from Muse chat; see [image-pipeline setup](IMAGE_PIPELINE.md).

## Troubleshooting

| Symptom                                   | Action                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Assistant is not enabled                  | Set `ASSISTANT_PROVIDER=muse`, the Meta key, and model ID; restart `make api`.                                  |
| Guest entry or API request returns 404    | Run the current household API with `make api`; restart `make web` and check `API_PROXY_TARGET` if overridden.   |
| Request returns 401                       | Rejoin the household to obtain a valid guest session.                                                           |
| Meta rejects the request                  | Check model access, key/project permissions, and credit eligibility in the provider dashboard.                  |
| Quota or rate limit                       | Check remaining credit and project limits; retry manually when capacity is available.                           |
| Voice fails but typing works              | Check transcription-model access and browser microphone permissions; these are separate from text-model access. |
| Hello is unavailable                      | Use Talk to Muse, dictation, or typing in a supported browser.                                                  |
| A camera upload fails during chat testing | Disable the camera and use the local-only settings above; test camera credentials separately.                   |

## Automated checks

```bash
npm run check
make test
npm run test:module
npm run test:browser
```

Browser tests exercise the integrated household UI with mocked model/audio responses. They also verify that the old standalone endpoints are unavailable and old page bookmarks open Ask Muse. No paid model request is made by these checks. Verify actual text and voice requests with your own credentials before the demo.
