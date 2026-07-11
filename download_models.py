#!/usr/bin/env python3
"""Скрипт для скачивания моделей InsightFace (buffalo_l) в локальную папку проекта"""

import os
import sys
from pathlib import Path

def main():
    # Установка пути к моделям
    project_root = Path(__file__).parent
    models_dir = project_root / "models"
    models_dir.mkdir(exist_ok=True)
    
    print(f"Model directory: {models_dir}")
    print("Starting InsightFace initialization and model download...")
    
    try:
        import insightface
        from insightface.app import FaceAnalysis
        
        # Инициализируем FaceAnalysis, это автоматически скачает модели, если их нет
        print("Initializing FaceAnalysis...")
        app = FaceAnalysis(
            name="buffalo_l",
            root=str(models_dir)
        )
        app.prepare(ctx_id=0, det_size=(640, 640))
        
        print("\nModels successfully downloaded and ready!")
        print(f"Model path: {models_dir / 'buffalo_l'}")
        
        # Проверим, что модели загрузились
        print("\nContents of buffalo_l folder:")
        buffalo_l_dir = models_dir / "buffalo_l"
        if buffalo_l_dir.exists():
            for item in sorted(buffalo_l_dir.iterdir()):
                print(f"   - {item.name}")
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
