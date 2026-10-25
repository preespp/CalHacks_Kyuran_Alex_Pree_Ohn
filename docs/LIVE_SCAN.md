# Scanning rooms

Open **New scan**, choose one of the eight room categories or type a custom name, then select **Continue with …**. The camera controls live inside a scrollable dialog; there is no separate Camera menu.

Choose camera mode, front/back camera, room, JPEG quality and update frequency before starting. The separate device-name dropdown in the outer dialog is presentation-only; the capture component's front/back control is the connected selection. Browser permissions determine which physical camera is used.

| Mode                   | Requirements and result                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Camera preview only    | Works without Gemini. Frames go to backend quality checks; no object observations are written.                              |
| Share camera view only | Available with a configured frame sink; uploads views without object-memory analysis.                                       |
| Update shared memory   | Requires Gemini; live remote memory also needs the matching SpacetimeDB sink/module. Saves recognized objects and evidence. |

Capture is immediate on start and then every **5 seconds** by default, selectable **3, 4 or 5 seconds**. It is not 10 FPS. One upload can be in flight; busy ticks are skipped. The analysis interval is a minimum wait after a model result, so recognition throughput also depends on network/model latency. Quality ranking is a sharpness/exposure heuristic, not a tracking or localization guarantee.

The current app closes the dialog on a completed memory update and refreshes the household. Closing the dialog unmounts the camera, stops tracks and cancels unfinished client requests. It does not keep scanning across other screens. Hiding the website or locking the phone stops capture; a frame already accepted by the backend may still finish processing.

Room names group observations. Category scenes are illustrations, not measured maps; photo boxes identify image regions. For repeated scans, label/appearance matching may reuse an ID conservatively or create a new candidate when identity is uncertain. Automatic deletion of objects not visible in a later frame is not implemented.

For provider/database configuration see [setup](SETUP.md) and [image pipeline](IMAGE_PIPELINE.md). For actual device acceptance checks see [accessibility](ACCESSIBILITY.md).
