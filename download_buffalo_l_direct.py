#!/usr/bin/env python3
"""Direct download of buffalo_l model"""

import os
import zipfile
import requests
from pathlib import Path
from tqdm import tqdm

# URLs for buffalo_l model (from InsightFace official repo)
MODEL_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"

# Project directory
project_dir = Path(__file__).parent
models_dir = project_dir / "models"
buffalo_l_dir = models_dir / "buffalo_l"

# Create directories
models_dir.mkdir(exist_ok=True)
buffalo_l_dir.mkdir(exist_ok=True)

zip_path = models_dir / "buffalo_l.zip"

# Download if zip doesn't exist
if not zip_path.exists():
    print(f"Downloading buffalo_l from {MODEL_URL}...")
    response = requests.get(MODEL_URL, stream=True)
    response.raise_for_status()
    
    total_size = int(response.headers.get("content-length", 0))
    
    with open(zip_path, "wb") as f, tqdm(
        desc="Downloading",
        total=total_size,
        unit="iB",
        unit_scale=True,
        unit_divisor=1024,
    ) as bar:
        for chunk in response.iter_content(chunk_size=1024):
            size = f.write(chunk)
            bar.update(size)
    print("Download complete!")
else:
    print("Zip file already exists, skipping download.")

# Extract the zip
print("Extracting model files...")
with zipfile.ZipFile(zip_path, "r") as zip_ref:
    zip_ref.extractall(buffalo_l_dir)

print("\nDone! Checking extracted files...")
for f in sorted(buffalo_l_dir.iterdir()):
    print(f"  - {f.name}")

print("\nModel is ready!")
