# iPhone → SpacetimeDB → MASt3R-SLAM

Safari sends JPEGs over a same-origin WebSocket. The receiver scores each frame,
calls `upload_binary_frame` over a persistent binary WebSocket, receives JPEG rows
from a subscription to private `image_stream_binary`, verifies the bytes, and writes
an ordered local spool. It then acknowledges (deletes) the database row over the
same connection. Up to four frames can be in flight concurrently.
`watch_slam.py` automatically starts MASt3R-SLAM on each new spool.
This table is a delivery queue, not a permanent image archive. Local JPEGs remain
in `.data/streams/<session>/`; remove finished sessions when no longer needed.

Target: `c2005dfa977b978871c77ab400a529efd494fce3e8d3d60c2aa786050f6ebd02`
on `https://maincloud.spacetimedb.com`. The standalone `stream_module` preserves
the target's existing `user` and `message` tables/reducers. The repository's
separate household module is not deployed to this database.

## Start (Windows/WSL)

From this directory in PowerShell:

```powershell
wsl -d Ubuntu-22.04 -u root --cd "$PWD" --exec bash start_stream.sh
```

The installed `.venv-linux` contains the requirements, isolated from the SLAM
venv at `/opt/mast3r-slam-venv`. The receiver listens on `127.0.0.1:8765`.
The script starts the receiver, sequential SLAM worker, and Cloudflare tunnel.
Stop with Ctrl+C. Logs: `.data/receiver.log`, `.data/watcher.log`, `.data/tunnel.log`.
If tunnel provisioning returns HTTP 429, wait before retrying it independently:

```powershell
.\.data\cloudflared.exe tunnel --url http://127.0.0.1:8765 --no-autoupdate
```

Build the phone URL from the HTTPS hostname in the tunnel log and local key:

```powershell
$captureKey = (Get-Content .data/access-key -Raw).Trim()
"https://YOUR-HOST.trycloudflare.com/#key=$captureKey"
```

Open that URL in iPhone Safari, tap **Start capture**, and allow camera access.
Keep orientation fixed, move slowly, and start at 2–5 FPS. Each upload waits only
for admission to a four-frame queue, while a worker processes earlier frames.
When full, the queue applies backpressure; it does not drop accepted frames.
Stop drains accepted frames before ending the dataset and letting SLAM export
its trajectory and reconstruction. Model startup can take a while; camera uploads
continue into the local spool during startup.

The URL key gates uploads; the database owner token stays on the backend in
`.data/db-token` (or `SPACETIMEDB_TOKEN`). Both files and images are git-ignored.
The table and reducers restrict access to the configured database owner.

## SLAM output

Per-session logs: `.data/streams/<session>/slam.log` and `slam.exit`.
Successful exports: `../../MASt3R-SLAM/logs/iphone/`.
Only database readbacks are fed into SLAM; frames are not reordered by sharpness.
Timestamps are receiver arrival times, not calibrated sensor timestamps.
The watcher processes one session at a time. Later sessions remain on disk.
The adapter waits up to 120 seconds for another frame while capture is active.

Manual execution from the sibling MASt3R-SLAM directory in its WSL environment:

```bash
python main.py --dataset 'spacetime:/absolute/path/to/.data/streams/SESSION' --config config/iphone_224.yaml --no-viz --save-as iphone
```

The sibling `mast3r_slam/dataloader.py` loads `slam_stream.SpacetimeDataset`, and
`main.py` handles end-of-stream. Carry these two edits along when moving this project.

Phone SLAM runs use `config/iphone_224.yaml`: 224-pixel model input, uncalibrated
room-relative geometry, and a blur threshold of 30. The 224 mode uses a center
crop, so keep the area of interest near the center of the image. Coordinates are
approximate; metric scale is not validated. No labeling is performed.

Before inference, the dataset checks each database-readback image once using
Laplacian variance on a normalized 224-pixel center crop. Scores below
`dataset.blur_threshold` are skipped, with filenames and scores in `slam.log`.
Increase the threshold to reject more frames; set it to 0 to disable filtering.
This is a blur heuristic, not a motion or duplicate-frame filter. Low-texture
surfaces can also score poorly. Original JPEGs and timestamps remain saved.
The camera page's saved-frame count includes images subsequently rejected by SLAM.
An all-blurry completed capture exits without loading the model.

## Checks and deployment

Inside WSL from this directory:

```bash
.venv-linux/bin/python check_binary.py
.venv-linux/bin/python check_browser.py
```

The first checks 20 binary subscription readbacks, exact JPEG equality, ordered
manifest writes, deletion acknowledgments, and confirmed FPS with four in flight.
The second sends six existing TUM images through the running receiver, disconnects,
and verifies the accepted frames drain in order. It requires the sibling dataset.
`check_stream.py` and `benchmark_stream.py` exercise the legacy HTTP path only.

Publish an additive update from PowerShell:

```powershell
npm install --prefix stream_module
spacetime publish c2005dfa977b978871c77ab400a529efd494fce3e8d3d60c2aa786050f6ebd02 --server maincloud --module-path stream_module --delete-data=never --yes=remote --no-config
```

Phone uploads overlap four concurrent binary database transfers. The local queue
is memory-only: a server crash can lose queued images that
have not reached the database. Processing errors stop the stream and write an
`ERROR` marker. Database disconnections stop the stream rather than silently
retrying potentially committed uploads. Restart capture to create a new session.
Failed transfers stop capture and leave unacknowledged rows for inspection.

The wire codec in `spacetime_wire.py` is reused from the existing `camera_stream.py`
and targets SpacetimeDB 2.13's v3 BSATN protocol. Raw JPEG bytes replace base64;
there is no per-frame HTTP request or SQL poll. The old `image_stream` table and
reducers remain for compatibility. New captures use `image_stream_binary`.

The FPS
display covers the last ten completed frames, including network time; the notice
shows quality-scoring and database timings separately. Quality ranking never
filters uploads. Run `.venv-linux/bin/python check_binary.py` to measure the current
database path with a saved image (the benchmark does not trigger SLAM).
