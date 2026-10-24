# Three-minute demo

Run the API and frontend from the root README. Use two browser sessions connected to the same API. For a fresh rehearsal, point `DATA_DIR` at a new directory before starting the API; no data deletion is necessary.

| Time      | Action                                               | Point to explain                                                                                                                                       |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:20 | Show the shared household                            | “Everyone remembers different things. Commonplace gives those memories a place to meet.”                                                               |
| 0:20–0:55 | Open **Remember something**                          | In sample mode, explicitly call this an illustrated sample. With Gemini configured, take a real photo of a distinctive object.                         |
| 0:55–1:25 | Search for an object from the second session         | Show the saved image, highlighted box, room, source, and contributor.                                                                                  |
| 1:25–1:55 | Report that the object moved                         | Change the room/location as Alex. The second session sees the update within five seconds.                                                              |
| 1:55–2:25 | Ask Muse where the object is from the second session | With chat enabled, show the fresh member report, contributor, timestamp, and clickable evidence. Open the record to show the earlier photo separately. |
| 2:25–3:00 | Explain the architecture and integration status      | React, FastAPI, Gemini adapter, local persistence; separate SpacetimeDB module and connector endpoint.                                                 |

Enable chat with [the Muse guide](../docs/MUSE_TESTING.md). Only describe Muse as live after verifying actual model requests with your own credentials. Without credentials, demonstrate search/history and the honest disabled assistant state. Keep a recording of the real working flow for network problems. No consumer Muse connector is required; the assistant uses Meta Model API. Test voice separately before including it in the pitch.

Try an unknown query such as “purple umbrella.” The correct result is “No stored match yet,” not an invented location.

The original `desk.svg` illustration supplies known sample evidence. Its boxes are normalized image regions, not physical positions or camera navigation anchors.
