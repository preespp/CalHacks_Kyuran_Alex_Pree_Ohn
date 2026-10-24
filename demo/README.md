# Three-minute demo

Enable Gemini vision and Muse using the root README and [live scan guide](../docs/LIVE_SCAN.md). Run the API/frontend and use two browser sessions connected to the same API. Join by name as Alex and Pree; no password or email is needed. For a fresh rehearsal, choose a new `DATA_DIR` instead of deleting existing data.

| Time      | Action                                                              | Point to explain                                                                                                                                        |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Show the household                                                  | “One person's camera scan helps everyone find shared objects, including someone who cannot inspect the room visually.”                                  |
| 0:20–0:55 | Alex opens **Camera** and confirms scanning is on                   | Choose the room, 10 FPS upload target, and separate memory-analysis interval. Keep a distinctive object visible. Frames update memory automatically.    |
| 0:55–1:25 | Pree searches from the second session                               | Show the saved image, box, room, source, and time. There is no contributor attribution.                                                                 |
| 1:25–1:55 | Move the visible object to a different surface during the same scan | Wait for a processed frame and the second session's refresh. Association is provisional; similar objects need clarification.                            |
| 1:55–2:25 | Pree asks Muse by voice where the object was last seen              | Hear the latest location and uncertainty; open the saved evidence. Source/time matter. Keep typing available.                                           |
| 2:25–3:00 | Stop scanning and explain architecture/status                       | Camera → FastAPI → Gemini vision → shared observations → Muse read-only lookup. SQLite runs locally; object-memory SpacetimeDB integration is separate. |

Verify actual Meta/Gemini requests with your credentials before describing the integration as live. Without credentials, demonstrate labeled sample search and the honest disabled states. The independent `/muse` playground has no household memory and is only for assistant/voice testing. Keep a recording of the real working flow for network problems; no consumer Muse connector is required.

Try an unknown query such as “purple umbrella.” The correct result is no stored match, not an invented location. Test ambiguous candidates too. The original `desk.svg` illustration remains labeled sample evidence; its boxes are image regions, not physical navigation anchors.

For Meta, emphasize the two-person benefit and accessible Muse interaction. Shared memory does not require knowing who placed an item. The rules and judges determine qualification; the theme is [Bringing People Closer Together with AI](https://cal-hacks-13-0.devpost.com/).
