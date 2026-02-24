const SEND_FPS = 2;                
const WS_PATH = "/ws";
const MAX_DIM = 960;               
const SHOW_LOADING_DELAY = 250;

// ===== DOM =====
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas ? canvas.getContext("2d") : null;

const toggleBtn = document.getElementById("toggle-detection");
const scanIcon = document.getElementById("scan-icon");
const loadingIndicator = document.getElementById("loadingIndicator");

const fpsEl = document.getElementById("fps");
const inferenceTimeEl = document.getElementById("inference-time");
const layakCountEl = document.getElementById("layak-count");
const tidakLayakCountEl = document.getElementById("tidak-layak-count");

// ===== STATE =====
let ws = null;
let isDetecting = false;
let lastSendAt = 0;
let lastDrawAt = 0;
let awaitingResponse = false;

const sendIntervalMs = Math.round(1000 / SEND_FPS);

// ===== Loading =====
function showLoading() {
  if (!loadingIndicator) return;
  loadingIndicator.style.display = "flex";
}
function hideLoading() {
  if (!loadingIndicator) return;
  loadingIndicator.style.display = "none";
}

// ===== Toggle icon only =====
function setToggleIcon(isRunning) {
  if (!toggleBtn || !scanIcon) return;
  scanIcon.className = isRunning ? "fas fa-pause" : "fas fa-play";
  toggleBtn.title = isRunning ? "Pause detection" : "Start detection";
}

// ===== Resize overlay canvas mengikuti video =====
function resizeCanvasToVideo() {
  if (!video || !canvas) return;
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  canvas.width = w;
  canvas.height = h;
}

// ===== Draw boxes (pakai image_size dari backend) =====
function drawDetections(data) {
  if (!ctx || !canvas) return;

  const boxes = Array.isArray(data?.boxes) ? data.boxes : [];
  const classes = Array.isArray(data?.classes) ? data.classes : [];
  const confidences = Array.isArray(data?.confidences) ? data.confidences : [];

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!boxes.length) return;

  const iw = Number(data?.image_size?.width || canvas.width);
  const ih = Number(data?.image_size?.height || canvas.height);

  const scaleX = canvas.width / iw;
  const scaleY = canvas.height / ih;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b || b.length < 4) continue;

    const x1 = Math.max(0, b[0]) * scaleX;
    const y1 = Math.max(0, b[1]) * scaleY;
    const x2 = Math.max(0, b[2]) * scaleX;
    const y2 = Math.max(0, b[3]) * scaleY;

    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);

    const cls = Number(classes[i] ?? 0);
    const conf = Number(confidences[i] ?? 0);
    const isLayak = cls === 0;

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = isLayak
      ? "rgba(46, 204, 113, 0.95)"
      : "rgba(231, 76, 60, 0.95)";
    ctx.fillStyle = isLayak
      ? "rgba(46, 204, 113, 0.12)"
      : "rgba(231, 76, 60, 0.12)";

    ctx.strokeRect(x1, y1, w, h);
    ctx.fillRect(x1, y1, w, h);

    const label = `${isLayak ? "Layak" : "Tidak Layak"} ${(conf * 100).toFixed(1)}%`;
    ctx.font = "bold 16px Arial";

    const pad = 6;
    const textW = ctx.measureText(label).width;
    const boxH = 24;

    const lx = x1;
    const ly = Math.max(0, y1 - boxH - 2);

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(lx, ly, textW + pad * 2, boxH);

    ctx.fillStyle = "white";
    ctx.fillText(label, lx + pad, ly + 17);

    ctx.restore();
  }
}

// ===== UI counters =====
function updateUICounters(data) {
  const t = Number(data?.inference_time ?? data?.inferenceTime ?? 0);
  if (inferenceTimeEl) inferenceTimeEl.textContent = `${t.toFixed(1)} ms`;

  const now = performance.now();
  const dt = now - (lastDrawAt || now);
  lastDrawAt = now;
  if (fpsEl && dt > 0) fpsEl.textContent = Math.min(60, 1000 / dt).toFixed(1);

  const counts = data?.counts || {};
  if (layakCountEl) layakCountEl.textContent = counts.layak ?? 0;
  if (tidakLayakCountEl) tidakLayakCountEl.textContent = counts.tidak_layak ?? 0;
}

// ===== WebSocket =====
function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${WS_PATH}`;
}

function connectWS() {
  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(getWsUrl());
      ws.binaryType = "arraybuffer";

      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);

      ws.onclose = () => {
        awaitingResponse = false;
        hideLoading();
        setToggleIcon(false);
        isDetecting = false;
      };

      ws.onmessage = (event) => {
        try {
          const text = typeof event.data === "string" ? event.data : null;
          if (!text) return;

          const data = JSON.parse(text);
          drawDetections(data);
          updateUICounters(data);
        } catch (err) {
          console.error("WS parse error:", err);
        } finally {
          awaitingResponse = false;
          hideLoading();
        }
      };
    } catch (e) {
      reject(e);
    }
  });
}

// ===== helper: ukuran capture (native tapi dibatasi MAX_DIM) =====
function getCaptureSize() {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;

  const maxSide = Math.max(vw, vh);
  if (maxSide <= MAX_DIM) return { w: vw, h: vh };

  const scale = MAX_DIM / maxSide;
  return { w: Math.round(vw * scale), h: Math.round(vh * scale) };
}

// ===== Send frame (PNG lossless) =====
async function sendFrameToBackend() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!video || video.readyState < 2) return;

  const now = performance.now();
  if (now - lastSendAt < sendIntervalMs) return;
  if (awaitingResponse) return;

  lastSendAt = now;
  awaitingResponse = true;

  const showTimer = setTimeout(() => {
    if (awaitingResponse) showLoading();
  }, SHOW_LOADING_DELAY);

  const { w, h } = getCaptureSize();

  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");

  tctx.drawImage(video, 0, 0, w, h);

  tmp.toBlob(
    async (blob) => {
      try {
        if (!blob) throw new Error("toBlob null");
        const buf = await blob.arrayBuffer();
        ws.send(buf);
      } catch (e) {
        console.error("sendFrame error:", e);
        awaitingResponse = false;
        hideLoading();
      } finally {
        clearTimeout(showTimer);
      }
    },
    "image/png"
  );
}

// ===== Camera =====
async function startCamera() {
  if (!video) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  });

  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resizeCanvasToVideo();
      resolve();
    };
  });
}

// ===== Loop =====
function loop() {
  if (isDetecting) sendFrameToBackend();
  requestAnimationFrame(loop);
}

// ===== Toggle =====
async function startDetection() {
  try {
    if (!video.srcObject) await startCamera();
    if (!ws || ws.readyState !== WebSocket.OPEN) await connectWS();

    isDetecting = true;
    setToggleIcon(true);

    awaitingResponse = false;
    hideLoading();
  } catch (e) {
    console.error("startDetection error:", e);
    isDetecting = false;
    setToggleIcon(false);
    hideLoading();
    alert("Gagal start realtime detection. Cek permission camera & server backend.");
  }
}

function stopDetection() {
  isDetecting = false;
  awaitingResponse = false;
  hideLoading();
  setToggleIcon(false);
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ===== Bind =====
function bindUI() {
  hideLoading();
  setToggleIcon(false);

  toggleBtn?.addEventListener("click", async () => {
    if (!isDetecting) await startDetection();
    else stopDetection();
  });

  window.addEventListener("resize", resizeCanvasToVideo);
}

// ===== Init =====
window.addEventListener("DOMContentLoaded", async () => {
  bindUI();
  try {
    await startCamera();
  } catch (e) {
    console.warn("Camera not started yet:", e);
  }
  loop();
});
