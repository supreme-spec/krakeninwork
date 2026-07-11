#!/usr/bin/env python3
"""Скачать модель buffalo_l в папку models проекта"""

import os
from pathlib import Path

# Импорт функции скачивания из InsightFace
from insightface.utils.download import download

# Путь к нашему проекту
project_dir = Path(__file__).parent
models_root = project_dir / "models"
models_root.mkdir(exist_ok=True)

print(f"Downloading buffalo_l model to: {models_root}")

# Скачиваем модель!
download(
    'models',           # тип ресурса
    'buffalo_l',        # имя модели
    root=str(models_root),  # куда скачивать
    force=False         # не перезаписывать, если уже есть
)

print("\nDownload complete!")
print(f"Model should be in: {models_root / 'models' / 'buffalo_l'}")

# Перемещаем из models/models/buffalo_l в models/buffalo_l (если нужно)
buffalo_l_tmp = models_root / "models" / "buffalo_l"
if buffalo_l_tmp.exists():
    target_dir = models_root / "buffalo_l"
    print(f"\nMoving model from {buffalo_l_tmp} to {target_dir}")
    import shutil
    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.move(str(buffalo_l_tmp), str(target_dir))
    # Удаляем пустую папку models/models
    shutil.rmtree(str(models_root / "models"))

print("\nModel ready! Checking contents...")
target_dir = models_root / "buffalo_l"
if target_dir.exists():
    print("Contents of buffalo_l directory:")
    for f in target_dir.iterdir():
        print(f"  - {f.name}")
