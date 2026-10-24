# Muse installation, isolated UI, and voice testing

The current user-facing assistant uses **Meta Muse Spark through Meta Model API**. Gemini remains the computer-vision provider. This integration does not require the consumer Muse app, a Muse subscription, a custom connector, or connector directory approval.

Start with the independent playground below. It uses no database, sample household, Azure, Gemini key, camera, or SpacetimeDB. The frontend calls a small local backend that holds your Meta API key.

## 1. Install the local tools once

Use Node.js 24 LTS, npm, Python 3.12, and Git. From this repository's root:

```bash
make setup
```

If you already completed the README setup, the existing `.venv` and npm dependencies are sufficient. No additional Meta SDK, speech SDK, ffmpeg, database server, Docker, or speech-to-text account is required. Voice uses browser audio APIs plus Meta's HTTP API. `make setup` installs dependencies and does not send model requests.

## 2. Add your Meta key and model

Redeem the $50 hackathon offer using the Meta booth's instructions. In the [Meta developer portal](https://dev.meta.ai/), select the project that received the credit, create a **Model API** key, and confirm the credit balance, expiry, eligible models/products, and Muse Voice Transcribe access. A credit balance alone does not prove every model is available.

Edit `.env` in the repository root, beside `README.md`. Preserve your teammate's existing Gemini vision settings:

```dotenv
MODEL_API_KEY=YOUR_PRIVATE_META_MODEL_API_KEY
META_MODEL=muse-spark-1.3
META_VOICE_MODEL=muse-voice-transcribe-1.0
```

Replace the key placeholder. `muse-spark-1.3` is a documented model example; use the enabled Muse Spark model in your dashboard. `META_MODEL` is a bare model ID, not a URL. Keep the key out of `apps/web`, `VITE_*`, screenshots, URLs, and ordinary chat messages. `.env` is ignored by Git. Do not commit credentials into `.env.example`.

The independent playground reads only Meta settings. It does not require `ASSISTANT_PROVIDER=muse` and ignores incomplete Gemini/storage settings. Restart `make muse-api` after changing `.env`; saving `.env` alone does not reload its contents into a running process. Exported shell variables take precedence over `.env`.

Optional key-only terminal check:

```bash
.venv/bin/python scripts/test_meta_api.py
```

This sends one small live request, with bounded reasoning/output. `META_API_OK` verifies model access only. It does not prove voice, memory, or UI integration. The UI test below is the main independent acceptance check.

## 3. Start only the Muse backend and frontend

In terminal 1, from the repository root:

```bash
make muse-api
```

This starts the independent FastAPI app on `http://127.0.0.1:8002`. It does not import the normal application entry point, create SQLite files, seed objects, or initialize image storage. It can start before your key is supplied; its health endpoint reports `configured: false` until valid settings are present. Configuration health does not validate the key remotely.

In terminal 2:

```bash
make muse-web
```

Open **http://localhost:5173/muse** directly for the independent test. It shows **Just ask your household**, the same sidebar and assistant layout as the household's **Ask Muse** tab, plus a **memory is disconnected** test banner. Message box, Send, **Talk to Muse**, dictation/read-aloud controls, and optional **Enable Hello** are available. Saving photos, household switching, and household memory are disconnected here. Chat history is temporary, not a simulated shared database.

The homepage **http://localhost:5173/** always stays the household app. Both `make web` and `make muse-web` retain both pages; neither redirects `/` to `/muse`. The old `VITE_MUSE_LAB_ONLY` flag is no longer used. The **Muse chat** menu link opens the temporary test page; **Our memory** goes back to the homepage, and **Ask Muse** opens the integrated assistant there.

The proxies separate `/api/lab/*` → Muse on port **8002** from household `/api/*` → port **8000**. Only `make muse-api` is needed while staying on `/muse`. To use the household homepage too, run **`make api` in a third terminal**. Its current local SQLite store initializes automatically; no separate database service is needed. The household page requires that API even if the standalone chat works. Stop an old frontend on port 5173 with Ctrl+C and restart it to load updated code/proxies. Do not run `make web` and `make muse-web` together on the same port.

The playground is a **local development tool**, not a public deployment. It has no end-user sign-in, accepts only local browser hosts/origins, and must remain bound to loopback. Do not deploy or expose the sandbox through a public tunnel. Real public access belongs in the authenticated full app.

## 4. Test typed chat first

1. Type **Introduce yourself in one sentence** and press **Send**.
2. Expect an actual Muse reply. No household records or artificial object results are injected.
3. Ask a follow-up, such as **Make that shorter**. Up to eight recent text messages are sent as context.
4. Ask **Where are my actual house keys?** The isolated assistant has no memory tools; it should explain that it cannot look up your household here.
5. Press **Clear chat**, or reload the page. Conversation state is temporary and is not a shared persistent memory.

In browser developer tools → Network, look for `POST /api/lab/chat`. A successful response contains `provider: "muse"` and `answer`. No Meta key appears in browser requests or responses. The backend forwards the text to `https://api.meta.ai/v1/responses` with server-held credentials. It requests `store: false` and does not use server-managed conversation IDs.

Each Send performs one live model request and consumes Meta quota/credits. Failures are visible and do not automatically retry or switch to Gemini. You should see no `/api/demo/session`, object, activity, or camera requests on this page.

## 5. Test voice input and spoken replies

Meta documents [Muse Voice Transcribe](https://dev.meta.ai/docs/speech-to-text) as **speech-to-text only**. It does not synthesize speech or provide a speech-to-speech conversation API. Our frontend therefore combines:

```text
Microphone recording
  → in-browser conversion to supported WAV
  → local backend → Muse Voice Transcribe
  → editable transcript → Send
  → Muse Spark text reply
  → browser/device speech synthesis
```

Use a recent desktop Chrome or Safari on localhost for the first test:

1. Press **Talk to Muse** once and allow microphone access. On macOS, also allow your browser under System Settings → Privacy & Security → Microphone if necessary.
2. Speak normally, then pause for about **1.3 seconds**. The level meter should react while you speak. After it detects speech followed by silence, the app automatically stops that recording, transcribes it, sends the question to Muse, and displays the answer. There is no separate Stop recording / Send action in this mode.
3. Muse reads the reply aloud using the browser voice. The microphone stays off during transcription, model processing, and playback, so speaker output is not captured as another question.
4. When speech playback finishes successfully, the app listens for your next question automatically. The follow-up uses the latest conversation history. About **eight seconds without detected speech** ends the session without uploading an empty clip.
5. Press **Stop voice session** to cancel listening/transcription/pending chat, stop playback, and return to typing. Leaving the page or hiding the tab also stops voice activity. Stopping a request after it has reached Meta does not reverse API usage.
6. If playback is blocked, the conversation pauses. The answer remains visible; tap **Read reply** explicitly or type instead. Safari may require that explicit playback gesture.
7. For the earlier review-before-send workflow, use **Dictate a message** instead. Speak, press **Stop and transcribe**, review/edit the text, and press **Send**. **Cancel recording** discards an unsent recording. **Cancel voice input** stops a pending permission/transcription step.
8. Deny microphone permission and verify that the session stops with a clear error while typed chat still works. Check the level meter and browser/system input device if it reports no speech.

The UI records for at most about 29 seconds, converts audio to mono 24 kHz 16-bit PCM WAV using browser APIs, and the backend enforces a 30-second/2 MiB limit. WAV validation happens before a paid transcription request. Our backend keeps audio only in request memory and does not save recordings to disk. Meta receives the clip to transcribe it; its account terms apply. A transcription request and the later chat request are separate billable operations.

Spoken output is **your browser/device voice, not a Muse-generated voice**. Available voices, language quality, autoplay rules, and whether the operating system uses a remote speech service depend on your device. Text remains visible. This provides turn-by-turn conversation while the visible page is active, plus optional manual dictation. An optional foreground “Hello” prototype is described below. This is not an OS wake-word service or a background listener, and it does not support speaking over Muse to interrupt it; use Stop voice session or Escape. It still uses separate transcription and model requests, so network latency remains.

The local playground is not intended for a phone opening a plain HTTP LAN address. Mobile microphone/camera use needs a secure context and the full app's proper access boundary. Desktop browser tests do not establish real iPhone microphone behavior.

### Optional Hello activation

1. Enable **Hello** explicitly and allow the browser's speech-recognition permission. It starts off every time you mount the assistant. You should hear “Wake listening enabled.”
2. Keep the page visible and say **Hello**. Wait for **I'm listening** to finish before asking your question; this avoids talking over the acknowledgement. The browser recognizer stops before the question recording starts.
3. Ask, then pause. Meta transcribes the question, Muse replies, and the browser reads the answer. After that reply, the app returns to wake standby rather than recording another follow-up automatically. Say Hello for the next turn. A single phrase such as **Hello, tell me a joke** also works when the browser supplies the complete final transcript; this inline command uses that browser transcript and needs no extra Meta transcription.
4. Use **Disable Hello**, **Stop voice session**, or **Escape** to end all voice activity. Saying **stop**, **stop listening**, **stop voice session**, or **cancel** during the question-recording turn stops it after transcription, without sending a chat request. This voice stop command cannot interrupt playback. Tab-hiding/navigation disables wake mode; returning does not silently re-enable it.
5. Deny recognition permission and verify a clear error with typing still available. Repeated immediate browser shutdowns stop retries. In a browser with no recognition API, Hello is disabled while manual Talk/dictation and typing remain available.

Wake activation uses the browser's **SpeechRecognition/webkitSpeechRecognition** service, not Meta's ASR and not a dedicated local wake-word model. Some implementations send listening audio to their recognition servers, so this is **not a privacy-preserving local-only listener**. Unrelated recognized speech is ignored by this app and is not sent to our API or Meta. Recognition language/phrase is currently English, “Hello”. Browser availability, permission prompts, and behavior vary; feature detection alone does not establish that it works on an iPhone. See [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) and [the accessibility flow and test checklist](ACCESSIBILITY.md).

## 6. Troubleshooting

| Symptom                                                           | What to do                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cannot reach Muse test backend / 404                              | Run `make muse-api` and `make muse-web`; use `/muse`. Restart an old Vite process so the separate Muse proxy is applied.                                                                                                                     |
| `/api/demo/session` returns 404 while `/api/lab/chat` returns 200 | A 404 means the target server does not expose household login. Keep the separate proxies, start `make api` on 8000 for `/`, or stay on `/muse` with only `make muse-api`. Successful `/api/lab/chat` requests show the test chat is working. |
| Assistant not enabled / 503                                       | Set `MODEL_API_KEY` and `META_MODEL` in the root `.env`, then restart the independent backend.                                                                                                                                               |
| Meta rejects chat / 502                                           | Check the Model API key, selected project, allowed model, permissions, and credit eligibility. The UI does not print the upstream body or your key.                                                                                          |
| 429                                                               | Check credit balance and rate limits. Wait before manually retrying. A second key in the same Meta team does not create another allowance.                                                                                                   |
| Incomplete/no short answer                                        | The model may have consumed its reasoning/output budget or returned a blocked/invalid response. Check model support and supported settings; this is not necessarily a bad key.                                                               |
| Chat works but transcription fails                                | Check access to `muse-voice-transcribe-1.0` and whether the offer covers it. Typed chat still works; ask the booth about voice access.                                                                                                       |
| No microphone / permission denied                                 | Use a supported browser on localhost, enable microphone permission, and check macOS privacy controls.                                                                                                                                        |
| Speech playback blocked/silent                                    | Tap Read reply explicitly; check device volume, browser audio permissions, and installed system voices.                                                                                                                                      |
| Lost context                                                      | This is an intentionally temporary conversation, limited to eight recent messages per request.                                                                                                                                               |

The $50 credit and model availability are account-specific. Review the dashboard after a short test; the repository cannot confirm your balance or redeem the offer for you. Official references: [Meta quickstart](https://dev.meta.ai/docs/quickstart), [Responses API](https://dev.meta.ai/docs/protocols/responses), [speech-to-text](https://dev.meta.ai/docs/speech-to-text), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), and [browser speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).

## 7. Connect shared memory after your independent test passes

When the team is ready, keep the same Meta settings and set `ASSISTANT_PROVIDER=muse`. Use the regular `make api` and `make web` commands and open `/` instead of `/muse`. The full app currently uses local SQLite and demo identities; SpacetimeDB integration remains a separate milestone.

Once the integrated experience passes the team’s acceptance checks, remove the temporary `/muse` route, navigation link, and lab launch target; retain the shared household layout, `AssistantPanel`, and voice hooks. Do not remove the test page before integration works.

As Alex, report the adapter's new location through the object card. As Pree in another session, open **Ask Muse** and ask where the adapter is now. Verify a fresh authorized memory search, Alex's timestamped member report, the separate earlier photograph, and the observation history. Unknown objects must produce no stored observation, and ambiguous candidates must require clarification. Chat remains read-only; Update location / Found it remain the write controls. `/api/voice/transcribe` in the full app requires the normal member session.

Gemini computer vision uses `GEMINI_VISION_API_KEY` and `GEMINI_MODEL` separately. Do not replace the vision teammate's key with your Meta key. The optional external consumer Muse connector gateway is a different experiment and is not required for this integration.

## 8. Automated checks versus your live test

```bash
make test
npm run check
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
```

Automated tests mock Meta/Gemini HTTP responses and browser audio so they do not spend your credit. Backend checks cover database isolation, scoped memory tools, encrypted tool replay, invalid audio, permissions, quota/errors, and typed fallback. Browser checks cover the persistent household homepage, database-free test route, separate proxy destinations, shared layout, menu links, wake opt-in/acknowledgement/standby/permission and visibility handling, automatic pause/send/reply/follow-up behavior, cancellation, silence, blocked playback, manual dictation, and the existing household UI. They cannot verify real speech recognition quality, your live balance/permissions, speakers, microphone hardware, or an iPhone. Complete sections 4 and 5 with your own key before calling the live integration verified.
