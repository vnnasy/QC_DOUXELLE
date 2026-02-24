const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const previewContainer = document.getElementById('previewContainer');
const previewImage = document.getElementById('previewImage');
const resultCanvas = document.getElementById('resultCanvas');
const ctx = resultCanvas.getContext('2d');
const resultsContainer = document.getElementById('resultsContainer');
const layakCount = document.getElementById('layakCount');
const tidakLayakCount = document.getElementById('tidakLayakCount');
const analyzeBtn = document.getElementById('analyzeBtn');
const resetBtn = document.getElementById('resetBtn');
const fileDetails = document.getElementById('fileDetails');

const BOX_STYLE = {
  layak: {
    strokeStyle: '#2ecc71',
    fillStyle: 'rgba(46, 204, 113, 0.12)',
    lineWidth: 4,
    labelBg: 'rgba(46, 204, 113, 0.85)',
    labelText: 'LAYAK'
  },
  tidak_layak: {
    strokeStyle: '#e74c3c',
    fillStyle: 'rgba(231, 76, 60, 0.12)',
    lineWidth: 4,
    labelBg: 'rgba(231, 76, 60, 0.85)',
    labelText: 'TIDAK LAYAK'
  }
};

let currentFile = null;

fileInput.addEventListener('change', handleFileSelect);
uploadArea.addEventListener('dragover', handleDragOver);
uploadArea.addEventListener('dragleave', handleDragLeave);
uploadArea.addEventListener('drop', handleDrop);
analyzeBtn.addEventListener('click', analyzeImage);
resetBtn.addEventListener('click', resetUpload);

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) validateAndLoadFile(file);
}

function handleDragOver(e) {
  e.preventDefault();
  uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) validateAndLoadFile(file);
}

function validateAndLoadFile(file) {
  if (!file.type.match('image.*')) return showError('Only image files are allowed');
  if (file.size > 5 * 1024 * 1024) return showError('File size should be less than 5MB');

  currentFile = file;
  displayPreview(file);
}

function displayPreview(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    previewImage.src = e.target.result;

    previewImage.onload = function () {
      const dpr = window.devicePixelRatio || 1;

      const naturalW = previewImage.naturalWidth;
      const naturalH = previewImage.naturalHeight;

      previewContainer.style.display = 'block';
      uploadArea.style.display = 'none';
      resultsContainer.style.display = 'none';
      analyzeBtn.disabled = false;

      requestAnimationFrame(() => {

        const wrapperWidth =
          previewImage.parentElement.clientWidth ||
          window.innerWidth * 0.9;

        const scale = Math.min(1, wrapperWidth / naturalW);

        const displayW = naturalW * scale;
        const displayH = naturalH * scale;

        resultCanvas.width = naturalW * dpr;
        resultCanvas.height = naturalH * dpr;

        resultCanvas.style.width = displayW + 'px';
        resultCanvas.style.height = displayH + 'px';

        previewImage.style.width = displayW + 'px';
        previewImage.style.height = displayH + 'px';

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, naturalW, naturalH);

        resultsContainer.style.display = 'none';
        analyzeBtn.disabled = false;
      });
    };

  };
  reader.readAsDataURL(file);
}

async function analyzeImage() {
  if (!currentFile) return;

  analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
  analyzeBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('file', currentFile);

    const response = await fetch('/api/detect', { method: 'POST', body: formData });
    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();
    renderResults(data);
  } catch (err) {
    showError(err.message || 'Failed to analyze image');
  } finally {
    analyzeBtn.innerHTML = '<i class="fas fa-search"></i> Analyze Image';
    analyzeBtn.disabled = false;
  }
}

// Support nama field lama/baru: coordinates/bbox, class/cls, confidence/conf
function normalizeDetection(det) {
  const bbox = det.coordinates || det.bbox || det.box || null;
  const cls = (det.class != null) ? det.class : (det.cls != null ? det.cls : null);
  const conf = (det.confidence != null) ? det.confidence : (det.conf != null ? det.conf : 0);
  const reason = det.reason || det.final_reason || '';
  return { bbox, cls, conf, reason };
}

function renderResults(data) {
  const detections = Array.isArray(data?.detections) ? data.detections : [];

  const dpr = window.devicePixelRatio || 1;
  const naturalW = previewImage.naturalWidth;
  const naturalH = previewImage.naturalHeight;

  // buat transform sesuai dpr & clear di natural coord
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, naturalW, naturalH);

  let layak = 0, tidakLayak = 0;

  detections.forEach((raw) => {
    const det = normalizeDetection(raw);
    if (!Array.isArray(det.bbox) || det.bbox.length !== 4) return;

    const [x1, y1, x2, y2] = det.bbox;
    const isLayak = det.cls === 0; // 0=layak, 1=tidak layak
    const style = isLayak ? BOX_STYLE.layak : BOX_STYLE.tidak_layak;

    // Box lebih jelas
    ctx.save();

    ctx.lineWidth = style.lineWidth;
    ctx.strokeStyle = style.strokeStyle;
    ctx.fillStyle = style.fillStyle;

    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    // Label + reason
    ctx.shadowBlur = 0;
    ctx.font = 'bold 12px Poppins';

    const base = `${style.labelText} ${(det.conf * 100).toFixed(1)}%`;
    let labelText = det.reason ? `${base} · ${det.reason}` : base;

    const pad = 6;
    const maxW = Math.min(420, Math.max(180, (x2 - x1) - 10));
    if (ctx.measureText(labelText).width > maxW && det.reason) {
      const prefix = `${base} · `;
      let r = det.reason;
      while (r.length > 0 && ctx.measureText(prefix + r + '…').width > maxW) {
        r = r.slice(0, -1);
      }
      labelText = prefix + (r ? r + '…' : '');
    }

    const textW = ctx.measureText(labelText).width;
    const labelY = y1 - 26 < 0 ? y1 + 6 : y1 - 26;
    const textY  = y1 - 8  < 0 ? y1 + 22 : y1 - 8;

    ctx.fillStyle = style.labelBg;
    ctx.fillRect(x1 - 2, labelY, textW + pad * 2, 22);

    ctx.fillStyle = '#fff';
    ctx.fillText(labelText, x1 + pad - 2, textY);

    ctx.restore();

    if (isLayak) layak++; else tidakLayak++;
  });

  layakCount.textContent = layak;
  tidakLayakCount.textContent = tidakLayak;
  resultsContainer.style.display = 'flex';

  if (detections.length === 0) {
    showError('Tidak ada objek terdeteksi. Coba foto lebih dekat / pencahayaan lebih terang.');
  }
}

function resetUpload() {
  fileInput.value = '';
  currentFile = null;
  previewContainer.style.display = 'none';
  uploadArea.style.display = 'flex';
  resultsContainer.style.display = 'none';

  // clear aman
  const dpr = window.devicePixelRatio || 1;
  const naturalW = previewImage?.naturalWidth || 1;
  const naturalH = previewImage?.naturalHeight || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, naturalW, naturalH);

  analyzeBtn.disabled = true;
  fileDetails.innerHTML = '';

  const h3 = uploadArea.querySelector('h3');
  const p = uploadArea.querySelector('p');
  const b = uploadArea.querySelector('.browse-button');
  if (h3) h3.style.display = 'block';
  if (p) p.style.display = 'block';
  if (b) b.style.display = 'block';
}

function showError(message) {
  const errorEl = document.createElement('div');
  errorEl.className = 'error-message';
  errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${message}</span>`;
  document.body.appendChild(errorEl);

  setTimeout(() => {
    errorEl.classList.add('fade-out');
    setTimeout(() => errorEl.remove(), 300);
  }, 3000);
}

window.addEventListener('load', () => {
  setTimeout(() => {
    const ls = document.getElementById('loadingScreen');
    if (!ls) return;
    ls.style.opacity = '0';
    setTimeout(() => {
      ls.style.display = 'none';
    }, 500);
  }, 800);
});
