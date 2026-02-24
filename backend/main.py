from fastapi import FastAPI, WebSocket, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import sqlite3
import json
import time
import uuid
import cv2
import numpy as np
import websockets.exceptions
import io
import csv
from datetime import datetime
import random

from ultralytics import YOLO

# ============================================================
# Config
# ============================================================
APP_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = APP_DIR.parent / "frontend"

DB_PATH = APP_DIR / "history.db"
MODEL_PATH = APP_DIR / "best.pt"

CONF_TH_REALTIME = 0.60
CONF_TH_UPLOAD = 0.65

# Reason layer thresholds
BROWN_RATIO_THRESH = 0.33
DARK_RATIO_THRESH = 0.30
BRIGHT_V_THRESH = 185.0
CIRCULARITY_THRESH = 0.65
SOLIDITY_THRESH = 0.85

# ============================================================
# App init
# ============================================================
app = FastAPI(title="QC Douxelle")
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

model = YOLO(str(MODEL_PATH))

# ============================================================
# DB
# ============================================================
def init_db():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,               
        session_id TEXT,
        cls INTEGER NOT NULL,               
        reason TEXT NOT NULL,               
        confidence REAL NOT NULL,
        bbox TEXT,
        image_width INTEGER NOT NULL,
        image_height INTEGER NOT NULL,
        model_name TEXT NOT NULL
    )
    """)
    con.commit()
    con.close()

init_db()

def save_detection_to_db(*, source: str, cls: int, reason: str, confidence: float,
                         bbox, image_size: dict, session_id: str | None, model_name: str):
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("""
        INSERT INTO detections (timestamp, source, session_id, cls, reason, confidence, bbox, image_width, image_height, model_name)
        VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        source,
        session_id,
        int(cls),
        reason,
        float(confidence),
        json.dumps(bbox) if bbox is not None else None,
        int(image_size["width"]),
        int(image_size["height"]),
        model_name
    ))
    con.commit()
    con.close()

# ============================================================
# Reason Layer (Rule-based)
# ============================================================
def analyze_reason(roi_bgr):
    if roi_bgr is None or roi_bgr.size == 0:
        return {"defect_type": "UNKNOWN"}

    hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    brown_mask = ((H >= 5) & (H <= 25) & (S >= 60) & (V >= 40) & (V <= 220)).astype(np.uint8)
    dark_mask = (V <= 60).astype(np.uint8)

    brown_ratio = float(np.mean(brown_mask))
    dark_ratio = float(np.mean(dark_mask))
    bright_v = float(np.mean(V))

    gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_OTSU + cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    circularity, solidity = 1.0, 1.0
    if contours:
        c = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(c)
        peri = cv2.arcLength(c, True)
        if peri > 0: circularity = float(4 * np.pi * area / (peri * peri))
        hull = cv2.convexHull(c)
        hull_area = cv2.contourArea(hull)
        if hull_area > 0: solidity = float(area / hull_area)

    # Logika penentuan tipe defect
    if dark_ratio >= DARK_RATIO_THRESH: return {"defect_type": "OVERCOOKED"}
    if brown_ratio >= BROWN_RATIO_THRESH and bright_v < BRIGHT_V_THRESH: return {"defect_type": "BURNT"}
    if circularity < CIRCULARITY_THRESH: return {"defect_type": "DEFORMED"}
    if solidity < SOLIDITY_THRESH: return {"defect_type": "BROKEN"}
    
    return {"defect_type": "OK"}

def build_consistent_reason(*, model_cls: int, roi_bgr):
    """Membangun alasan singkat dan natural (1 alasan per kondisi)."""
    analysis = analyze_reason(roi_bgr)
    defect = analysis.get("defect_type", "OK")

    if model_cls == 0:
        return "Bentuk dan warna sesuai standar produksi."

    if defect == "DEFORMED":
        return "Bentuk tidak proporsional."
    elif defect == "BROKEN":
        return "Permukaan retak atau tidak utuh."
    elif defect == "OVERCOOKED":
        return "Terlalu gelap / indikasi gosong."
    elif defect == "BURNT":
        return "Warna permukaan terlalu gelap."
    else:
        return "Tidak memenuhi standar kualitas."

# ============================================================
# WebSocket Realtime
# ============================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    session_id = str(uuid.uuid4())[:8]
    await websocket.accept()

    try:
        while True:
            try:
                data = await websocket.receive_bytes()
            except websockets.exceptions.ConnectionClosedError:
                break

            start_time = time.time()
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                await websocket.send_json({"boxes": [], "error": "Frame invalid"})
                continue

            h, w = img.shape[:2]
            results = model(img, imgsz=640, conf=CONF_TH_REALTIME, verbose=False)
            result = results[0]

            boxes, classes, confidences, reasons = [], [], [], []
            counts = {"layak": 0, "tidak_layak": 0}
            best, best_conf = None, -1.0

            if result.boxes is not None and len(result.boxes) > 0:
                for box in result.boxes:
                    cls, conf = int(box.cls[0]), float(box.conf[0])
                    xyxy = [max(0, min(w, v)) for v in box.xyxy[0].tolist()]
                    x1, y1, x2, y2 = map(int, xyxy)
                    roi = img[y1:y2, x1:x2] if (x2 > x1 and y2 > y1) else img

                    reason_text = build_consistent_reason(model_cls=cls, roi_bgr=roi)

                    boxes.append(xyxy); classes.append(cls); confidences.append(conf); reasons.append(reason_text)
                    if cls == 0: counts["layak"] += 1
                    else: counts["tidak_layak"] += 1

                    if conf > best_conf:
                        best_conf = conf
                        best = {"cls": cls, "conf": conf, "bbox": xyxy, "reason": reason_text}

            final = None
            if best:
                final = {"model_status": "Layak" if best["cls"] == 0 else "Tidak Layak", "reason": best["reason"], "confidence": float(best["conf"]), "bbox": best["bbox"]}
                save_detection_to_db(source="realtime", cls=best["cls"], reason=best["reason"], confidence=float(best["conf"]), bbox=best["bbox"], image_size={"width": w, "height": h}, session_id=session_id, model_name=MODEL_PATH.name)

            await websocket.send_json({
                "boxes": boxes, "classes": classes, "confidences": confidences, 
                "counts": counts, "final": final, "inference_time": (time.time() - start_time) * 1000.0,
                "image_size": {"width": w, "height": h}
            })
    except Exception:
        pass

# ============================================================
# Upload Detection
# ============================================================
@app.post("/api/detect")
async def detect_from_upload(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        img = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
        if img is None: raise HTTPException(status_code=400, detail="Invalid image")

        height, width = img.shape[:2]
        results = model(img, imgsz=640, conf=CONF_TH_UPLOAD, iou=0.5, max_det=30, verbose=False)
        result = results[0]

        counts = {"layak": 0, "tidak_layak": 0}
        packed, best, best_conf = [], None, -1.0

        if result.boxes:
            for box in result.boxes:
                cls, conf = int(box.cls[0]), float(box.conf[0])
                xyxy = [max(0, min(width, v)) for v in box.xyxy[0].tolist()]
                x1, y1, x2, y2 = map(int, xyxy)
                roi = img[y1:y2, x1:x2] if (x2 > x1 and y2 > y1) else img
                
                reason_text = build_consistent_reason(model_cls=cls, roi_bgr=roi)
                if ((x2 - x1) * (y2 - y1)) > (0.4 * width * height): continue

                packed.append({"cls": cls, "conf": conf, "bbox": xyxy})
                if cls == 0: counts["layak"] += 1
                else: counts["tidak_layak"] += 1

                save_detection_to_db(source="upload", cls=cls, reason=reason_text, confidence=float(conf), bbox=xyxy, image_size={"width": width, "height": height}, session_id=None, model_name=MODEL_PATH.name)

                if conf > best_conf:
                    best_conf = conf
                    best = {"cls": cls, "conf": conf, "bbox": xyxy, "reason": reason_text}

        return JSONResponse({
            "detections": packed, "counts": counts, 
            "final": {"model_status": "Layak" if best["cls"] == 0 else "Tidak Layak", "reason": best["reason"], "confidence": float(best["conf"]), "bbox": best["bbox"]} if best else None,
            "image_size": {"width": width, "height": height}
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# History Helpers & APIs 
# ============================================================
def _parse_date_ymd(s: str):
    try: return datetime.strptime(s, "%Y-%m-%d")
    except: return None

def _build_where(source, cls, date_from, date_to):
    where_parts, params = [], []
    if source in ("realtime", "upload"):
        where_parts.append("source = ?"); params.append(source)
    if cls is not None:
        where_parts.append("cls = ?"); params.append(int(cls))
    if date_from and _parse_date_ymd(date_from):
        where_parts.append("date(timestamp) >= date(?)"); params.append(date_from)
    if date_to and _parse_date_ymd(date_to):
        where_parts.append("date(timestamp) <= date(?)"); params.append(date_to)
    
    where = " WHERE " + " AND ".join(where_parts) if where_parts else ""
    return where, params

@app.get("/api/history")
def get_history(limit: int = Query(50), offset: int = Query(0), source: str = None, cls: int = None, date_from: str = None, date_to: str = None):
    con = sqlite3.connect(DB_PATH); cur = con.cursor()
    where, params = _build_where(source, cls, date_from, date_to)
    cur.execute(f"SELECT COUNT(*) FROM detections{where}", params)
    total = cur.fetchone()[0]
    cur.execute(f"SELECT id, timestamp, source, session_id, cls, reason, confidence, bbox, image_width, image_height, model_name FROM detections {where} ORDER BY id DESC LIMIT ? OFFSET ?", params + [limit, offset])
    rows = cur.fetchall(); con.close()
    items = [{"id": r[0], "timestamp": r[1], "source": r[2], "session_id": r[3], "cls": r[4], "reason": r[5], "confidence": r[6], "bbox": json.loads(r[7]) if r[7] else None, "image_size": {"width": r[8], "height": r[9]}, "model_name": r[10]} for r in rows]
    return {"total": total, "items": items}

@app.get("/api/history/stats")
def history_stats(source: str = None, cls: int = None, date_from: str = None, date_to: str = None):
    con = sqlite3.connect(DB_PATH); cur = con.cursor()
    where, params = _build_where(source, cls, date_from, date_to)
    cur.execute(f"SELECT COUNT(*) FROM detections{where}", params); total = cur.fetchone()[0]
    cur.execute(f"SELECT COUNT(*) FROM detections{where}" + (" AND " if where else " WHERE ") + "cls=0", params); layak = cur.fetchone()[0]
    cur.execute(f"SELECT COUNT(*) FROM detections{where}" + (" AND " if where else " WHERE ") + "cls=1", params); tidak_layak = cur.fetchone()[0]
    con.close(); return {"total": total, "layak": layak, "tidakLayak": tidak_layak}

@app.get("/api/history/{row_id}")
def get_history_item(row_id: int):
    con = sqlite3.connect(DB_PATH); cur = con.cursor()
    cur.execute("SELECT id, timestamp, source, session_id, cls, reason, confidence, bbox, image_width, image_height, model_name FROM detections WHERE id=?", (row_id,))
    r = cur.fetchone(); con.close()
    if not r: raise HTTPException(status_code=404)
    return {"id": r[0], "timestamp": r[1], "source": r[2], "session_id": r[3], "cls": r[4], "reason": r[5], "confidence": r[6], "bbox": json.loads(r[7]) if r[7] else None, "image_size": {"width": r[8], "height": r[9]}, "model_name": r[10]}

@app.delete("/api/history/{row_id}")
def delete_history_item(row_id: int):
    con = sqlite3.connect(DB_PATH); cur = con.cursor()
    cur.execute("DELETE FROM detections WHERE id = ?", (row_id,)); con.commit()
    deleted = cur.rowcount; con.close(); return {"deleted": deleted}

@app.post("/api/history/clear")
def clear_history():
    con = sqlite3.connect(DB_PATH); cur = con.cursor()
    cur.execute("DELETE FROM detections;"); con.commit(); con.close(); return {"ok": True}

@app.post("/api/history/clear-filtered")
def clear_history_filtered(source: str = None, cls: int = Query(None), date_from: str = None, date_to: str = None):
    if not any([source, cls is not None, date_from, date_to]): raise HTTPException(400, detail="Filter minimal satu")
    where, params = _build_where(source, cls, date_from, date_to)
    con = sqlite3.connect(DB_PATH); cur = con.cursor()
    cur.execute(f"DELETE FROM detections{where}", params); con.commit()
    deleted = cur.rowcount; con.close(); return {"ok": True, "deleted": deleted}

@app.get("/api/export/csv")
def export_csv(source: str = None, cls: int = None, date_from: str = None, date_to: str = None):
    where, params = _build_where(source, cls, date_from, date_to)
    con = sqlite3.connect(DB_PATH); cur = con.cursor()
    cur.execute(f"SELECT id, timestamp, source, cls, confidence, reason FROM detections {where} ORDER BY id DESC", params)
    rows = cur.fetchall(); con.close()
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["id", "timestamp", "source", "cls", "status", "confidence", "reason"])
    for r in rows: writer.writerow([r[0], r[1], r[2], r[3], "Layak" if r[3]==0 else "Tidak Layak", float(r[4]), r[5]])
    output.seek(0)
    filename = f"douxelle-history-{datetime.now().strftime('%Y-%m-%d')}.csv"
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ============================================================
# Serve Pages
# ============================================================
@app.get("/")
async def get_index_page(): return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/detect-upload")
async def get_detect_upload_page(): return FileResponse(FRONTEND_DIR / "detect-upload.html")

@app.get("/detect-realtime")
async def get_detect_realtime_page(): return FileResponse(FRONTEND_DIR / "detect-realtime.html")

@app.get("/history")
async def get_history_page(): return FileResponse(FRONTEND_DIR / "history.html")

@app.get("/about")
async def get_about_page(): return FileResponse(FRONTEND_DIR / "about.html")

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)