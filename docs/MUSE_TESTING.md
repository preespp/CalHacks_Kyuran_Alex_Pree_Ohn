# Test Meta Muse for Remi

Remi uses Meta's model API directly through the backend. It does not require the consumer Muse website, a consumer Meta AI chat session or a separate test page. The product name changed to Remi; provider identifiers and environment variable names remain unchanged.

## Isolated API check

After installing the repository dependencies, configure `MODEL_API_KEY` and an enabled `META_MODEL` in the root `.env`, or enter them when the script prompts. Then run manually:

```bash
.venv/bin/python scripts/test_meta_api.py
```

This makes one real Meta request and can consume credits. It reports status/token counts without printing the key. It does not use the app database, Gemini vision or the frontend. A successful text check does not prove transcription-model access, microphone permissions or household retrieval.

## UI and voice check

Set `ASSISTANT_PROVIDER=muse`, `MODEL_API_KEY`, `META_MODEL` and `META_VOICE_MODEL` (the code defaults to `muse-voice-transcribe-1.0`). Restart `make api`, run `make web`, open the main Remi chat card and type a question. With local memory, enable labeled samples explicitly if you want stored test objects.

Allow microphone access and say Hey/Hello/Hi Remi. Wait for its greeting, ask and pause. Confirm editable dictation, read replies, permission refusal and wake standby. Settings are in the sidebar, not a separate Muse screen. See [Remi voice](REMI_VOICE.md) and [accessibility](ACCESSIBILITY.md).

The provider dashboard is the authority for available model IDs, region/access restrictions, credits and rate limits. A 401/403 indicates key/access issues; 429 can indicate quota/rate/credit limits. Do not claim a fixed free allowance or hackathon qualification from a successful API call. Keep credentials out of browser bundles, screenshots and Git.
