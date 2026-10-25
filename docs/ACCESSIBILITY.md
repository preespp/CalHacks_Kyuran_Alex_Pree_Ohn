# Accessibility and device acceptance

Remi supports typed questions, microphone dictation, hands-free activation and spoken replies. These are prototype features requiring actual device testing; this document does not claim accessibility certification or safe physical navigation.

## Manual checks

- Navigate the sidebar, main chat heading, scan controls, name picker and room-pin buttons with Tab/Enter/Space. Verify visible focus and usable close controls.
- In the chat's native dialog, verify focus behavior and Escape. Some older scan/profile dialogs are custom overlays and should be checked separately with a screen reader.
- Run iPhone VoiceOver and a desktop screen reader. Check object labels, room names, source/timestamps and live chat announcements. Category illustrations have accessible names; their pins are keyboard buttons.
- Allow then deny camera/microphone permission. Typing must remain usable after voice errors, silence, canceled transcription and blocked playback.
- Say Hey/Hello/Hi Remi; verify the greeting precedes question recording, microphone recording pauses while replies play, and standby returns afterward.
- Check voice choice, volume and speed, including a voice that loads late or is unavailable on another device. Available synthetic voices belong to the browser/device.
- Hide the tab or lock the phone during recording. Unfinished audio must not upload; returning attempts wake listening again subject to browser permissions. A closed phone browser cannot keep listening through Azure.
- Check a 390px-wide phone and a short laptop viewport. Scan and sidebar contents must remain reachable by scrolling, and name entry must have enough space.

The saved room/description is the useful spoken finding. Normalized boxes and within-image relative depth are not walking directions or obstacle detection. Category room scenes and pin positions are illustrative. Older generated card depth/confidence badges must not be used for navigation or certainty claims.

Browser wake recognition may use an online speech service; recorded questions go to Meta for transcription, and questions/matching item records go to the assistant. Do not describe this as entirely on-device audio processing. See [voice behavior](REMI_VOICE.md) and [tests](TESTING.md).
