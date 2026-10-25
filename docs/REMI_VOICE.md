# Remi voice and household members

Remi is the app's name. Its chat and speech transcription still use the existing Meta Muse API; Gemini continues to analyze camera images. Existing environment variable names and API credentials stay the same.

## Try it locally

1. Start `make api` and `make web` in separate terminals with your working Meta configuration.
2. Open the website and allow microphone access when your browser requests it. If access was blocked, click the **Ask Remi** heading in the main-page chat card, update the browser's microphone permission, and choose **Allow microphone** to retry.
3. Say **“Hey Remi”**, **“Hello Remi”**, or **“Hi Remi”**. Wait for Remi's greeting, ask your question, and pause. Remi transcribes the question, searches shared memory, reads the answer, then waits for the next wake phrase.
4. You can also say an inline question, such as **“Hey Remi, where are my keys?”**. This uses the recognized question directly after the greeting.
5. Open **Remi voice settings** in the sidebar, above memory storage. Choose a voice, set reply volume and speaking speed, and use **Preview voice**. Preferences persist on this browser/device. Volume is relative to your device's system volume and applies to subsequent spoken replies.
6. Typing stays available in the existing Remi card and in its expanded chat. Click the **Ask Remi** card heading to reopen the conversation. Closing chat or changing app screens preserves the conversation and wake listener. Switching household profiles clears the conversation.

There is no wake-listening on/off switch. **Stop voice session**, **Stop speaking**, and Escape cancel the current interaction; they leave Remi ready for another wake phrase. Browser permission controls still govern microphone access.

The page must remain visible and the device awake. Hiding the website pauses listening and cancels unfinished recording. Returning to the page attempts to resume wake listening. Some browsers require an initial click or microphone permission; unsupported browsers retain typing and manual voice where available. A backend server cannot listen through a closed iPhone browser.

Wake recognition may use your browser's online speech service. Recorded questions go to Meta for transcription, chat questions and matching item records go to the assistant, and spoken replies use the browser/device's available voices.

## Add household members

Open **Household members** directly below **How it works** in the sidebar, or click your profile. Enter a name and choose **Add household member**. The name is saved through the existing guest-profile service and becomes the active profile. Choose an existing saved name to switch back without creating a duplicate.

The configured profile store determines persistence: the existing SpacetimeDB `user` adapter stores names remotely; local mode stores names according to the existing local profile configuration. No new table or schema publication is required. Names are display profiles, not verified accounts; everyone joins the same prototype household.

## Automated checks

```bash
npm run check
make test
npm run test:module
npm run test:browser -- tests/browser/app.spec.ts
```

These focused browser tests use isolated local data and mock AI/audio services. They check wake phrases, the greeting/transcription/reply sequence, typing and chat history, saved voice/volume settings, adding and switching members, permission recovery, the short-screen scan dialog and the date changing at midnight. Test live audio and microphone permissions on your actual phone as well.
