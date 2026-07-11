#!/usr/bin/env python3
"""Debug script to see how InsightFace loads models"""

import sys
from pathlib import Path

# First, let's see what the default model path is
print("=== Default model locations ===")
import os
home_dir = Path.home()
print(f"Home directory: {home_dir}")
insightface_home = home_dir / ".insightface"
print(f"Default InsightFace home: {insightface_home}")

# Let's try to manually download the models
print("\n=== Trying to download model directly ===")
try:
    from insightface.model_zoo import get_model
    from insightface.app import FaceAnalysis
    
    # First, let's check what models are available
    print("\nChecking available models...")
    
    # Let's just use the default download location first to get the model files,
    # then copy them to our project!
    print("\nDownloading to default location to get model files...")
    app_default = FaceAnalysis(name="buffalo_l")
    app_default.prepare(ctx_id=0, det_size=(640,640))
    
    print(f"\nModels loaded successfully from default location!")
    print(f"Available models in app: {list(app_default.models.keys())}")
    
    # Now let's find where the default model is stored
    default_model_dir = insightface_home / "models" / "buffalo_l"
    if default_model_dir.exists():
        print(f"\nDefault model directory: {default_model_dir}")
        print("\nContents:")
        for item in default_model_dir.iterdir():
            print(f"  - {item.name} ({'dir' if item.is_dir() else 'file'})")
        
        # Now copy these models to our project directory!
        project_dir = Path(__file__).parent
        target_model_dir = project_dir / "models" / "buffalo_l"
        target_model_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"\nCopying models to project directory: {target_model_dir}")
        import shutil
        for item in default_model_dir.iterdir():
            dest = target_model_dir / item.name
            if item.is_dir():
                if dest.exists():
                    shutil.rmtree(dest)
                shutil.copytree(item, dest)
            else:
                shutil.copy2(item, dest)
            print(f"  Copied: {item.name}")
        
        print("\n✅ Models copied successfully! Now testing from project directory...")
        
        # Now test with our project directory
        print("\nTesting FaceAnalysis from project directory...")
        app_project = FaceAnalysis(name="buffalo_l", root=str(project_dir / "models"))
        app_project.prepare(ctx_id=0, det_size=(640, 640))
        print(f"✅ Success! Project directory models loaded: {list(app_project.models.keys())}")
        
except Exception as e:
    print(f"\nError: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
