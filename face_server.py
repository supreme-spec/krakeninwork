#!/usr/bin/env python3
"""
Face Detection & Recognition Server (FastAPI + InsightFace + FAISS)
Production-ready implementation for high-load security systems.
Optimized for 10,000+ persons with FAISS exact search (IndexFlatIP).
"""

import asyncio
import os
import io
import json
import logging
import sqlite3
import base64
import time
import threading
from typing import Any, Dict, List, Optional, Tuple
from pathlib import Path

import cv2
import numpy as np
import faiss
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# ─── Configuration ────────────────────────────────────────────────────────────

FRAME_SKIP: int = int(os.getenv("FACE_FRAME_SKIP", "2"))
MIN_FACE_SIZE: int = int(os.getenv("FACE_MIN_FACE_SIZE", "60"))
MIN_DETECTION_SCORE: float = float(os.getenv("FACE_MIN_DET_SCORE", "0.8"))
COOLDOWN_SECONDS: int = int(os.getenv("FACE_COOLDOWN_SECONDS", "30"))
RECOGNITION_THRESHOLD: float = float(os.getenv("FACE_RECOGNITION_THRESHOLD", "0.55"))
API_KEY: str = os.getenv("FACE_API_KEY", "")
DB_PATH: str = os.getenv("DB_PATH", "prisma/dev.db")

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[FaceEngine] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────────────────

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(title="Smart Security - Face Engine", version="4.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ─── Global State ─────────────────────────────────────────────────────────────

face_app = None
is_initialized = False
used_provider = "CPUExecutionProvider"

faiss_index: Optional[faiss.IndexFlatIP] = None
faiss_index_id_to_person: List[Dict[str, Any]] = []
faiss_lock = threading.Lock()

last_recognition_time: Dict[str, float] = {}
cooldown_lock = threading.Lock()

_frame_counter = 0
frame_lock = threading.Lock()


# ─── Security Middleware ──────────────────────────────────────────────────────

def verify_api_key(x_api_key: str = Header(None, alias="X-API-Key")):
    if not API_KEY:
        return True
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return True


# ─── GPU Provider Selection ───────────────────────────────────────────────────

def get_optimal_providers() -> List[str]:
    """Determines best available GPU acceleration."""
    import onnxruntime as ort
    available_providers = ort.get_available_providers()
    providers: List[str] = []

    if "CUDAExecutionProvider" in available_providers:
        providers.append("CUDAExecutionProvider")
        logger.info("NVIDIA GPU detected. Using CUDA.")
    elif "DmlExecutionProvider" in available_providers:
        providers.append("DmlExecutionProvider")
        logger.info("AMD/Intel GPU detected. Using DirectML.")
    elif "OpenVINOExecutionProvider" in available_providers:
        providers.append("OpenVINOExecutionProvider")
        logger.info("Intel GPU/CPU detected. Using OpenVINO.")
    elif "ROCMExecutionProvider" in available_providers:
        providers.append("ROCMExecutionProvider")
        logger.info("AMD GPU detected. Using ROCm.")
    else:
        logger.warning("No GPU providers found. Falling back to CPU.")

    providers.append("CPUExecutionProvider")
    return providers


# ─── InsightFace Initialization ───────────────────────────────────────────────

def initialize_face_engine() -> Tuple[Any, str]:
    """Initializes InsightFace with smart fallback."""
    used_provider_local = "CPUExecutionProvider"
    try:
        import insightface
        import onnxruntime as ort
        target_providers = get_optimal_providers()
        ort.set_default_logger_severity(3)

        if target_providers == ["CPUExecutionProvider"]:
            logger.info("Initializing InsightFace on CPU...")
            app_instance = insightface.app.FaceAnalysis(
                name="buffalo_l", root=str(MODELS_DIR), providers=["CPUExecutionProvider"]
            )
            app_instance.prepare(ctx_id=-1, det_size=(640, 640))
            logger.info("InsightFace loaded on CPU.")
            return app_instance, "CPUExecutionProvider"

        try:
            logger.info(f"Attempting GPU initialization with: {target_providers[:-1]}")
            app_instance = insightface.app.FaceAnalysis(
                name="buffalo_l", root=str(MODELS_DIR), providers=target_providers
            )
            app_instance.prepare(ctx_id=0, det_size=(640, 640))
            used_provider_local = target_providers[0]
            logger.info(f"InsightFace loaded on {used_provider_local}.")
            return app_instance, used_provider_local
        except Exception as e:
            logger.error(f"GPU initialization failed: {e}")
            logger.warning("Falling back to CPU...")
            app_instance = insightface.app.FaceAnalysis(
                name="buffalo_l", root=str(MODELS_DIR), providers=["CPUExecutionProvider"]
            )
            app_instance.prepare(ctx_id=-1, det_size=(640, 640))
            logger.info("InsightFace loaded on CPU (compatibility mode).")
            return app_instance, "CPUExecutionProvider"

    except Exception as e:
        logger.error(f"Fatal initialization error: {e}")
        import traceback
        traceback.print_exc()
        logger.error("Running in demo mode (no AI).")
        return None, "none"


# ─── Startup ──────────────────────────────────────────────────────────────────

try:
    face_app, used_provider = initialize_face_engine()
    if face_app is not None:
        is_initialized = True
except Exception as e:
    logger.error(f"Startup initialization error: {e}")
    is_initialized = False


# ─── SQLite Auto-Load ─────────────────────────────────────────────────────────

def load_descriptors_from_sqlite(db_path: str = DB_PATH) -> List[Dict[str, Any]]:
    """Loads descriptors directly from SQLite for auto-indexing on startup with WAL mode."""
    if not os.path.exists(db_path):
        logger.warning(f"SQLite DB not found at {db_path}, skipping auto-index.")
        return []

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("""
            SELECT fd.person_id, p.name as person_name, p.category, fd.photo_path, fd.descriptor
            FROM FaceDescriptor fd
            JOIN Person p ON p.id = fd.person_id
        """)
        rows = cursor.fetchall()
        conn.close()

        descriptors: List[Dict[str, Any]] = []
        for row in rows:
            desc_raw = row["descriptor"]
            if isinstance(desc_raw, bytes):
                desc_raw = desc_raw.decode("utf-8")

            desc_list: List[float] = []
            if isinstance(desc_raw, str):
                if desc_raw.strip().startswith("["):
                    desc_list = json.loads(desc_raw)
                else:
                    try:
                        decoded = base64.b64decode(desc_raw)
                        desc_list = np.frombuffer(decoded, dtype=np.float32).tolist()
                    except Exception:
                        desc_list = []

            if not desc_list or len(desc_list) != 512:
                continue

            descriptors.append({
                "person_id": row["person_id"],
                "person_name": row["person_name"],
                "category": row["category"] or "",
                "photo_path": row["photo_path"] or "",
                "descriptor": desc_list,
            })

        logger.info(f"Loaded {len(descriptors)} valid descriptors from SQLite.")
        return descriptors
    except Exception as e:
        logger.error(f"Failed to load descriptors from SQLite: {e}")
        return []


if is_initialized:
    try:
        initial_descriptors = load_descriptors_from_sqlite()
        if initial_descriptors:
            _build_faiss_index(initial_descriptors)
        else:
            logger.info("No descriptors found in DB. FAISS index is empty.")
    except Exception as e:
        logger.error(f"Auto-index build failed: {e}")


# ─── FAISS Helpers ────────────────────────────────────────────────────────────

def _build_faiss_index(descriptors: List[Dict[str, Any]]) -> None:
    """Атомарно перестраивает FAISS индекс, блокируя чтение только на время замены."""
    global faiss_index, faiss_index_id_to_person

    if not descriptors:
        with faiss_lock:
            faiss_index = None
            faiss_index_id_to_person = []
        logger.info("FAISS index cleared (no descriptors).")
        return

    dim = 512
    matrix = np.zeros((len(descriptors), dim), dtype=np.float32)
    person_mapping = []

    for i, item in enumerate(descriptors):
        arr = np.array(item["descriptor"], dtype=np.float32)
        norm = np.linalg.norm(arr)
        if norm > 1e-12:
            matrix[i] = arr / norm
        person_mapping.append({
            "person_id": item["person_id"],
            "person_name": item["person_name"],
            "category": item.get("category", ""),
            "photo_path": item.get("photo_path", ""),
        })

    new_index = faiss.IndexFlatIP(dim)
    new_index.add(matrix)

    with faiss_lock:
        faiss_index = new_index
        faiss_index_id_to_person = person_mapping

    logger.info(f"FAISS index atomically swapped: {new_index.ntotal} vectors, dim={dim}.")


def get_faiss_matches(query_vector: np.ndarray, top_k: int = 5) -> List[Dict[str, Any]]:
    """Searches FAISS and returns mapped person data."""
    if faiss_index is None or faiss_index.ntotal == 0:
        return []

    query = np.array(query_vector, dtype=np.float32).reshape(1, -1)
    norm = np.linalg.norm(query)
    if norm > 1e-12:
        query = query / norm

    with faiss_lock:
        scores, indices = faiss_index.search(query, min(top_k, faiss_index.ntotal))

    results: List[Dict[str, Any]] = []
    for score, idx in zip(scores[0], indices[0]):
        if idx == -1:
            continue
        if idx >= len(faiss_index_id_to_person):
            continue
        results.append({
            "score": float(score),
            "person": faiss_index_id_to_person[idx],
        })
    return results


# ─── Image Helpers ────────────────────────────────────────────────────────────

def load_image_from_bytes(data: bytes) -> Optional[np.ndarray]:
    """Decodes image bytes to RGB numpy array."""
    if not data:
        return None
    try:
        img = Image.open(io.BytesIO(data))
        img_rgb = np.array(img.convert("RGB"))
    except Exception as e:
        logger.error(f"Image decode failed: {e}")
        return None
    if img_rgb.size == 0:
        return None
    return img_rgb


# ─── Quality Gate ─────────────────────────────────────────────────────────────

def passes_quality_gate(face: Any) -> bool:
    """
    Filters low-quality detections before embedding extraction.
    Rejects:
      - det_score < MIN_DETECTION_SCORE
      - face width < MIN_FACE_SIZE
    """
    score = float(face.det_score) if hasattr(face, "det_score") else 0.0
    if score < MIN_DETECTION_SCORE:
        logger.debug(f"Quality gate: score {score:.3f} < {MIN_DETECTION_SCORE}")
        return False

    bbox = face.bbox.astype(int).tolist()
    width = int(bbox[2] - bbox[0])
    if width < MIN_FACE_SIZE:
        logger.debug(f"Quality gate: width {width} < {MIN_FACE_SIZE}")
        return False

    return True


# ─── Cooldown / Debounce ──────────────────────────────────────────────────────

def get_cooldown_key(person_id: Any, category: str = "") -> str:
    return f"{category}:{person_id}"


def is_on_cooldown(person_id: Any, category: str = "") -> bool:
    """Returns True if person was recognized recently. Cleans up expired entries."""
    key = get_cooldown_key(person_id, category)
    now = time.time()
    with cooldown_lock:
        expired_keys = [k for k, v in last_recognition_time.items() if now - v > (COOLDOWN_SECONDS * 2)]
        for k in expired_keys:
            del last_recognition_time[k]

        last_time = last_recognition_time.get(key, 0.0)
        if now - last_time < COOLDOWN_SECONDS:
            logger.debug(f"Cooldown active for {key} ({now - last_time:.1f}s < {COOLDOWN_SECONDS}s)")
            return True
        last_recognition_time[key] = now
    return False


# ─── Frame Skipping ───────────────────────────────────────────────────────────

def should_process_frame() -> bool:
    """
    Frame skipping logic.
    Processes only every N-th frame to reduce inference load by 50-66%.
    """
    global _frame_counter
    with frame_lock:
        _frame_counter += 1
        if FRAME_SKIP <= 1:
            return True
        return _frame_counter % FRAME_SKIP == 0


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/status")
async def get_status() -> Dict[str, Any]:
    """Returns AI engine status."""
    return {
        "initialized": is_initialized,
        "backend": "insightface" if is_initialized else "demo",
        "provider": used_provider,
        "faiss_vectors": faiss_index.ntotal if faiss_index is not None else 0,
        "frame_skip": FRAME_SKIP,
        "min_det_score": MIN_DETECTION_SCORE,
        "min_face_size": MIN_FACE_SIZE,
        "cooldown_seconds": COOLDOWN_SECONDS,
        "recognition_threshold": RECOGNITION_THRESHOLD,
    }


@app.get("/health")
async def get_health() -> Dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "ok",
        "initialized": is_initialized,
    }


@app.post("/detect-faces", dependencies=[Depends(verify_api_key)])
async def detect_faces(
    image: UploadFile = File(...),
    max_faces: Optional[int] = 20,
    min_confidence: Optional[float] = None,
    with_descriptors: Optional[bool] = False,
):
    """Detects faces on image. Applies quality gate."""
    try:
        image_bytes = await image.read()
        img = load_image_from_bytes(image_bytes)

        if not is_initialized or face_app is None:
            return {"faces": []}

        if img is None or img.size == 0:
            raise HTTPException(status_code=400, detail="Empty or invalid image")

        threshold = min_confidence if min_confidence is not None else MIN_DETECTION_SCORE
        faces = face_app.get(img)
        results: List[Dict[str, Any]] = []

        for face in faces[:max_faces]:
            if not passes_quality_gate(face):
                continue

            box = face.bbox.astype(int).tolist()
            detection: Dict[str, Any] = {
                "box": {
                    "x": box[0],
                    "y": box[1],
                    "width": box[2] - box[0],
                    "height": box[3] - box[1],
                },
                "score": float(face.det_score),
            }
            if with_descriptors and hasattr(face, "embedding") and face.embedding is not None:
                detection["descriptor"] = face.embedding.tolist()
            results.append(detection)

        return {"faces": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Detection error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/get-embedding", dependencies=[Depends(verify_api_key)])
async def get_embedding(image: UploadFile = File(...)):
    """Extracts face embedding from image. Applies quality gate."""
    try:
        image_bytes = await image.read()
        img = load_image_from_bytes(image_bytes)

        if not is_initialized or face_app is None:
            raise HTTPException(status_code=400, detail="AI not initialized")

        if img is None or img.size == 0:
            raise HTTPException(status_code=400, detail="Empty or invalid image")

        faces = face_app.get(img)
        if not faces:
            return {"descriptor": None, "error": "No face detected"}

        face = faces[0]
        if not passes_quality_gate(face):
            return {"descriptor": None, "error": "Low quality face"}

        if not hasattr(face, "embedding") or face.embedding is None:
            return {"descriptor": None, "error": "Failed to extract embedding"}

        return {"descriptor": face.embedding.tolist()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recognize", dependencies=[Depends(verify_api_key)])
async def recognize(
    image: UploadFile = File(...),
    top_k: Optional[int] = 5,
    category: Optional[str] = "",
    threshold: Optional[float] = None,
    apply_cooldown: Optional[bool] = True,
):
    """
    Full recognition pipeline.
    OPTIMIZED: Frame skip check happens BEFORE image decoding to save I/O and CPU.
    """
    if not should_process_frame():
        return {"matches": [], "status": "skipped"}

    try:
        image_bytes = await image.read()
        img = load_image_from_bytes(image_bytes)

        if not is_initialized or face_app is None:
            return {"matches": [], "status": "demo"}

        if img is None or img.size == 0:
            raise HTTPException(status_code=400, detail="Empty or invalid image")

        faces = face_app.get(img)
        if not faces:
            return {"matches": [], "status": "no_faces"}

        valid_faces = [f for f in faces if passes_quality_gate(f)]
        if not valid_faces:
            return {"matches": [], "status": "no_valid_faces"}

        primary_face = valid_faces[0]
        if not hasattr(primary_face, "embedding") or primary_face.embedding is None:
            return {"matches": [], "status": "no_embedding"}

        embedding = np.array(primary_face.embedding, dtype=np.float32)
        candidates = get_faiss_matches(embedding, top_k=top_k)
        effective_threshold = threshold if threshold is not None else RECOGNITION_THRESHOLD

        matches: List[Dict[str, Any]] = []
        for candidate in candidates:
            person = candidate["person"]
            sim = float(candidate["score"])

            if category and person.get("category") != category:
                continue

            if sim < effective_threshold:
                continue

            person_id = person["person_id"]
            if apply_cooldown and is_on_cooldown(person_id, person.get("category", "")):
                continue

            matches.append({
                "person_id": person_id,
                "person_name": person["person_name"],
                "category": person.get("category", ""),
                "photo_path": person.get("photo_path", ""),
                "similarity": sim,
            })

        matches.sort(key=lambda x: x["similarity"], reverse=True)

        return {
            "matches": matches[:top_k],
            "status": "ok",
            "total_vectors": faiss_index.ntotal if faiss_index is not None else 0,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Recognition error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recognize-by-descriptor", dependencies=[Depends(verify_api_key)])
async def recognize_by_descriptor(
    payload: Dict[str, Any],
    top_k: Optional[int] = 5,
    category: Optional[str] = "",
    threshold: Optional[float] = None,
    apply_cooldown: Optional[bool] = True,
):
    """
    Recognition by precomputed descriptor (no re-detection).
    Expected JSON body:
    {
      "descriptor": [float, float, ...],
      "person_label": "optional_label_for_cooldown"
    }
    """
    if not should_process_frame():
        return {"matches": [], "status": "skipped"}

    try:
        descriptor_raw = payload.get("descriptor")
        if not descriptor_raw:
            raise HTTPException(status_code=400, detail="Missing descriptor")

        embedding = np.array(descriptor_raw, dtype=np.float32)
        if embedding.size == 0:
            raise HTTPException(status_code=400, detail="Empty descriptor")

        candidates = get_faiss_matches(embedding, top_k=top_k)
        effective_threshold = threshold if threshold is not None else RECOGNITION_THRESHOLD

        matches: List[Dict[str, Any]] = []
        for candidate in candidates:
            person = candidate["person"]
            sim = float(candidate["score"])

            if category and person.get("category") != category:
                continue

            if sim < effective_threshold:
                continue

            person_id = person["person_id"]
            if apply_cooldown and is_on_cooldown(person_id, person.get("category", "")):
                continue

            matches.append({
                "person_id": person_id,
                "person_name": person["person_name"],
                "category": person.get("category", ""),
                "photo_path": person.get("photo_path", ""),
                "similarity": sim,
            })

        matches.sort(key=lambda x: x["similarity"], reverse=True)

        return {
            "matches": matches[:top_k],
            "status": "ok",
            "total_vectors": faiss_index.ntotal if faiss_index is not None else 0,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Descriptor recognition error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update-index", dependencies=[Depends(verify_api_key)])
async def update_index(payload: Dict[str, Any]):
    """
    Rebuilds FAISS index securely. Requires X-API-Key header.
    """
    try:
        persons = payload.get("persons", [])
        if not persons:
            _build_faiss_index([])
            return {"status": "ok", "indexed": 0}

        _build_faiss_index(persons)
        return {
            "status": "ok",
            "indexed": len(persons),
            "total_vectors": faiss_index.ntotal if faiss_index is not None else 0,
        }
    except Exception as e:
        logger.error(f"Index update error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compare-faces", dependencies=[Depends(verify_api_key)])
async def compare_faces(
    descriptor1: UploadFile = File(...),
    descriptor2: UploadFile = File(...)
):
    """Compares two embeddings using normalized dot product."""
    try:
        d1 = np.array(json.loads((await descriptor1.read()).decode()), dtype=np.float32)
        d2 = np.array(json.loads((await descriptor2.read()).decode()), dtype=np.float32)

        d1 = d1 / (np.linalg.norm(d1) + 1e-12)
        d2 = d2 / (np.linalg.norm(d2) + 1e-12)
        similarity = float(np.dot(d1, d2))
        return {"similarity": similarity}
    except Exception as e:
        logger.error(f"Comparison error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ─── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
