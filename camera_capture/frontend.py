from __future__ import annotations

import os

import uvicorn


PAGE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#121916">
  <title>Fieldframe | Frame Capture</title>
  <style>
    :root {
      color-scheme: dark;
      --page: #121916;
      --panel: #1b2420;
      --line: #38443d;
      --text: #eef3ed;
      --muted: #9ca89f;
      --acid: #d3f278;
      --green: #7ed8ae;
      --red: #f19b82;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(ellipse at 82% -10%, #344237 0, var(--page) 52%);
      color: var(--text);
      font-family: "Aptos", "Segoe UI", sans-serif;
    }
    button, select { font: inherit; }
    .shell { width: min(1120px, calc(100% - 40px)); margin: auto; }
    header { min-height: 68px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); }
    .brand { display: flex; gap: 10px; align-items: center; font-size: 14px; font-weight: 700; letter-spacing: .04em; }
    .mark { width: 26px; height: 26px; border: 1px solid var(--acid); border-radius: 7px; position: relative; }
    .mark::before { content: ""; width: 9px; height: 9px; border: 1px solid var(--acid); border-radius: 50%; position: absolute; left: 7px; top: 7px; }
    .mark::after { content: ""; width: 3px; height: 3px; border-radius: 50%; background: var(--acid); position: absolute; right: 4px; top: 4px; }
    .status { display: flex; align-items: center; gap: 8px; color: var(--muted); font: 11px ui-monospace, monospace; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #69766d; flex: none; }
    .dot.on { background: var(--green); box-shadow: 0 0 10px #7ed8ae88; }
    main { padding: 30px 0 44px; }
    .intro { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
    .kicker { color: var(--acid); font: 11px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .1em; }
    h1 { margin: 8px 0 0; font-size: 32px; line-height: 1.15; font-weight: 600; }
    .target { color: var(--muted); font: 12px ui-monospace, monospace; }
    .camera { min-width: 0; border: 1px solid var(--line); background: #171f1bdf; }
    .panel-head { min-height: 41px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 13px; border-bottom: 1px solid var(--line); color: var(--muted); font: 11px ui-monospace, monospace; }
    .stage { display: grid; place-items: center; position: relative; overflow: hidden; background: repeating-linear-gradient(135deg, #17201c 0 12px, #19231e 12px 24px); }
    .stage { aspect-ratio: 16 / 10; min-height: 250px; }
    video { display: none; width: 100%; height: 100%; object-fit: contain; }
    video.visible { display: block; }
    .empty { width: min(300px, 90%); padding: 18px; text-align: center; color: var(--muted); }
    .camera-icon { width: 44px; height: 33px; border: 1px solid #748078; border-radius: 5px; margin: 0 auto 13px; position: relative; }
    .camera-icon::before { content: ""; position: absolute; width: 13px; height: 13px; border: 1px solid var(--acid); border-radius: 50%; top: 8px; left: 14px; }
    .empty strong { display: block; margin-bottom: 6px; color: var(--text); font-weight: 600; }
    .empty span { font-size: 12px; line-height: 1.5; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 13px; border-top: 1px solid var(--line); }
    .metric { color: var(--muted); font: 10px ui-monospace, monospace; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 5px; color: var(--text); font-size: 15px; font-weight: 500; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-top: 13px; }
    .controls { display: flex; align-items: center; gap: 9px; }
    .capture-settings { display: grid; grid-template-columns: repeat(2, minmax(170px, 1fr)); gap: 16px; margin-top: 15px; padding: 14px; border: 1px solid var(--line); background: #171f1bdf; }
    .setting-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 9px; color: var(--muted); font: 11px ui-monospace, monospace; }
    input[type="range"] { width: 100%; accent-color: var(--acid); }
    button { min-height: 42px; padding: 0 17px; border: 1px solid var(--acid); border-radius: 4px; background: var(--acid); color: #172014; font-weight: 700; cursor: pointer; }
    button.secondary { border-color: #56645a; background: var(--panel); color: var(--text); }
    button:disabled { cursor: not-allowed; opacity: .45; }
    select { min-height: 42px; padding: 0 30px 0 10px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--text); }
    .notice { margin-top: 15px; padding: 11px 12px; border-left: 2px solid var(--acid); background: #d3f2780d; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .notice.error { border-color: var(--red); color: #f4b6a3; background: #f19b820d; }
    @media (max-width: 720px) {
      .shell { width: calc(100% - 24px); }
      header { min-height: 58px; }
      main { padding-top: 22px; }
      h1 { font-size: 28px; }
      .intro { align-items: start; flex-direction: column; }
      .stage { aspect-ratio: 4 / 3; min-height: 250px; }
      .toolbar { align-items: stretch; flex-direction: column; }
      .controls { display: grid; grid-template-columns: 1fr 1fr; }
      .controls button, .controls select { width: 100%; }
      .capture-settings { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand"><span class="mark" aria-hidden="true"></span><span>FIELDFRAME</span></div>
      <div class="status"><span id="statusDot" class="dot"></span><span id="statusText">READY</span></div>
    </header>
    <main>
      <div class="intro">
        <div><div class="kicker">Live camera / backend capture</div><h1>Camera preview</h1></div>
        <div class="target">QUALITY CHECK RUNS ON BACKEND</div>
      </div>
      <section class="camera" aria-label="Live camera preview">
        <div class="panel-head"><span>LIVE CAMERA</span><span id="resolution">NO SIGNAL</span></div>
        <div class="stage">
          <video id="video" autoplay muted playsinline></video>
          <div class="empty" id="cameraEmpty"><div class="camera-icon"></div><strong>Camera is off</strong><span>Start capture to preview and send frames to the backend.</span></div>
        </div>
        <div class="metrics">
          <div class="metric">Frames sent<strong id="frameCount">0</strong></div>
          <div class="metric">Backend receive rate<strong id="receivedFps">--</strong></div>
          <div class="metric">Top candidates<strong id="topFrameCount">0 / 3</strong></div>
        </div>
      </section>
      <div class="toolbar">
        <div class="controls">
          <select id="cameraFacing" aria-label="Choose camera"><option value="environment">Back camera</option><option value="user">Front camera</option></select>
          <button id="startButton">Start capture</button>
          <button id="stopButton" class="secondary" disabled>Stop</button>
        </div>
        <div class="target">720P PREVIEW TARGET</div>
      </div>
      <div class="capture-settings">
        <div>
          <div class="setting-head"><label for="uploadFps">Upload rate</label><span id="uploadFpsValue">10 FPS</span></div>
          <input id="uploadFps" type="range" min="1" max="30" value="10" aria-label="Images sent per second">
        </div>
        <div>
          <div class="setting-head"><label for="jpegQuality">JPEG quality</label><span id="jpegQualityValue">78%</span></div>
          <input id="jpegQuality" type="range" min="30" max="95" value="78" aria-label="JPEG compression quality">
        </div>
      </div>
      <div class="notice" id="notice">The live preview stays on the phone. Sampled JPEG frames go to receiver.py for quality analysis; nothing is saved to a database yet.</div>
    </main>
  </div>
  <script>
    const video = document.querySelector("#video");
    const notice = document.querySelector("#notice");
    const uploadFps = document.querySelector("#uploadFps");
    const jpegQuality = document.querySelector("#jpegQuality");
    let cameraStream = null;
    let socket = null;
    let running = false;
    let waitingForFrameResult = null;

    function setNotice(message, isError = false) {
      notice.textContent = message;
      notice.classList.toggle("error", isError);
    }

    function stopCapture() {
      running = false;
      if (waitingForFrameResult) {
        waitingForFrameResult();
        waitingForFrameResult = null;
      }
      if (socket) socket.close();
      socket = null;
      if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
      video.srcObject = null;
      video.classList.remove("visible");
      document.querySelector("#cameraEmpty").hidden = false;
      document.querySelector("#statusDot").classList.remove("on");
      document.querySelector("#statusText").textContent = "READY";
      document.querySelector("#resolution").textContent = "NO SIGNAL";
      document.querySelector("#startButton").disabled = false;
      document.querySelector("#stopButton").disabled = true;
      document.querySelector("#frameCount").textContent = "0";
      document.querySelector("#receivedFps").textContent = "--";
      document.querySelector("#topFrameCount").textContent = "0 / 3";
    }

    function handleBackendMessage(event) {
      if (typeof event.data !== "string") {
        setNotice("Unexpected binary response from frame processor.", true);
        if (waitingForFrameResult) waitingForFrameResult();
        waitingForFrameResult = null;
        return;
      }

      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        setNotice("Received an invalid response from the frame processor.", true);
        if (waitingForFrameResult) waitingForFrameResult();
        waitingForFrameResult = null;
        return;
      }
      if (data.type === "frame") {
        document.querySelector("#frameCount").textContent = data.received_frames;
        document.querySelector("#receivedFps").textContent = `${data.received_fps} FPS`;
        document.querySelector("#topFrameCount").textContent = `${data.top_frames.length} / 3`;
      } else if (data.type === "error") {
        setNotice(data.message, true);
      }
      if (waitingForFrameResult) waitingForFrameResult();
      waitingForFrameResult = null;
    }

    async function sendFrames() {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      let nextCaptureAt = performance.now();

      while (running && socket?.readyState === WebSocket.OPEN) {
        const waitBeforeCapture = nextCaptureAt - performance.now();
        if (waitBeforeCapture > 0) await new Promise((resolve) => setTimeout(resolve, waitBeforeCapture));
        const frameStartedAt = performance.now();
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const quality = Number(jpegQuality.value) / 100;
          const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
          if (!running || !jpeg || socket?.readyState !== WebSocket.OPEN) break;

          const resultReceived = new Promise((resolve) => { waitingForFrameResult = resolve; });
          socket.send(jpeg);
          await resultReceived;
        }
        nextCaptureAt = frameStartedAt + 1000 / Number(uploadFps.value);
      }
    }

    uploadFps.addEventListener("input", () => {
      document.querySelector("#uploadFpsValue").textContent = `${uploadFps.value} FPS`;
    });

    jpegQuality.addEventListener("input", () => {
      document.querySelector("#jpegQualityValue").textContent = `${jpegQuality.value}%`;
    });

    async function startCapture() {
      stopCapture();
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setNotice("Camera access requires HTTPS. Open this page using its secure HTTPS URL.", true);
        return;
      }
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: document.querySelector("#cameraFacing").value },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 }
          }
        });
        video.srcObject = cameraStream;
        await video.play();
        video.classList.add("visible");
        document.querySelector("#cameraEmpty").hidden = true;
        const settings = cameraStream.getVideoTracks()[0].getSettings();
        document.querySelector("#resolution").textContent = `${settings.width || video.videoWidth} x ${settings.height || video.videoHeight}`;
        document.querySelector("#statusText").textContent = "CONNECTING";
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const connection = new WebSocket(`${protocol}//${location.host}/ws/frames`);
        socket = connection;
        connection.addEventListener("open", () => {
          if (socket !== connection) return;
          running = true;
          connection.addEventListener("message", handleBackendMessage);
          document.querySelector("#statusDot").classList.add("on");
          document.querySelector("#statusText").textContent = "CAPTURING";
          document.querySelector("#startButton").disabled = true;
          document.querySelector("#stopButton").disabled = false;
          setNotice(`Camera preview is live. Sending one JPEG at a time, up to ${uploadFps.value} FPS.`);
          sendFrames();
        });
        connection.addEventListener("error", () => {
          if (socket === connection) setNotice("Could not connect to the frame processor. Check that the backend is running.", true);
        });
        connection.addEventListener("close", () => {
          if (socket !== connection) return;
          stopCapture();
          setNotice("Backend connection closed. Start capture to reconnect.", true);
        });
      } catch (error) {
        stopCapture();
        setNotice(`Could not start capture: ${error.message || error}`, true);
      }
    }

    document.querySelector("#startButton").addEventListener("click", startCapture);
    document.querySelector("#stopButton").addEventListener("click", stopCapture);
    document.querySelector("#cameraFacing").addEventListener("change", () => {
      if (cameraStream) startCapture();
    });
  </script>
</body>
</html>"""


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    port = int(os.environ.get("PORT", os.environ.get("FRONTEND_PORT", "8000")))
    uvicorn.run("receiver:app", host=host, port=port)
