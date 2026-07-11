#!/usr/bin/env python3
"""
Face Detection & Recognition Server (FastAPI + InsightFace)
Современная реализация для системы безопасности
С кроссплатформенным GPU-ускорением и безопасным fallback на CPU
"""

import asyncio
import os
import io
import json
import logging
import numpy as np
from typing import Dict, List, Optional, Tuple
from pathlib import Path

import cv2
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='[FaceEngine] %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# Убедимся, что папка для моделей существует
MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# Инициализация FastAPI
app = FastAPI(title="Smart Security - Face Engine", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Глобальные переменные для моделей
face_app = None
is_initialized = False
used_provider = "CPUExecutionProvider"


def get_optimal_providers():
    """
    Определяет лучшее GPU-ускорение для текущего железа (NVIDIA, AMD, Intel).
    """
    import onnxruntime as ort
    available_providers = ort.get_available_providers()
    providers = []

    # 1. NVIDIA (CUDA) - самый мощный и стабильный
    if 'CUDAExecutionProvider' in available_providers:
        providers.append('CUDAExecutionProvider')
        logger.info("Обнаружен NVIDIA GPU. Используем CUDA.")

    # 2. AMD / Intel (DirectML) - отлично работает на Windows
    elif 'DmlExecutionProvider' in available_providers:
        providers.append('DmlExecutionProvider')
        logger.info("Обнаружен AMD/Intel GPU. Используем DirectML.")

    # 3. Intel (OpenVINO) - специфично для Linux и CPU Intel
    elif 'OpenVINOExecutionProvider' in available_providers:
        providers.append('OpenVINOExecutionProvider')
        logger.info("Обнаружен Intel GPU/CPU. Используем OpenVINO.")

    # 4. AMD (ROCm) - специфично для Linux
    elif 'ROCMExecutionProvider' in available_providers:
        providers.append('ROCMExecutionProvider')
        logger.info("Обнаружен AMD GPU. Используем ROCm.")

    else:
        logger.warning("GPU-провайдеры не найдены. Будет использован только CPU.")

    # CPU всегда идет последним как fallback
    providers.append('CPUExecutionProvider')
    return providers


def initialize_face_engine():
    """
    Инициализирует InsightFace с умным fallback:
    если GPU не смог загрузить модель, переключаемся на CPU.
    """
    used_provider_local = "CPUExecutionProvider"
    try:
        import insightface
        import onnxruntime as ort
        target_providers = get_optimal_providers()
        ort.set_default_logger_severity(3)

        # Если в списке только CPU, сразу инициализируем
        if target_providers == ['CPUExecutionProvider']:
            logger.info("Инициализация InsightFace на CPU...")
            app_instance = insightface.app.FaceAnalysis(name='buffalo_l', root=str(MODELS_DIR),
                                                   providers=['CPUExecutionProvider'])
            app_instance.prepare(ctx_id=-1, det_size=(640, 640))
            used_provider_local = "CPUExecutionProvider"
            logger.info("InsightFace успешно загружен на CPU!")
            return app_instance, used_provider_local

        # Пытаемся инициализировать на GPU
        try:
            logger.info(f"Попытка инициализации InsightFace на GPU с провайдерами: {target_providers[:-1]}...")
            # Создаем приложение
            app_instance = insightface.app.FaceAnalysis(name='buffalo_l', root=str(MODELS_DIR), providers=target_providers)
            # prepare() реально загружает модели в память
            app_instance.prepare(ctx_id=0, det_size=(640, 640))
            used_provider_local = target_providers[0]
            logger.info("InsightFace успешно загружен на GPU!")
            return app_instance, used_provider_local
        except Exception as e:
            logger.error(f"Критическая ошибка инициализации GPU: {e}")
            logger.warning("Выполняется экстренный откат (fallback) на CPU...")
            # Fallback на чистый CPU
            app_instance = insightface.app.FaceAnalysis(name='buffalo_l', root=str(MODELS_DIR), providers=['CPUExecutionProvider'])
            app_instance.prepare(ctx_id=-1, det_size=(640, 640))
            used_provider_local = "CPUExecutionProvider"
            logger.info("InsightFace загружен на CPU (режим совместимости).")
            return app_instance, used_provider_local

    except Exception as e:
        logger.error(f"Общая ошибка инициализации: {e}")
        import traceback
        traceback.print_exc()
        logger.error("Работаем в режиме демо (без AI)")
        return None, "none"


# Глобальная инициализация при старте сервера
try:
    face_app, used_provider = initialize_face_engine()
    if face_app is not None:
        is_initialized = True
except Exception as e:
    logger.error(f"Ошибка инициализации: {e}")
    is_initialized = False


# --- Типы для ответов ---
class FaceDetection:
    def __init__(self, box: List[int], score: float, descriptor: Optional[List[float]] = None):
        self.box = {"x": box[0], "y": box[1], "width": box[2] - box[0], "height": box[3] - box[1]}
        self.score = float(score)
        self.descriptor = descriptor


class RecognitionMatch:
    def __init__(self, person_id: int, person_name: str, category: str, similarity: float, photo_path: str):
        self.person_id = person_id
        self.person_name = person_name
        self.category = category
        self.similarity = float(similarity)
        self.photo_path = photo_path


# --- API endpoints ---
@app.get("/status")
async def get_status():
    """Получить статус AI движка"""
    return {
        "initialized": is_initialized,
        "backend": "insightface" if is_initialized else "demo",
        "provider": used_provider
    }


@app.get("/health")
async def get_health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "initialized": is_initialized
    }


def load_image_from_bytes(data: bytes) -> Optional[np.ndarray]:
    """Загрузить изображение из байтов"""
    if not data:
        return None
    try:
        img = Image.open(io.BytesIO(data))
        img_rgb = np.array(img.convert("RGB"))
    except Exception as e:
        logger.error(f"Не удалось декодировать изображение: {e}")
        return None
    if img_rgb.size == 0:
        return None
    return img_rgb


@app.post("/detect-faces")
async def detect_faces(
    image: UploadFile = File(...),
    max_faces: Optional[int] = 20,
    min_confidence: Optional[float] = 0.5,
    with_descriptors: Optional[bool] = False
):
    """Детекция лиц на изображении"""
    try:
        image_bytes = await image.read()
        img = load_image_from_bytes(image_bytes)

        if not is_initialized or face_app is None:
            return {"faces": []}

        if img is None or img.size == 0:
            raise HTTPException(status_code=400, detail="Empty or invalid image")

        faces = face_app.get(img)
        results = []

        for i, face in enumerate(faces[:max_faces]):
            if face.det_score < min_confidence:
                continue

            box = face.bbox.astype(int).tolist()
            detection = {
                "box": {"x": box[0], "y": box[1], "width": box[2] - box[0], "height": box[3] - box[1]},
                "score": float(face.det_score)
            }
            if with_descriptors and hasattr(face, 'embedding') and face.embedding is not None:
                detection["descriptor"] = face.embedding.tolist()
            results.append(detection)

        return {"faces": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ошибка детекции: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/get-embedding")
async def get_embedding(image: UploadFile = File(...)):
    """Получить эмбеддинг лица из изображения"""
    try:
        image_bytes = await image.read()
        img = load_image_from_bytes(image_bytes)

        if not is_initialized or face_app is None:
            raise HTTPException(status_code=400, detail="AI not initialized")

        if img is None or img.size == 0:
            raise HTTPException(status_code=400, detail="Empty or invalid image")

        faces = face_app.get(img)
        if len(faces) == 0:
            return {"descriptor": None, "error": "No face detected"}

        if not hasattr(faces[0], 'embedding') or faces[0].embedding is None:
            return {"descriptor": None, "error": "Failed to extract embedding"}

        return {"descriptor": faces[0].embedding.tolist()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ошибка эмбеддинга: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compare-faces")
async def compare_faces(
    descriptor1: UploadFile = File(...),
    descriptor2: UploadFile = File(...)
):
    """Сравнить два эмбеддинга"""
    try:
        d1 = np.array(json.loads((await descriptor1.read()).decode()))
        d2 = np.array(json.loads((await descriptor2.read()).decode()))

        # Косинусное сходство
        similarity = np.dot(d1, d2) / (np.linalg.norm(d1) * np.linalg.norm(d2))
        return {"similarity": float(similarity)}
    except Exception as e:
        logger.error(f"Ошибка сравнения: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
