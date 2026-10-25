# Live camera and shared object locations

The household remembers where objects were last seen, with images, boxes, rooms, descriptions, source, and time. Guest names support switching users; observations do not record who placed an item.

## Persistent camera and voice

See [the assistance-session guide](ASSISTANCE_SESSION.md) for the current architecture, defaults, capture and analysis timing, Hello greeting, browser limits, and SpacetimeDB/Vultr setup.

Camera and Muse stay mounted across household screens. Camera defaults to enabled and captures every **5 seconds by default**, selectable 3/4/5 seconds; Hello listening defaults to enabled when supported and Muse is configured. Browser permissions can require a Start/Turn on tap. Use the same on/off controls from Camera, Ask Muse, or the compact status panel. Hiding/leaving the website still stops capture and listening.

The **Update frequency** controls uploads and the minimum wait after each Gemini result, with a default of five seconds and choices of 3/4/5 seconds. One frame is captured immediately on start. Analysis can be slower than capture because it also includes model latency. The backend worker processes the latest frame, bounds pending work, and updates locations without manual entry. The original quality selector still reports sharpness, brightness, and three top-ranked frame candidates. Camera-only preview works without Gemini and writes no object observations.

After pulling, update dependencies without overwriting `.env`:

```bash
.venv/bin/python -m pip install -r services/api/requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e services/api
```

Run `make api` and `make web`, join by name, and grant device permissions. In Camera, stop before changing mode, room, front/back choice, compression, or capture interval; then restart. Enable Gemini credentials for shared-memory mode and Meta credentials for Muse.

For a two-user test, scan a distinctive object, ask Muse from the second session, move the visible object to another surface during the same scan, and wait for the next analyzed frame. A new question must retrieve fresh evidence without attributing it to a person. Test camera/voice simultaneously on the actual target iPhone.

JPEGs fit inside 1280×720; quality defaults to 78%, configurable 30–95%. Compression is not focus. Top-three frames remain bounded temporary diagnostics: at most 16 scans, with ten-minute inactivity pruning on later frames. Memory uses new frames, never an older high-scoring image as a newer location. Images/history accumulate only for actual memory observations; durable retention cleanup is still a later step.

## Association and coordinates

In the remote Onyu path, geometry mode reuses an ID only for a unique, exact label and nonempty appearance match among the room's saved objects. Models mode uses SigLIP candidate matching. In the legacy local SQLite path, association is limited to adjacent observations in the same scan within 60 seconds.

This is provisional association, not verified physical identity. Similar objects can be confused; Gemini descriptions can vary. A new scan/room, missing intermediate detection, changed description, or ambiguity creates new candidate IDs. An empty frame retains older last-seen records and does not prove removal. Muse asks for clarification when candidates overlap. Reliable cross-scan/cross-camera identity remains a separate implementation step.

Boxes are normalized `[xmin, ymin, xmax, ymax]` values from 0 to 1 on the saved image. They are not room coordinates, metric depth, camera pose, SLAM landmarks, or walking directions. A box is displayed only on its own saved image.

## Storage and attribution

MEMORY_PROVIDER=spacetimedb writes live observations and retained photo evidence to the published team tables. MEMORY_PROVIDER=sqlite keeps the legacy local store (`DATA_DIR/memory.sqlite3`) and local images. See [the connected workflow](LIVE_WORKFLOW.md). The optional SpacetimeDB guest registry stores profiles only; it does not automatically receive object observations.

The live schema and object adapter are now connected; the team module publishes vision_capture, object_memory and object_sighting plus an atomic commit reducer. A database URL alone still does not select that adapter: set MEMORY_PROVIDER=spacetimedb. Browser subscriptions and durable leased jobs remain future work.

New observations store no contributor. Memory, history, activity, and assistant/connector results omit actor IDs/names, including for legacy records. Legacy SQLite actor columns and old row values remain internally for compatibility; this change does not erase historical attribution. The separate SpacetimeDB module leaves its optional legacy actor field unset. Profile/session storage remains separate for authorization and switching users.

Manual location controls were removed from the UI. Legacy note/sample endpoints remain for compatibility and test fixtures.

## Meta demo framing

This is still shared memory because multiple people can retrieve and benefit from the same observations. Knowing who placed an item is not required for that behavior. Demonstrate one person scanning and a blind household member asking Muse for the latest saved location, source/time, and uncertainty.

The event lists Meta's **Bringing People Closer Together with AI** track. Explain the human benefit and show meaningful AI integration; a shared database alone does not establish qualification. Judges and official rules determine eligibility. [Cal Hacks prize listing](https://cal-hacks-13-0.devpost.com/).

## Verification

Backend tests cover the original quality selector, temporary scan isolation/eviction, no-model/no-write preview, invalid/oversized images, association boundaries, empty/stale frames, idempotency, household isolation, two-user access, image/box updates, and absent actor fields. Browser tests cover 3/4/5 second cadence, busy ticks, stopping pending requests, visibility, permission denial, camera-page navigation, front-camera/JPEG settings, and real backend OpenCV preview with a mocked camera. They mock AI/camera responses and spend no model credits. Run the root README checks, then complete the real-device test above.
