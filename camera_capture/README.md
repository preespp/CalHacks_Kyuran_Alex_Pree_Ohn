# Fieldframe Camera Capture

A small browser-based camera capture prototype. The phone displays a live camera preview and sends sampled JPEG frames to a Python backend over a same-origin WebSocket. OpenCV measures basic sharpness and exposure and retains the three highest-scoring frames in memory for each connection.

This prototype does not save frames to disk or a database, and it does not perform mapping.

## Requirements

- Python 3.10 or newer
- An iPhone running Safari for camera testing
- `cloudflared` for a temporary HTTPS link when testing from the iPhone

Camera access requires a secure HTTPS page. Desktop `localhost` is considered secure by browsers, but an iPhone cannot use the computer's `localhost` address.

## Run Locally

From the project directory in PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:FRONTEND_PORT = "8767"
python frontend.py
```

Open [http://localhost:8767](http://localhost:8767) on the computer. `frontend.py` starts the FastAPI application from `receiver.py`; the root page and `/ws/frames` endpoint are served from the same host and port.

## Test on iPhone

Install Cloudflare Tunnel if needed:

```powershell
winget install --id Cloudflare.cloudflared
```

If PowerShell cannot find `cloudflared` after installation, open a fresh PowerShell window. Keep the Python server running, open a second terminal, and run:

```powershell
cloudflared tunnel --url http://localhost:8767
```

Open the `https://...trycloudflare.com` URL printed by the command in iPhone Safari. Tap **Start capture** and grant camera permission. Keep both the app and tunnel running while testing.

The temporary tunnel exposes the receiver publicly without authentication. Use it only for non-sensitive testing and stop it with Ctrl+C when finished.

## Capture Controls

- **Camera:** select the back or front camera.
- **Upload rate:** select 1–30 JPEG frames per second; default is 10. Processing/network speed may lower the achieved rate. The sender waits for each backend response before sending another frame, avoiding a queue of stale images.
- **JPEG quality:** select 30–95%; default is 78%. Higher values retain more image detail and use more bandwidth.
- **Camera request:** the page requests up to 1280×720 at 30 FPS. Safari and the device choose the actual camera settings, shown in the page.

JPEG quality is a compression setting, not a focus or sharpness control.

## Backend Quality Check

`receiver.py` accepts binary JPEG frames at `/ws/frames` and creates a `TopFrameSelector(limit=3)` for each connection. For each frame it:

1. Decodes the JPEG with OpenCV.
2. Measures sharpness using Laplacian variance and brightness using average grayscale intensity.
3. Calculates a simple quality score that favors sharper frames with moderate brightness.
4. Retains the three highest-scoring JPEGs in session memory and returns frame count, receive rate, and top-frame metadata as JSON. The JPEG bytes are not sent back to the website.

`image_quality.py` contains the reusable `TopFrameSelector`, `RankedFrame`, and `FrameQuality` types. The starter score combines Laplacian-variance sharpness with a simple exposure penalty; it is not a mapping-specific quality model. The selected images are discarded when the WebSocket connection ends. No database or object storage is configured.

## Dependencies

Install the Python dependencies with:

```powershell
python -m pip install -r requirements.txt
```

`requirements.txt` contains the Python packages. `cloudflared` is a separate Windows command-line program and is installed with `winget`.
